let token = localStorage.getItem("token");
let coreContext = null;
let liveFeedTimer = null;
let sessionRedirectInProgress = false;

function $(id) {
  return document.getElementById(id);
}

function api(path, opts = {}) {
  return fetch(path, {
    credentials: "include",
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {})
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setMsg(id, text, ok = false) {
  const el = $(id);
  if (!el) return;
  el.style.color = ok ? "#0a7a2f" : "#b00020";
  el.textContent = text || "";
}

async function redirectToLogin() {
  if (sessionRedirectInProgress) return;
  sessionRedirectInProgress = true;
  if (liveFeedTimer) {
    window.clearInterval(liveFeedTimer);
    liveFeedTimer = null;
  }
  try {
    await fetch("/api/logout", { method: "POST", credentials: "include" });
  } catch {}
  localStorage.removeItem("token");
  token = null;
  window.location.href = "/login.html";
}

function closeSettingsMenu() {
  $("settingsMenu")?.classList.remove("open");
  $("settingsTriggerBtn")?.setAttribute("aria-expanded", "false");
}

function openSettingsMenu() {
  $("settingsMenu")?.classList.add("open");
  $("settingsTriggerBtn")?.setAttribute("aria-expanded", "true");
}

function showPasswordModal(show) {
  const back = $("passwordModalBack");
  if (!back) return;
  back.style.display = show ? "flex" : "none";
  back.setAttribute("aria-hidden", show ? "false" : "true");
}

function formatFeedTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function updateGreeting() {
  const now = new Date();
  const minutes = (now.getHours() * 60) + now.getMinutes();
  let greeting = "Guten Abend";
  if (minutes >= 120 && minutes < 570) greeting = "Guten Morgen";
  else if (minutes >= 570 && minutes < 960) greeting = "Guten Tag";
  $("dashboardGreeting").textContent = greeting;
}

function showPasswordForm() {
  closeSettingsMenu();
  setMsg("passwordModalMsg", "", true);
  $("currentPassword").value = "";
  $("newPassword").value = "";
  $("confirmPassword").value = "";
  showPasswordModal(true);
}

function bindSettingsMenu() {
  const trigger = $("settingsTriggerBtn");
  const wrap = $("settingsMenuWrap");
  if (!trigger || !wrap) return;

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if ($("settingsMenu")?.classList.contains("open")) closeSettingsMenu();
    else openSettingsMenu();
  });

  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) closeSettingsMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSettingsMenu();
      showPasswordModal(false);
    }
  });

  $("openCustomerAdminBtn")?.addEventListener("click", () => {
    closeSettingsMenu();
    window.location.href = "/admin.html";
  });
  $("openPalletAdminBtn")?.addEventListener("click", () => {
    closeSettingsMenu();
    window.location.href = "/modules/pallets/admin.html";
  });
  $("openAppAdminBtn")?.addEventListener("click", () => {
    closeSettingsMenu();
    window.location.href = "/app-admin.html";
  });
  $("openChangePasswordBtn")?.addEventListener("click", showPasswordForm);
  $("menuDarkmodeBtn")?.addEventListener("click", () => {
    $("themeToggleBtn")?.click();
    closeSettingsMenu();
  });
  $("logoutBtn")?.addEventListener("click", async () => {
    closeSettingsMenu();
    try {
      await api("/api/logout", { method: "POST", headers: {} });
    } catch {}
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  });
}

function bindPasswordModal() {
  $("closePasswordModalBtn")?.addEventListener("click", () => showPasswordModal(false));
  $("cancelPasswordBtn")?.addEventListener("click", () => showPasswordModal(false));
  $("passwordModalBack")?.addEventListener("click", (event) => {
    if (event.target === $("passwordModalBack")) showPasswordModal(false);
  });

  $("savePasswordBtn")?.addEventListener("click", async () => {
    const current_password = String($("currentPassword").value || "").trim();
    const new_password = String($("newPassword").value || "").trim();
    const confirm_password = String($("confirmPassword").value || "").trim();

    if (!current_password || !new_password || !confirm_password) {
      return setMsg("passwordModalMsg", "Bitte alle Felder ausfüllen.");
    }
    if (new_password.length < 8) {
      return setMsg("passwordModalMsg", "Das neue Passwort muss mindestens 8 Zeichen lang sein.");
    }
    if (new_password !== confirm_password) {
      return setMsg("passwordModalMsg", "Die Passwörter stimmen nicht überein.");
    }

    const response = await api("/api/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return setMsg("passwordModalMsg", data?.error || "Passwort konnte nicht gespeichert werden.");
    }
    setMsg("passwordModalMsg", "Passwort gespeichert.", true);
    window.setTimeout(() => showPasswordModal(false), 700);
  });
}

function moduleCardClass(moduleKey) {
  if (moduleKey === "pallets") return "module-button module-button--stacked module-button--pallet";
  if (moduleKey === "warehouse") return "module-button module-button--stacked module-button--warehouse";
  if (moduleKey === "container_registration") return "module-button module-button--stacked module-button--registration";
  if (moduleKey === "container_planning") return "module-button module-button--stacked module-button--planning";
  return "module-button module-button--stacked";
}

