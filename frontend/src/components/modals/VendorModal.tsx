import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { Vendor } from '../../shared';

interface Props {
  vendor: Vendor | null; // null = create mode
  onClose: () => void;
}

export function VendorModal({ vendor, onClose }: Props) {
  const isEdit = vendor !== null;
  const [name, setName] = useState(vendor?.name ?? '');
  const [email, setEmail] = useState(vendor?.email ?? '');
  const [isActive, setIsActive] = useState(vendor?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.patch<Vendor>(`/vendors/${vendor.id}`, { name, email: email || null, isActive })
        : api.post<Vendor>('/vendors', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save vendor.'),
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
          <h2>{isEdit ? `Edit Vendor — ${vendor.name}` : 'Add New Vendor'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field">
              <label>Vendor Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            {isEdit && (
              <>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="vendor@example.com"
                  />
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Used by the "send vendor notice" button on the Tracker page.
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
                    Active
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
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
