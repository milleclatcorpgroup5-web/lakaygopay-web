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
#lgp-panel .auth-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
#lgp-panel .auth-tabs button{background:#e6eef3;color:#214258}
#lgp-panel .auth-tabs button.active{background:#073b58;color:#fff}
#lgp-panel .auth-pane{display:grid;gap:10px}
#lgp-panel .auth-pane[hidden]{display:none}
#lgp-panel .auth-pane>label,#lgp-panel .form-two label{display:grid;gap:5px}
#lgp-panel .form-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#lgp-panel .form-hint{font-size:11px;color:#6a7e8c;line-height:1.45}
#lgp-panel .text-button{background:transparent;color:#087fa5;padding:4px;text-align:left}
#lgp-panel details{border:1px dashed #b9cbd5;border-radius:12px;padding:10px}
#lgp-panel details>summary{cursor:pointer;color:#345;font-weight:700;padding:4px}
#lgp-panel textarea{width:100%;border:1px solid #d5e0e7;border-radius:8px;padding:9px;color:#183447;font:12px system-ui}
#lgp-panel .admin-agent-section{margin:10px 0}
#lgp-agent-review-list .agent-review-row{padding:9px 0;border-bottom:1px solid #dce5ea;display:grid;gap:6px}
#lgp-agent-review-list .agent-review-actions{display:flex;gap:6px;flex-wrap:wrap}
@media(max-width:520px){#lgp-launch{right:10px;bottom:10px}#lgp-panel{right:6px;bottom:62px;width:calc(100vw - 12px);max-height:85vh}#lgp-panel .row{grid-template-columns:1fr}}
`;
document.head.append(style);

renderPublicPreview();

const launch = document.createElement("button");
launch.id = "lgp-launch";
launch.type = "button";
launch.textContent = "Konekte / Kont LakayGoPay";
document.body.append(launch);

const panel = document.createElement("section");
panel.id = "lgp-panel";
panel.hidden = true;
panel.innerHTML = `
  <header><div><strong>LakayGoPay — Kont ou</strong><p style="color:#c7e0e9;margin-top:3px">Konekte, kreye kont, oswa mande aksè ajan.</p></div><button id="lgp-close" class="secondary" type="button">Fèmen</button></header>
  <div id="lgp-body">
    <div id="lgp-config-status" class="status">Chèk konfigirasyon…</div>
    <div id="lgp-auth-card" class="card">
      <h3>Kont LakayGoPay</h3>
      <p>Chwazi sèvis ou bezwen an. Nou montre sèlman chan ki nesesè yo.</p>
      <div class="auth-tabs" id="lgp-auth-tabs">
        <button type="button" data-auth-mode="login" class="active">Konekte</button>
        <button type="button" data-auth-mode="personal">Kont pèsonèl</button>
        <button type="button" data-auth-mode="merchant">Kont machann</button>
        <button type="button" data-auth-mode="agent">Vin ajan</button>
      </div>

      <form id="lgp-login-pane" class="auth-pane">
        <label>Imèl kont ou<input id="lgp-email" type="email" autocomplete="username" required></label>
        <label>Modpas kont (8 karaktè minimòm)<input id="lgp-password" type="password" autocomplete="current-password" minlength="8" required></label>
        <button type="submit">Konekte</button>
        <button type="button" class="secondary text-button" data-action="recover">Mwen bliye modpas mwen</button>
      </form>

      <form id="lgp-personal-pane" class="auth-pane" hidden>
        <div class="form-two">
          <label>Prenon (premye non)<input id="lgp-personal-first" autocomplete="given-name" maxlength="60" required></label>
          <label>Nom (siyati)<input id="lgp-personal-last" autocomplete="family-name" maxlength="60" required></label>
        </div>
        <label>Dat nesans<input id="lgp-personal-dob" type="date" autocomplete="bday" required></label>
        <small class="form-hint">Ou dwe gen omwen 18 an. PIN tranzaksyon 4 chif la ap kreye apre ou konekte, nan seksyon Sekirite.</small>
        <label>Imèl<input id="lgp-personal-email" type="email" autocomplete="email" required></label>
        <label>Nimewo telefòn<input id="lgp-personal-phone" type="tel" autocomplete="tel" placeholder="+509 ..." required></label>
        <label>Modpas kont (8 karaktè minimòm)<input id="lgp-personal-password" type="password" autocomplete="new-password" minlength="8" required></label>
        <button type="submit">Kreye kont pèsonèl</button>
      </form>

      <form id="lgp-merchant-pane" class="auth-pane" hidden>
        <label>Non biznis la<input id="lgp-merchant-name" autocomplete="organization" maxlength="120" required></label>
        <label>Telefòn biznis la<input id="lgp-merchant-phone" type="tel" autocomplete="tel" placeholder="+509 ..." required></label>
        <label>Imèl biznis la<input id="lgp-merchant-email" type="email" autocomplete="email" required></label>
        <label>Modpas kont (8 karaktè minimòm)<input id="lgp-merchant-password" type="password" autocomplete="new-password" minlength="8" required></label>
        <button type="submit">Kreye kont machann</button>
        <small class="form-hint">Kont machann lan ak bous biznis la ap rete an atant jiskaske admin verifye dosye a.</small>
      </form>

      <div id="lgp-agent-intro" class="auth-pane" hidden>
        <p>Ajan LakayGoPay pa kreye kont ajan poukont yo. Konekte ak kont pèsonèl ou, soumèt demann lan, epi admin ap verifye epi bay otorizasyon.</p>
        <button type="button" data-action="agent-login">Konekte pou aplike</button>
      </div>
      <form id="lgp-password-recovery" class="auth-pane" hidden>
        <label>Nouvo modpas kont (8 karaktè minimòm)<input id="lgp-new-password" type="password" autocomplete="new-password" minlength="8" required></label>
        <button type="submit">Mete nouvo modpas</button>
      </form>
      <p id="lgp-auth-message" class="form-hint" role="status"></p>
    </div>
    <div id="lgp-account-card" class="card" hidden>
      <h3>Kont ou konekte</h3><div id="lgp-user-label" class="status"></div>
      <div class="actions"><button data-action="agent-apply-open">Vin ajan LakayGoPay</button><button data-action="admin-check" class="secondary">Admin</button><button data-action="logout" class="danger">Dekonekte</button></div>
      <div id="lgp-admin-status" class="status">Koneksyon verifye.</div>
    </div>
    <div id="lgp-agent-card" class="card" hidden>
      <h3>Demann pou vin ajan LakayGoPay</h3>
      <p>Soumèt enfòmasyon yo. Kont ajan an pap aktif jiskaske yon administratè apwouve demann lan.</p>
      <form id="lgp-agent-form">
        <label>Nimewo telefòn ajan an<input id="lgp-agent-phone" type="tel" placeholder="+509 ..." required></label>
        <div class="form-two">
          <label>Depatman<input id="lgp-agent-department" maxlength="80" placeholder="Ouest" required></label>
          <label>Komin<input id="lgp-agent-commune" maxlength="100" placeholder="Léogâne" required></label>
        </div>
        <label>Adrès biznis (opsyonèl)<input id="lgp-agent-address" maxlength="200"></label>
        <label>Poukisa ou vle vin ajan? (opsyonèl)<textarea id="lgp-agent-motivation" maxlength="1000" rows="3"></textarea></label>
        <button type="submit">Soumèt demann pou verifikasyon</button>
      </form>
      <div id="lgp-agent-status" class="status">Pa gen demann ki soumèt.</div>
    </div>
    <div id="lgp-mfa-card" class="card" hidden>
      <h3>MFA TOTP (obligatwa pou aksyon admin)</h3>
      <p>Enskri yon aplikasyon otantifikatè (pa egzanp Google Authenticator oswa Aegis), epi verifye kòd 6 chif la.</p>
      <button data-action="enroll-mfa">Kreye faktè MFA</button>
      <div id="lgp-mfa-qr"></div>
      <label>Kòd MFA<input id="lgp-mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8"></label>
      <button data-action="verify-mfa">Verifye MFA</button>
    </div>
    <details id="lgp-advanced-tools">
      <summary>Outil devlopman ak tès avanse</summary>
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
      <label>PIN sekirite 4 chif<input id="lgp-transfer-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="one-time-code" required></label>
      <button data-action="transfer">Teste transfè</button>
    </div>
    <div id="lgp-pay-card" class="card" hidden>
      <h3>Peye yon QR</h3>
      <label>Token QR<input id="lgp-qr-token" placeholder="UUID ki nan QR la"></label>
      <button class="secondary" data-action="lookup-qr">Verifye demann QR</button>
      <label>Bous k ap peye a<select id="lgp-payer-wallet"></select></label>
      <label>Montan (kite vid si QR la gen montan fiks)<input id="lgp-pay-amount" type="number" min="0.01" step="0.01"></label>
      <label>PIN sekirite 4 chif<input id="lgp-pay-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="one-time-code" required></label>
      <button data-action="pay-qr">Konfime peman entèn</button><div id="lgp-qr-details" class="status">Pa gen demann chwazi.</div>
    </div>
    <div id="lgp-withdraw-card" class="card" hidden>
      <h3>Demann retrè (pa gen peman deyò)</h3>
      <label>Bous<select id="lgp-withdraw-wallet"></select></label>
      <div class="row"><label>Montan HTG<input id="lgp-withdraw-amount" type="number" min="0.01" step="0.01"></label><label>Destinasyon<select id="lgp-withdraw-type"><option value="moncash">MonCash</option><option value="natcash">NatCash</option><option value="bank">Bank</option><option value="cash_agent">Ajan lajan kach</option><option value="other">Lòt</option></select></label></div>
      <label>Referans destinasyon (opsyonèl; chiffres sou sèvè)<input id="lgp-withdraw-reference" autocomplete="off"></label>
      <label>PIN sekirite 4 chif<input id="lgp-withdraw-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="one-time-code" required></label>
      <button data-action="withdraw">Soumèt demann retrè</button>
      <p>Demann lan rezève kantite lajan an. Apwobasyon pa voye lajan; entegrasyon founisè a poko aktive.</p>
    </div>
    </details>
    <div id="lgp-admin-card" class="card" hidden>
      <h3>Zòn administrasyon</h3>
      <p>Administrasyon fèt nan yon espas apa. Aksè a mande wòl admin ak MFA.</p>
      <a href="/admin/" class="admin-center-link" style="display:inline-block;background:#073b58;color:#fff;text-decoration:none;padding:11px 15px;border-radius:9px;font-weight:700">Louvri Sant Kontwòl Admin →</a>
      <section class="card admin-agent-section">
        <h4>Demann ajan pou revize</h4>
        <button class="secondary" data-action="agent-list">Chaje demann ajan yo</button>
        <div id="lgp-agent-review-list" class="status">Pa gen lis chaje.</div>
      </section>
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
let merchantProvisioning = null;

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
  if (setupHint) { setupHint.textContent = "Supabase ak bous ou chaje"; setupHint.removeAttribute("data-i18n"); }
  const welcomeSubtitle = $(".welcome-row .subtext");
  if (welcomeSubtitle) { welcomeSubtitle.textContent = "Kont ou konekte ak done ki sòti nan backend LakayGoPay."; welcomeSubtitle.removeAttribute("data-i18n"); }
  const secureCaption = $(".secure-note small");
  if (secureCaption) { secureCaption.textContent = "Kont konekte · sekirite"; secureCaption.removeAttribute("data-i18n"); }
  const footer = $(".footer-prototype");
  if (footer) footer.textContent = "Rejis entèn · HTG";

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

function setAuthMode(mode) {
  const allowed = ["login","personal","merchant","agent"];
  if (!allowed.includes(mode)) mode = "login";
  for (const button of document.querySelectorAll("[data-auth-mode]")) {
    button.classList.toggle("active", button.dataset.authMode === mode);
  }
  $("#lgp-login-pane").hidden = mode !== "login";
  $("#lgp-personal-pane").hidden = mode !== "personal";
  $("#lgp-merchant-pane").hidden = mode !== "merchant";
  $("#lgp-agent-intro").hidden = mode !== "agent";
  $("#lgp-auth-message").textContent = "";
  if (mode === "agent") {
    currentSession().then((session) => {
      if (session) {
        $("#lgp-agent-card").hidden = false;
        panel.hidden = false;
        loadAgentStatus();
      }
    }).catch(() => {});
  }
}

async function postSignup(payload) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      MINIMUM_AGE_18: "Ou dwe gen omwen 18 an pou ouvri kont pèsonèl.",
      EMAIL_ALREADY_REGISTERED: "Imèl sa a deja gen yon kont. Konekte pito.",
      VALID_PHONE_REQUIRED: "Antre yon nimewo telefòn ki valab.",
      VALID_BUSINESS_PHONE_REQUIRED: "Antre nimewo telefòn biznis la.",
      VALID_BUSINESS_NAME_REQUIRED: "Antre non biznis la.",
      SIGNUP_FAILED: "Kreyasyon kont lan pa reyisi. Verifye enfòmasyon yo.",
      PASSWORD_POLICY_REJECTED: "Modpas la pa satisfè kondisyon sekirite yo.",
    };
    throw new Error(messages[data.error] || data.error || "SIGNUP_FAILED");
  }
  if (data.session?.access_token && data.session?.refresh_token) {
    const { data: sessionData, error } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (error) throw error;
    setAuthenticated(sessionData.session);
    return { signedIn: true, data };
  }
  return { signedIn: false, data };
}

