import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const randomKey = () => crypto.randomUUID();
const configResponse = await fetch("/api/config", { headers: { accept: "application/json" } });
const config = configResponse.ok ? await configResponse.json() : { configured: false };

const style = document.createElement("style");
style.textContent = `
#lgp-launch{position:fixed;z-index:99990;right:16px;bottom:16px;border:0;border-radius:999px;padding:13px 18px;background:#073b58;color:#fff;font:700 13px system-ui;box-shadow:0 10px 30px #06283b55;cursor:pointer}
#lgp-panel{position:fixed;z-index:99991;right:16px;bottom:72px;width:min(520px,calc(100vw - 24px));max-height:min(82vh,850px);overflow:auto;background:#f7fafc;color:#183447;border:1px solid #cfdae2;border-radius:18px;box-shadow:0 18px 55px #061e2f55;font:13px system-ui}
#lgp-panel[hidden]{display:none}#lgp-panel *{box-sizing:border-box}#lgp-panel header{position:sticky;top:0;z-index:2;background:#073b58;color:#fff;padding:15px 17px;display:flex;justify-content:space-between;align-items:center;gap:12px}#lgp-panel header strong{font-size:15px}#lgp-panel button{border:0;border-radius:9px;padding:9px 12px;background:#087fa5;color:white;font:650 12px system-ui;cursor:pointer}#lgp-panel button.secondary{background:#e4edf2;color:#163c52}#lgp-panel button.danger{background:#a83e48}#lgp-panel button:disabled{opacity:.5;cursor:wait}#lgp-body{padding:13px;display:grid;gap:12px}#lgp-panel .card{background:white;border:1px solid #e0e8ee;border-radius:12px;padding:12px;display:grid;gap:9px}#lgp-panel .card h3{font-size:13px;margin:0;color:#073b58}#lgp-panel p{margin:0;line-height:1.5;color:#607586;font-size:11px}#lgp-panel label{display:grid;gap:4px;font-size:11px;color:#566d7d}#lgp-panel input,#lgp-panel select{width:100%;min-width:0;border:1px solid #d5e0e7;border-radius:8px;padding:9px 10px;background:#fff;color:#183447;font:12px system-ui}#lgp-panel .row{display:grid;grid-template-columns:1fr 1fr;gap:8px}#lgp-panel .actions{display:flex;flex-wrap:wrap;gap:7px}#lgp-panel .muted{font-size:10px;color:#778996}#lgp-panel .status{padding:9px 10px;border-radius:8px;background:#e8f4f7;color:#0a5871;font-size:11px;white-space:pre-wrap;word-break:break-word}#lgp-panel .status.error{background:#fff0ef;color:#9b3030}#lgp-panel .status.success{background:#e8f6ef;color:#176747}#lgp-log{max-height:145px;overflow:auto;background:#102e40;color:#d5edf3;border-radius:9px;padding:10px;white-space:pre-wrap;word-break:break-word;font:10px/1.5 ui-monospace,monospace}#lgp-qr img{max-width:180px;background:#fff;padding:7px;border:1px solid #e5ebef;border-radius:8px}#lgp-panel .wide{grid-column:1/-1}
#lgp-pin-card{margin-top:16px;padding:18px;border:1px solid #d8e4ea;border-radius:14px;background:#fff;display:grid;gap:12px}
#lgp-pin-card h3{margin:0;color:#073b58;font-size:18px}
#lgp-pin-card p{margin:0;color:#607586;line-height:1.5;font-size:13px}
#lgp-pin-card label{display:grid;gap:6px;font-size:13px;color:#345}
#lgp-pin-card input{width:100%;max-width:260px;padding:12px;border:1px solid #cbd9e1;border-radius:9px;font-size:20px;letter-spacing:8px}
#lgp-pin-card button{justify-self:start;border:0;border-radius:9px;padding:11px 16px;background:#087fa5;color:#fff;font-weight:700}
#lgp-pin-card button.secondary{background:#e4edf2;color:#163c52}
#lgp-pin-status{padding:10px;border-radius:8px;background:#eef4f7;color:#345;font-size:13px;white-space:pre-wrap}
#lgp-pin-status.error{background:#fff0ef;color:#9b3030}
#lgp-pin-status.success{background:#e8f6ef;color:#176747}
@media(max-width:520px){#lgp-launch{right:10px;bottom:10px}#lgp-panel{right:6px;bottom:62px;width:calc(100vw - 12px);max-height:85vh}#lgp-panel .row{grid-template-columns:1fr}}
`;
document.head.append(style);

const launch = document.createElement("button");
launch.id = "lgp-launch";
launch.type = "button";
launch.textContent = "Konekte / Kont LakayGoPay";
document.body.append(launch);

