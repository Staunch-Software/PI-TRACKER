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

// Fixed sender options authorized for bank details requests
const FROM_OPTIONS = [
  { email: 'jayasri.v@ozellar.com', label: 'Jayasri Viswanathan (jayasri.v@ozellar.com)' },
  { email: 'gayathri.p@ozellar.com', label: 'Gayathri Sarvanan (gayathri.p@ozellar.com)' },
];

/**
 * Converts raw HTML from the server into clean, natural plain text that normal
 * users can easily read and edit without seeing any HTML tags (<p>, <ul>, <li>, etc.).
 */
function htmlToPlainText(html: string): string {
  if (!html) return '';
  let text = html.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<li[^>]*>/gi, '• ');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Converts user-edited plain text back into properly formatted HTML paragraphs
 * and bulleted list items for Microsoft Graph email delivery.
 */
function plainTextToHtml(text: string): string {
  if (!text) return '';
  const lines = text.split('\n').map((l) => l.trim());
  const blocks: string[] = [];
  let currentBullets: string[] = [];
  let currentPara: string[] = [];

  function flushBullets() {
    if (currentBullets.length > 0) {
      blocks.push(`<ul>${currentBullets.map((b) => `<li>${b}</li>`).join('')}</ul>`);
      currentBullets = [];
    }
  }

  function flushPara() {
    if (currentPara.length > 0) {
      blocks.push(`<p>${currentPara.join('<br />')}</p>`);
      currentPara = [];
    }
  }

  for (const line of lines) {
    if (!line) {
      flushPara();
      continue;
    }
    const isBullet = line.startsWith('•') || line.startsWith('- ') || line.startsWith('* ');
    if (isBullet) {
      flushPara();
      currentBullets.push(line.replace(/^[•\-\*]\s*/, ''));
    } else {
      flushBullets();
      currentPara.push(line);
    }
  }
  flushBullets();
  flushPara();

  return blocks.join('\n');
}

