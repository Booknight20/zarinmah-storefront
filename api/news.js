const NEWS_DATA_URL = "https://raw.githubusercontent.com/Booknight20/zarinmah-gold-bot/main/news_ready.json";
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    // خروجی نهایی فیلتر و اولویت‌بندی‌شده ربات اخبار زرین ماه
    const response = await fetch(NEWS_DATA_URL, {
      headers: {
        "User-Agent": "ZarinMah-Storefront/1.0",
        "Accept": "application/json"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error("News repository returned HTTP " + response.status);
    }

    const news = await response.json();
    if (!Array.isArray(news)) {
      throw new Error("News repository returned an invalid data format");
    }

    const now = Date.now();
    const items = news
      .map(item => {
        const timestamp = Date.parse(item.published || item.collected_at || "");
        return { item, timestamp };
      })
      .filter(({ item, timestamp }) =>
        item &&
        typeof item.title === "string" &&
        item.title.trim() &&
        typeof item.link === "string" &&
        /^https?:\/\//i.test(item.link) &&
        Number.isFinite(timestamp) &&
        now - timestamp <= MAX_AGE_MS &&
        timestamp <= now + 5 * 60 * 1000
      )
      .sort((a, b) => b.timestamp - a.timestamp);

    const unique = [];
    const seen = new Set();

    for (const { item, timestamp } of items) {
      const key = item.title.replace(/[\s\p{P}]/gu, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const date = new Date(timestamp);
      unique.push({
        title: item.title.trim().slice(0, 180),
        link: item.link,
        source: item.source || "منبع خبری",
        publishedAt: date.toISOString(),
        time: (item.source || "منبع خبری") + " · " + new Intl.DateTimeFormat("fa-IR", {
          timeZone: "Asia/Tehran",
          hour: "2-digit",
          minute: "2-digit"
        }).format(date)
      });

      if (unique.length >= 8) break;
    }

    if (!unique.length) {
      return res.status(502).json({
        ok: false,
        items: [],
        message: "در خروجی ربات خبر تازه و مرتبطی برای نمایش وجود ندارد."
      });
    }

    return res.status(200).json({
      ok: true,
      items: unique,
      sources: [...new Set(unique.map(item => item.source))],
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("ZarinMah bot news error:", error);
    return res.status(502).json({
      ok: false,
      items: [],
      message: "دریافت اخبار از مخزن ربات زرین ماه با خطا روبه‌رو شد."
    });
  }
};
