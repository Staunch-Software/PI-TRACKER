import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { UserRole, type Vessel, type User } from '../../shared';

interface Props {
  vessel: Vessel | null; // null = create mode
  onClose: () => void;
}

export function VesselModal({ vessel, onClose }: Props) {
  const isEdit = vessel !== null;
  const [name, setName] = useState(vessel?.name ?? '');
  const [imoNumber, setImoNumber] = useState(vessel?.imoNumber ?? '');
  const [isActive, setIsActive] = useState(vessel?.isActive ?? true);
  const [assignedTaId, setAssignedTaId] = useState(vessel?.assignedTaId ?? '');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Only fetched in edit mode — the TA dropdown only matters once a vessel exists, and this is
  // an Admin-only page anyway so GET /users (Admin-only) is always allowed here.
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<User[]>('/users'),
    enabled: isEdit,
  });
  const eligibleTas = (usersQuery.data ?? []).filter(
    (u) => u.isActive && (u.role === UserRole.ADMIN || u.role === UserRole.EDITOR),
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.patch<Vessel>(`/vessels/${vessel.id}`, { name, imoNumber, isActive, assignedTaId: assignedTaId || null })
        : api.post<Vessel>('/vessels', { name, imoNumber }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-vessels'] });
      queryClient.invalidateQueries({ queryKey: ['vessels'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save vessel.'),
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
          <h2>{isEdit ? `Edit Vessel — ${vessel.name}` : 'Add New Vessel'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field">
              <label>Vessel Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>IMO Number</label>
              <input value={imoNumber} onChange={(e) => setImoNumber(e.target.value)} placeholder="e.g. 9481219" required />
            </div>
            {isEdit && (
              <>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>Assigned TA</label>
                  <select value={assignedTaId} onChange={(e) => setAssignedTaId(e.target.value)}>
                    <option value="">— None (fallback mailbox) —</option>
                    {eligibleTas.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName} ({u.email})
                      </option>
                    ))}
                  </select>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Vendor-notice/owner-reminder emails for this vessel's PIs are sent from this person's mailbox.
                  </p>
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      style={{ marginRight: 6 }}
                    />
                    Applicable for PI (shows up in the PI vessel dropdown)
                  </label>
                </div>
              </>
            )}
            {error && <p className="form-error" style={{ marginTop: 14 }}>{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Vessel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
