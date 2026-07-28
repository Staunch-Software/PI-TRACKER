import { api } from './api';
import type { InvoiceAttachment } from '../shared';

interface InitResponse {
  blobKey: string;
  uploadUrl: string;
}

export async function uploadAttachment(piEntryId: string, file: File): Promise<InvoiceAttachment> {
  const { blobKey, uploadUrl } = await api.post<InitResponse>(`/pi-entries/${piEntryId}/attachments/init`, {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
  });

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`Upload to storage failed for "${file.name}" (${putRes.status})`);
  }

  return api.post<InvoiceAttachment>(`/pi-entries/${piEntryId}/attachments/complete`, {
    blobKey,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  });
}
