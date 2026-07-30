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
}

function sanitizeColumnOrder(saved: string[] | null | undefined): ReorderableColumnKey[] {
  const known = new Set<string>(DEFAULT_COLUMN_ORDER);
  const filtered = (saved ?? []).filter((k): k is ReorderableColumnKey => known.has(k));
  const missing = DEFAULT_COLUMN_ORDER.filter((k) => !filtered.includes(k));
  return [...filtered, ...missing];
}

function sanitizeColumnWidths(saved: Record<string, number> | null | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of DEFAULT_COLUMN_ORDER) {
    const w = saved?.[key];
    result[key] = typeof w === 'number' && w >= 60 && w <= 1000 ? w : DEFAULT_COL_WIDTHS[key];
  }
  return result;
}

export function TrackerPage() {
  const { canEdit } = useRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FollowUpStatus[]>([]);
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

  // Seed the column layout and page size from the user's saved preference once it loads —
  // sanitized against the current known columns so a stale/edited-elsewhere layout (missing a
  // column, or naming one that no longer exists) degrades gracefully instead of breaking.
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

  // Deep link from the Activity Feed's "View" button (?entryId=...) — keeps the list exactly
  // as it normally looks (no filtering), jumps to whichever page the entry actually falls on,
  // and briefly flashes its row so it's obvious which one was clicked.
  useEffect(() => {
    const entryId = searchParams.get('entryId');
    if (!entryId) return;
    setSearch('');
    setStatusFilter([]);
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

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  statusFilter.forEach((s) => params.append('status', s));
  if (sortBy) {
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
  }
  params.set('page', String(page));
  params.set('page_size', String(pageSize));

  const entriesQuery = useQuery({
    queryKey: ['pi-entries', search, statusFilter, sortBy, sortDir, page, pageSize],
    queryFn: () => api.get<PaginatedResult<PiEntry>>(`/pi-entries?${params.toString()}`),
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

  return (
    <div>
      <div className="toolbar-row" ref={toolbarRef}>
        <div className="search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search DPR No., vessel, vendor, service…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <MultiSelectDropdown
          options={STATUS_OPTIONS}
          selected={statusFilter}
          onChange={(next) => {
            setPage(1);
            setStatusFilter(next as FollowUpStatus[]);
          }}
          allLabel="All statuses"
        />
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
