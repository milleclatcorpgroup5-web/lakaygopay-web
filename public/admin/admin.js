import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const $ = (selector) => document.querySelector(selector);
let supabase = null;
let adminPinVerifiedUserId = null;
let pinGateSession = null;
let currentAdminRoles = [];
let teamDirectoryRows = [];
let liveLogsTimer = null;
let liveLogsSession = null;
let mfaCanVerify = false;
let supabaseProjectRef = "unknown";
let adminMfaActiveFactorId = null;
const ADMIN_MFA_FACTOR_STORAGE_KEY = "lakaygopay_admin_mfa_factor_v1";
const ADMIN_MFA_BACKUP_FACTOR_STORAGE_KEY = "lakaygopay_admin_mfa_backup_factor_v1";

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
    CARD_LIMIT_INVALID: "Plafon HTG la pa valab. Antre zewo oswa yon kantite ki gen jiska 2 desimal.",
    CARD_LIMIT_REASON_INVALID: "Rezon verifikasyon an dwe gen ant 10 ak 300 karaktè.",
    CARD_LIMIT_USER_REQUIRED: "ID kont kliyan an obligatwa.",
    CARD_CUSTOMER_NOT_ACTIVE: "Nou pa jwenn yon kont kliyan ki aktif pou ID sa a.",
    CARD_LIMIT_CLASSIFICATION_FAILED: "Plafon an pa antre nan okenn nivo kat. Verifye ranje klasman yo.",
    CARD_LIMIT_SCHEMA_NOT_READY: "Bazdone plafon kat la poko enstale. Aplike migrasyon 004 ak 005 la.",
    CARD_LIMIT_ASSIGNMENTS_UNAVAILABLE: "Lis plafon kliyan yo pa disponib.",
    CARD_LIMIT_UPDATE_FAILED: "Nou pa t kapab mete plafon kliyan an ajou.",
    CARD_TIER_SERVER_ASSIGNED: "Se sistèm LakayGo ki detèmine klasman ak nivo etwal la.",

    FINANCE_MODULE_SCHEMA_NOT_READY: "Bazdone bous revni an poko enstale. Egzekite migrasyon Admin Control Center la.",
    FINANCE_OVERVIEW_UNAVAILABLE: "Rezime finans lan pa disponib.",
    FINANCE_REPORT_RANGE_INVALID: "Chwazi yon peryòd rapò ant 1 ak 90 jou.",
    FINANCE_ROLE_REQUIRED: "Se yon Responsab Finans ki ka soumèt pwopozisyon tarif.",
    MAKER_CANNOT_APPROVE_OWN_FEE_PROPOSAL: "Moun ki pwopoze tarif la pa kapab apwouve pwòp pwopozisyon li.",
    FEE_PROPOSALS_UNAVAILABLE: "Istwa pwopozisyon tarif yo pa disponib; verifye migrasyon Admin Control Center la.",
    FEE_SERVICE_INVALID: "Sèvis pou tarif sa a pa valab.",
    FEE_CURRENCY_INVALID: "Deviz tarif la dwe HTG, USD oswa EUR.",
    FEE_KIND_INVALID: "Chwazi yon frè fiks oswa yon pousantaj.",
    FEE_VALUE_INVALID: "Valè frè a dwe pozitif epi li dwe gen jiska 6 desimal.",
    FEE_PERCENTAGE_TOO_HIGH: "Pousantaj frè a pa kapab depase 100%.",
    FEE_RANGE_INVALID: "Frè minimòm oswa maksimòm lan pa valab.",
    FEE_EFFECTIVE_DATE_INVALID: "Dat aplikasyon tarif la pa kapab nan tan pase.",
    FEE_NOTE_TOO_LONG: "Nòt la pa kapab depase 500 karaktè.",
    FEE_DECISION_INVALID: "Desizyon tarif la pa valab.",
    FEE_PROPOSAL_ID_INVALID: "ID pwopozisyon tarif la pa valab.",
    FEE_PROPOSAL_NOT_FOUND: "Nou pa jwenn pwopozisyon tarif sa a.",
    FEE_PROPOSAL_ALREADY_REVIEWED: "Pwopozisyon sa a deja resevwa yon desizyon.",
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
    MFA_REQUIRED: "Pou louvri modil yo, desann nan kat Verifikasyon MFA (TOTP), antre kòd 6 chif authenticator ou a epi peze Verifye MFA. Pa pataje kòd sa a ak pèsonn.",
    MFA_VERIFICATION_INCOMPLETE: "Supabase pa konfime nivo AAL2 la. Verifye kòd la ankò; pa gen okenn modil ki pral ouvri san verifikasyon sa a.",
    ANALYTICS_RANGE_INVALID: "Peryòd analiz la dwe 7, 30 oswa 90 jou.",
    ADMIN_ANALYTICS_UNAVAILABLE: "Analiz administratè a pa disponib kounye a. Verifye koneksyon bazdone a.",
    ANALYTICS_DATABASE_QUERY_FAILED: "Bazdone a pa t kapab bay done analiz yo.",
    MFA_CODE_MUST_BE_6_DIGITS: "Kòd authenticator lan dwe gen 6 chif.",
    MFA_FACTOR_NOT_ENROLLED: "Pa gen faktè authenticator. Klike Kreye / aktive MFA an premye.",
    MFA_PENDING_FACTOR_EXISTS: "Gen yon konfigirasyon authenticator ki deja an kou sou aparèy sa a. Sèvi ak kle ki te deja parèt la; pa jenere yon lòt kle.",
    MFA_FACTOR_ID_UNAVAILABLE: "Supabase pa retounen yon id faktè pou nouvo authenticator la. Pa antre kòd la; relanse dyagnostik teknik la.",
    USER_STATUS_INVALID: "Estati kont lan pa valab.",
    ADMIN_CANNOT_SUSPEND_SELF: "Ou pa kapab sispann pwòp kont administratè ou.",
    LAST_SUPER_ADMIN_PROTECTED: "Ou pa kapab sispann dènye Super administratè aktif la.",
    SUPER_ADMIN_ACCOUNT_PROTECTED: "Se sèlman yon Super administratè ki ka chanje estati yon lòt Super administratè.",
    USER_NOT_FOUND: "Kont itilizatè sa a pa egziste.",
    ADMIN_SESSION_MISMATCH: "Sesyon administratè a pa koresponn. Konekte ankò.",
    ADMIN_PIN_RESET_UNAVAILABLE: "Rekiperasyon PIN lan pa disponib kounye a. Verifye migrasyon sekirite Admin lan.",
    ADMIN_PIN_RESET_CHALLENGE_INVALID: "Demann reset PIN lan ekspire oswa pa koresponn ak sesyon an. Rekòmanse rekiperasyon an.",
    ADMIN_PIN_NOT_SET: "Pa gen PIN Admin ki anrejistre pou kont sa a.",
    MFA_FACTOR_LIMIT_REACHED: "Limit kantite authenticator sekou yo rive. Pa efase yon aparèy verifye san plan rekiperasyon.",
    CONNECT_DATABASE_UNAVAILABLE: "Tab Connect yo poko disponib. Verifye migrasyon LakayGoPay Connect la.",
    CONNECT_NOT_AVAILABLE: "LakayGoPay Connect la an poz nan Production pandan n ap mete Sandbox izole a an sekirite.",
    TEST_CREDITS_DISABLED_IN_PRODUCTION: "Kredi tès yo dezaktive nan Production. Yo ap disponib sèlman nan Sandbox izole a.",
    CONNECT_APP_NOT_FOUND: "Nou pa jwenn aplikasyon patnè sa a.",
    CONNECT_APP_NOT_PENDING: "Aplikasyon an pa nan estati pou resevwa desizyon sa a.",
    CONNECT_APP_NOT_ACTIVE: "Aplikasyon an pa aktif nan Sandbox.",
    CONNECT_APP_NOT_SUSPENDED: "Aplikasyon sa a pa sispann.",
    CONNECT_REVIEW_DECISION_INVALID: "Desizyon revizyon an pa valab.",
    CONNECT_ACTIVE_MERCHANT_OWNER_REQUIRED: "Devlopè a dwe posede yon kont machann aktif.",
    CONNECT_APP_NAME_INVALID: "Non aplikasyon an dwe gen ant 2 ak 100 karaktè.",
    CONNECT_HTTPS_URL_REQUIRED: "Adrès aplikasyon an dwe yon URL HTTPS valab.",
    CONNECT_PAYOUT_NOT_FOUND: "Demann peman an pa egziste.",
    CONNECT_PAYOUT_NOT_PENDING: "Demann sa a pa an atant ankò.",
    CONNECT_PAYOUT_EXPIRED: "Demann sa a ekspire.",
    CONNECT_PAYOUT_WALLET_UNAVAILABLE: "Bous patnè a oswa bous kliyan an pa disponib.",
    CONNECT_RECIPIENT_NOT_ACTIVE: "Kont kliyan k ap resevwa a pa aktif.",
    CONNECT_RECIPIENT_WALLET_NOT_FOUND: "Kliyan an pa gen yon bous aktif nan lajan sa a.",
    CONNECT_CAPABILITY_DENIED: "Aplikasyon sa a pa gen kapasite operasyon sa a.",
    SYSTEM_LOGS_NOT_CONFIGURED: "Logs Live poko konekte ak bazdone a. Aplike migrasyon teknik la nan Supabase pou aktive jounal la.",
    SYSTEM_LOGS_UNAVAILABLE: "Jounal Logs Live pa disponib kounye a."
  };
  return messages[code] || "Nou pa kapab trete demann ou an kounye a. Tanpri eseye ankò pita.";
}
function showLogin(message, kind = "error") {
  $("#loginView").hidden = false;
  $("#passwordRecoveryView").hidden = true;
  $("#pinView").hidden = true;
  $("#adminView").hidden = true;
  $("#refreshButton").hidden = true;
  $("#logoutButton").hidden = true;
  stopLiveLogs();
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
    const requestId = response.headers.get("x-request-id") || "";
    const friendly = response.status >= 500
      ? "Nou pa kapab trete demann ou an kounye a. Tanpri eseye ankò pita." + (requestId ? " Referans: " + requestId.slice(0, 16) : "")
      : explainError(data.error);
    const error = new Error(friendly);
    error.code = data.error;
    error.status = response.status;
    error.requestId = requestId || null;
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
  $("#passwordRecoveryView").hidden = true;
  $("#adminView").hidden = true;
  $("#pinView").hidden = false;
  $("#refreshButton").hidden = true;
  $("#logoutButton").hidden = false;
  $("#adminPinVerifyForm").hidden = true;
  $("#adminPinSetupForm").hidden = true;
  $("#adminPinRecoveryForm").hidden = true;
  $("#showPinRecoveryButton").hidden = true;
  $("#adminPinRecoveryCode").value = "";
  $("#adminPinRecoveryNew").value = "";
  $("#adminPinRecoveryConfirm").value = "";
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
      $("#showPinRecoveryButton").hidden = false;
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
  const canSeeSystemHealth = isSuper || roleSet.has("admin");
  const canSeeLogs = isSuper || ["admin", "risk_admin", "auditor"].some((role) => roleSet.has(role));
  const canSeeAnalytics = isSuper || ["admin","risk_admin","support_agent","finance_admin","accountant","auditor"].some((role) => roleSet.has(role));

  $("#adminRecordsPanel").hidden = !canSeeOperations;
  $("#adminActionsPanel").hidden = !canSeeActions;
  $("#adminUserStatusForm").hidden = !(isSuper || roleSet.has("admin") || roleSet.has("risk_admin"));
  $("#adminMerchantReviewForm").hidden = !(isSuper || roleSet.has("admin") || roleSet.has("risk_admin"));
  $("#adminWithdrawalReviewForm").hidden = !(isSuper || roleSet.has("admin") || roleSet.has("risk_admin") || roleSet.has("finance_admin"));
  $("#adminAgentReviewForm").hidden = !(isSuper || roleSet.has("admin") || roleSet.has("risk_admin"));
  $("#adminFinancePanel").hidden = !canSeeFinance;
  $("#adminTeamPanel").hidden = !isSuper;
  const canManageCardLimits = isSuper || roleSet.has("risk_admin");
  const canManageConnect = isSuper || roleSet.has("risk_admin") || roleSet.has("finance_admin");
  $("#adminCardProgramPanel").hidden = !canManageCardLimits;
  $("#adminConnectPanel").hidden = !canManageConnect;
  $("#adminSecretariatPanel").hidden = !canSeeSecretariat;
  $("#adminAnalyticsPanel").hidden = !canSeeAnalytics;
  $("#systemHealthPanel").hidden = !canSeeSystemHealth;
  $("#liveLogsPanel").hidden = !canSeeLogs;
  $("#liveLogsNav").hidden = !canSeeLogs;

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
  let mfaReady = false;
  try {
    mfaReady = await updateMfaStatus();
  } catch (mfaError) {
    setNotice("#adminMfaStatus", explainMfaError(mfaError), "error");
    mfaCanVerify = false;
    syncMfaVerifyButton();
  }

  if (!mfaReady) {
    setProtectedAdminControls(false);
    const lockMessage = "Verifye MFA TOTP anlè a pou ouvri done operasyonèl, finansye ak sekretarya yo.";
    if (canSeeFinance) setNotice("#financeNotice", lockMessage, "");
    if (isSuper) setNotice("#teamRolesNotice", lockMessage, "");
    if (canSeeSecretariat) setNotice("#secretariatNotice", lockMessage, "");
    if (canSeeOperations) setNotice("#adminRecordsNotice", lockMessage, "");
    if (canSeeAnalytics) setNotice("#analyticsNotice", lockMessage, "");
    if (canManageCardLimits) setNotice("#cardLimitNotice", lockMessage, "");
    if (canManageConnect) setNotice("#connectAppsNotice", lockMessage, "");
    if (canSeeSystemHealth) setNotice("#systemHealthNotice", lockMessage, "error");
    if (canSeeLogs) setNotice("#liveLogsNotice", "Verifikasyon MFA obligatwa anvan ou kapab konsilte Logs Live.", "error");
    setNotice("#dashboardNotice", "Aksè bazik la konfime. KPI yo ak tout done operasyonèl, finansye, ekip ak sekretarya rete kache jiskaske ou verifye TOTP nan kat “Verifikasyon MFA”.", "");
    $("#adminMfaPanel").classList.add("mfa-needs-action");
    return;
  }

  $("#adminMfaPanel").classList.remove("mfa-needs-action");
  setProtectedAdminControls(true);
  // Load each authorized module independently. Finance overview, fee history,
  // and the daily ledger report are separate APIs and must all be initialized
  // on first entry (not only after the user submits a fee proposal or clicks
  // the report refresh button).
  const moduleLoads = [];
  if (canSeeSystemHealth) moduleLoads.push(loadSystemHealth(session));
  let liveLogsReady = false;
  if (canSeeLogs) moduleLoads.push(loadLiveLogs(session).then((ready) => { liveLogsReady = ready; }));
  if (canSeeAnalytics) moduleLoads.push(loadAdminAnalytics(session));
  if (canSeeFinance) {
    moduleLoads.push(loadFinanceOverview(session));
    moduleLoads.push(loadFeeProposals(session));
    moduleLoads.push(loadDailyFinancialSummary(session));
  }
  if (isSuper) moduleLoads.push(loadTeamRoles(session));
  if (canManageCardLimits) moduleLoads.push(loadCardLimitAssignments(session));
  if (canManageConnect) moduleLoads.push(loadConnectApps(session));
  if (canSeeSecretariat) moduleLoads.push(loadSecretariatItems(session));
  await Promise.allSettled(moduleLoads);
  if (canSeeLogs && liveLogsReady) startLiveLogs(session); else stopLiveLogs();

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


function renderLiveLogs(data) {
  const body = $("#liveLogsBody");
  if (!body) return;
  body.replaceChildren();
  const logs = Array.isArray(data.logs) ? data.logs : [];
  if (!logs.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "muted";
    cell.textContent = "Pa gen pwoblèm anrejistre pou moman an.";
    row.appendChild(cell);
    body.appendChild(row);
  }
  logs.forEach((entry) => {
    const row = document.createElement("tr");
    const values = [
      entry.created_at ? new Date(entry.created_at).toLocaleString("fr-HT") : "—",
      entry.severity === "error" ? "ERÈ" : entry.severity === "warning" ? "AVÈTISMAN" : "INFO",
      entry.area || "—",
      entry.event_code || "SYSTEM_EVENT",
      [entry.method, entry.path].filter(Boolean).join(" ") || "—",
      entry.http_status ? "HTTP " + entry.http_status : "—",
      entry.request_id ? String(entry.request_id).slice(0, 16) : "—"
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      if (index === 1) cell.className = "log-level log-" + (entry.severity || "info");
      if (index === 3) cell.className = "log-event";
      if (index === 4) cell.className = "log-route";
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
  const errors = logs.filter((entry) => entry.severity === "error").length;
  const warnings = logs.filter((entry) => entry.severity === "warning").length;
  const summary = $("#liveLogsSummary");
  summary.replaceChildren();
  [[logs.length, "evènman vizib"], [errors, "erè"], [warnings, "avètisman"]].forEach(([count, label]) => {
    const item = document.createElement("span");
    const strong = document.createElement("b");
    strong.textContent = String(count);
    item.append(strong, document.createTextNode(label));
    summary.appendChild(item);
  });
  $("#liveLogsUpdatedAt").textContent = data.checked_at
    ? "Dènye mizajou: " + new Date(data.checked_at).toLocaleString("fr-HT") + " · Rafrechi otomatik chak 15 segonn."
    : "";
}

async function loadLiveLogs(session, quiet = false) {
  if (!quiet) setNotice("#liveLogsNotice", "Ap chaje dènye evènman teknik yo…", "");
  try {
    const data = await adminRequest("/api/admin/logs?limit=75", session);
    renderLiveLogs(data);
    setNotice("#liveLogsNotice", "Jounal teknik la ajou. " + (data.count || 0) + " evènman parèt.", "success");
    return true;
  } catch (error) {
    const text = error.code === "SYSTEM_LOGS_NOT_CONFIGURED"
      ? explainError(error.code)
      : error.message || explainError(error.code);
    setNotice("#liveLogsNotice", text, "error");
    return false;
  }
}

function startLiveLogs(session) {
  liveLogsSession = session;
  if (liveLogsTimer) clearInterval(liveLogsTimer);
  liveLogsTimer = setInterval(() => {
    if (!document.hidden && liveLogsSession) loadLiveLogs(liveLogsSession, true);
  }, 15000);
}

function stopLiveLogs() {
  if (liveLogsTimer) clearInterval(liveLogsTimer);
  liveLogsTimer = null;
  liveLogsSession = null;
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
function hasRecentAdminTotpSession(session, now = Date.now()) {
  const amr = decodeJwtPayload(session?.access_token)?.amr;
  if (!Array.isArray(amr)) return false;
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  return amr.some((entry) => {
    if (!entry || !["totp", "mfa/totp"].includes(entry.method)) return false;
    const timestamp = Number(entry.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
    const verifiedAt = timestamp * 1000;
    return verifiedAt <= now + 60_000 && now - verifiedAt <= maxAgeMs;
  });
}
async function currentSession() {
  const result = await supabase.auth.getSession();
  if (result.error) throw result.error;
  return result.data.session;
}
function setProtectedAdminControls(enabled) {
  const selectors = [
    "#adminAnalyticsPanel",
    "#systemHealthPanel",
    "#adminRecordsPanel",
    "#adminActionsPanel",
    "#adminFinancePanel",
    "#adminTeamPanel",
    "#adminSecretariatPanel"
  ];
  selectors.forEach((selector) => {
    const panel = $(selector);
    if (!panel) return;
    panel.querySelectorAll("button,input,select,textarea").forEach((control) => {
      control.disabled = !enabled;
    });
  });
}

function withMfaStage(error, stage) {
  const target = error instanceof Error ? error : new Error(String(error?.message || error || "MFA_OPERATION_FAILED"));
  try { target.mfaStage = stage; } catch {}
  return target;
}

async function runMfaStep(stage, operation) {
  try {
    const result = await operation();
    if (result?.error) throw result.error;
    return result;
  } catch (error) {
    throw withMfaStage(error, stage);
  }
}

function explainMfaError(error) {
  const code = String(error?.code || error?.errorCode || "").trim().toLowerCase();
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  const message = String(error?.message || "").trim();
  const messageKey = /^[A-Za-z][A-Za-z0-9_]{2,64}$/.test(message) ? message.toUpperCase() : "";
  const stage = String(error?.mfaStage || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  const raw = [code, message, error?.name].filter(Boolean).join(" ").toLowerCase();

  if (code === "admin_trust_schema_not_ready") {
    return "Bazdone pou aparèy admin rekonèt yo poko enstale. Aplike migrasyon admin_trusted_devices la nan Supabase.";
  }
  if (code === "admin_trust_unavailable") {
    return "MFA reyisi, men nou pa t kapab anrejistre aparèy sa a pou 30 jou. Verifye sèvis sekirite a epi eseye ankò.";
  }
  if (code === "mfa_factor_name_conflict") {
    return "Non authenticator sa deja egziste pou kont sa a. Nouvo enskripsyon an ap bezwen yon non inik; pa efase okenn authenticator ki deja verifye.";
  }
  if (code === "mfa_required" || messageKey === "MFA_REQUIRED") {
    return "Sèvè LakayGoPay la resevwa sesyon an kòm AAL1, li poko wè konfimasyon MFA AAL2. Sa pa pwouve kòd la pa bon. Rekonekte yon sèl fwa, epi teste ankò. Etap: " + (stage || "MFA_SESSION") + ".";
  }
  if (code === "mfa_verification_failed" ||
      /invalid.*(otp|totp|token|code)|(otp|totp|token|code).*invalid/.test(raw)) {
    return "Kòd authenticator la pa kòrèk oswa li ekspire. Tann nouvo kòd 6 chif la parèt epi antre l.";
  }
  if (code === "mfa_challenge_expired") {
    return "Demann MFA a ekspire. Rekòmanse verifikasyon an pou kreye yon nouvo demann.";
  }
  if (code === "mfa_totp_verify_not_enabled") {
    return "Supabase Production pa aktive verifikasyon TOTP. Verifye Authentication > Multi-Factor Authentication.";
  }
  if (code === "mfa_totp_enroll_not_enabled") {
    return "Supabase Production pa aktive enskripsyon TOTP. Verifye Authentication > Multi-Factor Authentication.";
  }
  if (code === "mfa_ip_address_mismatch") {
    return "Adrès entènèt la chanje ant kreyasyon MFA ak verifikasyon an. Kenbe menm koneksyon an epi rekòmanse.";
  }
  if (code === "mfa_verification_rejected") {
    return "Règ sekirite MFA Supabase la refize verifikasyon an. Verifye MFA Verification Hook nan Authentication > Hooks.";
  }
  if (code === "mfa_factor_not_found" || /factor.*(not found|not verified)|not.*factor/.test(raw)) {
    return "Authenticator sa a pa koresponn ak yon faktè aktif ankò. Pa efase lòt authenticator verifye yo.";
  }
  if (code === "too_many_enrolled_mfa_factors" || /factor.*limit|maximum.*factor|too many factors/.test(raw)) {
    return "Limit kantite authenticator sekou yo rive. Pa efase okenn aparèy verifye san plan rekiperasyon.";
  }
  if (code === "over_request_rate_limit" || status === 429 || /rate|too many|attempt/.test(raw)) {
    return "Gen twòp demann verifikasyon. Tann kèk minit anvan yon lòt tantativ.";
  }
  if (code === "conflict") {
    return "Sesyon sekirite a antre an konfli pandan li t ap renouvle. Rekonekte yon sèl fwa, epi teste ankò.";
  }
  if (code === "unexpected_failure" || status >= 500) {
    return "Sèvis Auth Supabase la rankontre yon erè sèvè. Etap: " + (stage || "MFA_AUTH") + ".";
  }
  if (status === 403 || status === 501) {
    return "Supabase refize operasyon MFA sa a. Etap: " + (stage || "MFA_AUTH") + " · HTTP " + status + ".";
  }

  const diagnostic = code || messageKey || (status ? "HTTP_" + status : String(error?.name || "UNKNOWN_MFA_ERROR").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40));
  return "Verifikasyon MFA a echwe nan etap " + (stage || "MFA_UNKNOWN") + ". Dyagnostik: " + diagnostic + ". Pa pataje kòd authenticator ou.";
}
function syncMfaVerifyButton() {
  const button = $("#adminMfaVerifyButton");
  const input = $("#adminMfaCode");
  if (!button || !input) return;
  // A temporary factor-list failure must not disable the only MFA control.
  // Let Supabase return the actual factor/challenge error after submission.
  const code = input.value.trim();
  button.disabled = !/^\d{6}$/.test(code) || button.dataset.verifying === "true";
}
function mfaFactorStorageKey(purpose) {
  return purpose === "backup" ? ADMIN_MFA_BACKUP_FACTOR_STORAGE_KEY : ADMIN_MFA_FACTOR_STORAGE_KEY;
}

function readAdminMfaFactorBinding(userId, purpose = "primary") {
  try {
    const binding = JSON.parse(localStorage.getItem(mfaFactorStorageKey(purpose)) || "null");
    if (!binding || binding.userId !== userId || binding.projectRef !== supabaseProjectRef) return null;
    return typeof binding.factorId === "string" && binding.factorId ? binding : null;
  } catch { return null; }
}

function saveAdminMfaFactorBinding(userId, factorId, status, friendlyName, purpose = "primary") {
  if (!userId || !factorId) throw new Error("MFA_FACTOR_ID_UNAVAILABLE");
  adminMfaActiveFactorId = factorId;
  const binding = {
    userId, projectRef: supabaseProjectRef, factorId,
    purpose: purpose === "backup" ? "backup" : "primary",
    status: status === "verified" ? "verified" : "unverified",
    friendlyName: String(friendlyName || (purpose === "backup" ? "LakayGoPay Admin Backup" : "LakayGoPay Admin")).slice(0, 80),
    updatedAt: new Date().toISOString()
  };
  try { localStorage.setItem(mfaFactorStorageKey(purpose), JSON.stringify(binding)); } catch {}
  return binding;
}

function clearAdminMfaFactorBinding(purpose = "primary") {
  try { localStorage.removeItem(mfaFactorStorageKey(purpose)); } catch {}
  if (purpose === "primary" && adminMfaActiveFactorId) adminMfaActiveFactorId = null;
}

function clearAdminMfaSetupMaterial() {
  const secret = $("#adminMfaSecret");
  if (secret) { secret.textContent = ""; delete secret.dataset.secret; }
  const qr = $("#adminMfaQrImage");
  if (qr) { qr.removeAttribute("src"); qr.hidden = true; }
  const wrap = $("#adminMfaQrWrap");
  if (wrap) wrap.hidden = true;
  const copy = $("#adminMfaCopySecret");
  if (copy) copy.disabled = true;
}

function renderAdminMfaSetup(data, userId, purpose) {
  const factorId = String(data?.id || "").trim();
  const secret = String(data?.totp?.secret || "").trim();
  if (!factorId || !secret) throw new Error("MFA_FACTOR_ID_UNAVAILABLE");
  const friendlyName = String(data.friendly_name || (purpose === "backup" ? "LakayGoPay Admin Backup" : "LakayGoPay Admin"));
  saveAdminMfaFactorBinding(userId, factorId, "unverified", friendlyName, purpose);

  const secretNode = $("#adminMfaSecret");
  secretNode.textContent = secret;
  secretNode.dataset.secret = secret;
  $("#adminMfaCopySecret").disabled = false;

  const qr = $("#adminMfaQrImage");
  const qrCode = String(data?.totp?.qr_code || "");
  if (qrCode.startsWith("data:image/") || qrCode.startsWith("<svg")) {
    qr.src = qrCode.startsWith("<svg") ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrCode) : qrCode;
    qr.hidden = false;
  } else { qr.removeAttribute("src"); qr.hidden = true; }

  $("#adminMfaQrWrap").hidden = false;
  $("#adminMfaStatus").textContent = "Nouvo authenticator la kreye. Eskane QR la oswa antre kle manyèl la. Apre sa, antre kòd 6 chif aktyèl la pou verifye.";
  $("#adminMfaCode").focus();
}

async function updateMfaStatus() {
  mfaCanVerify = false;
  syncMfaVerifyButton();
  const session = await currentSession();
  if (!session?.user?.id) throw new Error("AUTH_REQUIRED");

  let currentLevel = decodeJwtPayload(session.access_token)?.aal || "aal1";
  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) throw assurance.error;
  currentLevel = assurance.data?.currentLevel || currentLevel;
  const aal2 = currentLevel === "aal2" && hasRecentAdminTotpSession(session);

  let totpFactors = [];
  let factorLookupError = null;
  const factorsResult = await supabase.auth.mfa.listFactors();
  if (factorsResult.error) factorLookupError = factorsResult.error;
  else totpFactors = Array.isArray(factorsResult.data?.totp) ? factorsResult.data.totp : [];

  const activeFactorIds = new Set(totpFactors.map((factor) => factor.id));
  const savedPrimaryBinding = readAdminMfaFactorBinding(session.user.id, "primary");
  const savedBackupBinding = readAdminMfaFactorBinding(session.user.id, "backup");
  if (!factorLookupError && savedPrimaryBinding && !activeFactorIds.has(savedPrimaryBinding.factorId)) {
    clearAdminMfaFactorBinding("primary");
  }
  if (!factorLookupError && savedBackupBinding && !activeFactorIds.has(savedBackupBinding.factorId)) {
    clearAdminMfaFactorBinding("backup");
  }
  const primaryBinding = savedPrimaryBinding &&
    (factorLookupError || activeFactorIds.has(savedPrimaryBinding.factorId)) ? savedPrimaryBinding : null;
  const backupBinding = savedBackupBinding &&
    (factorLookupError || activeFactorIds.has(savedBackupBinding.factorId)) ? savedBackupBinding : null;
  if (primaryBinding) adminMfaActiveFactorId = primaryBinding.factorId;

  const verifiedFactors = totpFactors.filter((factor) => factor.status === "verified");
  const pendingFactors = totpFactors.filter((factor) => factor.status === "unverified");

  // A remembered browser only substitutes for a fresh prompt while at least
  // one verified TOTP factor still exists in Supabase. If all factors were
  // removed or factor discovery failed, do not honor the device cookie.
  let trustedDevice = null;
  if (!factorLookupError && verifiedFactors.length > 0) {
    try {
      const trustResponse = await fetch("/api/admin/mfa/trust", {
        headers: { accept: "application/json", authorization: "Bearer " + session.access_token },
        cache: "no-store"
      });
      if (trustResponse.ok) {
        const trustData = await trustResponse.json().catch(() => ({}));
        if (trustData.trusted === true && trustData.expires_at) trustedDevice = trustData;
      }
    } catch {
      // Without a confirmed server-side trust record, normal MFA remains required.
    }
  }
  if (trustedDevice) {
    const expiry = new Date(trustedDevice.expires_at).toLocaleDateString("fr-HT", {
      year: "numeric", month: "long", day: "numeric"
    });
    $("#adminMfaBadge").textContent = "MFA konfime · Aparèy rekonèt";
    $("#adminMfaBadge").className = "read-only-tag mfa-active";
    $("#adminMfaStatus").textContent = "MFA te verifye sou aparèy sa a. Ou pap bezwen antre yon lòt kòd anvan " + expiry + ". Aksyon ki pi sansib yo ka toujou mande yon verifikasyon fre.";
    const enroll = $("#adminMfaEnrollButton");
    if (enroll) { enroll.disabled = true; enroll.textContent = "Authenticator prensipal verifye"; }
    const backup = $("#adminMfaBackupEnrollButton");
    if (backup) backup.disabled = true;
    $("#adminMfaVerifyButton").textContent = "Verifye MFA kounye a (opsyonèl)";
    mfaCanVerify = true;
    syncMfaVerifyButton();
    $("#adminLedgerAuditButton").disabled = false;
    return true;
  }
  const primaryVerified = verifiedFactors.length > 0 || primaryBinding?.status === "verified";
  const primaryPending = primaryBinding?.status === "unverified";
  const backupVerified = backupBinding?.status === "verified" ||
    verifiedFactors.some((factor) => factor.id === backupBinding?.factorId);
  const backupPending = backupBinding?.status === "unverified";
  const hasVerified = primaryVerified || backupVerified;
  const hasPending = primaryPending || backupPending || pendingFactors.length > 0;

  const selector = $("#adminMfaFactorSelect");
  if (selector) {
    const previous = selector.value;
    selector.replaceChildren();
    const optionsById = new Map();
    totpFactors.forEach((factor) => optionsById.set(factor.id, factor));
    // Only offer IDs that Supabase currently returns; never challenge a stale browser binding.
    const options = [...optionsById.values()];
    options.forEach((factor, index) => {
      const option = document.createElement("option");
      option.value = factor.id;
      option.textContent = (factor.friendly_name || factor.friendlyName || ("Authenticator " + (index + 1))) +
        (factor.status === "verified" ? " · verifye" : " · an atant");
      selector.append(option);
    });
    const chosen = options.find((factor) => factor.id === previous) ||
      options.find((factor) => factor.id === adminMfaActiveFactorId) ||
      options.find((factor) => factor.id === primaryBinding?.factorId) ||
      verifiedFactors[0] || pendingFactors[0] || options[0];
    if (chosen) selector.value = chosen.id;
    $("#adminMfaFactorLabel").hidden = options.length < 2;
  }

  $("#adminMfaBadge").textContent = aal2 ? "MFA verifye · AAL2" : "MFA obligatwa";
  $("#adminMfaBadge").className = aal2 ? "read-only-tag mfa-active" : "read-only-tag";
  $("#adminMfaStatus").textContent = aal2
    ? (backupVerified
        ? "Authenticator prensipal ak aparèy sekou ou verifye. Sesyon Admin sa a konfime nan nivo AAL2."
        : "Authenticator prensipal la verifye. Sesyon Admin sa a konfime nan nivo AAL2.")
    : primaryPending || backupPending
      ? "Gen yon konfigirasyon authenticator ki poko fini. Sèvi ak menm kle ki te parèt la epi antre kòd 6 chif li bay la."
      : primaryVerified
        ? "Authenticator prensipal la aktif. Ou kapab ajoute yon authenticator sekou apre sesyon an rive AAL2."
        : hasVerified
          ? "Yon authenticator aktif. Antre kòd 6 chif aktyèl la epi verifye MFA."
          : hasPending
            ? "Gen faktè MFA ki poko verifye. Chwazi aparèy la epi antre kòd 6 chif li bay la."
            : factorLookupError
              ? "Nou pa kapab li lis authenticator yo. Pa jenere yon lòt kle jiskaske dyagnostik la konfime koneksyon an."
              : "Pa gen authenticator ki disponib sou sesyon sa a. Kreye yon nouvo authenticator pou kòmanse.";

  const enrollButton = $("#adminMfaEnrollButton");
  enrollButton.textContent = primaryVerified ? "Authenticator prensipal verifye" :
    primaryPending ? "Konfigirasyon prensipal la deja kòmanse" : "Kreye nouvo authenticator";
  enrollButton.disabled = primaryVerified || primaryPending || Boolean(factorLookupError);

  const backup = $("#adminMfaBackupEnrollButton");
  if (backup) {
    backup.hidden = !primaryVerified || backupVerified || totpFactors.length >= 10;
    backup.disabled = !aal2 || backupPending || totpFactors.length >= 10;
    backup.title = !aal2 ? "Verifye authenticator prensipal la anvan ou ajoute yon aparèy sekou." :
      backupPending ? "Konfigirasyon authenticator sekou a deja kòmanse; fini verifikasyon li." :
        totpFactors.length >= 10 ? "Limit kantite authenticator Supabase yo rive." :
          "Ajoute yon aparèy authenticator sekou san retire prensipal la.";
  }

  mfaCanVerify = Boolean(primaryBinding?.factorId || backupBinding?.factorId || totpFactors.length);
  syncMfaVerifyButton();
  $("#adminMfaVerifyButton").textContent = aal2 ? "Verifye ankò" : "Verifye MFA";
  $("#adminMfaVerifyButton").title = mfaCanVerify ? "Antre nouvo kòd 6 chif aktyèl la." : "Kreye authenticator la an premye.";
  $("#adminLedgerAuditButton").disabled = !aal2;
  return aal2;
}
async function runAdminMfaDiagnostics() {
  const button = $("#adminMfaDiagnosticsButton");
  const output = $("#adminMfaDiagnostics");
  if (!button || !output || !supabase) return;
  button.disabled = true;
  output.textContent = "Ap li enfòmasyon sesyon ak Auth yo san chanje okenn done…";
  try {
    const sr = await supabase.auth.getSession();
    if (sr.error) throw sr.error;
    const session = sr.data?.session;
    if (!session?.user?.id) throw new Error("AUTH_REQUIRED");
    const [ur, fr, ar] = await Promise.all([
      supabase.auth.getUser(), supabase.auth.mfa.listFactors(), supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    ]);
    if (ur.error) throw ur.error;
    const user = ur.data?.user || {};
    const factors = fr.error ? [] : (Array.isArray(fr.data?.totp) ? fr.data.totp : []);
    const storedPrimary = readAdminMfaFactorBinding(session.user.id, "primary");
    const storedBackup = readAdminMfaFactorBinding(session.user.id, "backup");
    output.textContent = [
      "Pwojè Supabase Production: " + supabaseProjectRef,
      "Imèl sesyon an: " + (session.user.email || "Pa disponib"),
      "Imèl Auth konfime: " + (user.email || "Pa disponib"),
      "ID sesyon ak Auth koresponn: " + (user.id === session.user.id ? "WI" : "NON / PA DISPONIB"),
      "AAL aktyèl: " + (ar.data?.currentLevel || "unknown"),
      "Faktè TOTP nan listFactors(): " + factors.length,
      "Faktè sou pwofil Auth: " + (Array.isArray(user.factors) ? user.factors.length : "pa disponib"),
      "Verifye: " + factors.filter((f) => f.status === "verified").length +
        " · An atant: " + factors.filter((f) => f.status === "unverified").length,
      "Authenticator prensipal sou aparèy sa a: " + (storedPrimary ? storedPrimary.status : "pa anrejistre"),
      "Authenticator sekou sou aparèy sa a: " + (storedBackup ? storedBackup.status : "pa aktive"),
      "Erè lis faktè: " + (fr.error?.code || "ok"),
      "Tan dyagnostik: " + new Date().toLocaleString("fr-HT")
    ].join("\n");
  } catch (error) {
    const code = String(error?.code || error?.name || "DIAGNOSTIC_FAILED").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60);
    output.textContent = "Dyagnostik la pa fini. Kòd: " + (code || "DIAGNOSTIC_FAILED");
  } finally { button.disabled = false; }
}
function uniqueMfaFriendlyName(baseName) {
  // Supabase requires each MFA factor for one user to have a distinct friendly name.
  // Use a fresh suffix for every enrollment, including repeated enrollments on one day.
  const suffix = globalThis.crypto?.randomUUID?.() ||
    (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
  return baseName + " " + suffix;
}

async function enrollAdminMfa() {
  const session = await currentSession();
  if (!session?.user?.id) throw new Error("AUTH_REQUIRED");
  const result = await runMfaStep("FACTOR_DISCOVERY", () => supabase.auth.mfa.listFactors());
  const factors = Array.isArray(result.data?.totp) ? result.data.totp : [];
  const stored = readAdminMfaFactorBinding(session.user.id, "primary");
  const verified = factors.find((factor) => factor.status === "verified");
  const pending = factors.find((factor) => factor.status === "unverified");

  if (verified || stored?.status === "verified") {
    $("#adminMfaStatus").textContent = "Authenticator prensipal la deja verifye. Sèvi ak li; pa kreye yon lòt aparèy prensipal.";
    return;
  }
  if (stored?.status === "unverified") {
    adminMfaActiveFactorId = stored.factorId;
    throw new Error("MFA_PENDING_FACTOR_EXISTS");
  }
  if (pending) {
    saveAdminMfaFactorBinding(session.user.id, pending.id, "unverified", pending.friendly_name, "primary");
    adminMfaActiveFactorId = pending.id;
    throw new Error("MFA_PENDING_FACTOR_EXISTS");
  }
  const { data } = await runMfaStep("TOTP_ENROLL", () => supabase.auth.mfa.enroll({
    factorType: "totp", friendlyName: uniqueMfaFriendlyName("LakayGoPay Admin Primary")
  }));
  renderAdminMfaSetup(data, session.user.id, "primary");
}
async function enrollAdminMfaBackup() {
  const session = await currentSession();
  if (!session?.user?.id) throw new Error("AUTH_REQUIRED");
  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) throw assurance.error;
  if (assurance.data?.currentLevel !== "aal2") throw new Error("MFA_REQUIRED");

  const primary = readAdminMfaFactorBinding(session.user.id, "primary");
  const backup = readAdminMfaFactorBinding(session.user.id, "backup");
  const result = await runMfaStep("BACKUP_FACTOR_DISCOVERY", () => supabase.auth.mfa.listFactors());
  const factors = Array.isArray(result.data?.totp) ? result.data.totp : [];
  const verifiedFactors = factors.filter((factor) => factor.status === "verified");
  const pendingFactors = factors.filter((factor) => factor.status === "unverified");
  const primaryVerified = primary?.status === "verified" || verifiedFactors.length > 0;

  if (!primaryVerified) throw new Error("MFA_FACTOR_NOT_ENROLLED");
  if (backup?.status === "verified") {
    $("#adminMfaStatus").textContent = "Authenticator sekou a deja verifye. Li rete separe ak authenticator prensipal la.";
    return;
  }
  if (backup?.status === "unverified") throw new Error("MFA_PENDING_FACTOR_EXISTS");
  if (pendingFactors.length) {
    const pending = pendingFactors[0];
    saveAdminMfaFactorBinding(session.user.id, pending.id, "unverified", pending.friendly_name, "backup");
    adminMfaActiveFactorId = pending.id;
    throw new Error("MFA_PENDING_FACTOR_EXISTS");
  }
  if (factors.length >= 10) throw new Error("MFA_FACTOR_LIMIT_REACHED");

  const { data } = await runMfaStep("BACKUP_TOTP_ENROLL", () => supabase.auth.mfa.enroll({
    factorType: "totp", friendlyName: uniqueMfaFriendlyName("LakayGoPay Admin Backup")
  }));
  renderAdminMfaSetup(data, session.user.id, "backup");
}
async function completeTotpVerification(factorId, code) {
  if (!factorId || !/^\d{6}$/.test(code)) throw new Error("MFA_CODE_MUST_BE_6_DIGITS");
  // Challenge the exact factor ID returned by Supabase enroll(). listFactors()
  // is only a user-profile projection and must not block the challenge.
  const selectedFactorId = String(factorId);
  setNotice("#adminMfaStatus", "Etap 2/3: authenticator la jwenn. Ap kreye demann verifikasyon an…", "");
  const challenge = await runMfaStep("TOTP_CHALLENGE", () => supabase.auth.mfa.challenge({ factorId: selectedFactorId }));
  setNotice("#adminMfaStatus", "Etap 3/3: demann lan kreye. Ap verifye kòd 6 chif la…", "");
  const verified = await runMfaStep("TOTP_VERIFY", () => supabase.auth.mfa.verify({
    factorId: selectedFactorId,
    challengeId: challenge.data.id,
    code
  }));

  // The MFA verify response/session storage is the source of truth here.
  // Do not force a second refresh-token exchange immediately after verification:
  // refresh tokens are single-use and overlapping exchanges can invalidate a session.
  const session = verified.data?.session || (await runMfaStep("SESSION_AFTER_VERIFY", () => currentSession()));
  if (!session?.access_token) {
    throw withMfaStage(new Error("MFA_VERIFICATION_INCOMPLETE"), "SESSION_AFTER_VERIFY");
  }

  const serverData = await runMfaStep("SERVER_AAL2_CHECK", async () => {
    const serverCheck = await fetch("/api/admin/me", {
      headers: { accept: "application/json", authorization: "Bearer " + session.access_token },
      cache: "no-store"
    });
    const data = await serverCheck.json().catch(() => ({}));
    if (!serverCheck.ok) {
      const failure = new Error(data.error || "ADMIN_MFA_SERVER_CHECK_FAILED");
      failure.status = serverCheck.status;
      throw failure;
    }
    if (data.aal2 !== true || data.is_admin !== true) {
      throw new Error(data.is_admin !== true ? "ADMIN_ACCOUNT_NOT_CONFIRMED" : "AAL2_NOT_CONFIRMED");
    }
    return data;
  });
  await runMfaStep("TRUSTED_DEVICE_REGISTER", async () => {
    const response = await fetch("/api/admin/mfa/trust", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: "Bearer " + session.access_token
      },
      credentials: "same-origin",
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true || data.trusted !== true) {
      const failure = new Error(data.error || "ADMIN_TRUST_UNAVAILABLE");
      failure.status = response.status;
      throw failure;
    }
    return data;
  });

  const userId = session.user?.id || decodeJwtPayload(session.access_token)?.sub;
  if (userId) {
    const primary = readAdminMfaFactorBinding(userId, "primary");
    const backup = readAdminMfaFactorBinding(userId, "backup");
    const purpose = backup?.factorId === selectedFactorId ? "backup" : "primary";
    const known = purpose === "backup" ? backup : primary;
    saveAdminMfaFactorBinding(userId, selectedFactorId, "verified", known?.friendlyName ||
      (purpose === "backup" ? "LakayGoPay Admin Backup" : "LakayGoPay Admin Primary"), purpose);
  }
  return session;
}

async function verifyAdminMfa() {
  const code = $("#adminMfaCode").value.trim();
  if (!/^\d{6}$/.test(code)) throw new Error("MFA_CODE_MUST_BE_6_DIGITS");
  setNotice("#adminMfaStatus", "Ap idantifye yon authenticator aktif nan Supabase…", "");
  const session = await currentSession();
  if (!session?.user?.id) throw new Error("AUTH_REQUIRED");

  // Supabase's live factor list is authoritative. localStorage only remembers
  // the user's preferred factor; it must never supply an ID on its own.
  const factorResult = await runMfaStep("FACTOR_DISCOVERY", () => supabase.auth.mfa.listFactors());
  const factors = Array.isArray(factorResult.data?.totp) ? factorResult.data.totp : [];
  const usableFactors = factors.filter((factor) =>
    factor && typeof factor.id === "string" &&
    (factor.status === "verified" || factor.status === "unverified")
  );
  const factorIds = new Set(usableFactors.map((factor) => factor.id));
  const primaryBinding = readAdminMfaFactorBinding(session.user.id, "primary");
  const backupBinding = readAdminMfaFactorBinding(session.user.id, "backup");
  if (primaryBinding && !factorIds.has(primaryBinding.factorId)) clearAdminMfaFactorBinding("primary");
  if (backupBinding && !factorIds.has(backupBinding.factorId)) clearAdminMfaFactorBinding("backup");

  const selectedId = $("#adminMfaFactorSelect")?.value;
  let factor = usableFactors.find((item) => item.id === selectedId) ||
    usableFactors.find((item) => item.id === primaryBinding?.factorId) ||
    usableFactors.find((item) => item.id === backupBinding?.factorId) ||
    usableFactors.find((item) => item.status === "verified") ||
    usableFactors.find((item) => item.status === "unverified");
  if (!factor) throw withMfaStage(new Error("MFA_FACTOR_NOT_ENROLLED"), "FACTOR_RESOLUTION");

  const purpose = backupBinding?.factorId === factor.id ? "backup" : "primary";
  saveAdminMfaFactorBinding(
    session.user.id,
    factor.id,
    factor.status,
    factor.friendly_name,
    purpose
  );
  await completeTotpVerification(factor.id, code);
  $("#adminMfaCode").value = "";
  clearAdminMfaSetupMaterial();
  let ready = false;
  try { ready = await updateMfaStatus(); }
  catch (error) { throw withMfaStage(error, "ASSURANCE_REFRESH"); }
  if (!ready) throw withMfaStage(new Error("AAL2_NOT_CONFIRMED"), "ASSURANCE_REFRESH");
  setNotice("#adminMfaStatus", "MFA verifye. Aparèy sa a rete rekonèt pandan 30 jou.", "success");
  setNotice("#adminActionNotice", "MFA verifye. Aksyon admin ki pi sansib yo toujou mande verifikasyon fre.", "success");
  await refreshCurrent();
}

function renderAnalyticsBreakdown(selector, rows, emptyLabel) {
  const container = $(selector);
  if (!container) return;
  container.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "muted small";
    empty.textContent = emptyLabel || "Pa gen done nan peryòd la.";
    container.append(empty);
    return;
  }
  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "analytics-breakdown-row";
    const label = document.createElement("span");
    label.textContent = row.label;
    const value = document.createElement("strong");
    value.textContent = Number(row.count || 0).toLocaleString("fr-HT");
    item.append(label, value);
    container.append(item);
  });
}

