import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRole } from '../../auth/useRole';
import { api, ApiError } from '../../lib/api';
import type { DdTrackerEntry, PaginatedResult } from '../../shared';
import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_COL_WIDTHS,
  DdTrackerTable,
  type ReorderableColumnKey,
  type SortColumn,
} from './DdTrackerTable';
import { blankDdTrackerForm, ddTrackerFormFromEntry, toDdTrackerPayload, type DdTrackerFormState } from './ddTrackerForm';
import { DdAccountCodeTable, type AcctSortColumn } from './DdAccountCodeTable';
import { Toast } from '../common/Toast';
import { SearchIcon } from '../common/SearchIcon';
import { TrashIcon } from '../common/TrashIcon';
import { ConfirmDialog } from '../modals/ConfirmDialog';

import '../../pages/Tracker.css';
import './DdTracker.css';

const TABLE_KEY = 'dd_tracker';
const PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 150, 200];
const MIN_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_VESSEL = 'GCL NARMADA';

const TOTAL_PALETTES = 20;

const KNOWN_VESSEL_COLORS: Record<string, number> = {
  'GCL NARMADA': 0,    // Marine Sapphire Blue
  'GCL SABARMATI': 1,  // Emerald Sea Green
  'GCL SARASWATI': 2,  // Royal Indigo
  'GCL GANGA': 3,      // Tangerine Sunset Orange (distinct from Sabarmati's green)
  'GCL TAPI': 4,       // Warm Amber / Honey Gold
  'GCL YAMUNA': 5,     // Royal Violet / Amethyst
  'AMNS POLAR': 6,     // Electric Cyan / Turquoise
  'AMNSI STALLION': 7, // Royal Orchid / Deep Plum (vibrant jewel tone, distinct from Polar's cyan)
  'AMNS TUFMAX': 8,    // Warm Bronze / Sienna
  'AM TARANG': 9,      // Ocean Sky Cerulean
  'AMNSI MAXIMUS': 10, // Slate Steel / Graphite
  'GCL FOS': 11,       // Olive / Lime Moss
  'AM UMANG': 12,      // Rich Cobalt / Midnight Blue
  'AM KIRTI': 13,      // Antique Ochre / Dijon
};

// Computes a collision-free color index for every vessel currently in the list.
// Guaranteed: each vessel in the list receives a distinct, visually contrasting color,
// even when new vessels are dynamically added.
function computeVesselColorAssignment(vesselList: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  const used = new Set<number>();

  // Pass 1: Give known vessels their signature index if available
  for (const vessel of vesselList) {
    const key = vessel.trim().toUpperCase();
    const preferred = KNOWN_VESSEL_COLORS[key];
    if (preferred !== undefined && !used.has(preferred)) {
      result[key] = preferred;
      used.add(preferred);
    }
  }

  // Pass 2: For any vessel without an assigned color (new vessels or conflicting ones),
  // assign the next unused palette index
  let nextIdx = 0;
  for (const vessel of vesselList) {
    const key = vessel.trim().toUpperCase();
    if (result[key] === undefined) {
      while (used.has(nextIdx)) {
        nextIdx++;
      }
      result[key] = nextIdx;
      used.add(nextIdx);
    }
  }

  return result;
}

// For vessels beyond the 20 pre-defined CSS palettes, generates high-contrast HSL custom properties,
// safely skipping red hues (345° to 15°) to honor the project's visual constraints.
function getDynamicVesselStyle(colorIndex: number): React.CSSProperties | undefined {
  if (colorIndex < TOTAL_PALETTES) return undefined;
  const rawHue = (25 + (colorIndex - TOTAL_PALETTES) * 137.5) % 360;
  const safeHue = rawHue >= 345 || rawHue <= 15 ? (rawHue + 40) % 360 : rawHue;
  return {
    ['--v-bg-inactive' as string]: `hsl(${safeHue.toFixed(1)}, 85%, 97%)`,
    ['--v-border-inactive' as string]: `hsl(${safeHue.toFixed(1)}, 65%, 80%)`,
    ['--v-text-inactive' as string]: `hsl(${safeHue.toFixed(1)}, 85%, 26%)`,
    ['--v-bg-active' as string]: `linear-gradient(135deg, hsl(${safeHue.toFixed(1)}, 80%, 30%) 0%, hsl(${safeHue.toFixed(1)}, 85%, 45%) 100%)`,
    ['--v-border-active' as string]: `hsl(${safeHue.toFixed(1)}, 80%, 30%)`,
    ['--v-glow-active' as string]: `hsla(${safeHue.toFixed(1)}, 85%, 45%, 0.35)`,
    ['--v-dot-active' as string]: `hsl(${safeHue.toFixed(1)}, 90%, 65%)`,
  };
}

