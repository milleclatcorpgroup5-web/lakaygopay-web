import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const $ = (selector) => document.querySelector(selector);
let supabase = null;
let adminPinVerifiedUserId = null;
let pinGateSession = null;

function setNotice(selector, message, kind) {
  const node = $(selector);
  if (!node) return;
  node.textContent = message || "";
  node.className = "notice" + (kind ? " " + kind : "");
}
function formatCount(item) {
  if (!item || !item.available || item.count === null || !Number.isFinite(item.count)) return "N/D";
  return item.count.toLocaleString("fr-HT");
}
function displayRole(role) {
  const names = {
    super_admin: "Super administratè",
    admin: "Administratè",
    finance_admin: "Admin finans",
    risk_admin: "Admin risk"
  };
  return names[role] || role;
}
function explainError(code) {
  const messages = {
    ADMIN_ACCESS_DENIED: "Kont sa a pa gen wòl administratè. Aksè a refize.",
    ADMIN_ROLE_SYSTEM_NOT_READY: "Sistèm wòl administratè a poko disponib nan bazdone a.",
    ADMIN_ACCESS_CHECK_FAILED: "Nou pa kapab verifye dwa aksè administratè a kounye a.",
    ADMIN_PIN_MUST_BE_6_DIGITS: "PIN Admin lan dwe gen egzakteman 6 chif.",
    ADMIN_PIN_CONFIRMATION_MISMATCH: "De PIN yo pa menm.",
    ADMIN_PIN_TOO_WEAK: "PIN sa a twò fasil pou devine. Chwazi yon lòt 6 chif.",
    ADMIN_PIN_ALREADY_SET: "PIN Admin lan deja anrejistre pou kont sa a.",
    ADMIN_PIN_NOT_SET: "PIN Admin lan poko kreye. Rekonekte pou konfigire li.",
    ADMIN_PIN_INVALID: "PIN Admin lan pa kòrèk.",
    ADMIN_PIN_TEMPORARILY_LOCKED: "Apre 5 move tantativ, verifikasyon bloke pandan 15 minit.",
    ADMIN_PIN_DATABASE_UNAVAILABLE: "Bazdone PIN Admin lan poko pare. Egzekite migrasyon sekirite Admin lan nan Supabase.",
    ADMIN_PIN_SETUP_FAILED: "Nou pa t kapab anrejistre PIN Admin lan.",
    ADMIN_PIN_SECURITY_UNAVAILABLE: "Verifikasyon PIN Admin lan pa disponib kounye a.",
    ADMIN_PIN_CONFIGURATION_INVALID: "Konfigirasyon PIN Admin lan pa valab.",
    ADMIN_PIN_REQUIRED: "Pou pwoteje sesyon an, antre PIN Admin 6 chif ou ankò.",
    AUTH_REQUIRED: "Konekte pou kontinye.",
    INVALID_OR_EXPIRED_SESSION: "Sesyon an ekspire. Konekte ankò.",
    INVALID_CREDENTIALS: "Imèl oswa modpas la pa kòrèk.",
    ADMIN_OVERVIEW_UNAVAILABLE: "Apèsi administrasyon an pa disponib kounye a."
  };
  return messages[code] || "Yon erè rive. Kòd: " + (code || "UNKNOWN");
}
function showLogin(message, kind = "error") {
  $("#loginView").hidden = false;
  $("#pinView").hidden = true;
  $("#adminView").hidden = true;
  $("#refreshButton").hidden = true;
  $("#logoutButton").hidden = true;
  adminPinVerifiedUserId = null;
  pinGateSession = null;
  if (message) setNotice("#loginNotice", message, kind);
}
async function adminRequest(path, session, body) {
  const headers = {
    accept: "application/json",
    authorization: "Bearer " + session.access_token
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(explainError(data.error));
    error.code = data.error;
    error.status = response.status;
    error.lockedUntil = data.locked_until || null;
    throw error;
  }
  return data;
}
async function showPinGate(session) {
  pinGateSession = session;
  adminPinVerifiedUserId = null;
  $("#loginView").hidden = true;
  $("#adminView").hidden = true;
  $("#pinView").hidden = false;
  $("#refreshButton").hidden = true;
  $("#logoutButton").hidden = false;
  $("#adminPinVerifyForm").hidden = true;
  $("#adminPinSetupForm").hidden = true;
  $("#adminPinInput").value = "";
  $("#adminPinNew").value = "";
  $("#adminPinConfirm").value = "";
  setNotice("#pinNotice", "Ap verifye wòl ak estati PIN Admin lan…", "");
  try {
    const status = await adminRequest("/api/admin/pin/status", session);
    if (status.pin_configured) {
      $("#pinTitle").textContent = "Antre PIN sekrè Admin ou";
      $("#pinDescription").textContent = "Koneksyon imèl ak modpas la reyisi. Antre PIN 6 chif ou pou ouvri Sant Kontwòl la.";
      $("#adminPinVerifyForm").hidden = false;
      if (status.locked_until && Date.parse(status.locked_until) > Date.now()) {
        setNotice("#pinNotice", explainError("ADMIN_PIN_TEMPORARILY_LOCKED"), "error");
      } else {
        setNotice("#pinNotice", "Dezyèm verifikasyon obligatwa.", "");
      }
      $("#adminPinInput").focus();
    } else {
      $("#pinTitle").textContent = "Kreye PIN sekrè Admin ou";
      $("#pinDescription").textContent = "Se premye koneksyon Admin lan. Kreye yon PIN pèsonèl 6 chif, epi konfime li.";
      $("#adminPinSetupForm").hidden = false;
      setNotice("#pinNotice", "Chwazi 6 chif ki pa fasil pou devine. Evite dat nesans ak sekans senp.", "");
      $("#adminPinNew").focus();
    }
  } catch (error) {
    if (error.status === 403 && error.code === "ADMIN_ACCESS_DENIED") {
      await supabase.auth.signOut();
      showLogin(explainError(error.code), "error");
      return;
    }
    showLogin(explainError(error.code || error.message), "error");
  }
}
async function loadOverview(session) {
  setNotice("#dashboardNotice", "Ap verifye dwa aksè epi chaje apèsi a…", "");
  const response = await fetch("/api/admin/overview", {
    headers: {
      accept: "application/json",
      authorization: "Bearer " + session.access_token
    },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const error = new Error(explainError(data.error));
    error.code = data.error;
    error.status = response.status;
    throw error;
  }

  $("#loginView").hidden = true;
  $("#pinView").hidden = true;
  $("#adminView").hidden = false;
  $("#refreshButton").hidden = false;
  $("#logoutButton").hidden = false;

  const admin = data.admin || {};
  const firstName = String(admin.email || "Administratè").split("@")[0];
  $("#adminName").textContent = firstName;
  $("#adminMeta").textContent = "Wòl verifye: " + (admin.roles || []).map(displayRole).join(" · ");
  $("#sessionEmail").textContent = admin.email || "Kont verifye";
  $("#sessionRoles").textContent = (admin.roles || []).map(displayRole).join(", ");

  const counts = data.counts || {};
  $("#countUsers").textContent = formatCount(counts.users);
  $("#countMerchants").textContent = formatCount(counts.merchants);
  $("#countWallets").textContent = formatCount(counts.wallets);
  $("#countTransactions").textContent = formatCount(counts.transactions);
  $("#countWithdrawals").textContent = formatCount(counts.withdrawals);
  $("#countAudit").textContent = formatCount(counts.audit_events);

  const date = new Date(data.generated_at || Date.now());
  $("#generatedAt").textContent = "Dènye mizajou: " + date.toLocaleString("fr-HT");
  setNotice("#dashboardNotice", "Aksè admin konfime sou sèvè a. PIN Admin verifye.", "success");
}
async function completePinVerification(session, pin) {
  await adminRequest("/api/admin/pin/verify", session, { pin });
  adminPinVerifiedUserId = session.user.id;
  $("#adminPinInput").value = "";
  $("#adminPinNew").value = "";
  $("#adminPinConfirm").value = "";
  setNotice("#pinNotice", "PIN Admin verifye. Ap ouvri sant kontwòl la…", "success");
  await loadOverview(session);
}
async function refreshCurrent() {
  const result = await supabase.auth.getSession();
  const session = result.data && result.data.session;
  if (!session) {
    showLogin("");
    return;
  }
  if (adminPinVerifiedUserId !== session.user.id) {
    await showPinGate(session);
    return;
  }
  try {
    await loadOverview(session);
  } catch (error) {
    if (error.code === "ADMIN_PIN_REQUIRED") {
      adminPinVerifiedUserId = null;
      await showPinGate(session);
      return;
    }
    throw error;
  }
}
async function boot() {
  const configResponse = await fetch("/api/config", { headers: { accept: "application/json" }, cache: "no-store" });
  const config = await configResponse.json().catch(() => ({}));
  if (!configResponse.ok || !config.configured || !config.supabaseUrl || !config.publishableKey) {
    setNotice("#loginNotice", "Koneksyon backend lan poko pare.", "error");
    return;
  }

  // Admin session is isolated from the customer/merchant app and the PIN
  // verification flag is memory-only, so a page reload asks for the PIN again.
  supabase = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      storage: window.sessionStorage,
      storageKey: "lakaygopay_admin_session",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#loginButton");
    button.disabled = true;
    setNotice("#loginNotice", "Ap verifye imèl ak modpas la…", "");
    try {
      const result = await supabase.auth.signInWithPassword({
        email: $("#emailInput").value.trim(),
        password: $("#passwordInput").value
      });
      if (result.error) throw result.error;
      $("#passwordInput").value = "";
      const sessionResult = await supabase.auth.getSession();
      if (!sessionResult.data.session) throw new Error("INVALID_OR_EXPIRED_SESSION");
      await showPinGate(sessionResult.data.session);
    } catch (error) {
      const code = error.code || error.message;
      setNotice("#loginNotice", explainError(code), "error");
      $("#passwordInput").value = "";
    } finally {
      button.disabled = false;
    }
  });

  $("#adminPinVerifyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = $("#adminPinInput").value;
    const button = $("#adminPinVerifyButton");
    if (!/^\d{6}$/.test(pin)) {
      setNotice("#pinNotice", explainError("ADMIN_PIN_MUST_BE_6_DIGITS"), "error");
      return;
    }
    button.disabled = true;
    try {
      await completePinVerification(pinGateSession, pin);
    } catch (error) {
      setNotice("#pinNotice", explainError(error.code || error.message), "error");
      $("#adminPinInput").value = "";
    } finally {
      button.disabled = false;
    }
  });

  $("#adminPinSetupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = $("#adminPinNew").value;
    const confirmation = $("#adminPinConfirm").value;
    const button = $("#adminPinSetupButton");
    if (!/^\d{6}$/.test(pin)) {
      setNotice("#pinNotice", explainError("ADMIN_PIN_MUST_BE_6_DIGITS"), "error");
      return;
    }
    if (pin !== confirmation) {
      setNotice("#pinNotice", explainError("ADMIN_PIN_CONFIRMATION_MISMATCH"), "error");
      return;
    }
    button.disabled = true;
    try {
      await adminRequest("/api/admin/pin/setup", pinGateSession, {
        pin,
        pin_confirmation: confirmation
      });
      await completePinVerification(pinGateSession, pin);
    } catch (error) {
      setNotice("#pinNotice", explainError(error.code || error.message), "error");
      $("#adminPinNew").value = "";
      $("#adminPinConfirm").value = "";
    } finally {
      button.disabled = false;
    }
  });

  $("#refreshButton").addEventListener("click", async () => {
    const button = $("#refreshButton");
    button.disabled = true;
    try {
      await refreshCurrent();
    } catch (error) {
      setNotice("#dashboardNotice", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#logoutButton").addEventListener("click", async () => {
    adminPinVerifiedUserId = null;
    pinGateSession = null;
    await supabase.auth.signOut();
    showLogin("Ou dekonekte nan sant kontwòl la.", "success");
  });

  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.data && sessionResult.data.session) {
    await showPinGate(sessionResult.data.session);
  } else {
    showLogin("");
  }
}

boot().catch(() => setNotice("#loginNotice", "Sant kontwòl la pa kapab kòmanse kounye a.", "error"));
