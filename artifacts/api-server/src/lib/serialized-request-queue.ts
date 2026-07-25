export interface SerializedRequestQueueOptions {
  minIntervalMs: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

export class SerializedRequestQueue {
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private tail: Promise<void> = Promise.resolve();
  private nextStartAt = 0;

  constructor(options: SerializedRequestQueueOptions) {
    if (
      !Number.isFinite(options.minIntervalMs) ||
      options.minIntervalMs < 0
    ) {
      throw new Error("minIntervalMs must be a non-negative number");
    }
    this.minIntervalMs = options.minIntervalMs;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((delayMs) =>
        new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const delayMs = Math.max(0, this.nextStartAt - this.now());
      if (delayMs > 0) await this.sleep(delayMs);
      const startedAt = this.now();
      this.nextStartAt =
        Math.max(this.nextStartAt, startedAt) + this.minIntervalMs;
      return task();
    });

    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
