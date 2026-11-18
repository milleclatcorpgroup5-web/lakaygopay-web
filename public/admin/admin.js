import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const $ = (selector) => document.querySelector(selector);
let supabase = null;
let adminPinVerifiedUserId = null;
let pinGateSession = null;
let currentAdminRoles = [];

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
    risk_admin: "Admin risk",
    accountant: "Kontab",
    secretary: "Sekretè pèsonèl",
    support_agent: "Sipò kliyan",
    auditor: "Oditè"
  };
  return names[role] || role;
}
function explainError(code) {
  const normalized = String(code || "").trim().toLowerCase();
  if (normalized === "invalid login credentials" ||
      normalized === "invalid_credentials" ||
      normalized === "invalid_grant") {
    return "Supabase Production pa valide konbinezon imèl/modpas sa a. Verifye imèl la oswa itilize rekiperasyon modpas la.";
  }
  const messages = {
    ADMIN_ACCESS_DENIED: "Kont sa a pa gen wòl administratè. Aksè a refize.",
    ADMIN_PERMISSION_DENIED: "Wòl kont sa a pa otorize pou ouvri modil sa a.",
    SUPER_ADMIN_REQUIRED: "Se Super Administratè sèlman ki ka fè chanjman sa a.",
    ADMIN_ROLE_INVALID: "Wòl administratè sa a pa valab.",
    ADMIN_ROLE_ACTION_INVALID: "Aksyon sou wòl la pa valab.",
    TEAM_DIRECTORY_UNAVAILABLE: "Lis ekip administrasyon an pa disponib.",
    FINANCE_MODULE_SCHEMA_NOT_READY: "Bazdone bous revni an poko enstale. Egzekite migrasyon Admin Control Center la.",
    FINANCE_OVERVIEW_UNAVAILABLE: "Rezime finans lan pa disponib.",
    SECRETARIAT_ACCESS_NOT_ASSIGNED: "Sekretè sa a poko resevwa aksè nan sekretarya pèsonèl la.",
    SECRETARIAT_ROLE_REQUIRED: "Kont lan dwe gen wòl Sekretè anvan li resevwa aksè sa a.",
    SECRETARIAT_ACCESS_SAVE_FAILED: "Nou pa t kapab anrejistre otorizasyon sekretè a.",
    SECRETARIAT_STORAGE_UNAVAILABLE: "Depo sekretarya a poko pare oswa li pa disponib.",
    SECRETARIAT_TITLE_INVALID: "Tit la obligatwa epi li dwe gen 160 karaktè oswa mwens.",
    SECRETARIAT_ITEM_NOT_FOUND: "Nou pa jwenn travay sa a nan sekretarya a.",
    SECRETARIAT_STATUS_INVALID: "Estati travay la pa valab.",
    INVALID_USER_ID: "ID itilizatè a pa valab.",
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
    ADMIN_PIN_CHALLENGE_INVALID: "Demann sekirite a pa valab. Rekòmanse verifikasyon an.",
    ADMIN_PIN_CHALLENGE_EXPIRED: "Demann sekirite a ekspire oswa li deja itilize. Eseye ankò.",
    ADMIN_PIN_HASH_INVALID: "Kalkil hash PIN lan pa pwodwi yon rezilta valab.",
    ADMIN_PIN_RESPONSE_INVALID: "Repons kriptografik la pa valab.",
    PIN_HASH_DERIVATION_FAILED: "Navigatè a pa t kapab kalkile hash PIN lan.",
    PIN_CRYPTO_API_UNAVAILABLE: "Navigatè a pa ofri sèvis kriptografik sekirize. Louvri sit la sou HTTPS epi mete navigatè a ajou.",
    PIN_HASH_ALGORITHM_UNSUPPORTED: "Navigatè a pa sipòte algoritm sekirite PIN lan.",
    PIN_HASH_DERIVATION_RUNTIME_ERROR: "Kalkil hash PIN lan echwe nan navigatè a. Dyagnostik teknik la montre etap ki echwe a.",
    ADMIN_SYSTEM_HEALTH_UNAVAILABLE: "Siveyans sistèm nan pa disponib kounye a.",
    ADMIN_PIN_REQUIRED: "Pou pwoteje sesyon an, antre PIN Admin 6 chif ou ankò.",
    AUTH_REQUIRED: "Konekte pou kontinye.",
    INVALID_OR_EXPIRED_SESSION: "Sesyon an ekspire. Konekte ankò.",
    INVALID_CREDENTIALS: "Imèl oswa modpas la pa kòrèk.",
    ADMIN_OVERVIEW_UNAVAILABLE: "Apèsi administrasyon an pa disponib kounye a.",
    ADMIN_RECORDS_UNAVAILABLE: "Lis dosye administrasyon an pa disponib kounye a.",
    ADMIN_RECORD_TYPE_INVALID: "Kategori dosye sa a pa valab.",
    MFA_REQUIRED: "Aksyon sa a mande verifikasyon TOTP. Verifye kòd authenticator ou a.",
    MFA_CODE_MUST_BE_6_DIGITS: "Kòd authenticator lan dwe gen 6 chif.",
    MFA_FACTOR_NOT_ENROLLED: "Pa gen faktè authenticator. Klike Kreye / aktive MFA an premye.",
    USER_STATUS_INVALID: "Estati kont lan pa valab.",
    ADMIN_CANNOT_SUSPEND_SELF: "Ou pa kapab sispann pwòp kont administratè ou.",
    LAST_SUPER_ADMIN_PROTECTED: "Ou pa kapab sispann dènye Super administratè aktif la.",
    SUPER_ADMIN_ACCOUNT_PROTECTED: "Se sèlman yon Super administratè ki ka chanje estati yon lòt Super administratè.",
    USER_NOT_FOUND: "Kont itilizatè sa a pa egziste.",
    ADMIN_SESSION_MISMATCH: "Sesyon administratè a pa koresponn. Konekte ankò."
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
  currentAdminRoles = [];
  if (message) setNotice("#loginNotice", message, kind);
}
async function adminRequest(path, session, body, method) {
  const headers = {
    accept: "application/json",
    authorization: "Bearer " + session.access_token
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, {
    method: method || (body === undefined ? "GET" : "POST"),
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
    error.diagnostic = typeof data.diagnostic === "string" ? data.diagnostic : null;
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
    headers: { accept: "application/json", authorization: "Bearer " + session.access_token },
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
  currentAdminRoles = Array.isArray(admin.roles) ? admin.roles : [];
  const roleSet = new Set(currentAdminRoles);
  const isSuper = roleSet.has("super_admin");
  const canSeeOperations = isSuper || ["admin","risk_admin","support_agent","finance_admin","accountant","auditor"].some((role) => roleSet.has(role));
  const canSeeActions = isSuper || ["admin","risk_admin","finance_admin","accountant","auditor"].some((role) => roleSet.has(role));
  const canSeeFinance = isSuper || ["finance_admin","accountant","auditor"].some((role) => roleSet.has(role));
  const canSeeSecretariat = isSuper || roleSet.has("secretary");

  $("#adminRecordsPanel").hidden = !canSeeOperations;
  $("#adminActionsPanel").hidden = !canSeeActions;
  $("#adminUserStatusForm").hidden = !(isSuper || roleSet.has("admin") || roleSet.has("risk_admin"));
  $("#adminMerchantReviewForm").hidden = !(isSuper || roleSet.has("admin") || roleSet.has("risk_admin"));
  $("#adminWithdrawalReviewForm").hidden = !(isSuper || roleSet.has("admin") || roleSet.has("risk_admin") || roleSet.has("finance_admin"));
  $("#adminAgentReviewForm").hidden = !(isSuper || roleSet.has("admin") || roleSet.has("risk_admin"));
  $("#adminFinancePanel").hidden = !canSeeFinance;
  $("#adminTeamPanel").hidden = !isSuper;
  $("#adminSecretariatPanel").hidden = !canSeeSecretariat;

  const firstName = String(admin.email || "Administratè").split("@")[0];
  $("#adminName").textContent = firstName;
  $("#adminMeta").textContent = "Wòl verifye: " + currentAdminRoles.map(displayRole).join(" · ");
  $("#sessionEmail").textContent = admin.email || "Kont verifye";
  $("#sessionRoles").textContent = currentAdminRoles.map(displayRole).join(", ");

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
  const mfaReady = await updateMfaStatus().catch(() => false);
  await loadSystemHealth(session);

  if (!mfaReady) {
    const lockMessage = "Verifye MFA TOTP anlè a pou ouvri done operasyonèl, finansye ak sekretarya yo.";
    if (canSeeFinance) setNotice("#financeNotice", lockMessage, "");
    if (isSuper) setNotice("#teamRolesNotice", lockMessage, "");
    if (canSeeSecretariat) setNotice("#secretariatNotice", lockMessage, "");
    if (canSeeOperations) setNotice("#adminRecordsNotice", lockMessage, "");
    return;
  }

  if (canSeeFinance) await loadFinanceOverview(session);
  if (isSuper) await loadTeamRoles(session);
  if (canSeeSecretariat) await loadSecretariatItems(session);

  if (canSeeOperations) {
    const allowedRecords = new Set();
    if (isSuper) {
      ["users","merchants","wallets","ledger","withdrawals","agents","audit"].forEach((type) => allowedRecords.add(type));
    } else {
      const scopes = {
        admin: ["users","merchants","wallets","ledger","withdrawals","agents","audit"],
        risk_admin: ["users","merchants","withdrawals","agents","audit"],
        support_agent: ["users","merchants","agents"],
        finance_admin: ["wallets","ledger","withdrawals","audit"],
        accountant: ["wallets","ledger","audit"],
        auditor: ["wallets","ledger","audit"]
      };
      currentAdminRoles.forEach((role) => (scopes[role] || []).forEach((type) => allowedRecords.add(type)));
    }
    document.querySelectorAll("[data-record-type]").forEach((button) => {
      button.hidden = !allowedRecords.has(button.dataset.recordType);
    });
    const defaultRecord = allowedRecords.has("users") ? "users"
      : allowedRecords.has("audit") && roleSet.has("auditor") ? "audit"
      : allowedRecords.has("ledger") ? "ledger"
      : allowedRecords.values().next().value;
    if (defaultRecord) await loadAdminRecords(defaultRecord);
  } else {
    setNotice("#adminRecordsNotice", "Wòl Sekretè a pa gen aksè nan dosye operasyonèl oswa finansye kliyan yo.", "success");
  }
}
function renderSystemHealth(data) {
  const list = $("#systemHealthList");
  if (!list) return;
  list.replaceChildren();
  const labels = { ok: "OK", warning: "AVÈTISMAN", error: "ERÈ", disabled: "DEZAKTIVE" };
  (data.checks || []).forEach((check) => {
    const row = document.createElement("article");
    row.className = "health-row health-" + (check.status || "error");
    const main = document.createElement("div");
    main.className = "health-row-main";
    const title = document.createElement("strong");
    title.textContent = check.label || check.id || "Sèvis";
    const detail = document.createElement("small");
    detail.textContent = [
      check.diagnostic || "NO_DIAGNOSTIC",
      check.stage || "",
      check.http_status ? "HTTP " + check.http_status : "",
      check.signup_enabled === true ? "ENSKRIPSYON OUVÈ" : check.signup_enabled === false ? "ENSKRIPSYON FÈMEN" : "",
      check.email_confirmation_required === true ? "KONFIMASYON IMÈL OBLIGATWA" : ""
    ].filter(Boolean).join(" · ");
    main.append(title, detail);
    const state = document.createElement("span");
    state.className = "health-state";
    state.textContent = labels[check.status] || "ENKONI";
    row.append(main, state);
    list.append(row);
  });
  const counts = data.counts || {};
  $("#systemHealthSummary").textContent =
    (counts.ok || 0) + " OK · " + (counts.warning || 0) + " Avètisman · " +
    (counts.error || 0) + " Erè · " + (counts.disabled || 0) + " Dezaktive";
  $("#systemHealthTimestamp").textContent = data.checked_at
    ? "Dènye verifikasyon: " + new Date(data.checked_at).toLocaleString("fr-HT")
    : "";
  const notice = data.overall === "error"
    ? "Gen sèvis ki an erè. Gade kòd dyagnostik yo anba a."
    : data.overall === "warning"
      ? "Gen avètisman ki mande verifikasyon, espesyalman enskripsyon."
      : "Sèvis ki teste yo disponib. Peman reyèl rete dezaktive.";
  setNotice("#systemHealthNotice", notice, data.overall === "ok" ? "success" : "error");
}
async function loadSystemHealth(session) {
  const button = $("#systemHealthRefresh");
  if (button) button.disabled = true;
  setNotice("#systemHealthNotice", "Ap teste koneksyon, bazdone, sekirite ak enskripsyon…", "");
  try {
    const data = await adminRequest("/api/admin/system-health", session);
    renderSystemHealth(data);
  } catch (error) {
    setNotice("#systemHealthNotice",
      explainError(error.code || error.message) +
      (error.diagnostic ? " (Dyagnostik: " + error.diagnostic + ")" : ""),
      "error");
    $("#systemHealthSummary").textContent = "Verifikasyon an pa fini.";
    $("#systemHealthList").replaceChildren();
  } finally {
    if (button) button.disabled = false;
  }
}

function pinHexToBytes(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{32,64}$/.test(value) || value.length % 2 !== 0) {
    throw new Error("ADMIN_PIN_HASH_INVALID");
  }
  return Uint8Array.from(value.match(/.{2}/g), (part) => parseInt(part, 16));
}
function pinBytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function deriveAdminPinHashBytes(pin, saltHex, iterations) {
  if (
    !/^\d{6}$/.test(pin) ||
    !/^[a-f0-9]{32}$/.test(saltHex) ||
    Number(iterations) !== 600000
  ) throw new Error("ADMIN_PIN_CONFIGURATION_INVALID");

  if (!globalThis.crypto?.subtle) throw new Error("PIN_CRYPTO_API_UNAVAILABLE");
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(pin),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const result = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: pinHexToBytes(saltHex),
        iterations: Number(iterations)
      },
      material,
      256
    );
    return new Uint8Array(result);
  } catch (cause) {
    const failure = new Error("PIN_HASH_DERIVATION_FAILED");
    const causeName = String(cause?.name || "Error");
    failure.diagnostic = causeName === "NotSupportedError"
      ? "WEBCRYPTO_ALGORITHM_UNSUPPORTED"
      : causeName === "OperationError"
        ? "WEBCRYPTO_PBKDF2_OPERATION_ERROR"
        : "WEBCRYPTO_" + causeName.replace(/[^A-Za-z0-9_]/g, "").slice(0, 32);
    throw failure;
  }
}
async function signAdminPinChallenge(pin, challengeData) {
  const derivedBytes = await deriveAdminPinHashBytes(
    pin,
    challengeData.salt,
    challengeData.iterations
  );
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      derivedBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(challengeData.challenge)
    );
    return pinBytesToHex(new Uint8Array(signature));
  } finally {
    derivedBytes.fill(0);
  }
}
async function completePinVerification(session, pin) {
  const challenge = await adminRequest("/api/admin/pin/challenge", session);
  const response = await signAdminPinChallenge(pin, challenge);
  await adminRequest("/api/admin/pin/verify", session, {
    challenge: challenge.challenge,
    response
  });
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
  await refreshCurrent();
}
async function loadFinanceOverview(session) {
  setNotice("#financeNotice", "Ap chaje kont trezò antrepriz la…", "");
  try {
    const data = await adminRequest("/api/admin/finance/overview", session);
    const accounts = data.treasury?.accounts || {};
    const formatBalance = (currency) => {
      const account = accounts[currency];
      if (!account) return "Pa pare";
      return Number(account.balance || 0).toLocaleString("fr-HT", {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      }) + " " + currency;
    };
    $("#treasuryHtg").textContent = formatBalance("HTG");
    $("#treasuryUsd").textContent = formatBalance("USD");
    $("#treasuryEur").textContent = formatBalance("EUR");
    $("#accountingReadiness").textContent = data.accounting?.note ||
      "Ledger entèn lan se sous done kontab la. Motè frè otomatik la poko aktive.";
    const ready = data.treasury?.ready === true;
    setNotice("#financeNotice",
      ready
        ? "3 bous revni antrepriz pare. Yo kòmanse a zewo; pa gen frè sèvis k ap antre otomatikman nan faz sa a."
        : "Estrikti bous revni an poko konplè. Verifye migrasyon Admin Control Center la.",
      ready ? "success" : "error");
  } catch (error) {
    setNotice("#financeNotice", explainError(error.code || error.message), "error");
    $("#treasuryHtg").textContent = "N/D";
    $("#treasuryUsd").textContent = "N/D";
    $("#treasuryEur").textContent = "N/D";
  }
}

