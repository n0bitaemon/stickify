import { AlertTriangle, CheckCircle2, Download, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { formatBytes, PLATFORM_COLORS, plural, timeAgo } from '../lib/format';
import type { ExportJob } from '../lib/types';

export function JobStatusIcon({ job }: { job: ExportJob }) {
  if (job.status === 'completed') return <CheckCircle2 className="size-4 text-emerald-500" />;
  if (job.status === 'failed') return <XCircle className="size-4 text-red-500" />;
  return <Loader2 className="size-4 animate-spin text-brand" />;
}

/** One conversion-history row: status, progress, download the ZIP again / open the Telegram link. */
export function JobRow({ job, showPack = false, platformLabel }: { job: ExportJob; showPack?: boolean; platformLabel?: string }) {
  const running = job.status === 'queued' || job.status === 'processing';
  const pct = job.progress.total ? Math.round((job.progress.done / job.progress.total) * 100) : 0;

  return (
    <div className="flex items-center gap-3 py-3">
      <JobStatusIcon job={job} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="size-2 rounded-full" style={{ background: PLATFORM_COLORS[job.platform] }} />
          <span className="font-medium">{platformLabel ?? job.platform}</span>
          {job.target === 'telegram' && <span className="rounded bg-surface-2 px-1.5 text-[10px] text-muted">pushed to Telegram</span>}
          {showPack && <span className="truncate text-muted">· {job.packTitle}</span>}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {running && `${job.status === 'queued' ? 'Queued' : 'Processing'} ${job.progress.done}/${job.progress.total}`}
          {job.status === 'completed' && (
            <>
              {plural(job.result?.stickerCount ?? 0, 'sticker')}
              {job.result?.bytes ? ` · ${formatBytes(job.result.bytes)}` : ''} · {timeAgo(job.finishedAt ?? job.createdAt)}
            </>
          )}
          {job.status === 'failed' && <span className="text-red-500">{job.error}</span>}
        </div>
        {running && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        {job.status === 'completed' && job.warnings.length > 0 && (
          <details className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            <summary className="flex cursor-pointer items-center gap-1">
              <AlertTriangle className="size-3" /> {plural(job.warnings.length, 'warning')}
            </summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {job.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {job.status === 'completed' && job.result?.telegramUrl && (
        <a href={job.result.telegramUrl} target="_blank" rel="noreferrer" className="btn btn-ghost px-3 py-1.5 text-xs">
          <ExternalLink className="size-3.5" /> Open
        </a>
      )}
      {job.status === 'completed' && job.result?.filename && (
        <a href={api.exportDownloadUrl(job.id)} className="btn btn-ghost px-3 py-1.5 text-xs">
          <Download className="size-3.5" /> ZIP
        </a>
      )}
    </div>
  );
}
