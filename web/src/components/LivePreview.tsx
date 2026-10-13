import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import type { PlatformSpec, ProcessingOptions, StickerItem } from '../lib/types';
import { LottieView } from './StickerMedia';

type Backdrop = 'checker' | 'light' | 'dark';
const BACKDROPS: Record<Backdrop, string> = { checker: 'checker', light: 'bg-[#e5ddd5]', dark: 'bg-[#0b141a]' };

interface Props {
  item: StickerItem | null;
  spec: PlatformSpec;
  options: ProcessingOptions;
}

interface PreviewState {
  url: string;
  format: string;
  bytes: number;
  size: string;
  warnings: string[];
}

/**
 * Previews exactly the file that will be exported (rendered by the server for the platform +
 * options), on a chat-like background, with a size bar against the platform limit.
 */
export function LivePreview({ item, spec, options }: Props) {
  const debounced = useDebounced(options, 350);
  const [state, setState] = useState<PreviewState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backdrop, setBackdrop] = useState<Backdrop>('light');

  useEffect(() => {
    if (!item) return;
    const ctrl = new AbortController();
    let url: string | null = null;
    setLoading(true);
    setError(null);
    api
      .preview(item.id, spec.id, debounced, ctrl.signal)
      .then((p) => {
        url = URL.createObjectURL(p.blob);
        setState({ url, format: p.format, bytes: p.bytes, size: p.size, warnings: p.warnings });
      })
      .catch((err: Error) => err.name !== 'AbortError' && setError(err.message))
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => {
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [item, spec.id, debounced]);

  if (!item) {
    return <div className="grid aspect-square place-items-center rounded-2xl bg-surface-2 text-sm text-muted">Pick a sticker to preview it</div>;
  }

  const limit = item.animated && spec.animated ? spec.animated.maxBytes : spec.static.maxBytes;
  const ratio = state ? state.bytes / limit : 0;

  return (
    <div className="space-y-3">
      <div className={`relative grid aspect-square place-items-center overflow-hidden rounded-2xl ${BACKDROPS[backdrop]}`}>
        {state && !error && (
          state.format === 'webm' ? (
            <video key={state.url} src={state.url} autoPlay loop muted playsInline className="max-h-[78%] max-w-[78%]" />
          ) : state.format === 'tgs' ? (
            <div className="size-[78%]">
              <LottieView key={state.url} src={state.url} play />
            </div>
          ) : (
            <img src={state.url} alt="Preview" className="max-h-[78%] max-w-[78%] drop-shadow-sm" />
          )
        )}
        {error && <p className="px-6 text-center text-sm text-red-500">{error}</p>}
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-surface/40 backdrop-blur-[1px]">
            <Loader2 className="size-6 animate-spin text-brand" />
          </div>
        )}
        <div className="absolute right-2 bottom-2 flex gap-1 rounded-full bg-black/30 p-1 backdrop-blur">
          {(Object.keys(BACKDROPS) as Backdrop[]).map((b) => (
            <button
              key={b}
              onClick={() => setBackdrop(b)}
              aria-label={`${b} background`}
              className={`size-5 rounded-full border border-white/60 ${BACKDROPS[b]} ${backdrop === b ? 'ring-2 ring-white' : ''}`}
            />
          ))}
        </div>
      </div>

      {state && !error && (
        <div className="space-y-2 text-xs">
          <div className="flex justify-between text-muted">
            <span>
              {state.format.toUpperCase()} · {state.size}
            </span>
            <span className={ratio > 1 ? 'font-medium text-red-500' : ''}>
              {formatBytes(state.bytes)} / {formatBytes(limit)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full ${ratio > 1 ? 'bg-red-500' : ratio > 0.8 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </div>
          {state.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              {w}
            </p>
          ))}
          <a href={api.downloadUrl(item.id, spec.id, debounced)} className="btn btn-ghost w-full py-1.5 text-xs">
            <Download className="size-3.5" /> Download this sticker
          </a>
        </div>
      )}
    </div>
  );
}
