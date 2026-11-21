const SOURCE_URL = "https://t.me/s/navasanchannel";
const TGJU_FALLBACK_URL = "https://t.me/s/tgjunews";
const HISTORY_API_URL = process.env.ZARINMAH_MARKET_HISTORY_API_URL || "";
const HISTORY_WRITE_TOKEN = process.env.ZARINMAH_MARKET_HISTORY_WRITE_TOKEN || "";
const TIMEZONE = "Asia/Tehran";
const ASSETS = ["gold18", "emami", "half", "dollar"];
const MAX_SOURCE_AGE_MS = 24 * 60 * 60 * 1000;
const SOURCE_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const MAX_CLOSED_SOURCE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_AGE_MS = 36 * 60 * 60 * 1000;

// سابقه پشتیبان بازیابی‌شده از data/market-daily.json در GitHub
const INITIAL_STATE = {
  "days": {
    "2026-10-28": {
      "prices": {
        "gold18": 26425500,
        "emami": 268000000,
        "half": 141000000,
        "dollar": 269500
      },
      "updatedAt": "2026-10-28T18:29:45.687Z"
    },
    "2026-10-29": {
      "prices": {
        "gold18": 26153100,
        "emami": 266500000,
        "half": 141000000,
        "dollar": 271200
      },
      "updatedAt": "2026-10-29T16:39:24.677Z"
    },
    "2026-10-30": {
      "prices": {
        "gold18": 26097700,
        "emami": 266500000,
        "half": 141000000,
        "dollar": 271200
      },
      "updatedAt": "2026-10-30T07:14:37.942Z"
    },
    "2026-10-31": {
      "prices": {
        "gold18": 25428230,
        "emami": 262000000,
        "half": 139000000,
        "dollar": 273200
      },
      "updatedAt": "2026-10-31T09:11:42.249Z"
    }
  },
  "latest": {
    "prices": {
      "gold18": 25428230,
      "emami": 262000000,
      "half": 139000000,
      "dollar": 273200
    },
    "updatedAt": "2026-10-31T09:11:42.249Z",
    "date": "2026-10-31"
  }
};

function tehranParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
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
    .replace(/[۰-۹]/g, d => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)])
    .replace(/[٠-٩]/g, d => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)])
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

function extractPriceAfterLabel(text, labelPattern, maxChars = 1200) {
  const match = text.match(labelPattern);
  if (!match) return null;
  const section = text.slice(match.index, match.index + maxChars);
  const priceMatch = section.match(
    /قیمت\s*لحظه\s*ای\s*[:：]?\s*([0-9][0-9,]*)\s*ریال/i
  );
  if (!priceMatch) return null;
  const rial = Number(priceMatch[1].replace(/,/g, ""));
  if (!Number.isSafeInteger(rial) || rial <= 0) return null;
  return Math.round(rial / 10);
}

