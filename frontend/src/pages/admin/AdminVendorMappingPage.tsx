import { useEffect, useState } from 'react';
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
        <select value={department} onChange={(e) => setDepartment(e.target.value as Department | 'ALL')}>
          <option value="ALL">All departments</option>
          {Object.values(Department).map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABELS[d]}
            </option>
          ))}
        </select>
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
