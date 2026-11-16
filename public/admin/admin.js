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
    ADMIN_OVERVIEW_UNAVAILABLE: "Apèsi administrasyon an pa disponib kounye a.",
    ADMIN_RECORDS_UNAVAILABLE: "Lis dosye administrasyon an pa disponib kounye a.",
    ADMIN_RECORD_TYPE_INVALID: "Kategori dosye sa a pa valab.",
    MFA_REQUIRED: "Aksyon sa a mande verifikasyon TOTP. Verifye kòd authenticator ou a.",
    MFA_CODE_MUST_BE_6_DIGITS: "Kòd authenticator lan dwe gen 6 chif.",
    MFA_FACTOR_NOT_ENROLLED: "Pa gen faktè authenticator. Klike Kreye / aktive MFA an premye."
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
  await updateMfaStatus().catch(() => {});
  await loadAdminRecords("users");
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

function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
async function currentSession() {
  const result = await supabase.auth.getSession();
  if (result.error) throw result.error;
  return result.data.session;
}
async function updateMfaStatus() {
  const session = await currentSession();
  const claims = decodeJwtPayload(session?.access_token);
  const aal2 = claims?.aal === "aal2";
  $("#adminMfaBadge").textContent = aal2 ? "MFA verifye · AAL2" : "MFA obligatwa";
  $("#adminMfaBadge").className = aal2 ? "read-only-tag mfa-active" : "read-only-tag";
  $("#adminMfaStatus").textContent = aal2
    ? "Sesyon sa a gen dezyèm faktè authenticator verifye. Aksyon admin ki sansib kapab pase kontwòl backend la."
    : "Pou apwouve machann, revize retrè, revize ajan oswa kouri odit ledger, aktive epi verifye yon aplikasyon authenticator.";
  $("#adminMfaEnrollButton").textContent = aal2 ? "MFA deja verifye" : "Kreye / aktive MFA";
  $("#adminMfaEnrollButton").disabled = aal2;
  $("#adminLedgerAuditButton").disabled = !aal2;
  return aal2;
}
async function enrollAdminMfa() {
  const factorsResult = await supabase.auth.mfa.listFactors();
  if (factorsResult.error) throw factorsResult.error;
  const existing = (factorsResult.data?.totp || []).find((factor) => factor.status === "verified");
  if (existing) {
    $("#adminMfaStatus").textContent = "Yon faktè authenticator deja aktive. Antre kòd 6 chif li a epi peze Verifye MFA.";
    $("#adminMfaCode").focus();
    return;
  }
  const pending = (factorsResult.data?.totp || []).find((factor) => factor.status === "unverified");
  if (pending) {
    const removed = await supabase.auth.mfa.unenroll({ factorId: pending.id });
    if (removed.error) throw removed.error;
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "LakayGoPay Admin Authenticator"
  });
  if (error) throw error;
  $("#adminMfaQr").src = data.totp.qr_code;
  $("#adminMfaSecret").textContent = "Kle manyèl (kenbe l prive): " + data.totp.secret;
  $("#adminMfaQrWrap").hidden = false;
  $("#adminMfaStatus").textContent = "Eskane QR sa a nan Google Authenticator, Aegis oswa yon aplikasyon TOTP. Apre sa, antre kòd 6 chif la pou verifye.";
  $("#adminMfaCode").focus();
}
async function verifyAdminMfa() {
  const code = $("#adminMfaCode").value.trim();
  if (!/^\d{6}$/.test(code)) throw new Error("MFA_CODE_MUST_BE_6_DIGITS");
  const factorsResult = await supabase.auth.mfa.listFactors();
  if (factorsResult.error) throw factorsResult.error;
  const factor = (factorsResult.data?.totp || []).find((item) => item.status === "verified") ||
    (factorsResult.data?.totp || []).find((item) => item.status === "unverified");
  if (!factor) throw new Error("MFA_FACTOR_NOT_ENROLLED");
  const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (challenge.error) throw challenge.error;
  const verified = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.data.id,
    code
  });
  if (verified.error) throw verified.error;
  $("#adminMfaCode").value = "";
  await supabase.auth.refreshSession();
  const ready = await updateMfaStatus();
  if (!ready) throw new Error("MFA_VERIFICATION_INCOMPLETE");
  setNotice("#adminActionNotice", "MFA verifye. Aksyon admin yo toujou pase verifikasyon sou sèvè a.", "success");
  await loadAdminRecords("users");
}
const RECORD_COLUMNS = {
  users: [
    ["full_name","Non"],["account_status","Estati"],["preferred_language","Lang"],["created_at","Kreye"]
  ],
  merchants: [
    ["business_name","Biznis"],["business_type","Kalite"],["category","Kategori"],["status","Estati"],["created_at","Kreye"]
  ],
  wallets: [
    ["currency","Lajan"],["balance","Balans"],["owner_user_id","ID pwopriyetè"],["merchant_id","ID machann"]
  ],
  ledger: [
    ["transaction_type","Kalite"],["reference_code","Referans"],["status","Estati"],["entries","Ekriti debit/kredi"],["created_at","Dat"]
  ],
  withdrawals: [
    ["amount","Montan"],["currency","Lajan"],["destination_type","Destinasyon"],["status","Estati"],["requested_by","Mande pa"],["created_at","Dat"]
  ],
  agents: [
    ["department","Depatman"],["commune","Komin"],["status","Estati"],["applicant_user_id","ID aplikan"],["created_at","Dat"]
  ],
  audit: [
    ["action","Aksyon"],["resource_type","Resous"],["resource_id","ID resous"],["outcome","Rezilta"],["actor_user_id","Admin"],["created_at","Dat"]
  ]
};
function recordValue(type, row, key) {
  if (key === "entries") {
    const entries = Array.isArray(row.ledger_entries) ? row.ledger_entries : [];
    if (!entries.length) return "Pa gen detay";
    return entries.map((entry) =>
      entry.direction + " " + Number(entry.amount).toLocaleString("fr-HT") + " " + entry.currency
    ).join(" · ");
  }
  if (key === "balance" || key === "amount") {
    const currency = row.currency || "";
    return Number(row[key] || 0).toLocaleString("fr-HT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
      (currency ? " " + currency : "");
  }
  if (key === "created_at") return row[key] ? new Date(row[key]).toLocaleString("fr-HT") : "—";
  return row[key] == null || row[key] === "" ? "—" : String(row[key]);
}
function openAdminAction(type, row) {
  $("#adminMerchantReviewForm").hidden = type !== "merchants";
  $("#adminWithdrawalReviewForm").hidden = type !== "withdrawals";
  $("#adminAgentReviewForm").hidden = type !== "agents";
  if (type === "merchants") {
    $("#adminMerchantId").value = row.id || "";
    $("#adminMerchantStatus").value = row.status === "pending" ? "under_review" : "active";
    $("#adminMerchantComment").value = "";
  } else if (type === "withdrawals") {
    $("#adminWithdrawalId").value = row.id || "";
    $("#adminWithdrawalDecision").value = "approved";
    $("#adminWithdrawalComment").value = "";
  } else if (type === "agents") {
    $("#adminAgentApplicationId").value = row.id || "";
    $("#adminAgentDecision").value = "approved";
    $("#adminAgentNote").value = "";
  }
  $("#adminActionsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderAdminRecords(type, rows) {
  const head = $("#adminRecordsHead");
  const body = $("#adminRecordsBody");
  head.replaceChildren();
  body.replaceChildren();
  const columns = RECORD_COLUMNS[type] || [];
  const headerRow = document.createElement("tr");
  columns.forEach(([, label]) => {
    const th = document.createElement("th");
    th.textContent = label;
    headerRow.append(th);
  });
  if (["merchants","withdrawals","agents"].includes(type)) {
    const th = document.createElement("th");
    th.textContent = "Aksyon";
    headerRow.append(th);
  }
  head.append(headerRow);
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length + (["merchants","withdrawals","agents"].includes(type) ? 1 : 0);
    td.textContent = "Pa gen dosye nan kategori sa a.";
    tr.append(td);
    body.append(tr);
    return;
  }
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach(([key]) => {
      const td = document.createElement("td");
      td.textContent = recordValue(type, row, key);
      tr.append(td);
    });
    if (["merchants","withdrawals","agents"].includes(type)) {
      const td = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button-quiet admin-row-action";
      button.textContent = "Revize";
      button.addEventListener("click", () => openAdminAction(type, row));
      td.append(button);
      tr.append(td);
    }
    body.append(tr);
  });
}
async function loadAdminRecords(type) {
  const session = await currentSession();
  setNotice("#adminRecordsNotice", "Ap chaje dosye " + type + " yo…", "");
  try {
    const data = await adminRequest("/api/admin/records?type=" + encodeURIComponent(type), session);
    renderAdminRecords(type, data.records || []);
    setNotice("#adminRecordsNotice",
      (data.count || 0).toLocaleString("fr-HT") + " dosye · Dènye mizajou: " +
      new Date(data.generated_at || Date.now()).toLocaleString("fr-HT"), "success");
    document.querySelectorAll("[data-record-type]").forEach((button) => {
      button.classList.toggle("active", button.dataset.recordType === type);
    });
  } catch (error) {
    setNotice("#adminRecordsNotice", explainError(error.code || error.message), "error");
    if (error.code === "MFA_REQUIRED") {
      await updateMfaStatus().catch(() => {});
      setNotice("#adminMfaStatus", "Verifye MFA TOTP pou wè dosye operasyonèl yo oswa fè aksyon admin.", "error");
      $("#adminMfaPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (error.code === "ADMIN_PIN_REQUIRED") {
      adminPinVerifiedUserId = null;
      await showPinGate(session);
    }
  }
}
async function requireMfaForAdminAction() {
  const session = await currentSession();
  const claims = decodeJwtPayload(session?.access_token);
  if (claims?.aal !== "aal2") {
    setNotice("#adminActionNotice", "Aksyon sa a mande verifikasyon MFA TOTP. Aktive/verifye authenticator anlè a anvan.", "error");
    $("#adminMfaPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    return null;
  }
  return session;
}
async function submitAdminAction(path, body, successMessage, reloadType) {
  const session = await requireMfaForAdminAction();
  if (!session) return;
  try {
    await adminRequest(path, session, body);
    setNotice("#adminActionNotice", successMessage, "success");
    if (reloadType) await loadAdminRecords(reloadType);
    await refreshCurrent();
  } catch (error) {
    setNotice("#adminActionNotice", explainError(error.code || error.message), "error");
    if (error.code === "MFA_REQUIRED") {
      setNotice("#adminMfaStatus", "Sesyon MFA a ekspire. Verifye kòd authenticator la ankò.", "error");
    }
    if (error.code === "ADMIN_PIN_REQUIRED") {
      adminPinVerifiedUserId = null;
      await showPinGate(session);
    }
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


  $("#adminMfaEnrollButton").addEventListener("click", async () => {
    const button = $("#adminMfaEnrollButton");
    button.disabled = true;
    try {
      await enrollAdminMfa();
    } catch (error) {
      setNotice("#adminMfaStatus", error.message || "MFA pa kapab kòmanse.", "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#adminMfaVerifyButton").addEventListener("click", async () => {
    const button = $("#adminMfaVerifyButton");
    button.disabled = true;
    try {
      await verifyAdminMfa();
    } catch (error) {
      setNotice("#adminMfaStatus", error.message || "Kòd MFA a pa valide.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll("[data-record-type]").forEach((button) => {
    button.addEventListener("click", () => loadAdminRecords(button.dataset.recordType));
  });
  $("#adminRecordsRefresh").addEventListener("click", () => {
    const active = document.querySelector("[data-record-type].active");
    loadAdminRecords(active?.dataset.recordType || "users");
  });

  $("#adminMerchantReviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAdminAction("/api/admin/merchants/review", {
      merchant_id: $("#adminMerchantId").value.trim(),
      status: $("#adminMerchantStatus").value,
      comment: $("#adminMerchantComment").value.trim()
    }, "Desizyon sou machann lan anrejistre.", "merchants");
  });
  $("#adminWithdrawalReviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAdminAction("/api/admin/withdrawals/decision", {
      withdrawal_id: $("#adminWithdrawalId").value.trim(),
      decision: $("#adminWithdrawalDecision").value,
      comment: $("#adminWithdrawalComment").value.trim()
    }, "Desizyon sou demann retrè a anrejistre. Dezyèm apwobasyon ka toujou nesesè.", "withdrawals");
  });
  $("#adminAgentReviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAdminAction("/api/admin/agents/review", {
      application_id: $("#adminAgentApplicationId").value.trim(),
      decision: $("#adminAgentDecision").value,
      admin_note: $("#adminAgentNote").value.trim()
    }, "Desizyon sou aplikasyon ajan an anrejistre.", "agents");
  });
  $("#adminLedgerAuditButton").addEventListener("click", async () => {
    const session = await requireMfaForAdminAction();
    if (!session) return;
    try {
      const data = await adminRequest("/api/admin/ledger/audit", session);
      $("#adminLedgerAuditResult").textContent = JSON.stringify(data.report || data, null, 2);
      setNotice("#adminActionNotice", data.report?.ok
        ? "Odit ledger la fini. Pa gen erè nan kontwòl sa yo."
        : "Odit ledger la jwenn pwen ki mande revizyon.", data.report?.ok ? "success" : "error");
    } catch (error) {
      setNotice("#adminActionNotice", explainError(error.code || error.message), "error");
      $("#adminLedgerAuditResult").textContent = error.message;
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
