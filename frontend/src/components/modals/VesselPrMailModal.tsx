import { useState, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type {
  PreviewVesselPrReviewEmailResponse,
  SendVesselPrReviewEmailResponse,
  VesselPrReviewEmailRequest,
} from '../../shared';

import './VesselPrMailModal.css';

interface Props {
  vesselName: string;
  prType: 'critical' | 'ageing_90' | 'all';
  role?: 'ALL' | 'TSI' | 'TA';
  onClose: () => void;
  onSuccess: (message: string) => void;
}

/* ── Vector SVG Icons (Zero Emojis) ── */
function ShipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76" />
      <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" />
      <path d="M12 2v3" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

function AlertTriangleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function VesselPrMailModal({ vesselName, prType, role = 'ALL', onClose, onSuccess }: Props) {
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

  // Fetch preview data and defaults from backend
  const { data: previewData, isLoading, error: fetchError } = useQuery({
    queryKey: ['vessel-pr-review-preview', vesselName, prType, role],
    queryFn: () =>
      api.post<PreviewVesselPrReviewEmailResponse>('/pending-items/vessel-pr-review/preview-email', {
        vesselName,
        prType,
        role,
      } as VesselPrReviewEmailRequest),
    staleTime: 60_000,
  });

  // Populate form with default preview data once loaded
  useEffect(() => {
    if (previewData) {
      setSubject(previewData.subject);
      setToEmails(previewData.defaultToEmails || []);
      setCcEmails(
        previewData.defaultCcEmails && previewData.defaultCcEmails.length > 0
          ? previewData.defaultCcEmails
          : ['kunalchandra@ozellar.com', 'Karunya.pius@ozellar.com', 'data@ozellar.com']
      );
    }
  }, [previewData]);

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post<SendVesselPrReviewEmailResponse>('/pending-items/vessel-pr-review/send-email', {
        vesselName,
        prType,
        role,
        subject,
        toEmails,
        ccEmails,
      } as VesselPrReviewEmailRequest),
    onSuccess: (res) => {
      onSuccess(
        `Technical review inquiry for ${res.vesselName} sent to ${res.recipients.join(', ')} with attachment "${res.attachmentFilename}".`
      );
      onClose();
    },
    onError: (err) => {
      setSendError(err instanceof ApiError ? err.message : 'Failed to dispatch vessel review email.');
    },
  });

  function handleAddToEmail() {
    const val = toInput.trim();
    if (!val) return;
    if (!toEmails.some((e) => e.toLowerCase() === val.toLowerCase())) {
      setToEmails([...toEmails, val]);
    }
    setToInput('');
  }

  function handleRemoveToEmail(emailToRemove: string) {
    setToEmails(toEmails.filter((e) => e.toLowerCase() !== emailToRemove.toLowerCase()));
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
    if (!ccEmails.some((e) => e.toLowerCase() === val.toLowerCase())) {
      setCcEmails([...ccEmails, val]);
    }
    setCcInput('');
  }

  function handleRemoveCcEmail(emailToRemove: string) {
    setCcEmails(ccEmails.filter((e) => e.toLowerCase() !== emailToRemove.toLowerCase()));
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

  function moveChip(email: string, target: 'to' | 'cc') {
    const clean = email.trim();
    if (target === 'cc') {
      setToEmails((prev) => prev.filter((item) => item.toLowerCase() !== clean.toLowerCase()));
      setCcEmails((prev) => {
        if (prev.some((item) => item.toLowerCase() === clean.toLowerCase())) return prev;
        return [...prev, clean];
      });
    } else {
      setCcEmails((prev) => prev.filter((item) => item.toLowerCase() !== clean.toLowerCase()));
      setToEmails((prev) => {
        if (prev.some((item) => item.toLowerCase() === clean.toLowerCase())) return prev;
        return [...prev, clean];
      });
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSendError(null);
    if (toEmails.length === 0) {
      setSendError('Please specify at least one recipient (TO).');
      return;
    }
    sendMutation.mutate();
  }

  const typeLabel =
    prType === 'ageing_90'
      ? '90+ Days Overdue Requisitions'
      : prType === 'critical'
        ? 'Critical / High Priority Requisitions'
        : 'All Outstanding Requisitions';

  return (
    <div className="vessel-mail-modal-overlay" onClick={onClose}>
      <div className="vessel-mail-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="vessel-mail-modal-header">
          <div className="vessel-mail-header-left">
            <div className="vessel-mail-icon-wrap">
              <ShipIcon />
            </div>
            <div>
              <h2 className="vessel-mail-modal-title">
                Technical Review Email: <span className="vessel-mail-title-ship">{vesselName}</span>
              </h2>
              <p className="vessel-mail-modal-subtitle">
                {typeLabel} · Review & Cancellation of Pending Requisitions
              </p>
            </div>
          </div>
          <button type="button" className="vessel-mail-close-btn" onClick={onClose} aria-label="Close dialog">
            <CloseIcon />
          </button>
        </div>

        {/* View Switcher Tabs */}
        <div className="vessel-mail-tabs-bar">
          <button
            type="button"
            className={`vessel-mail-tab-btn ${activeTab === 'details' ? 'active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            <EditIcon />
            <span>Email Details &amp; PR Table</span>
          </button>
          <button
            type="button"
            className={`vessel-mail-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
          >
            <EyeIcon />
            <span>Formal Letter Preview</span>
          </button>
        </div>

        {isLoading ? (
          <div className="vessel-mail-loading-box">
            <div className="vessel-mail-spinner" />
            <p>Compiling technical PR audit &amp; resolving TSI/TA recipients for {vesselName}...</p>
          </div>
        ) : fetchError ? (
          <div className="vessel-mail-error-banner">
            <AlertTriangleIcon />
            <div>
              <strong>Failed to prepare email:</strong>{' '}
              {fetchError instanceof ApiError ? fetchError.message : 'Error loading vessel PR preview data.'}
            </div>
          </div>
        ) : (
          <form className="vessel-mail-form" onSubmit={handleSubmit}>
            {activeTab === 'details' ? (
              <div className="vessel-mail-tab-content">
                {/* Mailbox Row */}
                <div className="vessel-mail-field-row">
                  <span className="vessel-mail-field-label">From:</span>
                  <div className="vessel-mail-static-from">
                    <span className="vessel-mail-from-pill">
                      <MailIcon />
                      <span>{previewData?.fromMailbox || 'data@ozellar.com'}</span>
                    </span>
                    <span className="vessel-mail-auth-badge">
                      <CheckCircleIcon />
                      <span>Authenticated Maritime Operations Mailbox</span>
                    </span>
                  </div>
                </div>

                {/* TO Field */}
                <div className="vessel-mail-field-row">
                  <div className="vessel-mail-field-label-group">
                    <span className="vessel-mail-field-label">To (Action):</span>
                    <span className="vessel-mail-field-hint">In-Charge (TSI, TA) &amp; Vessel Master</span>
                  </div>
                  <div
                    className={`vessel-mail-chip-container ${isToDragOver ? 'drag-over' : ''}`}
                    onDragOver={handleDragOverTo}
                    onDragLeave={handleDragLeaveTo}
                    onDrop={handleDropTo}
                  >
                    {toEmails.map((email) => (
                      <span
                        key={email}
                        className="vessel-mail-chip vessel-mail-chip-to"
                        draggable
                        onDragStart={(e) => handleDragStart(e, email, 'to')}
                        onDragEnd={handleDragEnd}
                        title="Drag or click arrow to move to CC"
                      >
                        <span className="vessel-mail-chip-grip">
                          <GripVerticalIcon />
                        </span>
                        <span className="vessel-mail-chip-text">{email}</span>
                        <button
                          type="button"
                          className="vessel-mail-chip-move"
                          onClick={() => moveChip(email, 'cc')}
                          title="Move to CC"
                        >
                          <ArrowDownIcon />
                        </button>
                        <button
                          type="button"
                          className="vessel-mail-chip-remove"
                          onClick={() => handleRemoveToEmail(email)}
                          title="Remove recipient"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    <input
                      type="email"
                      className="vessel-mail-chip-input"
                      placeholder={toEmails.length === 0 ? 'Type email and press Enter...' : 'Add more...'}
                      value={toInput}
                      onChange={(e) => setToInput(e.target.value)}
                      onKeyDown={handleToKeyDown}
                      onBlur={handleAddToEmail}
                    />
                  </div>
                </div>

                {/* CC Field */}
                <div className="vessel-mail-field-row">
                  <div className="vessel-mail-field-label-group">
                    <span className="vessel-mail-field-label">CC:</span>
                    <span className="vessel-mail-field-hint">Purchase Team</span>
                  </div>
                  <div
                    className={`vessel-mail-chip-container ${isCcDragOver ? 'drag-over' : ''}`}
                    onDragOver={handleDragOverCc}
                    onDragLeave={handleDragLeaveCc}
                    onDrop={handleDropCc}
                  >
                    {ccEmails.map((email) => (
                      <span
                        key={email}
                        className="vessel-mail-chip vessel-mail-chip-cc"
                        draggable
                        onDragStart={(e) => handleDragStart(e, email, 'cc')}
                        onDragEnd={handleDragEnd}
                        title="Drag or click arrow to move to TO"
                      >
                        <span className="vessel-mail-chip-grip">
                          <GripVerticalIcon />
                        </span>
                        <span className="vessel-mail-chip-text">{email}</span>
                        <button
                          type="button"
                          className="vessel-mail-chip-move"
                          onClick={() => moveChip(email, 'to')}
                          title="Move to TO"
                        >
                          <ArrowUpIcon />
                        </button>
                        <button
                          type="button"
                          className="vessel-mail-chip-remove"
                          onClick={() => handleRemoveCcEmail(email)}
                          title="Remove CC recipient"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    <input
                      type="email"
                      className="vessel-mail-chip-input"
                      placeholder={ccEmails.length === 0 ? 'Type CC email and press Enter...' : 'Add more CC...'}
                      value={ccInput}
                      onChange={(e) => setCcInput(e.target.value)}
                      onKeyDown={handleCcKeyDown}
                      onBlur={handleAddCcEmail}
                    />
                  </div>
                </div>

                {/* Subject Field */}
                <div className="vessel-mail-field-row">
                  <span className="vessel-mail-field-label">Subject:</span>
                  <input
                    type="text"
                    className="vessel-mail-subject-input"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                  />
                </div>

                {/* Excel Attachment Card */}
                <div className="vessel-mail-attachment-card">
                  <div className="vessel-mail-attachment-icon">
                    <FileSpreadsheetIcon />
                  </div>
                  <div className="vessel-mail-attachment-info">
                    <div className="vessel-mail-attachment-name">
                      {previewData?.attachmentFilename || `M_V_${vesselName}_PR_Review.xlsx`}
                    </div>
                    <div className="vessel-mail-attachment-desc">
                      Generated Excel review workbook itemizing {previewData?.itemsCount || 0} requisitions with full technical details and action columns.
                    </div>
                  </div>
                  <span className="vessel-mail-attachment-tag">Automated Attachment</span>
                </div>

                {/* Itemized Requisitions Preview List */}
                <div className="vessel-mail-items-section">
                  <div className="vessel-mail-items-header">
                    <span className="vessel-mail-items-title">
                      Itemized Requisitions for {vesselName} ({previewData?.itemsCount || 0})
                    </span>
                    <span className="vessel-mail-action-legend">
                      Please review the list and advise if any requisitions are no longer required and can be cancelled
                    </span>
                  </div>

                  <div className="vessel-mail-table-wrap">
                    <table className="vessel-mail-table">
                      <thead>
                        <tr>
                          <th style={{ width: 40, textAlign: 'center' }}>#</th>
                          <th style={{ width: 140 }}>PR Number</th>
                          <th style={{ width: 100 }}>Created</th>
                          <th style={{ width: 100 }}>Dept</th>
                          <th>Description / Equipment</th>
                          <th style={{ width: 90, textAlign: 'center' }}>Priority</th>
                          <th style={{ width: 95, textAlign: 'center' }}>Status</th>
                          <th style={{ width: 90, textAlign: 'center' }}>Ageing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(previewData?.items || []).map((item, idx) => {
                          const prio = (item.priority || 'NORMAL').toUpperCase();
                          const age = item.ageingDays || 0;
                          return (
                            <tr key={`${item.referenceNo}-${idx}`}>
                              <td style={{ textAlign: 'center', color: '#64748B' }}>{idx + 1}</td>
                              <td className="vessel-mail-pr-no">{item.referenceNo}</td>
                              <td style={{ whiteSpace: 'nowrap', fontSize: '11.5px', color: '#475569' }}>
                                {item.referenceDate ? item.referenceDate.split('T')[0] : '—'}
                              </td>
                              <td style={{ fontSize: '11.5px', color: '#334155' }}>
                                {item.department || item.reqCategory || 'Technical'}
                              </td>
                              <td className="vessel-mail-pr-desc">{item.title || 'Requisition Items'}</td>
                              <td style={{ textAlign: 'center' }}>
                                {item.critical ? (
                                  <span className="vessel-prio-badge badge-critical">CRITICAL</span>
                                ) : prio === 'URGENT/IMMEDIATE' || prio === 'HIGH' ? (
                                  <span className="vessel-prio-badge badge-high">{prio}</span>
                                ) : (
                                  <span className="vessel-prio-badge badge-normal">{prio}</span>
                                )}
                              </td>
                              <td style={{ textAlign: 'center', fontSize: '11.5px', fontWeight: 600, color: '#0F172A' }}>
                                {item.status || 'Pending'}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span className={`vessel-age-badge ${age > 90 ? 'age-severe' : age > 30 ? 'age-moderate' : 'age-normal'}`}>
                                  {age}d
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="vessel-mail-tab-content preview-pane">
                <div className="vessel-mail-html-preview-card">
                  <div
                    className="vessel-mail-html-body"
                    dangerouslySetInnerHTML={{ __html: previewData?.htmlBody || '<p>No preview generated</p>' }}
                  />
                </div>
              </div>
            )}

            {/* Error Banner */}
            {sendError && (
              <div className="vessel-mail-error-banner">
                <AlertTriangleIcon />
                <span>{sendError}</span>
              </div>
            )}

            {/* Footer */}
            <div className="vessel-mail-modal-footer">
              <button type="button" className="vessel-mail-btn-secondary" onClick={onClose} disabled={sendMutation.isPending}>
                Cancel
              </button>
              <button type="submit" className="vessel-mail-btn-primary" disabled={sendMutation.isPending || toEmails.length === 0}>
                {sendMutation.isPending ? (
                  <>
                    <div className="vessel-mail-btn-spinner" />
                    <span>Dispatching Review Email...</span>
                  </>
                ) : (
                  <>
                    <SendIcon />
                    <span>Send Technical Review Email</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
