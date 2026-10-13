import { GripVertical, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import type { StickerItem } from '../lib/types';
import { LottieView } from './StickerMedia';

const KIND_BADGE: Record<string, string | null> = { static: null, vector: 'SVG', animated: 'GIF', video: 'VIDEO', lottie: 'TGS' };

/** Splits text into emojis (keeping combined emojis such as 👨‍👩‍👧 and flags intact). */
export function parseEmojis(text: string): string[] {
  const segments = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  return segments.filter((s) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s)).slice(0, 20);
}

interface Props {
  items: StickerItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onEmojis: (id: string, emojis: string[]) => void;
  onDelete: (id: string) => void;
}

/**
 * Sticker grid: click to preview, drag to reorder (HTML5 DnD), click the emoji chip to
 * edit it; the delete button shows on hover/focus.
 */
export function StickerGrid({ items, selectedId, onSelect, onReorder, onEmojis, onDelete }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    onReorder(ids);
  };

  const commitEmoji = (id: string) => {
    const emojis = parseEmojis(draft);
    if (emojis.length) onEmojis(id, emojis);
    setEditing(null);
  };

  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-5">
      {items.map((item, index) => {
        const badge = item.original.kind === 'animated' ? item.original.format.toUpperCase() : KIND_BADGE[item.original.kind];
        const selected = item.id === selectedId;
        return (
          <li
            key={item.id}
            draggable
            onDragStart={(e) => {
              setDragId(item.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverId(item.id);
            }}
            onDragLeave={() => setOverId((o) => (o === item.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              drop(item.id);
              setDragId(null);
              setOverId(null);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            onMouseEnter={() => setHoverId(item.id)}
            onMouseLeave={() => setHoverId((h) => (h === item.id ? null : h))}
            className={`group relative rounded-2xl border bg-surface p-1.5 transition ${
              selected ? 'border-brand ring-2 ring-brand/25' : 'border-line hover:border-brand/40'
            } ${dragId === item.id ? 'opacity-40' : ''} ${overId === item.id && dragId !== item.id ? 'scale-[1.03] border-brand' : ''}`}
          >
            <button onClick={() => onSelect(item.id)} className="checker block aspect-square w-full overflow-hidden rounded-xl" aria-label={`Sticker ${index + 1}`}>
              {item.thumbnail?.mime ? (
                <img src={api.thumbnailUrl(item.id)} alt="" loading="lazy" draggable={false} className="size-full object-contain" />
              ) : item.original.kind === 'lottie' ? (
                // Lottie has no server-side thumbnail → render the original .tgs in the browser.
                <LottieView src={api.originalUrl(item.id)} play={hoverId === item.id} />
              ) : (
                <span className="grid size-full place-items-center text-xs text-muted">—</span>
              )}
            </button>

            <span className="absolute top-3 left-3 rounded-md bg-black/55 px-1.5 text-[10px] font-semibold text-white tabular-nums">{index + 1}</span>
            {badge && <span className="absolute top-3 right-3 rounded-md bg-brand px-1.5 text-[10px] font-semibold text-brand-fg">{badge}</span>}
            <GripVertical className="absolute top-1/2 left-0.5 size-4 -translate-y-1/2 cursor-grab text-muted opacity-0 group-hover:opacity-100" />

            <div className="mt-1.5 flex items-center justify-between gap-1 px-0.5">
              {editing === item.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitEmoji(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEmoji(item.id);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  className="input h-7 px-2 py-0 text-base"
                  aria-label="Sticker emojis"
                />
              ) : (
                <button
                  onClick={() => {
                    setDraft(item.emojis.join(''));
                    setEditing(item.id);
                  }}
                  className="truncate rounded-lg px-1 text-base hover:bg-surface-2"
                  title="Edit emoji"
                >
                  {item.emojis.join('')}
                </button>
              )}
              <button
                onClick={() => onDelete(item.id)}
                className="rounded-lg p-1 text-muted opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:text-red-500"
                aria-label="Delete sticker"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
