
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
      const text = match[1]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#039;/g, "'")
        .replace(/\s+/g, " ")
        .trim();

      if (/طلا|سکه|دلار|۱۸ عیار|نیم.?سکه|امامی/i.test(text)) {
        messages.push(text);
      }
    }

    return res.status(200).json({
      ok: true,
      test: true,
      source: SOURCE_URL,
      messagesFound: messages.length,
      messages: messages.slice(-15)
    });
  } catch (error) {
    console.error("Market test error:", error.message);

    return res.status(502).json({
      ok: false,
      test: true,
      error: "دریافت یا بررسی پیام‌های نوسان ناموفق بود."
    });
  }
};
