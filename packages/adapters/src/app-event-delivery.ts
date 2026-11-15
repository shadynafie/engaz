import type { AppEventDelivery } from "@engaz/adapter-kit";

/** Retry before durable acceptance; after acceptance the application's normal queue owns recovery. */
export async function retryAppEventDelivery(
  receive: (event: AppEventDelivery) => Promise<void>,
  event: AppEventDelivery,
  signal: AbortSignal,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = waitForRetry,
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    signal.throwIfAborted();
    try {
      await receive(event);
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      await wait(Math.min(30_000, 1_000 * 2 ** attempt), signal);
    }
  }
}

function waitForRetry(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
