const STAGING_URL = "https://qijahxokldkaqmjinfvy.supabase.co";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Authorization, Accept",
    },
  });
}


function clean(v, n = 1500) { return String(v || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n); }
function digits(v) {
  return String(v || "").replace(/[۰-۹]/g, ch => String("۰۱۲۳۴۵۶۷۸۹".indexOf(ch))).replace(/[٠-٩]/g, ch => String("٠١٢٣٤٥٦٧٨٩".indexOf(ch)));
}
const PROVINCES = new Set(["آذربایجان شرقی","آذربایجان غربی","اردبیل","اصفهان","البرز","ایلام","بوشهر","تهران","چهارمحال و بختیاری","خراسان جنوبی","خراسان رضوی","خراسان شمالی","خوزستان","زنجان","سمنان","سیستان و بلوچستان","فارس","قزوین","قم","کردستان","کرمان","کرمانشاه","کهگیلویه و بویراحمد","گلستان","گیلان","لرستان","مازندران","مرکزی","هرمزگان","همدان","یزد"]);
function validNationalId(v) {
  const value = digits(v);
  if (!/^\d{10}$/.test(value) || new Set(value).size === 1) return false;
  const sum = [...value.slice(0, 9)].reduce((n, d, i) => n + Number(d) * (10 - i), 0);
  const rem = sum % 11, check = Number(value[9]);
  return check === (rem < 2 ? rem : 11 - rem);
}
function validPhone(v) { return /^\d{8,15}$/.test(digits(v).replace(/\D/g, "")); }

async function saveProfile(base, key, authorization, user, data) {
  const fullName = clean(data.full_name, 100);
  const username = clean(data.username, 24).toLowerCase();
  const email = clean(data.email, 254).toLowerCase();
  const province = clean(data.province, 80);
  const city = clean(data.city, 100);
  const address = clean(data.address, 500);
  const nationalId = digits(data.national_id);
  if (fullName.length < 5 || fullName.split(/\s+/).filter(Boolean).length < 2) throw Object.assign(new Error("نام و نام خانوادگی کامل را وارد کنید."), { status: 400 });
  if (!/^[a-z0-9][a-z0-9_.-]{2,23}$/.test(username)) throw Object.assign(new Error("نام کاربری باید ۳ تا ۲۴ نویسه و شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد."), { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("نشانی ایمیل معتبر وارد کنید یا کادر آن را خالی بگذارید."), { status: 400 });
  if (!PROVINCES.has(province) || !city) throw Object.assign(new Error("استان و شهر محل سکونت را از فهرست انتخاب کنید."), { status: 400 });
  if (address.length < 10) throw Object.assign(new Error("آدرس کامل محل سکونت را وارد کنید."), { status: 400 });
  if (!validNationalId(nationalId)) throw Object.assign(new Error("کد ملی معتبر ۱۰ رقمی وارد کنید."), { status: 400 });

  const isStagingEmail = base === STAGING_URL && !user.phone && Boolean(user.email);
  let mobile = String(user.phone || "");
  if (isStagingEmail) {
    mobile = digits(data.mobile).replace(/\D/g, "");
    if (!validPhone(mobile)) throw Object.assign(new Error("برای حساب آزمایشی، شماره تماس معتبر وارد کنید."), { status: 400 });
  }
  const headers = { apikey: key, Authorization: authorization, "Content-Type": "application/json", Prefer: "return=representation" };
  const existingUrl = new URL(base + "/rest/v1/profiles");
  existingUrl.searchParams.set("id", "eq." + user.id);
  existingUrl.searchParams.set("select", "id,is_active");
  existingUrl.searchParams.set("limit", "1");
  const existingResponse = await fetch(existingUrl, { headers: { apikey: key, Authorization: authorization } });
  if (!existingResponse.ok) throw Object.assign(new Error("بررسی پروفایل فعلی ناموفق بود."), { status: 502 });
  const existingRows = await existingResponse.json();
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (existing && existing.is_active !== true) throw Object.assign(new Error("حساب کاربری شما غیرفعال است. برای پیگیری با پشتیبانی تماس بگیرید."), { status: 403 });
  const payload = { full_name: fullName, username, email: email || null, mobile: mobile || null, province, city, address, national_id: nationalId, updated_at: new Date().toISOString() };
  const target = new URL(base + "/rest/v1/profiles");
  if (existing) target.searchParams.set("id", "eq." + user.id);
  else payload.id = user.id;
  const response = await fetch(target, { method: existing ? "PATCH" : "POST", headers, body: JSON.stringify(payload) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    const message = String(rows?.message || rows?.details || "");
    if (/unique|duplicate/i.test(message)) throw Object.assign(new Error("این نام کاربری یا کد ملی قبلاً ثبت شده است."), { status: 409 });
    throw Object.assign(new Error("ذخیره پروفایل در پایگاه داده ناموفق بود."), { status: 502 });
  }
  if (!Array.isArray(rows) || !rows[0]) throw Object.assign(new Error("ذخیره پروفایل انجام نشد. کمی بعد دوباره تلاش کنید."), { status: 502 });
  return rows[0];
}


export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return json({}, 204);
  if (request.method !== "GET" && request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

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
    if (request.method === "POST") {
      let data;
      try { data = await request.json(); } catch { return json({ ok: false, error: "اطلاعات ارسالی معتبر نیست." }, 400); }
      if (!data || typeof data !== "object" || Array.isArray(data)) return json({ ok: false, error: "اطلاعات ارسالی معتبر نیست." }, 400);
      try {
        const profile = await saveProfile(base, key, authorization, authUser, data);
        return json({ ok: true, profile, message: "پروفایل شما با موفقیت تکمیل شد." });
      } catch (error) {
        return json({ ok: false, error: error.message || "ذخیره پروفایل ناموفق بود." }, error.status || 502);
      }
    }
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
