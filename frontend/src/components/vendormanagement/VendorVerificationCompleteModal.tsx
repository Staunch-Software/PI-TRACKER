import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { uploadVendorBankAttachment } from '../../lib/vendorAttachmentUpload';
import type { TrackedVendorEntry } from '../../shared';

interface Props {
  entry: TrackedVendorEntry;
  onCompleted: () => void;
  onClose: () => void;
}

// Mandatory-attachment gate for "Verification Complete" (confirmed 2026-11-04): the button in the
// table opens this instead of firing the mutation directly — a file must be picked before the
// upload-then-complete flow can run at all. The backend independently re-checks at least one
// attachment exists before setting bank_verification_completed, so this holds even if this modal
// is ever bypassed.
export function VendorVerificationCompleteModal({ entry, onCompleted, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Select a file first.');
      await uploadVendorBankAttachment(entry.id, file);
      await api.post(`/vendor-management/${entry.id}/mark-verification-completed`, {});
    },
    onSuccess: onCompleted,
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to complete verification.'),
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Verification Complete</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>
            Upload the supporting document (e.g. the vendor's signed bank letterhead reply) for{' '}
            <strong>{entry.vendorName ?? entry.vendorCode}</strong> before marking verification complete.
          </p>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={confirmMutation.isPending}
          />
          {error && (
            <p style={{ color: 'var(--color-danger, #dc2626)', fontSize: 13, marginBottom: 0 }}>{error}</p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={confirmMutation.isPending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!file || confirmMutation.isPending}
            onClick={() => confirmMutation.mutate()}
          >
            {confirmMutation.isPending ? 'Uploading…' : 'Upload & Mark Complete'}
          </button>
        </div>
      </div>
    </div>
  );
}
