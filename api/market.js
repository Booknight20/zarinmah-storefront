
const SOURCE_URL = "https://t.me/s/navasanchannel";
const MAX_AGE_MINUTES = 360;

function tehranTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function parsePrice(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const digits = match[1].replace(/[,\u066C]/g, "");
    const value = Number(digits);

    if (Number.isSafeInteger(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function extractPrices(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

  const number = "([0-9۰-۹٠-٩][0-9۰-۹٠-٩,٬]*)";

  const toEnglish = value => value
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/٬/g, ",");

  const normalized = toEnglish(text);

  const prices = {
    gold18: parsePrice(normalized, [
      new RegExp("طلای\\s*18\\s*عیار\\s*(?:هر\\s*گرم)?\\s*[^0-9]{0,25}" + number, "i"),
      new RegExp("طلای\\s*۱۸\\s*عیار\\s*(?:هر\\s*گرم)?\\s*[^0-9]{0,25}" + number, "i")
    ]),
    emami: parsePrice(normalized, [
      new RegExp("سکه\\s*امامی\\s*[^0-9]{0,25}" + number, "i")
    ]),
    half: parsePrice(normalized, [
      new RegExp("نیم\\s*سکه\\s*[^0-9]{0,25}" + number, "i")
    ]),
    dollar: parsePrice(normalized, [
      new RegExp("دلار\\s*آمریکا\\s*فروش\\s*[^0-9]{0,25}" + number, "i"),
      new RegExp("دلار\\s*[^0-9]{0,25}" + number, "i")
    ])
  };

  return prices;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const now = new Date();
  const tehran = tehranTimeParts(now);
  const isMarketHours =
    (tehran.hour > 9 || (tehran.hour === 9 && tehran.minute >= 0)) &&
    tehran.hour < 22;

  if (!isMarketHours) {
    return res.status(200).json({
      ok: false,
      marketOpen: false,
      timezone: "Asia/Tehran",
      message: "به‌روزرسانی فقط از ساعت ۹ تا ۲۲ تهران انجام می‌شود.",
      prices: null
    });
  }

  try {
    const response = await fetch(SOURCE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ZarinMahMarket/1.0)"
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      throw new Error("Source returned HTTP " + response.status);
    }

    const html = await response.text();

    if (!html.includes("navasanchannel")) {
      throw new Error("Unexpected source page");
    }

    const prices = extractPrices(html);
    const required = ["gold18", "emami", "half", "dollar"];
    const missing = required.filter(key =>
      !Number.isSafeInteger(prices[key]) || prices[key] <= 0
    );

    if (missing.length) {
      return res.status(502).json({
        ok: false,
        error: "قیمت معتبر برای همه دارایی‌ها پیدا نشد.",
        missing,
        prices: null
      });
    }

    return res.status(200).json({
      ok: true,
      marketOpen: true,
      source: SOURCE_URL,
      currency: "تومان",
      updatedAt: now.toISOString(),
      timezone: "Asia/Tehran",
      prices
    });
  } catch (error) {
    console.error("Market API error:", error.message);

    return res.status(502).json({
      ok: false,
      error: "دریافت قیمت از منبع بازار ناموفق بود.",
      prices: null
    });
  }
};
