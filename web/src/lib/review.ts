import { useCallback, useState } from 'react';
import type { ReviewInfo } from './types';

/**
 * State of a review session + the user's selection.
 * - a new pack → every sticker selected
 * - files appended to the same upload review → the new stickers are selected, earlier choices kept
 */
export function useReview() {
  const [info, setInfoState] = useState<ReviewInfo | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const setInfo = useCallback((next: ReviewInfo | null) => {
    setInfoState((prev) => {
      setSelected((sel) => {
        if (!next) return new Set();
        if (prev && prev.previewId === next.previewId) {
          const merged = new Set(sel);
          for (const s of next.stickers) if (s.index >= prev.stickers.length) merged.add(s.index);
          return merged;
        }
        return new Set(next.stickers.map((s) => s.index));
      });
      return next;
    });
  }, []);

  /** Indices to send to the API: undefined when the whole pack is selected. */
  const indices = info && selected.size < info.stickers.length ? [...selected].sort((a, b) => a - b) : undefined;

  return { info, setInfo, selected, setSelected, indices };
}
