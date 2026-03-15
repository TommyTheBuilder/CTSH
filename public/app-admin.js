let token = localStorage.getItem("token");
let coreContext = null;
let installation = null;
let productModules = [];
let users = [];
let selectedUserId = "";
let installationOptions = { roles: [], locations: [], departments: [] };

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

function optionMarkup(items, placeholder, allowEmpty = true) {
  const prefix = allowEmpty ? `<option value="">${placeholder}</option>` : "";
  return prefix + items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
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

  $("openDashboardBtn")?.addEventListener("click", () => {
    closeSettingsMenu();
    window.location.href = "/dashboard.html";
  });

  $("openCustomerAdminBtn")?.addEventListener("click", () => {
    closeSettingsMenu();
    window.location.href = "/admin.html";
  });

  $("openChangePasswordBtn")?.addEventListener("click", () => {
    closeSettingsMenu();
    setMsg("passwordModalMsg", "", true);
    $("currentPassword").value = "";
    $("newPassword").value = "";
    $("confirmPassword").value = "";
    showPasswordModal(true);
  });

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
    if (!response.ok) return setMsg("passwordModalMsg", data?.error || "Passwort konnte nicht gespeichert werden.");
    setMsg("passwordModalMsg", "Passwort gespeichert.", true);
    window.setTimeout(() => showPasswordModal(false), 700);
  });
}

function renderInstallationEditor() {
  $("activeInstallationLabel").textContent = installation?.name || "-";
  $("editInstallationName").value = installation?.name || "";
  $("editInstallationSlug").value = installation?.slug || "";
  $("editInstallationActive").value = installation?.is_active ? "true" : "false";
}

function renderProductModules() {
  $("licensedModuleCount").textContent = String(productModules.filter((module) => module.is_enabled).length);
  $("productModuleList").innerHTML = productModules.map((module) => `
    <label class="module-checklist__item">
      <input
        type="checkbox"
        data-module-key="${escapeHtml(module.key)}"
        ${module.is_base_module ? "checked disabled" : (module.is_enabled ? "checked" : "")}
      >
      <span>
        <strong>${escapeHtml(module.name)}</strong>
        <small class="muted">${escapeHtml(module.license_label || "Zusatzmodul")}</small>
      </span>
    </label>
  `).join("");
}

function populateUserOptionSelects() {
  $("userRoleSelect").innerHTML = optionMarkup(installationOptions.roles || [], "Keine Rolle");
  $("userLocationSelect").innerHTML = optionMarkup(installationOptions.locations || [], "Kein Standort");
  $("userDepartmentSelect").innerHTML = optionMarkup(installationOptions.departments || [], "Keine feste Abteilung");
}

function renderUsers() {
  $("usersBody").innerHTML = users.map((user) => `
    <tr>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.business_role_name || "-")}</td>
      <td>${escapeHtml(user.location_name || "-")}</td>
      <td>${escapeHtml(user.fixed_department_name || "-")}</td>
      <td>${user.is_active ? "Aktiv" : "Inaktiv"}</td>
      <td>${user.is_app_admin ? "Ja" : "Nein"}</td>
    </tr>
  `).join("");

  $("appAdminUserSelect").innerHTML = users.length
    ? users.map((user) => `<option value="${user.id}">${escapeHtml(user.username)}</option>`).join("")
    : `<option value="">Keine Benutzer vorhanden</option>`;

  if (selectedUserId && !users.some((user) => String(user.id) === String(selectedUserId))) {
    selectedUserId = "";
  }
  if (!selectedUserId && users.length) selectedUserId = String(users[0].id);
  if (selectedUserId) $("appAdminUserSelect").value = selectedUserId;
  syncSelectedUser();
}

function syncSelectedUser() {
  const selectedId = selectedUserId || $("appAdminUserSelect").value;
  const user = users.find((entry) => String(entry.id) === String(selectedId));
  if (!user) {
    selectedUserId = "";
    $("userRoleSelect").value = "";
    $("userLocationSelect").value = "";
    $("userDepartmentSelect").value = "";
    $("userIsActiveSelect").value = "true";
    $("userIsAppAdminSelect").value = "false";
    return;
  }

  selectedUserId = String(user.id);
  $("userRoleSelect").value = user.role_id ? String(user.role_id) : "";
  $("userLocationSelect").value = user.location_id ? String(user.location_id) : "";
  $("userDepartmentSelect").value = user.fixed_department_id ? String(user.fixed_department_id) : "";
  $("userIsActiveSelect").value = user.is_active ? "true" : "false";
  $("userIsAppAdminSelect").value = user.is_app_admin ? "true" : "false";
}

