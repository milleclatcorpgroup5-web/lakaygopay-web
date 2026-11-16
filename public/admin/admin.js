import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const $ = (selector) => document.querySelector(selector);
let supabase = null;

function setNotice(selector, message, kind) {
  const node = $(selector);
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
    ADMIN_ACCESS_DENIED: "Kont sa a pa gen wòl administratè. Antre ak kont ki resevwa otorizasyon admin.",
    ADMIN_ROLE_SYSTEM_NOT_READY: "Sistèm wòl administratè a poko disponib nan bazdone aktif la. Aksè a rete bloke pou sekirite.",
    ADMIN_ACCESS_CHECK_FAILED: "Nou pa kapab verifye dwa aksè administratè a kounye a.",
    AUTH_REQUIRED: "Konekte pou kontinye.",
    INVALID_OR_EXPIRED_SESSION: "Sesyon an ekspire. Konekte ankò.",
    ADMIN_OVERVIEW_UNAVAILABLE: "Apèsi administrasyon an pa disponib kounye a."
  };
  return messages[code] || "Yon erè rive. Kòd: " + (code || "UNKNOWN");
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
  setNotice("#dashboardNotice", "Aksè admin konfime sou sèvè a.", "success");
}

async function refreshCurrent() {
  const result = await supabase.auth.getSession();
  const session = result.data && result.data.session;
  if (!session) {
    $("#adminView").hidden = true;
    $("#loginView").hidden = false;
    $("#refreshButton").hidden = true;
    $("#logoutButton").hidden = true;
    return;
  }
  await loadOverview(session);
}

async function boot() {
  const configResponse = await fetch("/api/config", { headers: { accept: "application/json" }, cache: "no-store" });
  const config = await configResponse.json().catch(() => ({}));
  if (!configResponse.ok || !config.configured || !config.supabaseUrl || !config.publishableKey) {
    setNotice("#loginNotice", "Koneksyon backend lan poko pare.", "error");
    return;
  }

  // Use a separate session key so the admin portal does not sign out or overwrite
  // the customer's/merchant's session in the main LakayGoPay application.
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
    setNotice("#loginNotice", "Ap verifye koneksyon an…", "");
    try {
      const result = await supabase.auth.signInWithPassword({
        email: $("#emailInput").value.trim(),
        password: $("#passwordInput").value
      });
      if (result.error) throw result.error;
      const sessionResult = await supabase.auth.getSession();
      await loadOverview(sessionResult.data.session);
    } catch (error) {
      const code = error.code || error.message;
      setNotice("#loginNotice", explainError(code), "error");
      $("#adminView").hidden = true;
      $("#loginView").hidden = false;
      $("#passwordInput").value = "";
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
    await supabase.auth.signOut();
    $("#adminView").hidden = true;
    $("#loginView").hidden = false;
    $("#refreshButton").hidden = true;
    $("#logoutButton").hidden = true;
    $("#passwordInput").value = "";
    setNotice("#loginNotice", "Ou dekonekte nan sant kontwòl la.", "success");
  });

  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.data && sessionResult.data.session) {
    try {
      await loadOverview(sessionResult.data.session);
    } catch (error) {
      $("#adminView").hidden = true;
      $("#loginView").hidden = false;
      setNotice("#loginNotice", error.message, "error");
      await supabase.auth.signOut();
    }
  }
}

boot().catch(() => setNotice("#loginNotice", "Sant kontwòl la pa kapab kòmanse kounye a.", "error"));