const panel = document.createElement("section");
panel.id = "lgp-panel";
panel.hidden = true;
panel.innerHTML = `
  <header><div><strong>LakayGoPay — tès backend</strong><p style="color:#c7e0e9;margin-top:3px">Mòd verifikasyon · pa gen lajan reyèl</p></div><button id="lgp-close" class="secondary" type="button">Fèmen</button></header>
  <div id="lgp-body">
    <div id="lgp-config-status" class="status">Chèk konfigirasyon…</div>
    <div id="lgp-auth-card" class="card">
      <h3>Konekte oswa kreye kont</h3>
      <label>Non konplè (pou nouvo kont)<input id="lgp-full-name" autocomplete="name" maxlength="100"></label>
      <label>Imèl<input id="lgp-email" type="email" autocomplete="email" required></label>
      <label>Modpas<input id="lgp-password" type="password" autocomplete="current-password" minlength="8"></label>
      <div class="actions"><button data-action="signup">Kreye kont</button><button class="secondary" data-action="login">Konekte</button><button class="secondary" data-action="send-otp">Voye kòd imèl</button></div>
      <label>Kòd OTP imèl<input id="lgp-otp" inputmode="numeric" autocomplete="one-time-code" maxlength="8"></label>
      <div class="actions"><button data-action="verify-otp">Verifye kòd</button><button class="secondary" data-action="recover">Reprann kont</button></div>
      <label>Telefòn ak kòd peyi<input id="lgp-phone" type="tel" autocomplete="tel" placeholder="+509XXXXXXXX"></label>
      <label>Kòd OTP SMS<input id="lgp-sms-otp" inputmode="numeric" autocomplete="one-time-code" maxlength="8"></label>
      <div class="actions"><button data-action="send-sms-otp">Voye OTP SMS</button><button class="secondary" data-action="verify-sms-otp">Verifye OTP SMS</button></div>
      <label>Nouvo modpas (apre lyen rekiperasyon)<input id="lgp-new-password" type="password" minlength="8" autocomplete="new-password"></label>
      <button class="secondary" data-action="update-password">Mete nouvo modpas</button>
      <p>OTP pa imèl sèvi pou tès la. OTP pa SMS bezwen yon founisè SMS ki aktive nan Supabase epi li ka koute lajan.</p>
    </div>
    <div id="lgp-account-card" class="card" hidden>
      <h3>Kont aktif</h3><div id="lgp-user-label" class="status"></div>
      <div class="actions"><button data-action="load-account">Verifye pwofil ak bous</button><button data-action="admin-check" class="secondary">Verifye dwa admin</button><button data-action="logout" class="danger">Dekonekte</button></div>
      <div id="lgp-admin-status" class="status">Dwa admin poko verifye.</div>
    </div>
    <div id="lgp-mfa-card" class="card" hidden>
      <h3>MFA TOTP (obligatwa pou aksyon admin)</h3>
      <p>Enskri yon aplikasyon otantifikatè (pa egzanp Google Authenticator oswa Aegis), epi verifye kòd 6 chif la.</p>
      <button data-action="enroll-mfa">Kreye faktè MFA</button>
      <div id="lgp-mfa-qr"></div>
      <label>Kòd MFA<input id="lgp-mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8"></label>
      <button data-action="verify-mfa">Verifye MFA</button>
    </div>
    <div id="lgp-wallet-card" class="card" hidden>
      <h3>Bous ak done ki soti nan backend</h3><div id="lgp-wallet-list" class="status">Pa gen done chaje.</div>
      <p class="muted">Pou teste transfè ki reyisi, bous moun k ap voye a dwe gen lajan tès ki antre nan ledger la. Pa kreye balans nan navigatè a.</p>
    </div>
    <div id="lgp-merchant-card" class="card" hidden>
      <h3>Espas machann</h3>
      <label>Non biznis<input id="lgp-business-name" maxlength="120"></label>
      <label>Kalite biznis<select id="lgp-business-type"><option value="sole_proprietor">Antrepriz endividyèl</option><option value="company">Konpayi</option><option value="cooperative">Kowoperativ</option><option value="nonprofit">Òganizasyon san bi likratif</option><option value="other">Lòt</option></select></label>
      <button data-action="merchant-register">Enskri machann</button>
      <label>ID machann<input id="lgp-merchant-id" placeholder="UUID machann"></label>
      <div class="row"><label>Montan QR (HTG)<input id="lgp-qr-amount" type="number" min="0.01" step="0.01" value="100"></label><label>Deskripsyon<input id="lgp-qr-description" maxlength="140" value="Tès peman entèn"></label></div>
      <button data-action="create-qr">Kreye demann QR</button><div id="lgp-qr"></div>
    </div>
    <div id="lgp-transfer-card" class="card" hidden>
      <h3>Transfè entèn</h3>
      <label>Bous moun k ap voye a<select id="lgp-sender-wallet"></select></label>
      <label>ID bous destinatè<input id="lgp-recipient-wallet" placeholder="UUID bous destinatè"></label>
      <label>Montan (HTG)<input id="lgp-transfer-amount" type="number" min="0.01" step="0.01" value="25"></label>
      <label>Nòt<input id="lgp-transfer-note" maxlength="140"></label>
      <button data-action="transfer">Teste transfè</button>
    </div>
    <div id="lgp-pay-card" class="card" hidden>
      <h3>Peye yon QR</h3>
      <label>Token QR<input id="lgp-qr-token" placeholder="UUID ki nan QR la"></label>
      <button class="secondary" data-action="lookup-qr">Verifye demann QR</button>
      <label>Bous k ap peye a<select id="lgp-payer-wallet"></select></label>
      <label>Montan (kite vid si QR la gen montan fiks)<input id="lgp-pay-amount" type="number" min="0.01" step="0.01"></label>
      <button data-action="pay-qr">Konfime peman entèn</button><div id="lgp-qr-details" class="status">Pa gen demann chwazi.</div>
    </div>
    <div id="lgp-withdraw-card" class="card" hidden>
      <h3>Demann retrè (pa gen peman deyò)</h3>
      <label>Bous<select id="lgp-withdraw-wallet"></select></label>
      <div class="row"><label>Montan HTG<input id="lgp-withdraw-amount" type="number" min="0.01" step="0.01"></label><label>Destinasyon<select id="lgp-withdraw-type"><option value="moncash">MonCash</option><option value="natcash">NatCash</option><option value="bank">Bank</option><option value="cash_agent">Ajan lajan kach</option><option value="other">Lòt</option></select></label></div>
      <label>Referans destinasyon (opsyonèl; chiffres sou sèvè)<input id="lgp-withdraw-reference" autocomplete="off"></label>
      <button data-action="withdraw">Soumèt demann retrè</button>
      <p>Demann lan rezève kantite lajan an. Apwobasyon pa voye lajan; entegrasyon founisè a poko aktive.</p>
    </div>
    <div id="lgp-admin-card" class="card" hidden>
      <h3>Zòn administrasyon</h3>
      <label>Bous pou kredi tès (HTG)<input id="lgp-test-wallet-id" placeholder="UUID bous itilizatè a"></label>
      <label>Montan kredi tès<input id="lgp-test-credit-amount" type="number" min="0.01" step="0.01" value="500"></label>
      <button data-action="test-credit">Kredi tès (TEST sèlman)</button>
      <p>Disponib sèlman nan pwojè tès la apre super-admin aktive test_mode_enabled. Pa aktive l nan pwodiksyon.</p>
      <label>ID demann retrè<input id="lgp-withdrawal-id" placeholder="UUID demann retrè"></label>
      <div class="row"><label>Desizyon<select id="lgp-withdrawal-decision"><option value="approved">Apwouve</option><option value="rejected">Rejte</option></select></label><label>Kòmantè<input id="lgp-withdrawal-comment" maxlength="500"></label></div>
      <button data-action="withdrawal-decision">Anrejistre desizyon (MFA)</button>
      <label>ID machann pou revize<input id="lgp-review-merchant-id" placeholder="UUID machann"></label>
      <label>Nouvo estati<select id="lgp-review-status"><option value="under_review">An revizyon</option><option value="active">Aktif</option><option value="rejected">Rejte</option><option value="suspended">Sispann</option></select></label>
      <button data-action="merchant-review">Mete estati machann (MFA)</button>
      <button class="secondary" data-action="ledger-audit">Verifye entegrite ledger (MFA)</button>
    </div>
    <div id="lgp-result" class="status">Pare pou tès.</div>
    <div id="lgp-log">Jounal tès LakayGoPay pare.</div>
  </div>`;
