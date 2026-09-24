import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Vendor } from '../../shared';
import { VendorModal } from '../../components/modals/VendorModal';
import { useAdminCreateModal } from './AdminCreateModalContext';

export function AdminVendorsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalVendor, setModalVendor] = useState<Vendor | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const { setIsVendorsCreateOpen } = useAdminCreateModal();

  const vendorsQuery = useQuery({
    queryKey: ['admin-vendors'],
    queryFn: () => api.get<Vendor[]>('/vendors?include_inactive=true'),
  });

  useEffect(() => {
    setIsVendorsCreateOpen(isAdding);
    return () => setIsVendorsCreateOpen(false);
  }, [isAdding, setIsVendorsCreateOpen]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setIsAdding(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Vendor Management</h1>
          <p>{vendorsQuery.data ? `${vendorsQuery.data.length} vendors` : 'Loading…'}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
          + Add New Vendor
        </button>
      </div>

      <div className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Vendor Name</th>
              <th>Email</th>
              <th style={{ textAlign: 'center' }}>Active</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(vendorsQuery.data ?? []).map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td>{v.email ?? '—'}</td>
                <td style={{ textAlign: 'center' }}>{v.isActive ? 'Yes' : 'No'}</td>
                <td style={{ textAlign: 'center' }}>
                  <div className="row-actions">
                    <button className="icon-btn" title="Edit" onClick={() => setModalVendor(v)}>
                      ✎
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    </div>
  );
}