function feeServiceLabel(code) {
  const labels = {
    internal_transfer: "Transfè entèn",
    merchant_qr: "Peman machann QR",
    fx_conversion: "Konvèsyon lajan",
    cash_in: "Depo / Cash In",
    cash_out: "Retrè / Cash Out",
    bill_payment: "Peman fakti / rechaj"
  };
  return labels[code] || code;
}

function renderFeeProposals(proposals, canApprove) {
  const list = $("#feeProposalsList");
  list.replaceChildren();
  if (!proposals.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Pa gen pwopozisyon tarif pou kounye a.";
    list.append(empty);
    return;
  }
  proposals.forEach((proposal) => {
    const card = document.createElement("article");
    card.className = "fee-proposal-card";
    const main = document.createElement("div");
    main.className = "fee-proposal-main";
    const title = document.createElement("strong");
    title.textContent = feeServiceLabel(proposal.service_code) + " · " + proposal.currency + " · v" + proposal.version;
    const value = document.createElement("b");
    const feeText = proposal.fee_kind === "percentage"
      ? Number(proposal.fee_value).toLocaleString("fr-HT") + "%"
      : Number(proposal.fee_value).toLocaleString("fr-HT") + " " + proposal.currency;
    value.textContent = feeText;
    const meta = document.createElement("small");
    meta.textContent = [
      "Estati: " + proposal.status,
      "Aplikasyon: " + new Date(proposal.effective_at).toLocaleString("fr-HT"),
      proposal.minimum_fee != null ? "Min: " + proposal.minimum_fee : "",
      proposal.maximum_fee != null ? "Max: " + proposal.maximum_fee : ""
    ].filter(Boolean).join(" · ");
    const note = document.createElement("p");
    note.textContent = proposal.proposal_note || "";
    main.append(title,value,meta,note);
    card.append(main);

    if (canApprove && proposal.status === "proposed") {
      const actions = document.createElement("div");
      actions.className = "fee-proposal-actions";
      for (const [decision,label] of [["approve","Apwouve"],["reject","Rejte"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = decision === "approve" ? "button button-primary" : "button button-quiet";
        button.textContent = label;
        button.addEventListener("click", () => reviewFeeProposal(proposal.id, decision));
        actions.append(button);
      }
      card.append(actions);
    }
    list.append(card);
  });
}

async function loadFeeProposals(session) {
  setNotice("#feeProposalsNotice", "Ap chaje istwa pwopozisyon tarif yo…", "");
  try {
    const data = await adminRequest("/api/admin/finance/fees", session);
    renderFeeProposals(data.proposals || [], data.can_approve === true);
    setNotice("#feeProposalsNotice",
      (data.proposals || []).length + " vèsyon tarif nan istorik la. Motè frè a rete dezaktive.",
      "success");
    $("#feeProposalForm").hidden = data.can_propose !== true;
  } catch (error) {
    setNotice("#feeProposalsNotice", explainError(error.code || error.message), "error");
    $("#feeProposalsList").replaceChildren();
  }
}

async function reviewFeeProposal(proposalId, decision) {
  const verb = decision === "approve" ? "apwouve" : "rejte";
  if (!window.confirm("Ou vle " + verb + " pwopozisyon tarif sa a? Sa pap aktive koleksyon frè.")) return;
  const note = window.prompt("Nòt Super Administratè (opsyonèl):") || "";
  const buttonSession = await currentSession();
  try {
    await adminRequest("/api/admin/finance/fees", buttonSession, {
      proposal_id: proposalId,
      decision,
      decision_note: note
    }, "PATCH");
    setNotice("#feeProposalsNotice", "Desizyon Super Administratè a anrejistre ak tras audit.", "success");
    await loadFeeProposals(buttonSession);
  } catch (error) {
    setNotice("#feeProposalsNotice", explainError(error.code || error.message), "error");
  }
}

function renderDailySummary(rows) {
  const body = $("#dailySummaryBody");
  body.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "muted";
    td.textContent = "Pa gen mouvman nan peryòd sa a.";
    tr.append(td);
    body.append(tr);
    return;
  }
  const money = (value,currency) => Number(value || 0).toLocaleString("fr-HT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + " " + currency;
  rows.forEach((item) => {
    const tr = document.createElement("tr");
    const values = [
      item.ledger_date ? new Date(item.ledger_date + "T00:00:00").toLocaleDateString("fr-HT") : "—",
      item.currency || "—",
      Number(item.transaction_count || 0).toLocaleString("fr-HT"),
      money(item.total_debits,item.currency),
      money(item.total_credits,item.currency),
      money(item.platform_revenue_credits,item.currency)
    ];
    values.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    });
    body.append(tr);
  });
}