document.body.append(panel);

// Ajoute les vrais contrôles PIN dans l'écran Sécurité existant.
const securityView = $("#view-security");
if (securityView && !$("#lgp-pin-card")) {
  const pinCard = document.createElement("article");
  pinCard.id = "lgp-pin-card";
  pinCard.innerHTML = `
    <h3>PIN sekirite LakayGoPay</h3>
    <p>PIN sa a gen 4 chif. Li sèvi pou otorize operasyon sansib. Pa pataje li ak ajan oswa lòt moun.</p>
    <div id="lgp-pin-status">Ap verifye estati PIN ou…</div>
    <div id="lgp-pin-auth-required" hidden>
      <p>Ou dwe konekte nan kont LakayGoPay ou anvan ou konfigire oswa verifye PIN.</p>
      <button type="button" class="secondary" id="lgp-pin-open-login">Konekte</button>
    </div>
    <form id="lgp-pin-setup-form" hidden>
      <label for="lgp-pin-new">Kreye PIN 4 chif</label>
      <input id="lgp-pin-new" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{4}" minlength="4" maxlength="4" required aria-label="Nouvo PIN 4 chif">
      <button type="submit">Anrejistre PIN</button>
    </form>
    <form id="lgp-pin-verify-form" hidden>
      <label for="lgp-pin-check">Antre PIN 4 chif ou</label>
      <input id="lgp-pin-check" type="password" inputmode="numeric" autocomplete="current-password" pattern="[0-9]{4}" minlength="4" maxlength="4" required aria-label="Verifye PIN 4 chif">
      <button type="submit">Verifye PIN</button>
    </form>
  `;
  securityView.append(pinCard);
}

const logEl = $("#lgp-log");
const resultEl = $("#lgp-result");
let supabase = null;
let factorId = null;
let loadedWallets = [];
let loadedMerchants = [];

