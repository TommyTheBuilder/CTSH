let token = localStorage.getItem("token");
let context = null;
let locations = [];
let departments = [];
let entrepreneurs = [];
let editingEntrepreneurId = null;
let adminHistory = [];

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

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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

  $("menuDarkmodeBtn")?.addEventListener("click", () => {
    $("themeToggleBtn")?.click();
    closeSettingsMenu();
  });

  $("openModuleBtn")?.addEventListener("click", () => {
    closeSettingsMenu();
    window.location.href = "/pallets";
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    closeSettingsMenu();
    try {
      await api("/api/logout", { method: "POST", headers: {} });
    } catch {}
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  });

  $("openChangePasswordBtn")?.addEventListener("click", () => {
    closeSettingsMenu();
    setMsg("passwordModalMsg", "", true);
    $("currentPassword").value = "";
    $("newPassword").value = "";
    $("confirmPassword").value = "";
    showPasswordModal(true);
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

function updateContextUi() {
  $("me").textContent = context?.user
    ? `${context.user.username} - ${context.user.business_role_name || "-"}`
    : "-";
  $("managedCustomerName").textContent = context?.installation?.name || context?.managed_customer?.name || "Keine Installation";
}

async function loadContext() {
  const response = await api("/api/modules/pallets/admin/context", { method: "GET", headers: {} });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login.html";
      return false;
    }
    const data = await response.json().catch(() => ({}));
    alert(data?.error || "Modul-Administration konnte nicht geladen werden.");
    window.location.href = "/dashboard.html";
    return false;
  }

  context = await response.json();
  updateContextUi();
  return true;
}

function renderLocations() {
  $("locationsBody").innerHTML = locations.map((entry) => `
    <tr>
      <td>${entry.name}</td>
      <td><button class="secondary" type="button" data-delete-location="${entry.id}" style="width:auto;">Löschen</button></td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-delete-location]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Standort wirklich löschen?")) return;
      const response = await api(`/api/modules/pallets/admin/locations/${encodeURIComponent(button.dataset.deleteLocation)}`, {
        method: "DELETE"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setMsg("locationMsg", data?.error || "Löschen fehlgeschlagen.");
      setMsg("locationMsg", "Standort gelöscht.", true);
      await loadLocations();
      await loadAdminHistory();
    });
  });
}

function renderDepartments() {
  $("departmentsBody").innerHTML = departments.map((entry) => `
    <tr>
      <td>${entry.name}</td>
      <td><button class="secondary" type="button" data-delete-department="${entry.id}" style="width:auto;">Löschen</button></td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-delete-department]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Abteilung wirklich löschen?")) return;
      const response = await api(`/api/modules/pallets/admin/departments/${encodeURIComponent(button.dataset.deleteDepartment)}`, {
        method: "DELETE"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setMsg("departmentMsg", data?.error || "Löschen fehlgeschlagen.");
      setMsg("departmentMsg", "Abteilung gelöscht.", true);
      await loadDepartments();
      await loadAdminHistory();
    });
  });
}

