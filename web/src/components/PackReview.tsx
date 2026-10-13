import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, Maximize2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import type { PlatformSpec, ProcessingOptions, RenderedPreview, ReviewInfo, ReviewSticker } from '../lib/types';
import { StickerMedia } from './StickerMedia';

/** When given, the zoom view also shows each sticker converted for this platform. */
export interface ReviewTarget {
  spec: PlatformSpec;
  options: ProcessingOptions;
}

interface Props {
  info: ReviewInfo;
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  target?: ReviewTarget;
}

const KIND_LABEL: Record<ReviewSticker['kind'], string | null> = { static: null, animated: 'ANIM', video: 'VIDEO', lottie: 'TGS' };

/**
 * Review a loaded pack (link or upload) before importing/converting:
 * - click to select/deselect, Shift+click to select a range
 * - the zoom button (or double-click) opens a large view: ← → to move, Space to select, Esc to close
 */
export function PackReview({ info, selected, onChange, target }: Props) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const lastClicked = useRef<number | null>(null);
  const total = info.stickers.length;
  const url = (i: number) => api.previewStickerUrl(info.previewId, i);

  const toggle = useCallback(
    (index: number, range = false) => {
      const next = new Set(selected);
      if (range && lastClicked.current !== null) {
        // Shift+click: apply the clicked tile's new state to the whole range.
        const [a, b] = [lastClicked.current, index].sort((x, y) => x - y) as [number, number];
        const value = !selected.has(index);
        for (let i = a; i <= b; i++) value ? next.add(i) : next.delete(i);
      } else if (next.has(index)) next.delete(index);
      else next.add(index);
      lastClicked.current = index;
      onChange(next);
    },
    [selected, onChange],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted">
          <b className="text-fg tabular-nums">{selected.size}</b> of {total} selected
          <span className="hidden sm:inline"> · Shift+click to select a range</span>
        </span>
        <div className="flex gap-1">
          <button onClick={() => onChange(new Set(info.stickers.map((s) => s.index)))} className="btn btn-ghost px-3 py-1 text-xs" disabled={selected.size === total}>
            Select all
          </button>
          <button onClick={() => onChange(new Set())} className="btn btn-ghost px-3 py-1 text-xs" disabled={selected.size === 0}>
            Select none
          </button>
        </div>
      </div>

      <ul className="grid max-h-[480px] grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6" aria-label="Stickers in this pack">
        {info.stickers.map((s) => {
          const on = selected.has(s.index);
          const badge = KIND_LABEL[s.kind];
          return (
            <li key={`${info.previewId}-${s.index}`} className="group relative" onMouseEnter={() => setHover(s.index)} onMouseLeave={() => setHover((h) => (h === s.index ? null : h))}>
              <button
                onClick={(e) => toggle(s.index, e.shiftKey)}
                onDoubleClick={() => setZoom(s.index)}
                aria-pressed={on}
                aria-label={`Sticker ${s.index + 1} ${s.emojis.join('')}${on ? ', selected' : ''}`}
                title={s.filename}
                className={`checker block aspect-square w-full overflow-hidden rounded-xl border-2 p-1 transition ${
                  on ? 'border-brand' : 'border-transparent opacity-40 grayscale hover:opacity-70'
                }`}
              >
                <StickerMedia src={url(s.index)} kind={s.kind} play={hover === s.index} />
              </button>
              <span
                className={`pointer-events-none absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full border-2 transition ${
                  on ? 'border-brand bg-brand text-brand-fg' : 'border-white/80 bg-black/30'
                }`}
              >
                {on && <Check className="size-3" strokeWidth={3} />}
              </span>
              {badge && <span className="pointer-events-none absolute right-1.5 bottom-1.5 rounded bg-black/55 px-1 text-[9px] font-semibold text-white">{badge}</span>}
              <span className="pointer-events-none absolute bottom-1 left-1.5 text-sm drop-shadow">{s.emojis[0]}</span>
              <button
                onClick={() => setZoom(s.index)}
                className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                aria-label={`Zoom sticker ${s.index + 1}`}
              >
                <Maximize2 className="size-3" />
              </button>
            </li>
          );
        })}
      </ul>

      {zoom !== null && (
        <Lightbox
          info={info}
          index={zoom}
          selected={selected.has(zoom)}
          onIndex={setZoom}
          onToggle={() => toggle(zoom)}
          onClose={() => setZoom(null)}
          url={url}
          target={target}
        />
      )}
    </div>
  );
}

