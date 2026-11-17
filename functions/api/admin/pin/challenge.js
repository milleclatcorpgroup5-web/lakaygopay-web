import { adminPinChallenge } from "../../../_shared/admin-pin.js";

export async function onRequestGet({ request, env }) {
  return adminPinChallenge(request, env);
}
