import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { DEPARTMENT_LABELS, Department, type VendorMapping, type VendorMappingHealthCheck } from '../../shared';
import { VendorMappingModal } from '../../components/modals/VendorMappingModal';
import { VendorMappingImportWizardModal } from '../../components/modals/VendorMappingImportWizardModal';
import { TrashIcon } from '../../components/common/TrashIcon';
import { EditIcon } from '../../components/common/EditIcon';
import { SearchIcon } from '../../components/common/SearchIcon';
import { formatDate } from '../../lib/format';

interface DropdownOption {
  value: string;
  label: string;
}

function DepartmentFilterDropdown({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

  function updatePosition() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    // Prefer opening downward (like a native select); only flip up when there is almost no room below.
    const openUp = spaceBelow < 100 && spaceAbove > spaceBelow;
    setPos({
      left: r.left,
      width: r.width,
      maxHeight: Math.min(280, openUp ? spaceAbove : spaceBelow),
      ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }

  function openPanel() {
    const idx = options.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
    setOpen(true);
  }

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (open) updatePosition();
    else setPos(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  // Bring the selected/active row into view whenever the panel opens or the active row changes.
  useEffect(() => {
    if (!open || !pos) return;
    panelRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, pos !== null]);

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[activeIndex].value);
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`mailbox-dropdown-trigger${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="mailbox-dropdown-value">{selected?.label}</span>
        <svg className="mailbox-dropdown-caret" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="mailbox-dropdown-panel"
            role="listbox"
            style={{
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              top: pos.top,
              bottom: pos.bottom,
            }}
          >
            {options.map((o, i) => (
              <div
                key={o.value || 'none'}
                role="option"
                aria-selected={o.value === value}
                data-active={i === activeIndex}
                className={`mailbox-dropdown-option${o.value === value ? ' selected' : ''}${i === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => choose(o.value)}
              >
                {o.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export function AdminVendorMappingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalMapping, setModalMapping] = useState<VendorMapping | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState<Department | 'ALL'>('ALL');
  const queryClient = useQueryClient();

  const mappingsQuery = useQuery({
    queryKey: ['admin-vendor-mapping'],
    queryFn: () => api.get<VendorMapping[]>('/vendor-mapping?include_inactive=true'),
  });

  // Permanent fix for the "Manning vendor mapped but spelled slightly differently from what
  // SmartPAL actually scraped" class of bug (e.g. "Manish travels" vs SmartPAL's real "Manish
  // Travels & Tours") — surfaces every active mapping with zero matching PIR invoices, plus
  // fuzzy-suggested real PIR vendor names to rename to, so this gets caught proactively instead
  // of relying on someone noticing a misclassified invoice by chance.
  const healthQuery = useQuery({
    queryKey: ['vendor-mapping-health'],
    queryFn: () => api.get<VendorMappingHealthCheck>('/vendor-mapping/health-check'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (mapping: VendorMapping) =>
      api.patch<VendorMapping>(`/vendor-mapping/${mapping.id}`, { active: !mapping.active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-vendor-mapping'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ mappingId, vendorName }: { mappingId: string; vendorName: string }) =>
      api.patch<VendorMapping>(`/vendor-mapping/${mappingId}`, { vendorName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-vendor-mapping'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-mapping-health'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });

  function handleDelete(mapping: VendorMapping) {
    const verb = mapping.active ? 'Deactivate' : 'Reactivate';
    if (window.confirm(`${verb} ${mapping.vendorName}?`)) {
      deactivateMutation.mutate(mapping);
    }
  }

  const filtered = (mappingsQuery.data ?? []).filter((m) => {
    if (department !== 'ALL' && m.department !== department) return false;
    if (search && !m.vendorName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <div className="admin-page-header">
        <div>
          <div className="admin-title-row">
            <h1 className="admin-page-title">Vendor Mapping</h1>
            <div className="admin-page-count">
              <span className="count-number">{mappingsQuery.data ? filtered.length : 0}</span>
              <span className="count-label">Vendor Mappings</span>
            </div>
          </div>
        </div>
        <div className="admin-btn-group">
          <button className="admin-btn-secondary" onClick={() => setIsImporting(true)}>
            ⇧ Import from Excel
          </button>
          <button className="admin-btn-primary" onClick={() => setIsAdding(true)}>
            + Add New Vendor
          </button>
        </div>
      </div>

      <div className="admin-page-body">

      {/* Mapping health check — see healthQuery comment above. Default expanded via native
          <details>/<summary>, same pattern PIRPage.tsx already uses for collapsible sections. */}
      {healthQuery.data && healthQuery.data.unmatchedCount > 0 && (
        <details
          className="admin-health-card"
          open
        >
          <summary className="admin-health-summary">
            {healthQuery.data.unmatchedCount} Manning mapping{healthQuery.data.unmatchedCount === 1 ? '' : 's'} with no matching PIR invoices — possible spelling mismatch
          </summary>
          <div className="admin-health-content">
            <p style={{ marginTop: 0, fontSize: 13, color: '#991B1B', opacity: 0.8 }}>
              Zero matches isn't necessarily a problem — the vendor may just have no open PIR invoices right now.
              Suggestions below are fuzzy-matched real PIR vendor names; review before applying.
            </p>
            {healthQuery.data.issues.map((issue) => (
              <div
                key={issue.mappingId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  padding: '12px 0',
                  borderTop: '1px solid rgba(252, 165, 165, 0.5)',
                }}
              >
                <strong style={{ fontSize: 13, color: '#7F1D1D' }}>{issue.vendorName}</strong>
                <span style={{ fontSize: 12, opacity: 0.7 }}>({DEPARTMENT_LABELS[issue.department]})</span>
                {issue.candidates.length === 0 ? (
                  <span style={{ fontSize: 12, opacity: 0.7 }}>— no similar PIR vendor found</span>
                ) : (
                  issue.candidates.map((c) => (
                    <button
                      key={c.vendorName}
                      type="button"
                      className="admin-btn-secondary"
                      style={{ fontSize: 12, padding: '4px 10px', height: 'auto', background: '#FFFFFF', borderColor: '#FCA5A5' }}
                      disabled={renameMutation.isPending}
                      onClick={() => renameMutation.mutate({ mappingId: issue.mappingId, vendorName: c.vendorName })}
                      title={`Rename this mapping to exactly match the real PIR vendor name`}
                    >
                      Rename to "{c.vendorName}" ({c.invoiceCount})
                    </button>
                  ))
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="toolbar-row" style={{ marginBottom: 14 }}>
        <div className="search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search vendor name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <DepartmentFilterDropdown
          value={department}
          onChange={(v) => setDepartment(v as Department | 'ALL')}
          options={[
            { value: 'ALL', label: 'All departments' },
            ...Object.values(Department).map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] })),
          ]}
        />
      </div>

      <div className="admin-card admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Vendor Name</th>
              <th>Department</th>
              <th>Active</th>
              <th>Created</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id}>
                <td>{m.vendorName}</td>
                <td>{DEPARTMENT_LABELS[m.department]}</td>
                <td>
                  <span className={`admin-badge ${m.active ? 'active' : 'inactive'}`}>
                    {m.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>{formatDate(m.createdAt)}</td>
                <td style={{ textAlign: 'center' }}>
                  <div className="admin-row-actions">
                    <button className="admin-action-btn" title="Edit" onClick={() => setModalMapping(m)}>
                      <EditIcon />
                    </button>
                    <button
                      className={`admin-action-btn${m.active ? ' danger' : ''}`}
                      title={m.active ? 'Deactivate' : 'Reactivate'}
                      onClick={() => handleDelete(m)}
                      disabled={deactivateMutation.isPending}
                    >
                      {m.active ? <TrashIcon /> : '↺'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      {(isAdding || modalMapping) && (
        <VendorMappingModal
          mapping={modalMapping}
          onClose={() => {
            setIsAdding(false);
            setModalMapping(null);
          }}
        />
      )}

      {isImporting && <VendorMappingImportWizardModal onClose={() => setIsImporting(false)} />}
    </>
  );
}