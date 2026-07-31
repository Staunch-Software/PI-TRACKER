import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useRole } from '../auth/useRole';
import { api, ApiError } from '../lib/api';
import {
  blankPiEntryForm,
  toPiEntryFormState,
  toPiEntryPayload,
  type PiEntryFormState,
} from '../lib/piEntryForm';
import {
  Currency,
  FOLLOW_UP_STATUS_LABELS,
  FollowUpStatus,
  type PaginatedResult,
  type PiEntry,
  type Vendor,
  type Vessel,
} from '../shared';
import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_COL_WIDTHS,
  PiEntriesTable,
  type ReorderableColumnKey,
  type SortColumn,
} from '../components/table/PiEntriesTable';
import { MultiSelectDropdown } from '../components/common/MultiSelectDropdown';
import { SearchIcon } from '../components/common/SearchIcon';
import { ImportWizardModal } from '../components/modals/ImportWizardModal';

const STATUS_OPTIONS = Object.values(FollowUpStatus).map((s) => ({ value: s, label: FOLLOW_UP_STATUS_LABELS[s] }));

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 150, 200];
const MIN_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 1000;

interface TableLayoutPreference {
  tableKey: string;
  columnOrder: string[];
  columnWidths: Record<string, number>;
  pageSize: number | null;
  filters: Partial<TrackerFilters> | null;
}

// The full set of tracker filters — mirrored to the URL (so a filtered view is shareable/
// bookmarkable) and auto-saved per user (so it survives a refresh or a new session). Query param
// names on the wire match backend/app/api/routes/pi_entries.py's query params 1:1.
interface TrackerFilters {
  search: string;
  status: FollowUpStatus[];
  vesselIds: string[];
  vendorIds: string[];
  currencies: Currency[];
  overdue: boolean;
  noInvoiceAttached: boolean;
  dprDateFrom: string;
  dprDateTo: string;
  paymentDateFrom: string;
  paymentDateTo: string;
  invoiceDateFrom: string;
  invoiceDateTo: string;
}

const DEFAULT_FILTERS: TrackerFilters = {
  search: '',
  status: [],
  vesselIds: [],
  vendorIds: [],
  currencies: [],
  overdue: false,
  noInvoiceAttached: false,
  dprDateFrom: '',
  dprDateTo: '',
  paymentDateFrom: '',
  paymentDateTo: '',
  invoiceDateFrom: '',
  invoiceDateTo: '',
};

// Only returns keys actually present in the URL — callers merge this over defaults/saved
// preferences, so an absent param means "not specified here", not "explicitly cleared".
function readFiltersFromParams(sp: URLSearchParams): Partial<TrackerFilters> {
  const result: Partial<TrackerFilters> = {};
  if (sp.has('search')) result.search = sp.get('search') ?? '';
  if (sp.has('status')) result.status = sp.getAll('status') as FollowUpStatus[];
  if (sp.has('vessel_id')) result.vesselIds = sp.getAll('vessel_id');
  if (sp.has('vendor_id')) result.vendorIds = sp.getAll('vendor_id');
  if (sp.has('currency')) result.currencies = sp.getAll('currency') as Currency[];
  if (sp.has('overdue')) result.overdue = sp.get('overdue') === 'true';
  if (sp.has('no_invoice_attached')) result.noInvoiceAttached = sp.get('no_invoice_attached') === 'true';
  if (sp.has('dpr_date_from')) result.dprDateFrom = sp.get('dpr_date_from') ?? '';
  if (sp.has('dpr_date_to')) result.dprDateTo = sp.get('dpr_date_to') ?? '';
  if (sp.has('payment_date_from')) result.paymentDateFrom = sp.get('payment_date_from') ?? '';
  if (sp.has('payment_date_to')) result.paymentDateTo = sp.get('payment_date_to') ?? '';
  if (sp.has('invoice_date_from')) result.invoiceDateFrom = sp.get('invoice_date_from') ?? '';
  if (sp.has('invoice_date_to')) result.invoiceDateTo = sp.get('invoice_date_to') ?? '';
  return result;
}

