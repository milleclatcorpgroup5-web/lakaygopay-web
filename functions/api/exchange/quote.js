import { json, requireUser, readJson, validAmount } from "../../_shared/superbase.js";

const BRH_TODAY = "https://www.brh.ht/taux-du-jour/";
const BRH_HOME = "https://www.brh.ht/";
const COMMISSION_RATE = 0.015;
const MONTHS = {
  janvier: "01", fevrier: "02", février: "02", mars: "03", avril: "04",
  mai: "05", juin: "06", juillet: "07", aout: "08", août: "08",
  septembre: "09", octobre: "10", novembre: "11", decembre: "12", décembre: "12"
};

function cleanText(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function parseFrenchDate(value) {
  const match = String(value || "").match(/(\d{1,2})\s+([a-zéûôî]+)\s+(\d{4})/i);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  return match[3] + "-" + month + "-" + match[1].padStart(2, "0");
}
function localToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Port-au-Prince",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}
function numeric(value) {
  const parsed = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "cache-control": "no-cache, no-store, max-age=0",
      pragma: "no-cache"
    },
    cache: "no-store",
    redirect: "follow"
  });
  if (!response.ok) throw new Error("FX_RATE_SOURCE_UNAVAILABLE");
  return response.text();
}
function parseDailyUsd(html, today) {
  const text = cleanText(html);
  const dateMatch = text.match(/Taux du Jour\s*:\s*(\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+\d{4})/i);
  const asOf = parseFrenchDate(dateMatch?.[1]);
  if (!asOf || asOf !== today) throw new Error("FX_RATES_NOT_CURRENT");

  const bankRow = text.match(/MARCHE BANCAIRE\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)/i);
  const referenceRow = text.match(/TAUX DE REFERENCE\s+([0-9]+(?:\.[0-9]+)?)/i);
  const buy = numeric(bankRow?.[1]);
  const sell = numeric(bankRow?.[2]);
  const reference = numeric(referenceRow?.[1]);
  if (!buy || !sell || !reference) throw new Error("FX_RATE_PARSE_FAILED");
  return { buy, sell, reference };
}
function parseCurrentEuro(html, today) {
  if (!html) return null;
  const text = cleanText(html);
  const sectionStart = text.toLowerCase().indexOf("marché des changes");
  const section = sectionStart >= 0 ? text.slice(sectionStart, sectionStart + 5000) : text;
  const dateMatch = section.match(/(\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+\d{4})/);
  if (parseFrenchDate(dateMatch?.[1]) !== today) return null;
  const match = section.match(/Euro\s+Achat\s*:?\s*([0-9.]+)\s+Vente\s*:?\s*([0-9.]+)/i);
  const buy = numeric(match?.[1]);
  const sell = numeric(match?.[2]);
  return buy && sell ? { buy, sell } : null;
}
async function readBrhRates() {
  const today = localToday();
  const [dailyHtml, homeHtml] = await Promise.all([
    fetchHtml(BRH_TODAY),
    fetchHtml(BRH_HOME).catch(() => "")
  ]);
  const usd = parseDailyUsd(dailyHtml, today);
  const eur = parseCurrentEuro(homeHtml, today);

  return {
    as_of: today,
    source: "BRH · Taux du Jour (marché bancaire et taux de référence)" +
      (eur ? " · EUR confirmé sur la page BRH du jour" : ""),
    source_urls: eur ? [BRH_TODAY, BRH_HOME] : [BRH_TODAY],
    rates: { USD: usd, EUR: eur }
  };
}
function buildQuote(source, destination, amount, rates) {
  if (!["HTG","USD","EUR"].includes(source) || !["HTG","USD","EUR"].includes(destination)) {
    throw new Error("FX_CURRENCY_INVALID");
  }
  if (source === destination) throw new Error("FX_SAME_CURRENCY");
  if (source !== "HTG" && destination !== "HTG") {
    throw new Error("FX_PAIR_NOT_SUPPORTED");
  }

  const foreign = destination === "HTG" ? source : destination;
  const currencyRates = rates.rates[foreign];
  if (!currencyRates) throw new Error("FX_CURRENCY_RATE_NOT_CURRENT");
  const fee = round2(amount * COMMISSION_RATE);
  const netSource = round2(amount - fee);
  const rate = destination === "HTG" ? currencyRates.buy : currencyRates.sell;
  const rateDirection = destination === "HTG" ? "buy" : "sell";
  const received = destination === "HTG" ? round2(netSource * rate) : round2(netSource / rate);

  return {
    source_currency: source,
    destination_currency: destination,
    source_amount: round2(amount),
    commission_rate: COMMISSION_RATE,
    commission_amount: fee,
    commission_currency: source,
    net_source_amount: netSource,
    exchange_rate: rate,
    exchange_rate_direction: rateDirection,
    destination_amount_estimate: received,
    as_of: rates.as_of,
    rate_source: rates.source,
    source_urls: rates.source_urls,
    expires_at: new Date(Date.now() + 60 * 1000).toISOString(),
    executable: false,
    mode: "estimate_only"
  };
}

export async function onRequestPost({ request, env }) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  try {
    const body = await readJson(request, 3000);
    const amount = validAmount(body?.amount);
    if (!amount || Number(amount) > 100000000) return json({ error: "FX_AMOUNT_INVALID" }, 400);
    const source = String(body?.source_currency || "").toUpperCase();
    const destination = String(body?.destination_currency || "").toUpperCase();
    if (!["HTG","USD","EUR"].includes(source) || !["HTG","USD","EUR"].includes(destination)) {
      return json({ error: "FX_CURRENCY_INVALID" }, 400);
    }
    if (source === destination) return json({ error: "FX_SAME_CURRENCY" }, 400);
    if (source !== "HTG" && destination !== "HTG") {
      return json({ error: "FX_PAIR_NOT_SUPPORTED" }, 400);
    }

    const rates = await readBrhRates();
    const quote = buildQuote(source, destination, Number(amount), rates);
    return json({ ok: true, quote });
  } catch (error) {
    const map = {
      FX_RATES_NOT_CURRENT: 503,
      FX_RATE_SOURCE_UNAVAILABLE: 503,
      FX_RATE_PARSE_FAILED: 503,
      FX_CURRENCY_RATE_NOT_CURRENT: 503,
      FX_CURRENCY_INVALID: 400,
      FX_SAME_CURRENCY: 400,
      FX_PAIR_NOT_SUPPORTED: 400,
      FX_AMOUNT_INVALID: 400
    };
    const safe = map[error?.message] ? error.message : "FX_QUOTE_UNAVAILABLE";
    return json({ error: safe }, map[safe] || 503);
  }
}
