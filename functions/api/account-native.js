const STAGING_URL = "https://qijahxokldkaqmjinfvy.supabase.co";
const PAGE_SIZE = 20;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Authorization, Accept",
  }});
}
function clean(v, n = 100) { return String(v || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n); }
function page(v) { const n = Number.parseInt(v || "1", 10); return Number.isFinite(n) ? Math.max(1, Math.min(n, 100000)) : 1; }
function search(v) { return clean(v, 80).replace(/[^0-9A-Za-z\\u0600-\\u06FF\\s@._+\\-]/g, "").trim(); }

const PROVINCES = new Set(["آذربایجان شرقی","آذربایجان غربی","اردبیل","اصفهان","البرز","ایلام","بوشهر","تهران","چهارمحال و بختیاری","خراسان جنوبی","خراسان رضوی","خراسان شمالی","خوزستان","زنجان","سمنان","سیستان و بلوچستان","فارس","قزوین","قم","کردستان","کرمان","کرمانشاه","کهگیلویه و بویراحمد","گلستان","گیلان","لرستان","مازندران","مرکزی","هرمزگان","همدان","یزد"]);
function digits(v) { return String(v || "").replace(/[۰-۹]/g, ch => String("۰۱۲۳۴۵۶۷۸۹".indexOf(ch))).replace(/[٠-٩]/g, ch => String("٠١٢٣٤٥٦٧٨٩".indexOf(ch))); }
function validNationalId(v) {
  const value = digits(v);
  if (!/^\d{10}$/.test(value) || new Set(value).size === 1) return false;
  const check = Number(value[9]);
  const sum = [...value.slice(0, 9)].reduce((n, d, i) => n + Number(d) * (10 - i), 0);
  const rem = sum % 11;
  return check === (rem < 2 ? rem : 11 - rem);
}

async function rest(base, key, auth, path, params = {}, counted = false) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const headers = { apikey: key, Authorization: auth };
  if (counted) headers.Prefer = "count=exact";
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("Supabase query failed: " + response.status);
  const rows = await response.json();
  let total = Array.isArray(rows) ? rows.length : 0;
  if (counted) {
    const range = response.headers.get("Content-Range") || "";
    const raw = range.split("/").pop();
    if (raw && raw !== "*") total = Number(raw) || 0;
  }
  return { rows: Array.isArray(rows) ? rows : [], total };
}

