import { adminPinSetupChallenge } from "../../../_shared/admin-pin.js";

export async function onRequestGet({ request, env }) {
  return adminPinSetupChallenge(request, env);
}
