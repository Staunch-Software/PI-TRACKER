import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { InvoiceDisputeMailPreviewResponse, SendInvoiceDisputeMailResponse } from '../../shared';

import './PendingItemsMailModal.css';

interface Props {
  invoiceNo: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function BoldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h8a4 4 0 0 1 0 8H6z" />
      <path d="M6 12h9a4 4 0 0 1 0 8H6z" />
    </svg>
  );
}

function ItalicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  );
}

function UnderlineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v7a6 6 0 0 0 12 0V3" />
      <line x1="4" y1="21" x2="20" y2="21" />
    </svg>
  );
}

export function InvoiceDisputeMailModal({ invoiceNo, onClose, onSuccess }: Props) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [toInput, setToInput] = useState('');
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'preview'>('details');
  const [sendError, setSendError] = useState<string | null>(null);
  const bodyEditableRef = useRef<HTMLDivElement>(null);
  const bodyInitializedRef = useRef(false);

  const { data: previewData, isLoading, error: fetchError } = useQuery({
    queryKey: ['invoice-dispute-mail-preview', invoiceNo],
    queryFn: () =>
      api.post<InvoiceDisputeMailPreviewResponse>('/pending-items/invoice-dispute-mail/preview', {
        invoiceNo,
      }),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (previewData) {
      setSubject(previewData.subject);
      setBody(previewData.body);
      setToEmails(previewData.defaultToEmails);
      bodyInitializedRef.current = false;
    }
  }, [previewData]);

  // The content-editable div owns its own DOM content while the Purchase team is typing — this
  // only pushes `body` into it ONCE per mount, right after the preview loads. Re-syncing on every
  // keystroke (via `dangerouslySetInnerHTML` or resetting innerHTML in this effect) would fight the
  // browser's own cursor position and undo history. The "Preview" tab unmounts this div entirely
  // (it's a separate JSX branch), so switching back to "Email Details" remounts a fresh, empty div —
  // resetting the flag whenever the details tab isn't active makes the next mount re-sync from `body`.
  useEffect(() => {
    if (activeTab !== 'details') {
      bodyInitializedRef.current = false;
      return;
    }
    if (!bodyInitializedRef.current && bodyEditableRef.current) {
      bodyEditableRef.current.innerHTML = body;
      bodyInitializedRef.current = true;
    }
  }, [activeTab, body]);

  function handleBodyInput(e: FormEvent<HTMLDivElement>) {
    setBody(e.currentTarget.innerHTML);
  }

  function execFormatCommand(command: string) {
    document.execCommand(command, false);
    if (bodyEditableRef.current) {
      setBody(bodyEditableRef.current.innerHTML);
    }
  }

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post<SendInvoiceDisputeMailResponse>('/pending-items/invoice-dispute-mail/send', {
        invoiceNo,
        subject,
        body,
        toEmails,
        ccEmails,
      }),
    onSuccess: (res) => {
      onSuccess(`Dispute email for ${invoiceNo} sent to ${res.recipients.join(', ')}.`);
      onClose();
    },
    onError: (err) => {
      setSendError(err instanceof ApiError ? err.message : 'Failed to send dispute email.');
    },
  });

  function addEmail(list: string[], setList: (v: string[]) => void, raw: string, setInput: (v: string) => void) {
    const val = raw.trim();
    if (!val) return;
    if (!list.includes(val)) {
      setList([...list, val]);
    }
    setInput('');
  }

  function handleToKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addEmail(toEmails, setToEmails, toInput, setToInput);
    }
  }

  function handleCcKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addEmail(ccEmails, setCcEmails, ccInput, setCcInput);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (toInput.trim()) addEmail(toEmails, setToEmails, toInput, setToInput);
    if (ccInput.trim()) addEmail(ccEmails, setCcEmails, ccInput, setCcInput);
    setSendError(null);
    sendMutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel pending-mail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pending-mail-modal-header">
          <div className="pending-mail-header-left">
            <div className="pending-mail-header-icon">
              <MailIcon />
            </div>
            <div className="pending-mail-title-wrap">
              <h2>
                <span>Email Vendor — Dispute on {invoiceNo}</span>
              </h2>
              <p className="pending-mail-title-desc">
                Review the vendor's email, customize the subject/body, and preview before sending.
              </p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">
            <CloseIcon />
          </button>
        </div>

        {isLoading ? (
          <div className="pending-mail-loading-state">
            <div className="pending-mail-spinner" />
            <div>Generating email preview…</div>
          </div>
        ) : fetchError ? (
          <div className="modal-body">
            <div className="pending-mail-error-banner">
              <AlertTriangleIcon />
              <span>
                {fetchError instanceof ApiError ? fetchError.message : 'Failed to generate dispute email preview.'}
              </span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div className="pending-mail-modal-body">
              <div className="pending-mail-sender-card">
                <div className="pending-mail-sender-info">
                  <span className="pending-mail-sender-label">From:</span>
                  <span className="pending-mail-sender-addr">{previewData?.fromMailbox}</span>
                </div>
                <span className="pending-mail-verified-badge">
                  <CheckCircleIcon />
                  <span>Your account</span>
                </span>
              </div>

              {previewData && !previewData.vendorEmailFound && (
                <div className="pending-mail-error-banner">
                  <AlertTriangleIcon />
                  <span>
                    No registered email found for vendor "{previewData.vendorName ?? 'Unknown'}" in Vendor Management —
                    enter the To address manually below.
                  </span>
                </div>
              )}

              <div className="pending-mail-preview-wrapper">
                <div className="pending-mail-preview-top">
                  <span className="pending-mail-preview-title">
                    {activeTab === 'details' ? (
                      <>
                        <EditIcon /> Email Details
                      </>
                    ) : (
                      <>
                        <EyeIcon /> Preview
                      </>
                    )}
                  </span>
                  <div className="pending-mail-tab-pills">
                    <button
                      type="button"
                      className={`pending-mail-tab-btn ${activeTab === 'details' ? 'active' : ''}`}
                      onClick={() => setActiveTab('details')}
                    >
                      Email Details
                    </button>
                    <button
                      type="button"
                      className={`pending-mail-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
                      onClick={() => setActiveTab('preview')}
                    >
                      Preview
                    </button>
                  </div>
                </div>

                {activeTab === 'details' ? (
                  <div className="pending-mail-section-card" style={{ padding: 0, border: 'none', boxShadow: 'none' }}>
                    <div className="pending-mail-field-row">
                      <div className="pending-mail-field-header">
                        <label className="pending-mail-field-label">
                          <span>To:</span>
                        </label>
                      </div>
                      <div className="pending-mail-chips-box">
                        {toEmails.map((e) => (
                          <span key={e} className="pending-mail-chip">
                            <span className="pending-mail-chip-text">{e}</span>
                            <button
                              type="button"
                              className="pending-mail-chip-remove"
                              onClick={() => setToEmails(toEmails.filter((x) => x !== e))}
                              aria-label={`Remove ${e}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          type="email"
                          className="pending-mail-chip-input"
                          placeholder="Type email &amp; press Enter to add…"
                          value={toInput}
                          onChange={(e) => setToInput(e.target.value)}
                          onKeyDown={handleToKeyDown}
                          onBlur={() => addEmail(toEmails, setToEmails, toInput, setToInput)}
                        />
                      </div>
                    </div>

                    <div className="pending-mail-field-row">
                      <div className="pending-mail-field-header">
                        <label className="pending-mail-field-label">
                          <span>CC (Optional):</span>
                        </label>
                      </div>
                      <div className="pending-mail-chips-box">
                        {ccEmails.map((e) => (
                          <span key={e} className="pending-mail-chip cc">
                            <span className="pending-mail-chip-text">{e}</span>
                            <button
                              type="button"
                              className="pending-mail-chip-remove"
                              onClick={() => setCcEmails(ccEmails.filter((x) => x !== e))}
                              aria-label={`Remove ${e}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          type="email"
                          className="pending-mail-chip-input"
                          placeholder="Add CC email &amp; press Enter…"
                          value={ccInput}
                          onChange={(e) => setCcInput(e.target.value)}
                          onKeyDown={handleCcKeyDown}
                          onBlur={() => addEmail(ccEmails, setCcEmails, ccInput, setCcInput)}
                        />
                      </div>
                    </div>

                    <div className="pending-mail-field-row">
                      <label className="pending-mail-field-label">
                        <span>Subject:</span>
                      </label>
                      <input
                        type="text"
                        className="pending-mail-text-input"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="Enter email subject"
                        required
                      />
                    </div>

                    <div className="pending-mail-field-row">
                      <label className="pending-mail-field-label">
                        <span>Body:</span>
                      </label>
                      <div className="pending-mail-rte">
                        <div className="pending-mail-rte-toolbar">
                          <button
                            type="button"
                            className="pending-mail-rte-btn"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => execFormatCommand('bold')}
                            title="Bold"
                          >
                            <BoldIcon />
                          </button>
                          <button
                            type="button"
                            className="pending-mail-rte-btn"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => execFormatCommand('italic')}
                            title="Italic"
                          >
                            <ItalicIcon />
                          </button>
                          <button
                            type="button"
                            className="pending-mail-rte-btn"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => execFormatCommand('underline')}
                            title="Underline"
                          >
                            <UnderlineIcon />
                          </button>
                        </div>
                        <div
                          ref={bodyEditableRef}
                          className="pending-mail-rte-body"
                          contentEditable
                          suppressContentEditableWarning
                          onInput={handleBodyInput}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="pending-mail-iframe-container">
                      <iframe title="Email Body Preview" className="pending-mail-iframe" srcDoc={body} sandbox="allow-same-origin" />
                    </div>
                  </div>
                )}
              </div>

              {sendError && (
                <div className="pending-mail-error-banner">
                  <AlertTriangleIcon />
                  <span>{sendError}</span>
                </div>
              )}
            </div>

            <div className="pending-mail-modal-footer">
              <div className="pending-mail-footer-summary">
                Delivery: <strong>{toEmails.length}</strong> recipient{toEmails.length !== 1 ? 's' : ''}
                {ccEmails.length > 0 && (
                  <span>
                    {' '}
                    · <strong>{ccEmails.length}</strong> CC
                  </span>
                )}
              </div>

              <div className="pending-mail-footer-actions">
                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={sendMutation.isPending}>
                  Cancel
                </button>

                <button
                  type="submit"
                  className="pending-mail-btn-send"
                  disabled={sendMutation.isPending || toEmails.length === 0 || !body.trim()}
                >
                  <SendIcon />
                  <span>{sendMutation.isPending ? 'Sending Email…' : 'Send Email Now'}</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