function moduleIcon(moduleKey) {
  if (moduleKey === "pallets") {
    return `
      <svg viewBox="0 0 64 64" focusable="false" aria-hidden="true">
        <rect x="8" y="42" width="48" height="6" rx="2" fill="#8B5A2B"></rect>
        <rect x="12" y="48" width="8" height="6" rx="1.5" fill="#6B4423"></rect>
        <rect x="28" y="48" width="8" height="6" rx="1.5" fill="#6B4423"></rect>
        <rect x="44" y="48" width="8" height="6" rx="1.5" fill="#6B4423"></rect>
        <rect x="12" y="22" width="14" height="18" rx="2" fill="#FFD66E" stroke="#0B0B12" stroke-width="3"></rect>
        <rect x="25" y="18" width="14" height="22" rx="2" fill="#FFC24D" stroke="#0B0B12" stroke-width="3"></rect>
        <rect x="38" y="22" width="14" height="18" rx="2" fill="#FFB347" stroke="#0B0B12" stroke-width="3"></rect>
        <path d="M19 22v18M32 18v22M45 22v18" stroke="#FFF4D1" stroke-width="2.5" stroke-linecap="round"></path>
      </svg>
    `;
  }
  if (moduleKey === "warehouse") {
    return `
      <svg viewBox="0 0 96 64" focusable="false" aria-hidden="true">
        <path d="M14 28L48 10l34 18v26H14z" fill="#FFF0C9" stroke="#0B1320" stroke-width="3" stroke-linejoin="round"></path>
        <rect x="22" y="28" width="18" height="24" rx="2" fill="#5EEAD4" stroke="#0B1320" stroke-width="3"></rect>
        <rect x="40" y="28" width="18" height="24" rx="2" fill="#E7FFF8" stroke="#0B1320" stroke-width="3"></rect>
        <rect x="58" y="28" width="16" height="24" rx="2" fill="#2DD4BF" stroke="#0B1320" stroke-width="3"></rect>
        <path d="M22 38h18M40 38h18M58 38h16" stroke="#0B1320" stroke-width="3"></path>
        <path d="M31 28v24M49 28v24M66 28v24" stroke="#0B1320" stroke-width="3"></path>
      </svg>
    `;
  }
  if (moduleKey === "container_registration") {
    return `
      <svg viewBox="0 0 96 64" focusable="false" aria-hidden="true">
        <path d="M10 46h76" stroke="#0C1020" stroke-width="3" stroke-linecap="round"></path>
        <path d="M18 42V18h10v24" stroke="#0C1020" stroke-width="3" stroke-linecap="round"></path>
        <path d="M68 42V18h10v24" stroke="#0C1020" stroke-width="3" stroke-linecap="round"></path>
        <rect x="24" y="20" width="28" height="18" rx="2" fill="#FFD369" stroke="#0C1020" stroke-width="3"></rect>
        <path d="M52 38V28h10l6-6h12v16z" fill="#FF5A7F" stroke="#0C1020" stroke-width="3" stroke-linejoin="round"></path>
        <path d="M30 29l5 5 10-12" fill="none" stroke="#0C1020" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 96 64" focusable="false" aria-hidden="true">
      <rect x="14" y="12" width="28" height="40" rx="4" fill="#EAF2FF" stroke="#11111A" stroke-width="3"></rect>
      <path d="M14 24h28" stroke="#11111A" stroke-width="3"></path>
      <path d="M22 16v8M34 16v8" stroke="#5B8CFF" stroke-width="4" stroke-linecap="round"></path>
      <path d="M20 31h16M20 39h12" stroke="#5B8CFF" stroke-width="3" stroke-linecap="round"></path>
      <path d="M44 44V29h12l6-7h20v22z" fill="#4C79FF" stroke="#11111A" stroke-width="3" stroke-linejoin="round"></path>
      <rect x="62" y="19" width="20" height="20" rx="2" fill="#FF5568" stroke="#11111A" stroke-width="3"></rect>
    </svg>
  `;
}

function renderModules() {
  const host = $("dashboardModuleGrid");
  const modules = Array.isArray(coreContext?.dashboard_modules) ? coreContext.dashboard_modules : [];
  $("moduleCount").textContent = String(modules.length);
  host.innerHTML = modules.length ? modules.map((module) => `
    <button class="${moduleCardClass(module.key)}" type="button" data-module-launch="${escapeHtml(module.launchPath)}">
      <div class="module-button__top">
        <span class="module-button__icon ${module.key === "pallets" ? "module-button__icon--square" : "module-button__icon--wide"}">${moduleIcon(module.key)}</span>
        <span class="module-button__tag">${escapeHtml(module.dashboard?.tag || module.licensing?.label || "Modul")}</span>
      </div>
      <div class="module-button__copy">
        <span class="module-button__eyebrow">${escapeHtml(module.dashboard?.eyebrow || "Bereich")}</span>
        <span class="module-button__title">${escapeHtml(module.name)}</span>
        <span class="module-button__description">${escapeHtml(module.dashboard?.description || "")}</span>
      </div>
      <div class="module-button__footer">
        <span class="module-button__linktext">Modul öffnen</span>
        <span class="module-button__arrow" aria-hidden="true">›</span>
      </div>
    </button>
  `).join("") : '<div class="module-feed__empty">Keine Module freigeschaltet.</div>';

  document.querySelectorAll("[data-module-launch]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = button.dataset.moduleLaunch;
    });
  });
}

