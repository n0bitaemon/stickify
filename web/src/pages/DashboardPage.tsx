import { Download, Film, Loader2, Plus, Sticker } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { formatBytes, PLATFORM_COLORS, plural, SOURCE_LABELS, timeAgo } from '../lib/format';
import { useToast } from '../lib/toast';
import type { Pack } from '../lib/types';

function PackCard({ pack }: { pack: Pack }) {
  const importing = pack.importState?.status === 'importing';
  return (
    <Link to={`/packs/${pack.id}`} className="card group block overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="checker relative grid aspect-[4/3] place-items-center">
        {pack.coverItem ? (
          <img src={api.thumbnailUrl(pack.coverItem)} alt="" className="size-2/3 object-contain transition group-hover:scale-105" loading="lazy" />
        ) : (
          <Sticker className="size-10 text-muted" />
        )}
        {pack.source.platform && pack.source.platform !== 'file' && (
          <span
            className="absolute top-2 left-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
            style={{ background: PLATFORM_COLORS[pack.source.platform] }}
          >
            <Download className="size-3" /> {SOURCE_LABELS[pack.source.platform]}
          </span>
        )}
        {importing && (
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-black/60 py-1.5 text-xs text-white">
            <Loader2 className="size-3 animate-spin" /> Importing {pack.importState.done}/{pack.importState.total}
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="truncate font-medium">{pack.title}</h3>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted">
          <span>{plural(pack.stickerCount, 'sticker')}</span>
          {pack.animatedCount > 0 && (
            <span className="flex items-center gap-0.5">
              · <Film className="size-3" /> {pack.animatedCount}
            </span>
          )}
          <span>· {formatBytes(pack.totalBytes)}</span>
          <span className="ml-auto">{timeAgo(pack.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

export function DashboardPage() {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    api.listPacks().then((r) => setPacks(r.packs)).catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { pack } = await api.createPack({ title: title.trim() || 'New pack' });
      navigate(`/packs/${pack.id}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sticker packs</h1>
          <p className="mt-1 text-sm text-muted">Create, edit and export stickers for Telegram, WhatsApp, iMessage and more.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/import" className="btn btn-ghost">
            <Download className="size-4" /> Import from Telegram, Signal…
          </Link>
          <button onClick={() => setCreating(true)} className="btn btn-primary">
            <Plus className="size-4" /> New pack
          </button>
        </div>
      </header>

      {creating && (
        <form onSubmit={create} className="card mt-6 flex flex-col gap-3 p-4 sm:flex-row">
          <input autoFocus className="input" placeholder="Pack name, e.g. Grumpy orange cat" maxLength={64} value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setCreating(false)} className="btn btn-ghost">
              Cancel
            </button>
            <button className="btn btn-primary whitespace-nowrap">Create pack</button>
          </div>
        </form>
      )}

      {packs === null ? (
        <div className="mt-16 grid place-items-center">
          <Loader2 className="size-6 animate-spin text-brand" />
        </div>
      ) : packs.length === 0 ? (
        <div className="card mt-8 flex flex-col items-center px-6 py-16 text-center">
          <div className="grid size-16 place-items-center rounded-2xl bg-brand-soft text-brand">
            <Sticker className="size-8" />
          </div>
          <h2 className="mt-4 text-lg font-medium">No packs yet</h2>
          <p className="mt-1 max-w-md text-sm text-muted">Create a pack and drop some images in, or import a whole sticker pack from Telegram, Signal or WhatsApp.</p>
          <div className="mt-6 flex gap-2">
            <button onClick={() => setCreating(true)} className="btn btn-primary">
              <Plus className="size-4" /> Create your first pack
            </button>
            <Link to="/import" className="btn btn-ghost">
              Import from another platform
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {packs.map((p) => (
            <PackCard key={p.id} pack={p} />
          ))}
        </div>
      )}
    </div>
  );
}
