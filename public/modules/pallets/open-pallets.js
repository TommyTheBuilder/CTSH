const token = localStorage.getItem("token");
if (!token) window.location.href = "/login.html";

function api(path, opts = {}) {
  return fetch(path, {
    credentials: "include",
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token,
      ...(opts.headers || {})
    }
  });
}

function $(id) {
  return document.getElementById(id);
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

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
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

const OPEN_PALLET_TITLE_LABELS = {
  abholung: "Abholung",
  rueckfuehrung: "R\u00fcckf\u00fchrung",
  firma_zu_firma: "Firma zu Firma"
};

const OPEN_PALLET_STATUS_LABELS = {
  open: "Offen",
  truck_planned: "LKW eingeplant",
  completed_waiting_document: "Erledigt - warten auf Beleg",
  document_booked_scanned: "Beleg gebucht und gescannt"
};

const OPEN_PALLET_URGENCY_LABELS = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch"
};

const OPEN_PALLET_PAGE_SIZE = 25;
const PALLET_ASSET_VERSION = "20260317-9";
const OPEN_PALLET_COUNTRY_DATA = globalThis.OPEN_PALLET_COUNTRIES || {};
const OPEN_PALLET_COUNTRY_OPTIONS = Array.isArray(OPEN_PALLET_COUNTRY_DATA.list) ? OPEN_PALLET_COUNTRY_DATA.list : [];

let ME = null;
let PERMS = {};
let OPEN_PALLET_ITEMS = [];
let OPEN_PALLET_PAGE = 0;
let OPEN_PALLET_HAS_MORE = false;
let OPEN_PALLET_CUSTOMERS = [];
let ACTIVE_CUSTOMER_ID = null;
let BOOKING_MODAL_STATE = null;

const socket = io();

function titleLabel(value) {
  return OPEN_PALLET_TITLE_LABELS[value] || value || "-";
}

function statusLabel(value) {
  return OPEN_PALLET_STATUS_LABELS[value] || value || "-";
}

function urgencyLabel(value) {
  return OPEN_PALLET_URGENCY_LABELS[value] || OPEN_PALLET_URGENCY_LABELS.medium;
}

function joinTextParts(parts, separator = ", ") {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(separator);
}

function formatStreetLine(street, addressExtra) {
  return joinTextParts([street, addressExtra]);
}

function formatPostalCityLine(postalCode, city, country) {
  const locality = joinTextParts([postalCode, city], " ");
  const countryCode = normalizeCountryCode(country) || String(country ?? "").trim();
  if (countryCode && locality) return `${countryCode}-${locality}`;
  return locality || countryCode;
}

function buildAddressSummary(company, street, addressExtra, postalCode, city, country) {
  return joinTextParts([
    company,
    formatStreetLine(street, addressExtra),
    formatPostalCityLine(postalCode, city, country)
  ]) || "-";
}

function fullAddress(item) {
  return joinTextParts([
    formatStreetLine(item?.street, item?.address_extra),
    formatPostalCityLine(item?.postal_code, item?.city, item?.country)
  ]) || "-";
}

function isTruckPlannedStatus(value) {
  return String(value || "").trim() === "truck_planned";
}

function requiredLabel(baseLabel, required) {
  return required ? `${baseLabel} *` : baseLabel;
}

function normalizeCountryCode(value) {
  if (typeof OPEN_PALLET_COUNTRY_DATA.normalize !== "function") return "";
  return OPEN_PALLET_COUNTRY_DATA.normalize(value);
}

function countryOptionsHtml(selectedValue, { emptyLabel = "Bitte w\u00e4hlen..." } = {}) {
  const rawValue = String(selectedValue ?? "").trim();
  const normalizedValue = normalizeCountryCode(rawValue);
  const activeValue = normalizedValue || rawValue;
  const options = [];

  if (emptyLabel !== null) {
    options.push(`<option value="">${escapeHtml(emptyLabel)}</option>`);
  }
  if (activeValue && !OPEN_PALLET_COUNTRY_OPTIONS.some((entry) => entry.code === activeValue)) {
    options.push(`<option value="${escapeHtml(activeValue)}" selected>${escapeHtml(activeValue)}</option>`);
  }

  return [
    ...options,
    ...OPEN_PALLET_COUNTRY_OPTIONS.map((entry) => `<option value="${entry.code}" ${activeValue === entry.code ? "selected" : ""}>${escapeHtml(entry.label)}</option>`)
  ].join("");
}

function renderCountrySelectElement(select, selectedValue, options = {}) {
  if (!select) return;
  const activeValue = normalizeCountryCode(selectedValue) || String(selectedValue ?? "").trim();
  select.innerHTML = countryOptionsHtml(activeValue, options);
  select.value = activeValue;
}

function renderCountrySelect(id, selectedValue, options = {}) {
  renderCountrySelectElement($(id), selectedValue, options);
}

function initializeCountrySelects() {
  renderCountrySelect("filterCountry", "", { emptyLabel: "Alle" });
  renderCountrySelect("customerCountry", "");
}

function truckInfoText(item) {
  const parts = [];
  if (item?.truck_license_plate) parts.push(`Kennzeichen: ${item.truck_license_plate}`);
  if (item?.truck_planned_for) parts.push(`Datum: ${formatDate(item.truck_planned_for)}`);
  if (item?.truck_planned_by_name && item.truck_planned_by_name !== "-") parts.push(`Disponent: ${item.truck_planned_by_name}`);
  return parts.join(" | ");
}

