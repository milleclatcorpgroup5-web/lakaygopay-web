(function () {
  "use strict";

  if (window.__lakayGoPayObservabilityLoaded) return;
  window.__lakayGoPayObservabilityLoaded = true;

  var originalFetch = window.fetch.bind(window);
  var lastAccessToken = null;
  var recentEvents = new Map();
  var TELEMETRY_PATH = "/api/logs/client";

  function makeId() {
    try { return crypto.randomUUID(); }
    catch { return "lgp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10); }
  }

  function cleanPath(value) {
    try {
      var path = new URL(value, window.location.href).pathname;
      return path
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ":id")
        .replace(/\/(?:\d{3,})(?=\/|$)/g, "/:id")
        .slice(0, 180);
    } catch {
      return "/";
    }
  }

  function areaFor(path) {
    if (path.indexOf("/api/admin") === 0) return "admin";
    if (path.indexOf("/api/agents") === 0) return "agent";
    if (path.indexOf("/api/cards") === 0) return "cards";
    if (path.indexOf("/api/merchant") === 0) return "merchant";
    if (path.indexOf("/api/payments") === 0 || path.indexOf("/api/payment-requests") === 0) return "payments";
    if (path.indexOf("/api/wallets") === 0 || path.indexOf("/api/transfers") === 0) return "wallet";
    if (path.indexOf("/api/connect") === 0) return "connect";
    if (path.indexOf("/api/") === 0) return "api";
    return "website";
  }

  function report(event, token) {
    if (!token || !event || event.path === TELEMETRY_PATH) return;
    var key = [event.event_code, event.path, event.http_status || 0].join("|");
    var now = Date.now();
    if (recentEvents.has(key) && now - recentEvents.get(key) < 10000) return;
    recentEvents.set(key, now);
    if (recentEvents.size > 120) {
      recentEvents.forEach(function (timestamp, item) {
        if (now - timestamp > 60000) recentEvents.delete(item);
      });
    }

    var headers = {
      accept: "application/json",
      "content-type": "application/json",
      authorization: "Bearer " + token
    };
    var body = {
      event_code: event.event_code,
      path: cleanPath(event.path || window.location.pathname),
      method: event.method || null,
      http_status: Number.isInteger(event.http_status) ? event.http_status : null,
      request_id: event.request_id || makeId(),
      line: Number.isInteger(event.line) ? event.line : undefined,
      column: Number.isInteger(event.column) ? event.column : undefined,
      filename: event.filename ? cleanPath(event.filename) : undefined
    };
    originalFetch(TELEMETRY_PATH, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
      cache: "no-store",
      keepalive: true
    }).catch(function () {});
  }

  window.fetch = function (input, init) {
    init = init || {};
    var requestUrl;
    try {
      requestUrl = new URL(typeof input === "string" ? input : input.url, window.location.href);
    } catch {
      return originalFetch(input, init);
    }

    var isApi = requestUrl.origin === window.location.origin &&
      requestUrl.pathname.indexOf("/api/") === 0 &&
      requestUrl.pathname !== TELEMETRY_PATH;
    if (!isApi) return originalFetch(input, init);

    var headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    var authorization = headers.get("authorization") || "";
    var match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) lastAccessToken = match[1];

    var requestId = headers.get("x-request-id") || makeId();
    headers.set("x-request-id", requestId);
    var method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    var requestPath = cleanPath(requestUrl.pathname);

    return originalFetch(input, Object.assign({}, init, { headers: headers })).then(function (response) {
      if (response.status >= 400) {
        response.clone().json().then(function (data) {
          var suppliedCode = data && (data.error || data.code);
          var code = typeof suppliedCode === "string" && /^[A-Z][A-Z0-9_]{2,79}$/i.test(suppliedCode)
            ? suppliedCode.toUpperCase()
            : "API_HTTP_" + response.status;
          report({
            event_code: code,
            path: requestPath,
            method: method,
            http_status: response.status,
            request_id: response.headers.get("x-request-id") || requestId
          }, lastAccessToken);
        }).catch(function () {
          report({
            event_code: "API_HTTP_" + response.status,
            path: requestPath,
            method: method,
            http_status: response.status,
            request_id: requestId
          }, lastAccessToken);
        });
      }
      return response;
    }).catch(function (error) {
      report({
        event_code: "API_NETWORK_ERROR",
        path: requestPath,
        method: method,
        http_status: 0,
        request_id: requestId
      }, lastAccessToken);
      throw error;
    });
  };

  window.addEventListener("error", function (event) {
    report({
      event_code: "JS_RUNTIME_ERROR",
      path: window.location.pathname,
      http_status: 0,
      line: Number.isInteger(event.lineno) ? event.lineno : undefined,
      column: Number.isInteger(event.colno) ? event.colno : undefined,
      filename: event.filename || ""
    }, lastAccessToken);
  });

  window.addEventListener("unhandledrejection", function () {
    report({
      event_code: "JS_UNHANDLED_REJECTION",
      path: window.location.pathname,
      http_status: 0
    }, lastAccessToken);
  });
})();