function renderGrowthChart(rows, emptyMessage = "") {
  const svg = $("#adminGrowthChart");
  if (!svg) return false;

  const ns = "http://www.w3.org/2000/svg";
  const width = 900;
  const height = 280;
  const left = 52;
  const right = 24;
  const top = 22;
  const bottom = 44;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  // Give the SVG its own reliable dimensions and dark background. This keeps
  // the chart readable even if a browser or CDN serves stale/incomplete CSS.
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.style.display = "block";
  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.style.minHeight = "190px";
  svg.style.backgroundColor = "#071b2a";
  svg.style.borderRadius = "12px";

  const make = (tag, attrs, parent = svg) => {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    });
    parent.append(node);
    return node;
  };

  make("rect", {
    x: 0, y: 0, width, height, rx: 12,
    fill: "#071b2a"
  });

  const title = make("title", {});
  title.textContent = "Evolisyon itilizatè ak aktivite sèvis";
  const description = make("desc", {});
  description.textContent = "Grafik sou nouvo kont ak kantite tranzaksyon sèvis ki deja poste.";

  const series = [
    { key: "registrations", label: "Nouvo kont", color: "#f0c276" },
    { key: "service_transactions", label: "Tranzaksyon sèvis poste", color: "#63d8c5" }
  ];

  const sourceRows = Array.isArray(rows) ? rows : [];
  const cleanRows = sourceRows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const clean = { date: String(row.date || "") };
      series.forEach((item) => {
        const value = Number(row[item.key]);
        clean[item.key] = Number.isFinite(value) && value > 0 ? value : 0;
      });
      return clean;
    });

  if (!cleanRows.length) {
    const message = make("text", {
      x: width / 2,
      y: height / 2,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      fill: "#c3d6e2",
      "font-size": 15,
      "font-family": "Inter, system-ui, sans-serif"
    });
    message.textContent = emptyMessage || "Pa gen done pou peryòd sa a.";
    return true;
  }

  const maxValue = Math.max(
    1,
    ...cleanRows.flatMap((row) => series.map((item) => row[item.key]))
  );

  for (let tick = 0; tick <= 4; tick += 1) {
    const y = top + (plotHeight * tick / 4);
    make("line", {
      x1: left, y1: y, x2: width - right, y2: y,
      stroke: "rgba(169,203,222,0.22)",
      "stroke-width": 1
    });
    const label = make("text", {
      x: left - 10,
      y: y + 4,
      "text-anchor": "end",
      fill: "#a9c0cf",
      "font-size": 11,
      "font-family": "Inter, system-ui, sans-serif"
    });
    label.textContent = Math.round(maxValue * (4 - tick) / 4).toLocaleString("fr-HT");
  }

  const xFor = (index) => left + (
    cleanRows.length === 1
      ? plotWidth / 2
      : plotWidth * index / (cleanRows.length - 1)
  );
  const yFor = (value) => top + plotHeight - (value / maxValue) * plotHeight;

  series.forEach((item) => {
    const points = cleanRows
      .map((row, index) => xFor(index) + "," + yFor(row[item.key]))
      .join(" ");

    make("polyline", {
      points,
      fill: "none",
      stroke: item.color,
      "stroke-width": 3,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
      "vector-effect": "non-scaling-stroke"
    });

    cleanRows.forEach((row, index) => {
      if (cleanRows.length <= 30 || index % Math.ceil(cleanRows.length / 30) === 0) {
        const point = make("circle", {
          cx: xFor(index),
          cy: yFor(row[item.key]),
          r: 3.4,
          fill: item.color,
          stroke: "#071b2a",
          "stroke-width": 1.5
        });
        const tooltip = make("title", {}, point);
        tooltip.textContent = item.label + " · " +
          (row.date || "Dat san dat") + " · " +
          row[item.key].toLocaleString("fr-HT");
      }
    });
  });

  const labelCount = Math.min(6, cleanRows.length);
  for (let index = 0; index < labelCount; index += 1) {
    const rowIndex = labelCount === 1
      ? 0
      : Math.round(index * (cleanRows.length - 1) / (labelCount - 1));
    const date = cleanRows[rowIndex].date;
    const label = make("text", {
      x: xFor(rowIndex),
      y: height - 14,
      "text-anchor": "middle",
      fill: "#a9c0cf",
      "font-size": 10,
      "font-family": "Inter, system-ui, sans-serif"
    });
    label.textContent = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date.slice(5).replace("-", "/")
      : (date || "—");
  }

  return true;
}