function canCreateBookings() {
  return !!PERMS?.open_pallets?.create;
}

function canManageCustomers() {
  return !!PERMS?.open_pallets?.create || !!PERMS?.open_pallets?.edit;
}

function canEditBooking(item) {
  return !!item?.can_edit || !!PERMS?.open_pallets?.edit || Number(item?.created_by || 0) === Number(ME?.id || 0);
}

function showModal(backId, show) {
  const back = $(backId);
  if (!back) return;
  back.style.display = show ? "flex" : "none";
  back.setAttribute("aria-hidden", show ? "false" : "true");
}

function currentFilters() {
  return {
    title: $("filterTitle").value,
    company: $("filterCompany").value.trim(),
    city: $("filterCity").value.trim(),
    postal_code: $("filterPostalCode").value.trim(),
    country: $("filterCountry").value.trim(),
    order_no: $("filterOrderNo").value.trim(),
    status: $("filterStatus").value
  };
}

function updatePaginationUi() {
  $("openPalletPrevBtn").disabled = OPEN_PALLET_PAGE === 0;
  $("openPalletNextBtn").disabled = !OPEN_PALLET_HAS_MORE;
}

function applyPermissionsToUI() {
  if (!PERMS?.open_pallets?.view) {
    $("openPalletsTableWrap").innerHTML = `<div class="pallet-open-feed__empty">Keine Berechtigung f&uuml;r Offene Paletten.</div>`;
  }
  $("openCreateBookingModalBtn").style.display = canCreateBookings() ? "" : "none";
  $("openCustomerModalBtn").style.display = canManageCustomers() ? "" : "none";
}

async function loadMe() {
  const response = await api("/api/me", { method: "GET", headers: {} });
  if (!response.ok) {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
    return;
  }
  ME = await response.json();
  $("me").textContent = `${ME.username} - ${ME.business_role_name || "-"}`;
  socket.emit("joinUser", ME.id);
}

async function loadPerms() {
  const response = await api("/api/my-permissions", { method: "GET", headers: {} });
  PERMS = response.ok ? await response.json() : {};
  applyPermissionsToUI();
}

async function loadCustomers({ silent = false } = {}) {
  if (!PERMS?.open_pallets?.view) return;
  const response = await api("/api/modules/pallets/open-pallet-customers", { method: "GET", headers: {} });
  if (!response.ok) {
    if (!silent) {
      const data = await readJsonSafe(response);
      setMsg("customerModalMsg", data?.error || "Kunden konnten nicht geladen werden.");
    }
    return;
  }
  OPEN_PALLET_CUSTOMERS = await response.json();
  if (ACTIVE_CUSTOMER_ID && !OPEN_PALLET_CUSTOMERS.some((customer) => Number(customer.id) === Number(ACTIVE_CUSTOMER_ID))) {
    ACTIVE_CUSTOMER_ID = null;
  }
  renderCustomerList();
  refreshBookingCustomerSelectOptions();
  updateCustomerDeleteButton();
}

async function loadOpenPallets({ resetPage = false } = {}) {
  if (!PERMS?.open_pallets?.view) return;
  if (resetPage) OPEN_PALLET_PAGE = 0;

  const params = new URLSearchParams({
    limit: String(OPEN_PALLET_PAGE_SIZE),
    offset: String(OPEN_PALLET_PAGE * OPEN_PALLET_PAGE_SIZE)
  });
  Object.entries(currentFilters()).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  const response = await api(`/api/modules/pallets/open-pallets?${params.toString()}`, { method: "GET", headers: {} });
  if (!response.ok) {
    const data = await readJsonSafe(response);
    $("openPalletsTableWrap").innerHTML = `<div class="pallet-open-feed__empty">${escapeHtml(data?.error || "Buchungen konnten nicht geladen werden.")}</div>`;
    OPEN_PALLET_ITEMS = [];
    OPEN_PALLET_HAS_MORE = false;
    updatePaginationUi();
    return;
  }

  const data = await response.json();
  OPEN_PALLET_ITEMS = Array.isArray(data?.items) ? data.items : [];
  OPEN_PALLET_HAS_MORE = Boolean(data?.has_more);
  if (OPEN_PALLET_PAGE > 0 && OPEN_PALLET_ITEMS.length === 0) {
    OPEN_PALLET_PAGE -= 1;
    await loadOpenPallets();
    return;
  }
  renderOpenPallets();
}

