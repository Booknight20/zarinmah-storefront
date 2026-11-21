const NEWS_DATA_URL = "https://raw.githubusercontent.com/Booknight20/zarinmah-gold-bot/main/news_ready.json";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 8;

function normalizeText(value) {
  return String(value || "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u200c\s]+/g, " ")
    .trim()
    .toLowerCase();
}

function getPrimaryCategory(item) {
  const title = normalizeText(item.title);
  const titleMatches = item.title_market_matches || {};
  const has = key => Array.isArray(titleMatches[key]) && titleMatches[key].length > 0;
  if (/اقتصاد جهان|اقتصاد جهانی|اروپا|فدرال رزرو|بانک مرکزی اروپا|تورم آمریکا|بازده اوراق|اقتصاد آمریکا/.test(title)) return "global";
  if (has("stock") || /بورس|شاخص کل|شاخص هم وزن|فرابورس|سهام|عرضه اولیه|کارگزاری/.test(title)) return "stock";
  if (/اونس|طلای جهانی|طلای بین الملل|بازار جهانی طلا/.test(title)) return "gold";
  if (/طلا|سکه|شمش|مثقال|طلای ۱۸|طلای 18/.test(title) || has("gold")) return "gold";
  if (/دلار|یورو|درهم|نرخ ارز|بازار ارز|قیمت ارز|ارزها|نرخ دلار|مرکز مبادله/.test(title) || (has("currency") && !/ارز نیست|تقصیر ارز نیست/.test(title))) return "currency";
  return "economy";
}

function getTopicKey(item, category) {
  const title = normalizeText(item.title);
  if (category === "gold") {
    if (/پیش بینی|پیش بینی|چشم انداز|تحلیل|کارشناس|مورگان|صندوق های طلا/.test(title)) return "gold_analysis";
    if (/اونس|طلای جهانی|بازار جهانی/.test(title)) return "gold_world_price";
    if (/نیم سکه|ربع سکه|سکه امامی|سکه بهار آزادی|قیمت سکه|سکه امروز/.test(title)) return "gold_coin_price";
    if (/طلای ۱۸|طلای 18|مثقال|گرم طلا|قیمت طلا امروز/.test(title)) return "gold_domestic_price";
    return "gold_other";
  }
  if (category === "currency") {
    if (/پیش بینی|چشم انداز|تحلیل/.test(title)) return "currency_analysis";
    if (/دلار|یورو|درهم|قیمت ارز|نرخ ارز/.test(title)) return "currency_rates";
    return "currency_other";
  }
  if (category === "stock") {
    if (/شاخص|افت|رشد|صعود|نزول|بازار سهام/.test(title)) return "stock_index";
    if (/عرضه اولیه|پذیره نویسی|وارد بورس|بورس تهران|کارگزاری|تامین مالی|تأمین مالی/.test(title)) return "stock_companies";
    return "stock_other";
  }
  if (category === "global") {
    if (/فدرال رزرو|نرخ بهره|اوراق قرضه|تورم آمریکا/.test(title)) return "global_rates";
    return "global_other";
  }
  if (/صادرات|واردات|تجارت/.test(title)) return "economy_trade";
  if (/تولید|صنعت|واحد صنعتی/.test(title)) return "economy_production";
  if (/بودجه|بدهی|نقدینگی|تورم/.test(title)) return "economy_policy";
  return "economy_other";
}

function scoreItem(item, timestamp, now) {
  const ageHours = Math.max(0, (now - timestamp) / 3600000);
  const freshness = Math.max(0, 16 - ageHours / 2);
  const priority = item.priority === "high" ? 8 : item.priority === "medium" ? 4 : 0;
  const summaryBonus = String(item.summary || item.full_text || "").length >= 100 ? 2 : 0;
  return (Number(item.market_score) || 0) + priority + freshness + summaryBonus;
}

function isBreaking(item) {
  return /فوری|خبر فوری|لحظه ای|لحظه‌ای|فوق العاده مهم/.test(normalizeText(item.title));
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const response = await fetch(NEWS_DATA_URL, {
      headers: {
        "User-Agent": "ZarinMah-Storefront/1.0",
        "Accept": "application/json"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) throw new Error("News repository returned HTTP " + response.status);

    const news = await response.json();
    if (!Array.isArray(news)) throw new Error("News repository returned an invalid data format");

    const now = Date.now();
    const candidates = news
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
      .sort((a, b) => scoreItem(b.item, b.timestamp, now) - scoreItem(a.item, a.timestamp, now));

    const seenLinks = new Set();
    const seenTitles = new Set();
    const seenTopics = new Set();
    const categoryCounts = { gold: 0, currency: 0, stock: 0, global: 0, economy: 0 };
    const categoryLimits = { gold: 3, currency: 2, stock: 2, global: 2, economy: 2 };
    const selected = [];

    for (const candidate of candidates) {
      const { item, timestamp } = candidate;
      const linkKey = item.link.split("#")[0].split("?")[0].replace(/\/$/, "").toLowerCase();
      const titleKey = normalizeText(item.title).replace(/[\s\p{P}]/gu, "");
      if (seenLinks.has(linkKey) || seenTitles.has(titleKey)) continue;

      const category = getPrimaryCategory(item);
      const topic = getTopicKey(item, category);
      const breaking = isBreaking(item);
      if (!breaking && (seenTopics.has(topic) || categoryCounts[category] >= categoryLimits[category])) continue;

      seenLinks.add(linkKey);
      seenTitles.add(titleKey);
      seenTopics.add(topic);
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;

      const date = new Date(timestamp);
      selected.push({
        title: item.title.trim().slice(0, 180),
        link: item.link,
        source: item.source || "منبع خبری",
        publishedAt: date.toISOString(),
        time: (item.source || "منبع خبری") + " · " + new Intl.DateTimeFormat("fa-IR", {
          timeZone: "Asia/Tehran",
          hour: "2-digit",
          minute: "2-digit"
        }).format(date),
        _timestamp: timestamp
      });

      if (selected.length >= MAX_ITEMS) break;
    }

    // اگر تنوع موضوعی کافی نبود، ظرفیت خالی با خبرهای تازه و یکتا تکمیل شود.
    if (selected.length < MAX_ITEMS) {
      for (const { item, timestamp } of candidates) {
        if (selected.length >= MAX_ITEMS) break;
        const linkKey = item.link.split("#")[0].split("?")[0].replace(/\/$/, "").toLowerCase();
        const titleKey = normalizeText(item.title).replace(/[\s\p{P}]/gu, "");
        if (seenLinks.has(linkKey) || seenTitles.has(titleKey)) continue;
        seenLinks.add(linkKey);
        seenTitles.add(titleKey);
        const date = new Date(timestamp);
        selected.push({
          title: item.title.trim().slice(0, 180),
          link: item.link,
          source: item.source || "منبع خبری",
          publishedAt: date.toISOString(),
          time: (item.source || "منبع خبری") + " · " + new Intl.DateTimeFormat("fa-IR", {
            timeZone: "Asia/Tehran",
            hour: "2-digit",
            minute: "2-digit"
          }).format(date),
          _timestamp: timestamp
        });
      }
    }

    selected.sort((a, b) => b._timestamp - a._timestamp);
    const items = selected.map(({ _timestamp, ...item }) => item);

    if (!items.length) {
      return res.status(502).json({
        ok: false,
        items: [],
        message: "در خروجی ربات خبر تازه و مرتبطی برای نمایش وجود ندارد."
      });
    }

    return res.status(200).json({
      ok: true,
      items,
      sources: [...new Set(items.map(item => item.source))],
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
