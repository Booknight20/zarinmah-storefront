
const SOURCE_URL = "https://t.me/s/navasanchannel";

function normalizeDigits(value) {
  return value
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[٬،]/g, ",");
}

function parseAmount(text, regex) {
  const match = text.match(regex);
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ""));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "فقط درخواست GET مجاز است."
    });
  }

  try {
    const response = await fetch(SOURCE_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      throw new Error("Source HTTP " + response.status);
    }

    const html = await response.text();
    const messages = [];
    const messageRegex =
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

    let match;

    while ((match = messageRegex.exec(html)) !== null) {
      const text = normalizeDigits(
        match[1]
          .replace(/<br\s*\/?>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;|&#160;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim()
      );

      if (
        /طلای?\s*18\s*عیار/i.test(text) &&
        /سکه\s*امامی/i.test(text) &&
        /نیم\s*سکه/i.test(text) &&
        /دلار\s*آمریکا\s*فروش/i.test(text)
      ) {
        messages.push(text);
      }
    }

    const latest = messages[messages.length - 1];

    if (!latest) {
      return res.status(502).json({
        ok: false,
        error: "پیام کامل و قابل‌تشخیص قیمت پیدا نشد.",
        messagesFound: messages.length
      });
    }

    const prices = {
      gold18: parseAmount(
        latest,
        /طلای?\s*18\s*عیار\s*هر\s*گرم\s*[^0-9]{0,20}([0-9][0-9,]*)/i
      ),
      emami: parseAmount(
        latest,
        /سکه\s*امامی\s*[^0-9]{0,20}([0-9][0-9,]*)/i
      ),
      half: parseAmount(
        latest,
        /نیم\s*سکه\s*[^0-9]{0,20}([0-9][0-9,]*)/i
      ),
      dollar: parseAmount(
        latest,
        /دلار\s*آمریکا\s*فروش\s*[^0-9]{0,20}([0-9][0-9,]*)/i
      )
    };

    const missing = Object.entries(prices)
      .filter(([, value]) => value === null)
      .map(([key]) => key);

    return res.status(missing.length ? 502 : 200).json({
      ok: missing.length === 0,
      test: true,
      source: SOURCE_URL,
      currency: "تومان",
      messagesFound: messages.length,
      prices,
      missing,
      sourceText: latest
    });
  } catch (error) {
    console.error("Market test error:", error.message);

    return res.status(502).json({
      ok: false,
      test: true,
      error: "دریافت یا پردازش منبع قیمت ناموفق بود."
    });
  }
};
