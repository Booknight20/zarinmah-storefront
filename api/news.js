const FEEDS = [
  { name: "اقتصادنیوز", url: "https://www.eghtesadnews.com/feeds/" },
  { name: "دنیای اقتصاد", url: "https://www.donya-e-eqtesad.com/general-news/rss/" }
];

const KEYWORDS = /طلا|سکه|دلار|ارز|بازارهای? مالی|بورس|تورم|بانک مرکزی|نرخ بهره|اونس|انس جهانی|نفت|اقتصاد ایران/i;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(block, tag) {
  const match = block.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + tag + ">", "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseFeed(xml, source) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = tagValue(block, "title");
    const link = tagValue(block, "link");
    const rawDate = tagValue(block, "pubDate") || tagValue(block, "dc:date");
    const timestamp = rawDate ? Date.parse(rawDate) : NaN;
    if (!title || !KEYWORDS.test(title) || !Number.isFinite(timestamp)) continue;
    if (Date.now() - timestamp > MAX_AGE_MS || timestamp > Date.now() + 5 * 60 * 1000) continue;
    items.push({ title, link, source, timestamp });
  }
  return items;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const results = await Promise.allSettled(FEEDS.map(async feed => {
    const response = await fetch(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ZarinMahNews/1.0)", "Accept": "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(9000)
    });
    if (!response.ok) throw new Error(feed.name + " returned HTTP " + response.status);
    const xml = await response.text();
    if (!/<(?:rss|rdf:RDF|feed)\b/i.test(xml)) throw new Error(feed.name + " returned invalid RSS");
    return parseFeed(xml, feed.name);
  }));

  const items = results
    .filter(result => result.status === "fulfilled")
    .flatMap(result => result.value)
    .sort((a, b) => b.timestamp - a.timestamp);

  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = item.title.replace(/[\s\p{P}]/gu, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      title: item.title.slice(0, 180),
      link: item.link,
      source: item.source,
      publishedAt: new Date(item.timestamp).toISOString(),
      time: item.source + " · " + new Intl.DateTimeFormat("fa-IR", {
        timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit"
      }).format(new Date(item.timestamp))
    });
    if (unique.length >= 8) break;
  }

  if (!unique.length) {
    console.error("News feeds unavailable or no recent relevant headlines", results.map(r => r.status === "rejected" ? String(r.reason?.message || r.reason) : "ok"));
    return res.status(502).json({ ok: false, items: [], message: "خبر تازه و مرتبطی از منابع خبری دریافت نشد." });
  }

  return res.status(200).json({
    ok: true,
    items: unique,
    sources: FEEDS.map(feed => feed.name),
    updatedAt: new Date().toISOString()
  });
};
