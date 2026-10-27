javascript
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

function normalizeDigits(value) {
  return value
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[٬،]/g, ",");
}

function cleanHtml(value) {
  return normalizeDigits(
    value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16))
      )
      .replace(/&#(\d+);/g, (_, dec) =>
        String.fromCodePoint(Number(dec))
      )
      .replace(/\s+/g, " ")
      .trim()
  );
}

function parseAmount(text, pattern) {
  const match = text.match(pattern);
  if (!match) return null;

  const digits = match[1].replace(/,/g, "");
  const value = Number(digits);

  return Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function extractPricesFromMessage(text) {
  const prices = {
    gold18: parseAmount(
      text,
      /طلای?\s*(?:18|۱۸)\s*عیار\s*هر\s*گرم\s*[^0-9]{0,30}([0-9][0-9,]*)/i
    ),

    emami: parseAmount(
      text,
      /سکه\s*امامی\s*[^0-9]{0,30}([0-9][0-9,]*)/i
    ),

    half: parseAmount(
      text,
      /نیم\s*سکه\s*[^0-9]{0,30}([0-9][0-9,]*)/i
    ),

    dollar: parseAmount(
      text,
      /دلار\s*آمریکا\s*فروش\s*[^0-9]{0,30}([0-9][0-9,]*)/i
    )
  };

  const required = ["gold18", "emami", "half", "dollar"];
  const missing = required.filter(key => prices[key] === null);

  return {
    prices,
    missing,
    valid: missing.length === 0
  };
}

function extractMessages(html) {
  const messages = [];

  const regex =
    /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const text = cleanHtml(match[1]);

    const hasAllLabels =
      /طلای?\s*(?:18|۱۸)\s*عیار\s*هر\s*گرم/i.test(text) &&
      /سکه\s*امامی/i.test(text) &&
      /نیم\s*سکه/i.test(text) &&
      /دلار\s*آمریکا\s*فروش/i.test(text);

    if (hasAllLabels) {
      messages.push(text);
    }
  }

  return messages;
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
    tehran.hour >= 9 && tehran.hour < 22;

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

    if (!html.includes("tgme_widget_message_text")) {
      throw new Error("Unexpected source page");
    }

    const messages = extractMessages(html);

    if (messages.length === 0) {
      return res.status(502).json({
        ok: false,
        error: "پیام کامل قیمت پیدا نشد.",
        prices: null
      });
    }

    // از جدیدترین پیام کامل شروع می‌کنیم.
    // اگر استخراج قیمت آن ناقص بود، پیام کامل قبلی بررسی می‌شود.
    let selected = null;

    for (let i = messages.length - 1; i >= 0; i--) {
      const result = extractPricesFromMessage(messages[i]);

      if (result.valid) {
        selected = {
          prices: result.prices,
          sourceText: messages[i]
        };
        break;
      }
    }

    if (!selected) {
      return res.status(502).json({
        ok: false,
        error: "قیمت معتبر برای همه دارایی‌ها پیدا نشد.",
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
      prices: selected.prices
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