function extractPricesFromMessage(text) {
  const normalized = normalizeDigits(text)
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک");

  const prices = {
    gold18: extractPriceAfterLabel(
      normalized,
      /(?:قیمت\s*)?طلای\s*(?:18|۱۸)\s*عیار/i
    ),
    emami: extractPriceAfterLabel(normalized, /سکه\s*امامی/i),
    half: extractPriceAfterLabel(normalized, /نیم\s*سکه/i),
    dollar: null
  };

  // Prefer the free-market quote, never the bank-exchange or negotiated rate.
  const freeMarket = normalized.match(/قیمت\s*ارزهای\s*آزاد/i);
  if (freeMarket) {
    const section = normalized.slice(freeMarket.index, freeMarket.index + 1800);
    const direct = section.match(/دلار\s*[:：]\s*([0-9][0-9,]*)\s*ریال/i);
    if (direct) {
      const rial = Number(direct[1].replace(/,/g, ""));
      if (Number.isSafeInteger(rial) && rial > 0) prices.dollar = Math.round(rial / 10);
    }
  }

  // TGJU's dedicated currency posts use the exact #قیمت_دلار tag.
  // The negative lookahead prevents matching توافقی/سلیمانیه/هرات variants.
  if (!prices.dollar) {
    const exactDollar = normalized.match(/#قیمت[_\s]*دلار(?![_\p{L}])/iu);
    if (exactDollar) {
      let section = normalized.slice(exactDollar.index, exactDollar.index + 1200);
      const stop = section.search(/#قیمت[_\s]*دلار[_\s]*(?:توافقی|سلیمانیه|هرات|سنا|نیما)/i);
      if (stop >= 0) section = section.slice(0, stop);
      const quote = section.match(/قیمت\s*لحظه\s*ای\s*[:：]?\s*([0-9][0-9,]*)\s*ریال/i);
      if (quote) {
        const rial = Number(quote[1].replace(/,/g, ""));
        if (Number.isSafeInteger(rial) && rial > 0) prices.dollar = Math.round(rial / 10);
      }
    }
  }

  return {
    prices,
    valid: ASSETS.every(key => Number.isSafeInteger(prices[key]) && prices[key] > 0)
  };
}

function extractMessages(html) {
  const messages = [];
  const wrapperRegex =
    /<div class="tgme_widget_message_wrap[^"]*"[^>]*>([\s\S]*?)(?=<div class="tgme_widget_message_wrap|$)/gi;

  let wrapperMatch;
  while ((wrapperMatch = wrapperRegex.exec(html)) !== null) {
    const wrapper = wrapperMatch[1];
    const textMatch = wrapper.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (!textMatch) continue;

    const text = cleanHtml(textMatch[1]);
    const timeMatch = wrapper.match(
      /<time[^>]*datetime=["']([^"']+)["']/i
    );
    const postedAt = timeMatch ? Date.parse(timeMatch[1]) : NaN;

    if (text && Number.isFinite(postedAt)) {
      messages.push({ text, postedAt });
    }
  }

  return messages.sort((a, b) => b.postedAt - a.postedAt);
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

  for (const key of ASSETS) {
    const oldValue = previous?.[key];
    const newValue = current?.[key];

    if (
      !Number.isFinite(newValue) ||
      !Number.isFinite(oldValue) ||
      oldValue <= 0
    ) {
      result[key] = {
        direction: "unknown",
        difference: null,
        percent: null
      };
      continue;
    }

    const difference = newValue - oldValue;

    result[key] = {
      direction:
        difference > 0 ? "up" :
        difference < 0 ? "down" : "same",
      difference,
      percent: Number(((difference / oldValue) * 100).toFixed(2))
    };
  }

  return result;
}

function validPrices(prices) {
  return Boolean(
    prices &&
    ASSETS.every(
      key => Number.isSafeInteger(prices[key]) && prices[key] > 0
    )
  );
}

// Use the most recent stored trading day before the requested date.
// This keeps comparisons working across weekends and market holidays,
// without ever comparing a price against another price from the same day.
function getPreviousEntry(state, dateString) {
  const dates = Object.keys(state?.days || {})
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && date < dateString)
    .sort()
    .reverse();

  for (const date of dates) {
    const entry = state.days[date];
    if (validPrices(entry?.prices)) {
      return { date, prices: entry.prices };
    }
  }

  return null;
}


// =========================================================
// ذخیره‌سازی قیمت‌ها در Vercel Blob
// =========================================================

async function readState() {
  if (!HISTORY_API_URL) {
    throw new Error("Market history API URL is not configured");
  }

  const response = await fetch(HISTORY_API_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error("Market history API returned HTTP " + response.status);
  }

  const payload = await response.json();

  if (payload?.ok && payload.found && payload.state &&
      typeof payload.state.days === "object") {
    return payload.state;
  }

  if (payload?.ok && !payload.found) {
    return JSON.parse(JSON.stringify(INITIAL_STATE));
  }

  throw new Error("Invalid response from market history API");
}

async function writeState(state) {
  if (!HISTORY_API_URL || !HISTORY_WRITE_TOKEN) {
    throw new Error("Market history write credentials are not configured");
  }

  const response = await fetch(HISTORY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Market-History-Token": HISTORY_WRITE_TOKEN
    },
    body: JSON.stringify({ state }),
    signal: AbortSignal.timeout(15000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !payload?.saved) {
    throw new Error("Market history save failed (HTTP " + response.status + ")");
  }
}


// =========================================================
// آخرین قیمت ذخیره‌شده
// =========================================================


