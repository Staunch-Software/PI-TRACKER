import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadAttachment } from '../../lib/attachmentUpload';
import { AttachmentGalleryModal } from '../modals/AttachmentGalleryModal';

interface Props {
  piEntryId: string;
  dprNo: string | null;
  attachmentCount: number;
  canEdit: boolean;
}

export function AttachmentCell({ piEntryId, dprNo, attachmentCount, canEdit }: Props) {
  const [isUploading, setIsUploading] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadAttachment(piEntryId, file);
      }
      queryClient.invalidateQueries({ queryKey: ['pi-entries'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
      queryClient.invalidateQueries({ queryKey: ['attachments', piEntryId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleViewClick() {
    setIsGalleryOpen(true);
  }

  return (
    <div className="attachment-cell" title={error ?? undefined}>
      {attachmentCount > 0 && (
        <button
          type="button"
          className="attachment-view-btn"
          onClick={handleViewClick}
          title={`${attachmentCount} file${attachmentCount === 1 ? '' : 's'} attached`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
          <span className="attachment-count">{attachmentCount}</span>
        </button>
      )}
      {canEdit && (
        <>
          <button
            type="button"
            className="attachment-add-btn"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (fileInputRef.current) {
                fileInputRef.current.click();
              }
            }}
            disabled={isUploading}
            title="Attach file(s)"
          >
            {isUploading ? (
              <svg className="attachment-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
        </>
      )}
      {error && <span className="attachment-error">!</span>}
      {isGalleryOpen && (
        <AttachmentGalleryModal piEntryId={piEntryId} dprNo={dprNo} onClose={() => setIsGalleryOpen(false)} />
      )}
    </div>
  );
}
