const STAGING_URL = "https://qijahxokldkaqmjinfvy.supabase.co";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function onRequestGet({ env }) {
  const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || "";

  if (url !== STAGING_URL) {
    return json({ ok: false, error: "Staging Supabase URL is not configured." }, 503);
  }
  if (!key) {
    return json({ ok: false, error: "Staging publishable key is not configured." }, 503);
  }

  const query = new URLSearchParams({
    select: "id,title,image_url,target_url,sort_order,is_active,created_at",
    is_active: "eq.true",
    order: "sort_order.asc,created_at.desc",
    limit: "30",
  });

  try {
    const response = await fetch(`${url}/rest/v1/zarinmah_banners?${query.toString()}`, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    const rows = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("Public banner query failed:", response.status, rows?.message || rows?.details || "");
      return json({ ok: false, error: "دریافت پوسترهای صفحه اصلی ناموفق بود." }, 502);
    }
    const banners = (Array.isArray(rows) ? rows : []).filter(item =>
      item && typeof item.image_url === "string" && item.image_url.startsWith("https://")
    );
    return json({ ok: true, banners, source: "supabase-staging" });
  } catch (error) {
    console.error("Public banner request failed:", error?.message || error);
    return json({ ok: false, error: "ارتباط با سرویس پوسترها برقرار نشد." }, 502);
  }
}
