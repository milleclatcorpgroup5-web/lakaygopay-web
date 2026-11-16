import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const $ = function (selector) { return document.querySelector(selector); };
const $$ = function (selector) { return Array.from(document.querySelectorAll(selector)); };
let supabase = null;
let activeUserId = null;
let dashboardPromise = null;
let currentProfile = null;
let currentWallets = [];
let currentMerchants = [];
let pinConfigured = false;

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
  const map = {
    AUTH_REQUIRED: "Konekte pou kontinye.",
    INVALID_OR_EXPIRED_SESSION: "Sesyon an ekspire. Konekte ankò.",
    MINIMUM_AGE_18: "Ou dwe gen omwen 18 an pou ouvri kont pèsonèl.",
    EMAIL_ALREADY_REGISTERED: "Imèl sa a deja gen yon kont. Konekte pito.",
    VALID_PHONE_REQUIRED: "Antre yon nimewo telefòn ki valab.",
    VALID_BUSINESS_PHONE_REQUIRED: "Antre nimewo telefòn biznis la.",
    VALID_BUSINESS_NAME_REQUIRED: "Antre non biznis la.",
    SIGNUP_FAILED: "Kreyasyon kont lan pa reyisi. Verifye enfòmasyon yo.",
    PASSWORD_POLICY_REJECTED: "Modpas la pa satisfè kondisyon sekirite yo.",
    PIN_NOT_SET: "Ou dwe kreye PIN sekirite ou anvan ou fè transfè.",
    PIN_INVALID: "PIN tranzaksyon an pa kòrèk.",
    PIN_TEMPORARILY_LOCKED: "PIN lan bloke tanporèman apre twòp move tantativ.",
    PIN_MUST_BE_4_DIGITS: "PIN lan dwe gen egzakteman 4 chif.",
    INSUFFICIENT_AVAILABLE_FUNDS: "Balans disponib la pa sifi pou transfè sa a.",
    CURRENCY_MISMATCH: "Bous moun k ap voye a ak moun k ap resevwa a dwe nan menm lajan.",
    SENDER_WALLET_FORBIDDEN: "Ou pa gen dwa itilize bous sa a pou voye lajan.",
    WALLET_NOT_FOUND: "Nou pa jwenn youn nan bous yo.",
    MERCHANT_NOT_ACTIVE: "Kont machann sa a poko aktive."
  };
  return map[code] || code || "Yon erè rive. Eseye ankò.";
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
  await provisionMerchant(session);
  const results = await Promise.allSettled([
    api("/api/profile"),
    api("/api/wallets"),
    api("/api/merchant/mine"),
    api("/api/activity"),
    api("/api/pin/status")
  ]);
  if (results[0].status === "rejected") throw results[0].reason;
  if (results[1].status === "rejected") throw results[1].reason;
  currentProfile = results[0].value.profile || null;
  currentWallets = (results[1].value.wallets || []).filter(function (wallet) { return !wallet.is_system; });
  currentMerchants = results[2].status === "fulfilled" ? (results[2].value.merchants || []) : [];
  const activity = results[3].status === "fulfilled" ? (results[3].value.activity || []) : [];
  pinConfigured = results[4].status === "fulfilled" && Boolean(results[4].value.pin_configured);
  renderProfile(session);
  renderWallets();
  renderMerchants(session);
  renderActivity(activity);
  renderPinState(results[4]);
  message("#appNotice", "", "");
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
    let titleText = item.kind === "transfer" ? "Transfè entèn" : item.kind === "deposit" ? "Demann depo" : "Demann retrè";
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
  $("#pinSetupForm").hidden = pinConfigured;
  if (pinConfigured) {
    node.textContent = "PIN sekirite a deja konfigire. Ou dwe antre PIN lan pou chak transfè.";
    return;
  }
  if (result.status === "rejected") {
    node.textContent = "Nou pa kapab verifye estati PIN lan kounye a. Eseye rafrechi paj la.";
    return;
  }
  node.textContent = "Ou poko kreye PIN sekirite ou. Fè sa anvan ou voye lajan.";
}
async function syncSession(session) {
  if (!session || !session.user) {
    activeUserId = null;
    dashboardPromise = null;
    $("#authView").hidden = false;
    $("#appView").hidden = true;
    $("#logoutButton").hidden = true;
    return;
  }
  $("#authView").hidden = true;
  $("#appView").hidden = false;
  $("#logoutButton").hidden = false;
  if (activeUserId === session.user.id && dashboardPromise) return dashboardPromise;
  activeUserId = session.user.id;
  dashboardPromise = loadDashboard(session).catch(function (error) {
    message("#appNotice", "Nou pa kapab chaje tout done kont lan: " + translateError(error.code || error.message), "error");
  });
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
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(translateError(data.error || "SIGNUP_FAILED"));
  if (data.session && data.session.access_token && data.session.refresh_token) {
    const result = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });
    if (result.error) throw result.error;
    message("#authNotice", "Kont lan kreye avèk siksè.", "success");
    return;
  }
  setAuthMode("login");
  $("#loginEmail").value = emailField;
  message("#authNotice", "Kont lan kreye. Verifye imèl ou pou konfime kont lan, epi konekte.", "success");
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
        email: $("#loginEmail").value.trim(),
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
    button.disabled = true;
    try {
      await registerAccount({
        account_type: "personal",
        first_name: $("#personalFirst").value.trim(),
        last_name: $("#personalLast").value.trim(),
        date_of_birth: $("#personalDob").value,
        phone: $("#personalPhone").value.trim(),
        email: $("#personalEmail").value.trim(),
        password: $("#personalPassword").value
      }, $("#personalEmail").value.trim());
      $("#personalPassword").value = "";
    } catch (error) {
      message("#authNotice", translateError(error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#merchantForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await registerAccount({
        account_type: "merchant",
        business_name: $("#merchantName").value.trim(),
        business_phone: $("#merchantPhone").value.trim(),
        email: $("#merchantEmail").value.trim(),
        password: $("#merchantPassword").value
      }, $("#merchantEmail").value.trim());
      $("#merchantPassword").value = "";
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

  $("#pinSetupForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const pin = $("#newPin").value;
    const confirmation = $("#confirmPin").value;
    if (!/^[0-9]{4}$/.test(pin)) {
      message("#appNotice", "PIN lan dwe gen egzakteman 4 chif.", "error");
      return;
    }
    if (pin !== confirmation) {
      message("#appNotice", "De PIN yo pa menm. Verifye yo epi eseye ankò.", "error");
      return;
    }
    const button = event.submitter;
    button.disabled = true;
    try {
      await api("/api/pin/setup", { method: "POST", body: { pin: pin } });
      $("#newPin").value = "";
      $("#confirmPin").value = "";
      pinConfigured = true;
      renderPinState({ status: "fulfilled", value: { pin_configured: true } });
      message("#appNotice", "PIN sekirite ou anrejistre. Chak transfè ap mande li.", "success");
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
  $("#logoutButton").addEventListener("click", async function () {
    await supabase.auth.signOut();
  });
}
async function init() {
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
      $("#authView").hidden = false;
      $("#appView").hidden = true;
      setAuthMode("newpassword");
      message("#authNotice", "Antre nouvo modpas ou pou fini rekiperasyon an.", "");
    }
    setTimeout(function () { syncSession(session); }, 0);
  });
  const session = await sessionNow();
  await syncSession(session);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(function () {});
  }
}
init().catch(function (error) {
  message("#authNotice", "Aplikasyon an pa kapab kòmanse: " + error.message, "error");
});
