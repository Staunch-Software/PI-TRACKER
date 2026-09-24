import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { OwnerRecipient } from '../../shared';

interface Props {
  recipient: OwnerRecipient | null; // null = create mode
  onClose: () => void;
}

export function OwnerRecipientModal({ recipient, onClose }: Props) {
  const isEdit = recipient !== null;
  const [name, setName] = useState(recipient?.name ?? '');
  const [email, setEmail] = useState(recipient?.email ?? '');
  const [isActive, setIsActive] = useState(recipient?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.patch<OwnerRecipient>(`/owner-recipients/${recipient.id}`, { name: name || null, email, isActive })
        : api.post<OwnerRecipient>('/owner-recipients', { name: name || null, email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-owner-recipients'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save recipient.'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    saveMutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? `Edit Owner Recipient — ${recipient.email}` : 'Add Owner Recipient'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field">
              <label>Name (optional)</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            {isEdit && (
              <div className="field" style={{ marginTop: 14 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Active (receives the owner reminder email)
                </label>
              </div>
            )}
            {error && <p className="form-error" style={{ marginTop: 14 }}>{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Recipient'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
