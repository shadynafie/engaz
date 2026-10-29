/** Serialize event-driven reads and retain invalidations received during a read. */
export function createRefreshCoalescer(refresh: () => Promise<unknown>) {
  let pending: Promise<void> | null = null;
  let dirty = false;
  let disposed = false;

  async function drain() {
    let failed = false;
    let lastError: unknown;
    while (dirty && !disposed) {
      dirty = false;
      try {
        await refresh();
        failed = false;
      } catch (error) {
        failed = true;
        lastError = error;
      }
    }
    // Clear before resolving so an invalidation in a completion handler starts a new read.
    pending = null;
    if (failed) throw lastError;
  }

  return {
    invalidate(): Promise<void> {
      if (disposed) return Promise.resolve();
      dirty = true;
      pending ??= Promise.resolve().then(drain);
      return pending;
    },
    dispose() {
      disposed = true;
      dirty = false;
    },
  };
}
