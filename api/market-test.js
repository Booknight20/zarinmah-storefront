
const SOURCE_URL = "https://t.me/s/navasanchannel";

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
      headers: {
        "User-Agent": "Mozilla/5.0"
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      throw new Error("Source HTTP " + response.status);
    }

    const html = await response.text();

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/\s+/g, " ");

    return res.status(200).json({
      ok: true,
      test: true,
      source: SOURCE_URL,
      sourceReachable: true,
      pageLength: html.length,
      containsGold: /طلا|طلای|سکه/.test(text),
      containsDollar: /دلار/.test(text),
      message: "صفحه منبع دریافت شد؛ این آزمون هنوز قیمت‌ها را استخراج یا تأیید نمی‌کند."
    });
  } catch (error) {
    console.error("Market test error:", error.message);

    return res.status(502).json({
      ok: false,
      test: true,
      sourceReachable: false,
      error: "دریافت صفحه نوسان ناموفق بود."
    });
  }
};
