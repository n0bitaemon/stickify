/**
 * Intermediate representation for every animated sticker: a sequence of same-size raw
 * RGBA frames played at a constant FPS. GIF/WebP (decoded by sharp) and WebM/MP4/APNG
 * (decoded by ffmpeg) all become this, and the WebP/GIF (sharp) or WebM/APNG (ffmpeg)
 * encoders share it.
 */
export interface FrameSequence {
  width: number;
  height: number;
  fps: number;
  /** Each entry is one raw RGBA frame of width*height*4 bytes. Entries may share memory. */
  frames: Buffer[];
}

export const sequenceDurationMs = (seq: FrameSequence): number => Math.round((seq.frames.length / seq.fps) * 1000);

/** Splits a "tall" image (frames stacked vertically) into individual frames. */
export function splitStackedFrames(data: Buffer, width: number, frameHeight: number, count: number): Buffer[] {
  const size = width * frameHeight * 4;
  return Array.from({ length: count }, (_, i) => data.subarray(i * size, (i + 1) * size));
}

/**
 * Resamples frames with variable delays (GIF) to a constant FPS and cuts them to the
 * maximum duration. Only references are copied – no frame memory is duplicated.
 */
export function resampleFrames(frames: Buffer[], delaysMs: number[], targetFps: number, maxDurationMs: number): Buffer[] {
  const total = Math.min(delaysMs.reduce((a, b) => a + b, 0), maxDurationMs);
  const count = Math.max(1, Math.round((total / 1000) * targetFps));
  const out: Buffer[] = [];
  let src = 0;
  let srcEnd = delaysMs[0] ?? 100;
  for (let k = 0; k < count; k++) {
    const t = (k * 1000) / targetFps;
    while (t >= srcEnd && src < frames.length - 1) {
      src++;
      srcEnd += delaysMs[src] ?? 100;
    }
    out.push(frames[src]!);
  }
  return out;
}

/** Lowers the FPS by an integer factor (drops frames) – one step of the compress-to-fit loop. */
export function decimate(seq: FrameSequence, factor: number): FrameSequence {
  if (factor <= 1 || seq.frames.length < 2) return seq;
  return { ...seq, fps: seq.fps / factor, frames: seq.frames.filter((_, i) => i % factor === 0) };
}

/** Centres a w×h frame on a transparent W×H canvas. */
export function padFrame(src: Buffer, w: number, h: number, W: number, H: number): Buffer {
  if (w === W && h === H) return src;
  const out = Buffer.alloc(W * H * 4);
  const left = Math.floor((W - w) / 2);
  const top = Math.floor((H - h) / 2);
  for (let y = 0; y < h; y++) {
    src.copy(out, ((top + y) * W + left) * 4, y * w * 4, (y + 1) * w * 4);
  }
  return out;
}

export function parseHexColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Adds a sticker-style outline (stroke) around the non-transparent part of a frame.
 *
 * Technique: an exact Euclidean Distance Transform (Felzenszwalb–Huttenlocher, O(n)) of
 * the alpha mask. Pixels within b px of the shape belong to the outline → an even width
 * with rounded corners, without the thin tips that "blur + threshold" produces. The edge
 * is anti-aliased with a 1px ramp, then the original is composited over it (alpha "over").
 *
 * The frame must already have ≥ b px of free space around its content (the layout leaves it).
 * Synchronous, ~10ms for a 512×512 frame.
 */
export function applyStroke(frame: Buffer, width: number, height: number, borderWidth: number, color: string): Buffer {
  if (borderWidth <= 0) return frame;
  const dist = distanceToShape(frame, width, height);

  const [sr, sg, sb] = parseHexColor(color);
  const out = Buffer.alloc(frame.length);
  for (let i = 0, p = 0; i < frame.length; i += 4, p++) {
    const a = frame[i + 3]! / 255;
    const m = Math.min(1, Math.max(0, borderWidth + 0.5 - Math.sqrt(dist[p]!)));
    const outA = a + m * (1 - a);
    if (outA <= 0) continue; // keep fully transparent pixels as they are
    const k = (m * (1 - a)) / outA;
    const ka = a / outA;
    out[i] = Math.round(frame[i]! * ka + sr * k);
    out[i + 1] = Math.round(frame[i + 1]! * ka + sg * k);
    out[i + 2] = Math.round(frame[i + 2]! * ka + sb * k);
    out[i + 3] = Math.round(outA * 255);
  }
  return out;
}

const INF = 1e20;

/** 1-D EDT (lower envelope of parabolas) – the core of Felzenszwalb's algorithm. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s: number;
    do {
      const r = v[k]!;
      s = (f[q]! + q * q - (f[r]! + r * r)) / (2 * q - 2 * r);
    } while (s <= z[k]! && --k >= 0);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const r = v[k]!;
    d[q] = (q - r) * (q - r) + f[r]!;
  }
}

/** Squared distance from each pixel to the nearest "solid" pixel (alpha ≥ 50%). */
function distanceToShape(frame: Buffer, width: number, height: number): Float64Array {
  const grid = new Float64Array(width * height);
  for (let p = 0; p < grid.length; p++) grid[p] = frame[p * 4 + 3]! >= 128 ? 0 : INF;

  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]!;
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]!;
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = grid[row + x]!;
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[row + x] = d[x]!;
  }
  return grid;
}