async function maybeProvisionMerchant(session) {
  const metadata = session?.user?.user_metadata || {};
  if (metadata.account_type !== "merchant") return;
  if (merchantProvisioning) return merchantProvisioning;
  merchantProvisioning = (async () => {
    const existing = await api("/api/merchant/mine");
    if ((existing.merchants || []).length) return;
    const businessName = String(metadata.business_name || "").trim();
    const businessPhone = String(metadata.business_phone || metadata.phone || "").trim();
    if (!businessName || !businessPhone) return;
    await api("/api/merchant/register", {
      method: "POST",
      body: { business_name: businessName, business_type: "other", contact_phone: businessPhone },
      idempotency: true,
    });
    result("Kont biznis la ak bous machann lan kreye. Estati a rete an atant verifikasyon admin.", "success");
  })();
  try { return await merchantProvisioning; }
  finally { merchantProvisioning = null; }
}

async function loadAgentStatus() {
  const statusNode = $("#lgp-agent-status");
  const form = $("#lgp-agent-form");
  if (!statusNode || !form) return;
  statusNode.className = "status";
  statusNode.textContent = "Ap verifye estati demann ajan ou…";
  try {
    const data = await api("/api/agents/status");
    if (data.agent?.status === "active") {
      form.hidden = true;
      statusNode.className = "status success";
      statusNode.textContent = `Ajan aktive. Kòd ajan ou: ${data.agent.agent_code}. Kenbe kòd sa a prive.`;
      return;
    }
    const latest = (data.applications || [])[0];
    if (latest && ["submitted","under_review"].includes(latest.status)) {
      form.hidden = true;
      statusNode.textContent = `Demann ou an ${latest.status === "submitted" ? "resevwa" : "an revizyon"}. Se admin k ap deside sou aktivasyon an.`;
      return;
    }
    form.hidden = false;
    statusNode.textContent = latest?.status === "rejected"
      ? `Dènye demann lan pa t apwouve. Nòt admin: ${latest.admin_note || "Pa gen nòt."} Ou kapab soumèt yon nouvo demann.`
      : "Ou poko soumèt yon demann ajan.";
  } catch (error) {
    statusNode.className = "status error";
    statusNode.textContent = `Pa kapab chaje estati ajan an: ${error.message}`;
  }
}

