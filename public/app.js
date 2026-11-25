import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const $ = function (selector) { return document.querySelector(selector); };
const $$ = function (selector) { return Array.from(document.querySelectorAll(selector)); };
let supabase = null;
let activeUserId = null;
let dashboardPromise = null;
let currentProfile = null;
let currentWallets = [];
let currentMerchants = [];
let currentWithdrawals = [];
let currentMerchantPayments = [];
let currentCardProgram = { schema_ready: false, tiers: [], application: null };
let currentConnectPayouts = [];
let currentAgentStatus = null;

const FALLBACK_CARD_TIERS = [
  {tier_code:"BASIC",display_name:"LakayGo Basic",sort_order:1,min_limit_htg:0,max_limit_htg:999999.99,description:"Plafon HTG: 0 rive 999,999.99.",benefits:["Kat klas baz","Bous HTG, USD ak EUR","Kontwòl sekirite"],star_levels:[{star_level:1,star_label:"Basic 1 etwal",min_limit_htg:0,max_limit_htg:333333.33},{star_level:2,star_label:"Basic 2 etwal",min_limit_htg:333333.34,max_limit_htg:666666.66},{star_level:3,star_label:"Basic 3 etwal",min_limit_htg:666666.67,max_limit_htg:999999.99}],application_open:true,issuance_enabled:false,virtual_supported:true,physical_supported:true},
  {tier_code:"STANDARD",display_name:"LakayGo Mwayèn",sort_order:2,min_limit_htg:1000000,max_limit_htg:29999999.99,description:"Plafon HTG: 1,000,000 rive 29,999,999.99.",benefits:["Tout avantaj Basic","Avantaj sèvis entèmedyè","Nivo etwal selon plafon"],star_levels:[{star_level:1,star_label:"Mwayèn 1 etwal",min_limit_htg:1000000,max_limit_htg:10000000},{star_level:2,star_label:"Mwayèn 2 etwal",min_limit_htg:10000000.01,max_limit_htg:20000000},{star_level:3,star_label:"Mwayèn 3 etwal",min_limit_htg:20000000.01,max_limit_htg:29999999.99}],application_open:true,issuance_enabled:false,virtual_supported:true,physical_supported:true},
  {tier_code:"GOLD",display_name:"LakayGo Gold",sort_order:3,min_limit_htg:30000000,max_limit_htg:100000000,description:"Plafon HTG: 30,000,000 rive 100,000,000.",benefits:["Tout avantaj Mwayèn","Avantaj sèvis Gold","Sipò priyoritè selon sèvis"],star_levels:[{star_level:1,star_label:"Gold 1 etwal",min_limit_htg:30000000,max_limit_htg:53333333.33},{star_level:2,star_label:"Gold 2 etwal",min_limit_htg:53333333.34,max_limit_htg:76666666.66},{star_level:3,star_label:"Gold 3 etwal",min_limit_htg:76666666.67,max_limit_htg:100000000}],application_open:true,issuance_enabled:false,virtual_supported:true,physical_supported:true},
  {tier_code:"ELITE_GOLD",display_name:"LakayGo Elite Gold",sort_order:4,min_limit_htg:100000000.01,max_limit_htg:null,description:"Plafon HTG ki depase 100,000,000.",benefits:["Tout avantaj Gold","Avantaj patnè Elite","Relasyon kliyan priyoritè"],star_levels:[{star_level:1,star_label:"Elite Gold 1 etwal",min_limit_htg:100000000.01,max_limit_htg:250000000},{star_level:2,star_label:"Elite Gold 2 etwal",min_limit_htg:250000000.01,max_limit_htg:500000000},{star_level:3,star_label:"Elite Gold 3 etwal",min_limit_htg:500000000.01,max_limit_htg:null}],application_open:true,issuance_enabled:false,virtual_supported:true,physical_supported:true}
];
let currentQrRequest = null;
let currentReceiveRequest = null;
let incomingReceiveToken = new URLSearchParams(window.location.search).get("lgp_receive") || "";
let incomingReceiveLoadedForUser = null;
let incomingQrToken = new URLSearchParams(window.location.search).get("lgp_qr") || "";
let incomingQrLoadedForUser = null;
let qrScannerStream = null;
let qrScannerFrame = null;
let pinConfigured = false;
let pinSetupPendingAfterSignup = false;
let recoveryMode = false;
let deferredInstallPrompt = null;

