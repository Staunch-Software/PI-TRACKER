import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { VendorBankRequestPreview, VendorTrackerEntry } from '../../shared';
import { Toast } from '../common/Toast';

interface Props {
  entry: VendorTrackerEntry;
  onSent: () => void;
  onClose: () => void;
}

// Fixed, short list — kept in sync with BANK_REQUEST_SENDERS in
// backend/app/api/routes/vendor_management.py, which validates the chosen mailbox server-side.
const FROM_OPTIONS = [
  { email: 'jayasri.v@ozellar.com', label: 'Jayasri Viswanathan (Jayasri.v@ozellar.com)' },
  { email: 'gayathri.p@ozellar.com', label: 'Gayathri Sarvanan (gayathri.p@ozellar.com)' },
];

export function VendorBankRequestModal({ entry, onSent, onClose }: Props) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fromMailbox, setFromMailbox] = useState(FROM_OPTIONS[0].email);
  const [error, setError] = useState<string | null>(null);

  const previewQuery = useQuery({
    queryKey: ['vendor-bank-request-preview', entry.id],
    queryFn: () => api.get<VendorBankRequestPreview>(`/vendor-management/${entry.id}/bank-request-preview`),
  });

  useEffect(() => {
    if (previewQuery.data) {
      setSubject(previewQuery.data.subject);
      setBody(previewQuery.data.body);
    }
  }, [previewQuery.data]);

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post(`/vendor-management/${entry.id}/send-bank-request`, { subject, body, fromMailbox }),
    onSuccess: onSent,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to send email.'),
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Send Bank Details Request — {entry.vendorName ?? entry.vendorCode}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {previewQuery.isLoading ? (
            <p>Loading draft…</p>
          ) : previewQuery.isError ? (
            <p style={{ color: 'var(--color-danger, #dc2626)' }}>
              {previewQuery.error instanceof ApiError ? previewQuery.error.message : 'Failed to load the email draft.'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label className="vendor-bank-request-field">
                <span>From</span>
                <select value={fromMailbox} onChange={(e) => setFromMailbox(e.target.value)}>
                  {FROM_OPTIONS.map((o) => (
                    <option key={o.email} value={o.email}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="vendor-bank-request-field">
                <span>To</span>
                <input value={previewQuery.data?.toEmail ?? ''} disabled />
              </label>
              <label className="vendor-bank-request-field">
                <span>Subject</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </label>
              <label className="vendor-bank-request-field">
                <span>Body</span>
                <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
              </label>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={previewQuery.isLoading || !!previewQuery.isError || sendMutation.isPending || !subject.trim() || !body.trim()}
            onClick={() => sendMutation.mutate()}
          >
            {sendMutation.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
      {error && <Toast type="error" message={error} onClose={() => setError(null)} duration={5000} />}
    </div>
  );
}