interface TableLayoutPreference {
  tableKey: string;
  columnOrder: string[];
  columnWidths: Record<string, number>;
  pageSize?: number | null;
}

function sanitizeColumnOrder(saved: string[] | null | undefined): ReorderableColumnKey[] {
  const known = new Set<string>(DEFAULT_COLUMN_ORDER);
  const filtered = (saved ?? []).filter((k): k is ReorderableColumnKey => known.has(k));
  const result: ReorderableColumnKey[] = [...filtered];
  // A column added to DEFAULT_COLUMN_ORDER after a user already saved their own layout (e.g. a
  // newly introduced column) isn't in `filtered` yet — insert it right after its nearest earlier
  // DEFAULT_COLUMN_ORDER neighbour that IS present, so it lands next to where it conceptually
  // belongs (e.g. next to PR Status) instead of always tacked onto the very end of an existing
  // saved layout.
  DEFAULT_COLUMN_ORDER.forEach((key, i) => {
    if (result.includes(key)) return;
    let insertAfterIndex = -1;
    for (let j = i - 1; j >= 0; j--) {
      const idx = result.indexOf(DEFAULT_COLUMN_ORDER[j]);
      if (idx !== -1) {
        insertAfterIndex = idx;
        break;
      }
    }
    result.splice(insertAfterIndex + 1, 0, key);
  });
  return result;
}

function sanitizeColumnWidths(saved: Record<string, number> | null | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(DEFAULT_COL_WIDTHS) as ReorderableColumnKey[]) {
    const sw = saved?.[key];
    result[key] = typeof sw === 'number' && sw >= 60 && sw <= 1000 ? sw : DEFAULT_COL_WIDTHS[key];
  }
  return result;
}

interface DdTrackerColumnFilters {
  entryType: string[];
  requisitionNo: string;
  poNo: string;
  readinessDateFrom: string;
  readinessDateTo: string;
}

function buildQueryParams(
  search: string,
  selectedVessel: string | null,
  columnFilters: DdTrackerColumnFilters,
  sortBy: SortColumn | null,
  sortDir: 'asc' | 'desc',
  page: number,
  pageSize: number
): URLSearchParams {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (selectedVessel) params.append('vessel_name', selectedVessel);
  columnFilters.entryType.forEach((v) => params.append('entry_type', v));
  if (columnFilters.requisitionNo) params.set('requisition_no', columnFilters.requisitionNo);
  if (columnFilters.poNo) params.set('po_no', columnFilters.poNo);
  if (columnFilters.readinessDateFrom) params.set('readiness_date_from', columnFilters.readinessDateFrom);
  if (columnFilters.readinessDateTo) params.set('readiness_date_to', columnFilters.readinessDateTo);
  if (sortBy) {
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
  }
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  return params;
}