function log(message, value) {
  const line = `${new Date().toLocaleTimeString()} · ${message}${value === undefined ? "" : `\n${JSON.stringify(value, null, 2)}`}`;
  logEl.textContent = `${line}\n\n${logEl.textContent}`.slice(0, 8000);
}
function result(message, kind = "") {
  resultEl.className = `status ${kind}`;
  resultEl.textContent = message;
}
function getValue(id) { return $(`#${id}`)?.value?.trim() || ""; }
function setWalletOptions(wallets) {
  const selects = ["lgp-sender-wallet", "lgp-payer-wallet", "lgp-withdraw-wallet"];
  for (const id of selects) {
    const element = $(`#${id}`);
    if (!element) continue;
    element.replaceChildren();
    for (const wallet of wallets) {
      const option = document.createElement("option");
      option.value = wallet.wallet_id;
      const owner = wallet.merchant_id ? `machann ${wallet.merchant_id.slice(0, 8)}` : "bous pèsonèl";
      option.textContent = `${owner} · ${wallet.balance} ${wallet.currency} · ${wallet.status}`;
      element.append(option);
    }
  }
}
function renderMainAccount(profile, wallets, activity) {
  const displayName = profile?.full_name || profile?.phone || "Kont LakayGoPay";
  const htgWallets = wallets.filter((wallet) => wallet.currency === "HTG" && !wallet.merchant_id);
  const htgBalance = htgWallets.reduce((sum, wallet) => sum + Number(wallet.balance || 0), 0);
  const ownWalletIds = new Set(wallets.map((wallet) => wallet.wallet_id));
  const fmt = (amount) => Number(amount || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const setText = (selector, value) => {
    const node = $(selector);
    if (node) node.textContent = value;
  };

  setText("#topName", displayName);
  setText("#sidebarName", displayName);
  setText("#welcomeName", displayName.split(/\s+/)[0]);
  const miniLabel = $(".profile-meta small");
  if (miniLabel) { miniLabel.textContent = "Compte connecté"; miniLabel.removeAttribute("data-i18n"); }
  const topLabel = $(".top-profile-meta small");
  if (topLabel) { topLabel.textContent = "Compte authentifié"; topLabel.removeAttribute("data-i18n"); }
  const demoMode = $(".connection-pill span:last-child");
  if (demoMode) { demoMode.textContent = "Compte connecté · test interne"; demoMode.removeAttribute("data-i18n"); }
  const dot = $(".demo-dot");
  if (dot) dot.title = "Compte authentifié";

  const banner = $(".prototype-banner");
  if (banner) {
    banner.hidden = false;
    const heading = banner.querySelector("strong");
    const copy = banner.querySelector("p");
    if (heading) { heading.textContent = "Compte connecté — registre interne uniquement"; heading.removeAttribute("data-i18n"); }
    if (copy) {
      copy.textContent = "Les données affichées viennent du backend LakayGoPay. Les soldes sont des écritures internes de test : aucun paiement réel, retrait bancaire, MonCash ou NatCash n’est activé.";
      copy.removeAttribute("data-i18n");
    }
  }

  setText("#overviewBalance", fmt(htgBalance));
  setText("#walletBalance", fmt(htgBalance));
  const balanceLabel = $(".balance-status span");
  if (balanceLabel) { balanceLabel.textContent = "Solde du registre interne"; balanceLabel.removeAttribute("data-i18n"); }
  const walletDescription = $(".wallet-feature-card p");
  if (walletDescription) { walletDescription.textContent = "Solde tiré du backend, sans valeur de retrait réel."; walletDescription.removeAttribute("data-i18n"); }
  const walletStatus = $("#view-wallet .status-label");
  if (walletStatus) walletStatus.textContent = "Backend";
  const currencyHeading = $("#view-wallet .currency-card h3");
  if (currencyHeading) currencyHeading.innerHTML = `${fmt(htgBalance)} <small>HTG</small>`;
  const statusLabel = $(".status-card .status-label");
  if (statusLabel) statusLabel.textContent = "Connecté";
  const ring = $(".readiness-ring strong");
  if (ring) ring.textContent = "OK";
  const progress = $(".progress-track span");
  if (progress) progress.style.width = "100%";
  const setupHint = $(".readiness-score small");
  if (setupHint) { setupHint.textContent = "Supabase et bous chaje"; setupHint.removeAttribute("data-i18n"); }

  const incoming = activity.filter((item) =>
    item.kind === "deposit" || (item.kind === "transfer" && ownWalletIds.has(item.recipient_wallet_id))
  ).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const outgoing = activity.filter((item) =>
    item.kind === "withdrawal" || (item.kind === "transfer" && ownWalletIds.has(item.sender_wallet_id))
  ).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  setText("#incomingMetric", `${fmt(incoming)} HTG`);
  setText("#outgoingMetric", `${fmt(outgoing)} HTG`);
  setText("#transactionMetric", String(activity.length));
  setText("#beneficiaryMetric", "—");

  const recent = $("#recentTransactions");
  if (recent) {
    recent.replaceChildren();
    if (!activity.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Pa gen tranzaksyon backend pou kont sa a pou kounye a.";
      recent.append(empty);
    } else {
      activity.slice(0, 5).forEach((item) => {
        const row = document.createElement("div");
        row.className = "transaction-row";
        const icon = document.createElement("div");
        icon.className = "transaction-avatar";
        icon.textContent = item.kind === "deposit" ? "↙" : item.kind === "withdrawal" ? "↗" : "⇄";
        const main = document.createElement("div");
        main.className = "transaction-main";
        const title = document.createElement("strong");
        title.textContent = item.kind === "deposit" ? "Depo" : item.kind === "withdrawal" ? "Demann retrè" : "Transfè";
        const detail = document.createElement("small");
        detail.textContent = `${item.status || "anrejistre"} · ${new Date(item.created_at).toLocaleString("fr-FR")}`;
        main.append(title, detail);
        const amount = document.createElement("div");
        amount.className = "transaction-amount";
        amount.textContent = `${fmt(item.amount)} ${item.currency || "HTG"}`;
        const state = document.createElement("small");
        state.textContent = "Backend";
        amount.append(state);
        row.append(icon, main, amount);
        recent.append(row);
      });
    }
  }
}

async function currentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}
async function api(path, { method = "GET", body, idempotency = false } = {}) {
  const session = await currentSession();
  const headers = { accept: "application/json" };
  if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const keyName = `lgp-idempotency:${method}:${path}`;
  let requestKey = null;
  if (idempotency) {
    requestKey = sessionStorage.getItem(keyName) || randomKey();
    sessionStorage.setItem(keyName, requestKey);
    headers["Idempotency-Key"] = requestKey;
  }
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (idempotency && response.status < 500 && response.status !== 409) sessionStorage.removeItem(keyName);
    const error = new Error(payload.error || `HTTP_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  if (idempotency) sessionStorage.removeItem(keyName);
  return payload;
}
async function loadAccount() {
  const [profile, wallets, merchants, payments, withdrawals, activity] = await Promise.all([
    api("/api/profile"), api("/api/wallets"), api("/api/merchant/mine"), api("/api/payments"), api("/api/withdrawals"), api("/api/activity"),
  ]);
  loadedWallets = wallets.wallets || [];
  loadedMerchants = merchants.merchants || [];
  setWalletOptions(loadedWallets);
  const backendActivity = activity.activity || [];
  renderMainAccount(profile.profile, loadedWallets, backendActivity);
  const summary = {
    profile: profile.profile,
    wallets: loadedWallets,
    merchants: loadedMerchants,
    merchantPayments: payments.payments || [],
    withdrawals: withdrawals.withdrawals || [],
    activity: backendActivity,
  };
  $("#lgp-wallet-list").textContent = JSON.stringify(summary, null, 2);
  if (loadedMerchants.length && !getValue("lgp-merchant-id")) $("#lgp-merchant-id").value = loadedMerchants[0].id;
  log("Done kont ak bous yo.", { profile: profile.profile?.id, wallet_count: loadedWallets.length, merchant_count: loadedMerchants.length });
  result("Done backend yo chaje avèk siksè.", "success");
  return summary;
}
async function refreshPinStatus() {
  const statusNode = $("#lgp-pin-status");
  const setupForm = $("#lgp-pin-setup-form");
  const verifyForm = $("#lgp-pin-verify-form");
  const authRequired = $("#lgp-pin-auth-required");
  if (!statusNode || !setupForm || !verifyForm || !authRequired) return;
  const session = supabase ? await currentSession().catch(() => null) : null;
  authRequired.hidden = Boolean(session);
  setupForm.hidden = true;
  verifyForm.hidden = true;
  if (!session) {
    statusNode.className = "";
    statusNode.textContent = "Konekte pou nou ka verifye si PIN ou deja konfigire.";
    return;
  }
  statusNode.className = "";
  statusNode.textContent = "Ap verifye estati PIN ou…";
  try {
    const data = await api("/api/pin/status");
    if (data.pin_configured) {
      setupForm.hidden = true;
      verifyForm.hidden = false;
      statusNode.className = "success";
      statusNode.textContent = data.locked_until && Date.parse(data.locked_until) > Date.now()
        ? `PIN lan bloke tanporèman jouk ${new Date(data.locked_until).toLocaleString()}.`
        : "PIN sekirite a deja konfigire. Antre li pou teste verifikasyon an.";
    } else {
      setupForm.hidden = false;
      verifyForm.hidden = true;
      statusNode.textContent = "Ou poko gen PIN sekirite. Kreye youn pou kontinye.";
    }
  } catch (error) {
    statusNode.className = "error";
    statusNode.textContent = `Pa kapab verifye estati PIN lan: ${error.message}`;
  }
}

function setAuthenticated(session) {
  const loggedIn = Boolean(session?.user);
  refreshPinStatus();
  $("#lgp-auth-card").hidden = loggedIn;
  for (const id of ["lgp-account-card", "lgp-mfa-card", "lgp-wallet-card", "lgp-merchant-card", "lgp-transfer-card", "lgp-pay-card", "lgp-withdraw-card"]) $("#" + id).hidden = !loggedIn;
  $("#lgp-admin-card").hidden = true;
  $("#lgp-user-label").textContent = loggedIn ? `${session.user.email || session.user.phone || session.user.id}\nNivo sesyon: verifye nan API admin.` : "Pa konekte.";
  if (loggedIn) loadAccount().catch((error) => result(`Erè chajman: ${error.message}`, "error"));
}
async function makeQr(payload) {
  const box = $("#lgp-qr");
  box.replaceChildren();
  const { toDataURL } = await import("https://esm.sh/qrcode@1.5.4");
  const image = document.createElement("img");
  image.alt = "QR LakayGoPay pou demann peman tès";
  image.src = await toDataURL(payload, { width: 240, margin: 1, errorCorrectionLevel: "M" });
  box.append(image);
  const text = document.createElement("p");
  text.textContent = payload;
  box.append(text);
}

launch.addEventListener("click", () => { panel.hidden = !panel.hidden; });
$("#lgp-close").addEventListener("click", () => { panel.hidden = true; });

if (!config.configured) {
  $("#lgp-config-status").className = "status error";
  $("#lgp-config-status").textContent = "Backend poko konfigire. Mete SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY ak SUPABASE_SECRET_KEY nan Cloudflare Pages → Settings → Variables and Secrets.";
  $("#lgp-auth-card").hidden = true;
  result("Aplikasyon an rete nan mòd demonstrasyon jiskaske sekrè Cloudflare yo ajoute.", "error");
} else {
  try {
    const { supabaseUrl, publishableKey } = config;
    supabase = createClient(supabaseUrl, publishableKey, {
      auth: {
        storage: window.sessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    $("#lgp-config-status").className = "status success";
    $("#lgp-config-status").textContent = "Konfigirasyon piblik la disponib. Kle sekrè a rete sou sèvè a.";
    const { data: { session } } = await supabase.auth.getSession();
    setAuthenticated(session);
    supabase.auth.onAuthStateChange((event, nextSession) => {
      setAuthenticated(nextSession);
      if (event === "PASSWORD_RECOVERY") {
        $("#lgp-auth-card").hidden = false;
        $("#lgp-new-password").focus();
        result("Antre nouvo modpas ou pou fini rekiperasyon kont lan.");
      }
    });
  } catch (error) {
    result(`Pa kapab chaje koneksyon Supabase: ${error.message}`, "error");
    log("Koneksyon auth echwe.", error.message);
  }
}

const pinCard = $("#lgp-pin-card");
if (pinCard) {
  $("#lgp-pin-open-login").addEventListener("click", () => {
    panel.hidden = false;
    $("#lgp-email")?.focus();
  });
  $("#lgp-pin-setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#lgp-pin-new");
    const pin = input.value;
    if (!/^\d{4}$/.test(pin)) {
      $("#lgp-pin-status").className = "error";
      $("#lgp-pin-status").textContent = "PIN lan dwe gen egzakteman 4 chif.";
      return;
    }
    const submit = event.submitter;
    if (submit) submit.disabled = true;
    try {
      const data = await api("/api/pin/setup", { method: "POST", body: { pin } });
      input.value = "";
      $("#lgp-pin-status").className = "success";
      $("#lgp-pin-status").textContent = data.pin_configured ? "PIN sekirite a anrejistre avèk siksè." : "Nou pa kapab konfime anrejistreman PIN lan.";
      await refreshPinStatus();
    } catch (error) {
      $("#lgp-pin-status").className = "error";
      $("#lgp-pin-status").textContent = error.message === "PIN_ALREADY_SET"
        ? "PIN deja konfigire sou kont sa a. Sèvi ak fòm verifikasyon an."
        : `Erè pandan kreyasyon PIN: ${error.message}`;
      await refreshPinStatus();
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  $("#lgp-pin-verify-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#lgp-pin-check");
    const pin = input.value;
    if (!/^\d{4}$/.test(pin)) {
      $("#lgp-pin-status").className = "error";
      $("#lgp-pin-status").textContent = "PIN lan dwe gen egzakteman 4 chif.";
      return;
    }
    const submit = event.submitter;
    if (submit) submit.disabled = true;
    try {
      const data = await api("/api/pin/verify", { method: "POST", body: { pin } });
      input.value = "";
      $("#lgp-pin-status").className = "success";
      $("#lgp-pin-status").textContent = data.pin_verified ? "PIN lan verifye avèk siksè." : "Verifikasyon PIN lan pa reyisi.";
    } catch (error) {
      input.value = "";
      $("#lgp-pin-status").className = "error";
      $("#lgp-pin-status").textContent = error.message === "PIN_INVALID"
        ? "PIN lan pa kòrèk. Verifye li epi eseye ankò."
        : error.message === "PIN_TEMPORARILY_LOCKED"
          ? "PIN lan bloke tanporèman apre twòp move tantativ."
          : `Erè verifikasyon PIN: ${error.message}`;
      await refreshPinStatus();
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

panel.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  button.disabled = true;
  try {
    if (action === "health") {
      const health = await fetch("/api/health").then((response) => response.json());
      result(JSON.stringify(health), health.status === "ok" ? "success" : "error");
      log("Health API", health);
    } else if (action === "signup") {
      const email = getValue("lgp-email"), password = getValue("lgp-password");
      if (!email || password.length < 8) throw new Error("Antre imèl ak yon modpas ki gen omwen 8 karaktè.");
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: getValue("lgp-full-name") } } });
      if (error) throw error;
      result(data.session ? "Kont kreye. Ou konekte." : "Kont kreye. Verifye imèl ou pou konfime li, epi konekte.", "success");
      log("Enskripsyon", { user_id: data.user?.id, confirmation_required: !data.session });
      if (data.session) setAuthenticated(data.session);
    } else if (action === "login") {
      const { data, error } = await supabase.auth.signInWithPassword({ email: getValue("lgp-email"), password: getValue("lgp-password") });
      if (error) throw error;
      setAuthenticated(data.session);
      result("Koneksyon reyisi.", "success");
      log("Koneksyon", { user_id: data.user?.id });
    } else if (action === "send-otp") {
      const { error } = await supabase.auth.signInWithOtp({ email: getValue("lgp-email"), options: { shouldCreateUser: false } });
      if (error) throw error;
      result("Kòd OTP a voye nan imèl la. Antre kòd la anba a.", "success");
    } else if (action === "verify-otp") {
      const { data, error } = await supabase.auth.verifyOtp({ email: getValue("lgp-email"), token: getValue("lgp-otp"), type: "email" });
      if (error) throw error;
      setAuthenticated(data.session);
      result("Kòd OTP verifye; sesyon an louvri.", "success");
    } else if (action === "send-sms-otp") {
      const phone = getValue("lgp-phone");
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Antre nimewo a ak fòma entènasyonal, pa egzanp +509XXXXXXXX.");
      const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
      if (error) throw error;
      result("OTP SMS voye si founisè SMS Supabase la konfigire.", "success");
    } else if (action === "verify-sms-otp") {
      const { data, error } = await supabase.auth.verifyOtp({ phone: getValue("lgp-phone"), token: getValue("lgp-sms-otp"), type: "sms" });
      if (error) throw error;
      setAuthenticated(data.session);
      result("OTP SMS verifye; sesyon an louvri.", "success");
    } else if (action === "recover") {
      const { error } = await supabase.auth.resetPasswordForEmail(getValue("lgp-email"), { redirectTo: `${location.origin}/?recovery=1` });
      if (error) throw error;
      result("Lyen rekiperasyon voye. Verifye imèl ou, ouvri lyen an sou menm domèn aplikasyon an, epi mete nouvo modpas la.", "success");
    } else if (action === "update-password") {
      const password = getValue("lgp-new-password");
      if (password.length < 8) throw new Error("Nouvo modpas la dwe gen omwen 8 karaktè.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      result("Nouvo modpas la anrejistre.", "success");
      log("Modpas mete ajou.");
    } else if (action === "logout") {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      loadedWallets = [];
      setAuthenticated(null);
      result("Ou dekonekte.", "success");
    } else if (action === "load-account") {
      await loadAccount();
    } else if (action === "enroll-mfa") {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "LakayGoPay Admin Authenticator" });
      if (error) throw error;
      factorId = data.id;
      const qr = document.createElement("div");
      qr.className = "status";
      qr.textContent = `Kle sekrè MFA (kenbe l prive): ${data.totp?.secret || "pa disponib"}`;
      const image = document.createElement("img");
      image.alt = "QR pou aplikasyon otantifikatè";
      image.src = data.totp?.qr_code || "";
      $("#lgp-mfa-qr").replaceChildren(image, qr);
      result("Eskane QR sa a ak aplikasyon otantifikatè a, epi antre kòd 6 chif la.", "success");
      log("Faktè TOTP kreye; poko verifye.", { factor_id: factorId });
    } else if (action === "verify-mfa") {
      if (!factorId) {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;
        factorId = data.totp?.find((factor) => factor.status === "unverified")?.id || data.totp?.find((factor) => factor.status === "verified")?.id;
      }
      if (!factorId) throw new Error("Pa gen faktè TOTP. Klike Kreye faktè MFA an premye.");
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;
      const { data, error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: getValue("lgp-mfa-code") });
      if (error) throw error;
      result("MFA verifye. Sesyon an ta dwe monte nan nivo aal2.", "success");
      log("MFA TOTP verifye.");
      await supabase.auth.refreshSession();
    } else if (action === "merchant-register") {
      const data = await api("/api/merchant/register", { method: "POST", body: { business_name: getValue("lgp-business-name"), business_type: getValue("lgp-business-type") }, idempotency: true });
      $("#lgp-merchant-id").value = data.merchant.merchant_id;
      result("Machann anrejistre. Estati li rete pending jiskaske admin verifye l.", "success");
      log("Enskripsyon machann", data);
      await loadAccount();
    } else if (action === "create-qr") {
      const merchantId = getValue("lgp-merchant-id");
      const data = await api("/api/payment-requests", { method: "POST", body: { merchant_id: merchantId, amount: getValue("lgp-qr-amount"), description: getValue("lgp-qr-description"), expires_in_minutes: 30 }, idempotency: true });
      const token = data.payment_request?.qr_token;
      if (!token) throw new Error("Repons backend lan pa gen token QR.");
      $("#lgp-qr-token").value = token;
      const qrUrl = new URL(location.origin + "/");
      qrUrl.searchParams.set("lgp_qr", token);
      await makeQr(qrUrl.toString());
      result("Demann QR kreye. Li pa resevwa lajan jiskaske yon kliyan konekte epi konfime peman an.", "success");
      log("Demann QR", data);
    } else if (action === "lookup-qr") {
      const data = await api(`/api/payment-requests/lookup?token=${encodeURIComponent(getValue("lgp-qr-token"))}`);
      $("#lgp-qr-details").textContent = JSON.stringify(data.payment_request, null, 2);
      result("Demann QR verifye. Verifye non machann, montan ak dat ekspirasyon an avan peman.", "success");
      log("QR lookup", data);
    } else if (action === "pay-qr") {
      const amount = getValue("lgp-pay-amount");
      const body = { qr_token: getValue("lgp-qr-token"), payer_wallet_id: getValue("lgp-payer-wallet") };
      if (amount) body.amount = amount;
      const data = await api("/api/payment-requests/pay", { method: "POST", body, idempotency: true });
      result("Peman entèn anrejistre nan ledger la.", "success");
      log("Peman QR entèn", data);
      await loadAccount();
    } else if (action === "transfer") {
      const data = await api("/api/transfers", { method: "POST", body: { sender_wallet_id: getValue("lgp-sender-wallet"), recipient_wallet_id: getValue("lgp-recipient-wallet"), amount: getValue("lgp-transfer-amount"), note: getValue("lgp-transfer-note") }, idempotency: true });
      result("Transfè entèn anrejistre.", "success");
      log("Transfè entèn", data);
      await loadAccount();
    } else if (action === "withdraw") {
      const body = { wallet_id: getValue("lgp-withdraw-wallet"), amount: getValue("lgp-withdraw-amount"), destination_type: getValue("lgp-withdraw-type") };
      if (getValue("lgp-withdraw-reference")) body.destination_reference = getValue("lgp-withdraw-reference");
      const data = await api("/api/withdrawals", { method: "POST", body, idempotency: true });
      $("#lgp-withdrawal-id").value = data.withdrawal?.withdrawal_id || "";
      result("Demann retrè kreye epi kantite lajan an rezève. Pa gen peman deyò ki fèt.", "success");
      log("Demann retrè", data);
      await loadAccount();
    } else if (action === "admin-check") {
      const data = await api("/api/admin/me");
      $("#lgp-admin-status").textContent = JSON.stringify(data, null, 2);
      $("#lgp-admin-card").hidden = !(data.is_admin && data.aal2);
      if (data.is_admin) $("#lgp-mfa-card").hidden = false;
      result(data.is_admin ? (data.aal2 ? "Dwa admin aktif ak MFA aal2." : "Kont admin sa a dwe verifye MFA TOTP anvan aksyon privilejye.") : "Kont sa a pa gen wòl admin.", data.is_admin && data.aal2 ? "success" : "error");
      log("Kontwòl dwa admin", data);
    } else if (action === "test-credit") {
      const data = await api("/api/admin/test-credit", { method: "POST", body: { wallet_id: getValue("lgp-test-wallet-id"), amount: getValue("lgp-test-credit-amount") }, idempotency: true });
      result("Kredi tès la poste nan ledger la. Li pa reprezante lajan reyèl.", "success");
      log("Kredi tès", data);
      await loadAccount();
    } else if (action === "withdrawal-decision") {
      const data = await api("/api/admin/withdrawals/decision", { method: "POST", body: { withdrawal_id: getValue("lgp-withdrawal-id"), decision: getValue("lgp-withdrawal-decision"), comment: getValue("lgp-withdrawal-comment") } });
      result("Desizyon admin an anrejistre. Dezyèm apwobasyon ka toujou nesesè.", "success");
      log("Desizyon retrè", data);
    } else if (action === "merchant-review") {
      const data = await api("/api/admin/merchants/review", { method: "POST", body: { merchant_id: getValue("lgp-review-merchant-id"), status: getValue("lgp-review-status") } });
      result("Estati machann lan mete ajou.", "success");
      log("Revizyon machann", data);
      await loadAccount();
    } else if (action === "ledger-audit") {
      const data = await api("/api/admin/ledger/audit");
      result(data.report?.ok ? "Odit ledger la pa jwenn erè nan kontwòl sa yo." : "Odit ledger la jwenn pwen ki mande revizyon.", data.report?.ok ? "success" : "error");
      log("Rapò entegrite ledger", data);
    }
  } catch (error) {
    result(`${error.message}${error.status ? ` (HTTP ${error.status})` : ""}`, "error");
    log(`Aksyon ${action} echwe`, error.payload || error.message);
  } finally {
    button.disabled = false;
  }
});

const queryToken = new URL(location.href).searchParams.get("lgp_qr");
if (queryToken) {
  panel.hidden = false;
  setTimeout(() => { const tokenInput = $("#lgp-qr-token"); if (tokenInput) tokenInput.value = queryToken; }, 0);
}