function message(selector, value, kind) {
  const node = $(selector);
  node.textContent = value || "";
  node.className = "notice" + (kind ? " " + kind : "");
}
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}
function formatMoney(value, currency) {
  const locale = currency === "USD" || currency === "EUR" ? "en-US" : "fr-HT";
  return Number(value || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function statusText(value) {
  const map = {
    active: "Aktif",
    pending: "Ap tann verifikasyon",
    under_review: "An revizyon",
    rejected: "Rejte",
    suspended: "Sispann",
    frozen: "Bloke",
    waitlist: "Sou lis enterè",
    eligible: "Prekalifye — pa yon kat aktif",
    declined: "Pa apwouve",
    withdrawn: "Retire",
    closed: "Fèmen",
    submitted: "Soumèt",
    approved: "Apwouve",
    cancelled: "Anile"
  };
  return map[value] || value || "Pa disponib";
}
function translateError(code) {
  const normalized = String(code || "").trim().toLowerCase();
  if (normalized.includes("email address not authorized") || normalized.includes("email not authorized")) {
    return "Supabase pa otorize voye mesaj nan imèl sa a. Fòk nou mete yon sèvis SMTP pèsonalize an plas pou teste ak tout nouvo itilizatè yo.";
  }
  if (normalized.includes("too many requests") || normalized.includes("rate limit") || normalized.includes("over_email_send_rate_limit")) {
    return "Limit voye imèl la rive. Tann yon ti tan anvan ou mande yon lòt mesaj konfimasyon.";
  }
  if (normalized === "invalid login credentials" ||
      normalized === "invalid_credentials" ||
      normalized === "invalid_grant") {
    return "Sa a se yon erè koneksyon, se pa yon erè enskripsyon. Verifye imèl ak modpas ou. Pou kreye kont, chwazi Kliyan oswa Machann epi peze bouton Kreye kont ki nan fòm lan.";
  }
  if (normalized === "email not confirmed" || normalized === "email_not_confirmed") {
    return "Ou dwe konfime imèl kont sa a anvan ou konekte. Verifye bwat resepsyon ak spam ou.";
  }
  if (normalized.includes("token has expired") || normalized.includes("otp_expired")) {
    return "Kòd oswa lyen konfimasyon an ekspire. Mande yon lòt kòd oswa yon lòt lyen.";
  }
  if (normalized.includes("invalid token") || normalized.includes("otp")) {
    return "Kòd konfimasyon an pa valab. Verifye 6 chif yo epi eseye ankò.";
  }
  const map = {
    AUTH_REQUIRED: "Konekte pou kontinye.",
    INVALID_OR_EXPIRED_SESSION: "Sesyon an ekspire. Konekte ankò.",
    MINIMUM_AGE_18: "Ou dwe gen omwen 18 an pou ouvri kont pèsonèl.",
    EMAIL_ALREADY_REGISTERED: "Imèl sa a deja gen yon kont. Konekte pito oswa itilize yon lòt imèl.",
    EMAIL_DELIVERY_NOT_CONFIGURED: "Supabase pa otorize voye imèl nan adrès sa a. Pou ouvri tès piblik yo, fòk nou konfigire yon sèvis SMTP pèsonalize nan Supabase.",
    EMAIL_RATE_LIMITED: "Limit voye imèl la rive. Tann yon ti tan anvan ou mande yon lòt mesaj konfimasyon.",
    SIGNUP_RESPONSE_INCOMPLETE: "Supabase pa retounen sesyon koneksyon an. Eseye ankò pita.",
    SIGNUP_CONFIRMATION_REQUIRED: "Konfimasyon imèl la toujou aktive nan Supabase. Administrasyon an dwe dezaktive Confirm email pou moun ka antre san kòd.",

    ACCOUNT_SUSPENDED: "Aksè kont sa a sispann. Kontakte sipò LakayGoPay.",
    ACCOUNT_NOT_ACTIVE: "Kont sa a pa aktif. Kontakte sipò LakayGoPay.",
    VALID_PHONE_REQUIRED: "Antre yon nimewo telefòn ki valab.",
    VALID_BUSINESS_PHONE_REQUIRED: "Antre nimewo telefòn biznis la.",
    VALID_BUSINESS_NAME_REQUIRED: "Antre non biznis la.",
    SIGNUP_FAILED: "Kreyasyon kont lan pa reyisi. Verifye enfòmasyon yo.",
    PASSWORD_POLICY_REJECTED: "Modpas la pa satisfè kondisyon sekirite yo.",
    PIN_NOT_SET: "Ou dwe kreye PIN sekirite ou anvan ou fè transfè.",
    PIN_INVALID: "PIN tranzaksyon an pa kòrèk.",
    PIN_TEMPORARILY_LOCKED: "PIN lan bloke tanporèman apre twòp move tantativ.",
    PIN_MUST_BE_4_DIGITS: "PIN lan dwe gen egzakteman 4 chif.",
    PIN_CONFIRMATION_MISMATCH: "Konfimasyon PIN lan pa menm ak PIN ou te antre a.",
    PIN_SETUP_FAILED: "Nou pa t kapab anrejistre PIN lan. Eseye ankò nan Paramèt.",
    CURRENT_PIN_REQUIRED: "Antre PIN aktyèl ou anvan ou chanje li.",
    PIN_CHANGE_CONFLICT: "PIN lan chanje nan yon lòt sesyon. Rafrechi paj la epi eseye ankò.",
    PIN_MUST_DIFFER_FROM_CURRENT: "Nouvo PIN lan dwe diferan ak PIN aktyèl la.",
    PIN_CONFIGURATION_INVALID: "Paramèt sekirite PIN lan pa valab. Kontakte sipò LakayGoPay.",
    PIN_SECURITY_UNAVAILABLE: "Sèvis sekirite PIN lan pa disponib kounye a.",
    INSUFFICIENT_AVAILABLE_FUNDS: "Balans disponib la pa sifi pou transfè sa a.",
    CURRENCY_MISMATCH: "Bous moun k ap voye a ak moun k ap resevwa a dwe nan menm lajan.",
    SENDER_WALLET_FORBIDDEN: "Ou pa gen dwa itilize bous sa a pou voye lajan.",
    WALLET_NOT_FOUND: "Nou pa jwenn youn nan bous yo.",
    MERCHANT_NOT_ACTIVE: "Kont machann sa a poko aktive.",
    ACCOUNT_SUSPENDED: "Kont sa a sispann. Kontakte sipò LakayGoPay.",
    ACCOUNT_NOT_ACTIVE: "Kont sa a pa aktif. Kontakte sipò LakayGoPay.",
    AGENT_ALREADY_ACTIVE: "Kont ou deja gen aksè ajan. Kontakte administrasyon an pou nenpòt chanjman.",
    DEPARTMENT_REQUIRED: "Antre depatman kote w ap sèvi a.",
    COMMUNE_REQUIRED: "Antre komin kote w ap sèvi a.",
    AGENT_ADDRESS_TOO_LONG: "Adrès ajan an depase limit 200 karaktè.",
    AGENT_MOTIVATION_TOO_LONG: "Eksplikasyon motivasyon an depase limit 1,000 karaktè.",
    AGENT_STATUS_UNAVAILABLE: "Estati ajan an pa disponib kounye a. Rafrechi paj la.",
    AGENT_APPLICATIONS_UNAVAILABLE: "Lis aplikasyon ajan yo pa disponib pou administrasyon an.",
    AGENT_APPLICATION_NOT_FOUND: "Nou pa jwenn aplikasyon ajan sa a.",
    PAYMENT_REQUEST_NOT_FOUND: "Nou pa jwenn demann QR sa a.",
    PAYMENT_REQUEST_NOT_PAYABLE: "Demann QR sa a deja peye oswa li pa disponib.",
    PAYMENT_REQUEST_EXPIRED: "Demann QR sa a ekspire.",
    QR_AMOUNT_MISMATCH: "Montan an pa koresponn ak demann QR la.",
    MERCHANT_WALLET_NOT_FOUND: "Bous machann lan pa disponib.",
    SELF_PAYMENT_NOT_ALLOWED: "Ou pa kapab peye pwòp bous ou.",
    WITHDRAWAL_ENCRYPTION_NOT_CONFIGURED: "Sekirizasyon referans retrè a poko konfigire. Kite referans lan vid.",
    INVALID_DESTINATION_TYPE: "Kalite destinasyon retrè a pa valab.",
    INSUFFICIENT_AVAILABLE_FUNDS: "Balans disponib la pa sifi apre rezèvasyon demann yo.",
    FX_RATES_NOT_CURRENT: "Taux BRH yo poko mete ajou pou jodi a. Estimasyon echanj la rete bloke pou evite montre yon move pri.",
    FX_RATE_SOURCE_UNAVAILABLE: "Nou pa kapab konekte ak sous taux BRH yo kounye a.",
    FX_RATE_PARSE_FAILED: "Nou pa kapab li taux BRH yo kòrèkteman. Estimasyon an rete bloke.",
    FX_PAIR_NOT_SUPPORTED: "Nan premye faz la, konvèsyon fèt ant HTG ak USD oswa HTG ak EUR. USD ak EUR dirèk pa disponib.",
    FX_SAME_CURRENCY: "Chwazi de lajan ki diferan.",
    FX_CURRENCY_INVALID: "Chwazi yon lajan ki valab.",
    FX_AMOUNT_INVALID: "Antre yon montan valab pou kalkil la.",
    FX_QUOTE_UNAVAILABLE: "Estimasyon echanj la pa disponib kounye a.",
    CARD_PROGRAM_SCHEMA_PENDING: "Pwogram kat la parèt, men migrasyon bazdone kat la poko aplike. Pa gen okenn kat ki emèt.",
    CARD_APPLICATION_ALREADY_EXISTS: "Ou deja gen yon demann kat ki an kou.",
    CARD_APPLICATION_CLOSED: "Enskripsyon pou klasman sa a fèmen pou kounye a.",
    CARD_TIER_INVALID: "Klasman kat ou chwazi a pa disponib.",
    CARD_TIER_SERVER_ASSIGNED: "Klasman ak etwal la se sistèm LakayGo ki detèmine yo; kliyan pa chwazi yo.",
    CARD_LIMIT_NOT_APPROVED: "Plafon finansye kont ou poko verifye oswa apwouve. Kontakte ekip LakayGo.",
    CARD_FORMAT_INVALID: "Chwazi yon kalite kat ki valab.",
    CARD_PROGRAM_DATA_UNAVAILABLE: "Sèvis enfòmasyon kat la pa disponib kounye a.",
    CARD_FORMAT_UNAVAILABLE: "Kalite kat ou chwazi a poko disponib pou klasman sa a.",
    CARD_APPLICATION_FAILED: "Nou pa kapab anrejistre enterè kat la kounye a.",
    CONNECT_APP_NOT_ACTIVE: "Aplikasyon patnè sa a sispann oswa li poko aktive.",
    CONNECT_CAPABILITY_DENIED: "Aplikasyon patnè sa a pa gen otorizasyon pou operasyon sa a.",
    CONNECT_CHECKOUT_NOT_FOUND: "Nou pa jwenn demann peman sa a.",
    CONNECT_CHECKOUT_NOT_PAYABLE: "Demann peman sa a ekspire, anile oswa deja trete.",
    CONNECT_PAYOUT_NOT_FOUND: "Nou pa jwenn demann retrè aplikasyon patnè a.",
    CONNECT_PAYOUT_FORBIDDEN: "Demann sa a pa pou kont ou.",
    CONNECT_PAYOUT_NOT_PENDING: "Demann sa a pa an atant ankò.",
    CONNECT_PAYOUT_EXPIRED: "Demann peman an ekspire.",
    CONNECT_PAYOUT_WALLET_UNAVAILABLE: "Bous pou resevwa lajan an pa disponib.",
    CONNECT_DATABASE_UNAVAILABLE: "Sèvis LakayGoPay Connect la poko disponib. Ekip la dwe verifye enstalasyon bazdone a.",
    CONNECT_PAYOUT_RECIPIENT_REQUIRED: "Idantifyan kliyan LakayGoPay la obligatwa."
  };
  return map[code] || map[String(code || "").toUpperCase()] || "Nou pa kapab trete demann ou an kounye a. Tanpri eseye ankò pita." ;
}
async function sessionNow() {
  const result = await supabase.auth.getSession();
  if (result.error) throw result.error;
  return result.data.session;
}
async function api(path, options) {
  options = options || {};
  const method = options.method || "GET";
  const session = await sessionNow();
  const headers = { accept: "application/json" };
  if (session && session.access_token) headers.authorization = "Bearer " + session.access_token;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const keyName = "lgp-request:" + method + ":" + path;
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  } else if (options.idempotency) {
    const key = sessionStorage.getItem(keyName) || crypto.randomUUID();
    sessionStorage.setItem(keyName, key);
    headers["Idempotency-Key"] = key;
  }
  const response = await fetch(path, {
    method: method,
    headers: headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) {
    if (options.idempotency && response.status < 500 && response.status !== 409) sessionStorage.removeItem(keyName);
    const requestId = response.headers.get("x-request-id") || "";
    const friendly = response.status >= 500
      ? "Nou pa kapab trete demann ou an kounye a. Tanpri eseye ankò pita." + (requestId ? " Referans: " + requestId.slice(0, 16) : "")
      : translateError(data.error || ("HTTP_" + response.status));
    const error = new Error(friendly);
    error.status = response.status;
    error.code = data.error;
    error.requestId = requestId || null;
    throw error;
  }
  if (options.idempotency) sessionStorage.removeItem(keyName);
  return data;
}
async function provisionMerchant(session) {
  const metadata = session && session.user && session.user.user_metadata ? session.user.user_metadata : {};
  if (metadata.account_type !== "merchant") return;
  const existing = await api("/api/merchant/mine");
  if ((existing.merchants || []).length) return;
  const businessName = String(metadata.business_name || "").trim();
  const businessPhone = String(metadata.business_phone || metadata.phone || "").trim();
  if (!businessName || !businessPhone) return;
  await api("/api/merchant/register", {
    method: "POST",
    body: { business_name: businessName, business_type: "other", contact_phone: businessPhone },
    idempotency: true
  });
}
async function loadDashboard(session) {
  let merchantProvisionError = null;
  try {
    await provisionMerchant(session);
  } catch (error) {
    merchantProvisionError = error;
  }
  const results = await Promise.allSettled([
    api("/api/profile"),
    api("/api/wallets"),
    api("/api/merchant/mine"),
    api("/api/activity"),
    api("/api/pin/status"),
    api("/api/withdrawals"),
    api("/api/payments"),
    api("/api/cards"),
    // Connect is intentionally closed with HTTP 503 until its isolated Sandbox is deployed.
    // Do not poll the closed endpoint on every dashboard load.
    Promise.resolve({ payouts: [] }),
    api("/api/agents/status")
  ]);
  if (results[0].status === "rejected") throw results[0].reason;
  if (results[1].status === "rejected") throw results[1].reason;
  currentProfile = results[0].value.profile || null;
  currentWallets = (results[1].value.wallets || []).filter(function (wallet) { return !wallet.is_system; });
  currentMerchants = results[2].status === "fulfilled" ? (results[2].value.merchants || []) : [];
  const activity = results[3].status === "fulfilled" ? (results[3].value.activity || []) : [];
  currentWithdrawals = results[5].status === "fulfilled" ? (results[5].value.withdrawals || []) : [];
  const paymentRecords = results[6].status === "fulfilled" ? (results[6].value.payments || []) : [];
  currentCardProgram = results[7].status === "fulfilled"
    ? results[7].value
    : { schema_ready: false, tiers: FALLBACK_CARD_TIERS, application: null };
  currentConnectPayouts = results[8].status === "fulfilled" ? (results[8].value.payouts || []) : [];
  currentAgentStatus = results[9].status === "fulfilled" ? results[9].value : { unavailable: true };
  const ownedMerchantIds = new Set(currentMerchants.map(function (merchant) { return merchant.id; }));
  currentMerchantPayments = paymentRecords.filter(function (payment) {
    return ownedMerchantIds.has(payment.merchant_id);
  });
  paymentRecords.forEach(function (payment) {
    activity.push(Object.assign({ kind: "qr_payment", status: "paid" }, payment));
  });
  pinConfigured = results[4].status === "fulfilled" && Boolean(results[4].value.pin_configured);
  renderProfile(session);
  renderWallets();
  renderCardProgram();
  renderConnectPayouts();
  renderAgentStatus(currentAgentStatus);
  renderMerchants(session);
  renderWithdrawals(currentWithdrawals);
  renderMerchantPayments(currentMerchantPayments);
  renderActivity(activity);
  renderPinState(results[4]);
  if (merchantProvisionError) {
    message("#appNotice", "Pwofil ak bous yo chaje, men enskripsyon machann lan poko fini: " +
      translateError(merchantProvisionError.code || merchantProvisionError.message) +
      ". Rafrechi pou eseye ankò.", "error");
  } else if (pinSetupPendingAfterSignup) {
    message("#appNotice", "Kont ou kreye. PIN lan poko anrejistre; ouvri Paramèt pou kreye PIN sekirite ou anvan premye transfè.", "error");
    pinSetupPendingAfterSignup = false;
  } else {
    message("#appNotice", "", "");
  }
}



function renderConnectPayouts() {
  const section = $("#connectPayoutsSection");
  const list = $("#connectPayoutList");
  if (!section || !list) return;
  list.replaceChildren();
  const rows = Array.isArray(currentConnectPayouts) ? currentConnectPayouts : [];
  section.hidden = rows.length === 0;
  if (!rows.length) return;

  rows.forEach(function (payout) {
    const card = document.createElement("article");
    card.className = "surface-card";
    card.dataset.connectPayoutCard = payout.payout_id || "";
    card.style.marginTop = "12px";

    const heading = document.createElement("h3");
    heading.textContent = payout.app_name || "Aplikasyon patnè";
    const amount = document.createElement("strong");
    amount.textContent = formatMoney(payout.amount, payout.currency) + " " + payout.currency;
    const description = document.createElement("p");
    description.className = "field-hint";
    description.textContent = payout.description || "Demann peman atravè LakayGoPay Connect.";
    const details = document.createElement("p");
    details.className = "field-hint";
    details.textContent = "Referans: " + (payout.external_reference || "—") +
      " · Estati: " + statusText(payout.status) +
      (payout.created_at ? " · " + new Date(payout.created_at).toLocaleString("fr-HT") : "");
    card.append(heading, amount, description, details);

    if (payout.status === "pending") {
      const label = document.createElement("label");
      label.textContent = "PIN tranzaksyon LakayGoPay · 4 chif";
      const pin = document.createElement("input");
      pin.type = "password";
      pin.inputMode = "numeric";
      pin.pattern = "[0-9]{4}";
      pin.maxLength = 4;
      pin.autocomplete = "one-time-code";
      pin.placeholder = "••••";
      pin.dataset.connectPayoutPin = "";
      label.append(pin);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button-primary";
      button.dataset.connectPayoutId = payout.payout_id || "";
      button.textContent = "Verifye epi resevwa lajan";
      card.append(label, button);
    }
    list.append(card);
  });
}

function formatHtgLimit(value) {
  return Number(value || 0).toLocaleString("fr-HT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " HTG";
}
function starText(level) {
  const count = Math.max(0, Math.min(3, Number(level) || 0));
  return count ? "★".repeat(count) + "☆".repeat(3-count) : "Nivo poko asiyen";
}
function renderCardProgram() {
  const program=currentCardProgram||{};
  const tiers=(Array.isArray(program.tiers)&&program.tiers.length?program.tiers:FALLBACK_CARD_TIERS).slice().sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
  const assignment=program.limit_assignment||null;
  const assignedTier=program.assigned_tier||null;
  const assignedStar=program.assigned_star||null;
  const application=program.application||null;
  const activeApplication=application&&["waitlist","under_review","eligible"].includes(application.status);
  const schemaReady=Boolean(program.schema_ready);
  const hasApprovedLimit=Boolean(assignment&&assignment.assessment_status==="approved"&&assignedTier&&assignedStar);
  const visibleTier=hasApprovedLimit?(tiers.find(function(tier){return tier.tier_code===assignedTier.tier_code;})||assignedTier):null;
  const banner=$("#cardAssignmentBanner");
  if(!schemaReady){banner.textContent="Pwogram kat la ap tann enstalasyon ak verifikasyon bazdone a.";banner.className="card-assignment-banner pending";}
  else if(!hasApprovedLimit){banner.textContent="Plafon finansye ou poko evalye oswa apwouve. Kat pa disponib pou afiche jiskaske ekip LakayGo fin verifye dosye ou.";banner.className="card-assignment-banner pending";}
  else{banner.textContent="PLAFON LAKAYGO VALIDE: "+formatHtgLimit(assignment.approved_limit_htg)+" · KLASMAN: "+assignedTier.display_name+" · NIVO: "+starText(assignment.star_level)+" ("+assignedStar.star_label+").";banner.className="card-assignment-banner assigned";}

  const grid=$("#cardTierGrid");
  grid.replaceChildren();
  grid.hidden=!visibleTier;
  if(visibleTier){
    const tier=visibleTier;
    const article=document.createElement("article");
    article.className="card-tier-card tier-"+String(tier.tier_code||"").toLowerCase()+" is-assigned";
    const visual=document.createElement("div");visual.className="card-visual";
    const brand=document.createElement("div");brand.className="card-visual-brand";brand.textContent="LAKAYGO";
    const chip=document.createElement("span");chip.className="card-chip";chip.setAttribute("aria-hidden","true");
    const level=document.createElement("div");level.className="card-visual-level";level.textContent=tier.tier_code==="ELITE_GOLD"?"ELITE GOLD":tier.tier_code==="STANDARD"?"MWAYÈN":tier.tier_code;
    const mark=document.createElement("div");mark.className="card-visual-mark";mark.textContent="L";visual.append(brand,chip,level,mark);
    const title=document.createElement("h3");title.textContent=tier.display_name||("LakayGo "+tier.tier_code);
    const range=document.createElement("div");range.className="card-tier-range";range.textContent=formatHtgLimit(tier.min_limit_htg)+" — "+(tier.max_limit_htg==null?"San plafon siperyè":formatHtgLimit(tier.max_limit_htg));
    const badge=document.createElement("span");badge.className="card-tier-assigned-badge";badge.textContent="KLASMAN OU";
    const description=document.createElement("p");description.className="card-tier-description";description.textContent=tier.description||"";
    const starList=document.createElement("div");starList.className="card-star-levels";
    const row=document.createElement("div");row.className="card-star-row";
    const starLabel=document.createElement("span");starLabel.textContent=starText(assignment.star_level)+" · "+(assignedStar.star_label||"Etwal ou");
    const starLimit=document.createElement("small");starLimit.textContent="Plafon apwouve: "+formatHtgLimit(assignment.approved_limit_htg);
    row.append(starLabel,starLimit);starList.append(row);
    const list=document.createElement("ul");
    (Array.isArray(tier.benefits)?tier.benefits:[]).forEach(function(benefit){const item=document.createElement("li");item.textContent=String(benefit);list.append(item);});
    article.append(visual,badge,title,range,description,starList,list);grid.append(article);
  }

  const format=$("#cardFormSelect"),submit=$("#cardInterestSubmit"),interestForm=$("#cardInterestForm");
  const canApply=schemaReady&&hasApprovedLimit&&Boolean(assignedTier.application_open)&&!activeApplication;
  interestForm.hidden=!canApply;
  format.disabled=!canApply;submit.disabled=!canApply;
  if(!schemaReady)message("#cardProgramNotice","Pwogram kat la poko pare nan bazdone a. Ekip LakayGo ap verifye enstalasyon an.","error");
  else if(!hasApprovedLimit)message("#cardProgramNotice","Klasman ak etwal ou poko apwouve. Ou pap wè lòt kat klasman yo; se sèlman kat nivo pa ou a k ap parèt apre validasyon.","");
  else if(activeApplication)message("#cardProgramNotice","Demann ou anrejistre pou "+assignedTier.display_name+" "+starText(assignment.star_level)+". Sa poko vle di yon kat apwouve oswa emèt.","success");
  else if(!assignedTier.application_open)message("#cardProgramNotice","Demann kat pou klasman sa a fèmen tanporèman.","");
  else message("#cardProgramNotice","Ou wè sèlman klasman ak etwal LakayGo apwouve pou kont ou. Sa se yon demann enterè sèlman: pa gen okenn kat fizik oswa vityèl k ap emèt, aktive oswa sèvi pou peye kounye a.","success");

  const status=$("#cardApplicationStatus");
  if(application){status.textContent="Estati demann: "+statusText(application.status)+" · "+(assignedTier?.display_name||application.tier_code)+" · "+starText(application.star_level)+" · "+application.requested_form+" · Plafon lè demann: "+formatHtgLimit(application.approved_limit_htg)+" · "+new Date(application.created_at).toLocaleDateString("fr-HT");status.hidden=false;}
  else{status.textContent="";status.hidden=true;}
}
function renderProfile(session) {
  const profile = currentProfile || {};
  const name = profile.full_name || session.user.user_metadata?.full_name || session.user.email || "Itilizatè";
  $("#welcomeName").textContent = String(name).split(/\s+/)[0];
  $("#accountSummary").textContent = (session.user.email || "") + (profile.phone ? " · " + profile.phone : "");
  $("#accountTypeBadge").textContent = profile.account_type === "merchant" ? "Kont machann" : "Kont kliyan";
  $("#profileFullName").value = profile.full_name || "";
  $("#profileEmail").value = session.user.email || "";
  $("#profilePhone").value = profile.phone || session.user.phone || "Pa bay";
  $("#profileStatus").textContent = "Pwofil konekte";
}
function renderWallets() {
  const grid = $("#walletGrid");
  grid.replaceChildren();
  const currencies = ["HTG", "USD", "EUR"];
  const labels = { HTG: "Goud ayisyen", USD: "Dola ameriken", EUR: "Ewo" };
  for (const currency of currencies) {
    const matches = currentWallets.filter(function (wallet) { return wallet.currency === currency; });
    if (!matches.length) {
      const card = document.createElement("article");
      card.className = "wallet-card";
      const top = document.createElement("div");
      top.className = "wallet-top";
      const name = document.createElement("span");
      name.className = "currency-name";
      name.textContent = labels[currency];
      const code = document.createElement("span");
      code.className = "wallet-currency";
      code.textContent = currency;
      const balance = document.createElement("div");
      balance.className = "wallet-balance";
      balance.textContent = "Bous poko kreye";
      const hint = document.createElement("p");
      hint.className = "wallet-status";
      hint.textContent = "Aplike migrasyon milti-lajan an pou kreye bous sa a.";
      top.append(name, code);
      card.append(top, balance, hint);
      grid.append(card);
      continue;
    }
    matches.forEach(function (wallet) {
      const card = document.createElement("article");
      card.className = "wallet-card";
      const top = document.createElement("div");
      top.className = "wallet-top";
      const name = document.createElement("span");
      name.className = "currency-name";
      name.textContent = labels[currency] + (wallet.merchant_id ? " · Machann" : " · Pèsonèl");
      const code = document.createElement("span");
      code.className = "wallet-currency";
      code.textContent = currency;
      const balance = document.createElement("div");
      balance.className = "wallet-balance";
      balance.textContent = formatMoney(wallet.balance, currency);
      const status = document.createElement("div");
      status.className = "wallet-status";
      status.textContent = "Estati: " + statusText(wallet.status);
      const idRow = document.createElement("div");
      idRow.className = "wallet-id";
      const id = document.createElement("code");
      id.textContent = wallet.wallet_id;
      const copy = document.createElement("button");
      copy.className = "copy-button";
      copy.type = "button";
      copy.dataset.copyWallet = wallet.wallet_id;
      copy.textContent = "Kopye ID";
      idRow.append(id, copy);
      top.append(name, code);
      card.append(top, balance, status, idRow);
      grid.append(card);
    });
  }
  const select = $("#senderWallet");
  select.replaceChildren();
  currentWallets.forEach(function (wallet) {
    const option = document.createElement("option");
    option.value = wallet.wallet_id;
    option.textContent = wallet.currency + " · " + (wallet.merchant_id ? "Machann" : "Pèsonèl") +
      " · " + formatMoney(wallet.balance, wallet.currency);
    select.append(option);
  });
  if (!currentWallets.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Pa gen bous disponib";
    select.append(option);
  }
  populateWalletSelect("#qrPayerWallet", "HTG");
  populatePersonalWalletSelect("#personalReceiveWallet");
  populateWalletSelect("#withdrawWallet");
}
function populateWalletSelect(selector, currency) {
  const node = $(selector);
  if (!node) return;
  node.replaceChildren();
  const wallets = currentWallets.filter(function (wallet) {
    return !currency || wallet.currency === currency;
  });
  wallets.forEach(function (wallet) {
    const option = document.createElement("option");
    option.value = wallet.wallet_id;
    option.textContent = wallet.currency + " · " +
      (wallet.merchant_id ? "Machann" : "Pèsonèl") + " · " +
      formatMoney(wallet.balance, wallet.currency);
    node.append(option);
  });
  if (!wallets.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = currency ? "Pa gen bous " + currency : "Pa gen bous disponib";
    node.append(option);
  }
}
function showClientWorkspace() {
  const client = $("#clientWorkspace");
  const merchant = $("#merchantWorkspace");
  if (client) client.hidden = false;
  if (merchant) merchant.hidden = true;
}
function showMerchantWorkspace() {
  const client = $("#clientWorkspace");
  const merchant = $("#merchantWorkspace");
  if (client) client.hidden = true;
  if (merchant) merchant.hidden = false;
}
function buildRoleWorkspaces() {
  const appView = $("#appView");
  const merchantSection = $("#merchantSection");
  if (!appView || !merchantSection || $("#clientWorkspace")) return;

  const clientWorkspace = document.createElement("div");
  clientWorkspace.id = "clientWorkspace";
  clientWorkspace.className = "role-workspace client-workspace";

  const merchantWorkspace = document.createElement("section");
  merchantWorkspace.id = "merchantWorkspace";
  merchantWorkspace.className = "role-workspace merchant-workspace";
  merchantWorkspace.hidden = true;

  const intro = document.createElement("div");
  intro.className = "merchant-workspace-heading";
  intro.innerHTML = '<div><p class="eyebrow">ESPAS KOMÈSYAL</p><h2>Jesyon biznis ou</h2><p class="muted">Jere demann QR ak peman kliyan yo nan yon espas apa.</p></div>';
  const backButton = document.createElement("button");
  backButton.id = "clientQuickLink";
  backButton.className = "button button-secondary";
  backButton.type = "button";
  backButton.textContent = "Retounen Espas Kliyan";
  intro.append(backButton);
  merchantWorkspace.append(intro, merchantSection);
  merchantSection.hidden = false;

  const excluded = new Set([merchantSection]);
  Array.from(appView.children).forEach((node) => {
    if (node.classList.contains("welcome-row") || node.id === "appNotice" || excluded.has(node)) return;
    clientWorkspace.append(node);
  });

  const priority = new Map([
    ["app-quick-nav", 0], ["walletSection", 1], ["transferSection", 2],
    ["personalReceiveSection", 3], ["personalReceiveLookupSection", 4],
    ["qrPaymentSection", 5], ["exchangeQuoteSection", 6], ["activitySection", 7]
  ]);
  const ordered = Array.from(clientWorkspace.children).sort((a, b) =>
    (priority.get(a.id || "") ?? 50) - (priority.get(b.id || "") ?? 50)
  );
  ordered.forEach((node) => clientWorkspace.append(node));

  appView.append(clientWorkspace, merchantWorkspace);
}
function renderMerchants(session) {
  const isMerchant = session.user.user_metadata?.account_type === "merchant" || currentMerchants.length > 0;
  const section = $("#merchantSection");
  const workspace = $("#merchantWorkspace");
  const quickLink = $("#merchantQuickLink");
  if (section) section.hidden = false;
  if (workspace) workspace.hidden = !isMerchant;
  if (quickLink) quickLink.hidden = !isMerchant;
  if (!isMerchant) {
    showClientWorkspace();
    return;
  }

  // Do not let an older pending/suspended profile hide a different active
  // merchant profile owned by the same account.
  const merchant = currentMerchants.find((item) => item.status === "active") || currentMerchants[0] || null;
  const activeMerchants = currentMerchants.filter((item) => item.status === "active");
  const status = activeMerchants.length ? "active" : (merchant ? merchant.status : "pending");
  $("#merchantStatus").textContent = activeMerchants.length > 1
    ? activeMerchants.length + " pwofil aktif"
    : statusText(status);
  $("#merchantStatus").className = "status-pill " + (status === "active" ? "" : "pending");
  $("#merchantDetails").textContent = merchant
    ? "Biznis: " + merchant.business_name + ". ID machann: " + merchant.id + ". Kont komèsyal la " + statusText(merchant.status).toLowerCase() + "."
    : "Kont machann lan poko parèt nan baz done a. Verifye koneksyon an epi eseye rafrechi.";
  const canReceive = activeMerchants.length > 0;
  $("#merchantQrCreateButton").disabled = !canReceive;
  $("#merchantQrStatus").textContent = canReceive
    ? "Ou gen " + activeMerchants.length + " pwofil machann aktif. QR yo valab 24 èdtan; kliyan an dwe verifye detay yo epi konfime ak PIN."
    : "Pwofil machann lan dwe aktive pa administratè anvan li kapab resevwa peman QR.";
}
function renderAgentStatus(data) {
  const banner = $("#agentStatusBanner");
  const form = $("#agentApplicationForm");
  const history = $("#agentApplicationHistory");
  if (!banner || !form || !history) return;

  history.replaceChildren();
  if (!data || data.unavailable) {
    form.hidden = true;
    message("#agentStatusBanner", "Nou pa kapab verifye estati aplikasyon ajan ou kounye a. Rafrechi paj la; fòm lan rete fèmen jiskaske verifikasyon an reyisi.", "error");
    return;
  }

  const agent = data.agent || null;
  if (agent) {
    form.hidden = true;
    const state = statusText(agent.status);
    const code = agent.agent_code ? " · Kòd ajan: " + agent.agent_code : "";
    message("#agentStatusBanner",
      "Kont ajan ou: " + state + code +
      (agent.approved_at ? " · Aktive depi " + new Date(agent.approved_at).toLocaleDateString("fr-HT") : "") +
      (agent.status === "active"
        ? ". Aksè ajan an anrejistre. Operasyon depo/retrè ak lajan reyèl rete dezaktive jiskaske patnè ak otorizasyon nesesè yo valide."
        : ". Kontakte administrasyon LakayGoPay pou enfòmasyon sou estati kont ajan an."),
      agent.status === "active" ? "success" : "error"
    );
  } else {
    const applications = Array.isArray(data.applications) ? data.applications : [];
    const openApplication = applications.find((item) => ["submitted", "under_review"].includes(item.status));
    form.hidden = Boolean(openApplication);
    if (openApplication) {
      message("#agentStatusBanner",
        "Nou resevwa aplikasyon ajan ou a. Estati: " + statusText(openApplication.status) +
        ". Ekip administrasyon an poko pran desizyon final la.",
        "success"
      );
    } else {
      message("#agentStatusBanner",
        "Ou kapab soumèt yon aplikasyon pou vin ajan LakayGo. Soumèt aplikasyon an pa bay aksè otomatik; administrasyon an dwe verifye epi apwouve li.",
        ""
      );
    }
  }

  const applications = Array.isArray(data.applications) ? data.applications : [];
  if (!applications.length) {
    const empty = document.createElement("p");
    empty.className = "field-hint";
    empty.textContent = "Pa gen aplikasyon ajan ki anrejistre sou kont sa a.";
    history.append(empty);
    return;
  }

  applications.forEach((item) => {
    const row = document.createElement("article");
    row.className = "compact-row";
    const title = document.createElement("strong");
    title.textContent = statusText(item.status) + " · " + (item.department || "Depatman pa presize");
    const detail = document.createElement("span");
    detail.textContent = (item.commune || "Komin pa presize") +
      (item.created_at ? " · " + new Date(item.created_at).toLocaleDateString("fr-HT") : "");
    row.append(title, detail);
    if (item.admin_note) {
      const note = document.createElement("small");
      note.textContent = "Nòt administrasyon: " + item.admin_note;
      row.append(note);
    }
    history.append(row);
  });
}

function renderWithdrawals(rows) {
  const list = $("#withdrawalsList");
  if (!list) return;
  list.replaceChildren();
  if (!rows || !rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Pa gen demann retrè pou kounye a.";
    list.append(empty);
    return;
  }
  rows.slice(0, 8).forEach(function (item) {
    const row = document.createElement("div");
    row.className = "compact-row";
    const label = document.createElement("strong");
    label.textContent = formatMoney(item.amount, item.currency) + " " + item.currency;
    const detail = document.createElement("span");
    detail.textContent = (item.destination_type || "Destinasyon") + " · " +
      statusText(item.status) + " · " + new Date(item.created_at).toLocaleDateString("fr-HT");
    row.append(label, detail);
    list.append(row);
  });
}
function renderMerchantPayments(rows) {
  const list = $("#merchantPaymentsList");
  if (!list) return;
  list.replaceChildren();
  if (!rows || !rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Pa gen peman QR anrejistre sou kont sa a.";
    list.append(empty);
    return;
  }
  rows.slice(0, 8).forEach(function (item) {
    const row = document.createElement("div");
    row.className = "compact-row";
    const amount = document.createElement("strong");
    amount.textContent = formatMoney(item.amount, item.currency) + " " + item.currency;
    const detail = document.createElement("span");
    detail.textContent = "Peman QR · " + new Date(item.created_at).toLocaleString("fr-HT");
    row.append(amount, detail);
    list.append(row);
  });
}

function receiveTokenFromInput(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value, window.location.origin);
    const token = parsed.searchParams.get("lgp_receive") || parsed.searchParams.get("receive_token");
    if (token) return token.trim();
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length && parts[parts.length - 2] === "receive") return parts[parts.length - 1];
    if (parsed.protocol === "lakaygopay:" && parsed.hostname === "receive") return parts[parts.length - 1] || "";
  } catch {}
  return value;
}
function receiveMessage(text, kind) {
  const node = $("#personalReceiveNotice");
  if (!node) return;
  node.textContent = text || "";
  node.className = "notice" + (kind ? " " + kind : "");
}
function receiveLookupMessage(text, kind) {
  const node = $("#personalReceiveLookupNotice");
  if (!node) return;
  node.textContent = text || "";
  node.className = "notice" + (kind ? " " + kind : "");
}
function populatePersonalWalletSelect(selector, currency) {
  const node = $(selector);
  if (!node) return;
  node.replaceChildren();
  const wallets = currentWallets.filter((wallet) =>
    !wallet.merchant_id && wallet.owner_user_id && (!currency || wallet.currency === currency)
  );
  wallets.forEach((wallet) => {
    const option = document.createElement("option");
    option.value = wallet.wallet_id;
    option.textContent = wallet.currency + " · " + formatMoney(wallet.balance, wallet.currency);
    node.append(option);
  });
  if (!wallets.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = currency ? "Pa gen bous pèsonèl " + currency : "Pa gen bous pèsonèl";
    node.append(option);
  }
}
async function lookupPersonalReceiveRequest(raw) {
  const token = receiveTokenFromInput(raw);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  $("#personalReceivePayForm").hidden = true;
  $("#personalReceiveDetails").hidden = true;
  currentReceiveRequest = null;
  if (!uuid.test(token)) {
    receiveLookupMessage("ID resepsyon an pa valab. Verifye kòd la epi eseye ankò.", "error");
    return;
  }
  $("#personalReceiveToken").value = token;
  receiveLookupMessage("Ap verifye ID resepsyon an…", "");
  try {
    const data = await api("/api/receive-requests/lookup?token=" + encodeURIComponent(token));
    const request = data.receive_request || {};
    currentReceiveRequest = request;
    const details = $("#personalReceiveDetails");
    details.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = request.recipient_name || "Itilizatè LakayGoPay";
    const phone = document.createElement("p");
    phone.textContent = "Telefòn: " + (request.recipient_phone_masked || "Pa disponib");
    const amount = document.createElement("div");
    amount.className = "qr-detail-amount";
    amount.textContent = request.amount == null
      ? "Montan ouvè · " + request.currency
      : formatMoney(request.amount, request.currency) + " " + request.currency;
    const state = document.createElement("p");
    state.textContent = "Estati: " + statusText(request.status) +
      (request.expires_at ? " · Ekspire: " + new Date(request.expires_at).toLocaleString("fr-HT") : "");
    details.append(title, phone, amount, state);
    details.hidden = false;
    if (request.status !== "pending" || (request.expires_at && Date.parse(request.expires_at) <= Date.now())) {
      receiveLookupMessage(request.status === "expired" ? "ID resepsyon sa a ekspire." : "ID resepsyon sa a deja itilize oswa pa disponib.", "error");
      return;
    }
    populatePersonalWalletSelect("#personalReceiveSenderWallet", request.currency);
    const amountInput = $("#personalReceivePayAmount");
    amountInput.value = request.amount == null ? "" : String(request.amount);
    amountInput.readOnly = request.amount != null;
    amountInput.required = request.amount == null;
    $("#personalReceivePayForm").hidden = false;
    $("#personalReceivePayForm button[type='submit']").disabled = !pinConfigured;
    receiveLookupMessage("Verifye non ak telefòn lan. Transfè a ap fèt sèlman apre ou antre PIN ou.", "success");
  } catch (error) {
    receiveLookupMessage(translateError(error.code || error.message), "error");
  }
}

