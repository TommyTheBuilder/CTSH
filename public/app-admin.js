let token = localStorage.getItem("token");
let coreContext = null;
let customers = [];
let customerModules = [];
let users = [];
let selectedCustomerId = "";
let selectedUserId = "";
let selectedCustomerOptions = { roles: [], locations: [], departments: [] };
let userCustomerOptions = { roles: [], locations: [], departments: [] };

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

function updateCustomerInUrl() {
  const url = new URL(window.location.href);
  if (selectedCustomerId) url.searchParams.set("customerId", selectedCustomerId);
  else url.searchParams.delete("customerId");
  history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
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
    const target = selectedCustomerId ? `/admin.html?customerId=${encodeURIComponent(selectedCustomerId)}` : "/admin.html";
    window.location.href = target;
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
      return setMsg("passwordModalMsg", "Bitte alle Felder ausfuellen.");
    }
    if (new_password.length < 8) {
      return setMsg("passwordModalMsg", "Das neue Passwort muss mindestens 8 Zeichen lang sein.");
    }
    if (new_password !== confirm_password) {
      return setMsg("passwordModalMsg", "Die Passwoerter stimmen nicht ueberein.");
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

function renderCustomers() {
  const options = customers.map((customer) => `<option value="${customer.id}">${escapeHtml(customer.name)}</option>`).join("");
  $("appAdminCustomerSelect").innerHTML = options;
  $("userCustomerSelect").innerHTML = options;
  if (selectedCustomerId) $("appAdminCustomerSelect").value = selectedCustomerId;
}

function renderCustomerEditor() {
  const customer = customers.find((entry) => String(entry.id) === String(selectedCustomerId));
  $("activeCustomerLabel").textContent = customer?.name || "-";
  $("editCustomerName").value = customer?.name || "";
  $("editCustomerSlug").value = customer?.slug || "";
  $("editCustomerActive").value = customer?.is_active ? "true" : "false";
}

function renderCustomerModules() {
  $("customerModuleList").innerHTML = customerModules.map((module) => `
    <label class="module-checklist__item">
      <input type="checkbox" data-module-key="${escapeHtml(module.key)}" ${module.is_enabled ? "checked" : ""}>
      <span>
        <strong>${escapeHtml(module.name)}</strong>
        <small class="muted">${escapeHtml(module.description || "")}</small>
      </span>
    </label>
  `).join("");
}

function renderUsers() {
  $("usersBody").innerHTML = users.map((user) => `
    <tr>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.customer_name || "-")}</td>
      <td>${escapeHtml(user.business_role_name || "-")}</td>
      <td>${escapeHtml(user.location_name || "-")}</td>
      <td>${escapeHtml(user.fixed_department_name || "-")}</td>
      <td>${user.is_active ? "Aktiv" : "Inaktiv"}</td>
      <td>${user.is_app_admin ? "Ja" : "Nein"}</td>
    </tr>
  `).join("");

  $("appAdminUserSelect").innerHTML = users.length
    ? users.map((user) => `<option value="${user.id}">${escapeHtml(user.username)} (${escapeHtml(user.customer_name || "-")})</option>`).join("")
    : `<option value="">Keine Benutzer vorhanden</option>`;

  if (!selectedUserId && users.length) selectedUserId = String(users[0].id);
  if (selectedUserId) $("appAdminUserSelect").value = selectedUserId;
  syncSelectedUser();
}

function populateUserOptionSelects() {
  $("userRoleSelect").innerHTML = optionMarkup(userCustomerOptions.roles || [], "Keine Rolle");
  $("userLocationSelect").innerHTML = optionMarkup(userCustomerOptions.locations || [], "Kein Standort");
  $("userDepartmentSelect").innerHTML = optionMarkup(userCustomerOptions.departments || [], "Keine feste Abteilung");
}

function syncSelectedUser() {
  const user = users.find((entry) => String(entry.id) === String(selectedUserId || $("appAdminUserSelect").value));
  if (!user) return;
  selectedUserId = String(user.id);
  $("userCustomerSelect").value = user.app_customer_id ? String(user.app_customer_id) : "";
  $("userIsActiveSelect").value = user.is_active ? "true" : "false";
  $("userIsAppAdminSelect").value = user.is_app_admin ? "true" : "false";
  void loadUserCustomerOptions(user.app_customer_id, {
    roleId: user.role_id,
    locationId: user.location_id,
    departmentId: user.fixed_department_id
  });
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
  $("me").textContent = `${coreContext.user.username} • ${coreContext.user.business_role_name || "-"}`;
  return true;
}

async function loadCustomers() {
  const response = await api("/api/app-admin/customers", { method: "GET", headers: {} });
  customers = response.ok ? await response.json() : [];
  if (!selectedCustomerId && customers.length) selectedCustomerId = String(customers[0].id);
  updateCustomerInUrl();
  renderCustomers();
  renderCustomerEditor();
}

async function loadCustomerModules() {
  if (!selectedCustomerId) return;
  const response = await api(`/api/app-admin/customer-modules/${encodeURIComponent(selectedCustomerId)}`, { method: "GET", headers: {} });
  const data = response.ok ? await response.json() : {};
  customerModules = Array.isArray(data.modules) ? data.modules : [];
  renderCustomerModules();
}

async function loadSelectedCustomerOptions() {
  if (!selectedCustomerId) return;
  const response = await api(`/api/app-admin/customer-options/${encodeURIComponent(selectedCustomerId)}`, { method: "GET", headers: {} });
  selectedCustomerOptions = response.ok ? await response.json() : { roles: [], locations: [], departments: [] };
}

async function loadUserCustomerOptions(customerId, currentSelection = {}) {
  const targetCustomerId = customerId || "";
  if (!targetCustomerId) {
    userCustomerOptions = { roles: [], locations: [], departments: [] };
    populateUserOptionSelects();
    return;
  }
  const response = await api(`/api/app-admin/customer-options/${encodeURIComponent(targetCustomerId)}`, { method: "GET", headers: {} });
  userCustomerOptions = response.ok ? await response.json() : { roles: [], locations: [], departments: [] };
  populateUserOptionSelects();
  $("userRoleSelect").value = currentSelection.roleId ? String(currentSelection.roleId) : "";
  $("userLocationSelect").value = currentSelection.locationId ? String(currentSelection.locationId) : "";
  $("userDepartmentSelect").value = currentSelection.departmentId ? String(currentSelection.departmentId) : "";
}

async function loadUsers() {
  const response = await api("/api/app-admin/users", { method: "GET", headers: {} });
  users = response.ok ? await response.json() : [];
  renderUsers();
}

async function refreshSelectedCustomer() {
  renderCustomerEditor();
  await Promise.all([loadSelectedCustomerOptions(), loadCustomerModules()]);
}

function bindEvents() {
  $("appAdminCustomerSelect")?.addEventListener("change", async (event) => {
    selectedCustomerId = String(event.target.value || "");
    updateCustomerInUrl();
    await refreshSelectedCustomer();
  });

  $("appAdminUserSelect")?.addEventListener("change", () => {
    selectedUserId = String($("appAdminUserSelect").value || "");
    syncSelectedUser();
  });

  $("userCustomerSelect")?.addEventListener("change", async (event) => {
    await loadUserCustomerOptions(String(event.target.value || ""), {});
  });

  $("createCustomerBtn")?.addEventListener("click", async () => {
    const payload = {
      name: String($("newCustomerName").value || "").trim(),
      slug: String($("newCustomerSlug").value || "").trim()
    };
    if (!payload.name) return setMsg("createCustomerMsg", "Bitte einen Kundennamen eingeben.");
    const response = await api("/api/app-admin/customers", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("createCustomerMsg", data?.error || "Kunde konnte nicht angelegt werden.");
    $("newCustomerName").value = "";
    $("newCustomerSlug").value = "";
    selectedCustomerId = String(data.id);
    setMsg("createCustomerMsg", "Kunde angelegt.", true);
    await loadCustomers();
    await refreshSelectedCustomer();
  });

  $("saveCustomerBtn")?.addEventListener("click", async () => {
    if (!selectedCustomerId) return setMsg("saveCustomerMsg", "Bitte zuerst einen Kunden auswaehlen.");
    const payload = {
      name: String($("editCustomerName").value || "").trim(),
      slug: String($("editCustomerSlug").value || "").trim(),
      is_active: $("editCustomerActive").value === "true"
    };
    const response = await api(`/api/app-admin/customers/${encodeURIComponent(selectedCustomerId)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("saveCustomerMsg", data?.error || "Kunde konnte nicht gespeichert werden.");
    setMsg("saveCustomerMsg", "Kunde gespeichert.", true);
    await loadCustomers();
  });

  $("openSelectedCustomerAdminBtn")?.addEventListener("click", () => {
    if (!selectedCustomerId) return;
    window.location.href = `/admin.html?customerId=${encodeURIComponent(selectedCustomerId)}`;
  });

  $("saveCustomerModulesBtn")?.addEventListener("click", async () => {
    if (!selectedCustomerId) return setMsg("customerModulesMsg", "Bitte zuerst einen Kunden auswaehlen.");
    const modules = Array.from(document.querySelectorAll("[data-module-key]")).map((input) => ({
      key: input.dataset.moduleKey,
      is_enabled: input.checked
    }));
    const response = await api(`/api/app-admin/customer-modules/${encodeURIComponent(selectedCustomerId)}`, {
      method: "PUT",
      body: JSON.stringify({ modules })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("customerModulesMsg", data?.error || "Freischaltungen konnten nicht gespeichert werden.");
    customerModules = Array.isArray(data.modules) ? data.modules : customerModules;
    renderCustomerModules();
    setMsg("customerModulesMsg", "Freischaltungen gespeichert.", true);
  });

  $("saveUserBtn")?.addEventListener("click", async () => {
    if (!selectedUserId) return setMsg("saveUserMsg", "Bitte einen Benutzer auswaehlen.");
    const payload = {
      app_customer_id: $("userCustomerSelect").value || null,
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
  selectedCustomerId = String(new URLSearchParams(window.location.search).get("customerId") || "").trim();
  bindSettingsMenu();
  bindPasswordModal();
  bindEvents();
  const ok = await loadCoreContext();
  if (!ok) return;
  await loadCustomers();
  await refreshSelectedCustomer();
  await loadUsers();
})();
