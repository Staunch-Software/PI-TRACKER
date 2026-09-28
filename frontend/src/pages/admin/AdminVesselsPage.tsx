import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Vessel } from '../../shared';
import { VesselModal } from '../../components/modals/VesselModal';
import { EditIcon } from '../../components/common/EditIcon';

export function AdminVesselsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalVessel, setModalVessel] = useState<Vessel | null>(null);
  const [isAdding, setIsAdding] = useState(false);
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

  return (
    <>
      <div className="admin-page-header">
        <div>
          <div className="admin-title-row">
            <h1 className="admin-page-title">Vessel Management</h1>
            <div className="admin-page-count">
              <span className="count-number">{vesselsQuery.data ? vesselsQuery.data.length : 0}</span>
              <span className="count-label">Vessels</span>
            </div>
          </div>
        </div>
        <button className="admin-btn-primary" onClick={() => setIsAdding(true)}>+ Add New Vessel</button>
      </div>

      <div className="admin-page-body">
        <div className="admin-card admin-table-wrapper">
          <table className="admin-table">
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
                <td><strong>{v.name}</strong></td>
                <td style={{ color: '#6B7280' }}>{v.imoNumber ?? '—'}</td>
                <td>{v.assignedTaName ?? '—'}</td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={v.isActive}
                    disabled={toggleApplicableMutation.isPending}
                    title="Whether this vessel is applicable for PI"
                    onChange={() => toggleApplicableMutation.mutate(v)}
                  />
                </td>
                <td>
                  <div className="admin-row-actions">
                    <button className="admin-action-btn" title="Edit" onClick={() => setModalVessel(v)}>
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

      {(isAdding || modalVessel) && (
        <VesselModal
          vessel={modalVessel}
          onClose={() => {
            setIsAdding(false);
            setModalVessel(null);
          }}
        />
      )}
    </>
  );
}
