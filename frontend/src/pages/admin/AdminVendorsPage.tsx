import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Vendor } from '../../shared';
import { VendorModal } from '../../components/modals/VendorModal';
import { EditIcon } from '../../components/common/EditIcon';

export function AdminVendorsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalVendor, setModalVendor] = useState<Vendor | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const vendorsQuery = useQuery({
    queryKey: ['admin-vendors'],
    queryFn: () => api.get<Vendor[]>('/vendors?include_inactive=true'),
  });

  return (
    <>
      <div className="admin-page-header">
        <div>
          <div className="admin-title-row">
            <h1 className="admin-page-title">Vendor Management</h1>
            <div className="admin-page-count">
              <span className="count-number">{vendorsQuery.data ? vendorsQuery.data.length : 0}</span>
              <span className="count-label">Vendors</span>
            </div>
          </div>
        </div>
        <button className="admin-btn-primary" onClick={() => setIsAdding(true)}>+ Add New Vendor</button>
      </div>

      <div className="admin-page-body">
        <div className="admin-card admin-table-wrapper">
          <table className="admin-table">
          <thead>
            <tr>
              <th>Vendor Name</th>
              <th>Email</th>
              <th style={{ textAlign: 'center' }}>Status</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(vendorsQuery.data ?? []).map((v) => (
              <tr key={v.id}>
                <td><strong>{v.name}</strong></td>
                <td style={{ color: '#6B7280' }}>{v.email ?? '—'}</td>
                <td style={{ textAlign: 'center' }}>
                  <span className={`admin-badge ${v.isActive ? 'active' : 'inactive'}`}>
                    {v.isActive ? '● Active' : '○ Inactive'}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div className="admin-row-actions">
                    <button className="admin-action-btn" title="Edit" onClick={() => setModalVendor(v)}>
                      <EditIcon />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      {(isAdding || modalVendor) && (
        <VendorModal
          vendor={modalVendor}
          onClose={() => {
            setIsAdding(false);
            setModalVendor(null);
          }}
        />
      )}
    </>
  );
}
