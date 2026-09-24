import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { OwnerRecipient } from '../../shared';
import { OwnerRecipientModal } from '../../components/modals/OwnerRecipientModal';
import { useAdminCreateModal } from './AdminCreateModalContext';

export function AdminOwnerRecipientsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalRecipient, setModalRecipient] = useState<OwnerRecipient | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const { setIsOwnerRecipientsCreateOpen } = useAdminCreateModal();

  const recipientsQuery = useQuery({
    queryKey: ['admin-owner-recipients'],
    queryFn: () => api.get<OwnerRecipient[]>('/owner-recipients?include_inactive=true'),
  });

  useEffect(() => {
    setIsOwnerRecipientsCreateOpen(isAdding);
    return () => setIsOwnerRecipientsCreateOpen(false);
  }, [isAdding, setIsOwnerRecipientsCreateOpen]);

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
          <h1>Owner Recipients</h1>
          <p>
            {recipientsQuery.data ? `${recipientsQuery.data.length} recipients` : 'Loading…'}
            {' — receive the "send owner reminder" email from the Tracker page (shared across all vessels)'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
          + Add Recipient
        </button>
      </div>

      <div className="card table-scroll">
        <table className="data-table">
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
                <td style={{ textAlign: 'center' }}>{r.isActive ? 'Yes' : 'No'}</td>
                <td style={{ textAlign: 'center' }}>
                  <div className="row-actions">
                    <button className="icon-btn" title="Edit" onClick={() => setModalRecipient(r)}>
                      ✎
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    </div>
  );
}
