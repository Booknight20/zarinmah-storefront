const MAX_BODY_SIZE = 5 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function jsonError(status, error) {
  return Response.json({ ok: false, error }, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function collectCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie().map(value => value.split(";")[0]).filter(Boolean).join("; ");
  }
  const value = headers.get("set-cookie");
  return value ? value.split(";")[0] : "";
}

export async function onRequest({ request, env }) {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
        "Cache-Control": "no-store"
      }
    });
  }
  if (method !== "GET" && method !== "POST") {
    return jsonError(405, "Method not allowed");
  }

  const configured = String(env.ZARINMAH_BACKEND_API_URL || "https://zarinmah-seller-bot-git-fix-phone-passw-9f0f7b-booknight20-7409.vercel.app/api/listings").trim();
  if (!configured) return jsonError(503, "Backend API is not configured.");

  let target;
  try {
    target = new URL(configured);
  } catch {
    return jsonError(503, "Backend API configuration is invalid.");
  }
  if (
    target.protocol !== "https:" ||
    !target.hostname.endsWith(".vercel.app") ||
    !target.pathname.endsWith("/api/listings") ||
    target.username || target.password
  ) {
    return jsonError(503, "Backend API must be an approved HTTPS Vercel listings endpoint.");
  }

  const incoming = new URL(request.url);
  for (const [key, value] of incoming.searchParams) target.searchParams.append(key, value);

  let body;
  if (method === "POST") {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_SIZE) return jsonError(413, "Request body is too large.");
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_SIZE) return jsonError(413, "Request body is too large.");
  }

  const headers = new Headers({
    Accept: request.headers.get("Accept") || "application/json"
  });
  const contentType = request.headers.get("Content-Type");
  const authorization = request.headers.get("Authorization");
  if (contentType) headers.set("Content-Type", contentType);
  if (authorization) headers.set("Authorization", authorization);

  const bypass = String(env.ZARINMAH_BACKEND_PROTECTION_BYPASS || "").trim();
  if (bypass) headers.set("x-vercel-protection-bypass", bypass);

  let currentUrl = target;
  let cookie = "";
  let upstream;

  try {
    for (let attempt = 0; attempt <= 4; attempt++) {
      const outgoingHeaders = new Headers(headers);
      if (cookie) outgoingHeaders.set("Cookie", cookie);

      upstream = await fetch(currentUrl, {
        method,
        headers: outgoingHeaders,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(25000)
      });

      if (!REDIRECTS.has(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location) break;

      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.origin !== target.origin) {
        return jsonError(502, "Backend redirected to an unexpected host.");
      }
      const received = collectCookies(upstream.headers);
      if (received) cookie = [cookie, received].filter(Boolean).join("; ");

      if (upstream.status === 303 || ((upstream.status === 301 || upstream.status === 302) && method !== "GET")) {
        return jsonError(502, "Unexpected redirect while forwarding API request.");
      }
      currentUrl = nextUrl;
    }

    if (!upstream || REDIRECTS.has(upstream.status)) {
      return jsonError(502, "Backend access redirect could not be completed.");
    }

    const responseHeaders = new Headers({
      "Cache-Control": "no-store, max-age=0, must-revalidate"
    });
    const responseType = upstream.headers.get("content-type");
    if (responseType) responseHeaders.set("Content-Type", responseType);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders
    });
  } catch (error) {
    console.error("ZarinMah listings gateway error:", error?.message || error);
    return jsonError(502, "ارتباط امن با سرویس آگهی‌ها برقرار نشد.");
  }
}