function normalizeQrToken(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value, window.location.origin);
    const fromQuery = parsed.searchParams.get("lgp_qr") || parsed.searchParams.get("token");
    if (fromQuery) return fromQuery.trim();
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length) return segments[segments.length - 1];
  } catch {
    // Accept a pasted bare UUID.
  }
  return value;
}
function qrMessage(text, kind) {
  const node = $("#qrNotice");
  node.textContent = text || "";
  node.className = "notice" + (kind ? " " + kind : "");
}
async function lookupPaymentRequest(rawToken) {
  const token = normalizeQrToken(rawToken);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  $("#qrPayForm").hidden = true;
  $("#qrDetails").hidden = true;
  currentQrRequest = null;
  if (!uuid.test(token)) {
    qrMessage("Kòd QR la pa valab. Eskane QR la ankò oswa kole UUID demann lan.", "error");
    return;
  }
  $("#qrTokenInput").value = token;
  qrMessage("Ap verifye demann QR la…", "");
  try {
    const data = await api("/api/payment-requests/lookup?token=" + encodeURIComponent(token));
    const request = data.payment_request || {};
    currentQrRequest = request;
    const details = $("#qrDetails");
    details.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = request.merchant_name || "Machann LakayGoPay";
    const amount = document.createElement("div");
    amount.className = "qr-detail-amount";
    amount.textContent = request.amount == null
      ? "Montan ouvè · " + (request.currency || "HTG")
      : formatMoney(request.amount, request.currency || "HTG") + " " + (request.currency || "HTG");
    const businessMeta = document.createElement("p");
    businessMeta.textContent = "Telefòn: " + (request.merchant_phone || "Pa disponib") +
      " · Kategori: " + (request.merchant_category || "Pa presize");
    const description = document.createElement("p");
    description.textContent = request.description || "Demann peman LakayGoPay";
    const state = document.createElement("p");
    state.textContent = "Estati: " + statusText(request.status) +
      (request.expires_at ? " · Ekspire: " + new Date(request.expires_at).toLocaleString("fr-HT") : "");
    details.append(title, businessMeta, amount, description, state);
    details.hidden = false;
    const expired = request.status !== "pending" ||
      (request.expires_at && Date.parse(request.expires_at) <= Date.now());
    if (request.merchant_status && request.merchant_status !== "active") {
      $("#qrPayForm").hidden = true;
      qrMessage("Machann sa a poko aktive. Ou pa kapab peye demann sa a.", "error");
      return;
    }
    if (expired) {
      $("#qrPayForm").hidden = true;
      qrMessage(request.status === "expired" ? "Demann QR sa a ekspire." : "Demann QR sa a pa disponib pou peman.", "error");
      return;
    }
    const qrCurrency = request.currency || "HTG";
    populatePersonalWalletSelect("#qrPayerWallet", qrCurrency);
    const payerWalletLabel = $("#qrPayerWallet").closest("label");
    if (payerWalletLabel?.firstChild) payerWalletLabel.firstChild.textContent = "Bous " + qrCurrency + " pou peye a";
    const amountInput = $("#qrPayAmount");
    const amountLabel = amountInput.closest("label");
    if (amountLabel?.firstChild) amountLabel.firstChild.textContent = "Montan pou peye (" + qrCurrency + ")";
    amountInput.value = request.amount == null ? "" : String(request.amount);
    amountInput.readOnly = request.amount != null;
    amountInput.required = request.amount == null;
    $("#qrPayForm").hidden = false;
    $("#qrPayForm button[type=\"submit\"]").disabled = !pinConfigured;
    qrMessage("Demann lan verifye. Verifye detay yo epi konfime ak PIN ou.", "success");
  } catch (error) {
    qrMessage(translateError(error.code || error.message), "error");
  }
}
async function maybeLookupIncomingQr(session) {
  if (!session || !session.user) return;
  if (incomingReceiveToken && incomingReceiveLoadedForUser !== session.user.id) {
    incomingReceiveLoadedForUser = session.user.id;
    $("#personalReceiveToken").value = incomingReceiveToken;
    $("#transferSection").scrollIntoView({ behavior: "smooth", block: "start" });
    await lookupPersonalReceiveRequest(incomingReceiveToken);
    return;
  }
  if (!incomingQrToken || incomingQrLoadedForUser === session.user.id) return;
  incomingQrLoadedForUser = session.user.id;
  $("#qrPaymentSection").scrollIntoView({ behavior: "smooth", block: "start" });
  await lookupPaymentRequest(incomingQrToken);
}
let qrEncoderPromise = null;
async function loadQrEncoder() {
  if (!qrEncoderPromise) {
    qrEncoderPromise = (async function () {
      const sources = [
        "https://esm.sh/qrcode@1.5.4",
        "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm"
      ];
      let lastError = null;
      for (const source of sources) {
        try {
          const module = await import(source);
          const encoder = module.toDataURL ? module : module.default;
          if (encoder && typeof encoder.toDataURL === "function") return encoder;
          throw new Error("QR_ENCODER_EXPORT_MISSING");
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("QR_ENCODER_UNAVAILABLE");
    })().catch(function (error) {
      qrEncoderPromise = null;
      throw error;
    });
  }
  return qrEncoderPromise;
}
async function renderQrImage(target, payload) {
  if (!target || !payload) throw new Error("QR_RENDER_TARGET_INVALID");
  target.alt = "QR demann peman LakayGoPay";
  target.removeAttribute("src");
  target.hidden = false;
  const encoder = await loadQrEncoder();
  const dataUrl = await encoder.toDataURL(payload, {
    width: 280,
    margin: 2,
    errorCorrectionLevel: "M"
  });
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("QR_IMAGE_DATA_INVALID");
  }
  target.src = dataUrl;
  if (typeof target.decode === "function") await target.decode();
  return true;
}
async function stopQrScanner() {
  if (qrScannerFrame) cancelAnimationFrame(qrScannerFrame);
  qrScannerFrame = null;
  if (qrScannerStream) qrScannerStream.getTracks().forEach((track) => track.stop());
  qrScannerStream = null;
  const video = $("#qrScannerVideo");
  if (video) {
    video.pause();
    video.srcObject = null;
    video.hidden = true;
  }
  $("#qrScanButton").hidden = false;
  $("#qrStopScanButton").hidden = true;
}
async function startQrScanner() {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
    qrMessage("Kamera QR pa disponib nan navigatè sa a. Kole kòd oswa lyen QR la nan bwat anlè a.", "error");
    return;
  }
  try {
    await stopQrScanner();
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    qrScannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    const video = $("#qrScannerVideo");
    video.srcObject = qrScannerStream;
    video.hidden = false;
    $("#qrScanButton").hidden = true;
    $("#qrStopScanButton").hidden = false;
    await video.play();
    qrMessage("Mete QR la devan kamera a. Nou p ap fè peman otomatikman.", "");
    const scan = async () => {
      if (!qrScannerStream) return;
      try {
        if (video.readyState >= 2) {
          const codes = await detector.detect(video);
          if (codes.length && codes[0].rawValue) {
            const raw = codes[0].rawValue;
            await stopQrScanner();
            if (String(raw).includes("lgp_receive") || String(raw).includes("lakaygopay://receive/") || String(raw).includes("/receive/")) {
              $("#personalReceiveToken").value = receiveTokenFromInput(raw);
              $("#transferSection").scrollIntoView({ behavior: "smooth", block: "start" });
              await lookupPersonalReceiveRequest(raw);
            } else {
              $("#qrTokenInput").value = raw;
              await lookupPaymentRequest(raw);
            }
            return;
          }
        }
      } catch {
        // Continue scanning after transient camera frame errors.
      }
      qrScannerFrame = requestAnimationFrame(scan);
    };
    scan();
  } catch {
    await stopQrScanner();
    qrMessage("Nou pa kapab louvri kamera a. Verifye pèmisyon kamera a oswa kole kòd QR la manyèlman.", "error");
  }
}
function renderActivity(rows) {
  const list = $("#activityList");
  list.replaceChildren();
  const userWallets = new Set(currentWallets.map(function (wallet) { return wallet.wallet_id; }));
  const ordered = rows.slice().sort(function (a, b) {
    return new Date(b.created_at) - new Date(a.created_at);
  }).slice(0, 30);
  if (!ordered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Pa gen tranzaksyon anrejistre sou kont sa a pou kounye a.";
    list.append(empty);
    return;
  }
  ordered.forEach(function (item) {
    const row = document.createElement("div");
    row.className = "activity-row";
    const info = document.createElement("div");
    const title = document.createElement("div");
    title.className = "activity-title";
    let titleText = item.kind === "transfer" ? "Transfè entèn" :
      item.kind === "deposit" ? "Demann depo" :
      item.kind === "qr_payment" ? "Peman QR" : "Demann retrè";
    if (item.kind === "transfer") {
      titleText += userWallets.has(item.sender_wallet_id) ? " · Voye" : " · Resevwa";
    }
    const meta = document.createElement("div");
    meta.className = "activity-meta";
    meta.textContent = new Date(item.created_at).toLocaleString("fr-HT") + " · " + (item.status || "anrejistre");
    const amount = document.createElement("div");
    amount.className = "activity-amount";
    amount.textContent = formatMoney(item.amount, item.currency) + " " + (item.currency || "");
    const state = document.createElement("div");
    state.className = "activity-state";
    state.textContent = item.status || "Anrejistre";
    info.append(title, meta);
    title.textContent = titleText;
    row.append(info, amount, state);
    list.append(row);
  });
}
function renderPinState(result) {
  const node = $("#pinState");
  const cannotVerify = result.status === "rejected";
  $("#pinManagementForm").hidden = cannotVerify;
  $("#currentPinField").hidden = !pinConfigured;
  $("#currentPin").required = pinConfigured;
  $("#pinSubmitButton").textContent = pinConfigured ? "Chanje PIN sekirite" : "Kreye PIN sekirite";
  $("#personalReceivePayForm button[type=\"submit\"]").disabled = !pinConfigured || cannotVerify;
  $("#withdrawalForm button[type=\"submit\"]").disabled = !pinConfigured || cannotVerify;
  $("#qrPayForm button[type=\"submit\"]").disabled = !pinConfigured || cannotVerify;
  $("#withdrawalForm button[type=\"submit\"]").disabled = !pinConfigured || cannotVerify;
  $("#qrPayForm button[type=\"submit\"]").disabled = !pinConfigured || cannotVerify;
  if (cannotVerify) {
    node.textContent = "Nou pa kapab verifye estati PIN lan kounye a. Transfè yo rete bloke; rafrechi paj la.";
    return;
  }
  if (pinConfigured) {
    node.textContent = "PIN sekirite ou aktive. Li obligatwa pou chak transfè. Antre PIN aktyèl ou pou chanje li.";
    return;
  }
  node.textContent = "Ou poko kreye PIN sekirite ou. Kreye li nan Paramèt anvan ou fè premye transfè.";
}
async function syncSession(session) {
  if (recoveryMode && session && session.user) {
    activeUserId = null;
    dashboardPromise = null;
    $("#authView").hidden = false;
    $("#appView").hidden = true;
    $("#logoutButton").hidden = true;
    $("#settingsButton").hidden = true;
    $("#settingsPanel").hidden = true;
    setAuthMode("newpassword");
    return;
  }
  if (!session || !session.user) {
    activeUserId = null;
    dashboardPromise = null;
    $("#authView").hidden = false;
    $("#appView").hidden = true;
    $("#logoutButton").hidden = true;
    $("#settingsButton").hidden = true;
    $("#settingsPanel").hidden = true;
    return;
  }
  $("#authView").hidden = true;
  $("#appView").hidden = false;
  $("#logoutButton").hidden = false;
  $("#settingsButton").hidden = false;
  if (activeUserId === session.user.id && dashboardPromise) {
    await dashboardPromise;
    await maybeLookupIncomingQr(session);
    return dashboardPromise;
  }
  activeUserId = session.user.id;
  dashboardPromise = loadDashboard(session).catch(function (error) {
    message("#appNotice", "Nou pa kapab chaje tout done kont lan: " + translateError(error.code || error.message), "error");
  });
  await dashboardPromise;
  await maybeLookupIncomingQr(session);
  return dashboardPromise;
}
function setAuthMode(mode) {
  const forms = {
    login: "#loginForm",
    personal: "#personalForm",
    merchant: "#merchantForm",
    recover: "#recoverForm",
  };
  Object.keys(forms).forEach(function (key) {
    const node = $(forms[key]);
    if (node) node.hidden = key !== mode;
  });
  $("#newPasswordForm").hidden = mode !== "newpassword";
  $("#authTabs").hidden = false;
  $$("[data-auth-mode]").forEach(function (button) {
    button.classList.toggle("active", button.dataset.authMode === mode);
  });
  message("#authNotice", "", "");
}
async function registerAccount(payload, emailField) {
  const registration = Object.assign({}, payload);
  const registrationPin = String(registration.pin || "");
  const pinConfirmation = String(registration.pin_confirmation || "");
  delete registration.pin;
  delete registration.pin_confirmation;
  if (!/^[0-9]{4}$/.test(registrationPin) || registrationPin !== pinConfirmation) {
    throw new Error("PIN_CONFIRMATION_MISMATCH");
  }
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(registration)
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(data.error || "SIGNUP_FAILED");
  if (!data.session || !data.session.access_token || !data.session.refresh_token) {
    throw new Error("SIGNUP_CONFIRMATION_REQUIRED");
  }
  const sessionResult = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token
  });
  if (sessionResult.error) throw sessionResult.error;

  // Supabase Auto Confirm gives the new account an immediate session.
  // Save the four-digit transaction PIN before opening the dashboard.
  let pinReady = false;
  try {
    await api("/api/pin/setup", { method: "POST", body: { pin: registrationPin } });
    pinReady = true;
  } catch {
    pinReady = false;
  }
  pinSetupPendingAfterSignup = !pinReady;
  activeUserId = null;
  dashboardPromise = null;
  await syncSession(sessionResult.data.session);
}
function wireForms() {
  $$("[data-auth-mode]").forEach(function (button) {
    button.addEventListener("click", function () { setAuthMode(button.dataset.authMode); });
  });

  const dob = $("#personalDob");
  const today = new Date();
  const latestBirth = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
  dob.max = latestBirth.toISOString().slice(0, 10);

  $("#loginForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    message("#authNotice", "Ap verifye kont ou…", "");
    try {
      const result = await supabase.auth.signInWithPassword({
        email: $("#loginEmail").value.trim().toLowerCase(),
        password: $("#loginPassword").value
      });
      if (result.error) throw result.error;
      $("#loginPassword").value = "";
      message("#authNotice", "Koneksyon reyisi.", "success");
    } catch (error) {
      message("#authNotice", translateError(error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#personalForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = event.submitter;
    if (!/^[0-9]{4}$/.test($("#personalPin").value) ||
        $("#personalPin").value !== $("#personalPinConfirm").value) {
      message("#authNotice", "Antre yon PIN 4 chif epi konfime menm PIN lan.", "error");
      return;
    }
    button.disabled = true;
    try {
      await registerAccount({
        account_type: "personal",
        first_name: $("#personalFirst").value.trim(),
        last_name: $("#personalLast").value.trim(),
        date_of_birth: $("#personalDob").value,
        phone: $("#personalPhone").value.trim(),
        email: $("#personalEmail").value.trim(),
        password: $("#personalPassword").value,
        pin: $("#personalPin").value,
        pin_confirmation: $("#personalPinConfirm").value
      }, $("#personalEmail").value.trim());
      $("#personalPassword").value = "";
      $("#personalPin").value = "";
      $("#personalPinConfirm").value = "";
    } catch (error) {
      message("#authNotice", translateError(error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#merchantForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = event.submitter;
    if (!/^[0-9]{4}$/.test($("#merchantPin").value) ||
        $("#merchantPin").value !== $("#merchantPinConfirm").value) {
      message("#authNotice", "Antre yon PIN 4 chif epi konfime menm PIN lan.", "error");
      return;
    }
    button.disabled = true;
    try {
      await registerAccount({
        account_type: "merchant",
        business_name: $("#merchantName").value.trim(),
        business_phone: $("#merchantPhone").value.trim(),
        email: $("#merchantEmail").value.trim(),
        password: $("#merchantPassword").value,
        pin: $("#merchantPin").value,
        pin_confirmation: $("#merchantPinConfirm").value
      }, $("#merchantEmail").value.trim());
      $("#merchantPassword").value = "";
      $("#merchantPin").value = "";
      $("#merchantPinConfirm").value = "";
    } catch (error) {
      message("#authNotice", translateError(error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#recoverForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const result = await supabase.auth.resetPasswordForEmail($("#recoverEmail").value.trim(), {
        redirectTo: window.location.origin + "/"
      });
      if (result.error) throw result.error;
      message("#authNotice", "Nou voye lyen rekiperasyon an. Tcheke bwat imèl ou.", "success");
    } catch (error) {
      message("#authNotice", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#newPasswordForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const password = $("#newPassword").value;
    const button = event.submitter;
    if (password.length < 8) {
      message("#authNotice", "Nouvo modpas la dwe gen omwen 8 karaktè.", "error");
      return;
    }
    button.disabled = true;
    try {
      const result = await supabase.auth.updateUser({ password: password });
      if (result.error) throw result.error;
      $("#newPassword").value = "";
      recoveryMode = false;
      await supabase.auth.signOut();
      setAuthMode("login");
      message("#authNotice", "Modpas ou mete ajou. Konekte ak nouvo modpas la.", "success");
    } catch (error) {
      message("#authNotice", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#profileForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const data = await api("/api/profile", {
        method: "PATCH",
        body: { full_name: $("#profileFullName").value.trim() }
      });
      currentProfile = data.profile;
      message("#appNotice", "Pwofil ou mete ajou.", "success");
      const session = await sessionNow();
      renderProfile(session);
    } catch (error) {
      message("#appNotice", translateError(error.code || error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#pinManagementForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const currentPin = $("#currentPin").value;
    const pin = $("#newPin").value;
    const confirmation = $("#confirmPin").value;

    if (pinConfigured && !/^[0-9]{4}$/.test(currentPin)) {
      message("#appNotice", "Antre PIN aktyèl 4 chif ou a.", "error");
      return;
    }
    if (!/^[0-9]{4}$/.test(pin)) {
      message("#appNotice", "PIN lan dwe gen egzakteman 4 chif.", "error");
      return;
    }
    if (pin !== confirmation) {
      message("#appNotice", "PIN lan ak konfimasyon an pa menm.", "error");
      return;
    }
    if (pinConfigured && pin === currentPin) {
      message("#appNotice", translateError("PIN_MUST_DIFFER_FROM_CURRENT"), "error");
      return;
    }

    const button = event.submitter;
    const changing = pinConfigured;
    button.disabled = true;
    try {
      if (changing) {
        await api("/api/pin/change", {
          method: "POST",
          body: { current_pin: currentPin, new_pin: pin }
        });
      } else {
        await api("/api/pin/setup", { method: "POST", body: { pin: pin } });
      }
      $("#currentPin").value = "";
      $("#newPin").value = "";
      $("#confirmPin").value = "";
      pinConfigured = true;
      renderPinState({ status: "fulfilled", value: { pin_configured: true } });
      message("#appNotice", changing
        ? "PIN sekirite ou chanje avèk siksè."
        : "PIN sekirite ou anrejistre. Chak transfè ap mande li.", "success");
    } catch (error) {
      message("#appNotice", translateError(error.code || error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#exchangeQuoteForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const source = $("#exchangeSourceCurrency").value;
    const destination = $("#exchangeDestinationCurrency").value;
    const amount = $("#exchangeAmount").value;
    const button = $("#exchangeQuoteButton");
    const notice = $("#exchangeQuoteNotice");
    notice.textContent = "Ap chèche taux BRH/BUH pou jodi a epi kalkile komisyon an…";
    notice.className = "notice";
    $("#exchangeQuoteResult").hidden = true;
    button.disabled = true;
    try {
      const result = await api("/api/exchange/quote", {
        method: "POST",
        body: {
          source_currency: source,
          destination_currency: destination,
          amount
        }
      });
      const quote = result.quote;
      $("#exchangeReceiveAmount").textContent =
        formatMoney(quote.destination_amount_estimate, quote.destination_currency) + " " + quote.destination_currency;
      $("#exchangeSourceAmount").textContent =
        formatMoney(quote.source_amount, quote.source_currency) + " " + quote.source_currency;
      $("#exchangeFeeAmount").textContent =
        formatMoney(quote.commission_amount, quote.commission_currency) + " " + quote.commission_currency;
      const foreign = quote.destination_currency === "HTG" ? quote.source_currency : quote.destination_currency;
      const direction = quote.exchange_rate_direction === "buy" ? "Acha bank" : "Vant bank";
      $("#exchangeRateUsed").textContent =
        "1 " + foreign + " = " + Number(quote.exchange_rate).toLocaleString("fr-HT", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) +
        " HTG · " + direction;
      $("#exchangeRateDate").textContent = quote.as_of;
      $("#exchangeQuoteDisclaimer").textContent =
        "Sous: " + quote.rate_source + ". Estimasyon sa a valab 60 segonn sèlman. Frè a se yon pwopozisyon 1.50%; li pa retire lajan ni poste antre nan ledger la. Pa gen konvèsyon reyèl ki aktive.";
      $("#exchangeQuoteResult").hidden = false;
      notice.textContent = "Estimasyon pare. Li pa yon konfimasyon echanj ni yon tranzaksyon.";
      notice.className = "notice success";
    } catch (error) {
      notice.textContent = translateError(error.code || error.message);
      notice.className = "notice error";
    } finally {
      button.disabled = false;
    }
  });

  $("#qrLookupForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    await lookupPaymentRequest($("#qrTokenInput").value);
  });

  $("#qrPayForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!currentQrRequest || currentQrRequest.status !== "pending") {
      qrMessage("Verifye yon demann QR ki toujou aktif anvan ou peye.", "error");
      return;
    }
    const pin = $("#qrPayPin").value;
    const walletId = $("#qrPayerWallet").value;
    const wallet = currentWallets.find((item) => item.wallet_id === walletId);
    if (!wallet || wallet.currency !== (currentQrRequest.currency || "HTG")) {
      qrMessage("Chwazi yon bous ki nan menm lajan ak demann QR la.", "error");
      return;
    }
    if (!/^[0-9]{4}$/.test(pin)) {
      qrMessage("Antre PIN tranzaksyon 4 chif ou a.", "error");
      return;
    }
    const amount = $("#qrPayAmount").value;
    const confirmText = currentQrRequest.amount == null
      ? "Ou pral peye " + amount + " " + wallet.currency + " bay " + (currentQrRequest.merchant_name || "machann lan") + "."
      : "Ou pral peye " + formatMoney(currentQrRequest.amount, wallet.currency) + " " + wallet.currency +
        " bay " + (currentQrRequest.merchant_name || "machann lan") + ".";
    if (!window.confirm(confirmText + " Kontinye?")) return;
    const button = event.submitter;
    button.disabled = true;
    qrMessage("Ap verifye PIN epi anrejistre peman entèn lan…", "");
    try {
      const body = {
        qr_token: normalizeQrToken($("#qrTokenInput").value),
        payer_wallet_id: walletId,
        pin
      };
      if (amount) body.amount = amount;
      const result = await api("/api/payment-requests/pay", {
        method: "POST",
        body,
        idempotency: true
      });
      $("#qrPayPin").value = "";
      currentQrRequest.status = "paid";
      $("#qrPayForm").hidden = true;
      qrMessage("Peman QR anrejistre. Referans: " + (result.payment?.reference || "OK"), "success");
      await loadDashboard(await sessionNow());
    } catch (error) {
      qrMessage(translateError(error.code || error.message), "error");
    } finally {
      $("#qrPayPin").value = "";
      button.disabled = !pinConfigured;
    }
  });


  $("#personalReceiveCreateForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const walletId = $("#personalReceiveWallet").value;
    const wallet = currentWallets.find((item) => item.wallet_id === walletId && !item.merchant_id);
    if (!wallet) { receiveMessage("Chwazi yon bous pèsonèl aktif.", "error"); return; }
    const rawAmount = $("#personalReceiveAmount").value.trim();
    const body = { wallet_id: walletId, expires_in_minutes: Number($("#personalReceiveExpiry").value) };
    if (rawAmount) body.amount = rawAmount;
    const button = event.submitter;
    button.disabled = true;
    receiveMessage("Ap kreye ID resepsyon an…", "");
    const createKeyName = "lgp-receive-create:" + [walletId, rawAmount, body.expires_in_minutes].join(":");
    const createKey = sessionStorage.getItem(createKeyName) || crypto.randomUUID();
    sessionStorage.setItem(createKeyName, createKey);
    try {
      const data = await api("/api/receive-requests", {
        method: "POST", body, idempotencyKey: createKey
      });
      const request = data.receive_request || {};
      if (!request.qr_token) throw new Error("RECEIVE_TOKEN_MISSING");
      const link = new URL("/", window.location.origin);
      link.searchParams.set("lgp_receive", request.qr_token);
      $("#personalReceiveResult").hidden = false;
      await renderQrImage($("#personalReceiveImage"), link.toString());
      $("#personalReceiveId").textContent = request.qr_token;
      $("#personalReceiveSummary").textContent =
        (request.amount == null ? "Montan ouvè" : formatMoney(request.amount, request.currency) + " " + request.currency) +
        " · Valab jiska " + new Date(request.expires_at).toLocaleString("fr-HT") +
        ". Moun k ap voye a dwe verifye epi konfime ak PIN.";
      $("#personalReceiveLink").href = link.toString();
      $("#personalReceiveCopyButton").dataset.receiveId = request.qr_token;
      receiveMessage("QR ak ID resepsyon kreye. Pataje yo ak moun k ap voye lajan an.", "success");
      sessionStorage.removeItem(createKeyName);
    } catch (error) {
      receiveMessage(translateError(error.code || error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#personalReceiveCopyButton").addEventListener("click", async function () {
    const token = this.dataset.receiveId || "";
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      receiveMessage("ID resepsyon an kopye.", "success");
    } catch {
      receiveMessage("Navigatè a pa pèmèt kopye. Seleksyone ID a epi kopye li manyèlman.", "error");
    }
  });

  $("#personalReceiveLookupForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    await lookupPersonalReceiveRequest($("#personalReceiveToken").value);
  });

  $("#personalReceivePayForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!currentReceiveRequest || currentReceiveRequest.status !== "pending") {
      receiveLookupMessage("Verifye yon ID resepsyon ki toujou aktif anvan ou voye.", "error");
      return;
    }
    const pin = $("#personalReceivePayPin").value;
    const walletId = $("#personalReceiveSenderWallet").value;
    const wallet = currentWallets.find((item) => item.wallet_id === walletId && !item.merchant_id);
    if (!wallet || wallet.currency !== currentReceiveRequest.currency) {
      receiveLookupMessage("Chwazi yon bous pèsonèl ki nan menm lajan ak moun k ap resevwa a.", "error");
      return;
    }
    if (!/^[0-9]{4}$/.test(pin)) {
      receiveLookupMessage("Antre PIN tranzaksyon 4 chif ou a.", "error");
      return;
    }
    const amount = $("#personalReceivePayAmount").value;
    if (!amount || Number(amount) <= 0) {
      receiveLookupMessage("Antre yon montan valab.", "error");
      return;
    }
    const confirmText = "Ou pral voye " + formatMoney(amount, wallet.currency) + " " +
      wallet.currency + " bay " + (currentReceiveRequest.recipient_name || "moun k ap resevwa a") +
      " (" + (currentReceiveRequest.recipient_phone_masked || "telefòn pa disponib") + ").";
    if (!window.confirm(confirmText + " Kontinye?")) return;
    const button = event.submitter;
    button.disabled = true;
    receiveLookupMessage("Ap verifye PIN epi anrejistre transfè a…", "");
    try {
      const receiveToken = receiveTokenFromInput($("#personalReceiveToken").value);
      const receivePayKeyName = "lgp-receive-pay:" + receiveToken;
      const receivePayKey = sessionStorage.getItem(receivePayKeyName) || crypto.randomUUID();
      sessionStorage.setItem(receivePayKeyName, receivePayKey);
      const result = await api("/api/receive-requests/pay", {
        method: "POST",
        body: { qr_token: receiveToken, sender_wallet_id: walletId, amount, pin },
        idempotencyKey: receivePayKey
      });
      sessionStorage.removeItem(receivePayKeyName);
      $("#personalReceivePayPin").value = "";
      currentReceiveRequest.status = "paid";
      $("#personalReceivePayForm").hidden = true;
      receiveLookupMessage("Transfè a reyisi. Referans: " + (result.transfer?.reference || "OK"), "success");
      await loadDashboard(await sessionNow());
    } catch (error) {
      receiveLookupMessage(translateError(error.code || error.message), "error");
    } finally {
      $("#personalReceivePayPin").value = "";
      button.disabled = !pinConfigured;
    }
  });

  $("#merchantQrForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const merchant = currentMerchants.find((item) => item.status === "active");
    if (!merchant) {
      message("#appNotice", "Se sèlman machann ki aktive kapab kreye demann QR.", "error");
      return;
    }
    const amount = $("#merchantQrAmount").value.trim();
    const currency = $("#merchantQrCurrency").value || "HTG";
    const button = $("#merchantQrCreateButton");
    button.disabled = true;
    try {
      const data = await api("/api/payment-requests", {
        method: "POST",
        body: {
          merchant_id: merchant.id,
          amount: amount || null,
          currency,
          description: $("#merchantQrDescription").value.trim(),
          expires_in_minutes: 1440
        },
        idempotency: true
      });
      const token = data.payment_request?.qr_token;
      if (!token) throw new Error("QR_TOKEN_MISSING");
      const link = new URL("/", window.location.origin);
      link.searchParams.set("lgp_qr", token);
      $("#merchantQrResult").hidden = false;
      await renderQrImage($("#merchantQrImage"), link.toString());
      const amountLabel = amount
        ? formatMoney(amount, currency) + " " + currency
        : "Montan ouvè · " + currency;
      $("#merchantQrSummary").textContent = "Demann pou " + amountLabel +
        " · valab 24 èdtan. Li pa peye jiskaske kliyan konfime.";
      $("#merchantQrLink").href = link.toString();
      $("#merchantQrLink").textContent = link.toString();
      $("#merchantQrCopyButton").dataset.copyLink = link.toString();
      message("#appNotice", "Demann QR kreye. Pataje QR la ak kliyan an.", "success");
    } catch (error) {
      message("#appNotice", translateError(error.code || error.message), "error");
    } finally {
      button.disabled = !currentMerchants.some((item) => item.status === "active");
    }
  });

  $("#merchantQrCopyButton").addEventListener("click", async function () {
    const link = this.dataset.copyLink || "";
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      message("#appNotice", "Lyen QR la kopye.", "success");
    } catch {
      message("#appNotice", "Navigatè a pa pèmèt kopye. Peze lontan sou lyen QR la.", "error");
    }
  });

  $("#withdrawalForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const pin = $("#withdrawPin").value;
    if (!/^[0-9]{4}$/.test(pin)) {
      message("#withdrawalNotice", "Antre PIN tranzaksyon 4 chif ou a.", "error");
      return;
    }
    const button = event.submitter;
    button.disabled = true;
    try {
      const body = {
        wallet_id: $("#withdrawWallet").value,
        amount: $("#withdrawAmount").value,
        destination_type: $("#withdrawType").value,
        pin
      };
      const reference = $("#withdrawReference").value.trim();
      if (reference) body.destination_reference = reference;
      await api("/api/withdrawals", { method: "POST", body, idempotency: true });
      $("#withdrawAmount").value = "";
      $("#withdrawReference").value = "";
      $("#withdrawPin").value = "";
      message("#withdrawalNotice", "Demann retrè tès la anrejistre. Pa gen lajan ki voye deyò.", "success");
      await loadDashboard(await sessionNow());
    } catch (error) {
      message("#withdrawalNotice", translateError(error.code || error.message), "error");
    } finally {
      $("#withdrawPin").value = "";
      button.disabled = !pinConfigured;
    }
  });

  $("#agentApplicationForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (currentAgentStatus?.unavailable) {
      message("#agentApplicationNotice", "Rafrechi estati aplikasyon an anvan ou soumèt fòm lan.", "error");
      return;
    }
    const button = $("#agentApplicationSubmit");
    const body = {
      contact_phone: $("#agentContactPhone").value.trim(),
      department: $("#agentDepartment").value.trim(),
      commune: $("#agentCommune").value.trim(),
      business_address: $("#agentBusinessAddress").value.trim() || null,
      motivation: $("#agentMotivation").value.trim() || null
    };
    button.disabled = true;
    message("#agentApplicationNotice", "Ap voye aplikasyon ajan ou a pou verifikasyon…", "");
    try {
      const result = await api("/api/agents/apply", { method: "POST", body });
      const data = await api("/api/agents/status");
      currentAgentStatus = data;
      renderAgentStatus(data);
      $("#agentApplicationForm").reset();
      message("#agentApplicationNotice",
        result.application?.already_submitted
          ? "Ou te deja gen yon aplikasyon ouvè. Men estati aktyèl li."
          : "Aplikasyon ajan ou a soumèt avèk siksè. Li ap tann verifikasyon administrasyon an.",
        "success"
      );
    } catch (error) {
      message("#agentApplicationNotice", translateError(error.code || error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#qrScanButton").addEventListener("click", startQrScanner);
  $("#qrStopScanButton").addEventListener("click", stopQrScanner);

}
function wireActions() {
  $("#merchantQuickLink").addEventListener("click", function () {
    const workspace = $("#merchantWorkspace");
    if (!workspace || workspace.hidden) return;
    showMerchantWorkspace();
    workspace.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#merchantQrForm").querySelector("select")?.focus({ preventScroll: true });
  });
  $("#clientQuickLink")?.addEventListener("click", function () {
    showClientWorkspace();
    $("#clientWorkspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#walletGrid").addEventListener("click", async function (event) {
    const button = event.target.closest("[data-copy-wallet]");
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.copyWallet);
      message("#appNotice", "ID bous la kopye.", "success");
    } catch {
      message("#appNotice", "Navigatè a pa pèmèt kopye otomatikman. Peze lontan sou ID bous la.", "error");
    }
  });



  $("#connectPayoutList").addEventListener("click", async function(event) {
    const button = event.target.closest("[data-connect-payout-id]");
    if (!button) return;
    const card = button.closest("[data-connect-payout-card]");
    const pinInput = card ? card.querySelector("[data-connect-payout-pin]") : null;
    const pin = pinInput ? pinInput.value : "";
    if (!/^[0-9]{4}$/.test(pin)) {
      message("#connectPayoutNotice", "Antre PIN tranzaksyon 4 chif ou a.", "error");
      return;
    }
    const payout = currentConnectPayouts.find(function(item) {
      return item.payout_id === button.dataset.connectPayoutId;
    });
    if (!payout || payout.status !== "pending") {
      message("#connectPayoutNotice", "Demann sa a pa disponib ankò. Rafrechi kont ou.", "error");
      return;
    }
    if (!window.confirm("Ou aksepte resevwa " + formatMoney(payout.amount, payout.currency) + " " + payout.currency +
      " soti nan " + (payout.app_name || "aplikasyon patnè") + "?")) return;

    button.disabled = true;
    message("#connectPayoutNotice", "Ap verifye PIN ou epi anrejistre transfè a…", "");
    try {
      const result = await api("/api/connect/payouts/accept", {
        method: "POST",
        body: { payout_id: payout.payout_id, pin },
        idempotency: true
      });
      message("#connectPayoutNotice", "Lajan an resevwa nan bous LakayGoPay ou. Referans: " +
        (result.payout?.reference || result.payout?.ledger_transaction_id || "OK"), "success");
      await loadDashboard(await sessionNow());
    } catch (error) {
      message("#connectPayoutNotice", translateError(error.code || error.message), "error");
      button.disabled = false;
    } finally {
      if (pinInput) pinInput.value = "";
    }
  });

  $("#cardInterestForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const button=$("#cardInterestSubmit");
    const requestedForm=$("#cardFormSelect").value;
    button.disabled=true;
    message("#cardProgramNotice","Ap soumèt demann kat la sou klasman sistèm nan te asiyen pou ou…","");
    try {
      const result=await api("/api/cards",{method:"POST",body:{requested_form:requestedForm}});
      currentCardProgram.application=result.application||null;
      renderCardProgram();
      message("#cardProgramNotice",result.already_registered?"Ou te deja gen yon demann kat ki an kou.":"Demann ou anrejistre sou klasman LakayGo sistèm nan te detèmine a. Pa gen kat ki emèt.","success");
    } catch(error) {
      message("#cardProgramNotice",translateError(error.code||error.message),"error");
      button.disabled=!currentCardProgram.schema_ready||!currentCardProgram.assigned_tier;
    }
  });
  $("#refreshButton").addEventListener("click", async function () {
    const button = $("#refreshButton");
    button.disabled = true;
    try {
      activeUserId = null;
      await syncSession(await sessionNow());
      message("#appNotice", "Done kont ou yo rafrechi.", "success");
    } finally {
      button.disabled = false;
    }
  });
  $("#settingsButton").addEventListener("click", function () {
    const panel = $("#settingsPanel");
    panel.hidden = !panel.hidden;
    $("#settingsButton").setAttribute("aria-expanded", String(!panel.hidden));
    $("#settingsButton").textContent = panel.hidden ? "Paramèt" : "Fèmen paramèt";
    if (!panel.hidden) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#logoutButton").addEventListener("click", async function () {
    await supabase.auth.signOut();
  });
}
function wireInstallButton() {
  const button = $("#installButton");
  const help = $("#installHelp");
  if (!button || !help) return;

  const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;
  if (standalone) return;

  const userAgent = window.navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(userAgent);

  // iOS does not expose beforeinstallprompt; Android may expose it when install is available.
  if (isIOS || isAndroid) button.hidden = false;

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    button.hidden = false;
    button.textContent = "Enstale app";
  });

  button.addEventListener("click", async function () {
    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === "accepted") {
          button.hidden = true;
          help.hidden = true;
          return;
        }
        help.textContent = "Ou ka enstale LakayGoPay nenpòt lè depi meni navigatè a.";
      } catch {
        help.textContent = "Enstalasyon an pa lanse. Eseye opsyon enstalasyon nan meni navigatè a.";
      }
      help.hidden = false;
      return;
    }

    help.hidden = false;
    if (isIOS) {
      help.textContent = "Sou iPhone/iPad: peze Pataje (kare ak flèch anlè), chwazi “Add to Home Screen” oswa “Ajoute sou ekran dakèy la”, epi konfime.";
    } else {
      help.textContent = "Sou Android: ouvri meni ⋮ nan Chrome oswa Samsung Internet, chwazi “Install app” oswa “Add to Home screen”, epi konfime.";
    }
  });

  window.addEventListener("appinstalled", function () {
    button.hidden = true;
    help.hidden = true;
  });
}

async function init() {
  buildRoleWorkspaces();
  wireInstallButton();
  wireForms();
  wireActions();
  const response = await fetch("/api/config", { headers: { accept: "application/json" } });
  const config = await response.json().catch(function () { return {}; });
  if (!response.ok || !config.configured || !config.supabaseUrl || !config.publishableKey) {
    message("#authNotice", "Koneksyon backend lan poko pare. Kontakte ekip LakayGoPay.", "error");
    return;
  }
  supabase = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      storage: window.localStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  supabase.auth.onAuthStateChange(function (event, session) {
    if (event === "PASSWORD_RECOVERY") {
      recoveryMode = true;
      message("#authNotice", "Antre nouvo modpas ou pou fini rekiperasyon an.", "");
    }
    setTimeout(function () { syncSession(session); }, 0);
  });
  const session = await sessionNow();
  await syncSession(session);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js?v=20261125-role-workspaces-02").catch(function () {});
  }
}
init().catch(function (error) {
  message("#authNotice", "Aplikasyon an pa kapab kòmanse: " + error.message, "error");
});
