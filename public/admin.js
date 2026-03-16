let token = localStorage.getItem("token");
let context = null;
let roles = [];
let users = [];

const PERMISSION_SECTIONS = [
  {
    key: "core_users_roles",
    moduleKey: null,
    title: "Core: Benutzer und Rollen",
    description: "Rechte für die allgemeine Organisations-Administration im Dashboard.",
    permissions: [
      { path: "users.manage", label: "Benutzer verwalten" },
      { path: "users.view_department", label: "Nur eigene Abteilung sehen" },
      { path: "roles.manage", label: "Rollen und Rechte verwalten" }
    ]
  },
  {
    key: "pallets_bookings",
    moduleKey: "pallets",
    title: "Paletten: Buchungen",
    description: "Erfassung, Einsicht, Beleg und manuelle Korrekturen.",
    permissions: [
      { path: "bookings.create", label: "Buchungen anlegen" },
      { path: "bookings.view", label: "Buchungen anzeigen" },
      { path: "bookings.export", label: "Buchungen exportieren" },
      { path: "bookings.receipt", label: "Beleg drucken" },
      { path: "bookings.edit", label: "Buchungen bearbeiten" },
      { path: "bookings.delete", label: "Buchungen löschen" },
      { path: "bookings.translogica", label: "Translogica setzen" }
    ]
  },
  {
    key: "pallets_open_pallets",
    moduleKey: "pallets",
    title: "Paletten: Offene Paletten",
    description: "Separater Bereich fuer offene Paletten mit eigenem Live Feed und Abteilungs-Sichtbarkeit.",
    permissions: [
      { path: "open_pallets.view", label: "Offene Paletten sehen" },
      { path: "open_pallets.create", label: "Offene Paletten anlegen" },
      { path: "open_pallets.edit", label: "Offene Paletten bearbeiten" },
      { path: "open_pallets.delete", label: "Offene Paletten loeschen" },
      { path: "open_pallets.view_all", label: "Alle Offene-Paletten-Buchungen sehen" }
    ]
  },
  {
    key: "pallets_stock",
    moduleKey: "pallets",
    title: "Paletten: Bestände und Fälle",
    description: "Bestands- und Workflow-Rechte innerhalb des Paletten-Moduls.",
    permissions: [
      { path: "stock.view", label: "Bestände anzeigen" },
      { path: "stock.overall", label: "Komplett-Bestand anzeigen" },
      { path: "cases.create", label: "Aviso anlegen" },
      { path: "cases.internal_transfer", label: "Interne Lagerumbuchung" },
      { path: "cases.require_employee_code", label: "Mitarbeitercode in Status 2 verpflichtend" },
      { path: "cases.claim", label: "Fälle übernehmen" },
      { path: "cases.edit", label: "Fälle bearbeiten" },
      { path: "cases.submit", label: "Fälle zur Prüfung senden" },
      { path: "cases.approve", label: "Fälle abschließen" },
      { path: "cases.cancel", label: "Fälle stornieren" },
      { path: "cases.delete", label: "Fälle löschen" },
      { path: "filters.all_locations", label: "Alle Standorte filtern" },
      { path: "masterdata.manage", label: "Modul-Stammdaten verwalten" },
      { path: "masterdata.entrepreneurs_manage", label: "Frachtführer-Stammdaten verwalten" }
    ]
  },
  {
    key: "container_registration",
    moduleKey: "container_registration",
    title: "Container Anmeldung",
    description: "Zugriff und Adminrechte für das Modul Container Anmeldung.",
    permissions: [
      { path: "modules.container_registration.open", label: "Modul öffnen" },
      { path: "modules.container_registration.viewer", label: "Viewer öffnen" },
      { path: "modules.container_registration.history", label: "Historie sehen" },
      { path: "modules.container_registration.history_export", label: "Historie exportieren" },
      { path: "modules.container_registration.history_clear", label: "Historie leeren" },
      { path: "modules.container_registration.manage_time", label: "Zeitfenster verwalten" },
      { path: "modules.container_registration.manage_status", label: "Status verwalten" },
      { path: "modules.container_registration.reset_container", label: "Einzelnen Container zurücksetzen" },
      { path: "modules.container_registration.reset_all", label: "Alle Container zurücksetzen" }
    ]
  },
  {
    key: "container_planning",
    moduleKey: "container_planning",
    title: "Container und LKW Planung",
    description: "Rechte für Planung, Anlage und Bearbeitung des Moduls.",
    permissions: [
      { path: "modules.container_planning.open", label: "Modul öffnen" },
      { path: "modules.container_planning.create", label: "Planung anlegen" },
      { path: "modules.container_planning.edit", label: "Planung bearbeiten" },
      { path: "modules.container_planning.delete", label: "Planung löschen" }
    ]
  },
  {
    key: "warehouse",
    moduleKey: "warehouse",
    title: "Warehouse Modul",
    description: "Rechte für Lager, Bestand, Bewegungen und Picking.",
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
  }
];

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

