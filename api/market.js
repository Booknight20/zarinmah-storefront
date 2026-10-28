
const SOURCE_URL = "https://t.me/s/navasanchannel";
const REPO = "Booknight20/zarinmah-storefront";
const STATE_PATH = "data/market-daily.json";
const BRANCH = "main";

function tehranParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

function normalizeDigits(value) {
  return String(value)
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

  const value = Number(match[1].replace(/,/g, ""));

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

  return {
    prices,
    valid: required.every(key => prices[key] !== null)
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

    if (hasAllLabels) messages.push(text);
  }

  return messages;
}

function getPreviousDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));

  return [
    previous.getUTCFullYear(),
    String(previous.getUTCMonth() + 1).padStart(2, "0"),
    String(previous.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function calculateChanges(current, previous) {
  const result = {};

  for (const key of ["gold18", "emami", "half", "dollar"]) {
    if (!previous || !Number.isFinite(previous[key])) {
      result[key] = {
        direction: "unknown",
        difference: null,
        percent: null
      };
      continue;
    }

    const difference = current[key] - previous[key];

    result[key] = {
      direction:
        difference > 0 ? "up" :
        difference < 0 ? "down" : "same",
      difference,
      percent: previous[key]
        ? Number(((difference / previous[key]) * 100).toFixed(2))
        : null
    };
  }

  return result;
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
}

async function readState(token) {
  const url =
    `https://api.github.com/repos/${REPO}/contents/${STATE_PATH}?ref=${BRANCH}`;

  const response = await fetch(url, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(10000)
  });

  if (response.status === 404) {
    return {
      state: { days: {} },
      sha: null
    };
  }

  if (!response.ok) {
    throw new Error(`GitHub read failed: ${response.status}`);
  }

  const file = await response.json();
  const decoded = Buffer.from(file.content, "base64").toString("utf8");

  let state;

  try {
    state = JSON.parse(decoded);
  } catch {
    throw new Error("Daily market history file contains invalid JSON");
  }

  if (!state || typeof state !== "object" ||
      !state.days || typeof state.days !== "object") {
    state = { days: {} };
  }

  return { state, sha: file.sha };
}

async function writeState(token, state, sha) {
  const url =
    `https://api.github.com/repos/${REPO}/contents/${STATE_PATH}`;

  const body = {
    message: "Update daily market price history",
    branch: BRANCH,
    content: Buffer.from(
      JSON.stringify(state, null, 2),
      "utf8"
    ).toString("base64")
  };

  if (sha) body.sha = sha;

  const response = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`GitHub write failed: ${response.status}`);
  }
}

async function saveTodayPrices(token, dateString, prices) {
  // Retry to reduce conflicts if multiple requests arrive together.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state, sha } = await readState(token);

    if (!state.days) state.days = {};

    const previousDate = getPreviousDate(dateString);
    const previous = state.days[previousDate] || null;

    // Keep the latest successful price snapshot for today.
    // Never replace yesterday's record with today's prices.
    state.days[dateString] = {
      prices,
      updatedAt: new Date().toISOString()
    };

    // Keep the latest 14 calendar dates to limit file size.
    const dates = Object.keys(state.days).sort();
    for (const oldDate of dates.slice(0, Math.max(0, dates.length - 14))) {
      delete state.days[oldDate];
    }

    try {
      await writeState(token, state, sha);
      return {
        previousDate,
        previousPrices: previous?.prices || null,
        saved: true
      };
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }

  throw new Error("Could not save daily price history");
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
  const tehran = tehranParts(now);
  const dateString = `${tehran.year}-${tehran.month}-${tehran.day}`;
  const hour = Number(tehran.hour);

  if (hour < 9 || hour >= 22) {
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

    if (!messages.length) {
      return res.status(502).json({
        ok: false,
        error: "پیام کامل قیمت پیدا نشد.",
        prices: null
      });
    }

    let selected = null;

    for (let i = messages.length - 1; i >= 0; i--) {
      const result = extractPricesFromMessage(messages[i]);

      if (result.valid) {
        selected = result.prices;
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

    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      throw new Error("GITHUB_TOKEN is not configured");
    }

    let history;

    try {
      history = await saveTodayPrices(token, dateString, selected);
    } catch (error) {
      console.error("Market history save error:", error.message);

      // Current prices can still be returned if history storage fails.
      // Daily comparisons must not be guessed.
      return res.status(200).json({
        ok: true,
        marketOpen: true,
        source: SOURCE_URL,
        currency: "تومان",
        updatedAt: now.toISOString(),
        timezone: "Asia/Tehran",
        prices: selected,
        previousDate: getPreviousDate(dateString),
        dailyChanges: calculateChanges(selected, null),
        historySaved: false,
        message: "قیمت دریافت شد، اما ذخیره سابقه روزانه ناموفق بود."
      });
    }

    return res.status(200).json({
      ok: true,
      marketOpen: true,
      source: SOURCE_URL,
      currency: "تومان",
      updatedAt: now.toISOString(),
      timezone: "Asia/Tehran",
      prices: selected,
      previousDate: history.previousDate,
      dailyChanges: calculateChanges(
        selected,
        history.previousPrices
      ),
      historySaved: history.saved
    });
  } catch (error) {
    console.error("Market API error:", error.message);

    return res.status(502).json({
      ok: false,
      error: "دریافت قیمت یا آماده‌سازی سابقه بازار ناموفق بود.",
      prices: null
    });
  }
};
