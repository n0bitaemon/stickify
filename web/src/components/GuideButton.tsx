import { CircleHelp, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Props {
  /** Button text, e.g. "How to get the link". */
  label: string;
  /** Dialog title. */
  title: string;
  steps: string[];
  notes?: string[];
  className?: string;
}

/**
 * Guides stay out of the way: a small "How to…" button that opens the steps in a dialog
 * only when the user asks for them.
 */
export function GuideButton({ label, title, steps, notes = [], className = '' }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline ${className}`}
      >
        <CircleHelp className="size-3.5" /> {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title} onClick={() => setOpen(false)}>
          <div className="card w-full max-w-md p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-semibold">{title}</h2>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <ol className="mt-4 space-y-3">
              {steps.map((step, i) => (
                <li key={step} className="flex gap-3 text-sm">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{i + 1}</span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
            {notes.length > 0 && (
              <ul className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-muted">
                {notes.map((n) => (
                  <li key={n}>• {n}</li>
                ))}
              </ul>
            )}
            <button onClick={() => setOpen(false)} className="btn btn-ghost mt-5 w-full">
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
