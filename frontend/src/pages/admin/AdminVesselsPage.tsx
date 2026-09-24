import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Vessel } from '../../shared';
import { VesselModal } from '../../components/modals/VesselModal';
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

  // Renamed from "deactivate" to match what this flag actually means (confirmed with the user):
  // it ONLY controls whether the vessel shows up in the PI vessel dropdown, not whether the
  // vessel entity itself is deactivated/decommissioned. No confirm dialog — toggling this isn't
  // destructive, so it shouldn't read as if it were.
  const toggleApplicableMutation = useMutation({
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
              <th>Assigned TA</th>
              <th style={{ textAlign: 'center' }}>Show in PI Dropdown</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(vesselsQuery.data ?? []).map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td>{v.imoNumber ?? '—'}</td>
                <td>{v.assignedTaName ?? '—'}</td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={v.isActive}
                    disabled={toggleApplicableMutation.isPending}
                    title="Whether this vessel is applicable for PI — shows up in the PI vessel dropdown when checked"
                    onChange={() => toggleApplicableMutation.mutate(v)}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div className="row-actions">
                    <button className="icon-btn" title="Edit" onClick={() => setModalVessel(v)}>
                      ✎
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
