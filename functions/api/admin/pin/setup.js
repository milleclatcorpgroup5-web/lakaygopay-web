import { setupAdminPin } from "../../../_shared/admin-pin.js";

export async function onRequestPost({ request, env }) {
  return setupAdminPin(request, env);
}
