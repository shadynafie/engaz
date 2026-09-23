import { waitForModelOAuthCompletion } from "@engaz/core";
import { rpc } from "./rpc";

export type { ModelCatalogEntry, ModelCredential, ModelOAuthBegin } from "@engaz/contracts";
export { cancelModelOAuthAttempt, finishModelOAuthAttempt } from "@engaz/core";

export async function waitForModelOAuth(loginId: string, signal?: AbortSignal) {
  return waitForModelOAuthCompletion(() => rpc.models.completeOAuth({ loginId }, { signal }), {
    signal,
  });
}
