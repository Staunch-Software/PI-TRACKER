import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { Vessel } from '../../shared';

interface Props {
  vessel: Vessel | null; // null = create mode
  onClose: () => void;
}

export function VesselModal({ vessel, onClose }: Props) {
  const isEdit = vessel !== null;
  const [name, setName] = useState(vessel?.name ?? '');
  const [imoNumber, setImoNumber] = useState(vessel?.imoNumber ?? '');
  const [isActive, setIsActive] = useState(vessel?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.patch<Vessel>(`/vessels/${vessel.id}`, { name, imoNumber, isActive })
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
              <div className="field" style={{ marginTop: 14 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Active (shows up in vessel dropdowns)
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
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Vessel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
