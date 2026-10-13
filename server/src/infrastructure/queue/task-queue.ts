import type { Logger } from '../../config/logger.js';

/**
 * In-process concurrency-limited queue. Media processing is CPU/RAM heavy: if 20 requests
 * ran sharp/ffmpeg at once the server would stall or run out of memory. The queue makes
 * sure only N heavy tasks run at a time; the rest wait their turn.
 *
 * Fine for a single instance. To scale horizontally, swap it for BullMQ/Redis behind the
 * same `run`/`enqueue` interface.
 *
 * ⚠️ NEVER nest `run` calls on the SAME queue: the outer task holds a slot while waiting
 * for the inner one → deadlock once every slot is taken. That is why the app uses two
 * queues: `jobQueue` for background jobs (export/import) and `mediaQueue` for sharp/ffmpeg.
 */
export class TaskQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly logger: Logger,
  ) {}

  get stats() {
    return { active: this.active, waiting: this.waiting.length, concurrency: this.concurrency };
  }

  /** Runs a task when a slot is free and waits for its result. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  /** Fire and forget – for background jobs (export, import). Errors are logged, never crash the process. */
  enqueue(name: string, task: () => Promise<unknown>): void {
    void this.run(task).catch((err: unknown) => this.logger.error({ err, task: name }, 'Background task failed'));
  }
}

/** Runs `fn` for each item with at most `limit` tasks in parallel, keeping result order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