function setMsg(id, text, ok = false) {
  const el = $(id);
  if (!el) return;
  el.style.color = ok ? "#0a7a2f" : "#b00020";
  el.textContent = text || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
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
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object") ? acc[key] : undefined, target);
}

function buildEmptyPermissions() {
  return {
    bookings: { create: false, view: false, export: false, receipt: false, edit: false, delete: false, translogica: false },
    open_pallets: { view: false, create: false, edit: false, delete: false, view_all: false },
    stock: { view: false, overall: false },
    cases: {
      create: false,
      internal_transfer: false,
      require_employee_code: false,
      claim: false,
      edit: false,
      submit: false,
      approve: false,
      cancel: false,
      delete: false
    },
    filters: { all_locations: false },
    masterdata: { manage: false, entrepreneurs_manage: false },
    users: { manage: false, view_department: false },
    roles: { manage: false },
    modules: {
      container_registration: {
        open: false,
        viewer: false,
        history: false,
        history_export: false,
        history_clear: false,
        manage_time: false,
        manage_status: false,
        reset_container: false,
        reset_all: false
      },
      container_planning: {
        open: false,
        create: false,
        edit: false,
        delete: false
      }
    },
    warehouse: {
      dashboard: { view: false },
      customers: { view: false, manage: false },
      storage_locations: { view: false, manage: false },
      inventory: { view: false, manage: false },
      transactions: { create: false, view: false, export: false, manage: false },
      picking: { view: false, manage: false, process: false }
    },
    admin: { full_access: false }
  };
}

function permissionInputId(path) {
  return `perm_${path.replaceAll(".", "_")}`;
}

function visiblePermissionSections() {
  const activeModules = new Set(context?.active_modules || []);
  return PERMISSION_SECTIONS.filter((section) => !section.moduleKey || activeModules.has(section.moduleKey));
}

function canManageUsers() {
  return Boolean(context?.permissions?.users?.manage || context?.user?.is_app_admin || context?.user?.role === "admin");
}

function canViewUsers() {
  return Boolean(canManageUsers() || context?.permissions?.users?.view_department);
}

function canManageRoles() {
  return Boolean(context?.permissions?.roles?.manage || context?.user?.is_app_admin || context?.user?.role === "admin");
}

function roleNameById(roleId) {
  const match = roles.find((role) => String(role.id) === String(roleId));
  return match?.name || "-";
}

