export async function onRequest(context) {
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");

  const contentType = headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html") || response.status === 204 || response.status === 304) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const html = await response.text();
  const scriptTag = '<script type="module" src="/lakaygopay-bridge.js"></script>';
  const updated = html.includes("lakaygopay-bridge.js")
    ? html
    : html.replace(/<\/body>/i, `${scriptTag}\n</body>`);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  return new Response(updated, { status: response.status, statusText: response.statusText, headers });
}
