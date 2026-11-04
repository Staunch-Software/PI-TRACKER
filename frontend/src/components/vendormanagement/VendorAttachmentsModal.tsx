import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { uploadVendorBankAttachment } from '../../lib/vendorAttachmentUpload';
import type { TrackedVendorEntry, VendorBankAttachment, VendorMasterAttachment } from '../../shared';
import { Toast } from '../common/Toast';

interface Props {
  entry: TrackedVendorEntry;
  canEdit: boolean;
  onClose: () => void;
}

type TabKey = 'all' | 'smartpal' | 'bank';

interface FileKindInfo {
  label: string;
  color: string;
  bg: string;
  border: string;
  type: 'pdf' | 'image' | 'word' | 'excel' | 'file';
}

function getFileKindInfo(fileName: string, contentType?: string): FileKindInfo {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf' || contentType === 'application/pdf') {
    return { label: 'PDF', color: '#b91c1c', bg: '#fef2f2', border: '#fecaca', type: 'pdf' };
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'].includes(ext) || contentType?.startsWith('image/')) {
    return { label: 'IMG', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', type: 'image' };
  }
  if (['doc', 'docx'].includes(ext) || contentType?.includes('word')) {
    return { label: 'DOC', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', type: 'word' };
  }
  if (['xls', 'xlsx', 'csv'].includes(ext) || contentType?.includes('excel') || contentType?.includes('spreadsheet')) {
    return { label: 'XLS', color: '#047857', bg: '#ecfdf5', border: '#a7f3d0', type: 'excel' };
  }
  return { label: ext.toUpperCase() || 'FILE', color: '#334155', bg: '#f1f5f9', border: '#cbd5e1', type: 'file' };
}

function FileTypeIcon({ type }: { type: FileKindInfo['type'] }) {
  switch (type) {
    case 'pdf':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    case 'image':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    case 'word':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
      );
    case 'excel':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M8 13h8" />
          <path d="M8 17h8" />
          <path d="M10 9h4" />
        </svg>
      );
    default:
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
  }
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function VendorAttachmentsModal({ entry, canEdit, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [isDragOver, setIsDragOver] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-bank-attachments', entry.id] });
    },
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : 'Upload failed.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => api.delete(`/vendor-management/${entry.id}/attachments/${attachmentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-bank-attachments', entry.id] });
      setDeleteConfirmId(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to delete attachment.'),
  });

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => uploadMutation.mutate(file));
    e.target.value = '';
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (!canEdit) return;
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file) => uploadMutation.mutate(file));
    }
  }

  const smartpalDocs = smartpalDocsQuery.data ?? [];
  const bankDocs = bankDocsQuery.data ?? [];
  const totalCount = smartpalDocs.length + bankDocs.length;

  return (
    <div className="vendor-docs-modal-overlay" onClick={onClose}>
      <div className="vendor-docs-modal-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="vendor-docs-modal-header">
          <div className="vendor-docs-header-left">
            <div className="vendor-docs-header-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <div className="vendor-docs-header-titles">
              <h2>{entry.vendorName ?? entry.vendorCode}</h2>
              <div className="vendor-docs-header-sub">
                <span className="vendor-docs-code-pill">{entry.vendorCode}</span>
                <span>• Full Documents & Verification Center</span>
              </div>
            </div>
          </div>
          <button className="vendor-docs-close-btn" onClick={onClose} aria-label="Close" title="Close modal">
            ✕
          </button>
        </div>

        {/* Tab switcher */}
        <div className="vendor-docs-tabs">
          <button
            type="button"
            className={`vendor-docs-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Documents
            <span className="vendor-docs-tab-count">{totalCount}</span>
          </button>
          <button
            type="button"
            className={`vendor-docs-tab-btn ${activeTab === 'smartpal' ? 'active' : ''}`}
            onClick={() => setActiveTab('smartpal')}
          >
            SmartPAL Master
            <span className="vendor-docs-tab-count">{smartpalDocs.length}</span>
          </button>
          <button
            type="button"
            className={`vendor-docs-tab-btn ${activeTab === 'bank' ? 'active' : ''}`}
            onClick={() => setActiveTab('bank')}
          >
            Bank Reply Uploads
            <span className="vendor-docs-tab-count">{bankDocs.length}</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="vendor-docs-modal-body">
          {/* Drag & Drop Upload Zone for Verified Bank Reply */}
          {canEdit && (activeTab === 'all' || activeTab === 'bank') && (
            <div
              className={`vendor-docs-dropzone ${isDragOver ? 'drag-active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileChange} />
              <div className="vendor-docs-dropzone-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="vendor-docs-dropzone-title">
                {uploadMutation.isPending ? 'Uploading documents…' : 'Upload Bank Reply & Verification Documents'}
              </div>
              <div className="vendor-docs-dropzone-subtitle">
                Drag & drop files here, or click to browse (PDF, PNG, JPG, DOCX, XLSX up to 25MB)
              </div>
              <button
                type="button"
                className="vendor-docs-dropzone-btn"
                disabled={uploadMutation.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                {uploadMutation.isPending ? 'Uploading…' : '+ Select Files to Upload'}
              </button>
            </div>
          )}

          {/* Document Lists */}
          <div className="vendor-docs-list">
            {smartpalDocsQuery.isLoading || bankDocsQuery.isLoading ? (
              <div className="vendor-docs-empty-state">
                <div className="tracker-loading-spinner" />
                <div style={{ color: '#64748b', fontSize: 13, marginTop: 8 }}>Loading documents…</div>
              </div>
            ) : totalCount === 0 ? (
              <div className="vendor-docs-empty-state">
                <div className="vendor-docs-empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="vendor-docs-empty-title">No documents available</div>
                <div className="vendor-docs-empty-desc">
                  No documents have been scraped from SmartPAL or uploaded as bank reply proof for this vendor yet.
                </div>
              </div>
            ) : (
              <>
                {/* 1. SmartPAL Scraped Documents */}
                {(activeTab === 'all' || activeTab === 'smartpal') && (
                  <>
                    {activeTab === 'all' && smartpalDocs.length > 0 && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#0f4c81', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0 2px' }}>
                        SmartPAL Master Documents ({smartpalDocs.length})
                      </div>
                    )}
                    {smartpalDocs.map((doc) => {
                      const kind = getFileKindInfo(doc.fileName, doc.contentType);
                      return (
                        <div key={`smartpal-${doc.id}`} className="vendor-doc-card">
                          <div
                            className="vendor-doc-type-icon"
                            style={{ color: kind.color, background: kind.bg, borderColor: kind.border }}
                          >
                            <FileTypeIcon type={kind.type} />
                          </div>
                          <div className="vendor-doc-info">
                            <div className="vendor-doc-title-row">
                              <a
                                href={doc.downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="vendor-doc-name"
                                title={doc.fileName}
                              >
                                {doc.fileName}
                              </a>
                              <span className="vendor-doc-source-tag vendor-doc-source-smartpal">
                                SmartPAL Scrape
                              </span>
                            </div>
                            <div className="vendor-doc-meta">
                              <span>Size: <strong>{formatSize(doc.sizeBytes)}</strong></span>
                              {doc.smartpalUploadedAt && (
                                <span>Date: {formatDate(doc.smartpalUploadedAt)}</span>
                              )}
                              {doc.smartpalUploadedBy && (
                                <span>By: {doc.smartpalUploadedBy}</span>
                              )}
                            </div>
                          </div>
                          <div className="vendor-doc-actions">
                            <a
                              href={doc.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="vendor-doc-action-btn"
                              title="Download / View document"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                              <span>View / Download</span>
                            </a>
                          </div>
                        </div>
                      );
                    })}
                    {activeTab === 'smartpal' && smartpalDocs.length === 0 && (
                      <div className="vendor-docs-empty-state">
                        <div className="vendor-docs-empty-title">No SmartPAL Documents Scraped</div>
                        <div className="vendor-docs-empty-desc">
                          No attachments exist for vendor code <strong>{entry.vendorCode}</strong> in the SmartPAL vendor master.
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* 2. Bank Reply Documents */}
                {(activeTab === 'all' || activeTab === 'bank') && (
                  <>
                    {activeTab === 'all' && bankDocs.length > 0 && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '14px 0 2px' }}>
                        Verified Bank Reply Documents ({bankDocs.length})
                      </div>
                    )}
                    {bankDocs.map((doc) => {
                      const kind = getFileKindInfo(doc.fileName, doc.contentType);
                      const isConfirming = deleteConfirmId === doc.id;
                      return (
                        <div key={`bank-${doc.id}`} className="vendor-doc-card">
                          <div
                            className="vendor-doc-type-icon"
                            style={{ color: kind.color, background: kind.bg, borderColor: kind.border }}
                          >
                            <FileTypeIcon type={kind.type} />
                          </div>
                          <div className="vendor-doc-info">
                            <div className="vendor-doc-title-row">
                              <a
                                href={doc.downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="vendor-doc-name"
                                title={doc.fileName}
                              >
                                {doc.fileName}
                              </a>
                              <span className="vendor-doc-source-tag vendor-doc-source-bank">
                                Bank Reply Proof
                              </span>
                            </div>
                            <div className="vendor-doc-meta">
                              <span>Size: <strong>{formatSize(doc.sizeBytes)}</strong></span>
                              <span>Uploaded: {formatDate(doc.uploadedAt)}</span>
                              {doc.uploadedByName && (
                                <span>By: {doc.uploadedByName}</span>
                              )}
                            </div>
                          </div>
                          <div className="vendor-doc-actions">
                            <a
                              href={doc.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="vendor-doc-action-btn"
                              title="Download / View document"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                              <span>View / Download</span>
                            </a>
                            {canEdit && (
                              isConfirming ? (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <button
                                    type="button"
                                    className="vendor-doc-delete-btn"
                                    style={{ background: '#dc2626', color: '#fff', width: 'auto', padding: '0 8px', fontSize: 11 }}
                                    onClick={() => deleteMutation.mutate(doc.id)}
                                    disabled={deleteMutation.isPending}
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    type="button"
                                    className="vendor-doc-action-btn"
                                    style={{ padding: '4px 8px', fontSize: 11 }}
                                    onClick={() => setDeleteConfirmId(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="vendor-doc-delete-btn"
                                  title="Delete document"
                                  onClick={() => setDeleteConfirmId(doc.id)}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {activeTab === 'bank' && bankDocs.length === 0 && (
                      <div className="vendor-docs-empty-state">
                        <div className="vendor-docs-empty-title">No Bank Reply Proof Uploaded Yet</div>
                        <div className="vendor-docs-empty-desc">
                          Upload letterheads, bank verification sheets, or check copies using the dropzone above.
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="vendor-docs-modal-footer">
          <div className="footer-left">
            Total files: <strong>{totalCount}</strong> ({smartpalDocs.length} SmartPAL, {bankDocs.length} Bank Replies)
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {error && <Toast type="error" message={error} onClose={() => setError(null)} duration={5000} />}
    </div>
  );
}