async function loadDailyFinancialSummary(session) {
  setNotice("#dailySummaryNotice", "Ap li ledger la pou prepare rapò jou yo…", "");
  try {
    const days = Number($("#dailySummaryDays").value || 30);
    const data = await adminRequest("/api/admin/finance/daily-summary?days=" + encodeURIComponent(days), session);
    const rows = Array.isArray(data.report?.rows) ? data.report.rows : [];
    renderDailySummary(rows);
    setNotice("#dailySummaryNotice",
      "Rapò " + days + " jou chaje. Sous: ledger immutable. Revni kredit montre sèlman antre ki deja poste nan bous revni a.",
      "success");
  } catch (error) {
    renderDailySummary([]);
    setNotice("#dailySummaryNotice", explainError(error.code || error.message), "error");
  }
}

async function loadTeamRoles(session) {
  setNotice("#teamRolesNotice", "Ap chaje lis ekip la…", "");
  try {
    const data = await adminRequest("/api/admin/team/roles", session);
    const body = $("#teamUsersBody");
    body.replaceChildren();
    (data.users || []).forEach((user) => {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = user.full_name || "San non";
      const id = document.createElement("td");
      id.textContent = user.id || "—";
      const roles = document.createElement("td");
      roles.textContent = (user.roles || []).map(displayRole).join(", ") || "Itilizatè";
      const status = document.createElement("td");
      status.textContent = user.account_status || "—";
      const action = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button-quiet admin-row-action";
      button.textContent = "Chwazi";
      button.addEventListener("click", () => { $("#teamTargetUserId").value = user.id; });
      action.append(button);
      row.append(name,id,roles,status,action);
      body.append(row);
    });
    setNotice("#teamRolesNotice", (data.users || []).length + " kont disponib pou jesyon wòl. ID yo rete vizib pou Super Admin sèlman.", "success");
  } catch (error) {
    setNotice("#teamRolesNotice", explainError(error.code || error.message), "error");
  }
}