function applyCoreUi() {
  $("me").textContent = coreContext?.user
    ? `${coreContext.user.username} - ${coreContext.user.business_role_name || "-"}`
    : "-";
}

async function loadCoreContext() {
  const response = await api("/api/core/context", { method: "GET", headers: {} });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login.html";
      return false;
    }
    window.location.href = "/dashboard.html";
    return false;
  }
  coreContext = await response.json();
  if (!coreContext?.admin?.can_open_app_admin) {
    window.location.href = "/dashboard.html";
    return false;
  }
  applyCoreUi();
  return true;
}

async function loadInstallation() {
  const response = await api("/api/app-admin/installation", { method: "GET", headers: {} });
  const data = response.ok ? await response.json() : {};
  installation = data.installation || null;
  renderInstallationEditor();
}

async function loadProductModules() {
  const response = await api("/api/app-admin/product-modules", { method: "GET", headers: {} });
  const data = response.ok ? await response.json() : {};
  productModules = Array.isArray(data.modules) ? data.modules : [];
  renderProductModules();
}

async function loadInstallationOptions() {
  const response = await api("/api/app-admin/installation-options", { method: "GET", headers: {} });
  const data = response.ok ? await response.json() : {};
  installationOptions = {
    roles: Array.isArray(data.roles) ? data.roles : [],
    locations: Array.isArray(data.locations) ? data.locations : [],
    departments: Array.isArray(data.departments) ? data.departments : []
  };
  populateUserOptionSelects();
  syncSelectedUser();
}

async function loadUsers() {
  const response = await api("/api/app-admin/users", { method: "GET", headers: {} });
  users = response.ok ? await response.json() : [];
  renderUsers();
}

function bindEvents() {
  $("appAdminUserSelect")?.addEventListener("change", () => {
    selectedUserId = String($("appAdminUserSelect").value || "");
    syncSelectedUser();
  });

  $("saveInstallationBtn")?.addEventListener("click", async () => {
    const payload = {
      name: String($("editInstallationName").value || "").trim(),
      slug: String($("editInstallationSlug").value || "").trim(),
      is_active: $("editInstallationActive").value === "true"
    };

    const response = await api("/api/app-admin/installation", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("saveInstallationMsg", data?.error || "Installation konnte nicht gespeichert werden.");
    installation = data;
    renderInstallationEditor();
    setMsg("saveInstallationMsg", "Installation gespeichert.", true);
  });

  $("openOrganizationAdminBtn")?.addEventListener("click", () => {
    window.location.href = "/admin.html";
  });

  $("saveProductModulesBtn")?.addEventListener("click", async () => {
    const modules = Array.from(document.querySelectorAll("[data-module-key]")).map((input) => ({
      key: input.dataset.moduleKey,
      is_enabled: input.checked
    }));
    const response = await api("/api/app-admin/product-modules", {
      method: "PUT",
      body: JSON.stringify({ modules })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("productModulesMsg", data?.error || "Modulfreigaben konnten nicht gespeichert werden.");
    productModules = Array.isArray(data.modules) ? data.modules : productModules;
    renderProductModules();
    setMsg("productModulesMsg", "Modulfreigaben gespeichert.", true);
  });

  $("saveUserBtn")?.addEventListener("click", async () => {
    if (!selectedUserId) return setMsg("saveUserMsg", "Bitte einen Benutzer auswählen.");
    const payload = {
      role_id: $("userRoleSelect").value || null,
      location_id: $("userLocationSelect").value || null,
      fixed_department_id: $("userDepartmentSelect").value || null,
      is_active: $("userIsActiveSelect").value === "true",
      is_app_admin: $("userIsAppAdminSelect").value === "true"
    };
    const response = await api(`/api/app-admin/users/${encodeURIComponent(selectedUserId)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("saveUserMsg", data?.error || "Benutzer konnte nicht gespeichert werden.");
    setMsg("saveUserMsg", "Benutzer gespeichert.", true);
    await loadUsers();
  });
}

(async function init() {
  bindSettingsMenu();
  bindPasswordModal();
  bindEvents();
  const ok = await loadCoreContext();
  if (!ok) return;
  await Promise.all([
    loadInstallation(),
    loadProductModules(),
    loadInstallationOptions(),
    loadUsers()
  ]);
})();
