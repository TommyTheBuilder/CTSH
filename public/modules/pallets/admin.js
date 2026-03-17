let token = localStorage.getItem("token");
let context = null;
let locations = [];
let departments = [];
let entrepreneurs = [];
let editingEntrepreneurId = null;
let adminHistory = [];
let bookingHistory = [];
let bookingHistoryOffset = 0;
let bookingHistoryHasMore = false;

const BOOKING_HISTORY_PAGE_SIZE = 25;

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

async function readJsonSafe(response) {
  return response.json().catch(() => ({}));
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

function showBookingHistoryModal(show) {
  const back = $("bookingHistoryModalBack");
  if (!back) return;
  back.style.display = show ? "flex" : "none";
  back.setAttribute("aria-hidden", show ? "false" : "true");
  if (show) {
    closeSettingsMenu();
    window.requestAnimationFrame(() => $("closeBookingHistoryModalBtn")?.focus());
  }
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
      showBookingHistoryModal(false);
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
      return setMsg("passwordModalMsg", "Bitte alle Felder ausf\u00fcllen.");
    }
    if (new_password.length < 8) {
      return setMsg("passwordModalMsg", "Das neue Passwort muss mindestens 8 Zeichen lang sein.");
    }
    if (new_password !== confirm_password) {
      return setMsg("passwordModalMsg", "Die Passw\u00f6rter stimmen nicht \u00fcberein.");
    }

    const response = await api("/api/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password })
    });
    const data = await readJsonSafe(response);
    if (!response.ok) {
      return setMsg("passwordModalMsg", data?.error || "Passwort konnte nicht gespeichert werden.");
    }
    setMsg("passwordModalMsg", "Passwort gespeichert.", true);
    window.setTimeout(() => showPasswordModal(false), 700);
  });
}

function bindBookingHistoryModal() {
  $("closeBookingHistoryModalBtn")?.addEventListener("click", () => showBookingHistoryModal(false));
  $("bookingHistoryModalBack")?.addEventListener("click", (event) => {
    if (event.target === $("bookingHistoryModalBack")) showBookingHistoryModal(false);
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
    const data = await readJsonSafe(response);
    window.alert(data?.error || "Modul-Administration konnte nicht geladen werden.");
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
      <td>${escapeHtml(entry.name)}</td>
      <td><button class="secondary" type="button" data-delete-location="${entry.id}" style="width:auto;">L\u00f6schen</button></td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-delete-location]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Standort wirklich l\u00f6schen?")) return;
      const response = await api(`/api/modules/pallets/admin/locations/${encodeURIComponent(button.dataset.deleteLocation)}`, {
        method: "DELETE"
      });
      const data = await readJsonSafe(response);
      if (!response.ok) return setMsg("locationMsg", data?.error || "L\u00f6schen fehlgeschlagen.");
      setMsg("locationMsg", "Standort gel\u00f6scht.", true);
      await loadLocations();
      await loadAdminHistory();
    });
  });
}