async function loadAgentApplications() {
  const node = $("#lgp-agent-review-list");
  node.className = "status";
  node.textContent = "Ap chaje demann ajan yo…";
  try {
    const data = await api("/api/admin/agents");
    node.replaceChildren();
    if (!data.applications?.length) {
      node.textContent = "Pa gen demann ajan k ap tann revizyon.";
      return;
    }
    for (const item of data.applications) {
      const row = document.createElement("div");
      row.className = "agent-review-row";
      const details = document.createElement("div");
      details.textContent = `ID: ${item.id}\nItilizatè: ${item.applicant_user_id}\nTelefòn: ${item.contact_phone}\nZòn: ${item.commune}, ${item.department}\nAdrès: ${item.business_address || "Pa bay"}\nMotif: ${item.motivation || "Pa bay"}`;
      const actions = document.createElement("div");
      actions.className = "agent-review-actions";
      for (const decision of ["approved","rejected"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = "agent-review";
        button.dataset.applicationId = item.id;
        button.dataset.decision = decision;
        button.className = decision === "approved" ? "" : "danger";
        button.textContent = decision === "approved" ? "Apwouve epi bay aksè" : "Rejte";
        actions.append(button);
      }
      row.append(details, actions);
      node.append(row);
    }
  } catch (error) {
    node.className = "status error";
    node.textContent = `Pa kapab chaje aplikasyon yo: ${error.message}`;
  }
}

function renderPublicPreview() {
  const setText = (selector, value) => {
    const node = $(selector);
    if (node) node.textContent = value;
  };
  setText("#topName", "Vizitè");
  setText("#sidebarName", "Vizitè");
  setText("#welcomeName", "Vizitè");
  const miniLabel = $(".profile-meta small");
  if (miniLabel) { miniLabel.textContent = "Pa konekte"; miniLabel.removeAttribute("data-i18n"); }
  const topLabel = $(".top-profile-meta small");
  if (topLabel) { topLabel.textContent = "Aperçu piblik"; topLabel.removeAttribute("data-i18n"); }
  const badge = $(".connection-pill span:last-child");
  if (badge) { badge.textContent = "Aperçu piblik · non connecté"; badge.removeAttribute("data-i18n"); }
  const dot = $(".demo-dot");
  if (dot) dot.title = "Koneksyon obligatwa";
  const balanceLabel = $(".balance-status span");
  if (balanceLabel) { balanceLabel.textContent = "Konekte pou wè balans backend"; balanceLabel.removeAttribute("data-i18n"); }
  const subtitle = $(".welcome-row .subtext");
  if (subtitle) { subtitle.textContent = "Konekte oswa kreye kont ou pou antre nan espas finansye ou."; subtitle.removeAttribute("data-i18n"); }
  const secureCaption = $(".secure-note small");
  if (secureCaption) { secureCaption.textContent = "Kont ak verifikasyon an sekirite"; secureCaption.removeAttribute("data-i18n"); }
  const walletBadge = $("#view-wallet .status-label");
  if (walletBadge) walletBadge.textContent = "Konekte pou antre";
  const footer = $(".footer-prototype");
  if (footer) footer.textContent = "Aperçu piblik · HTG";
  const readiness = $(".status-card .status-label");
  if (readiness) readiness.textContent = "Pa konekte";
  setText("#overviewBalance", "—");
  setText("#walletBalance", "—");
  setText("#incomingMetric", "—");
  setText("#outgoingMetric", "—");
  setText("#transactionMetric", "—");
  setText("#beneficiaryMetric", "—");
  const recent = $("#recentTransactions");
  if (recent) {
    recent.replaceChildren();
    const message = document.createElement("div");
    message.className = "empty-state";
    message.textContent = "Konekte oswa kreye kont ou pou wè tranzaksyon ak balans backend ou.";
    recent.append(message);
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
  $("#lgp-account-card").hidden = !loggedIn;
  $("#lgp-agent-card").hidden = true;
  $("#lgp-mfa-card").hidden = true;
  $("#lgp-advanced-tools").hidden = !loggedIn;
  for (const id of ["lgp-wallet-card", "lgp-merchant-card", "lgp-transfer-card", "lgp-pay-card", "lgp-withdraw-card"]) $("#" + id).hidden = !loggedIn;
  $("#lgp-admin-card").hidden = true;
  const type = session?.user?.user_metadata?.account_type === "merchant" ? "Kont machann" : "Kont pèsonèl";
  $("#lgp-user-label").textContent = loggedIn
    ? `${session.user.email || session.user.phone || session.user.id}\n${type} · koneksyon verifye.`
    : "Pa konekte.";
  if (loggedIn) {
    loadAccount()
      .then(() => maybeProvisionMerchant(session))
      .then(() => loadAccount())
      .catch((error) => result(`Erè chajman kont lan: ${error.message}`, "error"));
  }
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

panel.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
});
setAuthMode("login");

const dobInput = $("#lgp-personal-dob");
if (dobInput) {
  const today = new Date();
  const maxDob = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
  dobInput.max = maxDob.toISOString().slice(0, 10);
}

$("#lgp-login-pane").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  $("#lgp-auth-message").textContent = "Ap konekte…";
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: getValue("lgp-email"),
      password: getValue("lgp-password"),
    });
    if (error) throw error;
    setAuthenticated(data.session);
    $("#lgp-password").value = "";
    $("#lgp-auth-message").textContent = "Koneksyon reyisi.";
    result("Kont ou konekte avèk siksè.", "success");
  } catch (error) {
    $("#lgp-auth-message").textContent = error.message === "Invalid login credentials"
      ? "Imèl oswa modpas la pa kòrèk."
      : error.message;
  } finally {
    if (button) button.disabled = false;
  }
});

