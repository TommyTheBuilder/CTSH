let token = localStorage.getItem("token");
let context = null;
let customers = [];
let selectedCustomerId = "";
let locations = [];
let departments = [];
let entrepreneurs = [];
let editingEntrepreneurId = null;

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

function withCustomerQuery(path) {
  if (!selectedCustomerId) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("customerId", selectedCustomerId);
  return `${url.pathname}${url.search}`;
}

function setMsg(id, text, ok = false) {
  const el = $(id);
  if (!el) return;
  el.style.color = ok ? "#0a7a2f" : "#b00020";
  el.textContent = text || "";
}

function sanitizeUrlCustomer() {
  const url = new URL(window.location.href);
  if (selectedCustomerId) url.searchParams.set("customerId", selectedCustomerId);
  else url.searchParams.delete("customerId");
  history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
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
    if (!response.ok) {
      return setMsg("passwordModalMsg", data?.error || "Passwort konnte nicht gespeichert werden.");
    }
    setMsg("passwordModalMsg", "Passwort gespeichert.", true);
    window.setTimeout(() => showPasswordModal(false), 700);
  });
}

function renderCustomerSwitcher() {
  const wrap = $("customerSwitchWrap");
  const select = $("customerSelect");
  if (!wrap || !select) return;

  if (!customers.length) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "";
  select.innerHTML = customers.map((customer) => (
    `<option value="${customer.id}">${customer.name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</option>`
  )).join("");
  if (selectedCustomerId) select.value = selectedCustomerId;
}

function updateContextUi() {
  $("me").textContent = context?.user
    ? `${context.user.username} • ${context.user.business_role_name || "-"}`
    : "-";
  $("managedCustomerName").textContent = context?.managed_customer?.name || "Kein Kunde";
}

async function loadContext() {
  const response = await api(withCustomerQuery("/api/modules/pallets/admin/context"), { method: "GET", headers: {} });
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
  customers = Array.isArray(context.available_customers) ? context.available_customers : [];
  if (!selectedCustomerId && context?.managed_customer?.id) {
    selectedCustomerId = String(context.managed_customer.id);
  }
  sanitizeUrlCustomer();
  renderCustomerSwitcher();
  updateContextUi();
  return true;
}

function renderLocations() {
  $("locationsBody").innerHTML = locations.map((entry) => `
    <tr>
      <td>${entry.name}</td>
      <td><button class="secondary" type="button" data-delete-location="${entry.id}" style="width:auto;">Loeschen</button></td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-delete-location]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Standort wirklich loeschen?")) return;
      const response = await api(withCustomerQuery(`/api/modules/pallets/admin/locations/${encodeURIComponent(button.dataset.deleteLocation)}`), {
        method: "DELETE"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setMsg("locationMsg", data?.error || "Loeschen fehlgeschlagen.");
      setMsg("locationMsg", "Standort geloescht.", true);
      await loadLocations();
    });
  });
}

function renderDepartments() {
  $("departmentsBody").innerHTML = departments.map((entry) => `
    <tr>
      <td>${entry.name}</td>
      <td><button class="secondary" type="button" data-delete-department="${entry.id}" style="width:auto;">Loeschen</button></td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-delete-department]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Abteilung wirklich loeschen?")) return;
      const response = await api(withCustomerQuery(`/api/modules/pallets/admin/departments/${encodeURIComponent(button.dataset.deleteDepartment)}`), {
        method: "DELETE"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setMsg("departmentMsg", data?.error || "Loeschen fehlgeschlagen.");
      setMsg("departmentMsg", "Abteilung geloescht.", true);
      await loadDepartments();
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
          <button class="secondary" type="button" data-delete-entrepreneur="${entry.id}" style="width:auto;">Loeschen</button>
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
      if (!confirm("Frachtfuehrer wirklich loeschen?")) return;
      const response = await api(withCustomerQuery(`/api/modules/pallets/admin/entrepreneurs/${encodeURIComponent(button.dataset.deleteEntrepreneur)}`), {
        method: "DELETE"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setMsg("entrepreneurMsg", data?.error || "Loeschen fehlgeschlagen.");
      if (String(editingEntrepreneurId) === String(button.dataset.deleteEntrepreneur)) resetEntrepreneurForm();
      setMsg("entrepreneurMsg", "Frachtfuehrer geloescht.", true);
      await loadEntrepreneurs();
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
  const response = await api(withCustomerQuery("/api/modules/pallets/admin/locations"), { method: "GET", headers: {} });
  locations = response.ok ? await response.json() : [];
  renderLocations();
}

async function loadDepartments() {
  const response = await api(withCustomerQuery("/api/modules/pallets/admin/departments"), { method: "GET", headers: {} });
  departments = response.ok ? await response.json() : [];
  renderDepartments();
}

async function loadEntrepreneurs() {
  const response = await api(withCustomerQuery("/api/modules/pallets/admin/entrepreneurs"), { method: "GET", headers: {} });
  entrepreneurs = response.ok ? await response.json() : [];
  renderEntrepreneurs();
}

function bindActions() {
  $("customerSelect")?.addEventListener("change", async (event) => {
    selectedCustomerId = String(event.target.value || "");
    sanitizeUrlCustomer();
    const ok = await loadContext();
    if (!ok) return;
    await Promise.all([loadLocations(), loadDepartments(), loadEntrepreneurs()]);
  });

  $("saveLocationBtn")?.addEventListener("click", async () => {
    const name = String($("locationName").value || "").trim();
    if (!name) return setMsg("locationMsg", "Bitte einen Standortnamen eingeben.");
    const response = await api(withCustomerQuery("/api/modules/pallets/admin/locations"), {
      method: "POST",
      body: JSON.stringify({ name })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("locationMsg", data?.error || "Speichern fehlgeschlagen.");
    $("locationName").value = "";
    setMsg("locationMsg", "Standort gespeichert.", true);
    await loadLocations();
  });

  $("saveDepartmentBtn")?.addEventListener("click", async () => {
    const name = String($("departmentName").value || "").trim();
    if (!name) return setMsg("departmentMsg", "Bitte einen Abteilungsnamen eingeben.");
    const response = await api(withCustomerQuery("/api/modules/pallets/admin/departments"), {
      method: "POST",
      body: JSON.stringify({ name })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("departmentMsg", data?.error || "Speichern fehlgeschlagen.");
    $("departmentName").value = "";
    setMsg("departmentMsg", "Abteilung gespeichert.", true);
    await loadDepartments();
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
      withCustomerQuery(editingEntrepreneurId
        ? `/api/modules/pallets/admin/entrepreneurs/${encodeURIComponent(editingEntrepreneurId)}`
        : "/api/modules/pallets/admin/entrepreneurs"),
      {
        method: editingEntrepreneurId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg("entrepreneurMsg", data?.error || "Speichern fehlgeschlagen.");
    resetEntrepreneurForm();
    setMsg("entrepreneurMsg", editingEntrepreneurId ? "Frachtfuehrer aktualisiert." : "Frachtfuehrer gespeichert.", true);
    await loadEntrepreneurs();
  });

  $("resetEntrepreneurBtn")?.addEventListener("click", () => {
    resetEntrepreneurForm();
    setMsg("entrepreneurMsg", "");
  });
}

(async function init() {
  selectedCustomerId = String(new URLSearchParams(window.location.search).get("customerId") || "").trim();
  bindSettingsMenu();
  bindPasswordModal();
  bindActions();
  const ok = await loadContext();
  if (!ok) return;
  await Promise.all([loadLocations(), loadDepartments(), loadEntrepreneurs()]);
})();
