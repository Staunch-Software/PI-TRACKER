import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { InvoiceAttachment } from '../../shared';
import { formatDate } from '../../lib/format';

interface Props {
  piEntryId: string;
  dprNo: string;
  onClose: () => void;
}

type PreviewKind = 'image' | 'pdf' | 'office' | 'none';

const OFFICE_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];

function getFileIcon(kind: PreviewKind): string {
  if (kind === 'image') return '🖼';
  if (kind === 'pdf') return '📄';
  if (kind === 'office') return '📊';
  return '📁';
}

function getPreviewKind(contentType: string, fileName: string): PreviewKind {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (OFFICE_EXTENSIONS.includes(ext)) return 'office';
  return 'none';
}

export function AttachmentGalleryModal({ piEntryId, dprNo, onClose }: Props) {
  const [selected, setSelected] = useState<InvoiceAttachment | null>(null);

  const attachmentsQuery = useQuery({
    queryKey: ['attachments', piEntryId],
    queryFn: () => api.get<InvoiceAttachment[]>(`/pi-entries/${piEntryId}/attachments`),
  });

  const selectedKind = selected ? getPreviewKind(selected.contentType, selected.fileName) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gallery-panel" onClick={(e) => e.stopPropagation()}>
        <div className="gallery-sidebar">
          <div className="gallery-sidebar-header">
            <h2>Evidence Gallery</h2>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
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
                  <div className="gallery-file-meta">
                    Uploaded by: <strong>{attachment.uploadedByName}</strong>
                    <br />
                    {formatDate(attachment.uploadedAt)}
                  </div>
                  <div className="gallery-file-thumb">
                    <span className="gallery-file-icon">{getFileIcon(kind)}</span>
                    <span className="gallery-file-name">{attachment.fileName}</span>
                    <span className="gallery-file-hint">Click to preview file</span>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="btn btn-primary gallery-close-btn" onClick={onClose}>
            Close Gallery
          </button>
        </div>
        <div className="gallery-preview">
          {!selected ? (
            <div className="gallery-preview-placeholder">
              <div>Select a file card to preview</div>
              <div className="gallery-preview-hint">PI {dprNo}</div>
            </div>
          ) : (
            <div className="gallery-preview-frame-wrap">
              <div className="gallery-preview-toolbar">
                <span>{selected.fileName}</span>
                <a href={selected.downloadUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                  Open in new tab
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
    </div>
  );
}
