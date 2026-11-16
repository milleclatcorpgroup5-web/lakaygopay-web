import { json, requireUser, readJson, validAmount } from "../../_shared/superbase.js";

const BRH_HOME = "https://www.brh.ht/";
const BRH_BANK_RATES = "https://www.brh.ht/taux-affiches-par-les-banques-et-les-agents-de-change-2/";
const COMMISSION_RATE = 0.005;
const MONTHS = {
  janvier: "01", fevrier: "02", février: "02", mars: "03", avril: "04",
  mai: "05", juin: "06", juillet: "07", aout: "08", août: "08",
  septembre: "09", octobre: "10", novembre: "11", decembre: "12", décembre: "12"
};

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
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
    headers: { accept: "text/html,application/xhtml+xml" },
    redirect: "follow"
  });
  if (!response.ok) throw new Error("FX_RATE_SOURCE_UNAVAILABLE");
  return response.text();
}
async function readBrhRates() {
  const [homeHtml, bankHtml] = await Promise.all([
    fetchHtml(BRH_HOME),
    fetchHtml(BRH_BANK_RATES)
  ]);

  const bankDateMatch = bankHtml.match(/Taux affich[eé]s par les banques\s*:\s*([^<\r\n]+)/i);
  const marketIndex = homeHtml.toLowerCase().indexOf("marché des changes");
  const homeMarketSection = marketIndex >= 0 ? homeHtml.slice(marketIndex, marketIndex + 6500) : "";
  const homeDateMatch = homeMarketSection.match(/(\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+\d{4})/);
  const bankDate = parseFrenchDate(cleanText(bankDateMatch?.[1]));
  const homeDate = parseFrenchDate(cleanText(homeDateMatch?.[1]));
  const today = localToday();
  if (!bankDate || !homeDate || bankDate !== today || homeDate !== today) {
    throw new Error("FX_RATES_NOT_CURRENT");
  }

  const rows = [...bankHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  let usdBuy = null;
  let usdSell = null;
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => cleanText(cell[1]));
    if (cells[0]?.toUpperCase() === "BUH") {
      usdBuy = numeric(cells[2]);
      usdSell = numeric(cells[3]);
      break;
    }
  }

  const euroMatch = homeMarketSection.match(/>\s*Euro\s*<\/[a-z0-9]+>[\s\S]{0,900}?Achat\s*:\s*([0-9.]+)[\s\S]{0,250}?Vente\s*:\s*([0-9.]+)/i) ||
    homeMarketSection.match(/Euro[\s\S]{0,700}?Achat\s*:\s*([0-9.]+)[\s\S]{0,250}?Vente\s*:\s*([0-9.]+)/i);
  const eurBuy = numeric(euroMatch?.[1]);
  const eurSell = numeric(euroMatch?.[2]);

  const usdRefMatch = homeMarketSection.match(/([0-9.]+)\s*<\/p>\s*<p>Taux de Référence/i);
  const usdReference = numeric(usdRefMatch?.[1]);
  if (!usdBuy || !usdSell || !eurBuy || !eurSell || !usdReference) {
    throw new Error("FX_RATE_PARSE_FAILED");
  }
  return {
    as_of: today,
    source: "BRH · taux affichés BUH + BRH/DAI",
    source_urls: [BRH_BANK_RATES, BRH_HOME],
    rates: {
      USD: { buy: usdBuy, sell: usdSell, reference: usdReference },
      EUR: { buy: eurBuy, sell: eurSell }
    }
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

  const fee = round2(amount * COMMISSION_RATE);
  const netSource = round2(amount - fee);
  const foreign = destination === "HTG" ? source : destination;
  const rate = destination === "HTG" ? rates.rates[foreign].buy : rates.rates[foreign].sell;
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
      FX_CURRENCY_INVALID: 400,
      FX_SAME_CURRENCY: 400,
      FX_PAIR_NOT_SUPPORTED: 400,
      FX_AMOUNT_INVALID: 400
    };
    const safe = map[error?.message] ? error.message : "FX_QUOTE_UNAVAILABLE";
    return json({ error: safe }, map[safe] || 503);
  }
}
