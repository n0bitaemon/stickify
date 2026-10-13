import { ArrowRight, Download, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { OptionsPanel } from '../components/OptionsPanel';
import { PackReview } from '../components/PackReview';
import { ImportGuideButton, PlatformPicker, SpecSummary } from '../components/PlatformPicker';
import { PackSummary, SourceStage } from '../components/SourceStage';
import { api, saveBlob } from '../lib/api';
import { plural } from '../lib/format';
import { usePlatforms, useSources } from '../lib/hooks';
import { useReview } from '../lib/review';
import { useToast } from '../lib/toast';
import type { FailedFile, PlatformId, ProcessingOptions, SourceId } from '../lib/types';

/**
 * Quick convert SOURCE → TARGET: pick where stickers come from (files, Telegram/Signal link,
 * WhatsApp package), review them – including how each looks on the target – and get a ZIP.
 * Nothing is kept on the server beyond the short-lived review session.
 */
export function QuickConvertPage() {
  const platforms = usePlatforms();
  const sources = useSources();
  const toast = useToast();
  const [sourceId, setSourceId] = useState<SourceId>('file');
  const { info, setInfo, selected, setSelected, indices } = useReview();
  const [platform, setPlatform] = useState<PlatformId>('whatsapp');
  const [options, setOptions] = useState<ProcessingOptions>({ trim: true, padding: 8, borderWidth: 0, borderColor: '#ffffff' });
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<FailedFile[]>([]);

  const spec = useMemo(() => platforms.find((p) => p.id === platform), [platforms, platform]);
  const source = sources.find((s) => s.id === sourceId);

  useEffect(() => {
    setInfo(null);
    setFailed([]);
  }, [sourceId, setInfo]);

  const convert = async () => {
    if (!info) return;
    setBusy(true);
    setFailed([]);
    try {
      const r = await api.quickConvert(info.previewId, indices, platform, options, title.trim());
      saveBlob(r.blob, r.filename);
      setFailed(r.failed);
      toast(`Converted ${plural(r.converted, 'sticker')}${r.failed.length ? `, ${r.failed.length} failed` : ''}`, r.failed.length ? 'warning' : 'success');
    } catch (err) {
      const details = (err as { details?: { failed?: FailedFile[] } }).details;
      if (details?.failed) setFailed(details.failed);
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Quick convert</h1>
      <p className="mt-1 text-sm text-muted">Pick a source and a target platform, review the stickers, and download a ready-made ZIP.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-4">
          <div className="card p-4">
            <span className="label">1 · Source</span>
            <SourceStage
              sources={sources}
              sourceId={sourceId}
              onSourceChange={setSourceId}
              info={info}
              onInfo={setInfo}
              onError={(m) => toast(m, 'error')}
              onFailed={setFailed}
            />
          </div>

          {info && (
            <div className="card space-y-4 p-4">
              <PackSummary info={info} />
              <PackReview info={info} selected={selected} onChange={setSelected} target={spec ? { spec, options } : undefined} />
              {spec && <p className="text-xs text-muted">Tip: zoom into a sticker to compare the original with the {spec.label} result.</p>}
            </div>
          )}

          {failed.length > 0 && (
            <div className="rounded-xl bg-red-500/10 p-4 text-sm text-red-600">
              <p className="font-medium">{plural(failed.length, 'file')} could not be used:</p>
              <ul className="mt-1 list-disc pl-5">
                {failed.map((f, i) => (
                  <li key={`${f.filename}-${i}`}>
                    {f.filename}: {f.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="card space-y-4 p-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label mb-0">2 · Target platform</span>
                {spec && <ImportGuideButton spec={spec} />}
              </div>
              <PlatformPicker platforms={platforms} value={platform} onChange={setPlatform} />
            </div>
            {spec && <SpecSummary spec={spec} />}
            <label className="block">
              <span className="label">Pack name</span>
              <input className="input" placeholder={info?.title || 'Stickify pack'} maxLength={64} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </div>
          <div className="card p-4">
            <span className="label">Adjustments</span>
            <OptionsPanel value={options} onChange={setOptions} />
          </div>
          {source && spec && (
            <p className="flex items-center justify-center gap-2 text-xs text-muted">
              {source.label} <ArrowRight className="size-3" /> {spec.label}
            </p>
          )}
          <button onClick={convert} disabled={!info || selected.size === 0 || busy} className="btn btn-primary w-full py-3">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {busy ? 'Converting…' : info ? `Convert ${plural(selected.size, 'sticker')} & download ZIP` : 'Load stickers first'}
          </button>
        </aside>
      </div>
    </div>
  );
}
