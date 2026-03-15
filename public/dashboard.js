let token = localStorage.getItem("token");
let coreContext = null;
let liveFeedTimer = null;

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
        <rect x="13" y="8" width="38" height="48" rx="2" fill="#FFE2A0" stroke="#0B0B12" stroke-width="3"></rect>
        <rect x="19" y="12" width="6" height="40" fill="#FFC24D"></rect>
        <rect x="31" y="12" width="6" height="40" fill="#FFC24D"></rect>
        <rect x="43" y="12" width="6" height="40" fill="#FFC24D"></rect>
      </svg>
    `;
  }
  if (moduleKey === "warehouse") {
    return `
      <svg viewBox="0 0 96 64" focusable="false" aria-hidden="true">
        <rect x="16" y="12" width="64" height="36" rx="4" fill="#E6FFFB" stroke="#08131F" stroke-width="3"></rect>
        <rect x="24" y="20" width="12" height="20" fill="#5EEAD4"></rect>
        <rect x="42" y="20" width="12" height="20" fill="#2DD4BF"></rect>
        <rect x="60" y="20" width="12" height="20" fill="#14B8A6"></rect>
      </svg>
    `;
  }
  if (moduleKey === "container_registration") {
    return `
      <svg viewBox="0 0 96 64" focusable="false" aria-hidden="true">
        <path d="M12 45V30h11l6-7h17v22z" fill="#FF5A7F" stroke="#09090F" stroke-width="3" stroke-linejoin="round"></path>
        <rect x="31" y="17" width="40" height="26" fill="#FFD369" stroke="#09090F" stroke-width="3"></rect>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 96 64" focusable="false" aria-hidden="true">
      <path d="M12 43V27h12l6-7h18v23z" fill="#3D8CFF" stroke="#11111A" stroke-width="3" stroke-linejoin="round"></path>
      <rect x="31" y="13" width="47" height="30" rx="2" fill="#FF4457" stroke="#11111A" stroke-width="3"></rect>
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
  $("installationName").textContent = coreContext?.installation?.name || coreContext?.customer?.name || "Keine Installation";
  $("accessSummary").textContent = coreContext?.user?.is_app_admin ? "App Admin" : "Organisationskontext";

  const canCustomerAdmin = Boolean(coreContext?.admin?.can_open_customer_admin);
  const canPalletAdmin = Boolean(coreContext?.admin?.can_open_pallet_admin);
  const canAppAdmin = Boolean(coreContext?.admin?.can_open_app_admin);

  $("openCustomerAdminBtn").style.display = canCustomerAdmin ? "" : "none";
  $("quickCustomerAdminBtn").style.display = canCustomerAdmin ? "" : "none";
  $("openPalletAdminBtn").style.display = canPalletAdmin ? "" : "none";
  $("quickPalletAdminBtn").style.display = canPalletAdmin ? "" : "none";
  $("openAppAdminBtn").style.display = canAppAdmin ? "" : "none";
  $("quickAppAdminBtn").style.display = canAppAdmin ? "" : "none";

  $("quickCustomerAdminBtn")?.addEventListener("click", () => window.location.href = "/admin.html");
  $("quickPalletAdminBtn")?.addEventListener("click", () => window.location.href = "/modules/pallets/admin.html");
  $("quickAppAdminBtn")?.addEventListener("click", () => window.location.href = "/app-admin.html");

  renderModules();
}

async function loadCoreContext() {
  const response = await api("/api/core/context", { method: "GET", headers: {} });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login.html";
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