async function setting(base, key, auth, settingKey, fallback) {
  try {
    const { rows } = await rest(base, key, auth, "/rest/v1/zarinmah_site_settings", {
      setting_key: "eq." + settingKey, select: "setting_value", limit: 1,
    });
    return rows[0]?.setting_value && typeof rows[0].setting_value === "object"
      ? { ...fallback, ...rows[0].setting_value } : fallback;
  } catch { return fallback; }
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return json({}, 204);
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || "";
  const auth = request.headers.get("Authorization") || "";
  if (base !== STAGING_URL || !key) return json({ ok: false, error: "Staging configuration is incomplete or invalid." }, 503);
  if (!auth.startsWith("Bearer ") || auth.length > 4096) return json({ ok: false, error: "برای ادامه ابتدا وارد حساب کاربری شوید." }, 401);

  try {
    const who = await fetch(base + "/auth/v1/user", { headers: { apikey: key, Authorization: auth } });
    if (!who.ok) return json({ ok: false, error: "نشست ورود معتبر نیست یا منقضی شده است؛ دوباره وارد شوید." }, 401);
    const user = await who.json();
    if (!user.id || (!String(user.phone || "").replace(/\D/g, "").match(/^\d{8,15}$/) && !user.email)) {
      return json({ ok: false, error: "حساب کاربری معتبر نیست." }, 401);
    }
    const headersAuth = auth;
    const [{ rows: profiles }, { rows: roles }] = await Promise.all([
      rest(base, key, headersAuth, "/rest/v1/profiles", { id: "eq." + user.id, select: "id,full_name,mobile,email,username,province,city,address,national_id,is_active", limit: 1 }),
      rest(base, key, headersAuth, "/rest/v1/user_roles", { user_id: "eq." + user.id, select: "role", limit: 1 }),
    ]);
    const profile = profiles[0] || null;
    if (!profile || profile.is_active !== true || !clean(profile.full_name, 100) ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{2,23}$/.test(clean(profile.username, 24)) ||
        clean(profile.address, 500).length < 10 || !validNationalId(profile.national_id) ||
        !PROVINCES.has(clean(profile.province, 80)) || !clean(profile.city, 100)) {
      return json({ ok: false, code: "PROFILE_INCOMPLETE", error: "برای مشاهده پنل، ابتدا اطلاعات پروفایل خود را کامل کنید." }, 409);
    }
    const role = roles[0]?.role || "user";
    const admin = role === "admin";
    const q = new URL(request.url).searchParams;
    const lp = page(q.get("listings_page")), rp = page(q.get("requests_page"));
    let ls = clean(q.get("listings_status"), 20), rs = clean(q.get("requests_status"), 20);
    const lsearch = search(q.get("listings_search")), rsearch = search(q.get("requests_search"));
    if (!["all", "pending", "published", "sold", "deleted"].includes(ls)) ls = "all";
    if (!["all", "pending", "forwarded"].includes(rs)) rs = "all";
    const lparams = {
      select: "id,title,product_type,weight,weight_unit,purity,province,city,description,pricing_method,pricing_value,price,image_url,status,created_at,updated_at,deleted_at,seller_name,seller_mobile,owner_user_id",
      order: "created_at.desc", limit: PAGE_SIZE, offset: (lp - 1) * PAGE_SIZE,
      deleted_at: ls === "deleted" ? "not.is.null" : "is.null",
    };
    const rparams = {
      select: "id,listing_id,buyer_name,buyer_mobile,message,status,created_at,updated_at,buyer_user_id",
      order: "created_at.desc", limit: PAGE_SIZE, offset: (rp - 1) * PAGE_SIZE,
    };
    if (!admin) { lparams.owner_user_id = "eq." + user.id; rparams.buyer_user_id = "eq." + user.id; }
    if (ls === "pending" || ls === "published" || ls === "sold") lparams.status = "eq." + ls;
    if (rs === "pending" || rs === "forwarded") rparams.status = "eq." + rs;
    if (lsearch) { const t = "*" + lsearch + "*"; lparams.or = "(title.ilike." + t + ",product_type.ilike." + t + ",seller_name.ilike." + t + ",seller_mobile.ilike." + t + ",city.ilike." + t + ")"; }
    if (rsearch) { const t = "*" + rsearch + "*"; rparams.or = "(buyer_name.ilike." + t + ",buyer_mobile.ilike." + t + ",message.ilike." + t + ")"; }

    const [listingsResult, requestsResult, paymentResult, subscriptionResult, paymentConfig, tariffConfig] = await Promise.all([
      rest(base, key, headersAuth, "/rest/v1/listings", lparams, true),
      rest(base, key, headersAuth, "/rest/v1/purchase_requests", rparams, true),
      rest(base, key, headersAuth, "/rest/v1/seller_payment_orders", {
        select: "id,purpose,listing_id,package_name,amount_toman,payment_method,status,payer_name,tracking_code,rejection_reason,metadata,created_at,updated_at,reviewed_at",
        user_id: "eq." + user.id, order: "created_at.desc", limit: 50,
      }),
      rest(base, key, headersAuth, "/rest/v1/seller_subscriptions", {
        select: "id,package_code,package_name,price_toman,listing_limit,starts_at,ends_at,status,created_at",
        user_id: "eq." + user.id, order: "ends_at.desc", limit: 20,
      }),
      setting(base, key, headersAuth, "seller_payment_config", {
        method: "manual_card_transfer", enabled: false, card_number: "", card_owner: "",
        instructions: "پس از واریز وجه، تصویر رسید و شماره پیگیری را ثبت کنید.", receipt_deadline_hours: 24,
        gateway_enabled: false, gateway_provider: null,
      }),
      setting(base, key, headersAuth, "seller_tariff_config", { free_listing_quota: 3, listing_price_toman: 25000, listing_duration_days: 30, packages: [] }),
    ]);

    const ids = [...new Set(requestsResult.rows.map(x => x.listing_id).filter(Boolean))];
    let titleMap = {};
    if (ids.length) {
      const { rows } = await rest(base, key, headersAuth, "/rest/v1/listings", {
        id: "in.(" + ids.join(",") + ")", select: "id,title,product_type", limit: ids.length,
      });
      titleMap = Object.fromEntries(rows.map(x => [String(x.id), x.title || x.product_type || "آگهی"]));
    }
    const purchaseRequests = requestsResult.rows.map(row => {
      const out = { ...row, listing_title: titleMap[String(row.listing_id)] || ("آگهی شماره " + row.listing_id) };
      if (!admin) delete out.buyer_mobile;
      return out;
    });
    const packages = Array.isArray(tariffConfig.packages) ? tariffConfig.packages.filter(p => p && p.active === true) : [];
    return json({
      ok: true, profile, role, listings: listingsResult.rows, purchase_requests: purchaseRequests,
      payment_orders: paymentResult.rows, payment_config: paymentConfig, seller_packages: packages,
      seller_subscriptions: subscriptionResult.rows,
      pagination: {
        per_page: PAGE_SIZE,
        listings: { page: lp, total: listingsResult.total, total_pages: Math.max(1, Math.ceil(listingsResult.total / PAGE_SIZE)), status: ls, search: lsearch },
        requests: { page: rp, total: requestsResult.total, total_pages: Math.max(1, Math.ceil(requestsResult.total / PAGE_SIZE)), status: rs, search: rsearch },
      },
    });
  } catch (error) {
    return json({ ok: false, error: "دریافت اطلاعات پنل از پایگاه داده ناموفق بود." }, 502);
  }
}