async function loadAdminAnalytics(session) {
  const days = Number($("#analyticsDays")?.value || 30);
  setNotice("#analyticsNotice", "Ap chaje evolisyon kont ak itilizasyon sèvis yo…", "");
  try {
    const data = await adminRequest("/api/admin/analytics?days=" + days, session);
    const summary = data.summary || {};
    const format = (value) => {
      if (value === null || value === undefined) return "N/D";
      const number = Number(value);
      return Number.isFinite(number) ? number.toLocaleString("fr-HT") : "N/D";
    };

    $("#analyticsRegistered").textContent = format(summary.registered_users);
    $("#analyticsNewUsers").textContent = format(summary.new_registrations);
    $("#analyticsActiveAccounts").textContent = format(summary.active_accounts);
    $("#analyticsInactiveAccounts").textContent = format(summary.non_active_accounts);
    $("#analyticsServiceUsers").textContent = format(summary.users_with_service);
    $("#analyticsServiceTransactions").textContent = format(summary.service_transactions);
    $("#analyticsMerchants").textContent = format(summary.merchants_total);
    $("#analyticsActiveMerchants").textContent = format(summary.active_merchants);

    renderGrowthChart(data.timeline, "Pa gen done pou peryòd sa a.");
    renderAnalyticsBreakdown("#analyticsAccountStatuses", [
      { label: "Aktif", count: summary.active_accounts },
      { label: "Limite", count: summary.restricted_accounts },
      { label: "Sispann", count: summary.suspended_accounts },
      { label: "Fèmen", count: summary.closed_accounts }
    ]);
    renderAnalyticsBreakdown(
      "#analyticsServiceBreakdown",
      Array.isArray(data.service_breakdown) ? data.service_breakdown : [],
      "Pa gen tranzaksyon sèvis ki poste nan peryòd la."
    );

    $("#analyticsGeneratedAt").textContent = data.generated_at
      ? "Dènye kalkil: " + new Date(data.generated_at).toLocaleString("fr-HT") + " · Zòn lè: Ayiti"
      : "";

    const note = data.notes?.truncated
      ? "Done yo chaje an pati (limit sekirite 10 000 liy). Peryòd la ka mande yon rapò agregasyon SQL lè platfòm lan grandi."
      : "Analiz " + days + " jou chaje. Grafik la montre nouvo kont ak tranzaksyon sèvis ki deja poste. Kantite itilizatè inik ki fè tranzaksyon rete N/D paske Production pa estoke yon aktè verifye sou chak antre ledger.";
    setNotice("#analyticsNotice", note, data.notes?.truncated ? "error" : "success");
  } catch (error) {
    const message = explainError(error.code || error.message);
    setNotice("#analyticsNotice", message, "error");
    [
      "#analyticsRegistered", "#analyticsNewUsers", "#analyticsActiveAccounts",
      "#analyticsInactiveAccounts", "#analyticsServiceUsers",
      "#analyticsServiceTransactions", "#analyticsMerchants",
      "#analyticsActiveMerchants"
    ].forEach((selector) => {
      const element = $(selector);
      if (element) element.textContent = "N/D";
    });
    renderGrowthChart([], "Grafik la pa disponib kounye a. Rafrechi paj la oswa verifye sèvis analiz la.");
    renderAnalyticsBreakdown("#analyticsAccountStatuses", [], "Done estati pa disponib.");
    renderAnalyticsBreakdown("#analyticsServiceBreakdown", [], "Done sèvis pa disponib.");
  }
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
      proposal.maximum_fee != null ? "Max: " + proposal.maximum_fee : "",
      proposal.reviewed_at ? "Desizyon: " + new Date(proposal.reviewed_at).toLocaleString("fr-HT") : ""
    ].filter(Boolean).join(" · ");
    const note = document.createElement("p");
    note.textContent = proposal.proposal_note || "";
    if (proposal.decision_note) note.textContent += (note.textContent ? " · " : "") + "Nòt desizyon: " + proposal.decision_note;
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
    td.colSpan = 8;
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
      Number(item.test_transaction_count || 0).toLocaleString("fr-HT"),
      Number(item.real_transaction_count || 0).toLocaleString("fr-HT"),
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
      "Rapò " + days + " jou chaje. Sous: ledger immutable. Tranzaksyon tès ak tranzaksyon nòmal separe; revni konte sèlman kredi sou kont ledger tip revenue.",
      "success");
  } catch (error) {
    renderDailySummary([]);
    setNotice("#dailySummaryNotice", explainError(error.code || error.message), "error");
  }
}