// تاریخچه محدود قیمت برای نمودار روند
function getGoldTrendHistory(state, latestOverride = null) {
  const entries = Object.entries(state?.days || {})
    .filter(([date, entry]) =>
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(entry?.prices?.gold18) &&
      entry.prices.gold18 > 0
    )
    .map(([date, entry]) => ({
      date,
      price: entry.prices.gold18,
      updatedAt: entry.updatedAt || null
    }));

  if (latestOverride?.date && Number.isFinite(latestOverride?.prices?.gold18)) {
    const existing = entries.findIndex(item => item.date === latestOverride.date);
    const latestItem = {
      date: latestOverride.date,
      price: latestOverride.prices.gold18,
      updatedAt: latestOverride.updatedAt || null
    };
    if (existing >= 0) entries[existing] = latestItem;
    else entries.push(latestItem);
  }

  return entries
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);
}

function getLatestSaved(state) {
  if (
    state?.latest &&
    validPrices(state.latest.prices) &&
    state.latest.updatedAt
  ) {
    const savedDate =
      state.latest.date ||
      (() => {
        const parts = tehranParts(
          new Date(state.latest.updatedAt)
        );
        return `${parts.year}-${parts.month}-${parts.day}`;
      })();

    return {
      prices: state.latest.prices,
      updatedAt: state.latest.updatedAt,
      date: savedDate
    };
  }

  const dates = Object.keys(state?.days || {}).sort().reverse();

  for (const date of dates) {
    const entry = state.days[date];

    if (validPrices(entry?.prices) && entry?.updatedAt) {
      return {
        prices: entry.prices,
        updatedAt: entry.updatedAt,
        date
      };
    }
  }

  return null;
}


// =========================================================
// پاسخ قیمت ذخیره‌شده
// =========================================================

function buildCachedResponse(state, marketOpen, message) {
  const latest = getLatestSaved(state);

  if (!latest) {
    return {
      ok: false,
      marketOpen,
      timezone: TIMEZONE,
      source: SOURCE_URL,
      currency: "تومان",
      prices: null,
      message: message ||
        "هنوز قیمت معتبری ذخیره نشده است. لطفاً کمی بعد دوباره تلاش کنید."
    };
  }

  const latestAge = Date.now() - new Date(latest.updatedAt).getTime();
  if (!Number.isFinite(latestAge) || latestAge < 0 || latestAge > MAX_CACHED_AGE_MS) {
    return {
      ok: false,
      marketOpen,
      timezone: TIMEZONE,
      source: SOURCE_URL,
      currency: "تومان",
      prices: null,
      updatedAt: latest.updatedAt,
      cached: true,
      stale: true,
      message: "آخرین داده قیمت قدیمی است و برای جلوگیری از نمایش قیمت نادرست، فعلاً نمایش داده نمی‌شود."
    };
  }

  const previousEntry = getPreviousEntry(state, latest.date);
  const previousDate = previousEntry?.date || getPreviousDate(latest.date);

  return {
    ok: true,
    marketOpen,
    source: SOURCE_URL,
    currency: "تومان",
    timezone: TIMEZONE,
    prices: latest.prices,
    updatedAt: latest.updatedAt,
    previousDate,
    dailyChanges: calculateChanges(
      latest.prices,
      previousEntry?.prices || null
    ),
    historySaved: true,
    cached: true,
    message: message ||
      "آخرین قیمت معتبر ذخیره‌شده نمایش داده می‌شود."
  };
}


// =========================================================
// ذخیره قیمت روزانه و آخرین قیمت
// =========================================================

async function saveTodayPrices(dateString, prices, updatedAt) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await readState();

    const previousEntry = getPreviousEntry(state, dateString);

    state.days[dateString] = {
      prices,
      updatedAt
    };

    state.latest = {
      prices,
      updatedAt,
      date: dateString
    };

    const dates = Object.keys(state.days).sort();

    for (
      const oldDate of dates.slice(
        0,
        Math.max(0, dates.length - 14)
      )
    ) {
      delete state.days[oldDate];
    }

    try {
      await writeState(state);

      return {
        previousDate: previousEntry?.date || getPreviousDate(dateString),
        previousPrices: previousEntry?.prices || null,
        saved: true
      };

    } catch (error) {
      if (attempt === 2) throw error;

      console.error(
        `Blob save attempt ${attempt + 1} failed:`,
        error.message
      );
    }
  }

  throw new Error("Could not save daily price history to Blob");
}


