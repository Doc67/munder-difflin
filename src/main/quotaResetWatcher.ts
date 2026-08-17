/**
 * QuotaResetWatcher — fires callbacks when rate-limit windows expire locally.
 *
 * No API calls are made. When a bucket's resetsAt timestamp is reached,
 * the registered cb is invoked so the caller can zero out usedPct and
 * push quota:updated to the renderer.
 *
 * A real payload from the hook / codex service always overwrites any local
 * value set by a reset callback.
 */
export class QuotaResetWatcher {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Watch a rate-limit bucket.
   * - If resetsAtMs is null/undefined: cancel any existing timer for this key.
   * - If resetsAtMs is already past: cb fires on the next microtask so the caller
   *   can finish its synchronous state update first.
   * - If resetsAtMs is in the future: a timer is scheduled (clamped to Node.js
   *   max-safe setTimeout of ~24.8 days so weekly windows work fine).
   *
   * Calling watch() again for the same key cancels the previous timer.
   */
  watch(key: string, resetsAtMs: number | null | undefined, cb: () => void): void {
    this.cancel(key);
    if (resetsAtMs == null) return;

    const delay = resetsAtMs - Date.now();
    if (delay <= 0) {
      // Window already expired — correct on next microtask
      void Promise.resolve().then(cb);
    } else {
      const t = setTimeout(() => {
        this.timers.delete(key);
        cb();
      }, Math.min(delay, 2_147_483_647)); // clamp to max safe ~24.8d
      this.timers.set(key, t);
    }
  }

  cancel(key: string): void {
    const t = this.timers.get(key);
    if (t !== undefined) { clearTimeout(t); this.timers.delete(key); }
  }

  destroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
