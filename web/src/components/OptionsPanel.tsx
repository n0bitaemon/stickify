import type { ProcessingOptions } from '../lib/types';

interface Props {
  value: ProcessingOptions;
  onChange: (next: ProcessingOptions) => void;
}

const SWATCHES = ['#ffffff', '#000000', '#ffd60a', '#ff5c8a', '#6d4aff'];

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted">{value}px</span>
      </span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-brand" />
    </label>
  );
}

/** Processing options: trim margins, padding, sticker outline (width + colour). */
export function OptionsPanel({ value, onChange }: Props) {
  const set = <K extends keyof ProcessingOptions>(k: K, v: ProcessingOptions[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
        <span>
          Auto-trim margins
          <span className="block text-xs text-muted">Removes empty space around the image, then centres it</span>
        </span>
        <input type="checkbox" checked={value.trim} onChange={(e) => set('trim', e.target.checked)} className="size-4 accent-brand" />
      </label>

      <Slider label="Padding" value={value.padding} min={0} max={48} onChange={(v) => set('padding', v)} />
      <Slider label="Sticker outline" value={value.borderWidth} min={0} max={24} onChange={(v) => set('borderWidth', v)} />

      {value.borderWidth > 0 && (
        <div className="flex items-center gap-2">
          <span className="mr-1 text-sm">Outline colour</span>
          {SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => set('borderColor', c)}
              aria-label={`Colour ${c}`}
              className={`size-6 rounded-full border border-line ${value.borderColor.toLowerCase() === c ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface' : ''}`}
              style={{ background: c }}
            />
          ))}
          <input
            type="color"
            value={value.borderColor}
            onChange={(e) => set('borderColor', e.target.value)}
            className="size-7 cursor-pointer rounded-md border border-line bg-transparent"
            aria-label="Pick another colour"
          />
        </div>
      )}
    </div>
  );
}