// =========================================================
// دریافت قیمت از منبع
// =========================================================

function parseNavasanPrices(text) {
  const normalized = normalizeDigits(text)
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک");

  const readToman = pattern => {
    const match = normalized.match(pattern);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ""));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };

  return {
    gold18: readToman(/طلای\s*(?:18|۱۸)\s*عیار(?:\s*هر\s*گرم)?[\s\S]{0,70}?([0-9][0-9,]*)\s*تومان/i),
    emami: readToman(/سکه\s*امامی[\s\S]{0,50}?([0-9][0-9,]*)\s*تومان/i),
    half: readToman(/نیم\s*سکه[\s\S]{0,50}?([0-9][0-9,]*)\s*تومان/i),
    dollar: readToman(/دلار\s*آمریکا\s*فروش[\s\S]{0,50}?([0-9][0-9,]*)\s*تومان/i)
  };
}

async function fetchTelegramMessages(channel) {
  const response = await fetch("https://t.me/s/" + channel, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ZarinMahMarket/1.0)",
      "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) throw new Error(channel + " returned HTTP " + response.status);
  const html = await response.text();
  if (!html.includes("tgme_widget_message_text")) {
    throw new Error("Unexpected Telegram page for " + channel);
  }
  return extractMessages(html);
}

async function fetchSourcePrices(maxAgeMs = MAX_SOURCE_AGE_MS) {
  const latestPrices = {};
  const timestamps = {};
  const sources = {};

  // Navasan is the primary live feed. Each asset is taken from its newest
  // post independently because some posts omit the dollar line.
  const navasanMessages = await fetchTelegramMessages("navasanchannel");
  for (const message of navasanMessages) {
    const age = Date.now() - message.postedAt;
    if (!Number.isFinite(age) || age < -5 * 60 * 1000 || age > maxAgeMs) continue;

    const parsed = parseNavasanPrices(message.text);
    for (const key of ASSETS) {
      if (latestPrices[key] === undefined &&
          Number.isSafeInteger(parsed[key]) && parsed[key] > 0) {
        latestPrices[key] = parsed[key];
        timestamps[key] = message.postedAt;
        sources[key] = "navasan";
      }
    }
    if (ASSETS.every(key => latestPrices[key] !== undefined)) break;
  }

  // TGJU is only a per-asset fallback when Navasan has no usable fresh quote.
  const missingFromNavasan = ASSETS.filter(key => latestPrices[key] === undefined);
  if (missingFromNavasan.length) {
    const tgjuMessages = await fetchTelegramMessages("tgjunews");
    for (const message of tgjuMessages) {
      const age = Date.now() - message.postedAt;
      if (!Number.isFinite(age) || age < -5 * 60 * 1000 || age > 6 * 60 * 60 * 1000) continue;

      const parsed = extractPricesFromMessage(message.text).prices;
      for (const key of missingFromNavasan) {
        if (latestPrices[key] === undefined &&
            Number.isSafeInteger(parsed[key]) && parsed[key] > 0) {
          latestPrices[key] = parsed[key];
          timestamps[key] = message.postedAt;
          sources[key] = "tgju";
        }
      }
      if (ASSETS.every(key => latestPrices[key] !== undefined)) break;
    }
  }

  const missing = ASSETS.filter(key => latestPrices[key] === undefined);
  if (missing.length) {
    throw new Error("Fresh prices missing from Navasan and TGJU fallback: " + missing.join(", "));
  }

  const newestTimestamp = Math.max(...Object.values(timestamps));
  return {
    prices: latestPrices,
    postedAt: new Date(newestTimestamp).toISOString(),
    assetUpdatedAt: Object.fromEntries(
      Object.entries(timestamps).map(([key, value]) => [key, new Date(value).toISOString()])
    ),
    sources
  };
}


// =========================================================
// API اصلی بازار
// =========================================================

