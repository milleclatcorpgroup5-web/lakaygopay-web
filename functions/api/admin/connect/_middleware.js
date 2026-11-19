// Keep Connect partner administration closed in Production while the
// partner API is disabled and not yet separated into its own Sandbox backend.
// Finance and Risk admin endpoints outside this folder remain available.
export async function onRequest() {
  return new Response(JSON.stringify({
    ok: false,
    error: "CONNECT_NOT_AVAILABLE",
    message: "LakayGoPay Connect administration is paused until the isolated Sandbox environment is ready."
  }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "pragma": "no-cache",
      "x-content-type-options": "nosniff"
    }
  });
}
