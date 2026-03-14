let token = localStorage.getItem("token");
let currentPermissions = {};

function $(id) { return document.getElementById(id); }

function formatDashboardDate(date = new Date()) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function updateDashboardHero() {
  const hours = new Date().getHours();
  let greeting = "Guten Morgen";
  if (hours >= 18) greeting = "Guten Abend";
  else if (hours >= 12) greeting = "Guten Tag";

  const greetingEl = $("dashboardGreeting");
  const dateEl = $("dashboardDate");

  if (greetingEl) greetingEl.textContent = `${greeting}, willkommen im Dashboard`;
  if (dateEl) dateEl.textContent = formatDashboardDate();
}

function getVisibleModuleLinks() {
  return Array.from(document.querySelectorAll(".module-grid .module-button")).filter((link) => {
    if (link.hidden) return false;
    if (link.style.display === "none") return false;
    return window.getComputedStyle(link).display !== "none";
  });
}

function refreshModuleSummary() {
  const visibleLinks = getVisibleModuleLinks();
  const count = visibleLinks.length;
  const countEl = $("moduleCount");
  const stateEl = $("moduleAccessState");
  const primaryEl = $("dashboardPrimaryModule");
  const msgEl = $("moduleMsg");
  const firstLink = visibleLinks[0];
  const firstName = firstLink?.dataset?.moduleName || "Kein Modul verfuegbar";
  const firstSummary = firstLink?.dataset?.moduleSummary || "Aktuell ist kein Bereich fuer dieses Konto freigeschaltet.";

  if (countEl) countEl.textContent = String(count);
  if (stateEl) stateEl.textContent = count > 0 ? `${count} Bereich${count === 1 ? "" : "e"} aktiv` : "Keine Freigabe";
  if (primaryEl) primaryEl.textContent = count > 0 ? `${firstName}: ${firstSummary}` : firstSummary;

  if (msgEl && (!msgEl.dataset.messageType || msgEl.dataset.messageType === "summary")) {
    msgEl.dataset.messageType = "summary";
    msgEl.style.color = "";
    msgEl.textContent = count > 0
      ? `${count} Modul${count === 1 ? "" : "e"} stehen bereit.`
      : "Aktuell ist kein Modul fuer dieses Konto freigeschaltet.";
  }
}

