import { PLATFORM_COLORS } from '../lib/format';
import type { PlatformId, PlatformSpec } from '../lib/types';
import { GuideButton } from './GuideButton';

interface Props {
  platforms: PlatformSpec[];
  value: PlatformId;
  onChange: (id: PlatformId) => void;
}

/** Target platform grid; each tile shows the canvas size. */
export function PlatformPicker({ platforms, value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2" role="radiogroup" aria-label="Target platform">
      {platforms.map((p) => {
        const active = p.id === value;
        return (
          <button
            key={p.id}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(p.id)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
              active ? 'border-brand bg-brand-soft ring-2 ring-brand/20' : 'border-line bg-surface hover:bg-surface-2'
            }`}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: PLATFORM_COLORS[p.id] }} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{p.label}</span>
              <span className="block text-[11px] text-muted">
                {p.canvas.width}×{p.canvas.height}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Spec summary: formats, size limits, stickers per pack. */
export function SpecSummary({ spec }: { spec: PlatformSpec }) {
  const kb = (b: number) => `${Math.round(b / 1024)}KB`;
  const rows = [
    ['Static', `${spec.static.format.toUpperCase()} ≤ ${kb(spec.static.maxBytes)}`],
    ['Animated', spec.animated ? `${spec.animated.format.toUpperCase()} ≤ ${kb(spec.animated.maxBytes)} · ${spec.animated.maxDurationMs / 1000}s` : 'Not supported'],
    ['Per pack', spec.pack.min > 1 ? `${spec.pack.min}–${spec.pack.max} stickers` : `up to ${spec.pack.max}`],
  ];
  return (
    <div className="rounded-xl bg-surface-2 p-3 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {spec.notes.length > 0 && <p className="mt-2 border-t border-line pt-2 text-muted">{spec.notes[0]}</p>}
    </div>
  );
}

/** "How to import into X" – steps for adding the exported files to the target platform. */
export function ImportGuideButton({ spec }: { spec: PlatformSpec }) {
  return <GuideButton label={`How to import into ${spec.label}`} title={`Adding your stickers to ${spec.label}`} steps={spec.importGuide} notes={spec.notes} />;
}