function optionMarkup(items, placeholder, allowEmpty = true) {
  const prefix = allowEmpty ? `<option value="">${placeholder}</option>` : "";
  return prefix + items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
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

function bindTabs() {
  document.querySelectorAll(".admin-tabs [data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".admin-tabs [data-tab]").forEach((entry) => entry.classList.remove("active"));
      button.classList.add("active");
      $("tab-users").style.display = button.dataset.tab === "users" ? "" : "none";
      $("tab-roles").style.display = button.dataset.tab === "roles" ? "" : "none";
    });
  });
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

  $("openPalletAdminBtn")?.addEventListener("click", () => {
    closeSettingsMenu();
    window.location.href = "/modules/pallets/admin.html";
  });

  $("openAppAdminBtn")?.addEventListener("click", () => {
    closeSettingsMenu();
    window.location.href = "/app-admin.html";
  });

  $("menuDarkmodeBtn")?.addEventListener("click", () => {
    $("themeToggleBtn")?.click();
    closeSettingsMenu();
  });

  $("openChangePasswordBtn")?.addEventListener("click", () => {
    closeSettingsMenu();
    setMsg("passwordModalMsg", "", true);
    $("currentPassword").value = "";
    $("newPassword").value = "";
    $("confirmPassword").value = "";
    showPasswordModal(true);
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

function renderModulePills() {
  const labelMap = {
    pallets: "Paletten",
    warehouse: "Warehouse",
    container_registration: "Container Anmeldung",
    container_planning: "Container Planung"
  };
  const host = $("activeModulePills");
  if (!host) return;
  const entries = context?.active_modules || [];
  host.innerHTML = entries.length
    ? entries.map((key) => `<span class="pill">${escapeHtml(labelMap[key] || key)}</span>`).join("")
    : `<span class="muted">Keine Module freigeschaltet</span>`;
}

function populateCommonSelects() {
  const locations = context?.locations || [];
  const departments = context?.departments || [];

  $("createLocationId").innerHTML = optionMarkup(locations, "Kein Standort");
  $("editLocationId").innerHTML = optionMarkup(locations, "Kein Standort");
  $("createDepartmentId").innerHTML = optionMarkup(departments, "Keine feste Abteilung");
  $("editDepartmentId").innerHTML = optionMarkup(departments, "Keine feste Abteilung");
}

function renderPermissionSections() {
  const host = $("permissionSections");
  if (!host) return;

  host.innerHTML = visiblePermissionSections().map((section) => `
    <section class="permission-section">
      <div class="permission-section-head">
        <div class="permission-section-copy">
          <h4>${escapeHtml(section.title)}</h4>
          <p>${escapeHtml(section.description)}</p>
        </div>
      </div>
      <div class="permission-section-grid">
        ${section.permissions.map((permission) => `
          <label class="permission-check">
            <input type="checkbox" id="${permissionInputId(permission.path)}" ${canManageRoles() ? "" : "disabled"}>
            <span>${escapeHtml(permission.label)}</span>
          </label>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function applyRoleToInputs(roleId) {
  const role = roles.find((entry) => String(entry.id) === String(roleId));
  const permissions = deepClone(role?.permissions || buildEmptyPermissions());

  visiblePermissionSections().forEach((section) => {
    section.permissions.forEach((permission) => {
      const input = $(permissionInputId(permission.path));
      if (input) input.checked = Boolean(getPath(permissions, permission.path));
    });
  });
}

function collectPermissionsFromInputs() {
  const permissions = buildEmptyPermissions();
  visiblePermissionSections().forEach((section) => {
    section.permissions.forEach((permission) => {
      setPath(permissions, permission.path, Boolean($(permissionInputId(permission.path))?.checked));
    });
  });
  return permissions;
}

function renderRoles() {
  const options = roles.map((role) => `<option value="${role.id}">${escapeHtml(role.name)}</option>`).join("");
  $("roleSelect").innerHTML = roles.length ? options : `<option value="">Keine Rollen vorhanden</option>`;
  $("createRoleId").innerHTML = roles.length ? optionMarkup(roles, "Rolle wählen", false) : `<option value="">Keine Rolle vorhanden</option>`;
  $("editRoleId").innerHTML = roles.length ? optionMarkup(roles, "Rolle wählen", false) : `<option value="">Keine Rolle vorhanden</option>`;

  if (roles.length) {
    if (!$("roleSelect").value) $("roleSelect").value = String(roles[0].id);
    applyRoleToInputs($("roleSelect").value);
  } else {
    applyRoleToInputs(null);
  }
}

function renderUsers() {
  const locations = context?.locations || [];
  const departments = context?.departments || [];

  $("usersBody").innerHTML = users.map((user) => {
    const locationName = locations.find((entry) => String(entry.id) === String(user.location_id))?.name || "-";
    const departmentName = departments.find((entry) => String(entry.id) === String(user.fixed_department_id))?.name || "-";
    return `
      <tr>
        <td>${escapeHtml(user.username)}</td>
        <td>${escapeHtml(user.email || "-")}</td>
        <td>${escapeHtml(roleNameById(user.role_id))}</td>
        <td>${escapeHtml(locationName)}</td>
        <td>${escapeHtml(departmentName)}</td>
        <td>${user.is_active ? "Aktiv" : "Inaktiv"}</td>
      </tr>
    `;
  }).join("");

  $("editUserSelect").innerHTML = users.length
    ? users.map((user) => `<option value="${user.id}">${escapeHtml(user.username)}</option>`).join("")
    : `<option value="">Keine Benutzer vorhanden</option>`;

  syncSelectedUser();
}

function syncSelectedUser() {
  const user = users.find((entry) => String(entry.id) === String($("editUserSelect").value));
  if (!user) {
    $("editEmail").value = "";
    $("editRoleId").value = "";
    $("editLocationId").value = "";
    $("editDepartmentId").value = "";
    $("editIsActive").value = "true";
    return;
  }

  $("editEmail").value = user.email || "";
  $("editRoleId").value = user.role_id ? String(user.role_id) : "";
  $("editLocationId").value = user.location_id ? String(user.location_id) : "";
  $("editDepartmentId").value = user.fixed_department_id ? String(user.fixed_department_id) : "";
  $("editIsActive").value = user.is_active ? "true" : "false";
}

function applyContextUi() {
  $("me").textContent = context?.user
    ? `${context.user.username} - ${context.user.business_role_name || "-"}`
    : "-";
  $("managedCustomerName").textContent = context?.installation?.name || context?.managed_customer?.name || "Keine Installation";
  $("adminLead").textContent = "Benutzer und Rechte.";

  $("openPalletAdminBtn").style.display = context?.admin?.can_open_pallet_admin && (context?.active_modules || []).includes("pallets") ? "" : "none";
  $("openAppAdminBtn").style.display = context?.admin?.can_open_app_admin ? "" : "none";

  renderModulePills();
  populateCommonSelects();
  renderPermissionSections();

  $("userCreateCard").style.display = canManageUsers() ? "" : "none";
  $("saveUserBtn").disabled = !canManageUsers();
  $("resetPasswordBtn").disabled = !canManageUsers();
  $("deleteUserBtn").disabled = !canManageUsers();
  $("createRoleBtn").disabled = !canManageRoles();
  $("saveRoleBtn").disabled = !canManageRoles();
  $("deleteRoleBtn").disabled = !canManageRoles();

  if (!canManageRoles()) {
    document.querySelector('.admin-tabs [data-tab="roles"]')?.setAttribute("disabled", "disabled");
    document.querySelector('.admin-tabs [data-tab="users"]')?.click();
  }
}

async function loadContext() {
  const response = await api("/api/admin/context", { method: "GET", headers: {} });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login.html";
      return false;
    }
    const data = await response.json().catch(() => ({}));
    alert(data?.error || "Organisations-Administration konnte nicht geladen werden.");
    window.location.href = "/dashboard.html";
    return false;
  }

  context = await response.json();
  applyContextUi();
  return true;
}

async function loadRoles() {
  const response = await api("/api/admin/roles", { method: "GET", headers: {} });
  roles = response.ok ? await response.json() : [];
  renderRoles();
}

async function loadUsers() {
  const response = await api("/api/admin/users", { method: "GET", headers: {} });
  users = response.ok ? await response.json() : [];
  renderUsers();
}

async function reloadAll() {
  const ok = await loadContext();
  if (!ok) return;
  if (canManageRoles() || canManageUsers()) await loadRoles();
  else renderRoles();
  if (canViewUsers()) await loadUsers();
}

function bindEvents() {
  $("roleSelect")?.addEventListener("change", () => {
    applyRoleToInputs($("roleSelect").value);
  });

  $("editUserSelect")?.addEventListener("change", syncSelectedUser);

  $("createRoleBtn")?.addEventListener("click", async () => {
    const name = String($("newRoleName").value || "").trim();
    if (!name) return setMsg("createRoleMsg", "Bitte einen Rollennamen eingeben.");

    const response = await api("/api/admin/roles", {
      method: "POST",
      body: JSON.stringify({ name, permissions: buildEmptyPermissions() })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("createRoleMsg", data?.error || "Rolle konnte nicht angelegt werden.");
    $("newRoleName").value = "";
    setMsg("createRoleMsg", "Rolle angelegt.", true);
    await loadRoles();
    $("roleSelect").value = String(data.id);
    applyRoleToInputs(data.id);
  });

  $("saveRoleBtn")?.addEventListener("click", async () => {
    const roleId = $("roleSelect").value;
    if (!roleId) return setMsg("editRoleMsg", "Bitte eine Rolle auswählen.");
    const response = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
      method: "PUT",
      body: JSON.stringify({ permissions: collectPermissionsFromInputs() })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editRoleMsg", data?.error || "Rechte konnten nicht gespeichert werden.");
    setMsg("editRoleMsg", "Rechte gespeichert.", true);
    await loadRoles();
    $("roleSelect").value = roleId;
    applyRoleToInputs(roleId);
  });

  $("deleteRoleBtn")?.addEventListener("click", async () => {
    const roleId = $("roleSelect").value;
    if (!roleId) return setMsg("editRoleMsg", "Bitte eine Rolle auswählen.");
    if (!confirm("Rolle wirklich löschen?")) return;
    const response = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editRoleMsg", data?.error || "Rolle konnte nicht gelöscht werden.");
    setMsg("editRoleMsg", "Rolle gelöscht.", true);
    await loadRoles();
  });

  $("createUserBtn")?.addEventListener("click", async () => {
    const payload = {
      username: String($("createUsername").value || "").trim(),
      password: String($("createPassword").value || "").trim(),
      email: String($("createEmail").value || "").trim() || null,
      role_id: $("createRoleId").value || null,
      location_id: $("createLocationId").value || null,
      fixed_department_id: $("createDepartmentId").value || null
    };

    if (!payload.username || !payload.password) {
      return setMsg("createUserMsg", "Benutzername und Passwort sind Pflicht.");
    }
    if (!payload.role_id) {
      return setMsg("createUserMsg", "Bitte eine Rolle auswählen.");
    }

    const response = await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("createUserMsg", data?.error || "Benutzer konnte nicht angelegt werden.");

    $("createUsername").value = "";
    $("createPassword").value = "";
    $("createEmail").value = "";
    $("createLocationId").value = "";
    $("createDepartmentId").value = "";
    setMsg("createUserMsg", "Benutzer angelegt.", true);
    await loadUsers();
  });

  $("saveUserBtn")?.addEventListener("click", async () => {
    const userId = $("editUserSelect").value;
    if (!userId) return setMsg("editUserMsg", "Bitte einen Benutzer auswählen.");

    const payload = {
      email: String($("editEmail").value || "").trim() || null,
      role_id: $("editRoleId").value || null,
      location_id: $("editLocationId").value || null,
      fixed_department_id: $("editDepartmentId").value || null,
      is_active: $("editIsActive").value === "true"
    };

    const response = await api(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editUserMsg", data?.error || "Benutzer konnte nicht gespeichert werden.");
    setMsg("editUserMsg", "Benutzer gespeichert.", true);
    await loadUsers();
    $("editUserSelect").value = userId;
    syncSelectedUser();
  });

  $("resetPasswordBtn")?.addEventListener("click", async () => {
    const userId = $("editUserSelect").value;
    if (!userId) return setMsg("editUserMsg", "Bitte einen Benutzer auswählen.");
    const password = prompt("Neues Passwort für den Benutzer eingeben:");
    if (!password) return;
    const response = await api(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editUserMsg", data?.error || "Passwort konnte nicht zurückgesetzt werden.");
    setMsg("editUserMsg", "Passwort zurückgesetzt.", true);
  });

  $("deleteUserBtn")?.addEventListener("click", async () => {
    const userId = $("editUserSelect").value;
    if (!userId) return setMsg("editUserMsg", "Bitte einen Benutzer auswählen.");
    if (!confirm("Benutzer wirklich löschen?")) return;
    const response = await api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("editUserMsg", data?.error || "Benutzer konnte nicht gelöscht werden.");
    setMsg("editUserMsg", "Benutzer gelöscht.", true);
    await loadUsers();
  });
}

(async function init() {
  bindTabs();
  bindSettingsMenu();
  bindPasswordModal();
  bindEvents();
  await reloadAll();
})();
