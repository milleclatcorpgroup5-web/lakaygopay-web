import { json } from "../../../_shared/superbase.js";
import { adminPinStatus } from "../../../_shared/admin-pin.js";

export async function onRequestGet({ request, env }) {
  return adminPinStatus(request, env);
}
