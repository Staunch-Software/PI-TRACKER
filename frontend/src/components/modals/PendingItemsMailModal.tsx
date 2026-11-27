import { useState, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type {
  PreviewPendingSummaryEmailResponse,
  SendPendingSummaryEmailResponse,
} from '../../shared';
import { ROLE_LABELS } from '../../shared';

import './PendingItemsMailModal.css';

interface Props {
  role: string; // 'ALL' | 'TSI' | 'TA'
  stage: string | null;
  mode?: 'detailed' | 'dashboard';
  onClose: () => void;
  onSuccess: (message: string) => void;
}

/* ── Clean Vector SVG Icons (Zero Emojis) ── */
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

function FileSpreadsheetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M8 13h8" />
      <path d="M8 17h8" />
      <path d="M10 9H8" />
    </svg>
  );
}

function RotateCcwIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
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

function GripVerticalIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="5" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="15" cy="5" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="15" cy="19" r="1.5" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

export function PendingItemsMailModal({ role, stage, mode = 'detailed', onClose, onSuccess }: Props) {
  const isDashboard = mode === 'dashboard';
  const [subject, setSubject] = useState('');
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [toInput, setToInput] = useState('');
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'preview'>('details');
  const [sendError, setSendError] = useState<string | null>(null);

  // Drag and Drop State between TO and CC
  const [draggedItem, setDraggedItem] = useState<{ email: string; from: 'to' | 'cc' } | null>(null);
  const [isToDragOver, setIsToDragOver] = useState(false);
  const [isCcDragOver, setIsCcDragOver] = useState(false);

  const previewEndpoint = isDashboard
    ? '/pending-items/dashboard-summary/preview-email'
    : '/pending-items/preview-summary-email';

  const sendEndpoint = isDashboard
    ? '/pending-items/dashboard-summary/send-email'
    : '/pending-items/send-summary-email';

  // Fetch preview data and defaults from backend
  const { data: previewData, isLoading, error: fetchError } = useQuery({
    queryKey: ['pending-items-mail-preview', mode, role, stage],
    queryFn: () =>
      api.post<PreviewPendingSummaryEmailResponse>(previewEndpoint, {
        role,
        stage: isDashboard ? null : stage,
      }),
    staleTime: 60_000,
  });

  // Populate form with default preview data once loaded
  useEffect(() => {
    if (previewData) {
      setSubject(previewData.subject);
      setToEmails(previewData.defaultToEmails);
      setCcEmails(
        previewData.defaultCcEmails && previewData.defaultCcEmails.length > 0
          ? previewData.defaultCcEmails
          : ['purchase@ozellar.com']
      );
    }
  }, [previewData]);

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post<SendPendingSummaryEmailResponse>(sendEndpoint, {
        role,
        stage: isDashboard ? null : stage,
        subject,
        toEmails,
        ccEmails,
      }),
    onSuccess: (res) => {
      const attachDesc = res.attachmentFilenames && res.attachmentFilenames.length > 0
        ? `${res.attachmentFilenames.length} separate Excel attachments`
        : `attachment "${res.attachmentFilename}"`;
      onSuccess(
        `Summary email successfully dispatched to ${res.recipients.length} recipients with ${attachDesc}.`
      );
      onClose();
    },
    onError: (err) => {
      setSendError(err instanceof ApiError ? err.message : 'Failed to send summary email.');
    },
  });

  function handleAddToEmail() {
    const val = toInput.trim();
    if (!val) return;
    if (!toEmails.includes(val)) {
      setToEmails([...toEmails, val]);
    }
    setToInput('');
  }

  function handleRemoveToEmail(emailToRemove: string) {
    setToEmails(toEmails.filter((e) => e !== emailToRemove));
  }

  function handleToKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddToEmail();
    }
  }

  function handleAddCcEmail() {
    const val = ccInput.trim();
    if (!val) return;
    if (!ccEmails.includes(val)) {
      setCcEmails([...ccEmails, val]);
    }
    setCcInput('');
  }

  function handleRemoveCcEmail(emailToRemove: string) {
    setCcEmails(ccEmails.filter((e) => e !== emailToRemove));
  }

  function handleCcKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddCcEmail();
    }
  }

  /* ── Drag & Drop Handlers between TO and CC ── */
  function handleDragStart(e: React.DragEvent, email: string, from: 'to' | 'cc') {
    setDraggedItem({ email, from });
    e.dataTransfer.setData('text/plain', email);
    e.dataTransfer.setData('application/json', JSON.stringify({ email, from }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnd() {
    setDraggedItem(null);
    setIsToDragOver(false);
    setIsCcDragOver(false);
  }

  function handleDragOverTo(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isToDragOver) setIsToDragOver(true);
  }

  function handleDragLeaveTo(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsToDragOver(false);
    }
  }

  function handleDropTo(e: React.DragEvent) {
    e.preventDefault();
    setIsToDragOver(false);
    let email = '';
    let from = '';
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (raw) {
        const parsed = JSON.parse(raw);
        email = parsed.email;
        from = parsed.from;
      }
    } catch {
      email = e.dataTransfer.getData('text/plain');
    }
    if (!email && draggedItem) {
      email = draggedItem.email;
      from = draggedItem.from;
    }
    if (!email) return;

    const clean = email.trim();
    if (from === 'cc' || draggedItem?.from === 'cc') {
      setCcEmails((prev) => prev.filter((item) => item.toLowerCase() !== clean.toLowerCase()));
    }
    setToEmails((prev) => {
      if (prev.some((item) => item.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
    setDraggedItem(null);
  }

  function handleDragOverCc(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isCcDragOver) setIsCcDragOver(true);
  }

  function handleDragLeaveCc(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsCcDragOver(false);
    }
  }

  function handleDropCc(e: React.DragEvent) {
    e.preventDefault();
    setIsCcDragOver(false);
    let email = '';
    let from = '';
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (raw) {
        const parsed = JSON.parse(raw);
        email = parsed.email;
        from = parsed.from;
      }
    } catch {
      email = e.dataTransfer.getData('text/plain');
    }
    if (!email && draggedItem) {
      email = draggedItem.email;
      from = draggedItem.from;
    }
    if (!email) return;

    const clean = email.trim();
    if (from === 'to' || draggedItem?.from === 'to') {
      setToEmails((prev) => prev.filter((item) => item.toLowerCase() !== clean.toLowerCase()));
    }
    setCcEmails((prev) => {
      if (prev.some((item) => item.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
    setDraggedItem(null);
  }

  function handleMoveToCc(email: string) {
    const clean = email.trim();
    setToEmails((prev) => prev.filter((item) => item.toLowerCase() !== clean.toLowerCase()));
    setCcEmails((prev) => {
      if (prev.some((item) => item.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
  }

  function handleMoveToTo(email: string) {
    const clean = email.trim();
    setCcEmails((prev) => prev.filter((item) => item.toLowerCase() !== clean.toLowerCase()));
    setToEmails((prev) => {
      if (prev.some((item) => item.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
  }

  function handleResetToDefaults() {
    if (previewData) {
      setToEmails(previewData.defaultToEmails);
      setCcEmails(
        previewData.defaultCcEmails && previewData.defaultCcEmails.length > 0
          ? previewData.defaultCcEmails
          : ['purchase@ozellar.com']
      );
      setSubject(previewData.subject);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (toInput.trim()) {
      handleAddToEmail();
    }
    if (ccInput.trim()) {
      handleAddCcEmail();
    }
    setSendError(null);
    sendMutation.mutate();
  }

  const roleLabel = role === 'TSI' ? ROLE_LABELS.TSI : role === 'TA' ? ROLE_LABELS.TA : `All (${ROLE_LABELS.TSI} & ${ROLE_LABELS.TA})`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel pending-mail-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pending-mail-modal-header">
          <div className="pending-mail-header-left">
            <div className="pending-mail-header-icon">
              <MailIcon />
            </div>
            <div className="pending-mail-title-wrap">
              <h2>
                <span>{isDashboard ? 'Send Dashboard & Trend Summary Email' : 'Send Pending Summary Email'}</span>
                <span
                  className={
                    role === 'TSI'
                      ? 'badge-rank-tsi'
                      : role === 'TA'
                        ? 'badge-rank-ta'
                        : 'role-pill editor'
                  }
                >
                  {roleLabel}
                </span>
              </h2>
              <p className="pending-mail-title-desc">
                {isDashboard
                  ? 'Review recipient list, customize subject, and preview the generated 5-week trend HTML table and executive Excel attachment.'
                  : 'Review recipient list, customize subject, and preview the generated HTML summary table and Excel attachment.'}
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
            <div>{isDashboard ? 'Generating email preview & 5-week trend summary…' : 'Generating email preview & ageing matrix table…'}</div>
          </div>
        ) : fetchError ? (
          <div className="modal-body">
            <div className="pending-mail-error-banner">
              <AlertTriangleIcon />
              <span>
                {fetchError instanceof ApiError
                  ? fetchError.message
                  : 'Failed to generate preview data for pending summary email.'}
              </span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div className="pending-mail-modal-body">
              {/* Card 1: Sender & Delivery Info */}
              <div className="pending-mail-sender-card">
                <div className="pending-mail-sender-info">
                  <span className="pending-mail-sender-label">From Mailbox:</span>
                  <span className="pending-mail-sender-addr">
                    {previewData?.fromMailbox || 'data@ozellar.com'}
                  </span>
                </div>
                <span className="pending-mail-verified-badge">
                  <CheckCircleIcon />
                  <span>Verified Sender</span>
                </span>
              </div>

              {/* Card 2: Attachment Preview */}
              <div className="pending-mail-attachment-card">
                <div className="pending-mail-attachment-left">
                  <div className="pending-mail-attachment-icon">
                    <FileSpreadsheetIcon />
                  </div>
                  <div>
                    <div className="pending-mail-attachment-name">
                      {isDashboard && previewData?.attachmentFilenames && previewData.attachmentFilenames.length > 0
                        ? `${previewData.attachmentFilenames.length} Separate Excel Attachments (Requisition, PO, Invoice)`
                        : previewData?.attachmentFilename}
                    </div>
                    {isDashboard && previewData?.attachmentFilenames && previewData.attachmentFilenames.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px' }}>
                        {previewData.attachmentFilenames.map((fname, idx) => (
                          <div key={idx} style={{ fontSize: '11px', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: idx === 0 ? '#2563eb' : idx === 1 ? '#d97706' : '#059669' }} />
                            <span style={{ fontWeight: 600 }}>{fname}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="pending-mail-attachment-desc" style={{ marginTop: '4px' }}>
                      {isDashboard
                        ? '3 separate workbooks (Requisitions, POs, Invoices), each with 5 interactive sheets: Ageing Summary, bracket breakdowns, and line items'
                        : 'Generated Excel workbook (.xlsx) with Ageing Matrix & interactive drill-down sheets'}
                    </div>
                  </div>
                </div>
                <span className="pending-mail-attachment-badge">
                  {previewData?.itemsCount} Items
                </span>
              </div>

              {/* View Tabs */}
              <div className="pending-mail-preview-wrapper">
                <div className="pending-mail-preview-top">
                  <span className="pending-mail-preview-title">
                    {activeTab === 'details' ? (
                      <>
                        <EditIcon /> Email Configuration &amp; Recipients
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
                    {/* To Recipients */}
                    <div className="pending-mail-field-row">
                      <div className="pending-mail-field-header">
                        <label className="pending-mail-field-label">
                          <span>To (Recipients):</span>
                          <span style={{ color: '#64748B', fontWeight: 400 }}>
                            ({toEmails.length} active members • Drag or click arrow to move to CC)
                          </span>
                        </label>
                        <button
                          type="button"
                          className="pending-mail-action-btn"
                          onClick={handleResetToDefaults}
                          title={`Reset to default ${ROLE_LABELS.TSI}/${ROLE_LABELS.TA} roster recipients`}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <RotateCcwIcon /> Reset Defaults
                          </span>
                        </button>
                      </div>

                      <div
                        className={`pending-mail-chips-box ${isToDragOver ? 'drag-over' : ''}`}
                        onDragOver={handleDragOverTo}
                        onDragLeave={handleDragLeaveTo}
                        onDrop={handleDropTo}
                      >
                        {toEmails.map((e) => (
                          <span
                            key={e}
                            className={`pending-mail-chip ${draggedItem?.email === e ? 'is-dragging' : ''}`}
                            draggable
                            onDragStart={(evt) => handleDragStart(evt, e, 'to')}
                            onDragEnd={handleDragEnd}
                            title="Drag to CC or click arrow to move"
                          >
                            <span className="pending-mail-chip-drag-handle" aria-hidden="true">
                              <GripVerticalIcon />
                            </span>
                            <span className="pending-mail-chip-text">{e}</span>
                            <button
                              type="button"
                              className="pending-mail-chip-move"
                              onClick={() => handleMoveToCc(e)}
                              title="Move to CC"
                              aria-label={`Move ${e} to CC`}
                            >
                              <ArrowDownIcon />
                            </button>
                            <button
                              type="button"
                              className="pending-mail-chip-remove"
                              onClick={() => handleRemoveToEmail(e)}
                              aria-label={`Remove ${e}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {isToDragOver && (
                          <span className="pending-mail-drop-indicator">
                            Drop here to move to To
                          </span>
                        )}
                        <input
                          type="email"
                          className="pending-mail-chip-input"
                          placeholder="Type email &amp; press Enter to add…"
                          value={toInput}
                          onChange={(e) => setToInput(e.target.value)}
                          onKeyDown={handleToKeyDown}
                          onBlur={handleAddToEmail}
                        />
                      </div>
                    </div>

                    {/* CC Recipients */}
                    <div className="pending-mail-field-row">
                      <div className="pending-mail-field-header">
                        <label className="pending-mail-field-label">
                          <span>CC (Optional):</span>
                          <span style={{ color: '#64748B', fontWeight: 400 }}>
                            ({ccEmails.length} copy recipients • Drag or click arrow to move to To)
                          </span>
                        </label>
                      </div>

                      <div
                        className={`pending-mail-chips-box ${isCcDragOver ? 'drag-over' : ''}`}
                        onDragOver={handleDragOverCc}
                        onDragLeave={handleDragLeaveCc}
                        onDrop={handleDropCc}
                      >
                        {ccEmails.map((e) => (
                          <span
                            key={e}
                            className={`pending-mail-chip cc ${draggedItem?.email === e ? 'is-dragging' : ''}`}
                            draggable
                            onDragStart={(evt) => handleDragStart(evt, e, 'cc')}
                            onDragEnd={handleDragEnd}
                            title="Drag to To or click arrow to move"
                          >
                            <span className="pending-mail-chip-drag-handle" aria-hidden="true">
                              <GripVerticalIcon />
                            </span>
                            <span className="pending-mail-chip-text">{e}</span>
                            <button
                              type="button"
                              className="pending-mail-chip-move"
                              onClick={() => handleMoveToTo(e)}
                              title="Move to To"
                              aria-label={`Move ${e} to To`}
                            >
                              <ArrowUpIcon />
                            </button>
                            <button
                              type="button"
                              className="pending-mail-chip-remove"
                              onClick={() => handleRemoveCcEmail(e)}
                              aria-label={`Remove ${e}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {isCcDragOver && (
                          <span className="pending-mail-drop-indicator">
                            Drop here to move to CC
                          </span>
                        )}
                        <input
                          type="email"
                          className="pending-mail-chip-input"
                          placeholder="Add CC email &amp; press Enter…"
                          value={ccInput}
                          onChange={(e) => setCcInput(e.target.value)}
                          onKeyDown={handleCcKeyDown}
                          onBlur={handleAddCcEmail}
                        />
                      </div>
                    </div>

                    {/* Subject */}
                    <div className="pending-mail-field-row">
                      <label className="pending-mail-field-label">
                        <span>Subject Line:</span>
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
                  </div>
                ) : (
                  <div>
                    <div className="pending-mail-iframe-container">
                      <iframe
                        title="Email Body Preview"
                        className="pending-mail-iframe"
                        srcDoc={previewData?.htmlBody}
                        sandbox="allow-same-origin"
                      />
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#64748B', marginTop: 6 }}>
                      Exact HTML preview matching the email body and Excel Ageing Matrix summary sheet.
                    </div>
                  </div>
                )}
              </div>

              {/* Error Alert */}
              {sendError && (
                <div className="pending-mail-error-banner">
                  <AlertTriangleIcon />
                  <span>{sendError}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="pending-mail-modal-footer">
              <div className="pending-mail-footer-summary">
                Delivery: <strong>{toEmails.length}</strong> recipient{toEmails.length !== 1 ? 's' : ''}
                {ccEmails.length > 0 && (
                  <span>
                    {' '}· <strong>{ccEmails.length}</strong> CC
                  </span>
                )}
              </div>

              <div className="pending-mail-footer-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClose}
                  disabled={sendMutation.isPending}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="pending-mail-btn-send"
                  disabled={sendMutation.isPending || toEmails.length === 0}
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
