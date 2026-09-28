import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { InvoiceAttachment } from '../../shared';
import { formatDate } from '../../lib/format';
import { useRole } from '../../auth/useRole';
import { TrashIcon } from '../common/TrashIcon';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  piEntryId: string;
  dprNo: string | null;
  onClose: () => void;
}

type PreviewKind = 'image' | 'pdf' | 'office' | 'none';

const OFFICE_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];

function FileIcon({ kind }: { kind: PreviewKind }) {
  switch (kind) {
    case 'image':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      );
    case 'pdf':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      );
    case 'office':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
      );
    default:
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      );
  }
}

function getPreviewKind(contentType: string, fileName: string): PreviewKind {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (OFFICE_EXTENSIONS.includes(ext)) return 'office';
  return 'none';
}

export function AttachmentGalleryModal({ piEntryId, dprNo, onClose }: Props) {
  const { canEdit } = useRole();
  const [selected, setSelected] = useState<InvoiceAttachment | null>(null);
  const [pendingDelete, setPendingDelete] = useState<InvoiceAttachment | null>(null);
  const queryClient = useQueryClient();

  const attachmentsQuery = useQuery({
    queryKey: ['attachments', piEntryId],
    queryFn: () => api.get<InvoiceAttachment[]>(`/pi-entries/${piEntryId}/attachments`),
  });

  // Automatically select the first attachment when data loads if none is selected
  useEffect(() => {
    if (!selected && attachmentsQuery.data && attachmentsQuery.data.length > 0) {
      setSelected(attachmentsQuery.data[0]);
    }
  }, [attachmentsQuery.data, selected]);

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => api.delete(`/pi-entries/${piEntryId}/attachments/${attachmentId}`),
    onSuccess: (_data, attachmentId) => {
      queryClient.invalidateQueries({ queryKey: ['attachments', piEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pi-entries'] });
      setSelected((prev) => (prev?.id === attachmentId ? null : prev));
      setPendingDelete(null);
    },
  });

  function handleConfirmDelete() {
    if (!pendingDelete) return;
    deleteMutation.mutate(pendingDelete.id);
  }

  const selectedKind = selected ? getPreviewKind(selected.contentType, selected.fileName) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gallery-panel" onClick={(e) => e.stopPropagation()}>
        <button className="gallery-absolute-close" onClick={onClose} aria-label="Close Gallery">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <div className="gallery-sidebar">
          <div className="gallery-sidebar-header">
            <h2>Evidence Gallery</h2>
          </div>
          <div className="gallery-file-list">
            {attachmentsQuery.isLoading && <div className="empty-state">Loading…</div>}
            {attachmentsQuery.data?.map((attachment) => {
              const kind = getPreviewKind(attachment.contentType, attachment.fileName);
              return (
                <div
                  key={attachment.id}
                  className={`gallery-file-card${selected?.id === attachment.id ? ' active' : ''}`}
                  onClick={() => setSelected(attachment)}
                >
                  <div className="gallery-file-icon-wrap">
                    <FileIcon kind={kind} />
                  </div>
                  <div className="gallery-file-info">
                    <span className="gallery-file-name" title={attachment.fileName}>
                      {attachment.fileName}
                    </span>
                    <span className="gallery-file-meta">
                      {attachment.uploadedByName} • {formatDate(attachment.uploadedAt)}
                    </span>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger gallery-file-delete"
                      title="Delete attachment"
                      aria-label={`Delete ${attachment.fileName}`}
                      disabled={deleteMutation.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(attachment);
                      }}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="gallery-preview">
          {!selected ? (
            <div className="gallery-preview-placeholder">
              <div>Select a file card to preview</div>
              <div className="gallery-preview-hint">PI {dprNo ?? '(no DPR No. yet)'}</div>
            </div>
          ) : (
            <div className="gallery-preview-frame-wrap">
              <div className="gallery-preview-toolbar">
                <span>{selected.fileName}</span>
                <a href={selected.downloadUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                  Open in Web UI
                </a>
              </div>
              {selectedKind === 'image' && (
                <img src={selected.downloadUrl} alt={selected.fileName} className="gallery-preview-img" />
              )}
              {selectedKind === 'pdf' && <iframe src={selected.downloadUrl} className="gallery-preview-frame" title={selected.fileName} />}
              {selectedKind === 'office' && (
                <iframe
                  src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(selected.downloadUrl)}`}
                  className="gallery-preview-frame"
                  title={selected.fileName}
                />
              )}
              {selectedKind === 'none' && (
                <div className="gallery-preview-placeholder">
                  <div>No inline preview available for this file type.</div>
                  <div className="gallery-preview-hint">Use "Open in new tab" above to view or download it.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete attachment"
          message={`Delete "${pendingDelete.fileName}"? This can't be undone.`}
          isConfirming={deleteMutation.isPending}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
