// Legacy spelling kept for backwards compatibility. Both routes now share
// exactly the same authentication, 4-digit PIN check, idempotency and user-JWT
// transfer implementation.
import { onRequestPost as secureTransfer } from "./transfers.js";

export async function onRequestPost(context) {
  return secureTransfer(context);
}
