import { verifyAdminPin } from "../../../_shared/admin-pin.js";

export async function onRequestPost({ request, env }) {
  return verifyAdminPin(request, env);
}
