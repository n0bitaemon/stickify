import { ImagePlus, Loader2, UploadCloud } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { ACCEPTED_FILES } from '../lib/format';

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** One-line variant (e.g. once a pack already has stickers). */
  compact?: boolean;
  progress?: number | null;
  /** Accepted formats (default: every sticker format). */
  accept?: string;
  /** Description under the title (full variant). */
  hint?: string;
  /** Label of the compact variant. */
  compactLabel?: string;
}

/** Drag-and-drop area that also opens the file picker on click. Keyboard accessible (Enter/Space). */
export function Dropzone({ onFiles, disabled, compact, progress, accept = ACCEPTED_FILES, hint, compactLabel = 'Add stickers' }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const busy = progress !== null && progress !== undefined;

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (disabled || busy) return;
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(files);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled || busy}
      onClick={() => !disabled && !busy && input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      className={`relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed transition outline-none focus-visible:border-brand ${
        over ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-brand/50'
      } ${disabled ? 'pointer-events-none opacity-50' : ''} ${compact ? 'px-4 py-4' : 'px-6 py-12'}`}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      {compact ? (
        <div className="flex items-center justify-center gap-3 text-sm">
          {busy ? <Loader2 className="size-5 animate-spin text-brand" /> : <ImagePlus className="size-5 text-brand" />}
          <span>
            <b>{compactLabel}</b> <span className="text-muted">– drag & drop or click to browse</span>
          </span>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand">
            {busy ? <Loader2 className="size-7 animate-spin" /> : <UploadCloud className="size-7" />}
          </div>
          <p className="mt-4 font-medium">{busy ? 'Uploading…' : 'Drop files here or click to browse'}</p>
          <p className="mt-1 text-sm text-muted">{hint ?? 'PNG, JPG, WebP, SVG, GIF, WebM, MP4, ZIP – up to 20MB per file'}</p>
        </div>
      )}
      {busy && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-surface-2">
          <div className="h-full bg-brand transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