const CARD_TIER_LABELS = { BASIC:"LakayGo Basic", STANDARD:"LakayGo Mwayèn", GOLD:"LakayGo Gold", ELITE_GOLD:"LakayGo Elite Gold" };
function renderCardLimitAssignments(rows) {
  const body=$("#cardLimitAssignmentsBody");body.replaceChildren();
  if(!rows.length){const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=7;cell.textContent="Pa gen plafon kat ki apwouve pou kounye a.";row.append(cell);body.append(row);return;}
  rows.forEach(item=>{
    const row=document.createElement("tr");
    const name=document.createElement("td");name.textContent=item.full_name||"San non";
    const id=document.createElement("td");id.textContent=item.user_id||"—";
    const limit=document.createElement("td");limit.textContent=Number(item.approved_limit_htg||0).toLocaleString("fr-HT",{minimumFractionDigits:2,maximumFractionDigits:2})+" HTG";
    const tier=document.createElement("td");tier.textContent=CARD_TIER_LABELS[item.tier_code]||item.tier_code||"—";
    const stars=document.createElement("td");const level=Math.max(0,Math.min(3,Number(item.star_level)||0));stars.textContent="★".repeat(level)+"☆".repeat(3-level);
    const updated=document.createElement("td");updated.textContent=item.updated_at?new Date(item.updated_at).toLocaleString("fr-HT"):"—";
    const action=document.createElement("td"),choose=document.createElement("button");choose.type="button";choose.className="button button-quiet admin-row-action";choose.textContent="Chwazi";
    choose.addEventListener("click",()=>{$("#cardLimitUserId").value=item.user_id;$("#cardLimitAmount").value=item.approved_limit_htg;$("#cardLimitUserId").focus();$("#cardLimitAssignmentForm").scrollIntoView({behavior:"smooth",block:"center"});});
    action.append(choose);row.append(name,id,limit,tier,stars,updated,action);body.append(row);
  });
}

