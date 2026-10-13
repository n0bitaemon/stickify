import { History, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { JobRow } from '../components/JobRow';
import { api } from '../lib/api';
import { useInterval, usePlatforms } from '../lib/hooks';
import type { ExportJob } from '../lib/types';

/** Conversion history: download exported ZIPs again anytime, even after the pack is deleted. */
export function HistoryPage() {
  const [jobs, setJobs] = useState<ExportJob[] | null>(null);
  const platforms = usePlatforms();

  const load = useCallback(() => api.listExports().then((r) => setJobs(r.jobs)).catch(() => setJobs([])), []);
  useEffect(() => void load(), [load]);
  useInterval(load, 1500, Boolean(jobs?.some((j) => j.status === 'queued' || j.status === 'processing')));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Conversion history</h1>
      <p className="mt-1 text-sm text-muted">Your 100 most recent exports. ZIP files are kept so you can download them again anytime.</p>

      {jobs === null ? (
        <div className="mt-16 grid place-items-center">
          <Loader2 className="size-6 animate-spin text-brand" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="card mt-8 flex flex-col items-center px-6 py-14 text-center text-sm text-muted">
          <History className="mb-3 size-8" />
          No exports yet. Open a pack and click "Export ZIP".
        </div>
      ) : (
        <div className="card mt-6 divide-y divide-line px-4">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} showPack platformLabel={platforms.find((p) => p.id === j.platform)?.label} />
          ))}
        </div>
      )}
    </div>
  );
}
