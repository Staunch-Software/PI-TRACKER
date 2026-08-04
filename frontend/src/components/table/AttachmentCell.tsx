import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadAttachment } from '../../lib/attachmentUpload';
import { AttachmentGalleryModal } from '../modals/AttachmentGalleryModal';

interface Props {
  piEntryId: string;
  dprNo: string;
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
          📎 <span className="attachment-count">{attachmentCount}</span>
        </button>
      )}
      {canEdit && (
        <>
          <button
            type="button"
            className="attachment-add-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            title="Attach file(s)"
          >
            {isUploading ? '…' : '+'}
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