function renderConnectApps(rows) {
  const list = $("#connectAppsList");
  if (!list) return;
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "muted small";
    empty.textContent = "Pa gen aplikasyon patnè ki soumèt pou kounye a.";
    list.append(empty);
    return;
  }
  rows.forEach((app) => {
    const card = document.createElement("article");
    card.className = "surface-card";
    card.style.marginTop = "12px";
    const heading = document.createElement("h3");
    heading.textContent = app.app_name || "Aplikasyon san non";
    const merchant = Array.isArray(app.merchants) ? app.merchants[0] : app.merchants;
    const info = document.createElement("p");
    info.className = "muted small";
    info.textContent = "Machann: " + (merchant?.business_name || app.merchant_id) +
      " · Pwopriyetè ID: " + app.owner_user_id + " · Sit: " + app.website_url;
    const state = document.createElement("p");
    state.className = "muted small";
    state.textContent = "Estati: " + app.status.toUpperCase() + " · Mòd: " + app.mode.toUpperCase() +
      " · Kapasite: " + (Array.isArray(app.capabilities) ? app.capabilities.join(", ") : "—");
    card.append(heading, info, state);
    if (app.review_note) {
      const note = document.createElement("p");
      note.className = "muted small";
      note.textContent = "Dènye nòt: " + app.review_note;
      card.append(note);
    }
    const actions = document.createElement("div");
    actions.className = "admin-action-grid";
    const options = app.status === "pending" ? [
      ["approve","Apwouve pou Sandbox"], ["reject","Rejte aplikasyon"]
    ] : app.status === "active" ? [
      ["suspend","Sispann aksè"]
    ] : app.status === "suspended" ? [
      ["reactivate","Reaktive nan Sandbox"]
    ] : [];
    options.forEach(([decision,label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button " + (decision === "reject" || decision === "suspend" ? "button-quiet" : "button-primary");
      button.textContent = label;
      button.dataset.connectDecision = decision;
      button.dataset.connectAppId = app.id;
      actions.append(button);
    });
    if (actions.childElementCount) card.append(actions);
    list.append(card);
  });
}
async function loadConnectApps(session) {
  setNotice("#connectAppsNotice", "Ap chaje aplikasyon patnè yo…", "");
  try {
    const data = await adminRequest("/api/admin/connect/apps", session);
    const rows = Array.isArray(data.apps) ? data.apps : [];
    renderConnectApps(rows);
    setNotice("#connectAppsNotice", rows.length + " aplikasyon patnè jwenn. Apwobasyon yo bay aksè Sandbox sèlman.", "success");
  } catch (error) {
    renderConnectApps([]);
    setNotice("#connectAppsNotice", explainError(error.code || error.message), "error");
  }
}

