import { adminPinResetChallenge } from "../../../_shared/admin-pin.js";

export async function onRequestPost({ request, env }) {
  return adminPinResetChallenge(request, env);
}