$("#lgp-personal-pane").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  $("#lgp-auth-message").textContent = "Ap kreye kont pèsonèl la…";
  try {
    const outcome = await postSignup({
      account_type: "personal",
      first_name: getValue("lgp-personal-first"),
      last_name: getValue("lgp-personal-last"),
      date_of_birth: getValue("lgp-personal-dob"),
      phone: getValue("lgp-personal-phone"),
      email: getValue("lgp-personal-email"),
      password: $("#lgp-personal-password").value,
    });
    $("#lgp-personal-password").value = "";
    if (outcome.signedIn) {
      $("#lgp-auth-message").textContent = "Kont pèsonèl la kreye epi konekte.";
      result("Kont pèsonèl la pare. Ou kapab konfigire PIN sekirite ou nan seksyon Sekirite.", "success");
    } else {
      const email = getValue("lgp-personal-email");
      setAuthMode("login");
      $("#lgp-email").value = email;
      $("#lgp-auth-message").textContent = "Kont lan kreye. Verifye imèl ou pou konfime l, epi konekte.";
    }
  } catch (error) {
    $("#lgp-auth-message").textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
});

$("#lgp-merchant-pane").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  $("#lgp-auth-message").textContent = "Ap kreye kont biznis la…";
  try {
    const outcome = await postSignup({
      account_type: "merchant",
      business_name: getValue("lgp-merchant-name"),
      business_phone: getValue("lgp-merchant-phone"),
      email: getValue("lgp-merchant-email"),
      password: $("#lgp-merchant-password").value,
    });
    $("#lgp-merchant-password").value = "";
    if (outcome.signedIn) {
      $("#lgp-auth-message").textContent = "Kont biznis la kreye. Bous machann lan ap prepare.";
      result("Kont biznis la kreye; estati machann lan ap tann verifikasyon admin.", "success");
    } else {
      const email = getValue("lgp-merchant-email");
      setAuthMode("login");
      $("#lgp-email").value = email;
      $("#lgp-auth-message").textContent = "Kont biznis la kreye. Verifye imèl biznis la, epi konekte ak menm imèl la.";
    }
  } catch (error) {
    $("#lgp-auth-message").textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
});