function entrepreneurAddress(entry) {
  return [entry.street, [entry.postal_code, entry.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "-";
}

function renderEntrepreneurs() {
  $("entrepreneursBody").innerHTML = entrepreneurs.map((entry) => `
    <tr>
      <td>${entry.name}</td>
      <td>${entrepreneurAddress(entry)}</td>
      <td>
        <div class="module-admin-inline-actions">
          <button class="secondary" type="button" data-edit-entrepreneur="${entry.id}" style="width:auto;">Bearbeiten</button>
          <button class="secondary" type="button" data-delete-entrepreneur="${entry.id}" style="width:auto;">Löschen</button>
        </div>
      </td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-edit-entrepreneur]").forEach((button) => {
    button.addEventListener("click", () => {
      const match = entrepreneurs.find((entry) => String(entry.id) === String(button.dataset.editEntrepreneur));
      if (!match) return;
      editingEntrepreneurId = match.id;
      $("entrepreneurName").value = match.name || "";
      $("entrepreneurStreet").value = match.street || "";
      $("entrepreneurPostal").value = match.postal_code || "";
      $("entrepreneurCity").value = match.city || "";
      setMsg("entrepreneurMsg", "");
    });
  });

  document.querySelectorAll("[data-delete-entrepreneur]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Frachtführer wirklich löschen?")) return;
      const response = await api(`/api/modules/pallets/admin/entrepreneurs/${encodeURIComponent(button.dataset.deleteEntrepreneur)}`, {
        method: "DELETE"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setMsg("entrepreneurMsg", data?.error || "Löschen fehlgeschlagen.");
      if (String(editingEntrepreneurId) === String(button.dataset.deleteEntrepreneur)) resetEntrepreneurForm();
      setMsg("entrepreneurMsg", "Frachtführer gelöscht.", true);
      await loadEntrepreneurs();
      await loadAdminHistory();
    });
  });
}

function resetEntrepreneurForm() {
  editingEntrepreneurId = null;
  $("entrepreneurName").value = "";
  $("entrepreneurStreet").value = "";
  $("entrepreneurPostal").value = "";
  $("entrepreneurCity").value = "";
}

async function loadLocations() {
  const response = await api("/api/modules/pallets/admin/locations", { method: "GET", headers: {} });
  locations = response.ok ? await response.json() : [];
  renderLocations();
}

async function loadDepartments() {
  const response = await api("/api/modules/pallets/admin/departments", { method: "GET", headers: {} });
  departments = response.ok ? await response.json() : [];
  renderDepartments();
}

async function loadEntrepreneurs() {
  const response = await api("/api/modules/pallets/admin/entrepreneurs", { method: "GET", headers: {} });
  entrepreneurs = response.ok ? await response.json() : [];
  renderEntrepreneurs();
}

function historyActionLabel(action) {
  return ({
    create: "Angelegt",
    update: "Geändert",
    delete: "Gelöscht"
  })[action] || action || "-";
}

function historyEntityLabel(entityType) {
  return ({
    location: "Standort",
    department: "Abteilung",
    entrepreneur: "Frachtführer"
  })[entityType] || entityType || "-";
}

function summarizeHistoryDetails(entry) {
  const before = entry?.details?.before;
  const after = entry?.details?.after;
  if (!before || !after) return "-";

  const fields = [
    { key: "name", label: "Name" },
    { key: "street", label: "Straße" },
    { key: "postal_code", label: "PLZ" },
    { key: "city", label: "Ort" }
  ];

  const changes = fields
    .filter(({ key }) => String(before?.[key] ?? "") !== String(after?.[key] ?? ""))
    .map(({ key, label }) => `${label}: ${before?.[key] ?? "-"} -> ${after?.[key] ?? "-"}`);

  return changes.length ? changes.join(" | ") : "-";
}

function renderAdminHistory() {
  const body = $("adminHistoryBody");
  if (!body) return;

  if (!adminHistory.length) {
    body.innerHTML = `<tr><td colspan="6">Keine Einträge</td></tr>`;
    return;
  }

  body.innerHTML = adminHistory.map((entry) => `
    <tr>
      <td>${escapeHtml(formatDateTime(entry.created_at))}</td>
      <td>${escapeHtml(historyEntityLabel(entry.entity_type))}</td>
      <td>${escapeHtml(historyActionLabel(entry.action))}</td>
      <td>${escapeHtml(entry.entity_label || "-")}</td>
      <td>${escapeHtml(summarizeHistoryDetails(entry))}</td>
      <td>${escapeHtml(entry.changed_by || "-")}</td>
    </tr>
  `).join("");
}

async function loadAdminHistory() {
  const response = await api("/api/modules/pallets/admin/history", { method: "GET", headers: {} });
  adminHistory = response.ok ? await response.json() : [];
  renderAdminHistory();
}

function bindActions() {
  $("saveLocationBtn")?.addEventListener("click", async () => {
    const name = String($("locationName").value || "").trim();
    if (!name) return setMsg("locationMsg", "Bitte einen Standortnamen eingeben.");
    const response = await api("/api/modules/pallets/admin/locations", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("locationMsg", data?.error || "Speichern fehlgeschlagen.");
    $("locationName").value = "";
    setMsg("locationMsg", "Standort gespeichert.", true);
    await loadLocations();
    await loadAdminHistory();
  });

  $("saveDepartmentBtn")?.addEventListener("click", async () => {
    const name = String($("departmentName").value || "").trim();
    if (!name) return setMsg("departmentMsg", "Bitte einen Abteilungsnamen eingeben.");
    const response = await api("/api/modules/pallets/admin/departments", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("departmentMsg", data?.error || "Speichern fehlgeschlagen.");
    $("departmentName").value = "";
    setMsg("departmentMsg", "Abteilung gespeichert.", true);
    await loadDepartments();
    await loadAdminHistory();
  });

  $("saveEntrepreneurBtn")?.addEventListener("click", async () => {
    const payload = {
      name: String($("entrepreneurName").value || "").trim(),
      street: String($("entrepreneurStreet").value || "").trim() || null,
      postal_code: String($("entrepreneurPostal").value || "").trim() || null,
      city: String($("entrepreneurCity").value || "").trim() || null
    };
    if (!payload.name) return setMsg("entrepreneurMsg", "Bitte einen Namen eingeben.");

    const response = await api(
      editingEntrepreneurId
        ? `/api/modules/pallets/admin/entrepreneurs/${encodeURIComponent(editingEntrepreneurId)}`
        : "/api/modules/pallets/admin/entrepreneurs",
      {
        method: editingEntrepreneurId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("entrepreneurMsg", data?.error || "Speichern fehlgeschlagen.");
    const wasEditing = Boolean(editingEntrepreneurId);
    resetEntrepreneurForm();
    setMsg("entrepreneurMsg", wasEditing ? "Frachtführer aktualisiert." : "Frachtführer gespeichert.", true);
    await loadEntrepreneurs();
    await loadAdminHistory();
  });

  $("resetEntrepreneurBtn")?.addEventListener("click", () => {
    resetEntrepreneurForm();
    setMsg("entrepreneurMsg", "");
  });
}

(async function init() {
  bindSettingsMenu();
  bindPasswordModal();
  bindActions();
  const ok = await loadContext();
  if (!ok) return;
  await Promise.all([loadLocations(), loadDepartments(), loadEntrepreneurs(), loadAdminHistory()]);
})();
