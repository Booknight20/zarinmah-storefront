const { list, put } = require("@vercel/blob");

const SOURCE_URL = "https://t.me/s/navasanchannel";
const BLOB_PATH = "market/market-daily.json";
const TIMEZONE = "Asia/Tehran";
const ASSETS = ["gold18", "emami", "half", "dollar"];

// سابقه اولیه قیمت‌ها برای انتقال از فایل قبلی GitHub
const INITIAL_STATE = {
  days: {
    "2026-10-28": {
      prices: { gold18: 26425500, emami: 268000000, half: 141000000, dollar: 269500 },
      updatedAt: "2026-10-28T18:29:45.687Z"
    },
    "2026-10-29": {
      prices: { gold18: 26153100, emami: 266500000, half: 141000000, dollar: 271200 },
      updatedAt: "2026-10-29T16:39:24.677Z"
    },
    "2026-10-30": {
      prices: { gold18: 26097700, emami: 266500000, half: 141000000, dollar: 271200 },
      updatedAt: "2026-10-30T07:14:37.942Z"
    },
    "2026-10-31": {
      prices: { gold18: 25774500, emami: 266500000, half: 141000000, dollar: 274700 },
      updatedAt: "2026-10-31T06:49:50.665Z"
    }
  },
  latest: {
    prices: { gold18: 25774500, emami: 266500000, half: 141000000, dollar: 274700 },
    updatedAt: "2026-10-31T06:49:50.665Z",
    date: "2026-10-31"
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

  return {
    prices,
    valid: ASSETS.every(
      key => Number.isSafeInteger(prices[key]) && prices[key] > 0
    )
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


// =========================================================
// ذخیره‌سازی قیمت‌ها در Vercel Blob
// =========================================================

async function readState() {
  const result = await list({
    prefix: BLOB_PATH,
    limit: 10
  });

  const blob = (result.blobs || []).find(
    item => item.pathname === BLOB_PATH
  );

  if (!blob) {
    return JSON.parse(JSON.stringify(INITIAL_STATE));
  }

  const response = await fetch(blob.url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Blob read failed: ${response.status}`);
  }

  const state = await response.json();

  if (
    !state ||
    typeof state !== "object" ||
    !state.days ||
    typeof state.days !== "object"
  ) {
    throw new Error("Invalid market history structure in Blob");
  }

  return state;
}

async function writeState(state) {
  await put(
    BLOB_PATH,
    Buffer.from(JSON.stringify(state, null, 2), "utf8"),
    {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60
    }
  );
}


// =========================================================
// آخرین قیمت ذخیره‌شده
// =========================================================

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

  const previousDate = getPreviousDate(latest.date);
  const previousPrices = state?.days?.[previousDate]?.prices || null;

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
      previousPrices
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

    const previousDate = getPreviousDate(dateString);
    const previous = state.days[previousDate] || null;

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
        previousDate,
        previousPrices: previous?.prices || null,
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

async function fetchSourcePrices() {
  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ZarinMahMarket/1.0)"
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`Source returned HTTP ${response.status}`);
  }

  const html = await response.text();

  if (!html.includes("tgme_widget_message_text")) {
    throw new Error("Unexpected source page");
  }

  const messages = extractMessages(html);

  for (let i = messages.length - 1; i >= 0; i--) {
    const result = extractPricesFromMessage(messages[i]);

    if (result.valid) return result.prices;
  }

  throw new Error("No valid prices found for all assets");
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

  // خارج از ساعات بازار، آخرین قیمت ذخیره‌شده نمایش داده می‌شود.
  if (!marketOpen) {
    const payload = buildCachedResponse(
      state,
      false,
      "ساعات به‌روزرسانی بازار ۹ تا ۲۲ به وقت تهران است؛ آخرین قیمت معتبر نمایش داده شده است."
    );

    return res.status(payload.ok ? 200 : 503).json(payload);
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
        true,
        "آخرین قیمت دریافت‌شده در کمتر از یک دقیقه اخیر نمایش داده می‌شود."
      );

      return res.status(200).json(payload);
    }
  }

  try {
    const prices = await fetchSourcePrices();
    const updatedAt = new Date().toISOString();

    let previousPrices =
      state.days?.[getPreviousDate(dateString)]?.prices || null;

    let historySaved = false;

    try {
      const history = await saveTodayPrices(
        dateString,
        prices,
        updatedAt
      );

      previousPrices = history.previousPrices;
      historySaved = history.saved;

    } catch (error) {
      console.error(
        "Market Blob history save error:",
        error.message
      );
    }

    return res.status(200).json({
      ok: true,
      marketOpen: true,
      source: SOURCE_URL,
      currency: "تومان",
      updatedAt,
      timezone: TIMEZONE,
      prices,
      previousDate: getPreviousDate(dateString),
      dailyChanges: calculateChanges(
        prices,
        previousPrices
      ),
      historySaved,
      cached: false,
      message: historySaved
        ? "قیمت‌ها با موفقیت دریافت و در فضای ذخیره‌سازی سایت ثبت شدند."
        : "قیمت‌ها دریافت شدند، اما ذخیره سابقه انجام نشد."
    });

  } catch (error) {
    console.error("Market API error:", error.message);

    const payload = buildCachedResponse(
      state,
      true,
      "دریافت قیمت جدید ناموفق بود؛ آخرین قیمت معتبر ذخیره‌شده نمایش داده شده است."
    );

    if (payload.ok) {
      return res.status(200).json(payload);
    }

    return res.status(502).json({
      ...payload,
      error: "دریافت قیمت جدید ناموفق بود و قیمت ذخیره‌شده‌ای نیز در دسترس نیست.",
      historyAvailable: stateAvailable
    });
  }
};
