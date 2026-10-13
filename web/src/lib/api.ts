import type {
  ExportJob,
  FailedFile,
  Pack,
  PlatformId,
  PlatformSpec,
  ProcessingOptions,
  RenderedPreview,
  ReviewInfo,
  SourceId,
  SourceSpec,
  StickerItem,
  TelegramStatus,
  UploadResult,
  User,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Fired when the session expires → AuthProvider sends the user back to the sign-in page. */
export const UNAUTHORIZED_EVENT = 'stickify:unauthorized';

async function parseError(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string; details?: unknown } } | null;
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  return new ApiError(data?.error?.message ?? `Server error (${res.status})`, res.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.details);
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'include',
      ...rest,
      headers: json !== undefined ? { 'content-type': 'application/json', ...rest.headers } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError('Cannot reach the server', 0, 'NETWORK_ERROR');
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Multipart upload with progress (fetch has no upload progress yet, hence XHR). */
function uploadWithProgress<T>(path: string, form: FormData, onProgress?: (ratio: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError('Cannot reach the server', 0, 'NETWORK_ERROR'));
    xhr.onload = () => {
      const body = xhr.response as (T & { error?: { message: string; code: string; details?: unknown } }) | null;
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T);
      if (xhr.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      reject(new ApiError(body?.error?.message ?? `Server error (${xhr.status})`, xhr.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.details));
    };
    xhr.send(form);
  });
}

const toForm = (files: File[]) => {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  return form;
};

