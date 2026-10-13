/**
 * "Compress to fit" loop: tries encoding settings from highest to lowest quality and
 * returns the FIRST result under the byte limit. When none fits, it returns the smallest
 * result with `fitted=false` so the caller can warn instead of failing hard.
 *
 * Attempts run sequentially (not in parallel) because each encode already uses a full
 * CPU core and we usually stop after the first one or two.
 */
export async function fitToSize<A>(
  attempts: readonly A[],
  maxBytes: number,
  encode: (attempt: A) => Promise<Buffer>,
): Promise<{ buffer: Buffer; fitted: boolean; attempt: A }> {
  let smallest: { buffer: Buffer; attempt: A } | null = null;
  for (const attempt of attempts) {
    const buffer = await encode(attempt);
    if (buffer.length <= maxBytes) return { buffer, fitted: true, attempt };
    if (!smallest || buffer.length < smallest.buffer.length) smallest = { buffer, attempt };
  }
  if (!smallest) throw new Error('fitToSize: empty attempts list');
  return { ...smallest, fitted: false };
}

export const formatKB = (bytes: number): string => `${Math.round(bytes / 1024)}KB`;
