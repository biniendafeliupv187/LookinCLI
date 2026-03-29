/**
 * Correlates Peertalk request/response pairs by type+tag.
 * Supports timeout and bulk rejection for disconnect scenarios.
 */
export class RequestCorrelator {
  private pending = new Map<string, {
    resolve: (data: Buffer) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    chunks?: Buffer[];
    expectedCount?: number;
  }>();
  private tagCounter = 0;

  /** Generate the next unique tag number */
  nextTag(): number {
    return ++this.tagCounter;
  }

  /** Number of in-flight requests */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Register a pending request. Returns a Promise that resolves
   * when `resolve(type, tag, data)` is called, or rejects on timeout.
   */
  register(type: number, tag: number, timeoutMs: number): Promise<Buffer> {
    const key = `${type}:${tag}`;
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Request type=${type} tag=${tag} timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(key, { resolve, reject, timer });
    });
  }

  /** Resolve a pending request with response data */
  resolve(type: number, tag: number, data: Buffer): void {
    const key = `${type}:${tag}`;
    const entry = this.pending.get(key);
    if (!entry) return; // Orphan response, ignore
    clearTimeout(entry.timer);
    this.pending.delete(key);
    entry.resolve(data);
  }

  /**
   * Resolve one partial chunk for a streamed response.
   * The request completes only when `currentCount >= totalCount`.
   */
  resolvePartial(
    type: number,
    tag: number,
    data: Buffer,
    currentCount: number,
    totalCount: number,
  ): void {
    const key = `${type}:${tag}`;
    const entry = this.pending.get(key);
    if (!entry) return;

    if (!entry.chunks) {
      entry.chunks = [];
    }
    entry.chunks.push(data);
    entry.expectedCount = totalCount;

    if (currentCount < totalCount) {
      return;
    }

    clearTimeout(entry.timer);
    this.pending.delete(key);
    entry.resolve(Buffer.concat(entry.chunks));
  }

  /** Reject a specific pending request */
  reject(type: number, tag: number, error: Error): void {
    const key = `${type}:${tag}`;
    const entry = this.pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    entry.reject(error);
  }

  /** Reject all pending requests (e.g., on disconnect) */
  rejectAll(error: Error): void {
    for (const [key, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}
