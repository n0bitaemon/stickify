import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { PlatformSpec, SourceSpec } from './types';

let platformsCache: Promise<PlatformSpec[]> | null = null;
let sourcesCache: Promise<SourceSpec[]> | null = null;

/** Source platforms with their availability – fetched once, shared app-wide. */
export function useSources(): SourceSpec[] {
  const [sources, setSources] = useState<SourceSpec[]>([]);
  useEffect(() => {
    sourcesCache ??= api.sources().then((r) => r.sources).catch((err) => {
      sourcesCache = null;
      throw err;
    });
    sourcesCache.then(setSources).catch(() => undefined);
  }, []);
  return sources;
}

/** Target platform specs – fetched once from the server, shared app-wide. */
export function usePlatforms(): PlatformSpec[] {
  const [platforms, setPlatforms] = useState<PlatformSpec[]>([]);
  useEffect(() => {
    platformsCache ??= api.platforms().then((r) => r.platforms).catch((err) => {
      platformsCache = null;
      throw err;
    });
    platformsCache.then(setPlatforms).catch(() => undefined);
  }, []);
  return platforms;
}

/** Calls `fn` periodically while `active` is true (polling job/import progress). */
export function useInterval(fn: () => void, ms: number, active: boolean) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}

/** The value, delayed by `ms` – avoids re-rendering previews on every slider move. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
