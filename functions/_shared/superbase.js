const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function config(env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publishableKey || !secretKey) throw new Error("BACKEND_NOT_CONFIGURED");
  return { url, publishableKey, secretKey };
}

async function requireUser(request, env) {
  let backend;
  try {
    backend = config(env);
  } catch (error) {
    // Missing Cloudflare Pages bindings must produce a controlled API response,
    // not an uncaught exception that Cloudflare renders as a generic 500.
    if (error?.message === "BACKEND_NOT_CONFIGURED") {
      return { error: json({ error: "BACKEND_NOT_CONFIGURED" }, 503) };
    }
    return { error: json({ error: "BACKEND_CONFIGURATION_UNAVAILABLE" }, 503) };
  }
  const { url, publishableKey, secretKey } = backend;
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: json({ error: "AUTH_REQUIRED" }, 401) };

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: publishableKey, authorization: `Bearer ${match[1]}` },
  });
  if (!response.ok) return { error: json({ error: "INVALID_OR_EXPIRED_SESSION" }, 401) };
  const user = await response.json();
  if (!user?.id) return { error: json({ error: "INVALID_SESSION" }, 401) };

  // Enforce the server-controlled profile status on every authenticated API call.
  const profileResponse = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=account_status&limit=1`,
    {
      headers: {
        apikey: secretKey,
        authorization: `Bearer ${secretKey}`,
        accept: "application/json"
      }
    }
  );
  if (!profileResponse.ok) return { error: json({ error: "ACCOUNT_STATUS_UNAVAILABLE" }, 503) };
  const profileRows = await profileResponse.json();
  const accountStatus = profileRows?.[0]?.account_status;
  if (accountStatus !== "active") {
    return { error: json({ error: accountStatus === "suspended" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_NOT_ACTIVE" }, 403) };
  }
  return { user, accessToken: match[1] };
}

async function callUserRest(env, accessToken, resourceAndQuery) {
  const { url, publishableKey } = config(env);
  const response = await fetch(`${url}/rest/v1/${resourceAndQuery}`, {
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) {
    const err = new Error("USER_DATA_READ_FAILED");
    err.status = response.status === 401 ? 401 : 400;
    throw err;
  }
  return data;
}

async function callRpc(env, functionName, payload) {
  const { url, secretKey } = config(env);
  const response = await fetch(`${url}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) {
    const message = String(data?.message || data?.hint || "");
    const code = message.match(/[A-Z][A-Z0-9_]{3,}/)?.[0] || "BACKEND_OPERATION_FAILED";
    const err = new Error(code);
    err.status = response.status >= 500 ? 500 : 400;
    throw err;
  }
  return data;
}

async function readJson(request, maxBytes = 16000) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 });
  const text = await request.text();
  if (text.length > maxBytes) throw Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("INVALID_JSON"), { status: 400 }); }
}

function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validAmount(value, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const text = String(value);
  if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? text : null;
}

function idempotencyKey(request) {
  const key = request.headers.get("idempotency-key") || "";
  return key.length >= 8 && key.length <= 128 ? key : null;
}

function fail(error) {
  const status = Number(error?.status) || (error?.message === "BACKEND_NOT_CONFIGURED" ? 503 : 400);
  const safe = new Set([
    "BACKEND_NOT_CONFIGURED", "BODY_TOO_LARGE", "INVALID_JSON", "INVALID_OR_EXPIRED_SESSION",
    "AUTH_REQUIRED", "INVALID_SESSION", "SAME_WALLET_NOT_ALLOWED", "INVALID_AMOUNT",
    "INVALID_IDEMPOTENCY_KEY", "NOTE_TOO_LONG", "WALLET_NOT_FOUND", "WALLET_NOT_ACTIVE",
    "CURRENCY_MISMATCH", "SENDER_WALLET_FORBIDDEN", "INSUFFICIENT_FUNDS", "MERCHANT_FORBIDDEN",
    "INVALID_BUSINESS_NAME", "INVALID_BUSINESS_TYPE", "INVALID_EXPIRY", "DESCRIPTION_TOO_LONG",
    "IDEMPOTENCY_IN_PROGRESS", "USER_DATA_READ_FAILED", "ADMIN_ROLE_REQUIRED", "WITHDRAWAL_NOT_FOUND",
    "MAKER_CANNOT_APPROVE_OWN_WITHDRAWAL", "WITHDRAWAL_NOT_REVIEWABLE", "INVALID_DECISION",
  ]);
  const code = safe.has(error?.message) ? error.message : "BACKEND_OPERATION_FAILED";
  return json({ error: code }, status);
}

export { json, config, requireUser, callUserRest, callRpc, readJson, validUuid, validAmount, idempotencyKey, fail };
