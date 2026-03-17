let token = localStorage.getItem("token");
let coreContext = null;
let installation = null;
let productModules = [];
let appAdmins = [];
let warehouseUsers = [];
let warehouseRoles = [];
let selectedAppAdminId = "";
let selectedWarehouseUserId = "";

const WAREHOUSE_PERMISSION_SECTION = {
  title: "Warehouse-Modul",
  description: "Nur Rechte für das Warehouse-Modul.",
  permissions: [
    { path: "warehouse.dashboard.view", label: "Dashboard sehen" },
    { path: "warehouse.customers.view", label: "Kunden sehen" },
    { path: "warehouse.customers.manage", label: "Kunden verwalten" },
    { path: "warehouse.storage_locations.view", label: "Lagerplätze sehen" },
    { path: "warehouse.storage_locations.manage", label: "Lagerplätze verwalten" },
    { path: "warehouse.inventory.view", label: "Bestand sehen" },
    { path: "warehouse.inventory.manage", label: "Bestand verwalten" },
    { path: "warehouse.transactions.create", label: "Bewegungen anlegen" },
    { path: "warehouse.transactions.view", label: "Bewegungen sehen" },
    { path: "warehouse.transactions.export", label: "Bewegungen exportieren" },
    { path: "warehouse.transactions.manage", label: "Bewegungen verwalten" },
    { path: "warehouse.picking.view", label: "Picking sehen" },
    { path: "warehouse.picking.manage", label: "Picking verwalten" },
    { path: "warehouse.picking.process", label: "Picking bearbeiten" }
  ]
};

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

function optionMarkup(items, placeholder, allowEmpty = true) {
  const prefix = allowEmpty ? `<option value="">${escapeHtml(placeholder)}</option>` : "";
  return prefix + items.map((item) => `<option value="${item.id}">${escapeHtml(item.name || item.username)}</option>`).join("");
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!cursor[parts[index]] || typeof cursor[parts[index]] !== "object") {
      cursor[parts[index]] = {};
    }
    cursor = cursor[parts[index]];
  }
  cursor[parts[parts.length - 1]] = value;
}

function getPath(target, path) {
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), target);
}

function permissionInputId(path) {
  return `warehouse_perm_${path.replaceAll(".", "_")}`;
}

