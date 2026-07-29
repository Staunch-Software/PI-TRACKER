import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Vessel } from '../../shared';
import { VesselModal } from '../../components/modals/VesselModal';
import { TrashIcon } from '../../components/common/TrashIcon';
import { useAdminCreateModal } from './AdminCreateModalContext';

export function AdminVesselsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalVessel, setModalVessel] = useState<Vessel | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const { setIsVesselsCreateOpen } = useAdminCreateModal();
  const queryClient = useQueryClient();

  const vesselsQuery = useQuery({
    queryKey: ['admin-vessels'],
    queryFn: () => api.get<Vessel[]>('/vessels?include_inactive=true'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (vessel: Vessel) => api.patch<Vessel>(`/vessels/${vessel.id}`, { isActive: !vessel.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-vessels'] });
      queryClient.invalidateQueries({ queryKey: ['vessels'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });

  // Mirrors isAdding into shared context so the sidebar's "+ Create Vessel" link can highlight
  // only while this modal is actually open — reset on unmount too, so navigating away while
  // it's open (e.g. clicking "Back to Tracker") doesn't leave a stale highlight behind.
  useEffect(() => {
    setIsVesselsCreateOpen(isAdding);
    return () => setIsVesselsCreateOpen(false);
  }, [isAdding, setIsVesselsCreateOpen]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setIsAdding(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function handleDelete(vessel: Vessel) {
    const verb = vessel.isActive ? 'Deactivate' : 'Reactivate';
    if (window.confirm(`${verb} ${vessel.name}?`)) {
      deactivateMutation.mutate(vessel);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Vessel Management</h1>
          <p>{vesselsQuery.data ? `${vesselsQuery.data.length} vessels` : 'Loading…'}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
          + Add New Vessel
        </button>
      </div>

      <div className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Vessel Name</th>
              <th>IMO Number</th>
              <th>Status</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(vesselsQuery.data ?? []).map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td>{v.imoNumber ?? '—'}</td>
                <td>
                  <span
                    className="status-badge"
                    style={
                      v.isActive
                        ? { background: 'var(--color-success-bg)', color: 'var(--color-success)' }
                        : { background: 'var(--color-neutral-bg)', color: 'var(--color-neutral)' }
                    }
                  >
                    {v.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div className="row-actions">
                    <button className="icon-btn" title="Edit" onClick={() => setModalVessel(v)}>
                      ✎
                    </button>
                    <button
                      className={`icon-btn${v.isActive ? ' icon-btn-danger' : ''}`}
                      title={v.isActive ? 'Deactivate' : 'Reactivate'}
                      onClick={() => handleDelete(v)}
                      disabled={deactivateMutation.isPending}
                    >
                      {v.isActive ? <TrashIcon /> : '↺'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(isAdding || modalVessel) && (
        <VesselModal
          vessel={modalVessel}
          onClose={() => {
            setIsAdding(false);
            setModalVessel(null);
          }}
        />
      )}
    </div>
  );
}