function renderLiveFeed(items, message = "") {
  const host = $("dashboardLiveFeed");
  if (!host) return;
  if (message) {
    host.innerHTML = `<div class="module-feed__empty">${escapeHtml(message)}</div>`;
    return;
  }
  if (!items.length) {
    host.innerHTML = '<div class="module-feed__empty">Keine Aktivitäten.</div>';
    return;
  }
  host.innerHTML = items.map((item) => `
    <article class="module-feed__item">
      <div class="module-feed__top">
        <span class="module-feed__app">${escapeHtml(item.app || "Feed")}</span>
        <span class="module-feed__time">${escapeHtml(formatFeedTimestamp(item.at))}</span>
      </div>
      <div class="module-feed__title">${escapeHtml(item.title || "")}</div>
      <div class="module-feed__meta">${escapeHtml(item.meta || "")}</div>
    </article>
  `).join("");
}

async function loadLiveFeed() {
  const response = await api("/api/dashboard/live-feed?limit=8", { method: "GET", headers: {} });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    await redirectToLogin();
    return;
  }
  if (!response.ok) {
    renderLiveFeed([], data?.error || "Live Feed konnte nicht geladen werden.");
    return;
  }
  renderLiveFeed(Array.isArray(data?.items) ? data.items : []);
}

function startLiveFeed() {
  if (liveFeedTimer) window.clearInterval(liveFeedTimer);
  void loadLiveFeed();
  liveFeedTimer = window.setInterval(() => {
    if (!document.hidden) void loadLiveFeed();
  }, 30000);
}

function applyContextUi() {
  updateGreeting();
  $("me").textContent = coreContext?.user
    ? `${coreContext.user.username} - ${coreContext.user.business_role_name || "-"}`
    : "-";
  if ($("installationName")) {
    $("installationName").textContent = coreContext?.installation?.name || coreContext?.customer?.name || "Keine Installation";
  }
  if ($("dashboardLead")) {
    $("dashboardLead").textContent = "";
    $("dashboardLead").style.display = "none";
  }

  const canCustomerAdmin = Boolean(coreContext?.admin?.can_open_customer_admin);
  const canPalletAdmin = Boolean(coreContext?.admin?.can_open_pallet_admin);
  const canAppAdmin = Boolean(coreContext?.admin?.can_open_app_admin);
  const canViewAdminQuickAccess = Boolean(coreContext?.admin?.can_view_admin_quick_access);
  const showCustomerAdminEntry = canViewAdminQuickAccess && canCustomerAdmin;
  const showPalletAdminEntry = canViewAdminQuickAccess && canPalletAdmin;
  const showAppAdminEntry = canViewAdminQuickAccess && canAppAdmin;

  $("openCustomerAdminBtn").style.display = showCustomerAdminEntry ? "" : "none";
  $("quickCustomerAdminBtn").style.display = showCustomerAdminEntry ? "" : "none";
  $("openPalletAdminBtn").style.display = showPalletAdminEntry ? "" : "none";
  $("quickPalletAdminBtn").style.display = showPalletAdminEntry ? "" : "none";
  $("openAppAdminBtn").style.display = showAppAdminEntry ? "" : "none";
  $("quickAppAdminBtn").style.display = showAppAdminEntry ? "" : "none";

  const quickAccessVisible = showCustomerAdminEntry || showPalletAdminEntry || showAppAdminEntry;
  if ($("adminQuickCard")) $("adminQuickCard").style.display = quickAccessVisible ? "" : "none";
  if ($("adminQuickGrid")) $("adminQuickGrid").style.display = quickAccessVisible ? "" : "none";
  if ($("adminQuickEmpty")) $("adminQuickEmpty").style.display = quickAccessVisible ? "none" : "";

  if ($("quickCustomerAdminBtn")) $("quickCustomerAdminBtn").onclick = () => window.location.href = "/admin.html";
  if ($("quickPalletAdminBtn")) $("quickPalletAdminBtn").onclick = () => window.location.href = "/modules/pallets/admin.html";
  if ($("quickAppAdminBtn")) $("quickAppAdminBtn").onclick = () => window.location.href = "/app-admin.html";

  renderModules();
}

async function loadCoreContext() {
  const response = await api("/api/core/context", { method: "GET", headers: {} });
  if (!response.ok) {
    if (response.status === 401) {
      await redirectToLogin();
      return false;
    }
    const data = await response.json().catch(() => ({}));
    setMsg("moduleMsg", data?.error || "Dashboard konnte nicht geladen werden.");
    return false;
  }
  coreContext = await response.json();
  applyContextUi();
  return true;
}

(async function init() {
  bindSettingsMenu();
  bindPasswordModal();
  const ok = await loadCoreContext();
  if (!ok) return;
  startLiveFeed();
})();
