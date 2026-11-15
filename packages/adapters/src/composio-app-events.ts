import { createHash } from "node:crypto";
import type { Composio } from "@composio/core";
import type { AppEventDelivery, AppEventProvider } from "@engaz/adapter-kit";

import { getLogger } from "@engaz/logging";
import { retryAppEventDelivery } from "./app-event-delivery.js";

export class ComposioAppEvents implements AppEventProvider {
  private readonly shutdown = new AbortController();
  private readonly pending = new Set<Promise<void>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempts = 0;
  private subscribed = false;
  private receive: ((event: AppEventDelivery) => Promise<void>) | undefined;
  private streamVersion = 0;
  constructor(private readonly sdk: () => Composio) {}

  async listTypes(provider: string) {
    const types = await this.sdk().triggers.listTypes(
      { toolkits: [provider], limit: 100 },
      { signal: AbortSignal.timeout(15_000) },
    );
    return types.items.map((item) => ({
      slug: item.slug,
      name: item.name,
      config: item.config ?? {},
    }));
  }

  async create(userId: string, accountId: string, event: string, config: Record<string, unknown>) {
    const created = await this.sdk().triggers.create(
      userId,
      event,
      {
        connectedAccountId: accountId,
        triggerConfig: config,
      },
      { signal: AbortSignal.timeout(15_000) },
    );
    return created.triggerId;
  }

  async remove(triggerId: string) {
    await this.sdk().triggers.delete(triggerId, { signal: AbortSignal.timeout(15_000) });
  }

  async subscribe(receive: (event: AppEventDelivery) => Promise<void>) {
    this.receive = receive;
    this.reconnectAttempts = 0;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    await this.openStream();
  }

  private async openStream() {
    if (this.shutdown.signal.aborted) return;
    const version = ++this.streamVersion;
    if (this.subscribed) await this.sdk().triggers.unsubscribe();
    this.subscribed = true;
    await this.sdk().triggers.subscribe(
      (event) => {
        if (this.shutdown.signal.aborted || version !== this.streamVersion || !this.receive) return;
        this.reconnectAttempts = 0;
        if (this.pending.size >= 100) {
          getLogger().error("App event backlog full; replay may be required");
          return;
        }
        const payload = event.payload ?? event.originalPayload ?? {};
        // shortcut: this SDK drops the upstream event id; use payload identity until it preserves delivery ids.
        const deliveryKey = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        const delivery = retryAppEventDelivery(
          this.receive,
          {
            triggerId: event.id,
            accountId: event.metadata.connectedAccount.id,
            userId: event.userId,
            event: event.triggerSlug,
            payload,
            deliveryKey,
          },
          this.shutdown.signal,
        )
          .catch((error) => {
            if (!this.shutdown.signal.aborted)
              getLogger().error(
                "App event delivery failed after retries; replay may be required",
                error,
              );
          })
          .finally(() => this.pending.delete(delivery));
        this.pending.add(delivery);
      },
      {},
      () => {
        if (version === this.streamVersion) this.retrySubscription();
      },
    );
    if (this.shutdown.signal.aborted) await this.sdk().triggers.unsubscribe();
  }

  private retrySubscription() {
    if (this.shutdown.signal.aborted || this.reconnectTimer) return;
    if (this.reconnectAttempts >= 5) {
      getLogger().error(
        "App event subscription unavailable after retries; reconnect the event to retry",
      );
      return;
    }
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempts++);
    getLogger().error("App event subscription failed; reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.openStream().catch(() => this.retrySubscription());
    }, delay);
    this.reconnectTimer.unref();
  }

  async close() {
    clearTimeout(this.reconnectTimer);
    this.shutdown.abort();
    await this.sdk().triggers.unsubscribe();
  }
}