async function loadCardLimitAssignments(session){
  setNotice("#cardLimitNotice","Ap chaje plafon kliyan ak klasman yo…","");
  try{const data=await adminRequest("/api/admin/cards/limits",session);const rows=Array.isArray(data.assignments)?data.assignments:[];renderCardLimitAssignments(rows);setNotice("#cardLimitNotice",rows.length+" plafon HTG klase otomatikman. Chanjman yo antre nan audit.","success");}
  catch(error){renderCardLimitAssignments([]);setNotice("#cardLimitNotice",explainError(error.code||error.message),"error");}
}
function filterTeamRoles() {
  const query = ($("#teamUserSearch")?.value || "").trim().toLowerCase();
  document.querySelectorAll("#teamUsersBody tr").forEach((row) => {
    row.hidden = query.length > 0 && !row.textContent.toLowerCase().includes(query);
  });
}

async function loadTeamRoles(session) {
  setNotice("#teamRolesNotice", "Ap chaje lis ekip la…", "");
  try {
    const data = await adminRequest("/api/admin/team/roles", session);
    teamDirectoryRows = Array.isArray(data.users) ? data.users : [];
    const body = $("#teamUsersBody");
    body.replaceChildren();
    teamDirectoryRows.forEach((user) => {
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
      button.textContent = "Chwazi wòl";
      button.addEventListener("click", () => {
        $("#teamTargetUserId").value = user.id;
        $("#teamRoleForm").scrollIntoView({ behavior: "smooth", block: "center" });
      });
      const secretaryButton = document.createElement("button");
      secretaryButton.type = "button";
      secretaryButton.className = "button button-quiet admin-row-action";
      secretaryButton.textContent = "Chwazi sekretè";
      secretaryButton.disabled = !(user.roles || []).includes("secretary");
      secretaryButton.addEventListener("click", () => { $("#secretaryAssistantUserId").value = user.id; });
      action.append(button, secretaryButton);
      row.append(name, id, roles, status, action);
      body.append(row);
    });
    filterTeamRoles();
    setNotice("#teamRolesNotice", teamDirectoryRows.length + " kont deja anrejistre disponib pou bay oswa retire wòl. Super Admin sèlman ka fè chanjman.", "success");
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
    ["id","ID tranzaksyon"],["transaction_type","Kalite"],["status","Estati"],["entries","Ekriti debit/kredi"],["created_at","Dat"]
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


function showPasswordRecoveryRequest() {
  const form = $("#passwordRecoveryRequestForm");
  form.hidden = !form.hidden;
  if (!form.hidden) {
    $("#passwordRecoveryEmail").value = $("#emailInput").value.trim();
    $("#passwordRecoveryEmail").focus();
  }
}

async function handlePasswordRecoveryRedirect() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const isImplicitRecovery = hashParams.get("type") === "recovery";
  const isPkceCallback = Boolean(queryParams.get("code"));
  if (!isImplicitRecovery && !isPkceCallback) return false;

  let result;
  if (isImplicitRecovery) {
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (!accessToken || !refreshToken) {
      showLogin("Lyen rekiperasyon sa a enkonplè oswa li ekspire. Mande yon lòt lyen.", "error");
      return true;
    }
    result = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
  } else {
    // Supabase PKCE links return ?code=... and require the verifier kept in
    // the same browser storage context that requested the recovery email.
    result = await supabase.auth.exchangeCodeForSession(queryParams.get("code"));
  }

  if (result.error || !result.data?.session) {
    showLogin("Lyen rekiperasyon an ekspire, li deja itilize, oswa li louvri nan yon lòt navigatè. Mande yon nouvo lyen epi louvri li nan menm navigatè a.", "error");
    return true;
  }
  window.history.replaceState({}, document.title, window.location.pathname);
  $("#loginView").hidden = true;
  $("#pinView").hidden = true;
  $("#adminView").hidden = true;
  $("#passwordRecoveryView").hidden = false;
  $("#recoveryPassword").focus();
  return true;
}

async function openAdminPinRecovery() {
  $("#adminPinVerifyForm").hidden = true;
  $("#adminPinSetupForm").hidden = true;
  $("#adminPinRecoveryForm").hidden = false;
  $("#adminPinRecoveryCode").value = "";
  $("#adminPinRecoveryNew").value = "";
  $("#adminPinRecoveryConfirm").value = "";
  const selector = $("#adminPinRecoveryFactor");
  selector.replaceChildren();
  try {
    const factorsResult = await supabase.auth.mfa.listFactors();
    if (factorsResult.error) throw factorsResult.error;
    const verified = (factorsResult.data?.totp || []).filter((factor) => factor.status === "verified");
    if (!verified.length) {
      $("#adminPinRecoveryHelp").textContent = "Pa gen authenticator TOTP verifye sou kont sa a. Pou sekirite, aplikasyon an pa pèmèt reset PIN san MFA. Ou dwe itilize pwosedi rekiperasyon idantite ki verifye pa responsab sistèm nan.";
      $("#adminPinRecoverySubmit").disabled = true;
      return;
    }
    verified.forEach((factor, index) => {
      const option = document.createElement("option");
      option.value = factor.id;
      option.textContent = factor.friendly_name || ("Authenticator verifye " + (index + 1));
      selector.append(option);
    });
    $("#adminPinRecoverySubmit").disabled = false;
    $("#adminPinRecoveryHelp").textContent = "Reset la mande yon kòd nan youn nan authenticator TOTP ki deja verifye. Se pa yon chemen pou sote MFA.";
    $("#adminPinRecoveryCode").focus();
  } catch (error) {
    $("#adminPinRecoverySubmit").disabled = true;
    setNotice("#pinNotice", explainMfaError(error), "error");
  }
}

async function submitAdminPinRecovery(event) {
  event.preventDefault();
  const factorId = $("#adminPinRecoveryFactor").value;
  const code = $("#adminPinRecoveryCode").value.trim();
  const pin = $("#adminPinRecoveryNew").value;
  const confirm = $("#adminPinRecoveryConfirm").value;
  const button = $("#adminPinRecoverySubmit");
  const weakPins = new Set([
    "000000","111111","222222","333333","444444","555555","666666","777777","888888","999999",
    "123456","234567","345678","456789","654321","543210","432109","987654","121212","112233","123123"
  ]);
  if (!/^\d{6}$/.test(pin) || weakPins.has(pin)) {
    setNotice("#pinNotice", "Nouvo PIN lan dwe gen 6 chif epi li pa dwe yon sekans fasil pou devine.", "error");
    return;
  }
  if (pin !== confirm) {
    setNotice("#pinNotice", "De nouvo PIN yo pa koresponn.", "error");
    return;
  }
  button.disabled = true;
  try {
    setNotice("#pinNotice", "Ap verifye authenticator la epi prepare reset PIN lan…", "");
    const session = await completeTotpVerification(factorId, code);
    const challengeData = await adminRequest("/api/admin/pin/reset-challenge", session, {});
    const derivedBytes = await deriveAdminPinHashBytes(pin, challengeData.salt, challengeData.iterations);
    let pinHash;
    try {
      pinHash = pinBytesToHex(derivedBytes);
    } finally {
      derivedBytes.fill(0);
    }
    const response = await signAdminPinChallenge(pin, challengeData);
    await adminRequest("/api/admin/pin/reset", session, {
      challenge: challengeData.challenge,
      pin_hash: pinHash,
      response
    });
    $("#adminPinRecoveryCode").value = "";
    $("#adminPinRecoveryNew").value = "";
    $("#adminPinRecoveryConfirm").value = "";
    adminPinVerifiedUserId = session.user.id;
    pinGateSession = session;
    setNotice("#pinNotice", "PIN Admin lan reset avèk MFA verifye. Ap ouvri sant kontwòl la…", "success");
    await loadOverview(session);
  } catch (error) {
    setNotice("#pinNotice", explainError(error.code || error.message) +
      (error.diagnostic ? " (Dyagnostik: " + error.diagnostic + ")" : ""), "error");
  } finally {
    button.disabled = false;
  }
}

async function requestPasswordRecovery(event) {
  event.preventDefault();
  const email = $("#passwordRecoveryEmail").value.trim().toLowerCase();
  if (!email) return;
  const button = $("#passwordRecoveryRequestButton");
  button.disabled = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL("/admin/", window.location.origin).toString()
    });
    if (error) throw error;
    setNotice("#loginNotice", "Si imèl la koresponn ak yon kont, yon lyen rekiperasyon ap voye. Tcheke bwat resepsyon ak spam ou. Apre chanjman modpas la, PIN Admin ak MFA ap toujou obligatwa.", "success");
    $("#passwordRecoveryRequestForm").hidden = true;
  } catch {
    setNotice("#loginNotice", "Nou pa kapab voye lyen an kounye a. Verifye sèvis imel Supabase ak URL redireksyon Admin lan.", "error");
  } finally {
    button.disabled = false;
  }
}

