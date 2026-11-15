export interface AppEventType {
  slug: string;
  name: string;
  config: Record<string, unknown>;
}

export interface AppEventDelivery {
  triggerId: string;
  accountId: string;
  userId: string;
  event: string;
  payload: Record<string, unknown>;
  deliveryKey: string;
}

/** Optional app-event transport; core routines do not require a hosted connector. */
export interface AppEventProvider {
  listTypes(provider: string): Promise<AppEventType[]>;
  create(
    userId: string,
    accountId: string,
    event: string,
    config: Record<string, unknown>,
  ): Promise<string>;
  remove(triggerId: string): Promise<void>;
  subscribe(receive: (event: AppEventDelivery) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
