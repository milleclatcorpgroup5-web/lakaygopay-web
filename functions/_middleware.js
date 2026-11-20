import { writeSystemLog, systemLogArea, systemLogPath } from "./_shared/system-logs.js";

function getRequestId(request) {
  const supplied = request.headers.get("x-request-id") || "";
  return /^[A-Za-z0-9._-]{8,80}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function scheduleSystemLog(context, event) {
  const task = writeSystemLog(context.env, event);
  if (typeof context.waitUntil === "function") context.waitUntil(task);
  else void task;
}

export async function onRequest(context) {
  const request = context.request;
  const pathname = new URL(request.url).pathname;
  const safePath = systemLogPath(pathname);
  const requestId = getRequestId(request);
  const isApi = pathname.startsWith("/api/");
  const isLogEndpoint = pathname === "/api/logs/client" || pathname === "/api/admin/logs";
  let response;

  try {
    response = await context.next();
  } catch (error) {
    if (!isLogEndpoint) {
      scheduleSystemLog(context, {
        source: "server",
        severity: "error",
        event_code: isApi ? "UNHANDLED_SERVER_EXCEPTION" : "PAGE_RENDER_EXCEPTION",
        path: safePath,
        method: request.method,
        http_status: 500,
        request_id: requestId,
        details: {
          error_name: String(error?.name || "Error").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60),
          cf_ray: request.headers.get("cf-ray") || ""
        }
      });
    }
    if (isApi) {
      response = new Response(JSON.stringify({
        ok: false,
        error: "TEMPORARY_UNAVAILABLE",
        message: "Nou pa kapab trete demann ou an kounye a. Tanpri eseye ankò pita.",
        request_id: requestId
      }), {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    } else {
      response = new Response("Nou pa kapab chaje paj sa a kounye a. Tanpri eseye ankò pita.", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
      });
    }
  }

  if (response.status >= 500 && !isLogEndpoint) {
    const logTask = response.clone().json().catch(() => ({})).then((body) => {
      const candidate = String(body?.error || body?.code || "");
      const diagnostic = String(body?.diagnostic || "");
      const knownCode = /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate);
      const knownDiagnostic = /^[A-Z][A-Z0-9_]{2,79}$/.test(diagnostic);
      return writeSystemLog(context.env, {
        source: "server",
        severity: "error",
        event_code: knownCode ? candidate : (isApi ? "API_HTTP_" : "PAGE_HTTP_") + response.status,
        path: safePath,
        method: request.method,
        http_status: response.status,
        request_id: requestId,
        details: {
          cf_ray: request.headers.get("cf-ray") || "",
          diagnostic: knownDiagnostic ? diagnostic : undefined
        }
      });
    });
    if (typeof context.waitUntil === "function") context.waitUntil(logTask);
    else void logTask;
  }

  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  headers.set("X-Request-ID", requestId);

  const contentType = headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html") || response.status === 204 || response.status === 304) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  // The experimental payment bridge belongs only to the main customer/merchant
  // application. Never inject it into the isolated admin portal or other pages.
  const pathnameForInjection = new URL(context.request.url).pathname;
  if (pathnameForInjection !== "/" && pathnameForInjection !== "/index.html") {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const html = await response.text();
  const scriptTag = '<script type="module" src="/lakaygopay-bridge.js"></script>';
  const updated = html.includes("lakaygopay-bridge.js")
    ? html
    : html.replace(/<\/body>/i, scriptTag + "\n</body>");
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  return new Response(updated, { status: response.status, statusText: response.statusText, headers });
}