function renderOpenPallets() {
  const wrap = $("openPalletsTableWrap");
  if (!wrap) return;
  if (OPEN_PALLET_ITEMS.length === 0) {
    wrap.innerHTML = `<div class="pallet-open-feed__empty">Keine Buchungen gefunden.</div>`;
    updatePaginationUi();
    return;
  }

  wrap.innerHTML = `
    <table class="pallet-open-table">
      <thead>
        <tr>
          <th>Titel</th>
          <th>Kunde / Firma</th>
          <th>Adresse</th>
          <th>Auftragsnummer</th>
          <th>Paletten</th>
          <th>Status</th>
          <th>Dringlichkeit</th>
          <th>Disponent</th>
          <th>Aktualisiert</th>
          <th>Aktion</th>
        </tr>
      </thead>
      <tbody>
        ${OPEN_PALLET_ITEMS.map((item) => `
          <tr class="pallet-open-table__row pallet-open-table__row--urgency-${escapeHtml(item.urgency_level || "medium")}">
            <td><button class="pallet-open-link-button" data-open-id="${item.id}" type="button">${escapeHtml(titleLabel(item.title))}</button></td>
            <td><strong>${escapeHtml(item.customer_name || item.company || "-")}</strong>${item.company && item.customer_name && item.company !== item.customer_name ? `<div class="muted">${escapeHtml(item.company)}</div>` : ""}</td>
            <td>${escapeHtml(fullAddress(item))}</td>
            <td>${escapeHtml(item.order_no || "-")}</td>
            <td>${escapeHtml(item.pallet_count)}</td>
            <td class="pallet-open-table__status">
              <span class="pallet-status-badge pallet-status-badge--${escapeHtml(item.status || "open")}">${escapeHtml(statusLabel(item.status))}</span>
              ${truckInfoText(item) ? `<div class="pallet-open-table__submeta">${escapeHtml(truckInfoText(item))}</div>` : ""}
            </td>
            <td class="pallet-open-table__urgency"><span class="pallet-urgency-badge pallet-urgency-badge--${escapeHtml(item.urgency_level || "medium")}">${escapeHtml(urgencyLabel(item.urgency_level))}</span></td>
            <td>${escapeHtml(item.truck_planned_by_name || "-")}</td>
            <td>${escapeHtml(formatDateTime(item.updated_at))}<div class="muted">von ${escapeHtml(item.updated_by_name || item.created_by_name || "-")}</div></td>
            <td>
              <div class="pallet-open-table__actions">
                <button class="secondary" data-open-id="${item.id}" type="button">Öffnen</button>
                <button class="secondary" data-tab-id="${item.id}" type="button">Detailansicht</button>
                ${PERMS?.open_pallets?.delete ? `<button class="danger" data-delete-id="${item.id}" type="button">Löschen</button>` : ""}
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  updatePaginationUi();
  document.querySelectorAll("[data-open-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const bookingId = Number(button.getAttribute("data-open-id") || 0);
      if (bookingId) await openBookingModalForId(bookingId);
    });
  });
  document.querySelectorAll("[data-tab-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const bookingId = Number(button.getAttribute("data-tab-id") || 0);
      if (bookingId) openBookingTab(bookingId);
    });
  });
  document.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const bookingId = Number(button.getAttribute("data-delete-id") || 0);
      if (!bookingId || !confirm("Buchung wirklich löschen?")) return;
      const response = await api(`/api/modules/pallets/open-pallets/${bookingId}`, { method: "DELETE" });
      const data = await readJsonSafe(response);
      if (!response.ok) return alert(data?.error || "Buchung konnte nicht gelöscht werden.");
      await loadOpenPallets();
    });
  });
}

function openCustomerModal() {
  ACTIVE_CUSTOMER_ID = null;
  clearCustomerForm();
  renderCustomerList();
  setMsg("customerModalMsg", "");
  showModal("customerModalBack", true);
}

function closeCustomerModal() {
  showModal("customerModalBack", false);
  setMsg("customerModalMsg", "");
}

function clearCustomerForm() {
  ACTIVE_CUSTOMER_ID = null;
  ["customerName", "customerStreet", "customerAddressExtra", "customerPostalCode", "customerCity"].forEach((id) => {
    if ($(id)) $(id).value = "";
  });
  renderCountrySelect("customerCountry", "");
  updateCustomerDeleteButton();
}

function fillCustomerForm(customer) {
  ACTIVE_CUSTOMER_ID = Number(customer?.id || 0) || null;
  $("customerName").value = customer?.name || "";
  $("customerStreet").value = customer?.street || "";
  $("customerAddressExtra").value = customer?.address_extra || "";
  $("customerPostalCode").value = customer?.postal_code || "";
  $("customerCity").value = customer?.city || "";
  renderCountrySelect("customerCountry", customer?.country || "");
  updateCustomerDeleteButton();
}

function updateCustomerDeleteButton() {
  const button = $("deleteCustomerBtn");
  if (!button) return;
  button.style.display = ACTIVE_CUSTOMER_ID ? "" : "none";
}

function renderCustomerList() {
  const wrap = $("customerListWrap");
  if (!wrap) return;
  if (!OPEN_PALLET_CUSTOMERS.length) {
    wrap.innerHTML = `<div class="pallet-open-feed__empty">Noch keine Kunden gespeichert.</div>`;
    return;
  }

  wrap.innerHTML = OPEN_PALLET_CUSTOMERS.map((customer) => `
    <button class="pallet-customer-list__item ${Number(customer.id) === Number(ACTIVE_CUSTOMER_ID || 0) ? "is-active" : ""}" data-customer-id="${customer.id}" type="button">
      <strong>${escapeHtml(customer.name)}</strong>
      <span>${escapeHtml(fullAddress(customer))}</span>
    </button>
  `).join("");

  document.querySelectorAll("[data-customer-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const customerId = Number(button.getAttribute("data-customer-id") || 0);
      const customer = OPEN_PALLET_CUSTOMERS.find((entry) => Number(entry.id) === customerId);
      if (!customer) return;
      fillCustomerForm(customer);
      renderCustomerList();
    });
  });
}

