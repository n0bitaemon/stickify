import { AlertTriangle, ArrowLeft, FileArchive, Loader2, Plus, Send, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Dropzone } from '../components/Dropzone';
import { JobRow } from '../components/JobRow';
import { LivePreview } from '../components/LivePreview';
import { OptionsPanel } from '../components/OptionsPanel';
import { PackReview, type ReviewTarget } from '../components/PackReview';
import { ImportGuideButton, PlatformPicker, SpecSummary } from '../components/PlatformPicker';
import { PackSummary } from '../components/SourceStage';
import { StickerGrid } from '../components/StickerGrid';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatBytes, plural, SOURCE_LABELS } from '../lib/format';
import { useDebounced, useInterval, usePlatforms } from '../lib/hooks';
import { useReview } from '../lib/review';
import { useToast } from '../lib/toast';
import type { ExportJob, Pack, PlatformId, ProcessingOptions, StickerItem, TelegramStatus } from '../lib/types';

/** Review dialog for files dropped onto a pack – nothing is added until the user confirms. */
function UploadReviewDialog({
  review,
  target,
  busy,
  progress,
  onAddMore,
  onConfirm,
  onCancel,
}: {
  review: ReturnType<typeof useReview>;
  target?: ReviewTarget;
  busy: boolean;
  progress: number | null;
  onAddMore: (files: File[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { info, selected, setSelected } = review;
  if (!info) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Review new stickers">
      <div className="card w-full max-w-3xl space-y-4 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Review new stickers</h2>
            <p className="text-sm text-muted">Untick anything you don't want, then add the rest to this pack.</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Cancel">
            <X className="size-5" />
          </button>
        </div>
        <PackSummary info={info} />
        <PackReview info={info} selected={selected} onChange={setSelected} target={target} />
        <Dropzone onFiles={onAddMore} compact compactLabel="Add more files" progress={progress} />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy || selected.size === 0} className="btn btn-primary">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add {plural(selected.size, 'sticker')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PackEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const platforms = usePlatforms();

  const [pack, setPack] = useState<Pack | null>(null);
  const [items, setItems] = useState<StickerItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<PlatformId>(user?.preferences.defaultPlatform ?? 'whatsapp');
  const [options, setOptions] = useState<ProcessingOptions | null>(null);
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [exporting, setExporting] = useState(false);

  // Upload review (dropped files are staged in a review session first).
  const staged = useReview();
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.getPack(id);
      setPack(r.pack);
      setItems(r.items);
      setOptions((o) => o ?? r.pack.processing);
      setSelectedId((s) => (s && r.items.some((i) => i.id === s) ? s : (r.items[0]?.id ?? null)));
    } catch (err) {
      toast((err as Error).message, 'error');
      navigate('/', { replace: true });
    }
  }, [id, navigate, toast]);

  const loadJobs = useCallback(() => api.listExports(id).then((r) => setJobs(r.jobs)).catch(() => undefined), [id]);

  useEffect(() => {
    void load();
    void loadJobs();
    api.telegramStatus().then(setTelegram).catch(() => undefined);
  }, [load, loadJobs]);

  // Poll while an import or an export job is running.
  const importing = pack?.importState?.status === 'importing';
  const jobsRunning = jobs.some((j) => j.status === 'queued' || j.status === 'processing');
  useInterval(() => void load(), 1500, importing);
  useInterval(() => void loadJobs(), 1200, jobsRunning);

  // Remember processing options on the pack (debounced) so they survive a reload.
  const savedOptions = useDebounced(options, 800);
  const firstSave = useRef(true);
  useEffect(() => {
    if (!savedOptions) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    api.updatePack(id, { processing: savedOptions }).catch(() => undefined);
  }, [id, savedOptions]);

  const spec = useMemo(() => platforms.find((p) => p.id === platform), [platforms, platform]);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  /** Dropped files → review session (appending while the dialog is open). */
  const stageFiles = async (files: File[]) => {
    setUploadProgress(0);
    try {
      const { failed, ...info } = await api.uploadPreview('file', files, staged.info?.previewId, setUploadProgress);
      staged.setInfo(info);
      for (const f of failed.slice(0, 5)) toast(`${f.filename}: ${f.message}`, 'error');
    } catch (err) {
      const details = (err as { details?: { failed?: Array<{ filename: string; message: string }> } }).details;
      if (details?.failed?.length) details.failed.slice(0, 5).forEach((f) => toast(`${f.filename}: ${f.message}`, 'error'));
      else toast((err as Error).message, 'error');
    } finally {
      setUploadProgress(null);
    }
  };

  const confirmStaged = async () => {
    if (!staged.info) return;
    setAdding(true);
    try {
      const r = await api.addFromPreview(id, staged.info.previewId, staged.indices);
      if (r.items.length) toast(`Added ${plural(r.items.length, 'sticker')}`);
      for (const f of r.failed.slice(0, 5)) toast(`${f.filename}: ${f.message}`, 'error');
      staged.setInfo(null);
      await load();
      if (r.items[0]) setSelectedId(r.items[0].id);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setAdding(false);
    }
  };

  const reorder = async (ids: string[]) => {
    const byId = new Map(items.map((i) => [i.id, i]));
    setItems(ids.map((x) => byId.get(x)!)); // optimistic update
    try {
      await api.reorder(id, ids);
    } catch (err) {
      toast((err as Error).message, 'error');
      void load();
    }
  };

  const updateEmojis = async (itemId: string, emojis: string[]) => {
    try {
      const { item } = await api.updateSticker(itemId, emojis);
      setItems((list) => list.map((i) => (i.id === itemId ? item : i)));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const deleteSticker = async (itemId: string) => {
    if (!confirm('Delete this sticker?')) return;
    try {
      await api.deleteSticker(itemId);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const saveMeta = async (field: 'title' | 'author', raw: string) => {
    const value = raw.trim();
    if (!pack || value === pack[field] || (field === 'title' && !value)) return;
    try {
      const r = await api.updatePack(id, { [field]: value });
      setPack(r.pack);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const deletePack = async () => {
    if (!pack || !confirm(`Delete "${pack.title}" and all ${plural(pack.stickerCount, 'sticker')}? Your exported ZIPs are kept.`)) return;
    await api.deletePack(id);
    toast('Pack deleted');
    navigate('/');
  };

  const startExport = async (target: 'zip' | 'telegram') => {
    if (!options) return;
    setExporting(true);
    try {
      const { job } = await api.createExport(id, platform, target, options);
      setJobs((j) => [job, ...j]);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  };

  if (!pack || !options) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    );
  }

  const belowMin = spec && pack.stickerCount < spec.pack.min;

  return (
    <div className="mx-auto max-w-7xl">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> All packs
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <input
            key={`t-${pack.title}`}
            defaultValue={pack.title}
            onBlur={(e) => saveMeta('title', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            maxLength={64}
            aria-label="Pack name"
            className="w-full rounded-lg bg-transparent px-1 -ml-1 text-2xl font-semibold tracking-tight outline-none hover:bg-surface-2 focus:bg-surface-2"
          />
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>{plural(pack.stickerCount, 'sticker')}</span>
            {pack.animatedCount > 0 && <span>· {pack.animatedCount} animated</span>}
            <span>· {formatBytes(pack.totalBytes)}</span>
            <span>· by</span>
            <input
              key={`a-${pack.author}`}
              defaultValue={pack.author}
              placeholder="no author"
              onBlur={(e) => saveMeta('author', e.target.value)}
              maxLength={64}
              aria-label="Author"
              className="w-32 rounded bg-transparent px-1 outline-none hover:bg-surface-2 focus:bg-surface-2"
            />
          </div>
        </div>
        <button onClick={deletePack} className="btn btn-danger">
          <Trash2 className="size-4" /> Delete pack
        </button>
      </header>

      {importing && (
        <div className="card mt-4 flex items-center gap-3 p-4 text-sm">
          <Loader2 className="size-4 animate-spin text-brand" />
          Importing from {SOURCE_LABELS[pack.source.platform] ?? 'source'}… {pack.importState.done}/{pack.importState.total}
          <div className="ml-auto h-1.5 w-40 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-brand transition-all" style={{ width: `${(pack.importState.done / Math.max(1, pack.importState.total)) * 100}%` }} />
          </div>
        </div>
      )}
      {pack.importState?.status === 'failed' && pack.importState.error && (
        <p className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600">Import problem: {pack.importState.error}</p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ── Left: stickers ── */}
        <section className="space-y-4">
          <Dropzone onFiles={stageFiles} compact={items.length > 0} progress={staged.info ? null : uploadProgress} disabled={importing} />
          {items.length > 0 ? (
            <>
              <p className="text-xs text-muted">Drag to reorder · click an emoji to edit it · click a sticker to preview it</p>
              <StickerGrid items={items} selectedId={selectedId} onSelect={setSelectedId} onReorder={reorder} onEmojis={updateEmojis} onDelete={deleteSticker} />
            </>
          ) : (
            !importing && <p className="text-center text-sm text-muted">This pack is empty – add a few images to get started.</p>
          )}
        </section>

        {/* ── Right: export ── */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="card space-y-4 p-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label mb-0">Target platform</span>
                {spec && <ImportGuideButton spec={spec} />}
              </div>
              <PlatformPicker platforms={platforms} value={platform} onChange={setPlatform} />
            </div>
            {spec && <SpecSummary spec={spec} />}
            {spec && <LivePreview item={selected} spec={spec} options={options} />}
          </div>

          <div className="card p-4">
            <span className="label">Adjustments</span>
            <OptionsPanel value={options} onChange={setOptions} />
          </div>

          <div className="card space-y-3 p-4">
            {belowMin && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                {spec.label} needs at least {spec.pack.min} stickers per pack.
              </p>
            )}
            <button onClick={() => startExport('zip')} disabled={exporting || !items.length || importing || belowMin} className="btn btn-primary w-full">
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <FileArchive className="size-4" />}
              Export ZIP for {spec?.label ?? '…'}
            </button>
            {spec?.directPublish && (
              <button
                onClick={() => startExport('telegram')}
                disabled={exporting || !items.length || importing || !telegram?.linked}
                className="btn btn-ghost w-full"
                title={telegram?.linked ? '' : 'Link your Telegram account first'}
              >
                <Send className="size-4" /> Push to Telegram
              </button>
            )}
            {spec?.directPublish && telegram && !telegram.linked && (
              <p className="text-center text-xs text-muted">
                {telegram.configured ? (
                  <>
                    <Link to="/telegram" className="text-brand hover:underline">
                      Link Telegram
                    </Link>{' '}
                    to push packs directly.
                  </>
                ) : (
                  'The Telegram bot is not configured on the server.'
                )}
              </p>
            )}
            {pack.telegramPublished?.url && (
              <a href={pack.telegramPublished.url} target="_blank" rel="noreferrer" className="block truncate text-center text-xs text-brand hover:underline">
                {pack.telegramPublished.url}
              </a>
            )}

            {jobs.length > 0 && (
              <div className="border-t border-line pt-1">
                <div className="divide-y divide-line">
                  {jobs.slice(0, 5).map((j) => (
                    <JobRow key={j.id} job={j} platformLabel={platforms.find((p) => p.id === j.platform)?.label} />
                  ))}
                </div>
                {jobs.length > 5 && (
                  <Link to="/history" className="block pt-2 text-center text-xs text-brand hover:underline">
                    See full history
                  </Link>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      <UploadReviewDialog
        review={staged}
        target={spec ? { spec, options } : undefined}
        busy={adding}
        progress={uploadProgress}
        onAddMore={stageFiles}
        onConfirm={confirmStaged}
        onCancel={() => staged.setInfo(null)}
      />
    </div>
  );
}