const query = (params: Record<string, string | number | boolean | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

/** Fetches a converted file and reads its X-Stickify-* metadata headers. */
async function fetchRendered(url: string, signal?: AbortSignal): Promise<RenderedPreview> {
  const res = await fetch(url, { credentials: 'include', signal });
  if (!res.ok) throw await parseError(res);
  return {
    blob: await res.blob(),
    format: res.headers.get('X-Stickify-Format') ?? '',
    bytes: Number(res.headers.get('X-Stickify-Bytes') ?? 0),
    size: res.headers.get('X-Stickify-Size') ?? '',
    warnings: JSON.parse(decodeURIComponent(res.headers.get('X-Stickify-Warnings') ?? '%5B%5D')) as string[],
  };
}

export const api = {
  // ── Auth ──
  me: () => request<{ user: User }>('/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('/auth/login', { method: 'POST', json: { email, password } }),
  register: (email: string, password: string, displayName: string) =>
    request<{ user: User }>('/auth/register', { method: 'POST', json: { email, password, displayName } }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  updateMe: (patch: { displayName?: string; defaultPlatform?: PlatformId; processing?: Partial<ProcessingOptions> }) =>
    request<{ user: User }>('/auth/me', { method: 'PATCH', json: patch }),

  platforms: () => request<{ platforms: PlatformSpec[] }>('/platforms'),

  // ── Packs ──
  listPacks: () => request<{ packs: Pack[] }>('/packs'),
  getPack: (id: string) => request<{ pack: Pack; items: StickerItem[] }>(`/packs/${id}`),
  createPack: (input: { title: string; author?: string }) => request<{ pack: Pack }>('/packs', { method: 'POST', json: input }),
  updatePack: (id: string, patch: Partial<Pick<Pack, 'title' | 'author' | 'description' | 'defaultEmoji'>> & { processing?: Partial<ProcessingOptions> }) =>
    request<{ pack: Pack }>(`/packs/${id}`, { method: 'PATCH', json: patch }),
  deletePack: (id: string) => request<void>(`/packs/${id}`, { method: 'DELETE' }),
  /** Adds the selected stickers of a review session to an existing pack. */
  addFromPreview: (packId: string, previewId: string, indices?: number[]) =>
    request<UploadResult>(`/packs/${packId}/stickers/from-preview`, { method: 'POST', json: { previewId, indices } }),
  reorder: (packId: string, ids: string[]) => request<void>(`/packs/${packId}/order`, { method: 'PUT', json: { ids } }),

  // ── Stickers ──
  updateSticker: (id: string, emojis: string[]) => request<{ item: StickerItem }>(`/stickers/${id}`, { method: 'PATCH', json: { emojis } }),
  deleteSticker: (id: string) => request<void>(`/stickers/${id}`, { method: 'DELETE' }),
  thumbnailUrl: (id: string) => `/api/stickers/${id}/thumbnail`,
  originalUrl: (id: string) => `/api/stickers/${id}/original`,
  downloadUrl: (id: string, platform: PlatformId, o: ProcessingOptions) => `/api/stickers/${id}/download?${query({ platform, ...o })}`,
  /** A pack sticker converted for a platform, with metadata. */
  preview: (id: string, platform: PlatformId, o: ProcessingOptions, signal?: AbortSignal) =>
    fetchRendered(`/api/stickers/${id}/preview?${query({ platform, ...o })}`, signal),

  // ── Exports & history ──
  createExport: (packId: string, platform: PlatformId, target: 'zip' | 'telegram', options: ProcessingOptions) =>
    request<{ job: ExportJob }>(`/packs/${packId}/exports`, { method: 'POST', json: { platform, target, options } }),
  getExport: (id: string) => request<{ job: ExportJob }>(`/exports/${id}`),
  listExports: (packId?: string) => request<{ jobs: ExportJob[] }>(`/exports${packId ? `?packId=${packId}` : ''}`),
  exportDownloadUrl: (id: string) => `/api/exports/${id}/download`,

  /** Quick convert of a reviewed pack: returns the ZIP blob + the stickers that failed. */
  async quickConvert(previewId: string, indices: number[] | undefined, platform: PlatformId, options: ProcessingOptions, title: string) {
    const form = new FormData();
    form.set('previewId', previewId);
    if (indices?.length) form.set('indices', indices.join(','));
    form.set('platform', platform);
    if (title) form.set('title', title);
    for (const [k, v] of Object.entries(options)) form.set(k, String(v));
    const res = await fetch('/api/convert', { method: 'POST', body: form, credentials: 'include' });
    if (!res.ok) throw await parseError(res);
    const failed = JSON.parse(decodeURIComponent(res.headers.get('X-Stickify-Failed') ?? '%5B%5D')) as FailedFile[];
    const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'stickers.zip';
    return { blob: await res.blob(), filename: name, failed, converted: Number(res.headers.get('X-Stickify-Converted') ?? 0) };
  },

  // ── Telegram account ──
  telegramStatus: () => request<TelegramStatus>('/telegram/status'),
  telegramLinkCode: () => request<{ code: string; deepLink: string; botUsername: string; expiresAt: string }>('/telegram/link-code', { method: 'POST' }),
  telegramUnlink: () => request<void>('/telegram/link', { method: 'DELETE' }),

  // ── Sources & review sessions ──
  sources: () => request<{ sources: SourceSpec[] }>('/sources'),
  /** Loads a pack from a share link for review. */
  inspectSource: (source: SourceId, link: string) => request<ReviewInfo>('/import/inspect', { method: 'POST', json: { source, link } }),
  /** Uploads files (archives are unpacked) for review; `previewId` appends to an existing review. */
  uploadPreview: (source: SourceId, files: File[], previewId?: string, onProgress?: (r: number) => void) => {
    const form = toForm(files);
    form.set('source', source);
    if (previewId) form.set('previewId', previewId);
    return uploadWithProgress<ReviewInfo & { failed: FailedFile[] }>('/import/upload-preview', form, onProgress);
  },
  /** The original file of one sticker in a review (WebP/APNG/WebM/TGS...). */
  previewStickerUrl: (previewId: string, index: number) => `/api/import/previews/${previewId}/stickers/${index}`,
  /** One reviewed sticker converted for a target platform. */
  renderPreview: (previewId: string, index: number, platform: PlatformId, o: ProcessingOptions, signal?: AbortSignal) =>
    fetchRendered(`/api/import/previews/${previewId}/stickers/${index}/render?${query({ platform, ...o })}`, signal),
  /** Creates a new pack from a review (only `indices` when given). */
  importPreview: (previewId: string, indices?: number[], title?: string) =>
    request<{ pack: Pack }>('/import/preview', { method: 'POST', json: { previewId, indices, title } }),
};

/** Triggers a browser download of a Blob. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