async function saveCustomer() {
  setMsg("customerModalMsg", "");
  const payload = {
    name: $("customerName").value.trim(),
    street: $("customerStreet").value.trim(),
    address_extra: $("customerAddressExtra").value.trim(),
    postal_code: $("customerPostalCode").value.trim(),
    city: $("customerCity").value.trim(),
    country: $("customerCountry").value.trim()
  };

  const response = await api(
    ACTIVE_CUSTOMER_ID ? `/api/modules/pallets/open-pallet-customers/${ACTIVE_CUSTOMER_ID}` : "/api/modules/pallets/open-pallet-customers",
    { method: ACTIVE_CUSTOMER_ID ? "PATCH" : "POST", body: JSON.stringify(payload) }
  );
  const data = await readJsonSafe(response);
  if (!response.ok) {
    setMsg("customerModalMsg", data?.error || "Kunde konnte nicht gespeichert werden.");
    return;
  }

  setMsg("customerModalMsg", "");
  await loadCustomers({ silent: true });
  await loadOpenPallets();
  fillCustomerForm(data);
  renderCustomerList();
}

async function deleteCustomer() {
  if (!ACTIVE_CUSTOMER_ID) return;
  if (!confirm("Kunde wirklich löschen?")) return;

  setMsg("customerModalMsg", "");
  const response = await api(`/api/modules/pallets/open-pallet-customers/${ACTIVE_CUSTOMER_ID}`, { method: "DELETE" });
  const data = await readJsonSafe(response);
  if (!response.ok) {
    setMsg("customerModalMsg", data?.error || "Kunde konnte nicht gelöscht werden.");
    return;
  }

  clearCustomerForm();
  await loadCustomers({ silent: true });
  await loadOpenPallets();
  renderCustomerList();
}

function bookingCustomerOptions(selectedId) {
  return [`<option value="">Bitte w&auml;hlen...</option>`, ...OPEN_PALLET_CUSTOMERS.map((customer) => `<option value="${customer.id}" ${Number(selectedId || 0) === Number(customer.id) ? "selected" : ""}>${escapeHtml(customer.name)}</option>`)].join("");
}

function bookingTitleOptions(selectedTitle) {
  const currentTitle = String(selectedTitle || "");
  const prefix = currentTitle && !OPEN_PALLET_TITLE_LABELS[currentTitle] ? `<option value="">Bitte Titel ausw&auml;hlen</option>` : "";
  return [prefix, ...Object.entries(OPEN_PALLET_TITLE_LABELS).map(([value, label]) => `<option value="${value}" ${currentTitle === value ? "selected" : ""}>${escapeHtml(label)}</option>`)].join("");
}

