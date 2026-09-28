import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { OwnerRecipient } from '../../shared';
import { OwnerRecipientModal } from '../../components/modals/OwnerRecipientModal';
import { EditIcon } from '../../components/common/EditIcon';
import { TrashIcon } from '../../components/common/TrashIcon';

export function AdminOwnerRecipientsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalRecipient, setModalRecipient] = useState<OwnerRecipient | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const queryClient = useQueryClient();

  const recipientsQuery = useQuery({
    queryKey: ['admin-owner-recipients'],
    queryFn: () => api.get<OwnerRecipient[]>('/owner-recipients?include_inactive=true'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (recipient: OwnerRecipient) =>
      api.patch<OwnerRecipient>(`/owner-recipients/${recipient.id}`, { isActive: !recipient.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-owner-recipients'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });

  function handleToggleActive(recipient: OwnerRecipient) {
    const verb = recipient.isActive ? 'Deactivate' : 'Reactivate';
    if (window.confirm(`${verb} ${recipient.name ?? recipient.email}?`)) {
      deactivateMutation.mutate(recipient);
    }
  }

  return (
    <>
      <div className="admin-page-header">
        <div>
          <div className="admin-title-row">
            <h1 className="admin-page-title">Owner Recipients</h1>
            <div className="admin-page-count">
              <span className="count-number">{recipientsQuery.data ? recipientsQuery.data.length : 0}</span>
              <span className="count-label">Recipients</span>
            </div>
          </div>
          <p className="admin-page-subtitle">
            (Receive the "send owner reminder" email from Tracker)
          </p>
        </div>
        <button className="admin-btn-primary" onClick={() => setIsAdding(true)}>
          + Add Recipient
        </button>
      </div>

      <div className="admin-page-body">

      <div className="admin-card admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th style={{ textAlign: 'center' }}>Active</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(recipientsQuery.data ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.name ?? '—'}</td>
                <td>{r.email}</td>
                <td style={{ textAlign: 'center' }}>
                  <span className={`admin-badge ${r.isActive ? 'active' : 'inactive'}`}>
                    {r.isActive ? '● Active' : '○ Inactive'}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div className="admin-row-actions">
                    <button className="admin-action-btn" title="Edit" onClick={() => setModalRecipient(r)}>
                      <EditIcon />
                    </button>
                    <button
                      className={`admin-action-btn${r.isActive ? ' danger' : ''}`}
                      title={r.isActive ? 'Deactivate' : 'Reactivate'}
                      onClick={() => handleToggleActive(r)}
                      disabled={deactivateMutation.isPending}
                    >
                      {r.isActive ? <TrashIcon /> : '↺'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      {(isAdding || modalRecipient) && (
        <OwnerRecipientModal
          recipient={modalRecipient}
          onClose={() => {
            setIsAdding(false);
            setModalRecipient(null);
          }}
        />
      )}
    </>
  );
}