function renderDepartments() {
  $("departmentsBody").innerHTML = departments.map((entry) => `
    <tr>
      <td>${escapeHtml(entry.name)}</td>
      <td><button class="secondary" type="button" data-delete-department="${entry.id}" style="width:auto;">L\u00f6schen</button></td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-delete-department]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Abteilung wirklich l\u00f6schen?")) return;
      const response = await api(`/api/modules/pallets/admin/departments/${encodeURIComponent(button.dataset.deleteDepartment)}`, {
        method: "DELETE"
      });
      const data = await readJsonSafe(response);
      if (!response.ok) return setMsg("departmentMsg", data?.error || "L\u00f6schen fehlgeschlagen.");
      setMsg("departmentMsg", "Abteilung gel\u00f6scht.", true);
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
      <td>${escapeHtml(entry.name)}</td>
      <td>${escapeHtml(entrepreneurAddress(entry))}</td>
      <td>
        <div class="module-admin-inline-actions">
          <button class="secondary" type="button" data-edit-entrepreneur="${entry.id}" style="width:auto;">Bearbeiten</button>
          <button class="secondary" type="button" data-delete-entrepreneur="${entry.id}" style="width:auto;">L\u00f6schen</button>
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
      if (!window.confirm("Frachtf\u00fchrer wirklich l\u00f6schen?")) return;
      const response = await api(`/api/modules/pallets/admin/entrepreneurs/${encodeURIComponent(button.dataset.deleteEntrepreneur)}`, {
        method: "DELETE"
      });
      const data = await readJsonSafe(response);
      if (!response.ok) return setMsg("entrepreneurMsg", data?.error || "L\u00f6schen fehlgeschlagen.");
      if (String(editingEntrepreneurId) === String(button.dataset.deleteEntrepreneur)) resetEntrepreneurForm();
      setMsg("entrepreneurMsg", "Frachtf\u00fchrer gel\u00f6scht.", true);
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
    update: "Ge\u00e4ndert",
    delete: "Gel\u00f6scht"
  })[action] || action || "-";
}

function historyEntityLabel(entityType) {
  return ({
    location: "Standort",
    department: "Abteilung",
    entrepreneur: "Frachtf\u00fchrer"
  })[entityType] || entityType || "-";
}

function summarizeHistoryDetails(entry) {
  const before = entry?.details?.before;
  const after = entry?.details?.after;
  if (!before || !after) return "-";

  const fields = [
    { key: "name", label: "Name" },
    { key: "street", label: "Stra\u00dfe" },
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
    body.innerHTML = `<tr><td colspan="6">Keine Eintr\u00e4ge</td></tr>`;
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

function caseStatusLabel(status) {
  return ({
    0: "Storniert",
    1: "Aviso",
    2: "In Bearbeitung",
    3: "In Pr\u00fcfung",
    4: "Gebucht"
  })[Number(status)] || String(status ?? "-");
}

function caseStatusClass(status) {
  return ({
    0: "cancelled",
    1: "aviso",
    2: "processing",
    3: "review",
    4: "booked"
  })[Number(status)] || "neutral";
}

function productTypeLabel(value) {
  return ({
    euro: "Euro-Paletten",
    h1: "H1-Paletten",
    gitterbox: "Gitterboxen"
  })[String(value || "").trim().toLowerCase()] || value || "-";
}

function caseActionLabel(action) {
  return ({
    create: "Angelegt",
    edit: "Bearbeitet",
    claim: "\u00dcbernommen",
    submit: "Zur Pr\u00fcfung",
    approve: "Gebucht",
    set_translogica: "Translogica",
    cancel: "Storniert",
    delete: "Gel\u00f6scht"
  })[action] || action || "-";
}

function caseHistoryFieldLabel(field) {
  return ({
    department_id: "Abteilung",
    license_plate: "Kennzeichen",
    entrepreneur: "Frachtf\u00fchrer",
    note: "Notiz",
    qty_in: "Eingang",
    qty_out: "Ausgang",
    non_exchangeable_qty: "Nicht tauschf\u00e4hig",
    employee_code: "Lagermitarbeiter",
    product_type: "Produkt",
    status: "Status",
    receipt_no: "Belegnummer",
    translogica_transferred: "Translogica"
  })[field] || field || "-";
}

function departmentNameById(id) {
  const numericId = Number(id || 0);
  if (!numericId) return "-";
  const match = departments.find((entry) => Number(entry.id) === numericId);
  return match?.name || `#${numericId}`;
}

function formatCaseHistoryValue(field, value) {
  if (value === undefined || value === null || value === "") return "-";
  switch (field) {
    case "status":
      return caseStatusLabel(value);
    case "product_type":
      return productTypeLabel(value);
    case "translogica_transferred":
      return value ? "Ja" : "Nein";
    case "department_id":
      return departmentNameById(value);
    default:
      return String(value);
  }
}

function summarizeCaseHistoryChanges(changes) {
  const entries = Array.isArray(changes) ? changes : [];
  if (!entries.length) return "-";

  const summary = entries.slice(0, 2).map((change) => {
    const label = caseHistoryFieldLabel(change?.field);
    const from = formatCaseHistoryValue(change?.field, change?.from);
    const to = formatCaseHistoryValue(change?.field, change?.to);
    return `${label}: ${from} \u2192 ${to}`;
  });

  if (entries.length > 2) {
    summary.push(`+${entries.length - 2} weitere`);
  }

  return summary.join(" | ");
}

function updateBookingHistoryPagination() {
  $("bookingHistoryPrevBtn").disabled = bookingHistoryOffset === 0;
  $("bookingHistoryNextBtn").disabled = !bookingHistoryHasMore;
  const page = Math.floor(bookingHistoryOffset / BOOKING_HISTORY_PAGE_SIZE) + 1;
  $("bookingHistoryPageLabel").textContent = `Seite ${page}`;
}

function renderBookingHistory() {
  const body = $("bookingHistoryBody");
  if (!body) return;

  updateBookingHistoryPagination();

  if (!bookingHistory.length) {
    body.innerHTML = `<tr><td colspan="8">Keine Buchungs\u00e4nderungen</td></tr>`;
    return;
  }

  body.innerHTML = bookingHistory.map((entry) => `
    <tr>
      <td>${escapeHtml(formatDateTime(entry.last_changed_at))}</td>
      <td>
        <div class="admin-booking-history__cell-title">#${escapeHtml(entry.case_id)}</div>
        <div class="admin-booking-history__meta">
          <span>Kennzeichen: ${escapeHtml(entry.license_plate || "-")}</span>
          <span>Beleg: ${escapeHtml(entry.current_receipt_no || entry.receipt_no || "-")}</span>
          <span>Frachtf\u00fchrer: ${escapeHtml(entry.entrepreneur || "-")}</span>
          <span>${escapeHtml(productTypeLabel(entry.product_type))}</span>
          <span>${escapeHtml(`${entry.history_count || 0} \u00c4nderungen`)}</span>
        </div>
      </td>
      <td>${escapeHtml(entry.location_name || "-")}</td>
      <td>${escapeHtml(entry.department_name || "-")}</td>
      <td>
        <span class="pallet-status-badge pallet-status-badge--${escapeHtml(caseStatusClass(entry.status))}">
          ${escapeHtml(caseStatusLabel(entry.status))}
        </span>
      </td>
      <td>
        <div class="admin-booking-history__cell-title">${escapeHtml(caseActionLabel(entry.action))}</div>
        <div class="admin-booking-history__meta admin-booking-history__meta--compact">
          <span>${escapeHtml(summarizeCaseHistoryChanges(entry.changes))}</span>
        </div>
      </td>
      <td>${escapeHtml(entry.changed_by || "-")}</td>
      <td><button class="secondary" type="button" data-open-booking-history="${entry.case_id}" style="width:auto;">\u00d6ffnen</button></td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-open-booking-history]").forEach((button) => {
    button.addEventListener("click", () => {
      const caseId = Number(button.dataset.openBookingHistory || 0);
      if (!caseId) return;
      void openBookingHistoryDetail(caseId);
    });
  });
}

async function loadBookingHistory({ resetPage = false } = {}) {
  if (resetPage) bookingHistoryOffset = 0;

  const params = new URLSearchParams({
    limit: String(BOOKING_HISTORY_PAGE_SIZE),
    offset: String(bookingHistoryOffset)
  });

  const response = await api(`/api/modules/pallets/admin/booking-history?${params.toString()}`, { method: "GET", headers: {} });
  if (!response.ok) {
    bookingHistory = [];
    bookingHistoryHasMore = false;
    const data = await readJsonSafe(response);
    const body = $("bookingHistoryBody");
    if (body) {
      body.innerHTML = `<tr><td colspan="8">${escapeHtml(data?.error || "Buchungshistorie konnte nicht geladen werden.")}</td></tr>`;
    }
    updateBookingHistoryPagination();
    return;
  }

  const data = await response.json();
  bookingHistory = Array.isArray(data?.items) ? data.items : [];
  bookingHistoryHasMore = Boolean(data?.has_more);

  if (bookingHistoryOffset > 0 && bookingHistory.length === 0) {
    bookingHistoryOffset = Math.max(0, bookingHistoryOffset - BOOKING_HISTORY_PAGE_SIZE);
    await loadBookingHistory();
    return;
  }

  renderBookingHistory();
}

function renderBookingDetailField(label, value) {
  return `
    <div class="admin-booking-detail__field">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderBookingHistoryChanges(changes) {
  const entries = Array.isArray(changes) ? changes : [];
  if (!entries.length) {
    return `<div class="admin-booking-detail__empty">Keine Detail\u00e4nderungen gespeichert.</div>`;
  }

  return `
    <div class="change-grid">
      ${entries.map((change) => `
        <div class="change-row">
          <div class="change-field">${escapeHtml(caseHistoryFieldLabel(change?.field))}</div>
          <div class="change-values">
            <span class="change-old">${escapeHtml(formatCaseHistoryValue(change?.field, change?.from))}</span>
            <span class="change-arrow">\u2192</span>
            <span class="change-new">${escapeHtml(formatCaseHistoryValue(change?.field, change?.to))}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderBookingHistoryTimelineEntry(entry) {
  return `
    <article class="rollcard change-history-card">
      <div class="admin-booking-detail__timeline-head">
        <strong>${escapeHtml(caseActionLabel(entry?.action))}</strong>
        <span>${escapeHtml(formatDateTime(entry?.created_at))}</span>
      </div>
      <div class="admin-booking-detail__timeline-meta">
        <span>Benutzer: ${escapeHtml(entry?.changed_by || "-")}</span>
        <span>Beleg: ${escapeHtml(entry?.receipt_no || "-")}</span>
      </div>
      ${renderBookingHistoryChanges(entry?.changes)}
    </article>
  `;
}

function renderBookingHistoryDetail(booking, history) {
  $("bookingHistoryModalTitle").textContent = `Buchung #${booking?.id || "-"}`;
  $("bookingHistoryModalMeta").textContent = [
    booking?.location || "-",
    booking?.department || "-",
    booking?.license_plate ? `Kennzeichen ${booking.license_plate}` : "Kennzeichen -"
  ].join(" | ");

  $("bookingHistoryModalBody").innerHTML = `
    <section class="admin-booking-detail">
      <article class="admin-booking-detail__hero">
        <div>
          <span class="module-section-kicker">Paletten-Buchung</span>
          <h4>#${escapeHtml(booking?.id || "-")}</h4>
          <div class="admin-booking-detail__hero-meta">
            <span>Erstellt: ${escapeHtml(formatDateTime(booking?.created_at))}</span>
            <span>Aktualisiert: ${escapeHtml(formatDateTime(booking?.updated_at))}</span>
          </div>
        </div>
        <div class="admin-booking-detail__badges">
          <span class="pallet-status-badge pallet-status-badge--${escapeHtml(caseStatusClass(booking?.status))}">
            ${escapeHtml(caseStatusLabel(booking?.status))}
          </span>
          <span class="badge">${escapeHtml(productTypeLabel(booking?.product_type))}</span>
        </div>
      </article>

      <section class="admin-booking-detail__grid">
        <article class="admin-booking-detail__card">
          <div class="admin-booking-detail__card-head">
            <div>
              <span class="module-section-kicker">Basis</span>
              <h4>Stammdaten</h4>
            </div>
          </div>
          <div class="admin-booking-detail__fields">
            ${renderBookingDetailField("Standort", booking?.location || "-")}
            ${renderBookingDetailField("Abteilung", booking?.department || "-")}
            ${renderBookingDetailField("Kennzeichen", booking?.license_plate || "-")}
            ${renderBookingDetailField("Frachtf\u00fchrer", booking?.entrepreneur || "-")}
            ${renderBookingDetailField("Belegnummer", booking?.receipt_no || "-")}
            ${renderBookingDetailField("Produkt", productTypeLabel(booking?.product_type))}
          </div>
        </article>

        <article class="admin-booking-detail__card">
          <div class="admin-booking-detail__card-head">
            <div>
              <span class="module-section-kicker">Mengen</span>
              <h4>Buchungsdaten</h4>
            </div>
          </div>
          <div class="admin-booking-detail__fields">
            ${renderBookingDetailField("Status", caseStatusLabel(booking?.status))}
            ${renderBookingDetailField("Eingang", booking?.qty_in ?? 0)}
            ${renderBookingDetailField("Ausgang", booking?.qty_out ?? 0)}
            ${renderBookingDetailField("Nicht tauschf\u00e4hig", booking?.non_exchangeable_qty ?? 0)}
            ${renderBookingDetailField("Lagermitarbeiter", booking?.employee_code || "-")}
            ${renderBookingDetailField("Translogica", booking?.translogica_transferred ? "Ja" : "Nein")}
          </div>
        </article>

        <article class="admin-booking-detail__card">
          <div class="admin-booking-detail__card-head">
            <div>
              <span class="module-section-kicker">Bearbeitung</span>
              <h4>Benutzer</h4>
            </div>
          </div>
          <div class="admin-booking-detail__fields">
            ${renderBookingDetailField("Erstellt von", booking?.created_by_name || "-")}
            ${renderBookingDetailField("\u00dcbernommen von", booking?.claimed_by_name || "-")}
            ${renderBookingDetailField("Eingereicht von", booking?.submitted_by_name || "-")}
            ${renderBookingDetailField("Gebucht von", booking?.approved_by_name || "-")}
            ${renderBookingDetailField("Gebucht am", formatDateTime(booking?.approved_at))}
            ${renderBookingDetailField("Notiz", booking?.note || "-")}
          </div>
        </article>
      </section>

      <article class="admin-booking-detail__card">
        <div class="admin-booking-detail__card-head">
          <div>
            <span class="module-section-kicker">Verlauf</span>
            <h4>\u00c4nderungsverlauf</h4>
          </div>
        </div>
        <div class="rollcard-list change-history-list">
          ${(Array.isArray(history) && history.length)
            ? history.map((entry) => renderBookingHistoryTimelineEntry(entry)).join("")
            : `<div class="admin-booking-detail__empty">Keine \u00c4nderungen vorhanden.</div>`}
        </div>
      </article>
    </section>
  `;
}

async function openBookingHistoryDetail(caseId) {
  const response = await api(`/api/modules/pallets/admin/booking-history/${encodeURIComponent(caseId)}`, { method: "GET", headers: {} });
  const data = await readJsonSafe(response);
  if (!response.ok) {
    window.alert(data?.error || "Buchungsdetails konnten nicht geladen werden.");
    return;
  }

  renderBookingHistoryDetail(data?.booking || {}, Array.isArray(data?.history) ? data.history : []);
  showBookingHistoryModal(true);
}

function bindActions() {
  $("saveLocationBtn")?.addEventListener("click", async () => {
    const name = String($("locationName").value || "").trim();
    if (!name) return setMsg("locationMsg", "Bitte einen Standortnamen eingeben.");
    const response = await api("/api/modules/pallets/admin/locations", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    const data = await readJsonSafe(response);
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
    const data = await readJsonSafe(response);
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
    const data = await readJsonSafe(response);
    if (!response.ok) return setMsg("entrepreneurMsg", data?.error || "Speichern fehlgeschlagen.");
    const wasEditing = Boolean(editingEntrepreneurId);
    resetEntrepreneurForm();
    setMsg("entrepreneurMsg", wasEditing ? "Frachtf\u00fchrer aktualisiert." : "Frachtf\u00fchrer gespeichert.", true);
    await loadEntrepreneurs();
    await loadAdminHistory();
  });

  $("resetEntrepreneurBtn")?.addEventListener("click", () => {
    resetEntrepreneurForm();
    setMsg("entrepreneurMsg", "");
  });

  $("bookingHistoryPrevBtn")?.addEventListener("click", () => {
    if (bookingHistoryOffset === 0) return;
    bookingHistoryOffset = Math.max(0, bookingHistoryOffset - BOOKING_HISTORY_PAGE_SIZE);
    void loadBookingHistory();
  });

  $("bookingHistoryNextBtn")?.addEventListener("click", () => {
    if (!bookingHistoryHasMore) return;
    bookingHistoryOffset += BOOKING_HISTORY_PAGE_SIZE;
    void loadBookingHistory();
  });
}

(async function init() {
  bindSettingsMenu();
  bindPasswordModal();
  bindBookingHistoryModal();
  bindActions();
  const ok = await loadContext();
  if (!ok) return;
  await Promise.all([
    loadLocations(),
    loadDepartments(),
    loadEntrepreneurs(),
    loadAdminHistory(),
    loadBookingHistory()
  ]);
})();
