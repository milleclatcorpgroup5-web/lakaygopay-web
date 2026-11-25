(() => {
  "use strict";
  const LANG_KEY = "lakaygopay_language";
  const translations = {
    ht: { language:"Lang", clientKicker:"ESPAS FINANSYE OU", home:"Akèy", send:"Voye", receive:"Resevwa", scan:"Eskane QR", history:"Aktivite", profile:"Pwofil", walletTitle:"Bous mwen yo", sendTitle:"Voye lajan", receiveTitle:"Resevwa lajan", scanTitle:"Peye ak QR", historyTitle:"Istwa tranzaksyon", profileTitle:"Pwofil ak sèvis", sendAction:"Voye lajan", receiveAction:"Resevwa lajan", scanAction:"Eskane QR", historyAction:"Dènye tranzaksyon yo", viewAll:"Wè tout aktivite", merchantGreeting:"Bonjou, Machann!", merchantIntro:"Kwaze biznis ou, grandi pi lwen.", merchantHome:"Akèy", merchantAccept:"Aksepte peman", merchantHistory:"Tranzaksyon", merchantBack:"Retounen Espas Kliyan", adminTitle:"Administration", adminOverview:"Apèsi", adminOperations:"Operasyon", adminFinance:"Finans", adminSecurity:"Sekirite", adminTeam:"Ekip" },
    fr: { language:"Langue", clientKicker:"VOTRE ESPACE FINANCIER", home:"Accueil", send:"Envoyer", receive:"Recevoir", scan:"Scanner QR", history:"Activité", profile:"Profil", walletTitle:"Mes portefeuilles", sendTitle:"Envoyer de l'argent", receiveTitle:"Recevoir de l'argent", scanTitle:"Payer par QR", historyTitle:"Historique des transactions", profileTitle:"Profil et services", sendAction:"Envoyer de l'argent", receiveAction:"Recevoir de l'argent", scanAction:"Scanner un QR", historyAction:"Dernières transactions", viewAll:"Voir toute l'activité", merchantGreeting:"Bonjour, commerçant !", merchantIntro:"Développez votre activité en toute simplicité.", merchantHome:"Accueil", merchantAccept:"Accepter un paiement", merchantHistory:"Transactions", merchantBack:"Retour à l'espace client", adminTitle:"Administration", adminOverview:"Vue d'ensemble", adminOperations:"Opérations", adminFinance:"Finances", adminSecurity:"Sécurité", adminTeam:"Équipe" },
    en: { language:"Language", clientKicker:"YOUR FINANCIAL SPACE", home:"Home", send:"Send", receive:"Receive", scan:"Scan QR", history:"Activity", profile:"Profile", walletTitle:"My wallets", sendTitle:"Send money", receiveTitle:"Receive money", scanTitle:"Pay with QR", historyTitle:"Transaction history", profileTitle:"Profile and services", sendAction:"Send money", receiveAction:"Receive money", scanAction:"Scan QR", historyAction:"Recent transactions", viewAll:"View all activity", merchantGreeting:"Hello, Merchant!", merchantIntro:"Grow your business with simpler payments.", merchantHome:"Home", merchantAccept:"Accept payment", merchantHistory:"Transactions", merchantBack:"Back to Customer Space", adminTitle:"Administration", adminOverview:"Overview", adminOperations:"Operations", adminFinance:"Finance", adminSecurity:"Security", adminTeam:"Team" }
  };
  let lang = "ht";
  try { const saved = localStorage.getItem(LANG_KEY); if (translations[saved]) lang = saved; } catch {}
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const tr = (key) => translations[lang]?.[key] || translations.ht[key] || key;
  function applyTranslations(root=document) {
    $$("[data-lgp-i18n]", root).forEach(node => {
      const key = node.dataset.lgpI18n;
      if (translations[lang]?.[key]) node.textContent = tr(key);
    });
    document.documentElement.lang = lang;
  }
  function addLanguageControl() {
    const host = $(".topbar-right") || $(".top-actions");
    if (!host || $("#lgpLanguageControl")) return;
    const label = document.createElement("label");
    label.id = "lgpLanguageControl";
    label.className = "lgp-language-control";
    label.innerHTML = '<span data-lgp-i18n="language">Lang</span><select aria-label="Chwazi lang"><option value="ht">Kreyòl</option><option value="fr">Français</option><option value="en">English</option></select>';
    const select = $("select", label);
    select.value = lang;
    select.addEventListener("change", () => {
      lang = translations[select.value] ? select.value : "ht";
      try { localStorage.setItem(LANG_KEY, lang); } catch {}
      applyTranslations(document);
    });
    host.prepend(label);
    applyTranslations(label);
  }
  function navButton(key, icon, screen) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lgp-nav-item";
    button.dataset.lgpScreen = screen;
    button.setAttribute("aria-current", screen === "home" ? "page" : "false");
    const glyph = document.createElement("span");
    glyph.className = "lgp-nav-icon";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = icon;
    const text = document.createElement("span");
    text.dataset.lgpI18n = key;
    text.textContent = tr(key);
    button.append(glyph, text);
    return button;
  }
  function makeScreen(id, titleKey) {
    const screen = document.createElement("section");
    screen.className = "lgp-screen";
    screen.dataset.lgpScreenPanel = id;
    screen.hidden = id !== "home";
    const heading = document.createElement("div");
    heading.className = "lgp-screen-heading";
    const title = document.createElement("h2");
    title.dataset.lgpI18n = titleKey;
    title.textContent = tr(titleKey);
    heading.append(title);
    screen.append(heading);
    return screen;
  }
  function activateScreen(workspace, screenId) {
    $$("[data-lgp-screen-panel]", workspace).forEach(panel => panel.hidden = panel.dataset.lgpScreenPanel !== screenId);
    $$("[data-lgp-screen]", workspace).forEach(button => {
      const active = button.dataset.lgpScreen === screenId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    window.scrollTo({ top:0, behavior:"smooth" });
  }
  function decorateClient() {
    const app = $("#appView"), workspace = $("#clientWorkspace");
    if (!app || !workspace || workspace.dataset.lgpReady === "1") return;
    workspace.dataset.lgpReady = "1";
    workspace.classList.add("lgp-client-workspace");
    const welcome = $(".welcome-row", app);
    if (welcome) {
      welcome.classList.add("lgp-client-welcome");
      const eyebrow = $(".eyebrow", welcome);
      if (eyebrow) eyebrow.dataset.lgpI18n = "clientKicker";
      workspace.prepend(welcome);
    }
    const oldNav = $(".app-quick-nav", workspace);
    if (oldNav) oldNav.hidden = true;
    const definitions = [["home","walletTitle"],["send","sendTitle"],["receive","receiveTitle"],["scan","scanTitle"],["history","historyTitle"],["profile","profileTitle"]];
    const screens = new Map(definitions.map(([id,key]) => [id,makeScreen(id,key)]));
    const placements = {
      home:["walletSection"],
      send:["transferSection"],
      receive:["personalReceiveSection"],
      scan:["qrPaymentSection"],
      history:["activitySection"],
      profile:["profileSection","settingsPanel","cardProgramSection","exchangeQuoteSection","withdrawalSection","connectPayoutsSection","agentSection"]
    };
    Object.entries(placements).forEach(([screenId,ids]) => ids.forEach(id => {
      const node = document.getElementById(id);
      if (node && workspace.contains(node)) screens.get(screenId).append(node);
    }));
    const agentCash = $("#agentCashWorkspace", app);
    if (agentCash) screens.get("profile").append(agentCash);

    const actions = document.createElement("div");
    actions.className = "lgp-home-actions";
    [["sendAction","↗","send"],["receiveAction","↓","receive"],["scanAction","▦","scan"],["historyAction","◷","history"]].forEach(([key,icon,id]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lgp-action-tile";
      button.dataset.lgpGoScreen = id;
      const glyph = document.createElement("span");
      glyph.className = "lgp-action-icon";
      glyph.textContent = icon;
      const label = document.createElement("span");
      label.dataset.lgpI18n = key;
      label.textContent = tr(key);
      button.append(glyph,label);
      actions.append(button);
    });
    screens.get("home").append(actions);
    const allActivity = document.createElement("button");
    allActivity.type = "button";
    allActivity.className = "lgp-recent-link";
    allActivity.dataset.lgpGoScreen = "history";
    allActivity.dataset.lgpI18n = "viewAll";
    allActivity.textContent = tr("viewAll");
    screens.get("home").append(allActivity);

    const nav = document.createElement("nav");
    nav.className = "lgp-workspace-nav lgp-client-nav";
    nav.setAttribute("aria-label","Navigasyon Espas Kliyan");
    [["home","⌂","home"],["send","↗","send"],["receive","↓","receive"],["scan","▦","scan"],["history","◷","history"],["profile","♙","profile"]].forEach(item => nav.append(navButton(...item)));
    const screenHost = document.createElement("div");
    screenHost.className = "lgp-screen-host";
    definitions.forEach(([id]) => screenHost.append(screens.get(id)));
    workspace.append(nav,screenHost);
    workspace.addEventListener("click",event => {
      const action = event.target.closest("[data-lgp-go-screen]");
      const tab = event.target.closest("[data-lgp-screen]");
      if (action) activateScreen(workspace,action.dataset.lgpGoScreen);
      else if (tab) activateScreen(workspace,tab.dataset.lgpScreen);
    });
    const headings = [["#walletSection .section-heading h2","walletTitle"],["#transferSection h2","sendTitle"],["#personalReceiveSection h2","receiveTitle"],["#qrPaymentSection h2","scanTitle"],["#activitySection h2","historyTitle"],["#profileSection h2","profileTitle"]];
    headings.forEach(([selector,key]) => { const el=$(selector,workspace); if(el) el.dataset.lgpI18n=key; });
    document.body.classList.add("lgp-client-redesigned");
    applyTranslations(workspace);
  }
  function decorateMerchant() {
    const workspace = $("#merchantWorkspace"), section=$("#merchantSection");
    if (!workspace || !section || workspace.dataset.lgpReady === "1") return;
    workspace.dataset.lgpReady = "1";
    workspace.classList.add("lgp-merchant-workspace");
    section.classList.add("lgp-merchant-root");
    const intro = $(".merchant-workspace-heading",workspace);
    if (intro) {
      const h = $("h2",intro), p=$(".muted",intro), back=$("#clientQuickLink",intro);
      if(h){h.dataset.lgpI18n="merchantGreeting";h.textContent=tr("merchantGreeting");}
      if(p){p.dataset.lgpI18n="merchantIntro";p.textContent=tr("merchantIntro");}
      if(back){back.dataset.lgpI18n="merchantBack";back.textContent=tr("merchantBack");}
    }
    const firstHeading=$(".section-heading",section), details=$("#merchantDetails"), qr=$("#merchantQrPanel");
    const oldHistoryTitle=$(".merchant-history-title",qr || section), oldList=$("#merchantPaymentsList",qr || section);
    const overview=document.createElement("section");
    overview.className="lgp-merchant-screen";overview.dataset.lgpMerchantPanel="overview";
    if(firstHeading) overview.append(firstHeading);
    if(details) overview.append(details);
    const quick=document.createElement("div");quick.className="lgp-merchant-quick-actions";
    [["merchantAccept","▦","accept"],["merchantHistory","◷","history"]].forEach(([key,icon,id])=>{
      const b=document.createElement("button");b.type="button";b.className="lgp-action-tile";b.dataset.lgpMerchantGo=id;
      const g=document.createElement("span");g.className="lgp-action-icon";g.textContent=icon;
      const l=document.createElement("span");l.dataset.lgpI18n=key;l.textContent=tr(key);b.append(g,l);quick.append(b);
    });
    overview.append(quick);
    const accept=document.createElement("section");accept.className="lgp-merchant-screen";accept.dataset.lgpMerchantPanel="accept";accept.hidden=true;
    if(qr){qr.classList.add("lgp-merchant-qr-card");if(oldHistoryTitle)oldHistoryTitle.remove();if(oldList)oldList.remove();accept.append(qr);}
    const history=document.createElement("section");history.className="lgp-merchant-screen";history.dataset.lgpMerchantPanel="history";history.hidden=true;
    const head=document.createElement("h2");head.dataset.lgpI18n="merchantHistory";head.textContent=tr("merchantHistory");history.append(head);
    if(oldHistoryTitle)oldHistoryTitle.remove();if(oldList)history.append(oldList);
    section.replaceChildren(overview,accept,history);
    const nav=document.createElement("nav");nav.className="lgp-workspace-nav lgp-merchant-nav";nav.setAttribute("aria-label","Navigasyon Espas Machann");
    [["merchantHome","⌂","overview"],["merchantAccept","▦","accept"],["merchantHistory","◷","history"]].forEach(([key,icon,id],index)=>{
      const b=document.createElement("button");b.type="button";b.className="lgp-nav-item"+(index===0?" active":"");b.dataset.lgpMerchantScreen=id;b.setAttribute("aria-current",index===0?"page":"false");
      const g=document.createElement("span");g.className="lgp-nav-icon";g.textContent=icon;
      const l=document.createElement("span");l.dataset.lgpI18n=key;l.textContent=tr(key);b.append(g,l);nav.append(b);
    });
    workspace.insertBefore(nav,section);
    workspace.addEventListener("click",event=>{
      const trigger=event.target.closest("[data-lgp-merchant-screen],[data-lgp-merchant-go]");
      if(!trigger)return;
      const target=trigger.dataset.lgpMerchantScreen || trigger.dataset.lgpMerchantGo;
      $$("[data-lgp-merchant-panel]",section).forEach(panel=>panel.hidden=panel.dataset.lgpMerchantPanel!==target);
      $$("[data-lgp-merchant-screen]",workspace).forEach(b=>{const active=b.dataset.lgpMerchantScreen===target;b.classList.toggle("active",active);b.setAttribute("aria-current",active?"page":"false");});
      window.scrollTo({top:0,behavior:"smooth"});
    });
    applyTranslations(workspace);
  }
  function decorateAdmin() {
    const view=$("#adminView"), nav=$(".admin-quick-nav",view);
    if(!view || !nav || view.dataset.lgpReady==="1") return;
    view.dataset.lgpReady="1";
    const shell=document.createElement("div");shell.className="lgp-admin-shell";
    const sidebar=document.createElement("aside");sidebar.className="lgp-admin-sidebar";
    sidebar.innerHTML='<div class="lgp-admin-side-brand"><span class="lgp-admin-shield">✓</span><span><strong>LakayGoPay</strong><small data-lgp-i18n="adminTitle">Administration</small></span></div>';
    const caption=document.createElement("p");caption.className="lgp-admin-side-caption";caption.textContent="MENI ADMINISTRASYON";
    const main=document.createElement("div");main.className="lgp-admin-main";
    const keys=["adminOverview","adminOperations","adminFinance","adminSecurity","adminTeam"];
    $$("a",nav).forEach((link,index)=>{if(keys[index])link.dataset.lgpI18n=keys[index];});
    nav.classList.add("lgp-admin-nav");
    sidebar.append(caption,nav);
    Array.from(view.children).filter(child=>child!==shell).forEach(child=>main.append(child));
    shell.append(sidebar,main);view.append(shell);
    $$(".admin-workspace-group > summary",main).forEach((summary,index)=>{if(keys[index])summary.dataset.lgpI18n=keys[index];});
    document.body.classList.add("lgp-admin-redesigned");
    applyTranslations(shell);
  }
  function init() {
    addLanguageControl();
    decorateClient();
    decorateMerchant();
    decorateAdmin();
    const observer=new MutationObserver(()=>{
      if(!$("#clientWorkspace")?.dataset.lgpReady)decorateClient();
      if(!$("#merchantWorkspace")?.dataset.lgpReady)decorateMerchant();
      if($("#adminView") && !$("#adminView").dataset.lgpReady)decorateAdmin();
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();