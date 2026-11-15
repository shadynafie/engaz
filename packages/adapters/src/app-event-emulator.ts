import type { AppEventDelivery, AppEventProvider } from "@engaz/adapter-kit";

/** Offline event source for the same routine subscription and delivery path. */
export class AppEventEmulator implements AppEventProvider {
  private receive: ((event: AppEventDelivery) => Promise<void>) | undefined;
  private readonly triggers = new Map<
    string,
    { userId: string; accountId: string; event: string }
  >();
  private sequence = 0;
  async listTypes(_provider: string) {
    return [{ slug: "NEW_ITEM", name: "New item", config: {} }];
  }
  async create(userId: string, accountId: string, event: string) {
    const id = `trigger-${++this.sequence}`;
    this.triggers.set(id, { userId, accountId, event });
    return id;
  }
  async remove(triggerId: string) {
    this.triggers.delete(triggerId);
  }
  async subscribe(receive: (event: AppEventDelivery) => Promise<void>) {
    this.receive = receive;
  }
  async close() {
    this.receive = undefined;
  }
  async emit(
    triggerId: string,
    payload: Record<string, unknown>,
    deliveryKey = `delivery-${++this.sequence}`,
  ) {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) throw new Error("Unknown event trigger");
    await this.receive?.({ triggerId, ...trigger, payload, deliveryKey });
  }
}
