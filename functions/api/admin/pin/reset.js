import { resetAdminPin } from "../../../_shared/admin-pin.js";

export async function onRequestPost({ request, env }) {
  return resetAdminPin(request, env);
}
