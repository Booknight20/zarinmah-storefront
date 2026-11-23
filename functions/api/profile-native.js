const STAGING_URL = "https://qijahxokldkaqmjinfvy.supabase.co";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Authorization, Accept",
    },
  });
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return json({}, 204);
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || "";
  if (base !== STAGING_URL || !key) {
    return json({ ok: false, error: "Staging configuration is incomplete or invalid." }, 503);
  }

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 4096) {
    return json({ ok: false, error: "برای ادامه ابتدا وارد حساب کاربری شوید." }, 401);
  }

  try {
    const authResponse = await fetch(base + "/auth/v1/user", {
      headers: { apikey: key, Authorization: authorization },
    });
    if (!authResponse.ok) {
      return json({ ok: false, error: "نشست ورود معتبر نیست یا منقضی شده است؛ دوباره وارد شوید." }, 401);
    }
    const authUser = await authResponse.json();
    const userId = String(authUser.id || "");
    const phone = String(authUser.phone || "");
    const email = String(authUser.email || "").toLowerCase();
    if (!userId || (!/^\+?[0-9]{8,15}$/.test(phone.replace(/\D/g, "")) && !(base === STAGING_URL && email))) {
      return json({ ok: false, error: "حساب کاربری باید شماره موبایل تأییدشده داشته باشد." }, 401);
    }

    const headers = { apikey: key, Authorization: authorization };
    const profileUrl = new URL(base + "/rest/v1/profiles");
    profileUrl.searchParams.set("id", "eq." + userId);
    profileUrl.searchParams.set("select", "id,full_name,mobile,email,username,province,city,address,national_id,is_active");
    profileUrl.searchParams.set("limit", "1");
    const roleUrl = new URL(base + "/rest/v1/user_roles");
    roleUrl.searchParams.set("user_id", "eq." + userId);
    roleUrl.searchParams.set("select", "role");
    roleUrl.searchParams.set("limit", "1");

    const [profileResponse, roleResponse] = await Promise.all([
      fetch(profileUrl, { headers }),
      fetch(roleUrl, { headers }),
    ]);
    if (!profileResponse.ok || !roleResponse.ok) {
      return json({ ok: false, error: "دریافت اطلاعات حساب از پایگاه داده ناموفق بود." }, 502);
    }
    const [profiles, roles] = await Promise.all([profileResponse.json(), roleResponse.json()]);
    return json({
      ok: true,
      profile: Array.isArray(profiles) ? (profiles[0] || null) : null,
      role: Array.isArray(roles) && roles[0] ? (roles[0].role || "user") : "user",
    });
  } catch {
    return json({ ok: false, error: "بررسی حساب کاربری موقتاً ناموفق بود." }, 502);
  }
}
