import { json, readJson, requireUser } from "../../_shared/superbase.js";
import { systemLogPath, writeSystemLog } from "../../_shared/system-logs.js";

const USER_EVENT_BUCKETS = new Map();

function allowUserEvent(userId) {
  const now = Date.now();
  const current = USER_EVENT_BUCKETS.get(userId);
  if (!current || now - current.startedAt >= 60000) {
    USER_EVENT_BUCKETS.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 120) return false;
  current.count += 1;
  if (USER_EVENT_BUCKETS.size > 3000) {
    USER_EVENT_BUCKETS.forEach((bucket, key) => {
      if (now - bucket.startedAt >= 60000) USER_EVENT_BUCKETS.delete(key);
    });
  }
  return true;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);

  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await readJson(request, 4096);
  } catch {
    return json({ error: "INVALID_LOG_EVENT" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "INVALID_LOG_EVENT" }, 400);
  }

  if (!allowUserEvent(auth.user.id)) return json({ error: "LOG_RATE_LIMITED" }, 429);

  const path = systemLogPath(body.path);
  const eventCode = String(body.event_code || "").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(eventCode)) {
    return json({ error: "INVALID_LOG_EVENT" }, 400);
  }

  const status = Number(body.http_status);
  const httpStatus = Number.isInteger(status) && status >= 0 && status <= 599 ? status : null;
  const method = String(body.method || "").toUpperCase();
  const requestId = String(body.request_id || "");
  const details = {};
  if (Number.isInteger(body.line) && body.line >= 0) details.line = Math.min(body.line, 10000000);
  if (Number.isInteger(body.column) && body.column >= 0) details.column = Math.min(body.column, 10000000);
  if (typeof body.filename === "string") details.filename = systemLogPath(body.filename);

  const stored = await writeSystemLog(env, {
    source: "browser",
    severity: httpStatus === null || httpStatus === 0 || httpStatus >= 500 || eventCode.startsWith("JS_") ? "error" : "warning",
    event_code: eventCode,
    path,
    method,
    http_status: httpStatus,
    request_id: requestId,
    actor_user_id: auth.user.id,
    details
  });

  if (!stored) return json({ error: "SYSTEM_LOGS_UNAVAILABLE" }, 503);\n\n  return json({ ok: true, received: true }, 202);
}