// Builds the query params shared by both the actual API fetch and the URL-sync effect below —
// the backend's query param names were designed to match these 1:1, so one function serves both.
function buildQueryParams(
  filters: TrackerFilters,
  sortBy: SortColumn | null,
  sortDir: 'asc' | 'desc',
  page: number,
  pageSize: number
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  filters.status.forEach((s) => params.append('status', s));
  filters.vesselIds.forEach((v) => params.append('vessel_id', v));
  filters.vendorIds.forEach((v) => params.append('vendor_id', v));
  filters.currencies.forEach((c) => params.append('currency', c));
  if (filters.overdue) params.set('overdue', 'true');
  if (filters.noInvoiceAttached) params.set('no_invoice_attached', 'true');
  if (filters.dprDateFrom) params.set('dpr_date_from', filters.dprDateFrom);
  if (filters.dprDateTo) params.set('dpr_date_to', filters.dprDateTo);
  if (filters.paymentDateFrom) params.set('payment_date_from', filters.paymentDateFrom);
  if (filters.paymentDateTo) params.set('payment_date_to', filters.paymentDateTo);
  if (filters.invoiceDateFrom) params.set('invoice_date_from', filters.invoiceDateFrom);
  if (filters.invoiceDateTo) params.set('invoice_date_to', filters.invoiceDateTo);
  if (sortBy) {
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
  }
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  return params;
}

function sanitizeColumnOrder(saved: string[] | null | undefined): ReorderableColumnKey[] {
  const known = new Set<string>(DEFAULT_COLUMN_ORDER);
  const filtered = (saved ?? []).filter((k): k is ReorderableColumnKey => known.has(k));
  const missing = DEFAULT_COLUMN_ORDER.filter((k) => !filtered.includes(k));
  return [...filtered, ...missing];
}

// Iterates every known column (not just DEFAULT_COLUMN_ORDER) so the Follow-up Status column's
// width still restores correctly even though it's a fixed sticky column, absent from
// DEFAULT_COLUMN_ORDER (which only lists the draggable/reorderable columns).
function sanitizeColumnWidths(saved: Record<string, number> | null | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(DEFAULT_COL_WIDTHS) as ReorderableColumnKey[]) {
    const w = saved?.[key];
    result[key] = typeof w === 'number' && w >= 60 && w <= 1000 ? w : DEFAULT_COL_WIDTHS[key];
  }
  return result;
}