function buildWarehousePermissions() {
  return {
    warehouse: {
      dashboard: { view: false },
      customers: { view: false, manage: false },
      storage_locations: { view: false, manage: false },
      inventory: { view: false, manage: false },
      transactions: { create: false, view: false, export: false, manage: false },
      picking: { view: false, manage: false, process: false }
    }
  };
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

function renderWarehousePermissionSections() {
  const host = $("warehousePermissionSections");
  if (!host) return;

  host.innerHTML = `
    <section class="permission-section">
      <div class="permission-section-head">
        <div class="permission-section-copy">
          <h4>${escapeHtml(WAREHOUSE_PERMISSION_SECTION.title)}</h4>
          <p>${escapeHtml(WAREHOUSE_PERMISSION_SECTION.description)}</p>
        </div>
      </div>
      <div class="permission-section-grid">
        ${WAREHOUSE_PERMISSION_SECTION.permissions.map((permission) => `
          <label class="permission-check">
            <input type="checkbox" id="${permissionInputId(permission.path)}">
            <span>${escapeHtml(permission.label)}</span>
          </label>
        `).join("")}
      </div>
    </section>
  `;
}

function applyWarehouseRoleToInputs(roleId) {
  const role = warehouseRoles.find((entry) => String(entry.id) === String(roleId));
  const permissions = role?.permissions || buildWarehousePermissions();
  WAREHOUSE_PERMISSION_SECTION.permissions.forEach((permission) => {
    const input = $(permissionInputId(permission.path));
    if (input) input.checked = Boolean(getPath(permissions, permission.path));
  });
}

function collectWarehousePermissions() {
  const permissions = buildWarehousePermissions();
  WAREHOUSE_PERMISSION_SECTION.permissions.forEach((permission) => {
    setPath(permissions, permission.path, Boolean($(permissionInputId(permission.path))?.checked));
  });
  return permissions;
}

function syncSelectedAppAdmin() {
  const entry = appAdmins.find((user) => String(user.id) === String($("appAdminSelect").value));
  selectedAppAdminId = entry ? String(entry.id) : "";
  $("editAppAdminEmail").value = entry?.email || "";
  $("editAppAdminActive").value = entry?.is_active ? "true" : "false";
}

function syncSelectedWarehouseUser() {
  const entry = warehouseUsers.find((user) => String(user.id) === String($("warehouseUserSelect").value));
  selectedWarehouseUserId = entry ? String(entry.id) : "";
  $("editWarehouseEmail").value = entry?.email || "";
  $("editWarehouseRole").value = entry?.role_id ? String(entry.role_id) : "";
  $("editWarehouseActive").value = entry?.is_active ? "true" : "false";
}

function syncSelectedWarehouseRole() {
  applyWarehouseRoleToInputs($("warehouseRoleSelect").value);
}

function renderAppAdmins() {
  $("appAdminsBody").innerHTML = appAdmins.map((user) => `
    <tr>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.email || "-")}</td>
      <td>${user.is_active ? "Aktiv" : "Inaktiv"}</td>
    </tr>
  `).join("");

  $("appAdminSelect").innerHTML = appAdmins.length
    ? appAdmins.map((user) => `<option value="${user.id}">${escapeHtml(user.username)}</option>`).join("")
    : `<option value="">Keine App-Admins vorhanden</option>`;

  if (selectedAppAdminId && !appAdmins.some((user) => String(user.id) === String(selectedAppAdminId))) {
    selectedAppAdminId = "";
  }
  if (!selectedAppAdminId && appAdmins.length) selectedAppAdminId = String(appAdmins[0].id);
  if (selectedAppAdminId) $("appAdminSelect").value = selectedAppAdminId;
  syncSelectedAppAdmin();
}

function renderWarehouseUsers() {
  $("warehouseUsersBody").innerHTML = warehouseUsers.map((user) => `
    <tr>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.email || "-")}</td>
      <td>${escapeHtml(user.business_role_name || "-")}</td>
      <td>${user.is_active ? "Aktiv" : "Inaktiv"}</td>
    </tr>
  `).join("");

  $("warehouseUserSelect").innerHTML = warehouseUsers.length
    ? warehouseUsers.map((user) => `<option value="${user.id}">${escapeHtml(user.username)}</option>`).join("")
    : `<option value="">Keine Warehouse-Benutzer vorhanden</option>`;

  if (selectedWarehouseUserId && !warehouseUsers.some((user) => String(user.id) === String(selectedWarehouseUserId))) {
    selectedWarehouseUserId = "";
  }
  if (!selectedWarehouseUserId && warehouseUsers.length) selectedWarehouseUserId = String(warehouseUsers[0].id);
  if (selectedWarehouseUserId) $("warehouseUserSelect").value = selectedWarehouseUserId;
  syncSelectedWarehouseUser();
}

function renderWarehouseRoleSelects() {
  const roleOptions = warehouseRoles.length
    ? optionMarkup(warehouseRoles, "Warehouse-Rolle wählen", false)
    : `<option value="">Keine Warehouse-Rollen vorhanden</option>`;
  const roleOptionsWithPlaceholder = warehouseRoles.length
    ? optionMarkup(warehouseRoles, "Warehouse-Rolle wählen")
    : `<option value="">Keine Warehouse-Rollen vorhanden</option>`;

  $("createWarehouseRole").innerHTML = roleOptionsWithPlaceholder;
  $("editWarehouseRole").innerHTML = roleOptionsWithPlaceholder;
  $("warehouseRoleSelect").innerHTML = roleOptions;

  if (warehouseRoles.length) {
    if (!$("warehouseRoleSelect").value) $("warehouseRoleSelect").value = String(warehouseRoles[0].id);
    applyWarehouseRoleToInputs($("warehouseRoleSelect").value);
  } else {
    applyWarehouseRoleToInputs(null);
  }

  syncSelectedWarehouseUser();
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

async function loadUsers() {
  const response = await api("/api/app-admin/users", { method: "GET", headers: {} });
  const data = response.ok ? await response.json() : {};
  appAdmins = Array.isArray(data.app_admins) ? data.app_admins : [];
  warehouseUsers = Array.isArray(data.warehouse_users) ? data.warehouse_users : [];
  renderAppAdmins();
  renderWarehouseUsers();
}

async function loadWarehouseRoles() {
  const response = await api("/api/app-admin/warehouse-roles", { method: "GET", headers: {} });
  warehouseRoles = response.ok ? await response.json() : [];
  renderWarehouseRoleSelects();
}

async function reloadWarehouseArea(options = {}) {
  const { keepRoleId = "", keepUserId = "" } = options;
  await loadWarehouseRoles();
  if (keepRoleId && warehouseRoles.some((role) => String(role.id) === String(keepRoleId))) {
    $("warehouseRoleSelect").value = String(keepRoleId);
    syncSelectedWarehouseRole();
  }
  await loadUsers();
  if (keepUserId && warehouseUsers.some((user) => String(user.id) === String(keepUserId))) {
    $("warehouseUserSelect").value = String(keepUserId);
    syncSelectedWarehouseUser();
  }
}

function promptForPassword(message) {
  const value = window.prompt(message);
  return value ? String(value).trim() : "";
}

function bindEvents() {
  $("appAdminSelect")?.addEventListener("change", syncSelectedAppAdmin);
  $("warehouseUserSelect")?.addEventListener("change", syncSelectedWarehouseUser);
  $("warehouseRoleSelect")?.addEventListener("change", syncSelectedWarehouseRole);

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

  $("createAppAdminBtn")?.addEventListener("click", async () => {
    const payload = {
      username: String($("createAppAdminUsername").value || "").trim(),
      password: String($("createAppAdminPassword").value || "").trim(),
      email: String($("createAppAdminEmail").value || "").trim() || null,
      is_active: $("createAppAdminActive").value === "true"
    };
    if (!payload.username || !payload.password) {
      return setMsg("createAppAdminMsg", "Benutzername und Passwort sind Pflicht.");
    }

    const response = await api("/api/app-admin/app-admins", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("createAppAdminMsg", data?.error || "App-Admin konnte nicht angelegt werden.");

    $("createAppAdminUsername").value = "";
    $("createAppAdminPassword").value = "";
    $("createAppAdminEmail").value = "";
    $("createAppAdminActive").value = "true";
    setMsg("createAppAdminMsg", "App-Admin angelegt.", true);
    await loadUsers();
  });

  $("saveAppAdminBtn")?.addEventListener("click", async () => {
    const userId = $("appAdminSelect").value;
    if (!userId) return setMsg("editAppAdminMsg", "Bitte einen App-Admin auswählen.");

    const response = await api(`/api/app-admin/app-admins/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: JSON.stringify({
        email: String($("editAppAdminEmail").value || "").trim() || null,
        is_active: $("editAppAdminActive").value === "true"
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editAppAdminMsg", data?.error || "App-Admin konnte nicht gespeichert werden.");
    setMsg("editAppAdminMsg", "App-Admin gespeichert.", true);
    await loadUsers();
    $("appAdminSelect").value = userId;
    syncSelectedAppAdmin();
  });

  $("resetAppAdminPasswordBtn")?.addEventListener("click", async () => {
    const userId = $("appAdminSelect").value;
    if (!userId) return setMsg("editAppAdminMsg", "Bitte einen App-Admin auswählen.");
    const password = promptForPassword("Neues Passwort für den App-Admin eingeben:");
    if (!password) return;
    const response = await api(`/api/app-admin/app-admins/${encodeURIComponent(userId)}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editAppAdminMsg", data?.error || "Passwort konnte nicht zurückgesetzt werden.");
    setMsg("editAppAdminMsg", "Passwort zurückgesetzt.", true);
  });

  $("deleteAppAdminBtn")?.addEventListener("click", async () => {
    const userId = $("appAdminSelect").value;
    if (!userId) return setMsg("editAppAdminMsg", "Bitte einen App-Admin auswählen.");
    if (!window.confirm("App-Admin wirklich löschen?")) return;
    const response = await api(`/api/app-admin/app-admins/${encodeURIComponent(userId)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editAppAdminMsg", data?.error || "App-Admin konnte nicht gelöscht werden.");
    setMsg("editAppAdminMsg", "App-Admin gelöscht.", true);
    await loadUsers();
  });

  $("createWarehouseUserBtn")?.addEventListener("click", async () => {
    const payload = {
      username: String($("createWarehouseUsername").value || "").trim(),
      password: String($("createWarehousePassword").value || "").trim(),
      email: String($("createWarehouseEmail").value || "").trim() || null,
      role_id: $("createWarehouseRole").value || null,
      is_active: $("createWarehouseActive").value === "true"
    };
    if (!payload.username || !payload.password || !payload.role_id) {
      return setMsg("createWarehouseUserMsg", "Benutzername, Passwort und Warehouse-Rolle sind Pflicht.");
    }

    const response = await api("/api/app-admin/warehouse-users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("createWarehouseUserMsg", data?.error || "Warehouse-Benutzer konnte nicht angelegt werden.");

    $("createWarehouseUsername").value = "";
    $("createWarehousePassword").value = "";
    $("createWarehouseEmail").value = "";
    $("createWarehouseRole").value = warehouseRoles.length ? String(warehouseRoles[0].id) : "";
    $("createWarehouseActive").value = "true";
    setMsg("createWarehouseUserMsg", "Warehouse-Benutzer angelegt.", true);
    await loadUsers();
  });

  $("saveWarehouseUserBtn")?.addEventListener("click", async () => {
    const userId = $("warehouseUserSelect").value;
    if (!userId) return setMsg("editWarehouseUserMsg", "Bitte einen Warehouse-Benutzer auswählen.");

    const response = await api(`/api/app-admin/warehouse-users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: JSON.stringify({
        email: String($("editWarehouseEmail").value || "").trim() || null,
        role_id: $("editWarehouseRole").value || null,
        is_active: $("editWarehouseActive").value === "true"
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editWarehouseUserMsg", data?.error || "Warehouse-Benutzer konnte nicht gespeichert werden.");
    setMsg("editWarehouseUserMsg", "Warehouse-Benutzer gespeichert.", true);
    await loadUsers();
    $("warehouseUserSelect").value = userId;
    syncSelectedWarehouseUser();
  });

  $("resetWarehousePasswordBtn")?.addEventListener("click", async () => {
    const userId = $("warehouseUserSelect").value;
    if (!userId) return setMsg("editWarehouseUserMsg", "Bitte einen Warehouse-Benutzer auswählen.");
    const password = promptForPassword("Neues Passwort für den Warehouse-Benutzer eingeben:");
    if (!password) return;
    const response = await api(`/api/app-admin/warehouse-users/${encodeURIComponent(userId)}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editWarehouseUserMsg", data?.error || "Passwort konnte nicht zurückgesetzt werden.");
    setMsg("editWarehouseUserMsg", "Passwort zurückgesetzt.", true);
  });

  $("deleteWarehouseUserBtn")?.addEventListener("click", async () => {
    const userId = $("warehouseUserSelect").value;
    if (!userId) return setMsg("editWarehouseUserMsg", "Bitte einen Warehouse-Benutzer auswählen.");
    if (!window.confirm("Warehouse-Benutzer wirklich löschen?")) return;
    const response = await api(`/api/app-admin/warehouse-users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editWarehouseUserMsg", data?.error || "Warehouse-Benutzer konnte nicht gelöscht werden.");
    setMsg("editWarehouseUserMsg", "Warehouse-Benutzer gelöscht.", true);
    await loadUsers();
  });

  $("createWarehouseRoleBtn")?.addEventListener("click", async () => {
    const name = String($("newWarehouseRoleName").value || "").trim();
    if (!name) return setMsg("createWarehouseRoleMsg", "Bitte einen Rollennamen eingeben.");

    const response = await api("/api/app-admin/warehouse-roles", {
      method: "POST",
      body: JSON.stringify({ name, permissions: buildWarehousePermissions() })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("createWarehouseRoleMsg", data?.error || "Warehouse-Rolle konnte nicht angelegt werden.");
    $("newWarehouseRoleName").value = "";
    setMsg("createWarehouseRoleMsg", "Warehouse-Rolle angelegt.", true);
    await reloadWarehouseArea({ keepRoleId: data.id });
    $("warehouseRoleSelect").value = String(data.id);
    syncSelectedWarehouseRole();
  });

  $("saveWarehouseRoleBtn")?.addEventListener("click", async () => {
    const roleId = $("warehouseRoleSelect").value;
    if (!roleId) return setMsg("editWarehouseRoleMsg", "Bitte eine Warehouse-Rolle auswählen.");

    const response = await api(`/api/app-admin/warehouse-roles/${encodeURIComponent(roleId)}`, {
      method: "PUT",
      body: JSON.stringify({ permissions: collectWarehousePermissions() })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editWarehouseRoleMsg", data?.error || "Warehouse-Rechte konnten nicht gespeichert werden.");
    setMsg("editWarehouseRoleMsg", "Warehouse-Rechte gespeichert.", true);
    await reloadWarehouseArea({ keepRoleId: roleId, keepUserId: $("warehouseUserSelect").value });
  });

  $("deleteWarehouseRoleBtn")?.addEventListener("click", async () => {
    const roleId = $("warehouseRoleSelect").value;
    if (!roleId) return setMsg("editWarehouseRoleMsg", "Bitte eine Warehouse-Rolle auswählen.");
    if (!window.confirm("Warehouse-Rolle wirklich löschen?")) return;

    const response = await api(`/api/app-admin/warehouse-roles/${encodeURIComponent(roleId)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editWarehouseRoleMsg", data?.error || "Warehouse-Rolle konnte nicht gelöscht werden.");
    setMsg("editWarehouseRoleMsg", "Warehouse-Rolle gelöscht.", true);
    await reloadWarehouseArea();
  });
}

(async function init() {
  renderWarehousePermissionSections();
  bindSettingsMenu();
  bindPasswordModal();
  bindEvents();
  const ok = await loadCoreContext();
  if (!ok) return;
  await Promise.all([
    loadInstallation(),
    loadProductModules()
  ]);
  await loadWarehouseRoles();
  await loadUsers();
})();
