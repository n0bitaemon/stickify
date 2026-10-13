import { Download, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PackReview } from '../components/PackReview';
import { PackSummary, SourceStage } from '../components/SourceStage';
import { api } from '../lib/api';
import { plural } from '../lib/format';
import { useSources } from '../lib/hooks';
import { useReview } from '../lib/review';
import { useToast } from '../lib/toast';
import type { FailedFile, SourceId } from '../lib/types';

/**
 * Brings stickers into a NEW pack from any source platform:
 * pick a source → paste a link or drop files → review/untick → import.
 */
export function ImportPage() {
  const sources = useSources();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const sourceId = (params.get('source') as SourceId | null) ?? 'telegram';
  const { info, setInfo, selected, setSelected, indices } = useReview();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  // Switching source clears the current review.
  useEffect(() => setInfo(null), [sourceId, setInfo]);
  // Pre-fill the pack name when a different pack is loaded (keyed on previewId only,
  // so adding files to an upload does not overwrite a name the user typed).
  const previewId = info?.previewId;
  const loadedTitle = info?.title ?? '';
  useEffect(() => setTitle(loadedTitle), [previewId]);

  const reportFailed = (failed: FailedFile[]) => failed.slice(0, 5).forEach((f) => toast(`${f.filename}: ${f.message}`, 'error'));

  /** Creates the pack right away; stickers are processed in the background – the pack page shows progress. */
  const doImport = async () => {
    if (!info) return;
    setBusy(true);
    try {
      const { pack } = await api.importPreview(info.previewId, indices, title.trim() || undefined);
      navigate(`/packs/${pack.id}`);
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import stickers</h1>
        <p className="mt-1 text-sm text-muted">Choose where your stickers come from, review them, then import them into a new pack you can edit and export anywhere.</p>
      </div>

      <section className="card p-5">
        <SourceStage
          sources={sources}
          sourceId={sourceId}
          onSourceChange={(id) => setParams({ source: id }, { replace: true })}
          info={info}
          onInfo={setInfo}
          onError={(m) => toast(m, 'error')}
          onFailed={reportFailed}
        />
        {sourceId === 'telegram' && !info && (
          <p className="mt-4 text-xs text-muted">
            Want to send single stickers instead of a whole pack?{' '}
            <Link to="/telegram" className="text-brand hover:underline">
              Link the Telegram bot
            </Link>{' '}
            and forward stickers to it.
          </p>
        )}
      </section>

      {info && (
        <section className="card space-y-4 p-5">
          <PackSummary info={info}>
            <button onClick={doImport} disabled={busy || selected.size === 0} className="btn btn-primary">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Import {plural(selected.size, 'sticker')}
            </button>
          </PackSummary>
          <label className="block">
            <span className="label">New pack name</span>
            <input className="input" placeholder="My stickers" maxLength={64} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <PackReview info={info} selected={selected} onChange={setSelected} />
        </section>
      )}
    </div>
  );
}
