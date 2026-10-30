import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { uploadVendorBankAttachment } from '../../lib/vendorAttachmentUpload';
import type { VendorBankAttachment, VendorMasterAttachment, VendorTrackerEntry } from '../../shared';
import { Toast } from '../common/Toast';

interface Props {
  entry: VendorTrackerEntry;
  canEdit: boolean;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VendorAttachmentsModal({ entry, canEdit, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const smartpalDocsQuery = useQuery({
    queryKey: ['vendor-master-attachments', entry.vendorCode],
    queryFn: () => api.get<VendorMasterAttachment[]>(`/vendor-management/vendor-master/${entry.vendorCode}/attachments`),
  });

  const bankDocsQuery = useQuery({
    queryKey: ['vendor-bank-attachments', entry.id],
    queryFn: () => api.get<VendorBankAttachment[]>(`/vendor-management/${entry.id}/attachments`),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadVendorBankAttachment(entry.id, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendor-bank-attachments', entry.id] }),
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : 'Upload failed.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => api.delete(`/vendor-management/${entry.id}/attachments/${attachmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendor-bank-attachments', entry.id] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to delete attachment.'),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => uploadMutation.mutate(file));
    e.target.value = '';
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Documents — {entry.vendorName ?? entry.vendorCode}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>From SmartPAL</h3>
          {smartpalDocsQuery.isLoading ? (
            <p>Loading…</p>
          ) : (smartpalDocsQuery.data ?? []).length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No documents scraped from SmartPAL yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px' }}>
              {(smartpalDocsQuery.data ?? []).map((doc) => (
                <li key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <a href={doc.downloadUrl} target="_blank" rel="noreferrer">{doc.fileName}</a>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{formatSize(doc.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          )}

          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Bank Reply Uploads</h3>
          {bankDocsQuery.isLoading ? (
            <p>Loading…</p>
          ) : (bankDocsQuery.data ?? []).length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No bank-reply documents uploaded yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {(bankDocsQuery.data ?? []).map((doc) => (
                <li key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <a href={doc.downloadUrl} target="_blank" rel="noreferrer">{doc.fileName}</a>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{formatSize(doc.sizeBytes)} · {doc.uploadedByName}</span>
                    {canEdit && (
                      <button className="icon-btn icon-btn-muted" onClick={() => deleteMutation.mutate(doc.id)} title="Delete">×</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div style={{ marginTop: 16 }}>
              <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileChange} />
              <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
                {uploadMutation.isPending ? 'Uploading…' : '+ Upload Bank Reply Document'}
              </button>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      {error && <Toast type="error" message={error} onClose={() => setError(null)} duration={5000} />}
    </div>
  );
}