export function DdTrackerPage() {
  const { canEdit } = useRole();
  const [showPoItemsView, setShowPoItemsView] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedVessel, setSelectedVessel] = useState<string | null>(DEFAULT_VESSEL);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [customPageSizeInput, setCustomPageSizeInput] = useState('');
  const [sortBy, setSortBy] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [entryTypeFilter, setEntryTypeFilter] = useState<string[]>([]);
  const [requisitionNoFilter, setRequisitionNoFilter] = useState('');
  const [poNoFilter, setPoNoFilter] = useState('');
  const [readinessDateFilter, setReadinessDateFilter] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const columnFilters: DdTrackerColumnFilters = {
    entryType: entryTypeFilter,
    requisitionNo: requisitionNoFilter,
    poNo: poNoFilter,
    readinessDateFrom: readinessDateFilter.from,
    readinessDateTo: readinessDateFilter.to,
  };

  const [layoutEditable, setLayoutEditable] = useState(false);
  const [savedColumnOrder, setSavedColumnOrder] = useState<ReorderableColumnKey[]>([...DEFAULT_COLUMN_ORDER]);
  const [savedColumnWidths, setSavedColumnWidths] = useState<Record<string, number>>({ ...DEFAULT_COL_WIDTHS });
  const [columnOrder, setColumnOrder] = useState<ReorderableColumnKey[]>([...DEFAULT_COLUMN_ORDER]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({ ...DEFAULT_COL_WIDTHS });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<ReorderableColumnKey | null>(null);
  const [editForm, setEditForm] = useState<DdTrackerFormState | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newRowForm, setNewRowForm] = useState<DdTrackerFormState>(blankDdTrackerForm());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);

  const queryClient = useQueryClient();
  const initializedRef = useRef(false);

  const tableLayoutQuery = useQuery({
    queryKey: ['table-layout', TABLE_KEY],
    queryFn: () => api.get<TableLayoutPreference | null>(`/table-layout/${TABLE_KEY}`),
  });

  useEffect(() => {
    if (tableLayoutQuery.data === undefined) return;
    const order = sanitizeColumnOrder(tableLayoutQuery.data?.columnOrder);
    const widths = sanitizeColumnWidths(tableLayoutQuery.data?.columnWidths);
    setSavedColumnOrder(order);
    setSavedColumnWidths(widths);
    setColumnOrder(order);
    setColumnWidths(widths);
    if (tableLayoutQuery.data?.pageSize && tableLayoutQuery.data.pageSize >= MIN_PAGE_SIZE && tableLayoutQuery.data.pageSize <= MAX_PAGE_SIZE) {
      setPageSize(tableLayoutQuery.data.pageSize);
    }
    initializedRef.current = true;
  }, [tableLayoutQuery.data]);

  const saveLayoutMutation = useMutation({
    mutationFn: () => api.put<TableLayoutPreference>(`/table-layout/${TABLE_KEY}`, { columnOrder, columnWidths, pageSize }),
    onSuccess: () => {
      setSavedColumnOrder(columnOrder);
      setSavedColumnWidths(columnWidths);
      setLayoutEditable(false);
    },
  });

  const savePageSizeMutation = useMutation({
    mutationFn: (size: number) =>
      api.put<TableLayoutPreference>(`/table-layout/${TABLE_KEY}`, { columnOrder, columnWidths, pageSize: size }),
  });

  function applyPageSize(size: number) {
    const clamped = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.round(size)));
    setPageSize(clamped);
    setPage(1);
    setCustomPageSizeInput('');
    savePageSizeMutation.mutate(clamped);
  }

  function startLayoutEdit() {
    setLayoutEditable(true);
  }
  function cancelLayoutEdit() {
    setColumnOrder(savedColumnOrder);
    setColumnWidths(savedColumnWidths);
    setLayoutEditable(false);
  }

  const vesselOptionsQuery = useQuery({
    queryKey: ['dd-tracker-vessel-options'],
    queryFn: () => api.get<string[]>('/dd-tracker/vessel-options'),
  });

  const vesselList = vesselOptionsQuery.data ?? [];
  const vesselColorMap = useMemo(() => computeVesselColorAssignment(vesselList), [vesselList]);

  const entriesQuery = useQuery({
    queryKey: ['dd-tracker', search, selectedVessel, columnFilters, sortBy, sortDir, page, pageSize],
    queryFn: () =>
      api.get<PaginatedResult<DdTrackerEntry>>(
        `/dd-tracker?${buildQueryParams(search, selectedVessel, columnFilters, sortBy, sortDir, page, pageSize).toString()}`
      ),
    placeholderData: keepPreviousData,
  });

  const totalPages = entriesQuery.data ? Math.max(1, Math.ceil(entriesQuery.data.total / pageSize)) : 1;
  const entries = entriesQuery.data?.items ?? [];

  // Selection is scoped to whatever's currently loaded (the current page/filter) — any change to
  // which rows are visible invalidates it, so a checkbox never silently refers to a row that's
  // since scrolled off-screen under a different filter/page/sort.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, selectedVessel, entryTypeFilter, requisitionNoFilter, poNoFilter, readinessDateFilter, sortBy, sortDir, page, pageSize]);

  function updateColumnFilter<T>(setter: (v: T) => void, value: T) {
    setPage(1);
    setter(value);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === entries.length ? new Set() : new Set(entries.map((e) => e.id))));
  }

  function handleSort(column: SortColumn) {
    if (sortBy === column) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortBy(null);
        setSortDir('asc');
      }
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
    setPage(1);
  }

  function selectVessel(vessel: string | null) {
    setPage(1);
    setSelectedVessel(vessel);
  }

  // Account Code view's own sort + Account Code column filter — lifted up here (rather than kept
  // local to DdAccountCodeTable) so the shared toolbar's "Export" button below can read them when
  // building that view's export URL, same reason "By PO"'s sort state already lives here.
  const [acctSortBy, setAcctSortBy] = useState<AcctSortColumn | null>(null);
  const [acctSortDir, setAcctSortDir] = useState<'asc' | 'desc'>('asc');
  const [acctAccountCodeFilter, setAcctAccountCodeFilter] = useState<string[]>([]);

  function handleAcctSort(column: AcctSortColumn) {
    if (acctSortBy === column) {
      if (acctSortDir === 'asc') {
        setAcctSortDir('desc');
      } else {
        setAcctSortBy(null);
        setAcctSortDir('asc');
      }
    } else {
      setAcctSortBy(column);
      setAcctSortDir('asc');
    }
  }

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Exports exactly the rows the current view's filters would return — same query params as that
  // view's own list fetch, minus pagination (the By PO view) since export returns every matching
  // row in one file. Each tab gets its own endpoint/filename, per the user's request for separate
  // download options for "By PO" vs. "By Account Code".
  async function handleExport() {
    setExportError(null);
    setIsExporting(true);
    try {
      let blob: Blob;
      let filename: string | null;
      if (showPoItemsView) {
        const params = new URLSearchParams();
        if (selectedVessel) params.append('vessel_name', selectedVessel);
        if (search) params.set('search', search);
        acctAccountCodeFilter.forEach((v) => params.append('account_code', v));
        if (acctSortBy) {
          params.set('sort_by', acctSortBy);
          params.set('sort_dir', acctSortDir);
        }
        ({ blob, filename } = await api.getBlob(`/dd-tracker/account-code-analysis/export?${params.toString()}`));
      } else {
        const params = buildQueryParams(search, selectedVessel, columnFilters, sortBy, sortDir, page, pageSize);
        params.delete('page');
        params.delete('page_size');
        ({ blob, filename } = await api.getBlob(`/dd-tracker/export?${params.toString()}`));
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? (showPoItemsView ? 'DD_Tracker_By_Account_Code.xlsx' : 'DD_Tracker_By_PO.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Failed to export.');
    } finally {
      setIsExporting(false);
    }
  }

  // Cell-level edit: double-clicking a different field within the SAME row just switches which
  // one shows an input (editForm already holds the whole row, so anything typed into a previous
  // field in this session isn't lost); double-clicking a field in a DIFFERENT row starts fresh.
  function startCellEdit(entry: DdTrackerEntry, field: ReorderableColumnKey) {
    setSaveError(null);
    if (editingId !== entry.id) {
      setEditingId(entry.id);
      setEditForm(ddTrackerFormFromEntry(entry));
    }
    setEditingField(field);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingField(null);
    setEditForm(null);
  }
  function handleEditFormChange(field: keyof DdTrackerFormState, value: string) {
    setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  // Takes both the row id and the form explicitly as the mutate() argument, rather than reading
  // editingId/editForm from render closure inside mutationFn — a dropdown field's "pick a value
  // and save immediately" path (see selectAndSave) now also fires a dropdown-close callback in
  // the same click (see DdTrackerTable.tsx's onClose), which clears editingId via setEditingId
  // (batched with the save's own state updates into the same React render). If mutationFn read
  // editingId from closure, that render could land before the in-flight fetch actually reads the
  // id, sending a PATCH to "/dd-tracker/null" — passing the id as an explicit argument captures it
  // at the moment mutate() is called instead, immune to anything that happens afterward.
  const saveEditMutation = useMutation({
    mutationFn: ({ id, form }: { id: string; form: DdTrackerFormState }) =>
      api.patch<DdTrackerEntry>(`/dd-tracker/${id}`, toDdTrackerPayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dd-tracker'] });
      queryClient.invalidateQueries({ queryKey: ['dd-tracker-vessel-options'] });
      setEditingId(null);
      setEditingField(null);
      setEditForm(null);
    },
    onError: (err) => setSaveError(err instanceof ApiError ? err.message : 'Failed to save DD Tracker entry.'),
  });

  // A dropdown field (Type, Invoice Type) doesn't need a separate Save click — picking a value is
  // already the complete action, unlike a text field where you might still be typing.
  function selectAndSave(field: keyof DdTrackerFormState, value: string) {
    if (!editForm || !editingId) return;
    const updated = { ...editForm, [field]: value };
    setEditForm(updated);
    saveEditMutation.mutate({ id: editingId, form: updated });
  }

  function startAdd() {
    setSaveError(null);
    setNewRowForm(blankDdTrackerForm());
    setIsAddingNew(true);
  }
  function cancelAdd() {
    setIsAddingNew(false);
  }
  function handleNewRowChange(field: keyof DdTrackerFormState, value: string) {
    setNewRowForm((prev) => ({ ...prev, [field]: value }));
  }

  const saveNewMutation = useMutation({
    mutationFn: () => api.post<DdTrackerEntry>('/dd-tracker', toDdTrackerPayload(newRowForm)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dd-tracker'] });
      queryClient.invalidateQueries({ queryKey: ['dd-tracker-vessel-options'] });
      setIsAddingNew(false);
    },
    onError: (err) => setSaveError(err instanceof ApiError ? err.message : 'Failed to add DD Tracker entry.'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.post<{ deletedCount: number }>('/dd-tracker/bulk-delete', { ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dd-tracker'] });
      queryClient.invalidateQueries({ queryKey: ['dd-tracker-vessel-options'] });
      setSelectedIds(new Set());
      setConfirmingBulkDelete(false);
    },
    onError: (err) => {
      setConfirmingBulkDelete(false);
      setSaveError(err instanceof ApiError ? err.message : 'Failed to delete the selected DD Tracker entries.');
    },
  });

  return (
    <div className="tracker-page dd-tracker-page">
      <div className="tracker-page-header">
        <h1 className="tracker-page-title">DD Tracker</h1>
        <div className="tracker-page-count">
          <span className="count-number">{entriesQuery.data?.total ?? 0}</span>
          <span className="count-label">Entries</span>
        </div>
      </div>

      <p className="dd-tracker-auto-note">
        Entries for every "DD" category PR/PO, plus any other PR/PO whose own title starts with "DD", are added
        automatically from the SmartPAL scrape (twice daily). Use "Add Entry" — with the PR/PO Number lookup — only
        for items that need tracking here but SmartPAL neither categorizes nor titles as DD.
      </p>

      {/* Vessel Filter Capsules - Always available at top */}
      <div className="dd-tracker-vessel-capsules">
        <div className="dd-tracker-vessel-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20a6 6 0 0 0 12 0 6 6 0 0 0 10 0"/><path d="m4 16 1.5-6h13l1.5 6"/><path d="M10 10V4h4v6"/></svg>
          <span>Vessels</span>
        </div>
        <button
          type="button"
          className={`dd-tracker-vessel-capsule${selectedVessel === null ? ' active' : ''}`}
          onClick={() => selectVessel(null)}
        >
          All Vessels
        </button>
        {vesselList.map((vessel) => {
          const colorIndex = vesselColorMap[vessel.trim().toUpperCase()] ?? 0;
          const colorClass = colorIndex < TOTAL_PALETTES ? `vessel-color-${colorIndex}` : '';
          const dynamicStyle = getDynamicVesselStyle(colorIndex);

          return (
            <button
              key={vessel}
              type="button"
              className={`dd-tracker-vessel-capsule ${colorClass}${vessel === selectedVessel ? ' active' : ''}`}
              style={dynamicStyle}
              onClick={() => selectVessel(vessel)}
            >
              {vessel}
            </button>
          );
        })}
      </div>
      <div className="tracker-toolbar">
        <div className="tracker-search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder={showPoItemsView ? 'Search PO number, account code, item description…' : 'Search PR/PO number, vessel, title, remarks…'}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="tracker-toolbar-spacer" />
        <button className="btn-tracker-action btn-tracker-secondary" onClick={handleExport} disabled={isExporting}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {isExporting ? 'Exporting…' : showPoItemsView ? 'Export By Account Code' : 'Export By PO'}
        </button>
        {!showPoItemsView && canEdit && (
          <>
            {selectedIds.size > 0 && (
              <button
                className="btn-tracker-action btn-tracker-danger"
                onClick={() => setConfirmingBulkDelete(true)}
                disabled={bulkDeleteMutation.isPending || layoutEditable}
              >
                <TrashIcon />
                Delete Selected ({selectedIds.size})
              </button>
            )}
            <button
              className="btn-tracker-action btn-tracker-primary"
              onClick={startAdd}
              disabled={isAddingNew || editingId !== null || layoutEditable}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Entry
            </button>
            {layoutEditable ? (
              <div className="tracker-layout-edit-group">
                <button className="btn-tracker-action btn-tracker-success" onClick={() => saveLayoutMutation.mutate()} disabled={saveLayoutMutation.isPending}>
                  {saveLayoutMutation.isPending ? 'Saving…' : 'Save Layout'}
                </button>
                <button className="btn-tracker-action btn-tracker-secondary" onClick={cancelLayoutEdit}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn-tracker-action btn-tracker-secondary"
                onClick={startLayoutEdit}
                disabled={isAddingNew || editingId !== null}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                Edit Layout
              </button>
            )}
          </>
        )}

        {/* Tab switch near Edit Layout button */}
        <div className="tracker-view-tabs">
          <button
            type="button"
            className={`tracker-view-tab ${!showPoItemsView ? 'active' : ''}`}
            onClick={() => setShowPoItemsView(false)}
          >
            By PO
          </button>
          <button
            type="button"
            className={`tracker-view-tab ${showPoItemsView ? 'active' : ''}`}
            onClick={() => setShowPoItemsView(true)}
          >
            By Account Code
          </button>
        </div>
      </div>

      {showPoItemsView ? (
        <DdAccountCodeTable
          canEdit={canEdit}
          selectedVessel={selectedVessel}
          search={search}
          sortBy={acctSortBy}
          sortDir={acctSortDir}
          onSort={handleAcctSort}
          accountCodeFilter={acctAccountCodeFilter}
          onAccountCodeFilterChange={(values) => setAcctAccountCodeFilter(values)}
        />
      ) : entriesQuery.isLoading ? (
        <div className="tracker-table-card">
          <div className="tracker-loading">
            <div className="tracker-loading-spinner" />
            <div>Loading DD Tracker entries…</div>
          </div>
        </div>
      ) : entriesQuery.isError ? (
        <div className="tracker-table-card">
          <div className="tracker-error">Failed to load DD Tracker entries.</div>
        </div>
      ) : (
        <>
          <div className="tracker-table-shell">
            <DdTrackerTable
              entries={entries}
              page={page}
              pageSize={pageSize}
              canEdit={canEdit}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
              entryTypeFilter={entryTypeFilter}
              onEntryTypeFilterChange={(values) => updateColumnFilter(setEntryTypeFilter, values)}
              requisitionNoFilter={requisitionNoFilter}
              onRequisitionNoFilterChange={(value) => updateColumnFilter(setRequisitionNoFilter, value)}
              poNoFilter={poNoFilter}
              onPoNoFilterChange={(value) => updateColumnFilter(setPoNoFilter, value)}
              readinessDateFilter={readinessDateFilter}
              onReadinessDateFilterChange={(value) => updateColumnFilter(setReadinessDateFilter, value)}
              editingId={editingId}
              editingField={editingField}
              editForm={editForm}
              isSavingEdit={saveEditMutation.isPending}
              onStartCellEdit={startCellEdit}
              onEditFormChange={handleEditFormChange}
              onSaveEdit={() => editForm && editingId && saveEditMutation.mutate({ id: editingId, form: editForm })}
              onSelectAndSave={selectAndSave}
              onCancelEdit={cancelEdit}
              isAddingNew={isAddingNew}
              newRowForm={newRowForm}
              isSavingNew={saveNewMutation.isPending}
              onNewRowChange={handleNewRowChange}
              onSaveNew={() => saveNewMutation.mutate()}
              onCancelNew={cancelAdd}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              columnOrder={columnOrder}
              columnWidths={columnWidths}
              layoutEditable={layoutEditable}
              onReorderColumn={setColumnOrder}
              onResizeColumn={(key, width) => setColumnWidths((prev) => ({ ...prev, [key]: width }))}
            />
          </div>
          <div className="tracker-pagination">
            {/* LEFT: Page Size Control */}
            <div className="pagination-left">
              <span className="pagination-label">Rows per page:</span>
              <div className="pagination-size-pill">
                <select
                  className="pagination-select"
                  value={PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : ''}
                  onChange={(e) => {
                    if (e.target.value) applyPageSize(Number(e.target.value));
                  }}
                >
                  {!PAGE_SIZE_OPTIONS.includes(pageSize) && <option value="">{pageSize} (custom)</option>}
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <div className="pagination-custom">
                  <input
                    type="number"
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
                    onClick={() => customPageSizeInput && applyPageSize(Number(customPageSizeInput))}
                    disabled={!customPageSizeInput}
                  >
                    Set
                  </button>
                </div>
              </div>
            </div>

            {/* CENTER: Navigation */}
            <div className="pagination-center">
              <button className="pagination-nav-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} title="Previous Page">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div className="pagination-current">
                Page <strong>{page}</strong> of {totalPages}
              </div>
              <button className="pagination-nav-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} title="Next Page">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>

            {/* RIGHT: Total Info */}
            <div className="pagination-right">
              <span className="pagination-total">
                {entriesQuery.data ? (
                  <><strong>{entriesQuery.data.total.toLocaleString()}</strong> entries found</>
                ) : (
                  '...'
                )}
              </span>
            </div>
          </div>
        </>
      )}

      {saveError && <Toast type="error" message={saveError} onClose={() => setSaveError(null)} duration={5000} />}
      {exportError && <Toast type="error" message={exportError} onClose={() => setExportError(null)} duration={5000} />}

      {confirmingBulkDelete && (
        <ConfirmDialog
          title="Delete DD Tracker Entries"
          message={`Delete ${selectedIds.size} selected entr${selectedIds.size === 1 ? 'y' : 'ies'}? This cannot be undone.`}
          isConfirming={bulkDeleteMutation.isPending}
          onConfirm={() => bulkDeleteMutation.mutate([...selectedIds])}
          onCancel={() => setConfirmingBulkDelete(false)}
        />
      )}
    </div>
  );
}
