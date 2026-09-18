import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { DEPARTMENT_LABELS, Department, type VendorMapping, type VendorMappingHealthCheck } from '../../shared';
import { VendorMappingModal } from '../../components/modals/VendorMappingModal';
import { VendorMappingImportWizardModal } from '../../components/modals/VendorMappingImportWizardModal';
import { TrashIcon } from '../../components/common/TrashIcon';
import { SearchIcon } from '../../components/common/SearchIcon';
import { formatDate } from '../../lib/format';
import { useAdminCreateModal } from './AdminCreateModalContext';

export function AdminVendorMappingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalMapping, setModalMapping] = useState<VendorMapping | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState<Department | 'ALL'>('ALL');
  const { setIsVendorMappingCreateOpen } = useAdminCreateModal();
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

  // Mirrors isAdding into shared context so the sidebar's "+ Create Vendor Mapping" link
  // highlights only while this modal is actually open — reset on unmount too, so navigating
  // away while it's open (e.g. clicking "Back to Tracker") doesn't leave a stale highlight.
  useEffect(() => {
    setIsVendorMappingCreateOpen(isAdding);
    return () => setIsVendorMappingCreateOpen(false);
  }, [isAdding, setIsVendorMappingCreateOpen]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setIsAdding(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
    <div>
      <div className="page-header">
        <div>
          <h1>Vendor Mapping</h1>
          <p>{mappingsQuery.data ? `${filtered.length} vendors` : 'Loading…'}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => setIsImporting(true)}>
            ⇧ Import from Excel
          </button>
          <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
            + Add New Vendor
          </button>
        </div>
      </div>

      {/* Mapping health check — see healthQuery comment above. Default expanded via native
          <details>/<summary>, same pattern PIRPage.tsx already uses for collapsible sections. */}
      {healthQuery.data && healthQuery.data.unmatchedCount > 0 && (
        <details
          className="card"
          open
          style={{ marginBottom: 14, padding: 0, overflow: 'hidden', border: '1px solid var(--color-danger)' }}
        >
          <summary
            style={{
              cursor: 'pointer',
              padding: '12px 16px',
              fontWeight: 600,
              color: 'var(--color-danger)',
              background: 'var(--color-danger-bg)',
            }}
          >
            {healthQuery.data.unmatchedCount} Manning mapping{healthQuery.data.unmatchedCount === 1 ? '' : 's'} with no
            matching PIR invoices — possible spelling mismatch
          </summary>
          <div style={{ padding: '12px 16px' }}>
            <p style={{ marginTop: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Zero matches isn't necessarily a problem — the vendor may just have no open PIR invoices right now.
              Suggestions below are fuzzy-matched real PIR vendor names; review before applying, some will be
              unrelated vendors that just share a common word.
            </p>
            {healthQuery.data.issues.map((issue) => (
              <div
                key={issue.mappingId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  padding: '8px 0',
                  borderTop: '1px solid var(--color-border)',
                }}
              >
                <strong style={{ fontSize: 13 }}>{issue.vendorName}</strong>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>({DEPARTMENT_LABELS[issue.department]})</span>
                {issue.candidates.length === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>— no similar PIR vendor found</span>
                ) : (
                  issue.candidates.map((c) => (
                    <button
                      key={c.vendorName}
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '4px 10px' }}
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
        <select value={department} onChange={(e) => setDepartment(e.target.value as Department | 'ALL')}>
          <option value="ALL">All departments</option>
          {Object.values(Department).map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABELS[d]}
            </option>
          ))}
        </select>
      </div>

      <div className="card table-scroll">
        <table className="data-table">
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
                  <span
                    className="status-badge"
                    style={
                      m.active
                        ? { background: 'var(--color-success-bg)', color: 'var(--color-success)' }
                        : { background: 'var(--color-neutral-bg)', color: 'var(--color-neutral)' }
                    }
                  >
                    {m.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>{formatDate(m.createdAt)}</td>
                <td style={{ textAlign: 'center' }}>
                  <div className="row-actions">
                    <button className="icon-btn" title="Edit" onClick={() => setModalMapping(m)}>
                      ✎
                    </button>
                    <button
                      className={`icon-btn${m.active ? ' icon-btn-danger' : ''}`}
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
    </div>
  );
}
