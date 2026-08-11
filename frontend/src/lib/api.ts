export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.detail ?? message;
    } catch {
      // no JSON body
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  // No Content-Type header here — the browser sets the multipart boundary itself.
  postForm: <T>(path: string, formData: FormData) =>
    fetch(`/api${path}`, { method: 'POST', credentials: 'include', body: formData }).then(async (res) => {
      if (!res.ok) {
        let message = res.statusText;
        try {
          message = (await res.json()).detail ?? message;
        } catch {
          // no JSON body
        }
        throw new ApiError(res.status, message);
      }
      return res.json() as Promise<T>;
    }),
  // For file-download endpoints (e.g. Excel export) that respond with a binary body instead of
  // JSON — bypasses request()'s res.json() parsing.
  getBlob: async (path: string): Promise<{ blob: Blob; filename: string | null }> => {
    const res = await fetch(`/api${path}`, { credentials: 'include' });
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = (await res.json()).detail ?? message;
      } catch {
        // no JSON body
      }
      throw new ApiError(res.status, message);
    }
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
    return { blob: await res.blob(), filename: filenameMatch ? filenameMatch[1] : null };
  },
};
