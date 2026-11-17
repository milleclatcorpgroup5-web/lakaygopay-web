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
let currentQrRequest = null;
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
    closed: "Fèmen"
  };
  return map[value] || value || "Pa disponib";
}
function translateError(code) {
  const normalized = String(code || "").trim().toLowerCase();
  if (normalized === "invalid login credentials" ||
      normalized === "invalid_credentials" ||
      normalized === "invalid_grant") {
    return "Supabase Production pa valide konbinezon imèl/modpas sa a. Verifye imèl la; si ou pa sonje modpas la, itilize “Mwen bliye modpas mwen”. Pa kreye yon lòt kont ak menm imèl la.";
  }
  if (normalized === "email not confirmed" || normalized === "email_not_confirmed") {
    return "Ou dwe konfime imèl kont sa a anvan ou konekte. Verifye bwat resepsyon ak spam ou.";
  }
  const map = {
    AUTH_REQUIRED: "Konekte pou kontinye.",
    INVALID_OR_EXPIRED_SESSION: "Sesyon an ekspire. Konekte ankò.",
    MINIMUM_AGE_18: "Ou dwe gen omwen 18 an pou ouvri kont pèsonèl.",
    EMAIL_ALREADY_REGISTERED: "Imèl sa a deja gen yon kont. Konekte pito.",
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
    FX_QUOTE_UNAVAILABLE: "Estimasyon echanj la pa disponib kounye a."
  };
  return map[code] || map[String(code || "").toUpperCase()] || code || "Yon erè rive. Eseye ankò.";
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
  if (options.idempotency) {
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
    const error = new Error(translateError(data.error || ("HTTP_" + response.status)));
    error.status = response.status;
    error.code = data.error;
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
    api("/api/payments")
  ]);
  if (results[0].status === "rejected") throw results[0].reason;
  if (results[1].status === "rejected") throw results[1].reason;
  currentProfile = results[0].value.profile || null;
  currentWallets = (results[1].value.wallets || []).filter(function (wallet) { return !wallet.is_system; });
  currentMerchants = results[2].status === "fulfilled" ? (results[2].value.merchants || []) : [];
  const activity = results[3].status === "fulfilled" ? (results[3].value.activity || []) : [];
  currentWithdrawals = results[5].status === "fulfilled" ? (results[5].value.withdrawals || []) : [];
  const paymentRecords = results[6].status === "fulfilled" ? (results[6].value.payments || []) : [];
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
function renderMerchants(session) {
  const isMerchant = session.user.user_metadata?.account_type === "merchant" || currentMerchants.length > 0;
  $("#merchantSection").hidden = !isMerchant;
  if (!isMerchant) return;
  const merchant = currentMerchants[0];
  const status = merchant ? merchant.status : "pending";
  $("#merchantStatus").textContent = statusText(status);
  $("#merchantStatus").className = "status-pill " + (status === "active" ? "" : "pending");
  $("#merchantDetails").textContent = merchant
    ? "Biznis: " + merchant.business_name + ". ID machann: " + merchant.id + ". Kont komèsyal la " + statusText(merchant.status).toLowerCase() + "."
    : "Kont machann lan poko parèt nan baz done a. Verifye koneksyon an epi eseye rafrechi.";
  const canReceive = Boolean(merchant && merchant.status === "active");
  $("#merchantQrCreateButton").disabled = !canReceive;
  $("#merchantQrStatus").textContent = canReceive
    ? "Machann ou aktive. Ou kapab kreye yon demann QR HTG pou peman entèn."
    : "Pwofil machann lan dwe aktive pa administratè anvan li kapab resevwa peman QR.";
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
    const description = document.createElement("p");
    description.textContent = request.description || "Demann peman LakayGoPay";
    const state = document.createElement("p");
    state.textContent = "Estati: " + statusText(request.status) +
      (request.expires_at ? " · Ekspire: " + new Date(request.expires_at).toLocaleString("fr-HT") : "");
    details.append(title, amount, description, state);
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
    populateWalletSelect("#qrPayerWallet", request.currency || "HTG");
    const amountInput = $("#qrPayAmount");
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
  if (!incomingQrToken || !session || !session.user || incomingQrLoadedForUser === session.user.id) return;
  incomingQrLoadedForUser = session.user.id;
  $("#qrPaymentSection").scrollIntoView({ behavior: "smooth", block: "start" });
  await lookupPaymentRequest(incomingQrToken);
}
async function renderQrImage(target, payload) {
  const { toDataURL } = await import("https://esm.sh/qrcode@1.5.4");
  target.alt = "QR demann peman LakayGoPay";
  target.src = await toDataURL(payload, { width: 240, margin: 1, errorCorrectionLevel: "M" });
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
            $("#qrTokenInput").value = raw;
            await lookupPaymentRequest(raw);
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
  $("#transferForm button[type=\"submit\"]").disabled = !pinConfigured || cannotVerify;
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
    recover: "#recoverForm"
  };
  Object.keys(forms).forEach(function (key) { $(forms[key]).hidden = key !== mode; });
  $("#newPasswordForm").hidden = mode !== "newpassword";
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
  if (!response.ok) throw new Error(translateError(data.error || "SIGNUP_FAILED"));
  if (data.session && data.session.access_token && data.session.refresh_token) {
    const result = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });
    if (result.error) throw result.error;

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
    await syncSession(await sessionNow());
    return;
  }
  setAuthMode("login");
  $("#loginEmail").value = emailField;
  message("#authNotice", "Kont lan kreye. Verifye imèl ou; apre koneksyon, ouvri Paramèt pou kreye PIN lan si li poko anrejistre.",
    "success");
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

  $("#transferForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const sender = $("#senderWallet").value;
    const recipient = $("#recipientWallet").value.trim();
    const amount = $("#transferAmount").value;
    const pin = $("#transferPin").value;
    if (!sender || !recipient) {
      message("#appNotice", "Chwazi bous k ap voye a epi antre ID bous destinatè a.", "error");
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recipient)) {
      message("#appNotice", "ID bous destinatè a pa sanble ak yon UUID valab.", "error");
      return;
    }
    if (!/^[0-9]{4}$/.test(pin)) {
      message("#appNotice", "Antre PIN tranzaksyon 4 chif ou a.", "error");
      return;
    }
    const chosenWallet = currentWallets.find(function (wallet) { return wallet.wallet_id === sender; });
    if (!chosenWallet) {
      message("#appNotice", "Bous moun k ap voye a pa disponib.", "error");
      return;
    }
    const formattedAmount = formatMoney(amount, chosenWallet.currency) + " " + chosenWallet.currency;
    if (!window.confirm("Ou pral voye " + formattedAmount + ". Verifye ID destinatè a ak lajan an anvan ou konfime.")) return;

    const button = event.submitter;
    button.disabled = true;
    try {
      const result = await api("/api/transfers", {
        method: "POST",
        body: {
          sender_wallet_id: sender,
          recipient_wallet_id: recipient,
          amount: amount,
          note: $("#transferNote").value.trim(),
          pin: pin
        },
        idempotency: true
      });
      $("#transferAmount").value = "";
      $("#transferNote").value = "";
      $("#recipientWallet").value = "";
      message("#appNotice", "Transfè anrejistre avèk siksè. Referans: " + (result.transfer?.reference || result.transfer?.transfer_id || "OK"), "success");
      await loadDashboard(await sessionNow());
    } catch (error) {
      message("#appNotice", translateError(error.code || error.message), "error");
    } finally {
      $("#transferPin").value = "";
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
        "Sous: " + quote.rate_source + ". Estimasyon sa a valab 60 segonn sèlman. Frè a se yon pwopozisyon 0.50%; li pa retire lajan ni poste antre nan ledger la. Pa gen konvèsyon reyèl ki aktive.";
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

  $("#merchantQrForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const merchant = currentMerchants.find((item) => item.status === "active");
    if (!merchant) {
      message("#appNotice", "Se sèlman machann ki aktive kapab kreye demann QR.", "error");
      return;
    }
    const amount = $("#merchantQrAmount").value;
    const button = $("#merchantQrCreateButton");
    button.disabled = true;
    try {
      const data = await api("/api/payment-requests", {
        method: "POST",
        body: {
          merchant_id: merchant.id,
          amount,
          description: $("#merchantQrDescription").value.trim(),
          expires_in_minutes: 30
        },
        idempotency: true
      });
      const token = data.payment_request?.qr_token;
      if (!token) throw new Error("QR_TOKEN_MISSING");
      const link = new URL("/", window.location.origin);
      link.searchParams.set("lgp_qr", token);
      $("#merchantQrResult").hidden = false;
      await renderQrImage($("#merchantQrImage"), link.toString());
      $("#merchantQrSummary").textContent = "Demann pou " + formatMoney(amount, "HTG") +
        " HTG · ekspire nan 30 minit. Li pa peye jiskaske kliyan konfime.";
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

  $("#qrScanButton").addEventListener("click", startQrScanner);
  $("#qrStopScanButton").addEventListener("click", stopQrScanner);

}
function wireActions() {
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
    navigator.serviceWorker.register("/service-worker.js?v=20261117-01").catch(function () {});
  }
}
init().catch(function (error) {
  message("#authNotice", "Aplikasyon an pa kapab kòmanse: " + error.message, "error");
});