function bookingStatusOptions(selectedStatus) {
  return Object.entries(OPEN_PALLET_STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${selectedStatus === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function bookingUrgencyOptions(selectedUrgency) {
  return Object.entries(OPEN_PALLET_URGENCY_LABELS).map(([value, label]) => `<option value="${value}" ${selectedUrgency === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function refreshBookingCustomerSelectOptions() {
  ["bookingCustomer", "bookingDestinationCustomer"].forEach((id) => {
    const select = $(id);
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = bookingCustomerOptions(currentValue);
    if (currentValue) select.value = currentValue;
  });
}

function isTransferTitle(value) {
  return String(value || "") === "firma_zu_firma";
}

function applyCustomerToBookingFields(customer, prefix) {
  if (!customer) return;
  $(`${prefix}Company`) && ($(`${prefix}Company`).value = customer.name || "");
  $(`${prefix}Street`) && ($(`${prefix}Street`).value = customer.street || "");
  $(`${prefix}AddressExtra`) && ($(`${prefix}AddressExtra`).value = customer.address_extra || "");
  $(`${prefix}PostalCode`) && ($(`${prefix}PostalCode`).value = customer.postal_code || "");
  $(`${prefix}City`) && ($(`${prefix}City`).value = customer.city || "");
  renderCountrySelect(`${prefix}Country`, customer?.country || "");
}

function toggleBookingTypeFields() {
  const transfer = isTransferTitle($("bookingTitle")?.value);
  document.querySelectorAll("[data-transfer-only]").forEach((el) => {
    el.style.display = transfer ? "" : "none";
  });
  $("bookingPrimarySectionLabel") && ($("bookingPrimarySectionLabel").textContent = transfer ? "Startadresse" : "Adresse");
  $("bookingReferenceLabel") && ($("bookingReferenceLabel").textContent = transfer ? "Referenz Start" : "Referenz");
}

function syncBookingStatusFields() {
  const editable = BOOKING_MODAL_STATE?.mode === "create" || !!BOOKING_MODAL_STATE?.editMode;
  const requiresTruckFields = isTruckPlannedStatus($("bookingStatus")?.value || "");
  const fields = [
    { labelId: "bookingTruckPlateLabel", inputId: "bookingTruckPlate", baseLabel: "LKW Kennzeichen" },
    { labelId: "bookingTruckDateLabel", inputId: "bookingTruckDate", baseLabel: "Einplanung f\u00fcr" }
  ];

  fields.forEach(({ labelId, inputId, baseLabel }) => {
    const label = $(labelId);
    if (label) label.textContent = requiredLabel(baseLabel, requiresTruckFields);

    const input = $(inputId);
    if (!input) return;
    input.required = requiresTruckFields;
    input.disabled = !editable || !requiresTruckFields;
    input.setAttribute("aria-required", requiresTruckFields ? "true" : "false");
  });
}

function renderBookingModal() {
  const booking = BOOKING_MODAL_STATE?.booking || {};
  const isCreate = BOOKING_MODAL_STATE?.mode === "create";
  const isEditing = isCreate || !!BOOKING_MODAL_STATE?.editMode;
  const editable = isCreate ? canCreateBookings() : canEditBooking(booking);
  const disabled = isEditing ? "" : "disabled";
  const workflowDisabled = disabled;
  const transfer = isTransferTitle(booking.title || "abholung");
  const requiresTruckFields = isTruckPlannedStatus(booking.status || "open");
  const showTruckFields = isEditing || !!booking.truck_license_plate || !!booking.truck_planned_for || requiresTruckFields;
  const truckFieldDisabled = isEditing && requiresTruckFields ? "" : "disabled";
  const startSummary = buildAddressSummary(booking.customer_name || booking.company || "", booking.street, booking.address_extra, booking.postal_code, booking.city, booking.country);
  const destinationSummary = buildAddressSummary(booking.destination_customer_name || booking.destination_company || "", booking.destination_street, booking.destination_address_extra, booking.destination_postal_code, booking.destination_city, booking.destination_country);

  $("bookingModalTitle").textContent = isCreate ? "Neue Buchung" : `Details f\u00fcr ${booking.customer_name || booking.company || titleLabel(booking.title)}`;
  $("bookingModalEditBtn").style.display = !isCreate && editable && !isEditing ? "" : "none";
  $("bookingModalTabBtn").style.display = !isCreate && booking.id ? "" : "none";
  setMsg("bookingModalMsg", "");

  $("bookingModalBody").innerHTML = `
    <div class="pallet-booking-shell">
      <div class="pallet-booking-shell__main">
        <section class="pallet-booking-panel">
          <div class="pallet-booking-panel__head">
            <div><span class="module-section-kicker">Buchungsdaten</span></div>
            <div class="pallet-booking-panel__badges">${booking.status ? `<span class="pallet-status-badge pallet-status-badge--${escapeHtml(booking.status)}">${escapeHtml(statusLabel(booking.status))}</span>` : ""}${booking.urgency_level ? `<span class="pallet-urgency-badge pallet-urgency-badge--${escapeHtml(booking.urgency_level)}">${escapeHtml(urgencyLabel(booking.urgency_level))}</span>` : ""}</div>
          </div>
          <div class="pallet-booking-grid">
            <div class="pallet-booking-field"><label for="bookingTitle">Titel</label><select id="bookingTitle" ${disabled}>${bookingTitleOptions(booking.title || "abholung")}</select></div>
            <div class="pallet-booking-field"><label for="bookingStatus">Status</label><select id="bookingStatus" ${workflowDisabled}>${bookingStatusOptions(booking.status || "open")}</select></div>
            <div class="pallet-booking-field"><label for="bookingUrgency">Dringlichkeit</label><select id="bookingUrgency" ${disabled}>${bookingUrgencyOptions(booking.urgency_level || "medium")}</select></div>
            <div class="pallet-booking-field"><label for="bookingPalletCount">Paletten</label><input id="bookingPalletCount" type="number" min="1" value="${escapeHtml(booking.pallet_count || 1)}" ${disabled}></div>
            <div class="pallet-booking-field"><label for="bookingOrderNo">Auftragsnummer</label><input id="bookingOrderNo" value="${escapeHtml(booking.order_no || "")}" ${disabled}></div>
            <div class="pallet-booking-field"><label id="bookingReferenceLabel" for="bookingReference">${transfer ? "Referenz Start" : "Referenz"}</label><input id="bookingReference" value="${escapeHtml(booking.reference_no || "")}" ${disabled}></div>

            <div class="pallet-booking-field pallet-booking-field--wide pallet-booking-subsection"><span class="module-section-kicker" id="bookingPrimarySectionLabel">${transfer ? "Startadresse" : "Adresse"}</span></div>
            <div class="pallet-booking-field"><label for="bookingCustomer">Kunde (Stammdaten)</label><select id="bookingCustomer" ${disabled}>${bookingCustomerOptions(booking.customer_id)}</select></div>
            <div class="pallet-booking-field"><label for="bookingCompany">Firma</label><input id="bookingCompany" value="${escapeHtml(booking.company || "")}" ${disabled}></div>
            <div class="pallet-booking-field pallet-booking-field--wide"><label for="bookingStreet">Stra&szlig;e / Hausnummer</label><input id="bookingStreet" value="${escapeHtml(booking.street || "")}" ${disabled}></div>
            <div class="pallet-booking-field pallet-booking-field--wide"><label for="bookingAddressExtra">Adresszusatz</label><input id="bookingAddressExtra" value="${escapeHtml(booking.address_extra || "")}" ${disabled}></div>
            <div class="pallet-booking-field"><label for="bookingPostalCode">Postleitzahl</label><input id="bookingPostalCode" value="${escapeHtml(booking.postal_code || "")}" ${disabled}></div>
            <div class="pallet-booking-field"><label for="bookingCity">Ort</label><input id="bookingCity" value="${escapeHtml(booking.city || "")}" ${disabled}></div>
            <div class="pallet-booking-field"><label for="bookingCountry">Land</label><select id="bookingCountry" ${disabled}>${countryOptionsHtml(booking.country || "")}</select></div>

            <div class="pallet-booking-field pallet-booking-field--wide pallet-booking-subsection" data-transfer-only="true" style="${transfer ? "" : "display:none;"}"><span class="module-section-kicker">Zieladresse</span></div>
            <div class="pallet-booking-field" data-transfer-only="true" style="${transfer ? "" : "display:none;"}"><label for="bookingDestinationCustomer">Zielkunde (Stammdaten)</label><select id="bookingDestinationCustomer" ${disabled}>${bookingCustomerOptions(booking.destination_customer_id)}</select></div>
            <div class="pallet-booking-field" data-transfer-only="true" style="${transfer ? "" : "display:none;"}"><label for="bookingDestinationCompany">Ziel-Firma</label><input id="bookingDestinationCompany" value="${escapeHtml(booking.destination_company || "")}" ${disabled}></div>
            <div class="pallet-booking-field" data-transfer-only="true" style="${transfer ? "" : "display:none;"}"><label for="bookingDestinationReference">Referenz Ziel</label><input id="bookingDestinationReference" value="${escapeHtml(booking.destination_reference_no || "")}" ${disabled}></div>
            <div class="pallet-booking-field pallet-booking-field--wide" data-transfer-only="true" style="${transfer ? "" : "display:none;"}"><label for="bookingDestinationStreet">Ziel-Stra&szlig;e / Hausnummer</label><input id="bookingDestinationStreet" value="${escapeHtml(booking.destination_street || "")}" ${disabled}></div>
            <div class="pallet-booking-field pallet-booking-field--wide" data-transfer-only="true" style="${transfer ? "" : "display:none;"}"><label for="bookingDestinationAddressExtra">Ziel-Adresszusatz</label><input id="bookingDestinationAddressExtra" value="${escapeHtml(booking.destination_address_extra || "")}" ${disabled}></div>
            <div class="pallet-booking-field" data-transfer-only="true" style="${transfer ? "" : "display:none;"}"><label for="bookingDestinationPostalCode">Ziel-Postleitzahl</label><input id="bookingDestinationPostalCode" value="${escapeHtml(booking.destination_postal_code || "")}" ${disabled}></div>
            <div class="pallet-booking-field" data-transfer-only="true" style="${transfer ? "" : "display:none;"}"><label for="bookingDestinationCity">Ziel-Ort</label><input id="bookingDestinationCity" value="${escapeHtml(booking.destination_city || "")}" ${disabled}></div>
            <div class="pallet-booking-field" data-transfer-only="true" style="${transfer ? "" : "display:none;"}"><label for="bookingDestinationCountry">Ziel-Land</label><select id="bookingDestinationCountry" ${disabled}>${countryOptionsHtml(booking.destination_country || "")}</select></div>

            ${showTruckFields ? `
            <div class="pallet-booking-field"><label id="bookingTruckPlateLabel" for="bookingTruckPlate">${escapeHtml(requiredLabel("LKW Kennzeichen", requiresTruckFields))}</label><input id="bookingTruckPlate" value="${escapeHtml(booking.truck_license_plate || "")}" ${truckFieldDisabled}></div>
            <div class="pallet-booking-field"><label id="bookingTruckDateLabel" for="bookingTruckDate">${escapeHtml(requiredLabel("Einplanung f\u00fcr", requiresTruckFields))}</label><input id="bookingTruckDate" type="date" value="${escapeHtml(booking.truck_planned_for ? String(booking.truck_planned_for).slice(0, 10) : "")}" ${truckFieldDisabled}></div>
            ` : ""}
            <div class="pallet-booking-field pallet-booking-field--wide"><label for="bookingNote">Notiz</label><textarea id="bookingNote" rows="4" ${disabled}>${escapeHtml(booking.note || "")}</textarea></div>
          </div>
          <div class="pallet-booking-form-actions">${isEditing ? `<button class="primary" id="saveBookingBtn" type="button">${escapeHtml(isCreate ? "Buchung speichern" : "\u00c4nderungen speichern")}</button>` : ""}${!isCreate && isEditing ? `<button class="secondary" id="cancelBookingEditBtn" type="button">Bearbeitung abbrechen</button>` : ""}</div>
        </section>
      </div>
      <aside class="pallet-booking-shell__side">
        <section class="pallet-booking-sidebar-card">
          <div class="pallet-booking-sidebar-card__head">\u00dcbersicht</div>
          <div class="pallet-booking-sidebar-card__body">
            <div class="pallet-booking-meta"><span>Typ</span><strong>${escapeHtml(titleLabel(booking.title || "abholung"))}</strong></div>
            <div class="pallet-booking-meta"><span>Start</span><strong>${escapeHtml(startSummary)}</strong></div>
            ${transfer ? `<div class="pallet-booking-meta"><span>Ziel</span><strong>${escapeHtml(destinationSummary)}</strong></div>` : ""}
            <div class="pallet-booking-meta"><span>Referenz</span><strong>${escapeHtml(booking.reference_no || "-")}</strong></div>
            ${transfer ? `<div class="pallet-booking-meta"><span>Referenz Ziel</span><strong>${escapeHtml(booking.destination_reference_no || "-")}</strong></div>` : ""}
            <div class="pallet-booking-meta"><span>Auftragsnummer</span><strong>${escapeHtml(booking.order_no || "-")}</strong></div>
            <div class="pallet-booking-meta"><span>Paletten</span><strong>${escapeHtml(booking.pallet_count || "-")}</strong></div>
          </div>
        </section>
      </aside>
    </div>
  `;

  bindBookingModalEvents();
  toggleBookingTypeFields();
  syncBookingStatusFields();
}

function bindBookingModalEvents() {
  $("bookingModalEditBtn")?.addEventListener("click", () => {
    BOOKING_MODAL_STATE.editMode = true;
    renderBookingModal();
  });
  $("bookingModalTabBtn")?.addEventListener("click", () => {
    if (BOOKING_MODAL_STATE?.booking?.id) openBookingTab(BOOKING_MODAL_STATE.booking.id);
  });
  $("cancelBookingEditBtn")?.addEventListener("click", () => {
    BOOKING_MODAL_STATE.editMode = false;
    renderBookingModal();
  });
  $("saveBookingBtn")?.addEventListener("click", saveBookingFromModal);
  $("bookingTitle")?.addEventListener("change", toggleBookingTypeFields);
  $("bookingStatus")?.addEventListener("change", syncBookingStatusFields);
  $("bookingCustomer")?.addEventListener("change", () => {
    if (!(BOOKING_MODAL_STATE?.mode === "create" || BOOKING_MODAL_STATE?.editMode)) return;
    const customer = OPEN_PALLET_CUSTOMERS.find((entry) => Number(entry.id) === Number($("bookingCustomer").value || 0));
    applyCustomerToBookingFields(customer, "booking");
  });
  $("bookingDestinationCustomer")?.addEventListener("change", () => {
    if (!(BOOKING_MODAL_STATE?.mode === "create" || BOOKING_MODAL_STATE?.editMode)) return;
    const customer = OPEN_PALLET_CUSTOMERS.find((entry) => Number(entry.id) === Number($("bookingDestinationCustomer").value || 0));
    applyCustomerToBookingFields(customer, "bookingDestination");
  });
}

async function openBookingModalForId(bookingId) {
  const response = await api(`/api/modules/pallets/open-pallets/${bookingId}`, { method: "GET", headers: {} });
  const data = await readJsonSafe(response);
  if (!response.ok) return alert(data?.error || "Buchung konnte nicht geladen werden.");
  BOOKING_MODAL_STATE = { mode: "detail", booking: data, editMode: false };
  renderBookingModal();
  showModal("bookingModalBack", true);
}

function openCreateBookingModal() {
  BOOKING_MODAL_STATE = { mode: "create", booking: { title: "abholung", status: "open", urgency_level: "medium", pallet_count: 1 }, editMode: true };
  renderBookingModal();
  showModal("bookingModalBack", true);
}

function closeBookingModal() {
  BOOKING_MODAL_STATE = null;
  setMsg("bookingModalMsg", "");
  showModal("bookingModalBack", false);
}

function openBookingTab(bookingId) {
  window.location.href = `/modules/pallets/open-pallet-detail.html?v=${PALLET_ASSET_VERSION}&id=${encodeURIComponent(bookingId)}`;
}

function collectBookingFormPayload() {
  const transfer = isTransferTitle($("bookingTitle").value);
  const payload = {
    title: $("bookingTitle").value,
    customer_id: $("bookingCustomer").value || null,
    company: $("bookingCompany").value.trim(),
    street: $("bookingStreet").value.trim(),
    address_extra: $("bookingAddressExtra").value.trim(),
    postal_code: $("bookingPostalCode").value.trim(),
    city: $("bookingCity").value.trim(),
    country: $("bookingCountry").value.trim(),
    order_no: $("bookingOrderNo").value.trim(),
    reference_no: $("bookingReference").value.trim(),
    pallet_count: Number($("bookingPalletCount").value || 0),
    status: $("bookingStatus").value,
    urgency_level: $("bookingUrgency").value,
    note: $("bookingNote").value.trim()
  };
  if (transfer) {
    payload.destination_customer_id = $("bookingDestinationCustomer")?.value || null;
    payload.destination_company = $("bookingDestinationCompany")?.value.trim() || "";
    payload.destination_street = $("bookingDestinationStreet")?.value.trim() || "";
    payload.destination_address_extra = $("bookingDestinationAddressExtra")?.value.trim() || "";
    payload.destination_postal_code = $("bookingDestinationPostalCode")?.value.trim() || "";
    payload.destination_city = $("bookingDestinationCity")?.value.trim() || "";
    payload.destination_country = $("bookingDestinationCountry")?.value.trim() || "";
    payload.destination_reference_no = $("bookingDestinationReference")?.value.trim() || "";
  } else {
    payload.destination_customer_id = null;
    payload.destination_company = null;
    payload.destination_street = null;
    payload.destination_address_extra = null;
    payload.destination_postal_code = null;
    payload.destination_city = null;
    payload.destination_country = null;
    payload.destination_reference_no = null;
  }
  if (isTruckPlannedStatus(payload.status)) {
    payload.truck_license_plate = $("bookingTruckPlate")?.value.trim() || "";
    payload.truck_planned_for = $("bookingTruckDate")?.value || "";
  }
  return payload;
}

async function saveBookingFromModal() {
  const isCreate = BOOKING_MODAL_STATE?.mode === "create";
  const bookingId = BOOKING_MODAL_STATE?.booking?.id;
  const payload = collectBookingFormPayload();
  setMsg("bookingModalMsg", "");

  if (!payload.title) return setMsg("bookingModalMsg", "Bitte einen Titel auswählen.");
  if (!Number.isInteger(payload.pallet_count) || payload.pallet_count <= 0) {
    return setMsg("bookingModalMsg", "Die Palettenanzahl muss größer als 0 sein.");
  }
  if (isTransferTitle(payload.title) && !payload.destination_company) {
    return setMsg("bookingModalMsg", "Bitte eine Zieladresse angeben.");
  }
  if (isTruckPlannedStatus(payload.status) && (!payload.truck_license_plate || !payload.truck_planned_for)) {
    return setMsg("bookingModalMsg", "Bei Status LKW eingeplant sind Kennzeichen und Datum Pflicht.");
  }

  const button = $("saveBookingBtn");
  if (button) button.disabled = true;
  try {
    const response = await api(
      isCreate ? "/api/modules/pallets/open-pallets" : `/api/modules/pallets/open-pallets/${bookingId}`,
      { method: isCreate ? "POST" : "PATCH", body: JSON.stringify(payload) }
    );
    const data = await readJsonSafe(response);
    if (!response.ok) {
      setMsg("bookingModalMsg", data?.error || "Buchung konnte nicht gespeichert werden.");
      return;
    }

    await loadOpenPallets({ resetPage: isCreate });
    if (isCreate) {
      closeBookingModal();
      return;
    }

    await openBookingModalForId(bookingId);
    setMsg("bookingModalMsg", "");
  } finally {
    if (button) button.disabled = false;
  }
}

function bindEvents() {
  $("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  });
  $("backToPalletsBtn").addEventListener("click", () => {
    window.location.href = `/modules/pallets/index.html?v=${PALLET_ASSET_VERSION}`;
  });
  $("openCreateBookingModalBtn").addEventListener("click", openCreateBookingModal);
  $("openCustomerModalBtn").addEventListener("click", openCustomerModal);
  $("closeBookingModalBtn").addEventListener("click", closeBookingModal);
  $("closeCustomerModalBtn").addEventListener("click", closeCustomerModal);
  $("cancelCustomerModalBtn").addEventListener("click", closeCustomerModal);
  $("deleteCustomerBtn").addEventListener("click", deleteCustomer);
  $("newCustomerBtn").addEventListener("click", () => {
    clearCustomerForm();
    renderCustomerList();
    setMsg("customerModalMsg", "");
  });
  $("saveCustomerBtn").addEventListener("click", saveCustomer);

  $("bookingModalBack").addEventListener("click", (event) => {
    if (event.target === $("bookingModalBack")) closeBookingModal();
  });
  $("customerModalBack").addEventListener("click", (event) => {
    if (event.target === $("customerModalBack")) closeCustomerModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if ($("bookingModalBack").getAttribute("aria-hidden") === "false") return closeBookingModal();
    if ($("customerModalBack").getAttribute("aria-hidden") === "false") return closeCustomerModal();
  });

  $("reloadOpenPalletsBtn").addEventListener("click", () => loadOpenPallets({ resetPage: true }));
  $("resetOpenPalletFiltersBtn").addEventListener("click", async () => {
    $("filterTitle").value = "";
    $("filterCompany").value = "";
    $("filterCity").value = "";
    $("filterPostalCode").value = "";
    $("filterCountry").value = "";
    $("filterOrderNo").value = "";
    $("filterStatus").value = "";
    await loadOpenPallets({ resetPage: true });
  });
  $("openPalletPrevBtn").addEventListener("click", async () => {
    if (OPEN_PALLET_PAGE === 0) return;
    OPEN_PALLET_PAGE -= 1;
    await loadOpenPallets();
  });
  $("openPalletNextBtn").addEventListener("click", async () => {
    if (!OPEN_PALLET_HAS_MORE) return;
    OPEN_PALLET_PAGE += 1;
    await loadOpenPallets();
  });

  ["filterCompany", "filterCity", "filterPostalCode", "filterOrderNo"].forEach((id) => {
    $(id).addEventListener("input", () => {
      clearTimeout(window.__openPalletFilterTimer);
      window.__openPalletFilterTimer = setTimeout(() => loadOpenPallets({ resetPage: true }), 250);
    });
  });
  ["filterTitle", "filterStatus", "filterCountry"].forEach((id) => {
    $(id).addEventListener("change", () => loadOpenPallets({ resetPage: true }));
  });

  socket.on("openPalletBookingsUpdated", async (payload) => {
    if (payload?.app_customer_id && Number(payload.app_customer_id) !== Number(ME?.app_customer_id || 0)) return;
    await loadOpenPallets();
  });
}

async function openBookingFromQueryParam() {
  const params = new URLSearchParams(window.location.search);
  const bookingId = Number(params.get("booking") || 0);
  if (bookingId) await openBookingModalForId(bookingId);
}

(async function init() {
  initializeCountrySelects();
  bindEvents();
  await loadMe();
  await loadPerms();
  await loadCustomers({ silent: true });
  await loadOpenPallets({ resetPage: true });
  await openBookingFromQueryParam();
})();