function renderSecretariatItems(items) {
  const list = $("#secretariatItemsList");
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Pa gen travay, randevou oswa rapèl pou kounye a.";
    list.append(empty);
    return;
  }
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "secretariat-item";
    const main = document.createElement("div");
    main.className = "secretariat-item-main";
    const title = document.createElement("strong");
    title.textContent = item.title || "San tit";
    const meta = document.createElement("small");
    const due = item.due_at ? new Date(item.due_at).toLocaleString("fr-HT") : "Pa gen dat";
    meta.textContent = [item.item_type, due, "Priyorite: " + item.priority, "Estati: " + item.status].join(" · ");
    const details = document.createElement("p");
    details.textContent = item.details || "";
    main.append(title,meta,details);
    const actions = document.createElement("div");
    actions.className = "secretariat-item-actions";
    if (item.status !== "done" && item.status !== "cancelled") {
      const done = document.createElement("button");
      done.type = "button";
      done.className = "button button-quiet admin-row-action";
      done.textContent = "Make fini";
      done.addEventListener("click", () => updateSecretariatStatus(item.id, "done"));
      actions.append(done);
    }
    card.append(main,actions);
    list.append(card);
  });
}

async function loadSecretariatItems(session) {
  setNotice("#secretariatNotice", "Ap chaje travay ak randevou pèsonèl yo…", "");
  try {
    const data = await adminRequest("/api/admin/secretariat", session);
    renderSecretariatItems(data.items || []);
    setNotice("#secretariatNotice", (data.items || []).length + " antre sekretarya chaje.", "success");
  } catch (error) {
    setNotice("#secretariatNotice", explainError(error.code || error.message), "error");
    $("#secretariatItemsList").replaceChildren();
  }
}