$("#lgp-password-recovery").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    const password = getValue("lgp-new-password");
    if (password.length < 8) throw new Error("Nouvo modpas la dwe gen omwen 8 karaktè.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    $("#lgp-new-password").value = "";
    $("#lgp-password-recovery").hidden = true;
    $("#lgp-auth-tabs").hidden = false;
    setAuthMode("login");
    $("#lgp-auth-message").textContent = "Nouvo modpas la anrejistre. Konekte ak nouvo modpas la.";
    result("Modpas kont lan mete ajou.", "success");
  } catch (error) {
    $("#lgp-auth-message").textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
});

$("#lgp-agent-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    const data = await api("/api/agents/apply", {
      method: "POST",
      body: {
        contact_phone: getValue("lgp-agent-phone"),
        department: getValue("lgp-agent-department"),
        commune: getValue("lgp-agent-commune"),
        business_address: getValue("lgp-agent-address") || null,
        motivation: getValue("lgp-agent-motivation") || null,
      },
    });
    result("Demann ajan an resevwa. Se admin ki dwe verifye epi apwouve l.", "success");
    await loadAgentStatus();
    log("Demann ajan soumèt", { application_id: data.application?.application_id, status: data.application?.status });
  } catch (error) {
    $("#lgp-agent-status").className = "status error";
    $("#lgp-agent-status").textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
});

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
        storage: window.localStorage,
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
        $("#lgp-auth-tabs").hidden = true;
        $("#lgp-login-pane").hidden = true;
        $("#lgp-personal-pane").hidden = true;
        $("#lgp-merchant-pane").hidden = true;
        $("#lgp-agent-intro").hidden = true;
        $("#lgp-password-recovery").hidden = false;
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
    if (action === "agent-login") {
      setAuthMode("login");
    } else if (action === "agent-apply-open") {
      $("#lgp-agent-card").hidden = false;
      await loadAgentStatus();
      $("#lgp-agent-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else if (action === "agent-list") {
      await loadAgentApplications();
    } else if (action === "agent-review") {
      const decision = button.dataset.decision;
      const data = await api("/api/admin/agents/review", {
        method: "POST",
        body: {
          application_id: button.dataset.applicationId,
          decision,
          admin_note: null,
        },
      });
      result(decision === "approved" ? "Ajan apwouve. Aksè ajan an kreye." : "Demann ajan an rejte.", "success");
      log("Revizyon demann ajan", data);
      await loadAgentApplications();
    } else if (action === "health") {
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
      const body = {
        qr_token: getValue("lgp-qr-token"),
        payer_wallet_id: getValue("lgp-payer-wallet"),
        pin: getValue("lgp-pay-pin")
      };
      if (amount) body.amount = amount;
      let data;
      try {
        data = await api("/api/payment-requests/pay", { method: "POST", body, idempotency: true });
      } finally {
        $("#lgp-pay-pin").value = "";
      }
      result("Peman entèn anrejistre nan ledger la.", "success");
      log("Peman QR entèn", data);
      await loadAccount();
    } else if (action === "transfer") {
      const body = {
        sender_wallet_id: getValue("lgp-sender-wallet"),
        recipient_wallet_id: getValue("lgp-recipient-wallet"),
        amount: getValue("lgp-transfer-amount"),
        note: getValue("lgp-transfer-note"),
        pin: getValue("lgp-transfer-pin")
      };
      let data;
      try {
        data = await api("/api/transfers", { method: "POST", body, idempotency: true });
      } finally {
        $("#lgp-transfer-pin").value = "";
      }
      result("Transfè entèn anrejistre.", "success");
      log("Transfè entèn", data);
      await loadAccount();
    } else if (action === "withdraw") {
      const body = {
        wallet_id: getValue("lgp-withdraw-wallet"),
        amount: getValue("lgp-withdraw-amount"),
        destination_type: getValue("lgp-withdraw-type"),
        pin: getValue("lgp-withdraw-pin")
      };
      if (getValue("lgp-withdraw-reference")) body.destination_reference = getValue("lgp-withdraw-reference");
      let data;
      try {
        data = await api("/api/withdrawals", { method: "POST", body, idempotency: true });
      } finally {
        $("#lgp-withdraw-pin").value = "";
      }
      $("#lgp-withdrawal-id").value = data.withdrawal?.withdrawal_id || "";
      result("Demann retrè kreye epi kantite lajan an rezève. Pa gen peman deyò ki fèt.", "success");
      log("Demann retrè", data);
      await loadAccount();
    } else if (action === "admin-check") {
      const data = await api("/api/admin/me");
      $("#lgp-admin-status").textContent = JSON.stringify(data, null, 2);
      $("#lgp-admin-card").hidden = !data.is_admin;
      if (data.is_admin) {
        $("#lgp-mfa-card").hidden = false;
        if (data.aal2) await loadAgentApplications();
      }
      result(data.is_admin ? (data.aal2 ? "Dwa admin verifye. Louvri Sant Kontwòl la pou jere sistèm nan." : "Wòl admin konfime; aktive MFA TOTP anvan aksyon privilejye.") : "Kont sa a pa gen wòl admin.", data.is_admin ? "success" : "error");
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
  const toolsDetails = $("#lgp-advanced-tools");
  if (toolsDetails) toolsDetails.open = true;
  const payCard = $("#lgp-pay-card");
  if (payCard) payCard.hidden = !Boolean(supabase);
  setTimeout(() => {
    const tokenInput = $("#lgp-qr-token");
    if (tokenInput) tokenInput.value = queryToken;
  }, 0);
}