module.exports = async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0, must-revalidate"
  );

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

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

  const dateString =
    `${tehran.year}-${tehran.month}-${tehran.day}`;

  const hour = Number(tehran.hour);
  const marketOpen = hour >= 9 && hour < 22;

  let state = JSON.parse(JSON.stringify(INITIAL_STATE));
  let stateAvailable = false;

  try {
    state = await readState();
    stateAvailable = true;
  } catch (error) {
    console.error("Market Blob read error:", error.message);
  }

  // جلوگیری از دریافت تکراری قیمت در فاصله کمتر از ۵۰ ثانیه
  const latestSaved = getLatestSaved(state);

  if (latestSaved) {
    const age =
      Date.now() - new Date(latestSaved.updatedAt).getTime();

    if (
      Number.isFinite(age) &&
      age >= 0 &&
      age < 50000
    ) {
      const payload = buildCachedResponse(
        state,
        marketOpen,
        marketOpen
          ? "آخرین قیمت دریافت‌شده در کمتر از یک دقیقه اخیر نمایش داده می‌شود."
          : "آخرین قیمت ثبت‌شده نمایش داده می‌شود."
      );

      return res.status(200).json(payload);
    }
  }

  try {
    const sourceData = await fetchSourcePrices(
      marketOpen ? MAX_SOURCE_AGE_MS : MAX_CLOSED_SOURCE_AGE_MS
    );
    const prices = sourceData.prices;
    const updatedAt = sourceData.postedAt;
    // Save against the source post's Tehran date, not today's server date.
    const sourceTehran = tehranParts(new Date(updatedAt));
    const sourceDateString = `${sourceTehran.year}-${sourceTehran.month}-${sourceTehran.day}`;

    let previousEntry = getPreviousEntry(state, sourceDateString);
    // Do not compare against a very old historical quote when recent daily
    // history is missing; that would create a misleading multi-week change.
    const comparisonGapDays = previousEntry
      ? (Date.parse(`${sourceDateString}T00:00:00Z`) - Date.parse(`${previousEntry.date}T00:00:00Z`)) / 86400000
      : Infinity;
    if (!Number.isFinite(comparisonGapDays) || comparisonGapDays > 4) {
      previousEntry = null;
    }
    let previousPrices = previousEntry?.prices || null;
    let comparisonDate = previousEntry?.date || getPreviousDate(sourceDateString);

    let historySaved = false;

    try {
      const history = await saveTodayPrices(
        sourceDateString,
        prices,
        updatedAt
      );

      previousPrices = history.previousPrices;
      comparisonDate = history.previousDate;
      historySaved = history.saved;

    } catch (error) {
      console.error(
        "Market Blob history save error:",
        error.message
      );
    }

    return res.status(200).json({
      ok: true,
      marketOpen,
      source: SOURCE_URL,
      currency: "تومان",
      updatedAt,
      stale: Date.now() - new Date(updatedAt).getTime() > SOURCE_STALE_AFTER_MS,
      assetUpdatedAt: sourceData.assetUpdatedAt,
      assetSources: sourceData.sources,
      timezone: TIMEZONE,
      prices,
      history: getGoldTrendHistory(state, {
        date: sourceDateString,
        prices,
        updatedAt
      }),
      previousDate: comparisonDate,
      dailyChanges: calculateChanges(
        prices,
        previousPrices
      ),
      historySaved,
      cached: false,
      message: !marketOpen
        ? "آخرین قیمت ثبت‌شده از منبع معتبر نمایش داده می‌شود."
        : historySaved
          ? "قیمت‌ها با موفقیت دریافت و در فضای ذخیره‌سازی سایت ثبت شدند."
          : "قیمت‌ها دریافت شدند، اما ذخیره سابقه انجام نشد."
    });

  } catch (error) {
    console.error("Market API error:", error.message);

    const payload = buildCachedResponse(
      state,
      marketOpen,
      marketOpen
        ? "دریافت قیمت جدید ناموفق بود؛ آخرین قیمت معتبر ذخیره‌شده نمایش داده شده است."
        : "منبع قیمت در دسترس نیست؛ آخرین قیمت معتبر ثبت‌شده نمایش داده شده است."
    );

    if (payload.ok) {
      return res.status(200).json(payload);
    }

    return res.status(502).json({
      ...payload,
      error: error.message || "دریافت قیمت جدید ناموفق بود و قیمت ذخیره‌شده‌ای نیز در دسترس نیست.",
      historyAvailable: stateAvailable
    });
  }
};
