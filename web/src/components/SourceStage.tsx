import { FolderOpen, Link2, Loader2, MessageCircle, MessageSquare, RotateCcw, Search, Send, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import { PLATFORM_COLORS, plural } from '../lib/format';
import type { FailedFile, ReviewInfo, SourceId, SourceSpec } from '../lib/types';
import { Dropzone } from './Dropzone';
import { GuideButton } from './GuideButton';

const ICONS: Record<SourceId, LucideIcon> = { file: FolderOpen, telegram: Send, signal: MessageCircle, whatsapp: MessageSquare };
const INPUT_LABEL = { files: 'Drop files', link: 'Paste a pack link', archive: '.wastickers / .webp files' };

export function SourceIcon({ id, className = 'size-9' }: { id: SourceId; className?: string }) {
  const Icon = ICONS[id];
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl text-white ${className}`} style={{ background: PLATFORM_COLORS[id] }}>
      <Icon className="size-1/2" />
    </span>
  );
}

/** Source platform picker. Each card says how stickers are brought in (files / link / package). */
export function SourcePicker({ sources, value, onChange }: { sources: SourceSpec[]; value: SourceId; onChange: (id: SourceId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Source platform">
      {sources.map((s) => {
        const active = s.id === value;
        return (
          <button
            key={s.id}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(s.id)}
            className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
              active ? 'border-brand bg-brand-soft ring-2 ring-brand/20' : 'border-line bg-surface hover:bg-surface-2'
            }`}
          >
            <SourceIcon id={s.id} />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{s.label}</span>
              {s.available ? (
                <span className="block truncate text-[11px] text-muted">{INPUT_LABEL[s.input]}</span>
              ) : (
                <span className="block truncate text-[11px] text-amber-600 dark:text-amber-400">Not enabled on the server</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Title + counts of a loaded pack, with room for action buttons. */
export function PackSummary({ info, children }: { info: ReviewInfo; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <SourceIcon id={info.source} className="size-11" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{info.title || (info.origin === 'upload' ? 'Uploaded files' : 'Sticker pack')}</div>
        <div className="text-sm text-muted">
          {info.author && `${info.author} · `}
          {plural(info.count, 'sticker')}
          {info.video > 0 && ` · ${info.video} video`}
          {info.animated > 0 && ` · ${info.animated} animated`}
          {info.lottie > 0 && ` · ${info.lottie} Lottie`}
        </div>
        {info.lottie > 0 && <p className="mt-1 text-xs text-muted">Lottie (.tgs) stickers can only be exported back to Telegram.</p>}
        {info.truncated && <p className="mt-1 text-xs text-amber-600">This pack is very large – only the first 200 stickers were loaded.</p>}
      </div>
      {children}
    </div>
  );
}

interface StageProps {
  sources: SourceSpec[];
  sourceId: SourceId;
  onSourceChange: (id: SourceId) => void;
  /** The pack currently under review (null = nothing loaded yet). */
  info: ReviewInfo | null;
  /** Called with a freshly loaded pack, or null when the user starts over. */
  onInfo: (info: ReviewInfo | null) => void;
  onError: (message: string) => void;
  onFailed?: (failed: FailedFile[]) => void;
}

/**
 * Step 1 of every import/convert flow: pick the source, then provide a link or files.
 * Everything ends up in a server-side review session that the caller shows with PackReview.
 */
export function SourceStage({ sources, sourceId, onSourceChange, info, onInfo, onError, onFailed }: StageProps) {
  const source = sources.find((s) => s.id === sourceId);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  // A new source starts from scratch.
  useEffect(() => setLink(''), [sourceId]);

  if (!source) {
    return (
      <div className="grid h-24 place-items-center">
        <Loader2 className="size-5 animate-spin text-brand" />
      </div>
    );
  }

  const loadLink = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!link.trim()) return;
    setBusy(true);
    onInfo(null);
    try {
      onInfo(await api.inspectSource(source.id, link.trim()));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: File[]) => {
    setProgress(0);
    try {
      // Files dropped while a review is open are added to it.
      const appendTo = info?.origin === 'upload' ? info.previewId : undefined;
      const { failed, ...next } = await api.uploadPreview(source.id, files, appendTo, setProgress);
      onInfo(next);
      if (failed.length) onFailed?.(failed);
    } catch (err) {
      const details = (err as { details?: { failed?: FailedFile[] } }).details;
      if (details?.failed?.length) onFailed?.(details.failed);
      else onError((err as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const guideLabel = source.input === 'link' ? 'How to get the link' : source.input === 'archive' ? 'How to get the files' : 'How it works';
  const guideTitle = source.input === 'link' ? `Getting a ${source.label} pack link` : source.input === 'archive' ? `Getting stickers out of ${source.label}` : 'Uploading files';

  return (
    <div className="space-y-4">
      <SourcePicker sources={sources} value={source.id} onChange={onSourceChange} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{source.description}</p>
        <GuideButton label={guideLabel} title={guideTitle} steps={source.steps} notes={source.notes} />
      </div>

      {source.input === 'link' &&
        (source.available ? (
          <div className="space-y-2">
            <form onSubmit={loadLink} className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <input
                  className="input pl-9"
                  placeholder={source.placeholder}
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  aria-label={`${source.label} sticker pack link`}
                />
              </div>
              <button className="btn btn-primary whitespace-nowrap" disabled={!link.trim() || busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Load pack
              </button>
            </form>
            {!link && source.examples?.[0] && (
              <p className="text-xs text-muted">
                Example:{' '}
                <button type="button" onClick={() => setLink(source.examples![0]!)} className="max-w-full truncate align-bottom text-brand hover:underline">
                  {source.examples[0]}
                </button>
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            The {source.label} source is not enabled on this server
            {source.id === 'telegram' && (
              <>
                {' '}
                – set <code className="font-mono">TELEGRAM_BOT_TOKEN</code> (create a bot with @BotFather).
              </>
            )}
          </p>
        ))}

      {source.input !== 'link' &&
        (info?.origin === 'upload' ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <Dropzone onFiles={upload} compact compactLabel="Add more files" progress={progress} accept={source.accept} />
            </div>
            <button onClick={() => onInfo(null)} className="btn btn-ghost">
              <RotateCcw className="size-4" /> Start over
            </button>
          </div>
        ) : (
          <Dropzone
            onFiles={upload}
            progress={progress}
            accept={source.accept}
            hint={source.input === 'archive' ? '.wastickers, .zip or .webp files – pack name and emojis are kept' : undefined}
          />
        ))}
    </div>
  );
}
