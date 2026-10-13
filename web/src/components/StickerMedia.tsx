import { ImageOff, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type AnimationItem = { play(): void; pause(): void; destroy(): void };

/**
 * Lottie (.tgs) player – loaded lazily, only when needed. Uses the "light" build (no
 * expressions, which run through eval) because .tgs files come from untrusted sources.
 */
const loadLottie = () => import('lottie-web/build/player/lottie_light_canvas').then((m) => m.default);

/** .tgs = gzipped Lottie JSON → decompressed with the browser's built-in DecompressionStream. */
async function fetchTgs(src: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(src, { credentials: 'include', signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text);
}

export function LottieView({ src, play, className = '' }: { src: string; play: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const anim = useRef<AnimationItem | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const ctrl = new AbortController();
    setState('loading');
    Promise.all([loadLottie(), fetchTgs(src, ctrl.signal)])
      .then(([lottie, animationData]) => {
        if (ctrl.signal.aborted || !box.current) return;
        anim.current = lottie.loadAnimation({
          container: box.current,
          renderer: 'canvas',
          loop: true,
          autoplay: false,
          animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
        }) as AnimationItem;
        setState('ready');
      })
      .catch((err: Error) => err.name !== 'AbortError' && setState('error'));
    return () => {
      ctrl.abort();
      anim.current?.destroy();
      anim.current = null;
    };
  }, [src]);

  // Only play when needed (hover / zoom) – dozens of Lottie canvases at once burn a lot of CPU.
  useEffect(() => {
    if (state !== 'ready') return;
    if (play) anim.current?.play();
    else anim.current?.pause();
  }, [play, state]);

  return (
    <div className={`relative size-full ${className}`}>
      <div ref={box} className="size-full" />
      {state !== 'ready' && (
        <div className="absolute inset-0 grid place-items-center text-muted">
          {state === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <ImageOff className="size-5" />}
        </div>
      )}
    </div>
  );
}

interface MediaProps {
  src: string;
  kind: 'static' | 'animated' | 'video' | 'lottie';
  /** Lottie only plays while `play`; animated images/videos always play. */
  play?: boolean;
  className?: string;
}

/** Shows the original file: images (WebP/PNG/APNG/GIF/SVG) via <img>, WebM via <video>, TGS via Lottie. */
export function StickerMedia({ src, kind, play = false, className = '' }: MediaProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  if (kind === 'lottie') return <LottieView src={src} play={play} className={className} />;

  return (
    <div className={`relative size-full ${className}`}>
      {kind === 'video' ? (
        <video
          src={src}
          autoPlay
          loop
          muted
          playsInline
          onLoadedData={() => setState('ready')}
          onError={() => setState('error')}
          className="size-full object-contain"
        />
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
          className="size-full object-contain"
        />
      )}
      {state !== 'ready' && (
        <div className="absolute inset-0 grid place-items-center text-muted">
          {state === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <ImageOff className="size-5" />}
        </div>
      )}
    </div>
  );
}
