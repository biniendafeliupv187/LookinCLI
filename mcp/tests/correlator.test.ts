import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestCorrelator } from '../src/core/correlator.js';

describe('RequestCorrelator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves pending request when response arrives with matching type+tag', async () => {
    const correlator = new RequestCorrelator();

    const promise = correlator.register(200, 1, 5000);
    correlator.resolve(200, 1, Buffer.from('ok'));

    const result = await promise;
    expect(result.toString()).toBe('ok');
  });

  it('rejects pending request on timeout', async () => {
    const correlator = new RequestCorrelator();

    const promise = correlator.register(200, 1, 1000);
    vi.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow('timeout');
  });

  it('ignores response for non-pending request (no crash)', () => {
    const correlator = new RequestCorrelator();

    // No request registered, resolving should not throw
    expect(() => correlator.resolve(200, 99, Buffer.from('orphan'))).not.toThrow();
  });

  it('clears timeout on successful resolve', async () => {
    const correlator = new RequestCorrelator();

    const promise = correlator.register(200, 1, 1000);
    correlator.resolve(200, 1, Buffer.from('fast'));

    // Advance past timeout — should not cause issues
    vi.advanceTimersByTime(2000);

    const result = await promise;
    expect(result.toString()).toBe('fast');
  });

  it('handles multiple concurrent requests with different tags', async () => {
    const correlator = new RequestCorrelator();

    const p1 = correlator.register(200, 1, 5000);
    const p2 = correlator.register(200, 2, 5000);
    const p3 = correlator.register(202, 1, 5000);

    correlator.resolve(200, 2, Buffer.from('second'));
    correlator.resolve(202, 1, Buffer.from('third'));
    correlator.resolve(200, 1, Buffer.from('first'));

    expect((await p1).toString()).toBe('first');
    expect((await p2).toString()).toBe('second');
    expect((await p3).toString()).toBe('third');
  });

  it('generates unique incrementing tags', () => {
    const correlator = new RequestCorrelator();

    const tag1 = correlator.nextTag();
    const tag2 = correlator.nextTag();
    const tag3 = correlator.nextTag();

    expect(tag2).toBe(tag1 + 1);
    expect(tag3).toBe(tag2 + 1);
  });

  it('rejects pending request via reject method', async () => {
    const correlator = new RequestCorrelator();

    const promise = correlator.register(200, 1, 5000);
    correlator.reject(200, 1, new Error('connection lost'));

    await expect(promise).rejects.toThrow('connection lost');
  });

  it('rejectAll cancels all pending requests', async () => {
    const correlator = new RequestCorrelator();

    const p1 = correlator.register(200, 1, 5000);
    const p2 = correlator.register(202, 2, 5000);

    correlator.rejectAll(new Error('disconnected'));

    await expect(p1).rejects.toThrow('disconnected');
    await expect(p2).rejects.toThrow('disconnected');
  });

  it('reports pending count', () => {
    const correlator = new RequestCorrelator();

    expect(correlator.pendingCount).toBe(0);

    correlator.register(200, 1, 5000);
    correlator.register(200, 2, 5000);
    expect(correlator.pendingCount).toBe(2);

    correlator.resolve(200, 1, Buffer.alloc(0));
    expect(correlator.pendingCount).toBe(1);
  });
});