export function VendorBankRequestModal({ entry, onSent, onClose }: Props) {
  const [subject, setSubject] = useState('');
  const [plainBody, setPlainBody] = useState('');
  const [fromMailbox, setFromMailbox] = useState(FROM_OPTIONS[0].email);
  const [activeTab, setActiveTab] = useState<'preview' | 'edit'>('preview');
  const [error, setError] = useState<string | null>(null);

  const previewQuery = useQuery({
    queryKey: ['vendor-bank-request-preview', entry.id],
    queryFn: () => api.get<VendorBankRequestPreview>(`/vendor-management/${entry.id}/bank-request-preview`),
  });

  useEffect(() => {
    if (previewQuery.data) {
      setSubject(previewQuery.data.subject);
      // Convert backend HTML draft into natural plain text for normal users
      setPlainBody(htmlToPlainText(previewQuery.data.body));
    }
  }, [previewQuery.data]);

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post(`/vendor-management/${entry.id}/send-bank-request`, {
        subject,
        body: plainTextToHtml(plainBody),
        fromMailbox,
      }),
    onSuccess: onSent,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to send email.'),
  });

  const vendorDisplayName = entry.vendorName ?? entry.vendorCode;
  const toEmail = previewQuery.data?.toEmail ?? entry.vendorEmail ?? '';

  function handleResetTemplate() {
    if (previewQuery.data?.body) {
      setPlainBody(htmlToPlainText(previewQuery.data.body));
      setSubject(previewQuery.data.subject);
    }
  }

  function handleInsertBullet() {
    setPlainBody((prev) => (prev.endsWith('\n') ? `${prev}• ` : `${prev}\n• `));
  }

  return (
    <div className="vendor-bank-modal-overlay" onClick={onClose}>
      <div className="vendor-bank-modal-panel" onClick={(e) => e.stopPropagation()}>
        {/* Executive Header */}
        <div className="vendor-bank-modal-header">
          <div className="vendor-bank-modal-header-left">
            <div className="vendor-bank-modal-icon-badge">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </div>
            <div className="vendor-bank-modal-titles">
              <h2>Send Bank Details Request</h2>
              <div className="vendor-bank-modal-sub">
                <span className="vendor-bank-code-pill">{entry.vendorCode}</span>
                <span className="vendor-bank-name-truncate">{vendorDisplayName}</span>
                <span className="vendor-bank-dot-divider">•</span>
                <span className="vendor-bank-sub-tag">Official Letterhead Request</span>
              </div>
            </div>
          </div>
          <button className="vendor-bank-modal-close" onClick={onClose} aria-label="Close modal" title="Close">
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="vendor-bank-modal-body">
          {previewQuery.isLoading ? (
            <div className="vendor-bank-modal-loading">
              <div className="tracker-loading-spinner" />
              <div>Generating personalized email draft…</div>
            </div>
          ) : previewQuery.isError ? (
            <div className="vendor-bank-modal-error-banner">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div>
                <strong>Unable to generate draft:</strong>{' '}
                {previewQuery.error instanceof ApiError ? previewQuery.error.message : 'Failed to load the email draft.'}
              </div>
            </div>
          ) : (
            <>
              {/* Security & Process Notice Callout */}
              <div className="vendor-bank-workflow-callout">
                <div className="vendor-bank-callout-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <polyline points="9 12 11 14 15 10" />
                  </svg>
                </div>
                <div className="vendor-bank-callout-text">
                  <strong>Verification Protocol:</strong> Requests the vendor to reply with their 6 mandatory bank fields on signed corporate letterhead accompanied by a cancelled cheque or bank statement. Sending this updates status to <span className="vendor-bank-callout-badge">Requested</span>.
                </div>
              </div>

              {/* Email Envelope Fields */}
              <div className="vendor-bank-composer-card">
                {/* From Row */}
                <div className="vendor-bank-composer-row">
                  <span className="vendor-bank-composer-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    From
                  </span>
                  <div className="vendor-bank-composer-field">
                    <select
                      className="vendor-bank-select"
                      value={fromMailbox}
                      onChange={(e) => setFromMailbox(e.target.value)}
                    >
                      {FROM_OPTIONS.map((o) => (
                        <option key={o.email} value={o.email}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* To Row */}
                <div className="vendor-bank-composer-row">
                  <span className="vendor-bank-composer-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    To
                  </span>
                  <div className="vendor-bank-composer-field">
                    {toEmail ? (
                      <div className="vendor-bank-recipient-chip">
                        <span className="vendor-bank-recipient-dot" />
                        <span className="vendor-bank-recipient-email">{toEmail}</span>
                        <span className="vendor-bank-recipient-tag">SmartPAL Master</span>
                      </div>
                    ) : (
                      <div className="vendor-bank-recipient-warning">
                        ⚠️ No email on file in SmartPAL for this vendor.
                      </div>
                    )}
                  </div>
                </div>

                {/* Subject Row */}
                <div className="vendor-bank-composer-row">
                  <span className="vendor-bank-composer-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="4" y1="9" x2="20" y2="9" />
                      <line x1="4" y1="15" x2="20" y2="15" />
                      <line x1="10" y1="3" x2="8" y2="21" />
                      <line x1="16" y1="3" x2="14" y2="21" />
                    </svg>
                    Subject
                  </span>
                  <div className="vendor-bank-composer-field">
                    <input
                      type="text"
                      className="vendor-bank-input"
                      value={subject}
                      placeholder="Email Subject…"
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* View / Edit Mode Switcher */}
              <div className="vendor-bank-view-switcher">
                <div className="vendor-bank-tabs">
                  <button
                    type="button"
                    className={`vendor-bank-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
                    onClick={() => setActiveTab('preview')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    Email Preview
                  </button>
                  <button
                    type="button"
                    className={`vendor-bank-tab-btn ${activeTab === 'edit' ? 'active' : ''}`}
                    onClick={() => setActiveTab('edit')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit Message
                  </button>
                </div>
                <div className="vendor-bank-format-pill">
                  {activeTab === 'preview' ? 'Executive Letterhead View' : 'Plain Text Mode — No HTML needed'}
                </div>
              </div>

              {/* Message Content Area */}
              {activeTab === 'preview' ? (
                <div className="vendor-bank-email-preview-wrapper">
                  <div className="vendor-bank-email-preview-header">
                    <div className="vendor-bank-preview-brand">
                      <span className="vendor-bank-brand-title">Ozellar Marine</span>
                      <span className="vendor-bank-brand-badge">Official Communication</span>
                    </div>
                    <div className="vendor-bank-preview-date">
                      {new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })}
                    </div>
                  </div>
                  <div
                    className="vendor-bank-email-preview-content"
                    dangerouslySetInnerHTML={{ __html: plainTextToHtml(plainBody) }}
                  />
                </div>
              ) : (
                <div className="vendor-bank-editor-wrapper">
                  <div className="vendor-bank-editor-toolbar">
                    <span className="vendor-bank-editor-hint">
                      Type naturally. Use paragraphs and bullets (•) — no HTML code required!
                    </span>
                    <div className="vendor-bank-editor-actions">
                      <button type="button" className="vendor-bank-tool-btn" onClick={handleInsertBullet}>
                        + Add Bullet Point
                      </button>
                      <button type="button" className="vendor-bank-tool-btn" onClick={handleResetTemplate}>
                        ↺ Reset Template
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="vendor-bank-textarea"
                    rows={11}
                    value={plainBody}
                    onChange={(e) => setPlainBody(e.target.value)}
                    placeholder="Type your email message naturally here…"
                  />
                  <div className="vendor-bank-editor-helper">
                    <span>Clean plain text formatted automatically for recipient</span>
                    <span>{plainBody.length} characters</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="vendor-bank-modal-footer">
          <div className="vendor-bank-footer-left">
            <span className="vendor-bank-footer-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Dispatched via Microsoft 365 Exchange
            </span>
          </div>
          <div className="vendor-bank-footer-actions">
            <button type="button" className="vendor-bank-btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="vendor-bank-btn-send"
              disabled={
                previewQuery.isLoading ||
                !!previewQuery.isError ||
                sendMutation.isPending ||
                !subject.trim() ||
                !plainBody.trim() ||
                !toEmail
              }
              onClick={() => sendMutation.mutate()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              <span>{sendMutation.isPending ? 'Sending Request…' : 'Send Bank Request'}</span>
            </button>
          </div>
        </div>
      </div>
      {error && <Toast type="error" message={error} onClose={() => setError(null)} duration={5000} />}
    </div>
  );
}