export function TrackerPage() {
  const { canEdit } = useRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<TrackerFilters>(() => ({
    ...DEFAULT_FILTERS,
    ...readFiltersFromParams(searchParams),
  }));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [customPageSizeInput, setCustomPageSizeInput] = useState('');
  const [sortBy, setSortBy] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [isImporting, setIsImporting] = useState(false);

  const [layoutEditable, setLayoutEditable] = useState(false);
  const [savedColumnOrder, setSavedColumnOrder] = useState<ReorderableColumnKey[]>([...DEFAULT_COLUMN_ORDER]);
  const [savedColumnWidths, setSavedColumnWidths] = useState<Record<string, number>>({ ...DEFAULT_COL_WIDTHS });
  const [columnOrder, setColumnOrder] = useState<ReorderableColumnKey[]>([...DEFAULT_COLUMN_ORDER]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({ ...DEFAULT_COL_WIDTHS });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PiEntryFormState | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newRowForm, setNewRowForm] = useState<PiEntryFormState>(blankPiEntryForm());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  // Guards the one-time restore (URL > saved preference > defaults) and the URL-sync/save-filters
  // effects below so neither fires before that restore has settled — otherwise they'd overwrite
  // the just-loaded saved preference before it ever reaches the screen.
  const initializedRef = useRef(false);

  // The table's own sticky header (PiEntriesTable) needs to sit directly under this toolbar's
  // bottom edge. Reading that edge straight off getBoundingClientRect() — rather than adding up
  // assumed nav height + toolbar height + margins by hand — sidesteps every way that
  // reconstruction can drift from reality (flex-wrap onto a second line, box-shadow, rounding).
  // It's re-read on scroll too because the toolbar's own edge position briefly differs between
  // its normal (unstuck, with the page's top padding above it) and stuck states.
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    function updateOffset() {
      document.documentElement.style.setProperty('--toolbar-bottom', `${el!.getBoundingClientRect().bottom}px`);
    }
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(el);
    window.addEventListener('scroll', updateOffset, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', updateOffset);
    };
  }, []);

  const vesselsQuery = useQuery({ queryKey: ['vessels'], queryFn: () => api.get<Vessel[]>('/vessels') });
  const vendorsQuery = useQuery({ queryKey: ['vendors'], queryFn: () => api.get<Vendor[]>('/vendors') });

  const tableLayoutQuery = useQuery({
    queryKey: ['table-layout', 'pi_entries'],
    queryFn: () => api.get<TableLayoutPreference | null>('/table-layout/pi_entries'),
  });

  // Seed the column layout, page size, and filters from the user's saved preference once it
  // loads. Column layout is sanitized against the current known columns so a stale/edited-
  // elsewhere layout degrades gracefully. Filters use restore precedence URL > saved > defaults —
  // any field already present in the URL on first load wins over the saved snapshot, since a
  // shared/bookmarked link should reproduce exactly what it shows regardless of what's saved.
  useEffect(() => {
    if (tableLayoutQuery.data === undefined) return;
    const order = sanitizeColumnOrder(tableLayoutQuery.data?.columnOrder);
    const widths = sanitizeColumnWidths(tableLayoutQuery.data?.columnWidths);
    setSavedColumnOrder(order);
    setSavedColumnWidths(widths);
    setColumnOrder(order);
    setColumnWidths(widths);
    if (tableLayoutQuery.data?.pageSize) {
      setPageSize(tableLayoutQuery.data.pageSize);
    }
    if (!initializedRef.current) {
      const fromUrl = readFiltersFromParams(searchParams);
      setFilters({ ...DEFAULT_FILTERS, ...(tableLayoutQuery.data?.filters ?? {}), ...fromUrl });
      initializedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableLayoutQuery.data]);

  const saveLayoutMutation = useMutation({
    mutationFn: () => api.put<TableLayoutPreference>('/table-layout/pi_entries', { columnOrder, columnWidths }),
    onSuccess: () => {
      setSavedColumnOrder(columnOrder);
      setSavedColumnWidths(columnWidths);
      setLayoutEditable(false);
    },
  });

  const savePageSizeMutation = useMutation({
    mutationFn: (size: number) => api.put<TableLayoutPreference>('/table-layout/pi_entries', { pageSize: size }),
  });

  const saveFiltersMutation = useMutation({
    mutationFn: (next: TrackerFilters) => api.put<TableLayoutPreference>('/table-layout/pi_entries', { filters: next }),
  });

  // Debounced auto-save of the last-used filters, so typing in Search or toggling a chip doesn't
  // fire a PUT per keystroke. Skipped until the initial restore has settled, so loading the saved
  // snapshot doesn't immediately re-save itself.
  useEffect(() => {
    if (!initializedRef.current) return;
    const timeout = setTimeout(() => saveFiltersMutation.mutate(filters), 600);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Mirrors current filters/sort/page state into the URL (replace, not push, so back/forward
  // isn't spammed) — makes a filtered/sorted view shareable and survivable across a refresh.
  // Also skipped until the initial restore has settled, for the same reason as above.
  useEffect(() => {
    if (!initializedRef.current) return;
    setSearchParams(buildQueryParams(filters, sortBy, sortDir, page, pageSize), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sortBy, sortDir, page, pageSize]);

  function startLayoutEdit() {
    cancelEdit();
    cancelAdd();
    setLayoutEditable(true);
  }

  function cancelLayoutEdit() {
    setColumnOrder(savedColumnOrder);
    setColumnWidths(savedColumnWidths);
    setLayoutEditable(false);
  }

  function applyPageSize(size: number) {
    const clamped = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.round(size)));
    setPageSize(clamped);
    setPage(1);
    setCustomPageSizeInput('');
    savePageSizeMutation.mutate(clamped);
  }

  // Every filter control goes through this so changing any filter always resets to page 1.
  function updateFilters(patch: Partial<TrackerFilters>) {
    setPage(1);
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function toggleChip(field: 'overdue' | 'noInvoiceAttached') {
    updateFilters({ [field]: !filters[field] });
  }

  // Deep link from the Activity Feed's "View" button (?entryId=...) — keeps the list exactly
  // as it normally looks (no filtering), jumps to whichever page the entry actually falls on,
  // and briefly flashes its row so it's obvious which one was clicked.
  useEffect(() => {
    const entryId = searchParams.get('entryId');
    if (!entryId) return;
    initializedRef.current = true;
    setFilters(DEFAULT_FILTERS);
    setSortBy(null);
    setSortDir('desc');
    Promise.all([
      api.get<PiEntry>(`/pi-entries/${entryId}`),
      api.get<{ position: number }>(`/pi-entries/${entryId}/position`),
    ])
      .then(([entry, { position }]) => {
        setPage(Math.floor(position / pageSize) + 1);
        setHighlightId(entry.id);
        setTimeout(() => setHighlightId(null), 2500);
      })
      .finally(() => {
        searchParams.delete('entryId');
        setSearchParams(searchParams, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const entriesQuery = useQuery({
    queryKey: ['pi-entries', filters, sortBy, sortDir, page, pageSize],
    queryFn: () => api.get<PaginatedResult<PiEntry>>(`/pi-entries?${buildQueryParams(filters, sortBy, sortDir, page, pageSize).toString()}`),
    // Keeps the current rows on screen while a re-sort/re-filter fetches in the background,
    // instead of clearing the table to the "Loading tracker…" placeholder every click — that
    // full-table swap is what read as "the whole page reloading" when clicking a column header.
    placeholderData: keepPreviousData,
    // Days Since Payment is computed live off CURRENT_DATE on the backend — refetch
    // periodically so a tab left open still picks up the day rolling over instead of showing
    // a stale snapshot until the next manual reload/refocus.
    refetchInterval: 5 * 60 * 1000,
  });

  const totalPages = entriesQuery.data ? Math.max(1, Math.ceil(entriesQuery.data.total / pageSize)) : 1;

  function handleSort(column: SortColumn) {
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
    setPage(1);
  }

  function refreshAfterSave() {
    queryClient.invalidateQueries({ queryKey: ['pi-entries'] });
    queryClient.invalidateQueries({ queryKey: ['audit-log'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
  }

  // --- edit existing row ---
  function startEdit(entry: PiEntry) {
    setSaveError(null);
    setIsAddingNew(false);
    setEditingId(entry.id);
    setEditForm(toPiEntryFormState(entry));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
    setSaveError(null);
  }

  function updateEditForm<K extends keyof PiEntryFormState>(field: K, value: PiEntryFormState[K]) {
    setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  const editMutation = useMutation({
    mutationFn: () => api.patch<PiEntry>(`/pi-entries/${editingId}`, toPiEntryPayload(editForm!)),
    onSuccess: () => {
      refreshAfterSave();
      cancelEdit();
    },
    onError: (err) => setSaveError(err instanceof ApiError ? err.message : 'Failed to save changes.'),
  });

  // --- add new row ---
  function startAdd() {
    setSaveError(null);
    cancelEdit();
    setNewRowForm(blankPiEntryForm());
    setIsAddingNew(true);
    requestAnimationFrame(() => {
      tableRef.current?.querySelector('tr.row-editing')?.scrollIntoView({ block: 'center' });
    });
  }

  function cancelAdd() {
    setIsAddingNew(false);
    setSaveError(null);
  }

  function updateNewRowForm<K extends keyof PiEntryFormState>(field: K, value: PiEntryFormState[K]) {
    setNewRowForm((prev) => ({ ...prev, [field]: value }));
  }

  const addMutation = useMutation({
    mutationFn: () => api.post<PiEntry>('/pi-entries', toPiEntryPayload(newRowForm)),
    onSuccess: () => {
      refreshAfterSave();
      cancelAdd();
    },
    onError: (err) => setSaveError(err instanceof ApiError ? err.message : 'Failed to add PI entry.'),
  });

  const vesselOptions = (vesselsQuery.data ?? []).map((v) => ({ value: v.id, label: v.name }));
  const vendorOptions = (vendorsQuery.data ?? []).map((v) => ({ value: v.id, label: v.name }));

  return (
    <div>
      <div className="toolbar-row" ref={toolbarRef}>
        <div className="search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search DPR No., vessel, vendor, service…"
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
          />
        </div>
        <MultiSelectDropdown
          options={STATUS_OPTIONS}
          selected={filters.status}
          onChange={(next) => updateFilters({ status: next as FollowUpStatus[] })}
          allLabel="All statuses"
        />
        <MultiSelectDropdown
          options={vesselOptions}
          selected={filters.vesselIds}
          onChange={(next) => updateFilters({ vesselIds: next })}
          allLabel="All vessels"
        />
        <MultiSelectDropdown
          options={vendorOptions}
          selected={filters.vendorIds}
          onChange={(next) => updateFilters({ vendorIds: next })}
          allLabel="All vendors"
        />
        <button
          type="button"
          className={`filter-chip${filters.overdue ? ' active' : ''}`}
          onClick={() => toggleChip('overdue')}
        >
          Overdue &gt; 30 days
        </button>
        <button
          type="button"
          className={`filter-chip${filters.noInvoiceAttached ? ' active' : ''}`}
          onClick={() => toggleChip('noInvoiceAttached')}
        >
          No invoice attached
        </button>
        <div className="date-range-field">
          <label>DPR From</label>
          <input type="date" value={filters.dprDateFrom} onChange={(e) => updateFilters({ dprDateFrom: e.target.value })} />
        </div>
        <div className="date-range-field">
          <label>DPR To</label>
          <input type="date" value={filters.dprDateTo} onChange={(e) => updateFilters({ dprDateTo: e.target.value })} />
        </div>
        <div className="date-range-field">
          <label>Payment From</label>
          <input type="date" value={filters.paymentDateFrom} onChange={(e) => updateFilters({ paymentDateFrom: e.target.value })} />
        </div>
        <div className="date-range-field">
          <label>Payment To</label>
          <input type="date" value={filters.paymentDateTo} onChange={(e) => updateFilters({ paymentDateTo: e.target.value })} />
        </div>
        <div className="date-range-field">
          <label>Invoice From</label>
          <input type="date" value={filters.invoiceDateFrom} onChange={(e) => updateFilters({ invoiceDateFrom: e.target.value })} />
        </div>
        <div className="date-range-field">
          <label>Invoice To</label>
          <input type="date" value={filters.invoiceDateTo} onChange={(e) => updateFilters({ invoiceDateTo: e.target.value })} />
        </div>
        <div className="toolbar-spacer" />
        {canEdit && (
          <>
            {/* <button className="btn btn-secondary" onClick={() => setIsImporting(true)}>
              ⇪ Import from Excel
            </button> */}
            <button className="btn btn-primary" onClick={startAdd} disabled={isAddingNew || layoutEditable}>
              + Add New PI
            </button>
            {layoutEditable ? (
              <>
                <button className="btn btn-primary" onClick={() => saveLayoutMutation.mutate()} disabled={saveLayoutMutation.isPending}>
                  {saveLayoutMutation.isPending ? 'Saving…' : 'Save Layout'}
                </button>
                <button className="btn btn-secondary" onClick={cancelLayoutEdit}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn btn-secondary" onClick={startLayoutEdit} disabled={isAddingNew || editingId !== null}>
                ⚙ Edit Layout
              </button>
            )}
          </>
        )}
      </div>

      {entriesQuery.isLoading ? (
        <div className="card">
          <div className="empty-state">Loading tracker…</div>
        </div>
      ) : entriesQuery.isError ? (
        <div className="card">
          <div className="empty-state">Failed to load PI entries.</div>
        </div>
      ) : (
        <>
          <div ref={tableRef}>
            <PiEntriesTable
              entries={entriesQuery.data?.items ?? []}
              canEdit={canEdit}
              vessels={vesselsQuery.data ?? []}
              vendors={vendorsQuery.data ?? []}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
              editingId={editingId}
              editForm={editForm}
              highlightId={highlightId}
              onStartEdit={startEdit}
              onEditFormChange={updateEditForm}
              onSaveEdit={() => editMutation.mutate()}
              onCancelEdit={cancelEdit}
              isSavingEdit={editMutation.isPending}
              isAddingNew={isAddingNew}
              newRowForm={newRowForm}
              onNewRowChange={updateNewRowForm}
              onSaveNew={() => addMutation.mutate()}
              onCancelNew={cancelAdd}
              isSavingNew={addMutation.isPending}
              saveError={saveError}
              columnOrder={columnOrder}
              columnWidths={columnWidths}
              layoutEditable={layoutEditable}
              onReorderColumn={setColumnOrder}
              onResizeColumn={(key, width) => setColumnWidths((prev) => ({ ...prev, [key]: width }))}
              columnFilters={{ currency: filters.currencies }}
              onColumnFilterChange={(key, values) => {
                if (key === 'currency') updateFilters({ currencies: values as Currency[] });
              }}
            />
          </div>
          <div className="pagination">
            <div className="page-size-control">
              <label htmlFor="page-size">Rows per page</label>
              <select
                id="page-size"
                className="page-size-select"
                value={PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : ''}
                onChange={(e) => {
                  if (e.target.value) applyPageSize(Number(e.target.value));
                }}
              >
                {!PAGE_SIZE_OPTIONS.includes(pageSize) && (
                  <option value="">{pageSize} (custom)</option>
                )}
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <input
                type="number"
                className="page-size-custom-input"
                placeholder="Custom"
                min={MIN_PAGE_SIZE}
                max={MAX_PAGE_SIZE}
                value={customPageSizeInput}
                onChange={(e) => setCustomPageSizeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customPageSizeInput) applyPageSize(Number(customPageSizeInput));
                }}
              />
              <button
                type="button"
                className="btn btn-secondary page-size-apply-btn"
                onClick={() => customPageSizeInput && applyPageSize(Number(customPageSizeInput))}
                disabled={!customPageSizeInput}
              >
                Set
              </button>
            </div>
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="pager-btns">
              <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <button
                className="btn btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {isImporting && <ImportWizardModal onClose={() => setIsImporting(false)} />}
    </div>
  );
}
