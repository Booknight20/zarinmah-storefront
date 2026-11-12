const MAX_BODY_SIZE = 5 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  return values
    .map(value => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
    return res.status(204).end();
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const configuredUrl = process.env.ZARINMAH_BACKEND_API_URL;
  if (!configuredUrl) {
    return res.status(500).json({ ok: false, error: "Backend API is not configured." });
  }

  try {
    const target = new URL(configuredUrl);
    const incoming = new URL(req.url, "https://storefront.invalid");
    for (const [key, value] of incoming.searchParams) {
      target.searchParams.append(key, value);
    }

    const headers = new Headers({
      Accept: req.headers.accept || "application/json"
    });
    const protectionBypass = process.env.ZARINMAH_BACKEND_PROTECTION_BYPASS;
    if (protectionBypass) {
      headers.set("x-vercel-protection-bypass", protectionBypass);
    }
    if (req.headers.authorization) {
      headers.set("Authorization", req.headers.authorization);
    }
    if (req.headers["content-type"]) {
      headers.set("Content-Type", req.headers["content-type"]);
    }

    const body = req.method === "POST" ? await readBody(req) : undefined;
    let currentUrl = target;
    let cookie = "";
    let upstream;

    for (let attempt = 0; attempt < 4; attempt++) {
      const requestHeaders = new Headers(headers);
      if (cookie) requestHeaders.set("Cookie", cookie);

      upstream = await fetch(currentUrl, {
        method: req.method,
        headers: requestHeaders,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(25000)
      });

      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;

      const location = upstream.headers.get("location");
      if (!location) break;

      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.origin !== target.origin) {
        throw new Error("Backend redirected to an unexpected host.");
      }

      const receivedCookie = cookieHeader(upstream);
      if (receivedCookie) cookie = [cookie, receivedCookie].filter(Boolean).join("; ");

      if (upstream.status === 303 || ((upstream.status === 301 || upstream.status === 302) && req.method !== "GET")) {
        throw new Error("Unexpected redirect while forwarding API request.");
      }

      currentUrl = nextUrl;
    }

    if (!upstream || [301, 302, 303, 307, 308].includes(upstream.status)) {
      throw new Error("Backend access redirect could not be completed.");
    }

    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    const payload = Buffer.from(await upstream.arrayBuffer());
    return res.send(payload);
  } catch (error) {
    console.error("Listings proxy error:", error.message);
    return res.status(502).json({
      ok: false,
      error: "ارتباط امن با سرویس آگهی‌ها برقرار نشد."
    });
  }
};