async function saveRecoveredPassword(event) {
  event.preventDefault();
  const password = $("#recoveryPassword").value;
  const confirmation = $("#recoveryPasswordConfirm").value;
  if (password.length < 12) {
    setNotice("#passwordRecoveryNotice", "Nouvo modpas la dwe gen omwen 12 karaktè.", "error");
    return;
  }
  if (password !== confirmation) {
    setNotice("#passwordRecoveryNotice", "De modpas yo pa koresponn.", "error");
    return;
  }
  const button = $("#passwordRecoverySaveButton");
  button.disabled = true;
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    $("#recoveryPassword").value = "";
    $("#recoveryPasswordConfirm").value = "";
    await supabase.auth.signOut();
    $("#passwordRecoveryView").hidden = true;
    showLogin("Modpas la chanje avèk siksè. Konekte ankò, epi sèvi ak PIN Admin ak MFA TOTP ou.", "success");
  } catch {
    setNotice("#passwordRecoveryNotice", "Chanjman modpas la echwe oswa lyen an ekspire. Mande yon nouvo lyen rekiperasyon.", "error");
  } finally {
    button.disabled = false;
  }
}

function buildAdminNavigationGroups() {
  const adminView = $("#adminView");
  const nav = $(".admin-quick-nav");
  if (!adminView || !nav || nav.dataset.grouped === "true") return;

  const groups = [
    { id: "adminGroupOverview", title: "Apèsi ak analiz", open: true, nodes: ["adminOverviewHeading", "adminDashboardMetrics", "adminAnalyticsPanel"] },
    { id: "adminGroupOperations", title: "Operasyon ak revizyon", open: false, nodes: ["adminRecordsPanel", "adminActionsPanel", "adminCardProgramPanel", "adminConnectPanel"] },
    { id: "adminGroupFinance", title: "Finans ak rapò", open: false, nodes: ["dailyFlowPanel", "adminFinancePanel"] },
    { id: "adminGroupSecurity", title: "Sekirite ak siveyans", open: false, nodes: ["systemHealthPanel", "liveLogsPanel", "adminControlRulesPanel"] },
    { id: "adminGroupTeam", title: "Ekip ak sekretarya", open: false, nodes: ["adminTeamPanel", "adminSecretariatPanel"] }
  ];

  for (const group of groups) {
    const nodes = group.nodes.map((id) => document.getElementById(id))
      .filter((node) => node && node.parentElement === adminView);
    if (!nodes.length) continue;
    const details = document.createElement("details");
    details.id = group.id;
    details.className = "admin-workspace-group";
    details.open = group.open;
    const summary = document.createElement("summary");
    summary.textContent = group.title;
    details.append(summary);
    const first = nodes.reduce((earliest, node) =>
      earliest.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING ? earliest : node
    );
    adminView.insertBefore(details, first);
    nodes.forEach((node) => details.append(node));
  }

  nav.dataset.grouped = "true";
  nav.addEventListener("click", (event) => {
    const link = event.target.closest("a[href^='#adminGroup']");
    if (!link) return;
    const target = document.querySelector(link.getAttribute("href"));
    if (target && target.tagName === "DETAILS") target.open = true;
  });
}
async function boot() {
  buildAdminNavigationGroups();
  const configResponse = await fetch("/api/config", { headers: { accept: "application/json" }, cache: "no-store" });
  const config = await configResponse.json().catch(() => ({}));
  if (!configResponse.ok || !config.configured || !config.supabaseUrl || !config.publishableKey) {
    setNotice("#loginNotice", "Koneksyon backend lan poko pare.", "error");
    return;
  }

  // Admin session is isolated from the customer/merchant app and the PIN
  // verification flag is memory-only, so a page reload asks for the PIN again.
  try {
    const configHost = new URL(config.supabaseUrl).hostname.toLowerCase();
    supabaseProjectRef = configHost.endsWith(".supabase.co")
      ? configHost.replace(/\.supabase\.co$/, "")
      : configHost;
  } catch {
    supabaseProjectRef = "invalid-supabase-url";
  }

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

  $("#forgotPasswordButton").addEventListener("click", showPasswordRecoveryRequest);
  $("#passwordRecoveryRequestForm").addEventListener("submit", requestPasswordRecovery);
  $("#passwordRecoveryForm").addEventListener("submit", saveRecoveredPassword);
  $("#showPinRecoveryButton").addEventListener("click", openAdminPinRecovery);
  $("#adminPinRecoveryForm").addEventListener("submit", submitAdminPinRecovery);

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

  $("#adminMfaDiagnosticsButton")?.addEventListener("click", runAdminMfaDiagnostics);

  $("#adminMfaCopySecret")?.addEventListener("click", async () => {
    const secret = $("#adminMfaSecret")?.dataset.secret || "";
    if (!secret) {
      setNotice("#adminMfaStatus", "Pa gen kle konfigirasyon ki disponib pou kopye.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(secret);
      setNotice("#adminMfaStatus", "Kle a kopye. Kole l nan Google Authenticator, chwazi Time based, epi pa pataje kle sa a.", "success");
    } catch {
      setNotice("#adminMfaStatus", "Kopi otomatik la pa disponib sou navigatè sa a. Ou ka chwazi epi kopye kle ki parèt la manyèlman.", "error");
    }
  });

  $("#adminMfaEnrollButton").addEventListener("click", async () => {
    const button = $("#adminMfaEnrollButton");
    button.disabled = true;
    try {
      await enrollAdminMfa();
    } catch (error) {
      setNotice("#adminMfaStatus", explainMfaError(error), "error");
    } finally {
      const aal2 = await updateMfaStatus().catch(() => false);
      const session = await currentSession().catch(() => null);
      const pending = session?.user?.id && readAdminMfaFactorBinding(session.user.id, "primary")?.status === "unverified";
      button.disabled = aal2 || Boolean(pending);
      syncMfaVerifyButton();
    }
  });

  $("#adminMfaBackupEnrollButton").addEventListener("click", async () => {
    const button = $("#adminMfaBackupEnrollButton");
    button.disabled = true;
    try {
      await enrollAdminMfaBackup();
    } catch (error) {
      setNotice("#adminMfaStatus", explainMfaError(error), "error");
    } finally {
      await updateMfaStatus().catch(() => false);
    }
  });

  $("#adminMfaCode").addEventListener("input", (event) => {
    event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, 6);
    syncMfaVerifyButton();
  });

  // Form submission handles both a tap and the keyboard Enter key.
  // It does not depend on the background listFactors result to enable the control.
  $("#adminMfaVerifyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#adminMfaVerifyButton");
    const code = $("#adminMfaCode").value.trim();
    if (!/^\d{6}$/.test(code)) {
      setNotice("#adminMfaStatus", explainMfaError({ code: "MFA_CODE_MUST_BE_6_DIGITS" }), "error");
      syncMfaVerifyButton();
      return;
    }
    let failureMessage = "";
    button.dataset.verifying = "true";
    syncMfaVerifyButton();
    setNotice("#adminMfaStatus", "Ap verifye authenticator la ak sèvè sekirite a…", "");
    try {
      await verifyAdminMfa();
    } catch (error) {
      failureMessage = explainMfaError(error);
    } finally {
      button.dataset.verifying = "false";
      if (failureMessage) {
        await updateMfaStatus().catch(() => {
          mfaCanVerify = false;
        });
        setNotice("#adminMfaStatus", failureMessage, "error");
      } else {
        syncMfaVerifyButton();
      }
    }
  });

  document.querySelectorAll("[data-record-type]").forEach((button) => {
    button.addEventListener("click", () => loadAdminRecords(button.dataset.recordType));
  });
  $("#adminRecordsRefresh").addEventListener("click", () => {
    const active = document.querySelector("[data-record-type].active");
    loadAdminRecords(active?.dataset.recordType || "users");
  });
  $("#analyticsRefresh").addEventListener("click", async () => {
    const session = await currentSession();
    if (session) await loadAdminAnalytics(session);
  });
  $("#analyticsDays").addEventListener("change", async () => {
    const session = await currentSession();
    if (session) await loadAdminAnalytics(session);
  });
  $("#teamUserSearch").addEventListener("input", filterTeamRoles);
  $("#cardLimitRefresh").addEventListener("click",async()=>{const session=await currentSession();if(session)await loadCardLimitAssignments(session);});
  $("#cardLimitAssignmentForm").addEventListener("submit",async(event)=>{
    event.preventDefault();
    const userId=$("#cardLimitUserId").value.trim(),amount=$("#cardLimitAmount").value.trim(),reason=$("#cardLimitReason").value.trim();
    if(!userId||amount===""||reason.length<10){setNotice("#cardLimitNotice","Antre ID kliyan an, plafon HTG a ak yon rezon ki gen omwen 10 karaktè.","error");return;}
    if(!window.confirm("Ou konfime plafon HTG sa a baze sou verifikasyon KYC ak sous fon kliyan an? Sistèm nan pral bay klasman ak etwal otomatikman."))return;
    const button=$("#cardLimitSubmit");button.disabled=true;
    try{
      const session=await requireMfaForAdminAction();if(!session)return;
      const result=await adminRequest("/api/admin/cards/limits",session,{target_user_id:userId,approved_limit_htg:amount,reason});
      const a=result.assignment||{};
      setNotice("#cardLimitNotice",(CARD_TIER_LABELS[a.tier_code]||a.tier_code||"Klasman")+" · "+Number(a.approved_limit_htg||amount).toLocaleString("fr-HT")+" HTG · "+"★".repeat(Number(a.star_level||0))+" klase epi anrejistre nan audit.","success");
      $("#cardLimitReason").value="";await loadCardLimitAssignments(session);
    }catch(error){setNotice("#cardLimitNotice",explainError(error.code||error.message),"error");if(error.code==="MFA_REQUIRED")setNotice("#adminMfaStatus","Sesyon MFA a ekspire. Verifye TOTP ankò.","error");}
    finally{button.disabled=false;}
  });



  $("#connectAppsRefresh").addEventListener("click", async () => {
    const session = await currentSession();
    if (session) await loadConnectApps(session);
  });
  $("#connectAppsList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-connect-decision]");
    if (!button) return;
    const appId = button.dataset.connectAppId;
    const decision = button.dataset.connectDecision;
    const labels = {
      approve: "apwouve aplikasyon sa a pou Sandbox",
      reject: "rejte aplikasyon sa a",
      suspend: "sispann aksè aplikasyon sa a",
      reactivate: "reaktive aplikasyon sa a nan Sandbox"
    };
    if (!window.confirm("Ou konfime desizyon sa a: " + (labels[decision] || decision) + "?")) return;
    const note = window.prompt("Nòt revizyon (opsyonèl):", "") || "";
    button.disabled = true;
    try {
      const session = await requireMfaForAdminAction();
      if (!session) return;
      await adminRequest("/api/admin/connect/apps", session, {
        app_id: appId, decision, note: note.slice(0,500)
      });
      setNotice("#connectAppsNotice", "Desizyon an anrejistre avèk tras audit.", "success");
      await loadConnectApps(session);
    } catch (error) {
      setNotice("#connectAppsNotice", explainError(error.code || error.message), "error");
      if (error.code === "MFA_REQUIRED") setNotice("#adminMfaStatus", "Sesyon MFA a ekspire. Verifye TOTP ankò.", "error");
    } finally {
      button.disabled = false;
    }
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
      const data = await adminRequest("/api/admin/ledger/audits", session);
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

  $("#liveLogsRefresh").addEventListener("click", async () => {
    const session = await currentSession();
    if (session) await loadLiveLogs(session);
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
    stopLiveLogs();
    clearAdminMfaSetupMaterial();
    adminMfaActiveFactorId = null;
    adminPinVerifiedUserId = null;
    pinGateSession = null;
    await supabase.auth.signOut();
    showLogin("Ou dekonekte nan sant kontwòl la.", "success");
  });

  const recoveryRedirect = await handlePasswordRecoveryRedirect();
  if (recoveryRedirect) return;

  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.data && sessionResult.data.session) {
    await showPinGate(sessionResult.data.session);
  } else {
    showLogin("");
  }
}

boot().catch(() => setNotice("#loginNotice", "Sant kontwòl la pa kapab kòmanse kounye a.", "error"));