/** The converted result for the target platform, with size vs limit and warnings. */
function TargetPreview({ info, index, target }: { info: ReviewInfo; index: number; target: ReviewTarget }) {
  const options = useDebounced(target.options, 350);
  const [result, setResult] = useState<(RenderedPreview & { url: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sticker = info.stickers[index]!;

  useEffect(() => {
    const ctrl = new AbortController();
    let url: string | null = null;
    setResult(null);
    setError(null);
    api
      .renderPreview(info.previewId, index, target.spec.id, options, ctrl.signal)
      .then((r) => {
        url = URL.createObjectURL(r.blob);
        setResult({ ...r, url });
      })
      .catch((err: Error) => err.name !== 'AbortError' && setError(err.message));
    return () => {
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [info.previewId, index, target.spec.id, options]);

  const animatedOut = sticker.kind !== 'static' && target.spec.animated;
  const limit = animatedOut ? target.spec.animated!.maxBytes : target.spec.static.maxBytes;
  const ratio = result ? result.bytes / limit : 0;
  const kind = result?.format === 'webm' ? 'video' : result?.format === 'tgs' ? 'lottie' : 'static';

  return (
    <div className="space-y-2">
      <div className="checker relative grid aspect-square place-items-center overflow-hidden rounded-xl">
        {result && <StickerMedia key={result.url} src={result.url} kind={kind} play />}
        {!result && !error && <Loader2 className="size-6 animate-spin text-brand" />}
        {error && <p className="px-4 text-center text-xs text-red-500">{error}</p>}
      </div>
      {result && (
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between text-muted">
            <span>
              {result.format.toUpperCase()} · {result.size}
            </span>
            <span className={ratio > 1 ? 'font-medium text-red-500' : ''}>
              {formatBytes(result.bytes)} / {formatBytes(limit)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full ${ratio > 1 ? 'bg-red-500' : ratio > 0.8 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </div>
          {result.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-px size-3.5 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

interface LightboxProps {
  info: ReviewInfo;
  index: number;
  selected: boolean;
  onIndex: (i: number) => void;
  onToggle: () => void;
  onClose: () => void;
  url: (i: number) => string;
  target?: ReviewTarget;
}

function Lightbox({ info, index, selected, onIndex, onToggle, onClose, url, target }: LightboxProps) {
  const total = info.stickers.length;
  const sticker = info.stickers[index]!;
  const go = useCallback((d: number) => onIndex((index + d + total) % total), [index, total, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [go, onClose, onToggle]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Sticker preview" onClick={onClose}>
      <div className={`card relative w-full p-4 ${target ? 'max-w-3xl' : 'max-w-lg'}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3 text-sm">
          <span className="truncate font-medium">
            {info.title || 'Stickers'} <span className="text-muted tabular-nums">· {index + 1}/{total}</span>
          </span>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <div className={`grid gap-4 ${target ? 'sm:grid-cols-2' : ''}`}>
          <div>
            {target && <p className="label">Original</p>}
            <div className="checker relative aspect-square overflow-hidden rounded-xl">
              {/* key → switching sticker recreates the media (Lottie/video restart) */}
              <StickerMedia key={index} src={url(index)} kind={sticker.kind} play />
              <button onClick={() => go(-1)} className="absolute top-1/2 left-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70" aria-label="Previous sticker">
                <ChevronLeft className="size-5" />
              </button>
              <button onClick={() => go(1)} className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70" aria-label="Next sticker">
                <ChevronRight className="size-5" />
              </button>
            </div>
            <p className="mt-1.5 truncate text-xs text-muted" title={sticker.filename}>
              {sticker.filename}
            </p>
          </div>
          {target && (
            <div>
              <p className="label">On {target.spec.label}</p>
              <TargetPreview info={info} index={index} target={target} />
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="text-2xl">{sticker.emojis.join(' ') || '—'}</span>
          <span className="text-xs text-muted">{KIND_LABEL[sticker.kind] ?? 'Still image'}</span>
          <button onClick={onToggle} className={`btn ml-auto ${selected ? 'btn-primary' : 'btn-ghost'}`}>
            <Check className="size-4" /> {selected ? 'Selected' : 'Select this sticker'}
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted">← → switch sticker · Space select/deselect · Esc close</p>
      </div>
    </div>
  );
}
