import { json, config, readJson, validUuid } from "../../_shared/superbase.js";
import { requireAdminRoles } from "../../_shared/security.js";

const ITEM_TYPES = new Set(["task","meeting","note","contact","document","reminder"]);
const STATUSES = new Set(["open","in_progress","done","cancelled"]);
const PRIORITIES = new Set(["low","normal","high","urgent"]);

async function restRequest(url, secretKey, resource, options = {}) {
  const response = await fetch(url + "/rest/v1/" + resource, {
    method: options.method || "GET",
    headers: {
      apikey: secretKey,
      authorization: "Bearer " + secretKey,
      accept: "application/json",
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.prefer ? { prefer: options.prefer } : {})
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) throw new Error("SECRETARIAT_STORAGE_UNAVAILABLE");
  return data;
}

async function resolveOwner(access, url, secretKey) {
  if (access.roles.includes("super_admin")) return access.user.id;
  const mapping = await restRequest(
    url, secretKey,
    "admin_secretariat_access?select=owner_user_id&assistant_user_id=eq." +
      encodeURIComponent(access.user.id) + "&active=eq.true&limit=1"
  );
  const ownerId = mapping?.[0]?.owner_user_id;
  return ownerId || null;
}

export async function onRequestGet({ request, env }) {
  const access = await requireAdminRoles(request, env, ["secretary"]);
  if (access.error) return access.error;
  try {
    const { url, secretKey } = config(env);
    const ownerId = await resolveOwner(access, url, secretKey);
    if (!ownerId) return json({ error: "SECRETARIAT_ACCESS_NOT_ASSIGNED" }, 403);
    const items = await restRequest(
      url, secretKey,
      "admin_secretariat_items?select=id,item_type,title,details,due_at,status,priority,created_by,updated_by,created_at,updated_at&owner_user_id=eq." +
        encodeURIComponent(ownerId) + "&order=due_at.asc.nullslast,created_at.desc&limit=100"
    );
    return json({ ok: true, items: Array.isArray(items) ? items : [], owner_user_id: ownerId });
  } catch {
    return json({ error: "SECRETARIAT_STORAGE_UNAVAILABLE" }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  const access = await requireAdminRoles(request, env, ["secretary"]);
  if (access.error) return access.error;
  try {
    const { url, secretKey } = config(env);
    const ownerId = await resolveOwner(access, url, secretKey);
    if (!ownerId) return json({ error: "SECRETARIAT_ACCESS_NOT_ASSIGNED" }, 403);
    const body = await readJson(request, 7000);
    const itemType = String(body?.item_type || "task");
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const details = typeof body?.details === "string" ? body.details.trim() : "";
    const priority = String(body?.priority || "normal");
    const dueAt = body?.due_at ? new Date(body.due_at) : null;
    if (!ITEM_TYPES.has(itemType)) return json({ error: "SECRETARIAT_ITEM_TYPE_INVALID" }, 400);
    if (title.length < 1 || title.length > 160) return json({ error: "SECRETARIAT_TITLE_INVALID" }, 400);
    if (details.length > 5000) return json({ error: "SECRETARIAT_DETAILS_TOO_LONG" }, 400);
    if (!PRIORITIES.has(priority)) return json({ error: "SECRETARIAT_PRIORITY_INVALID" }, 400);
    if (body?.due_at && (!dueAt || Number.isNaN(dueAt.getTime()))) {
      return json({ error: "SECRETARIAT_DUE_DATE_INVALID" }, 400);
    }
    const created = await restRequest(url, secretKey, "admin_secretariat_items", {
      method: "POST",
      prefer: "return=representation",
      body: {
        owner_user_id: ownerId,
        item_type: itemType,
        title,
        details,
        due_at: dueAt ? dueAt.toISOString() : null,
        priority,
        status: "open",
        created_by: access.user.id,
        updated_by: access.user.id
      }
    });
    return json({ ok: true, item: Array.isArray(created) ? created[0] : created }, 201);
  } catch (error) {
    if (error?.message === "INVALID_JSON") return json({ error: "INVALID_JSON" }, 400);
    return json({ error: "SECRETARIAT_STORAGE_UNAVAILABLE" }, 503);
  }
}

export async function onRequestPatch({ request, env }) {
  const access = await requireAdminRoles(request, env, ["secretary"]);
  if (access.error) return access.error;
  try {
    const { url, secretKey } = config(env);
    const ownerId = await resolveOwner(access, url, secretKey);
    if (!ownerId) return json({ error: "SECRETARIAT_ACCESS_NOT_ASSIGNED" }, 403);
    const body = await readJson(request, 3000);
    if (!validUuid(body?.item_id)) return json({ error: "SECRETARIAT_ITEM_ID_INVALID" }, 400);
    if (!STATUSES.has(body?.status)) return json({ error: "SECRETARIAT_STATUS_INVALID" }, 400);
    const updated = await restRequest(
      url, secretKey,
      "admin_secretariat_items?id=eq." + encodeURIComponent(body.item_id) +
        "&owner_user_id=eq." + encodeURIComponent(ownerId),
      {
        method: "PATCH",
        prefer: "return=representation",
        body: { status: body.status, updated_by: access.user.id, updated_at: new Date().toISOString() }
      }
    );
    if (!Array.isArray(updated) || !updated.length) return json({ error: "SECRETARIAT_ITEM_NOT_FOUND" }, 404);
    return json({ ok: true, item: updated[0] });
  } catch (error) {
    if (error?.message === "INVALID_JSON") return json({ error: "INVALID_JSON" }, 400);
    return json({ error: "SECRETARIAT_STORAGE_UNAVAILABLE" }, 503);
  }
}