function sanitizeDashboardUrl() {
  const url = new URL(window.location.href);
  const hadSsoToken = url.searchParams.has("ssoToken");
  const hadSessionToken = url.searchParams.has("session");
  const hadToken = url.searchParams.has("token");
  if (!hadSsoToken && !hadSessionToken && !hadToken) return;

  url.searchParams.delete("ssoToken");
  url.searchParams.delete("session");
  url.searchParams.delete("token");
  url.searchParams.delete("user");
  history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

async function trySsoIntake() {
  const params = new URLSearchParams(window.location.search);
  const ssoToken = String(params.get("token") || params.get("ssoToken") || params.get("session") || "").trim();
  if (!ssoToken) return false;

  try {
    const response = await fetch("/api/auth/sso-exchange", {
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: ssoToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.token) {
      await logout();
      return false;
    }

    localStorage.setItem("token", data.token);
    token = data.token;
    sanitizeDashboardUrl();
    return true;
  } catch {
    await logout();
    return false;
  }
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

function setMsg(elId, text, ok = false) {
  const el = $(elId);
  if (!el) return;
  el.dataset.messageType = text ? (ok ? "success" : "error") : "";
  el.style.color = ok ? "#0a7a2f" : "#b00020";
  el.textContent = text || "";
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST", headers: {} });
  } catch {
    // ignore transport errors
  }
  localStorage.removeItem("token");
  window.location.href = "/login.html";
}

function showPasswordModal(show) {
  const back = $("passwordModalBack");
  if (!back) return;
  back.style.display = show ? "flex" : "none";
  back.setAttribute("aria-hidden", show ? "false" : "true");
}

function closeSettingsMenu() {
  const menu = $("settingsMenu");
  const trigger = $("settingsTriggerBtn");
  if (!menu || !trigger) return;
  menu.classList.remove("open");
  trigger.setAttribute("aria-expanded", "false");
}

function openSettingsMenu() {
  const menu = $("settingsMenu");
  const trigger = $("settingsTriggerBtn");
  if (!menu || !trigger) return;
  menu.classList.add("open");
  trigger.setAttribute("aria-expanded", "true");
}

function bindSettingsMenu() {
  const trigger = $("settingsTriggerBtn");
  const wrap = $("settingsMenuWrap");
  const menu = $("settingsMenu");
  const darkmodeBtn = $("menuDarkmodeBtn");
  const openPasswordBtn = $("openChangePasswordBtn");
  const openAdminBtn = $("openAdminBtn");
  if (!trigger || !wrap || !menu) return;

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.classList.contains("open")) closeSettingsMenu();
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

  darkmodeBtn?.addEventListener("click", () => {
    $("themeToggleBtn")?.click();
    closeSettingsMenu();
  });

  openPasswordBtn?.addEventListener("click", () => {
    closeSettingsMenu();
    setMsg("passwordModalMsg", "", true);
    $("currentPassword").value = "";
    $("newPassword").value = "";
    $("confirmPassword").value = "";
    showPasswordModal(true);
  });

  openAdminBtn?.addEventListener("click", () => {
    closeSettingsMenu();
    window.location.href = "/public/admin.html";
  });
}

function bindPasswordModal() {
  const back = $("passwordModalBack");
  const closeBtn = $("closePasswordModalBtn");
  const cancelBtn = $("cancelPasswordBtn");
  const saveBtn = $("savePasswordBtn");
  if (!back || !closeBtn || !cancelBtn || !saveBtn) return;

  const close = () => showPasswordModal(false);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  back.addEventListener("click", (event) => {
    if (event.target === back) close();
  });

  saveBtn.addEventListener("click", async () => {
    const current_password = String($("currentPassword").value || "").trim();
    const new_password = String($("newPassword").value || "").trim();
    const confirm_password = String($("confirmPassword").value || "").trim();

    if (!current_password || !new_password || !confirm_password) {
      setMsg("passwordModalMsg", "Bitte alle Felder ausfuellen.");
      return;
    }
    if (new_password.length < 8) {
      setMsg("passwordModalMsg", "Das neue Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (new_password !== confirm_password) {
      setMsg("passwordModalMsg", "Die neuen Passwoerter stimmen nicht ueberein.");
      return;
    }

    saveBtn.disabled = true;
    setMsg("passwordModalMsg", "Passwort wird gespeichert ...", true);
    try {
      const r = await api("/api/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password, new_password })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg("passwordModalMsg", data?.error || "Passwort konnte nicht geaendert werden.");
        return;
      }
      setMsg("passwordModalMsg", "Passwort erfolgreich geaendert.", true);
      setTimeout(() => showPasswordModal(false), 700);
    } catch {
      setMsg("passwordModalMsg", "Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      saveBtn.disabled = false;
    }
  });
}

async function bindModuleLink(linkId, endpoint, loadingText, unavailableText) {
  const link = $(linkId);
  if (!link) return;

  link.addEventListener("click", async (event) => {
    event.preventDefault();
    if (link.dataset.loading === "1") return;

    link.dataset.loading = "1";
    const originalContent = link.innerHTML;
    link.setAttribute("aria-busy", "true");
    link.innerHTML = `<span class="module-button__loading">${loadingText}</span>`;

    try {
      const r = await api(endpoint, { method: "GET", headers: {} });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.url) {
        setMsg("moduleMsg", data?.error || unavailableText);
        return;
      }
      window.location.href = data.url;
    } catch {
      setMsg("moduleMsg", unavailableText);
    } finally {
      link.dataset.loading = "0";
      link.removeAttribute("aria-busy");
      link.innerHTML = originalContent;
    }
  });
}

async function loadMeAndPermissions() {
  const meResponse = await api("/api/me", { method: "GET", headers: {} });
  if (!meResponse.ok) {
    await logout();
    return false;
  }

  const me = await meResponse.json();
  $("me").textContent = `${me.username} • ${me.business_role_name || "-"}`;

  const permsResponse = await api("/api/my-permissions", { method: "GET", headers: {} });
  currentPermissions = permsResponse.ok ? await permsResponse.json() : {};

  const canOpenAdmin = !!(
    me.role === "admin"
    || currentPermissions?.admin?.full_access
    || currentPermissions?.roles?.manage
    || currentPermissions?.users?.manage
  );
  const canUseContainerRegistration = !!(
    currentPermissions?.integrations?.container_login
    || currentPermissions?.integrations?.container_registration
    || currentPermissions?.integrations?.container_admin
  );
  const canUseContainerPlanning = !!(
    currentPermissions?.integrations?.container_planning
    || currentPermissions?.integrations?.container_admin
  );

  if ($("openAdminBtn")) $("openAdminBtn").style.display = canOpenAdmin ? "" : "none";
  if ($("containerAdminLink")) $("containerAdminLink").style.display = canUseContainerRegistration ? "" : "none";
  if ($("containerPlanningLink")) $("containerPlanningLink").style.display = canUseContainerPlanning ? "" : "none";
  refreshModuleSummary();

  return true;
}

$("logoutBtn")?.addEventListener("click", () => {
  closeSettingsMenu();
  logout();
});

(async () => {
  bindSettingsMenu();
  bindPasswordModal();
  updateDashboardHero();
  refreshModuleSummary();

  await trySsoIntake();

  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const ready = await loadMeAndPermissions();
  if (!ready) return;

  await bindModuleLink(
    "containerAdminLink",
    "/api/container-registration-session",
    "Container Anmeldung wird geoeffnet ...",
    "Container Anmeldung ist aktuell nicht verfuegbar."
  );
  await bindModuleLink(
    "containerPlanningLink",
    "/api/container-planning-session",
    "Container und LKW Planung wird geoeffnet ...",
    "Container und LKW Planung ist aktuell nicht verfuegbar."
  );
})();
