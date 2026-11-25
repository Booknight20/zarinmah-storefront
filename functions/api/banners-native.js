const STAGING_URL = "https://qijahxokldkaqmjinfvy.supabase.co";
const BUCKET = "listing-images";
const MAX_IMAGE_BYTES = 1450000;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type, Accept",
  }});
}
function clean(v, n = 500) { return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, n); }
function fail(message, status = 400) { const e = new Error(message); e.status = status; return e; }
function pathEncode(path) { return path.split("/").map(encodeURIComponent).join("/"); }
function validImage(bytes, type) {
  if (type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/png") return bytes[0] === 137 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG";
  if (type === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}
async function api(url, options, message) {
  const r = await fetch(url, options), data = await r.json().catch(() => null);
  if (!r.ok) throw fail(message + (data?.message ? " (" + data.message + ")" : ""), r.status >= 400 && r.status < 500 ? r.status : 502);
  return data;
}
async function authorize(request, base, key) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || auth.length > 4096) throw fail("برای ادامه ابتدا وارد حساب مدیر شوید.", 401);
  const user = await api(base + "/auth/v1/user", { headers: { apikey: key, Authorization: auth } }, "نشست ورود معتبر نیست؛ دوباره وارد شوید.");
  const u = new URL(base + "/rest/v1/user_roles");
  u.searchParams.set("user_id", "eq." + user.id); u.searchParams.set("select", "role"); u.searchParams.set("limit", "1");
  const roles = await api(u, { headers: { apikey: key, Authorization: auth } }, "بررسی سطح دسترسی مدیر ناموفق بود.");
  if (!Array.isArray(roles) || roles[0]?.role !== "admin") throw fail("این عملیات فقط برای مدیر سامانه مجاز است.", 403);
  return auth;
}
async function removeObject(base, key, auth, path) {
  if (!path || !String(path).startsWith("banners/")) return;
  const r = await fetch(base + "/storage/v1/object/" + BUCKET + "/" + pathEncode(path), { method: "DELETE", headers: { apikey: key, Authorization: auth } });
  if (!r.ok) throw new Error("Storage cleanup failed");
}
export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return json({}, 204);
  if (!["GET", "POST", "DELETE"].includes(request.method)) return json({ ok: false, error: "Method not allowed" }, 405);
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || "";
  if (base !== STAGING_URL || !key) return json({ ok: false, error: "تنظیمات Supabase Staging کامل یا معتبر نیست." }, 503);
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.searchParams.get("admin") !== "1") {
      const q = new URLSearchParams({ select: "id,title,image_url,target_url,sort_order,is_active,created_at", is_active: "eq.true", order: "sort_order.asc,created_at.desc", limit: "30" });
      const rows = await api(base + "/rest/v1/zarinmah_banners?" + q, { headers: { apikey: key, Authorization: "Bearer " + key } }, "دریافت پوسترهای فعال ناموفق بود.");
      return json({ ok: true, banners: Array.isArray(rows) ? rows.filter(x => /^https:\/\//i.test(String(x.image_url || ""))) : [], source: "supabase-staging" });
    }
    const auth = await authorize(request, base, key);
    if (request.method === "GET") {
      const q = new URLSearchParams({ select: "id,title,image_url,storage_path,target_url,sort_order,is_active,created_at", order: "sort_order.asc,created_at.desc", limit: "100" });
      const rows = await api(base + "/rest/v1/zarinmah_banners?" + q, { headers: { apikey: key, Authorization: auth } }, "دریافت فهرست پوسترها ناموفق بود.");
      return json({ ok: true, banners: Array.isArray(rows) ? rows : [] });
    }
    if (request.method === "DELETE") {
      let data; try { data = await request.json(); } catch { throw fail("درخواست حذف معتبر نیست."); }
      const id = clean(data?.banner_id, 20); if (!/^\d+$/.test(id)) throw fail("شناسه پوستر معتبر نیست.");
      const q = new URL(base + "/rest/v1/zarinmah_banners"); q.searchParams.set("id", "eq." + id); q.searchParams.set("select", "id,storage_path"); q.searchParams.set("limit", "1");
      const rows = await api(q, { headers: { apikey: key, Authorization: auth } }, "دریافت پوستر برای حذف ناموفق بود.");
      if (!rows?.[0]) throw fail("پوستر موردنظر پیدا نشد.", 404);
      const del = new URL(base + "/rest/v1/zarinmah_banners"); del.searchParams.set("id", "eq." + id);
      await api(del, { method: "DELETE", headers: { apikey: key, Authorization: auth, Prefer: "return=minimal" } }, "حذف پوستر ناموفق بود.");
      let cleanupPending = false; try { await removeObject(base, key, auth, rows[0].storage_path); } catch { cleanupPending = true; }
      return json({ ok: true, storage_cleanup_pending: cleanupPending, message: "پوستر حذف شد." });
    }
    let form; try { form = await request.formData(); } catch { throw fail("فرم ارسالی معتبر نیست."); }
    const id = clean(form.get("banner_id"), 20); if (id && !/^\d+$/.test(id)) throw fail("شناسه پوستر معتبر نیست.");
    const title = clean(form.get("title"), 120), target = clean(form.get("target_url"), 500);
    if (target && !target.startsWith("#") && !/^https?:\/\//i.test(target)) throw fail("لینک مقصد باید با https یا # شروع شود.");
    const rawOrder = clean(form.get("sort_order"), 12), order = rawOrder === "" ? 0 : Number(rawOrder);
    if (!Number.isInteger(order) || order < 0 || order > 9999) throw fail("ترتیب نمایش معتبر نیست.");
    const active = String(form.get("is_active") ?? "true").toLowerCase();
    if (!["true","false","1","0","on","off"].includes(active)) throw fail("وضعیت انتشار معتبر نیست.");
    let old = null;
    if (id) {
      const q = new URL(base + "/rest/v1/zarinmah_banners"); q.searchParams.set("id", "eq." + id); q.searchParams.set("select", "id,image_url,storage_path"); q.searchParams.set("limit", "1");
      const rows = await api(q, { headers: { apikey: key, Authorization: auth } }, "دریافت پوستر برای ویرایش ناموفق بود.");
      old = rows?.[0]; if (!old) throw fail("پوستر موردنظر پیدا نشد.", 404);
    }
    let imageUrl = old?.image_url || "", storagePath = old?.storage_path || "", newPath = "";
    const file = form.get("banner_image");
    if (file && typeof file.arrayBuffer === "function" && file.size > 0) {
      const type = String(file.type || "").toLowerCase();
      if (!["image/jpeg","image/png","image/webp"].includes(type)) throw fail("فرمت تصویر باید JPG، PNG یا WEBP باشد.");
      if (file.size > MAX_IMAGE_BYTES) throw fail("حجم تصویر آماده‌شده نباید بیشتر از ۱٫۴ مگابایت باشد.");
      const bytes = new Uint8Array(await file.arrayBuffer()); if (!validImage(bytes, type)) throw fail("محتوای فایل تصویر معتبر نیست.");
      const ext = type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
      storagePath = "banners/" + crypto.randomUUID() + "." + ext;
      const up = await fetch(base + "/storage/v1/object/" + BUCKET + "/" + pathEncode(storagePath), {
        method: "POST", headers: { apikey: key, Authorization: auth, "Content-Type": type, "x-upsert": "false" }, body: bytes,
      });
      if (!up.ok) throw fail("بارگذاری تصویر در فضای ذخیره‌سازی ناموفق بود.", 502);
      newPath = storagePath; imageUrl = base + "/storage/v1/object/public/" + BUCKET + "/" + pathEncode(storagePath);
    }
    if (!imageUrl) throw fail("برای پوستر جدید، انتخاب تصویر الزامی است.");
    const payload = { title, image_url: imageUrl, storage_path: storagePath || null, target_url: target || null, sort_order: order, is_active: ["true","1","on"].includes(active), updated_at: new Date().toISOString() };
    const db = new URL(base + "/rest/v1/zarinmah_banners"); if (id) db.searchParams.set("id", "eq." + id); else payload.created_at = new Date().toISOString();
    let saved;
    try {
      saved = await api(db, { method: id ? "PATCH" : "POST", headers: { apikey: key, Authorization: auth, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(payload) }, "ذخیره پوستر در پایگاه داده ناموفق بود.");
    } catch (e) { if (newPath) { try { await removeObject(base, key, auth, newPath); } catch {} } throw e; }
    if (newPath && old?.storage_path && old.storage_path !== newPath) { try { await removeObject(base, key, auth, old.storage_path); } catch {} }
    return json({ ok: true, banner: saved?.[0] || null, message: "پوستر با موفقیت ذخیره شد." });
  } catch (e) { return json({ ok: false, error: e.message || "عملیات مدیریت پوستر ناموفق بود." }, e.status || 500); }
}
