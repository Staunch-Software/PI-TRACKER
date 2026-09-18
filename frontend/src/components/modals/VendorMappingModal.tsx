import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { DEPARTMENT_LABELS, Department, type VendorMapping } from '../../shared';

interface Props {
  mapping: VendorMapping | null; // null = create mode
  onClose: () => void;
}

export function VendorMappingModal({ mapping, onClose }: Props) {
  const isEdit = mapping !== null;
  const [vendorName, setVendorName] = useState(mapping?.vendorName ?? '');
  const [department, setDepartment] = useState<Department>(mapping?.department ?? Department.TECHNICAL);
  const [active, setActive] = useState(mapping?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.patch<VendorMapping>(`/vendor-mapping/${mapping.id}`, { vendorName, department, active })
        : api.post<VendorMapping>('/vendor-mapping', { vendorName, department }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-vendor-mapping'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save vendor mapping.'),
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
          <h2>{isEdit ? `Edit Vendor Mapping — ${mapping.vendorName}` : 'Add New Vendor Mapping'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field">
              <label>Vendor Name</label>
              <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required autoFocus />
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Department</label>
              <select value={department} onChange={(e) => setDepartment(e.target.value as Department)}>
                {Object.values(Department).map((d) => (
                  <option key={d} value={d}>
                    {DEPARTMENT_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>
            {isEdit && (
              <div className="field" style={{ marginTop: 14 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Active
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
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