async function updateSecretariatStatus(itemId, status) {
  const session = await currentSession();
  try {
    await adminRequest("/api/admin/secretariat", session, { item_id: itemId, status }, "PATCH");
    await loadSecretariatItems(session);
  } catch (error) {
    setNotice("#secretariatNotice", explainError(error.code || error.message), "error");
  }
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
  $("#adminUserStatusForm").hidden = type !== "users";
  $("#adminMerchantReviewForm").hidden = type !== "merchants";
  $("#adminWithdrawalReviewForm").hidden = type !== "withdrawals";
  $("#adminAgentReviewForm").hidden = type !== "agents";
  if (type === "users") {
    $("#adminUserId").value = row.id || "";
    $("#adminUserStatus").value = row.account_status === "suspended" ? "active" : "suspended";
    $("#adminUserReason").value = "";
  } else if (type === "merchants") {
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
function canReviewRecord(type) {
  if (currentAdminRoles.includes("super_admin")) return true;
  const scopes = {
    users: ["admin","risk_admin"],
    merchants: ["admin","risk_admin"],
    withdrawals: ["admin","risk_admin","finance_admin"],
    agents: ["admin","risk_admin"]
  };
  return (scopes[type] || []).some((role) => currentAdminRoles.includes(role));
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
  const showActionColumn = canReviewRecord(type);
  if (showActionColumn) {
    const th = document.createElement("th");
    th.textContent = "Aksyon";
    headerRow.append(th);
  }
  head.append(headerRow);
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length + (showActionColumn ? 1 : 0);
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
    if (showActionColumn) {
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
        email: $("#emailInput").value.trim().toLowerCase(),
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
      setNotice("#pinNotice",
        explainError(error.code || error.message) +
        (error.diagnostic ? " (Dyagnostik: " + error.diagnostic + ")" : ""),
        "error");
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
      const challenge = await adminRequest("/api/admin/pin/setup-challenge", pinGateSession);
      const derivedBytes = await deriveAdminPinHashBytes(
        pin,
        challenge.salt,
        challenge.iterations
      );
      let pinHash;
      try {
        pinHash = pinBytesToHex(derivedBytes);
      } finally {
        derivedBytes.fill(0);
      }
      await adminRequest("/api/admin/pin/setup", pinGateSession, {
        challenge: challenge.challenge,
        pin,
        pin_hash: pinHash
      });
      await completePinVerification(pinGateSession, pin);
    } catch (error) {
      const baseMessage = explainError(error.code || error.message);
      const diagnosticMessage = error.diagnostic ? " (Dyagnostik: " + error.diagnostic + ")" : "";
      setNotice("#pinNotice", baseMessage + diagnosticMessage, "error");
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

  $("#adminUserStatusForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("#adminUserStatus").value;
    const action = status === "suspended" ? "sispann" : "reyaktive";
    if (!window.confirm("Ou vle " + action + " kont itilizatè sa a?")) return;
    await submitAdminAction("/api/admin/users/status", {
      user_id: $("#adminUserId").value.trim(),
      status,
      reason: $("#adminUserReason").value.trim()
    }, "Estati kont itilizatè a mete ajou avèk tras audit.", "users");
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

  $("#dailySummaryRefresh").addEventListener("click", async () => {
    const session = await currentSession();
    if (session) await loadDailyFinancialSummary(session);
  });
  $("#dailySummaryDays").addEventListener("change", async () => {
    const session = await currentSession();
    if (session) await loadDailyFinancialSummary(session);
  });

  $("#feeProposalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const effectiveValue = $("#feeEffectiveAt").value;
    if (!effectiveValue) {
      setNotice("#feeProposalsNotice", "Chwazi dat ak lè tarif la ta dwe antre an aplikasyon.", "error");
      return;
    }
    const button = event.submitter;
    button.disabled = true;
    try {
      const session = await currentSession();
      await adminRequest("/api/admin/finance/fees", session, {
        service_code: $("#feeServiceCode").value,
        currency: $("#feeCurrency").value,
        fee_kind: $("#feeKind").value,
        fee_value: $("#feeValue").value,
        minimum_fee: $("#feeMinimum").value,
        maximum_fee: $("#feeMaximum").value || null,
        effective_at: new Date(effectiveValue).toISOString(),
        note: $("#feeProposalNote").value.trim()
      });
      $("#feeValue").value = "";
      $("#feeMaximum").value = "";
      $("#feeProposalNote").value = "";
      setNotice("#feeProposalsNotice", "Pwopozisyon an soumèt. Li ap tann desizyon Super Administratè a; okenn frè pa kolekte.", "success");
      await loadFeeProposals(session);
    } catch (error) {
      setNotice("#feeProposalsNotice", explainError(error.code || error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#teamRoleForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = $("#teamTargetUserId").value.trim();
    const role = $("#teamRoleSelect").value;
    const action = $("#teamRoleAction").value;
    if (!target) {
      setNotice("#teamRolesNotice", "Chwazi yon kont itilizatè anvan.", "error");
      return;
    }
    const verb = action === "grant" ? "bay" : "retire";
    if (!window.confirm("Ou vle " + verb + " wòl " + displayRole(role) + " pou kont sa a?")) return;
    const button = event.submitter;
    button.disabled = true;
    try {
      const session = await currentSession();
      await adminRequest("/api/admin/team/roles", session, { target_user_id: target, role, action });
      setNotice("#teamRolesNotice", "Chanjman wòl la anrejistre ak tras audit.", "success");
      await loadTeamRoles(session);
    } catch (error) {
      setNotice("#teamRolesNotice", explainError(error.code || error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#secretariatAccessForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const assistant = $("#secretaryAssistantUserId").value.trim();
    if (!assistant) return;
    const button = event.submitter;
    button.disabled = true;
    try {
      const session = await currentSession();
      const action = $("#secretariatAccessAction").value;
      await adminRequest("/api/admin/secretariat-access", session, { assistant_user_id: assistant, action });
      setNotice("#secretariatAccessNotice",
        action === "grant" ? "Sekretè a resevwa aksè nan sekretarya pèsonèl la sèlman."
          : "Aksè sekretè a retire; done pèsonèl yo rete konsève.",
        "success");
    } catch (error) {
      setNotice("#secretariatAccessNotice", explainError(error.code || error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#secretariatForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#secretariatTitle").value.trim();
    if (!title) return;
    const dueValue = $("#secretariatDueAt").value;
    const button = event.submitter;
    button.disabled = true;
    try {
      const session = await currentSession();
      const dueAt = dueValue ? new Date(dueValue).toISOString() : null;
      await adminRequest("/api/admin/secretariat", session, {
        item_type: $("#secretariatType").value,
        title,
        details: $("#secretariatDetails").value.trim(),
        due_at: dueAt,
        priority: $("#secretariatPriority").value
      });
      $("#secretariatTitle").value = "";
      $("#secretariatDetails").value = "";
      $("#secretariatDueAt").value = "";
      await loadSecretariatItems(session);
    } catch (error) {
      setNotice("#secretariatNotice", explainError(error.code || error.message), "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#secretariatRefresh").addEventListener("click", async () => {
    const session = await currentSession();
    if (session) await loadSecretariatItems(session);
  });

  $("#systemHealthRefresh").addEventListener("click", async () => {
    const session = await currentSession();
    if (session) await loadSystemHealth(session);
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
