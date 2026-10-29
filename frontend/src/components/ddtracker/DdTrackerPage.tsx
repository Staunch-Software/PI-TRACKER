import { useEffect, useRef, useState } from 'react';
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
import { Toast } from '../common/Toast';
import { SearchIcon } from '../common/SearchIcon';

import '../../pages/Tracker.css';
import './DdTracker.css';

const TABLE_KEY = 'dd_tracker';
const PAGE_SIZE = 50;
const DEFAULT_VESSEL = 'GCL NARMADA';

interface TableLayoutPreference {
  tableKey: string;
  columnOrder: string[];
  columnWidths: Record<string, number>;
}

function sanitizeColumnOrder(saved: string[] | null | undefined): ReorderableColumnKey[] {
  const known = new Set<string>(DEFAULT_COLUMN_ORDER);
  const filtered = (saved ?? []).filter((k): k is ReorderableColumnKey => known.has(k));
  const missing = DEFAULT_COLUMN_ORDER.filter((k) => !filtered.includes(k));
  return [...filtered, ...missing];
}

function sanitizeColumnWidths(saved: Record<string, number> | null | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(DEFAULT_COL_WIDTHS) as ReorderableColumnKey[]) {
    const sw = saved?.[key];
    result[key] = typeof sw === 'number' && sw >= 60 && sw <= 1000 ? sw : DEFAULT_COL_WIDTHS[key];
  }
  return result;
}

function buildQueryParams(
  search: string,
  selectedVessel: string,
  sortBy: SortColumn | null,
  sortDir: 'asc' | 'desc',
  page: number
): URLSearchParams {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (selectedVessel) params.append('vessel_name', selectedVessel);
  if (sortBy) {
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
  }
  params.set('page', String(page));
  params.set('page_size', String(PAGE_SIZE));
  return params;
}

export function DdTrackerPage() {
  const { canEdit } = useRole();
  const [search, setSearch] = useState('');
  const [selectedVessel, setSelectedVessel] = useState<string>(DEFAULT_VESSEL);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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
    initializedRef.current = true;
  }, [tableLayoutQuery.data]);

  const saveLayoutMutation = useMutation({
    mutationFn: () => api.put<TableLayoutPreference>(`/table-layout/${TABLE_KEY}`, { columnOrder, columnWidths }),
    onSuccess: () => {
      setSavedColumnOrder(columnOrder);
      setSavedColumnWidths(columnWidths);
      setLayoutEditable(false);
    },
  });

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

  const entriesQuery = useQuery({
    queryKey: ['dd-tracker', search, selectedVessel, sortBy, sortDir, page],
    queryFn: () =>
      api.get<PaginatedResult<DdTrackerEntry>>(`/dd-tracker?${buildQueryParams(search, selectedVessel, sortBy, sortDir, page).toString()}`),
    placeholderData: keepPreviousData,
  });

  const totalPages = entriesQuery.data ? Math.max(1, Math.ceil(entriesQuery.data.total / PAGE_SIZE)) : 1;

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

  function selectVessel(vessel: string) {
    setPage(1);
    setSelectedVessel(vessel);
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

  // Takes the form explicitly (rather than reading editForm from closure) so a dropdown's
  // "pick a value and save immediately" path (see onSelectAndSave) can save the field it just
  // changed without waiting a render for setEditForm to land first.
  const saveEditMutation = useMutation({
    mutationFn: (form: DdTrackerFormState) => api.patch<DdTrackerEntry>(`/dd-tracker/${editingId}`, toDdTrackerPayload(form)),
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
    if (!editForm) return;
    const updated = { ...editForm, [field]: value };
    setEditForm(updated);
    saveEditMutation.mutate(updated);
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
        Entries for every "DD" category PR/PO are added automatically from the SmartPAL scrape (twice daily). Use
        "Add Entry" only for items that need tracking here but aren't DD-categorized in SmartPAL (e.g. OPEX).
      </p>
      <div className="dd-tracker-vessel-capsules">
        {(vesselOptionsQuery.data ?? []).map((vessel) => (
          <button
            key={vessel}
            type="button"
            className={`dd-tracker-vessel-capsule${vessel === selectedVessel ? ' active' : ''}`}
            onClick={() => selectVessel(vessel)}
          >
            {vessel}
          </button>
        ))}
      </div>
      <div className="tracker-toolbar">
        <div className="tracker-search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search PR/PO number, vessel, title, remarks…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="tracker-toolbar-spacer" />
        {canEdit && (
          <>
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
      </div>

      {entriesQuery.isLoading ? (
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
              entries={entriesQuery.data?.items ?? []}
              canEdit={canEdit}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
              editingId={editingId}
              editingField={editingField}
              editForm={editForm}
              isSavingEdit={saveEditMutation.isPending}
              onStartCellEdit={startCellEdit}
              onEditFormChange={handleEditFormChange}
              onSaveEdit={() => editForm && saveEditMutation.mutate(editForm)}
              onSelectAndSave={selectAndSave}
              onCancelEdit={cancelEdit}
              isAddingNew={isAddingNew}
              newRowForm={newRowForm}
              isSavingNew={saveNewMutation.isPending}
              onNewRowChange={handleNewRowChange}
              onSaveNew={() => saveNewMutation.mutate()}
              onCancelNew={cancelAdd}
              columnOrder={columnOrder}
              columnWidths={columnWidths}
              layoutEditable={layoutEditable}
              onReorderColumn={setColumnOrder}
              onResizeColumn={(key, width) => setColumnWidths((prev) => ({ ...prev, [key]: width }))}
            />
          </div>
          <div className="tracker-pagination">
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
    </div>
  );
}
