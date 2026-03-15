const token = localStorage.getItem("token");
if (!token) window.location.href = "/login.html";

const PACKAGING_OPTIONS = ["Karton groß", "Karton klein"];

const state = {
  activeTab: "dashboard",
  me: null,
  permissions: {},
  refs: {
    customers: [],
    articles: [],
    locations: []
  },
  dashboard: null,
  inventory: [],
  transactions: [],
  pickingOrders: [],
  locationSlotCache: {},
  bookingSlotSyncId: 0,
  slotModal: {
    locationId: null,
    locationName: "",
    rows: []
  },
  selected: {
    customerId: null,
    articleId: null,
    locationId: null,
    inventoryId: null,
    pickingId: null
  },
  pickingDraftItems: []
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
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {})
    }
  });
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setMessage(id, text, ok = false) {
  const el = $(id);
  if (!el) return;
  el.style.color = ok ? "#0a7a2f" : "#b00020";
  el.textContent = text || "";
}

function clearMessage(id) {
  setMessage(id, "", true);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
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

function formatNumber(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return "0";
  return new Intl.NumberFormat("de-DE").format(parsed);
}

function formatLocalDateTimeInput(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function nextLocalId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeLookupValue(value) {
  return String(value || "").trim().toLowerCase();
}

function permissionValue(path) {
  const parts = String(path || "").split(".");
  let current = state.permissions;
  for (const part of parts) {
    if (!current || typeof current !== "object") return false;
    current = current[part];
  }
  return current === true;
}

function hasAnyPermission(value) {
  if (value === true) return true;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((entry) => hasAnyPermission(entry));
}

function canOpenAdmin() {
  return !!(
    state.me?.role === "admin"
    || state.permissions?.admin?.full_access
    || state.permissions?.roles?.manage
    || state.permissions?.users?.manage
  );
}

function warehouseAccess() {
  return state.permissions?.warehouse || {};
}

function resolveCustomer(value) {
  const lookup = normalizeLookupValue(value);
  if (!lookup) return null;
  return state.refs.customers.find((customer) => {
    const byId = String(customer.id) === lookup;
    const byNumber = normalizeLookupValue(customer.kunden_nr) === lookup;
    const byName = normalizeLookupValue(customer.name) === lookup;
    const byLabel = normalizeLookupValue(`${customer.kunden_nr} - ${customer.name}`) === lookup;
    return byId || byNumber || byName || byLabel;
  }) || null;
}

function resolveArticle(value) {
  const lookup = normalizeLookupValue(value);
  if (!lookup) return null;
  return state.refs.articles.find((article) => {
    const byId = String(article.id) === lookup;
    const byNumber = normalizeLookupValue(article.artikel_nr) === lookup;
    const byName = normalizeLookupValue(article.bezeichnung) === lookup;
    const byLabel = normalizeLookupValue(`${article.artikel_nr} - ${article.bezeichnung}`) === lookup;
    return byId || byNumber || byName || byLabel;
  }) || null;
}

function resolveLocation(value) {
  const lookup = normalizeLookupValue(value);
  if (!lookup) return null;
  return state.refs.locations.find((location) => {
    const byId = String(location.id) === lookup;
    const byName = normalizeLookupValue(location.name) === lookup;
    const byLabel = normalizeLookupValue(`${location.name} (${location.typ})`) === lookup;
    return byId || byName || byLabel;
  }) || null;
}

function customerLabel(customer) {
  return `${customer.kunden_nr} - ${customer.name}`;
}

function articleLabel(article) {
  return `${article.artikel_nr} - ${article.bezeichnung}`;
}

function locationLabel(location) {
  return `${location.name} (${location.typ})`;
}

function setSelectValue(selectEl, value) {
  if (!selectEl) return;
  const normalized = value === null || value === undefined ? "" : String(value);
  const hasValue = Array.from(selectEl.options).some((option) => option.value === normalized);
  selectEl.value = hasValue ? normalized : "";
}

function selectedValues(selectId) {
  const select = $(selectId);
  if (!select) return [];
  return Array.from(select.selectedOptions || [])
    .map((option) => Number(option.value))
    .filter((value) => Number.isInteger(value));
}

function formatSlotList(values = []) {
  return values.length ? values.map((value) => formatNumber(value)).join(", ") : "-";
}

function formatTransactionSlotSummary(row) {
  if (!row) return "-";
  if (row.typ === "OUT") return formatSlotList(row.source_stellplaetze || []);
  if (row.typ === "TRANSFER") {
    return `Quelle: ${formatSlotList(row.source_stellplaetze || [])} | Ziel: ${formatSlotList(row.target_stellplaetze || [])}`;
  }
  return formatSlotList(row.target_stellplaetze || []);
}

function locationFreeSlotCount(location) {
  const capacity = Number(location?.kapazitaet || 0);
  const occupied = Number(location?.belegte_positionen || 0);
  return Math.max(capacity - occupied, 0);
}

function locationHasOccupiedSlots(location) {
  return Number(location?.belegte_positionen || 0) > 0;
}

function bookingLocationOptionLabel(location) {
  return `${location.name} (${location.typ}) - ${formatNumber(location.belegte_positionen || 0)}/${formatNumber(location.kapazitaet || 0)} belegt`;
}

function renderPackagingOptions(selectId, selectedValue = "") {
  const select = $(selectId);
  if (!select) return;
  const currentValue = selectedValue || select.value || "";
  select.innerHTML = `
    <option value="">Verpackungsart wählen</option>
    ${PACKAGING_OPTIONS.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
  `;
  setSelectValue(select, currentValue);
}

function invalidateLocationSlotCache(locationId = null) {
  if (locationId === null || locationId === undefined) {
    state.locationSlotCache = {};
    return;
  }
  delete state.locationSlotCache[String(locationId)];
}

function resetBookingDate() {
  if ($("bookingDate")) $("bookingDate").value = formatLocalDateTimeInput();
}

function renderBookingLocationOptions() {
  const type = $("bookingType")?.value || "IN";
  const sourceSelect = $("bookingSourceSelect");
  const destinationSelect = $("bookingDestinationSelect");
  if (!sourceSelect || !destinationSelect) return;

  const currentSource = sourceSelect.value;
  const currentDestination = destinationSelect.value;
  const sourceRows = state.refs.locations.filter((location) => locationHasOccupiedSlots(location));
  const destinationRows = state.refs.locations.filter((location) => locationFreeSlotCount(location) > 0);

  sourceSelect.innerHTML = `
    <option value="">Quell-Lagerplatz wählen</option>
    ${sourceRows.map((location) => `
      <option value="${escapeHtml(location.id)}">${escapeHtml(bookingLocationOptionLabel(location))}</option>
    `).join("")}
  `;

  destinationSelect.innerHTML = `
    <option value="">Ziel-Lagerplatz wählen</option>
    ${destinationRows.map((location) => `
      <option value="${escapeHtml(location.id)}">${escapeHtml(bookingLocationOptionLabel(location))}</option>
    `).join("")}
  `;

  setSelectValue(sourceSelect, currentSource);
  setSelectValue(destinationSelect, currentDestination);

  if (type === "IN") sourceSelect.value = "";
  if (type === "OUT") destinationSelect.value = "";
}

async function loadLocationSlots(locationId, options = {}) {
  const { force = false } = options;
  const cacheKey = String(locationId);
  if (!force && Array.isArray(state.locationSlotCache[cacheKey])) {
    return state.locationSlotCache[cacheKey];
  }

  const response = await api(`/api/warehouse/storage-locations/${locationId}/slots`, { method: "GET", headers: {} });
  const data = await readJsonSafe(response);
  if (!response.ok) {
    throw new Error(data?.error || "Stellplätze konnten nicht geladen werden.");
  }

  state.locationSlotCache[cacheKey] = Array.isArray(data) ? data : [];
  return state.locationSlotCache[cacheKey];
}

function getSelectedSlotRows(locationId, slotNumbers = []) {
  if (!locationId || !slotNumbers.length) return [];
  const rows = state.locationSlotCache[String(locationId)] || [];
  const selectedSet = new Set(slotNumbers.map((value) => Number(value)));
  return rows.filter((row) => selectedSet.has(Number(row.stellplatz_nr)));
}

function renderBookingSlotOptions(selectId, rows, mode, helpId, emptyText) {
  const select = $(selectId);
  const help = $(helpId);
  if (!select) return;

  const currentValues = new Set(selectedValues(selectId).map((value) => String(value)));

  if (!rows.length) {
    select.innerHTML = "";
    if (help) help.textContent = emptyText;
    return;
  }

  select.innerHTML = rows.map((row) => {
    const slotNo = Number(row.stellplatz_nr);
    const suffix = mode === "occupied"
      ? ` - ${row.artikel_nr || "-"} | ${row.bezeichnung || "-"} | ${row.customer_name || "kein Kunde"}`
      : " - frei";
    return `
      <option value="${escapeHtml(slotNo)}" ${currentValues.has(String(slotNo)) ? "selected" : ""}>
        ${escapeHtml(`Stellplatz ${slotNo}${suffix}`)}
      </option>
    `;
  }).join("");

  if (help) {
    help.textContent = mode === "occupied"
      ? "Nur belegte Stellplätze werden angezeigt. Bei gewähltem Artikel wird zusätzlich auf diesen Artikel gefiltert."
      : "Nur freie Stellplätze sind auswählbar. Volle Lagerplätze erscheinen nicht in der Zielliste.";
  }
}

function syncBookingPackagingFromSource() {
  const type = $("bookingType")?.value || "IN";
  const source = resolveLocation($("bookingSourceSelect")?.value || "");
  const packagingSelect = $("bookingPackagingType");
  if (!packagingSelect || type === "IN" || !source) return;

  const selectedRows = getSelectedSlotRows(source.id, selectedValues("bookingSourceSlots"));
  if (!selectedRows.length) return;
  const packagingValues = [...new Set(selectedRows.map((row) => row.verpackungsart).filter(Boolean))];
  if (packagingValues.length === 1) {
    packagingSelect.value = packagingValues[0];
  }
}

async function syncBookingSlotOptions() {
  const syncId = Date.now();
  state.bookingSlotSyncId = syncId;

  const type = $("bookingType")?.value || "IN";
  const article = resolveArticle($("bookingArticleLookup")?.value || "");
  const source = resolveLocation($("bookingSourceSelect")?.value || "");
  const destination = resolveLocation($("bookingDestinationSelect")?.value || "");

  renderBookingLocationOptions();

  try {
    let sourceRows = [];
    let destinationRows = [];

    if ((type === "OUT" || type === "TRANSFER") && source) {
      sourceRows = (await loadLocationSlots(source.id)).filter((row) => row.status === "OCCUPIED");
      if (article) {
        sourceRows = sourceRows.filter((row) => Number(row.article_id) === Number(article.id));
      }
    }

    if ((type === "IN" || type === "TRANSFER") && destination) {
      destinationRows = (await loadLocationSlots(destination.id)).filter((row) => row.status === "FREE");
    }

    if (state.bookingSlotSyncId !== syncId) return;

    renderBookingSlotOptions(
      "bookingSourceSlots",
      sourceRows,
      "occupied",
      "bookingSourceSlotsHelp",
      source
        ? "Keine belegten Stellplätze für die aktuelle Auswahl gefunden."
        : "Belegte Stellplätze werden geladen, sobald ein Quell-Lagerplatz gewählt wurde."
    );
    renderBookingSlotOptions(
      "bookingDestinationSlots",
      destinationRows,
      "free",
      "bookingDestinationSlotsHelp",
      destination
        ? "Keine freien Stellplätze verfügbar."
        : "Freie Stellplätze werden geladen, sobald ein Ziel-Lagerplatz gewählt wurde."
    );

    syncBookingPackagingFromSource();
    renderBookingPreview();
    updateBookingSubmitState();
  } catch (error) {
    if (state.bookingSlotSyncId !== syncId) return;
    setMessage("bookingMsg", error.message || "Stellplätze konnten nicht geladen werden.");
    updateBookingSubmitState();
  }
}

function validateBookingForm(options = {}) {
  const { showMessage = false } = options;
  const type = $("bookingType")?.value || "IN";
  const article = resolveArticle($("bookingArticleLookup")?.value || "");
  const source = resolveLocation($("bookingSourceSelect")?.value || "");
  const destination = resolveLocation($("bookingDestinationSelect")?.value || "");
  const quantity = Number($("bookingQuantity")?.value || 0);
  const packaging = String($("bookingPackagingType")?.value || "").trim();
  const sourceSlots = selectedValues("bookingSourceSlots");
  const destinationSlots = selectedValues("bookingDestinationSlots");
  const validationHint = $("bookingValidationHint");
  const bookingStarted = Boolean(
    String($("bookingArticleLookup")?.value || "").trim()
    || String($("bookingCustomerLookup")?.value || "").trim()
    || String($("bookingSourceSelect")?.value || "").trim()
    || String($("bookingDestinationSelect")?.value || "").trim()
    || packaging
    || sourceSlots.length
    || destinationSlots.length
    || quantity > 1
  );

  let message = "";

  if (!article) message = "Bitte einen gültigen Artikel auswählen.";
  else if (!Number.isInteger(quantity) || quantity <= 0) message = "Bitte eine gültige Menge eingeben.";
  else if (!packaging) message = "Bitte eine Verpackungsart auswählen.";
  else if (type === "IN" && !destination) message = "Bitte einen Ziel-Lagerplatz auswählen.";
  else if (type === "OUT" && !source) message = "Bitte einen Quell-Lagerplatz auswählen.";
  else if (type === "TRANSFER" && (!source || !destination)) message = "Bitte Quelle und Ziel auswählen.";
  else if (type === "TRANSFER" && source && destination && Number(source.id) === Number(destination.id)) {
    message = "Quelle und Ziel müssen bei einer Umlagerung unterschiedlich sein.";
  } else if (type === "IN" && destinationSlots.length !== quantity) {
    message = "Für eine Einbuchung muss die Menge exakt der Anzahl ausgewählter Ziel-Stellplätze entsprechen.";
  } else if (type === "OUT" && sourceSlots.length !== quantity) {
    message = "Für eine Ausbuchung muss die Menge exakt der Anzahl ausgewählter Quell-Stellplätze entsprechen.";
  } else if (type === "TRANSFER" && (sourceSlots.length !== quantity || destinationSlots.length !== quantity)) {
    message = "Für eine Umlagerung müssen Quelle, Ziel und Menge exakt gleich viele Stellplätze enthalten.";
  } else if (type !== "IN" && source) {
    const selectedSourceRows = getSelectedSlotRows(source.id, sourceSlots);
    const packagingValues = [...new Set(selectedSourceRows.map((row) => row.verpackungsart).filter(Boolean))];
    if (packagingValues.length > 1) {
      message = "Die ausgewählten Quell-Stellplätze verwenden unterschiedliche Verpackungsarten.";
    } else if (packagingValues.length === 1 && packagingValues[0] !== packaging) {
      message = "Die Verpackungsart muss zu den ausgewählten Quell-Stellplätzen passen.";
    }
  }

  if (validationHint) {
    validationHint.textContent = message && (showMessage || bookingStarted)
      ? message
      : "Wählen Sie exakt so viele Stellplätze aus, wie unter Menge eingetragen ist.";
    validationHint.style.color = message && (showMessage || bookingStarted) ? "#b00020" : "";
  }

  if (showMessage) {
    if (message) setMessage("bookingMsg", message);
    else clearMessage("bookingMsg");
  }

  return {
    valid: !message,
    message,
    sourceSlots,
    destinationSlots,
    quantity,
    article,
    source,
    destination,
    packaging
  };
}

function updateBookingSubmitState() {
  const button = $("bookingSubmitBtn");
  if (!button) return;
  const canCreateTransactions = !!(permissionValue("warehouse.transactions.create") || permissionValue("warehouse.transactions.manage"));
  const validation = validateBookingForm({ showMessage: false });
  button.disabled = !canCreateTransactions || !validation.valid;
}

function buildSlotTooltipMarkup(row) {
  return `
    <strong>${escapeHtml(row.artikel_nr || "-")} - ${escapeHtml(row.bezeichnung || "-")}</strong>
    <span>Menge: ${escapeHtml(row.menge || 1)}</span>
    <span>Verpackung: ${escapeHtml(row.verpackungsart || "-")}</span>
    <span>Kunde: ${escapeHtml(row.customer_name || "-")}</span>
    <span>Eingelagert von: ${escapeHtml(row.stored_by_username || "-")}</span>
  `;
}

function renderSlotModalDetail(row = null, location = null) {
  const host = $("slotModalDetail");
  if (!host) return;

  if (!row) {
    host.innerHTML = `<div class="warehouse-empty">Wählen Sie einen Stellplatz aus oder fahren Sie mit der Maus über ein belegtes Feld.</div>`;
    return;
  }

  host.innerHTML = row.status === "FREE"
    ? `
      <div class="warehouse-slot-detail-grid">
        <div class="warehouse-slot-detail-row">
          <span>Lagerplatz</span>
          <strong>${escapeHtml(location?.name || row.storage_location_name || "-")}</strong>
        </div>
        <div class="warehouse-slot-detail-row">
          <span>Stellplatz</span>
          <strong>${escapeHtml(formatNumber(row.stellplatz_nr))}</strong>
        </div>
        <div class="warehouse-slot-detail-row">
          <span>Status</span>
          <strong>Frei</strong>
        </div>
        <div class="warehouse-slot-detail-row">
          <span>Verfügbar</span>
          <strong>Der Stellplatz kann direkt für eine Einlagerung verwendet werden.</strong>
        </div>
      </div>
    `
    : `
      <div class="warehouse-slot-detail-grid">
        <div class="warehouse-slot-detail-row">
          <span>Lagerplatz</span>
          <strong>${escapeHtml(location?.name || row.storage_location_name || "-")}</strong>
        </div>
        <div class="warehouse-slot-detail-row">
          <span>Stellplatz</span>
          <strong>${escapeHtml(formatNumber(row.stellplatz_nr))}</strong>
        </div>
        <div class="warehouse-slot-detail-row">
          <span>Artikel</span>
          <strong>${escapeHtml(row.artikel_nr || "-")} - ${escapeHtml(row.bezeichnung || "-")}</strong>
        </div>
        <div class="warehouse-slot-detail-row">
          <span>Menge</span>
          <strong>${escapeHtml(row.menge || 1)}</strong>
        </div>
        <div class="warehouse-slot-detail-row">
          <span>Verpackungsart</span>
          <strong>${escapeHtml(row.verpackungsart || row.last_transaction_verpackungsart || "-")}</strong>
        </div>
        <div class="warehouse-slot-detail-row">
          <span>Kunde</span>
          <strong>${escapeHtml(row.customer_name || "-")}</strong>
        </div>
        <div class="warehouse-slot-detail-row">
          <span>Eingelagert von</span>
          <strong>${escapeHtml(row.stored_by_username || "-")}</strong>
        </div>
        <div class="warehouse-slot-detail-row">
          <span>Letzte Buchung</span>
          <strong>${escapeHtml(row.last_transaction_datum ? formatDateTime(row.last_transaction_datum) : "-")}</strong>
        </div>
      </div>
    `;
}

function closeSlotModal() {
  const back = $("slotModalBack");
  if (!back) return;
  back.style.display = "none";
  back.setAttribute("aria-hidden", "true");
  state.slotModal = {
    locationId: null,
    locationName: "",
    rows: []
  };
}

async function openLocationSlotModal(locationId) {
  const location = state.refs.locations.find((entry) => Number(entry.id) === Number(locationId));
  if (!location) return;

  const back = $("slotModalBack");
  const title = $("slotModalTitle");
  const lead = $("slotModalLead");
  const grid = $("slotModalGrid");
  if (!back || !title || !lead || !grid) return;

  back.style.display = "flex";
  back.setAttribute("aria-hidden", "false");
  title.textContent = `${location.name} - Stellplatz-Raster`;
  lead.textContent = "Freie und belegte Stellplätze werden als Raster angezeigt. Details öffnen Sie per Hover oder Klick.";
  grid.innerHTML = `<div class="warehouse-empty">Stellplätze werden geladen...</div>`;
  renderSlotModalDetail(null, location);

  try {
    const rows = await loadLocationSlots(location.id, { force: true });
    state.slotModal = {
      locationId: location.id,
      locationName: location.name,
      rows
    };

    grid.style.setProperty("--slot-columns", String(Math.min(Math.max(Number(location.kapazitaet || 1), 1), 10)));
    grid.innerHTML = rows.map((row) => {
      const occupied = row.status === "OCCUPIED";
      return `
        <button
          class="warehouse-slot-cell warehouse-slot-cell--${occupied ? "occupied" : "free"}"
          type="button"
          data-slot-number="${escapeHtml(row.stellplatz_nr)}"
        >
          <span class="warehouse-slot-cell__number">${escapeHtml(formatNumber(row.stellplatz_nr))}</span>
          ${occupied ? `<span class="warehouse-slot-cell__tooltip">${buildSlotTooltipMarkup(row)}</span>` : ""}
        </button>
      `;
    }).join("");

    grid.querySelectorAll("[data-slot-number]").forEach((button) => {
      const slotNumber = Number(button.dataset.slotNumber);
      const row = rows.find((entry) => Number(entry.stellplatz_nr) === slotNumber) || null;
      button.addEventListener("mouseenter", () => renderSlotModalDetail(row, location));
      button.addEventListener("focus", () => renderSlotModalDetail(row, location));
      button.addEventListener("click", () => renderSlotModalDetail(row, location));
    });
  } catch (error) {
    grid.innerHTML = `<div class="warehouse-empty">${escapeHtml(error.message || "Stellplätze konnten nicht geladen werden.")}</div>`;
  }
}

function setSidebarNote() {
  const note = $("warehouseSidebarNote");
  if (!note) return;

  const actions = [];
  if (permissionValue("warehouse.transactions.create")) actions.push("Buchungen");
  if (permissionValue("warehouse.inventory.view")) actions.push("Live-Bestand");
  if (permissionValue("warehouse.storage_locations.manage")) actions.push("Lagerplätze");
  if (permissionValue("warehouse.customers.manage") || permissionValue("warehouse.articles.manage")) actions.push("Stammdaten");
  if (permissionValue("warehouse.picking.manage")) actions.push("Versandaufträge Büro");
  if (permissionValue("warehouse.picking.process")) actions.push("Versandaufträge Lager");
  if (permissionValue("warehouse.transactions.view")) actions.push("Historie");

  note.textContent = actions.length
    ? `Freigeschaltet: ${actions.join(", ")}.`
    : "Für dieses Konto sind aktuell keine Warehouse-Bereiche freigeschaltet.";
}

function updateQuickStats(summary = {}) {
  $("warehouseQuickOpenOrders").textContent = String(summary.picking_open_count || 0);
  $("warehouseQuickInventory").textContent = String(summary.inventory_positions_count || 0);
  $("warehouseQuickArticles").textContent = String(summary.articles_count || 0);
}

function setTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".warehouse-nav__button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".warehouse-section").forEach((section) => {
    section.classList.toggle("active", section.id === `warehouseTab-${tab}`);
  });
}

function ensureVisibleActiveTab() {
  const activeButton = document.querySelector(`.warehouse-nav__button[data-tab="${state.activeTab}"]`);
  if (activeButton && activeButton.style.display !== "none") return;
  const firstVisible = Array.from(document.querySelectorAll(".warehouse-nav__button")).find((button) => button.style.display !== "none");
  if (firstVisible) setTab(firstVisible.dataset.tab);
}

function setFormEnabled(formId, enabled) {
  const form = $(formId);
  if (!form) return;
  form.querySelectorAll("input, select, textarea, button").forEach((field) => {
    field.disabled = !enabled;
  });
}

function applyPermissionsToUi() {
  const permissions = warehouseAccess();
  const canManageCustomers = !!permissions.customers?.manage;
  const canManageArticles = !!permissions.articles?.manage;
  const canManageLocations = !!permissions.storage_locations?.manage;
  const canManageInventory = !!permissions.inventory?.manage;
  const canCreateTransactions = !!(permissions.transactions?.create || permissions.transactions?.manage);
  const canViewInventory = !!(permissions.inventory?.view || permissions.inventory?.manage);
  const canManagePicking = !!permissions.picking?.manage;
  const canProcessPicking = !!permissions.picking?.process;
  const visibility = {
    dashboard: hasAnyPermission(permissions),
    booking: canCreateTransactions,
    inventory: canViewInventory,
    locations: canManageLocations,
    masterdata: !!(canManageCustomers || canManageArticles),
    picking: !!(permissions.picking?.view || canManagePicking || canProcessPicking),
    history: !!(permissions.transactions?.view || permissions.transactions?.export || permissions.transactions?.manage)
  };

  document.querySelectorAll(".warehouse-nav__button").forEach((button) => {
    button.style.display = visibility[button.dataset.tab] ? "" : "none";
  });

  if ($("openAdminBtn")) $("openAdminBtn").style.display = canOpenAdmin() ? "" : "none";
  if ($("bookingEditorCard")) $("bookingEditorCard").style.display = visibility.booking ? "" : "none";
  if ($("inventoryEditorCard")) $("inventoryEditorCard").style.display = canManageInventory ? "" : "none";
  if ($("locationEditorCard")) $("locationEditorCard").style.display = canManageLocations ? "" : "none";
  if ($("customerEditorCard")) $("customerEditorCard").style.display = canManageCustomers ? "" : "none";
  if ($("articleEditorCard")) $("articleEditorCard").style.display = canManageArticles ? "" : "none";
  if ($("pickingOfficeCard")) $("pickingOfficeCard").style.display = canManagePicking ? "" : "none";
  if ($("pickingProcessCard")) $("pickingProcessCard").style.display = canProcessPicking ? "" : "none";
  if ($("locationDeleteBtn")) $("locationDeleteBtn").style.display = canManageLocations ? "" : "none";
  if ($("customerDeleteBtn")) $("customerDeleteBtn").style.display = canManageCustomers ? "" : "none";
  if ($("articleDeleteBtn")) $("articleDeleteBtn").style.display = canManageArticles ? "" : "none";
  if ($("pickingDeleteBtn")) $("pickingDeleteBtn").style.display = canManagePicking ? "" : "none";
  if ($("pickingAddItemBtn")) $("pickingAddItemBtn").style.display = canManagePicking ? "" : "none";
  if ($("historyCsvExportBtn")) $("historyCsvExportBtn").style.display = permissions.transactions?.export ? "" : "none";
  if ($("historyXlsxExportBtn")) $("historyXlsxExportBtn").style.display = permissions.transactions?.export ? "" : "none";
  if ($("bookingPermissionBadge")) {
    $("bookingPermissionBadge").textContent = canCreateTransactions ? "Buchen" : "Nur Ansicht";
  }

  setFormEnabled("bookingForm", canCreateTransactions);
  setFormEnabled("locationForm", canManageLocations);
  setFormEnabled("customerForm", canManageCustomers);
  setFormEnabled("articleForm", canManageArticles);
  setFormEnabled("inventoryForm", canManageInventory);
  setFormEnabled("pickingForm", canManagePicking);

  setSidebarNote();
  ensureVisibleActiveTab();
  updateBookingSubmitState();
}

function updateLookupLists() {
  const articleList = $("warehouseArticleLookupList");
  const customerList = $("warehouseCustomerLookupList");
  const locationList = $("warehouseLocationLookupList");
  if (articleList) {
    articleList.innerHTML = state.refs.articles
      .map((article) => `<option value="${escapeHtml(articleLabel(article))}"></option>`)
      .join("");
  }
  if (customerList) {
    customerList.innerHTML = state.refs.customers
      .map((customer) => `<option value="${escapeHtml(customerLabel(customer))}"></option>`)
      .join("");
  }
  if (locationList) {
    locationList.innerHTML = state.refs.locations
      .map((location) => `<option value="${escapeHtml(locationLabel(location))}"></option>`)
      .join("");
  }

  renderBookingLocationOptions();
  renderPackagingOptions("bookingPackagingType");
  renderPackagingOptions("inventoryPackagingType");
}

async function downloadWithAuth(url, fallbackFilename) {
  const response = await api(url, { method: "GET", headers: {} });
  if (!response.ok) {
    const data = await readJsonSafe(response);
    throw new Error(data?.error || "Download fehlgeschlagen");
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  const filename = match?.[1] || fallbackFilename;
  const link = document.createElement("a");
  const href = URL.createObjectURL(blob);
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
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

function showPasswordModal(show) {
  const back = $("passwordModalBack");
  if (!back) return;
  back.style.display = show ? "flex" : "none";
  back.setAttribute("aria-hidden", show ? "false" : "true");
}

function bindSettingsMenu() {
  const trigger = $("settingsTriggerBtn");
  const wrap = $("settingsMenuWrap");
  const darkmodeBtn = $("menuDarkmodeBtn");
  const openPasswordBtn = $("openChangePasswordBtn");
  const openAdminBtn = $("openAdminBtn");
  const dashboardBtn = $("moduleDashboardBtn");

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
      closeSlotModal();
    }
  });

  darkmodeBtn?.addEventListener("click", () => {
    $("themeToggleBtn")?.click();
    closeSettingsMenu();
  });

  openPasswordBtn?.addEventListener("click", () => {
    closeSettingsMenu();
    clearMessage("passwordModalMsg");
    $("currentPassword").value = "";
    $("newPassword").value = "";
    $("confirmPassword").value = "";
    showPasswordModal(true);
  });

  openAdminBtn?.addEventListener("click", () => {
    closeSettingsMenu();
    window.location.href = "/public/admin.html";
  });

  dashboardBtn?.addEventListener("click", () => {
    closeSettingsMenu();
    window.location.href = "/public/dashboard.html";
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    closeSettingsMenu();
    try {
      await api("/api/logout", { method: "POST", headers: {} });
    } catch {
      // local cleanup is enough
    }
    localStorage.removeItem("token");
    window.location.href = "/login.html";
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
    const currentPassword = String($("currentPassword").value || "").trim();
    const newPassword = String($("newPassword").value || "").trim();
    const confirmPassword = String($("confirmPassword").value || "").trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage("passwordModalMsg", "Bitte alle Felder ausfüllen.");
      return;
    }
    if (newPassword.length < 8) {
      setMessage("passwordModalMsg", "Das neue Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("passwordModalMsg", "Die neuen Passwörter stimmen nicht überein.");
      return;
    }

    saveBtn.disabled = true;
    setMessage("passwordModalMsg", "Passwort wird gespeichert ...", true);

    try {
      const response = await api("/api/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("passwordModalMsg", data?.error || "Passwort konnte nicht geändert werden.");
        return;
      }
      setMessage("passwordModalMsg", "Passwort erfolgreich geändert.", true);
      window.setTimeout(() => showPasswordModal(false), 700);
    } catch {
      setMessage("passwordModalMsg", "Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      saveBtn.disabled = false;
    }
  });
}

function bindTabNavigation() {
  document.querySelectorAll(".warehouse-nav__button").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });
}

function updateBookingVisibility() {
  const type = $("bookingType")?.value || "IN";
  const sourceField = $("bookingSourceField");
  const destinationField = $("bookingDestinationField");
  const sourceSlotField = $("bookingSourceSlotsField");
  const destinationSlotField = $("bookingDestinationSlotsField");
  const sourceInput = $("bookingSourceSelect");
  const destinationInput = $("bookingDestinationSelect");

  if (sourceField) sourceField.style.display = type === "IN" ? "none" : "";
  if (destinationField) destinationField.style.display = type === "OUT" ? "none" : "";
  if (sourceSlotField) sourceSlotField.style.display = type === "IN" ? "none" : "";
  if (destinationSlotField) destinationSlotField.style.display = type === "OUT" ? "none" : "";
  if (sourceInput) sourceInput.disabled = type === "IN";
  if (destinationInput) destinationInput.disabled = type === "OUT";

  renderBookingLocationOptions();
  void syncBookingSlotOptions();
}

function getLocationCapacityMetrics(location) {
  const capacity = Math.max(Number(location?.kapazitaet || 0), 1);
  const occupied = Math.max(Number(location?.belegte_positionen || 0), 0);
  const positions = occupied;
  const rawPercent = (occupied / capacity) * 100;
  const percent = Math.max(Math.min(rawPercent, 100), 0);
  const free = Math.max(capacity - occupied, 0);
  const overflow = Math.max(occupied - capacity, 0);

  let tone = "ok";
  let badge = occupied === 0 ? "Leer" : "Verfügbar";
  if (rawPercent >= 100) {
    tone = "critical";
    badge = overflow > 0 ? "Überfüllt" : "Voll";
  } else if (rawPercent >= 80) {
    tone = "warning";
    badge = "Knapp";
  }

  return {
    capacity,
    occupied,
    positions,
    rawPercent,
    percent,
    free,
    overflow,
    tone,
    badge,
    detailText: overflow > 0
      ? `${formatNumber(overflow)} über Kapazität`
      : `${formatNumber(free)} frei`
  };
}

function renderLocationCapacityCards() {
  const hosts = ["dashboardLocationCapacity", "bookingLocationCapacity"]
    .map((id) => $(id))
    .filter(Boolean);

  if (!hosts.length) return;

  const rows = [...state.refs.locations].sort((left, right) => {
    const leftMetrics = getLocationCapacityMetrics(left);
    const rightMetrics = getLocationCapacityMetrics(right);
    if (rightMetrics.rawPercent !== leftMetrics.rawPercent) return rightMetrics.rawPercent - leftMetrics.rawPercent;
    return String(left.name || "").localeCompare(String(right.name || ""), "de-DE");
  });

  const markup = rows.length
    ? rows.map((location) => {
        const metrics = getLocationCapacityMetrics(location);
        return `
          <button class="warehouse-capacity-card warehouse-capacity-card--interactive" type="button" data-location-open="${escapeHtml(location.id)}">
            <div class="warehouse-capacity-card__top">
              <div>
                <div class="warehouse-capacity-card__title">${escapeHtml(location.name)}</div>
                <div class="warehouse-capacity-card__meta">${escapeHtml(location.typ)}</div>
              </div>
              <span class="warehouse-badge warehouse-capacity-card__badge warehouse-capacity-card__badge--${metrics.tone}">
                ${escapeHtml(metrics.badge)}
              </span>
            </div>
            <div class="warehouse-capacity-meter" aria-hidden="true">
              <span
                class="warehouse-capacity-meter__fill warehouse-capacity-meter__fill--${metrics.tone}"
                style="width:${metrics.percent.toFixed(1)}%;"
              ></span>
            </div>
            <div class="warehouse-capacity-card__stats">
              <strong>${escapeHtml(`${formatNumber(metrics.occupied)}/${formatNumber(metrics.capacity)} belegt`)}</strong>
              <span>${escapeHtml(metrics.detailText)}</span>
            </div>
            <div class="warehouse-capacity-card__foot">
              <span>${escapeHtml(`${formatNumber(metrics.positions)} belegte Stellplätze`)}</span>
              <span>${escapeHtml(`${formatNumber(Math.round(metrics.rawPercent))}% Auslastung • Raster öffnen`)}</span>
            </div>
          </button>
        `;
      }).join("")
    : `<div class="warehouse-empty">Noch keine Lagerplätze vorhanden.</div>`;

  hosts.forEach((host) => {
    host.innerHTML = markup;
    host.querySelectorAll("[data-location-open]").forEach((button) => {
      button.addEventListener("click", () => {
        void openLocationSlotModal(button.dataset.locationOpen);
      });
    });
  });
}

function notifyBookingFailure(error, payload) {
  if (!error.payload) error.payload = payload;
  console.log(error);

  const message = error?.message || "Buchung konnte nicht gespeichert werden.";
  const detailText = error?.details
    ? `\nDetails: ${typeof error.details === "string" ? error.details : JSON.stringify(error.details)}`
    : "";

  setMessage("bookingMsg", message);
  window.alert(`Buchung konnte nicht gespeichert werden.\n${message}${detailText}`);
}

function renderBookingPreview() {
  const type = $("bookingType")?.value || "-";
  const article = $("bookingArticleLookup")?.value || "-";
  const quantity = $("bookingQuantity")?.value || "-";
  const packaging = $("bookingPackagingType")?.value || "-";
  const sourceLocation = resolveLocation($("bookingSourceSelect")?.value || "");
  const destinationLocation = resolveLocation($("bookingDestinationSelect")?.value || "");
  const source = sourceLocation ? locationLabel(sourceLocation) : "-";
  const destination = destinationLocation ? locationLabel(destinationLocation) : "-";
  const sourceSlots = selectedValues("bookingSourceSlots");
  const destinationSlots = selectedValues("bookingDestinationSlots");
  const locationText = type === "IN"
    ? destination
    : type === "OUT"
      ? source
      : `${source} -> ${destination}`;
  const slotText = type === "IN"
    ? formatSlotList(destinationSlots)
    : type === "OUT"
      ? formatSlotList(sourceSlots)
      : `Quelle: ${formatSlotList(sourceSlots)} | Ziel: ${formatSlotList(destinationSlots)}`;

  const preview = $("bookingPreview");
  if (!preview) return;
  preview.innerHTML = `
    <div class="warehouse-preview__row"><span>Typ</span><strong>${escapeHtml(type)}</strong></div>
    <div class="warehouse-preview__row"><span>Artikel</span><strong>${escapeHtml(article)}</strong></div>
    <div class="warehouse-preview__row"><span>Lagerplatz</span><strong>${escapeHtml(locationText || "-")}</strong></div>
    <div class="warehouse-preview__row"><span>Stellplätze</span><strong>${escapeHtml(slotText)}</strong></div>
    <div class="warehouse-preview__row"><span>Verpackung</span><strong>${escapeHtml(packaging || "-")}</strong></div>
    <div class="warehouse-preview__row"><span>Menge</span><strong>${escapeHtml(quantity)}</strong></div>
  `;
}

function resetBookingForm() {
  $("bookingForm")?.reset();
  if ($("bookingType")) $("bookingType").value = "IN";
  renderPackagingOptions("bookingPackagingType");
  renderBookingLocationOptions();
  if ($("bookingSourceSlots")) $("bookingSourceSlots").innerHTML = "";
  if ($("bookingDestinationSlots")) $("bookingDestinationSlots").innerHTML = "";
  if ($("bookingSourceSlotsHelp")) {
    $("bookingSourceSlotsHelp").textContent = "Belegte Stellplätze werden geladen, sobald ein Quell-Lagerplatz gewählt wurde.";
  }
  if ($("bookingDestinationSlotsHelp")) {
    $("bookingDestinationSlotsHelp").textContent = "Freie Stellplätze werden geladen, sobald ein Ziel-Lagerplatz gewählt wurde.";
  }
  if ($("bookingQuantity")) $("bookingQuantity").value = 1;
  resetBookingDate();
  updateBookingVisibility();
  renderBookingPreview();
  updateBookingSubmitState();
  clearMessage("bookingMsg");
  $("bookingBelegNr")?.focus();
}

function statusBadgeClass(status) {
  if (status === "OFFEN") return "warehouse-badge--open";
  if (status === "IN_BEARBEITUNG") return "warehouse-badge--progress";
  if (status === "ERLEDIGT") return "warehouse-badge--done";
  return "warehouse-badge--accent";
}

function renderDashboard() {
  const summary = state.dashboard?.summary || {};
  $("dashboardCustomersCount").textContent = String(summary.customers_count || 0);
  $("dashboardArticlesCount").textContent = String(summary.articles_count || 0);
  $("dashboardLocationsCount").textContent = String(summary.storage_locations_count || 0);
  $("dashboardInventoryPositionsCount").textContent = String(summary.inventory_positions_count || 0);
  $("dashboardInventoryQuantityMeta").textContent = `${formatNumber(summary.inventory_quantity_total || 0)} Stück insgesamt`;
  updateQuickStats(summary);
  renderLocationCapacityCards();

  const recentHost = $("dashboardRecentTransactions");
  const openOrdersHost = $("dashboardOpenOrders");

  if (recentHost) {
    const rows = Array.isArray(state.dashboard?.recent_transactions) ? state.dashboard.recent_transactions : [];
    recentHost.innerHTML = rows.length
      ? rows.map((row) => `
          <article class="warehouse-list-item">
            <div class="warehouse-list-item__top">
              <span class="warehouse-badge warehouse-badge--accent">${escapeHtml(row.typ)}</span>
              <span>${escapeHtml(formatDateTime(row.datum))}</span>
            </div>
            <div class="warehouse-list-item__title">${escapeHtml(row.artikel_nr || "")} - ${escapeHtml(row.bezeichnung || "")}</div>
            <div class="warehouse-list-item__meta">
              Beleg: ${escapeHtml(row.beleg_nr || "-")} | Menge: ${escapeHtml(row.menge)} | Verpackung: ${escapeHtml(row.verpackungsart || "-")}
            </div>
            <div class="warehouse-list-item__foot">
              ${escapeHtml(row.storage_location_from_name || "-")} -> ${escapeHtml(row.storage_location_to_name || "-")} | Stellplätze: ${escapeHtml(formatTransactionSlotSummary(row))}
            </div>
          </article>
        `).join("")
      : `<div class="warehouse-empty">Noch keine Bewegungen vorhanden.</div>`;
  }

  if (openOrdersHost) {
    const rows = Array.isArray(state.dashboard?.open_picking_orders) ? state.dashboard.open_picking_orders : [];
    openOrdersHost.innerHTML = rows.length
      ? rows.map((row) => `
          <article class="warehouse-list-item">
            <div class="warehouse-list-item__top">
              <span class="warehouse-badge ${statusBadgeClass(row.status)}">${escapeHtml(row.status)}</span>
              <span>${escapeHtml(row.faellig_am ? formatDate(row.faellig_am) : "ohne Termin")}</span>
            </div>
            <div class="warehouse-list-item__title">${escapeHtml(row.beleg_nr)}</div>
            <div class="warehouse-list-item__meta">
              ${escapeHtml(row.customer_name || "-")} | ${escapeHtml(row.item_count)} Positionen
            </div>
            <div class="warehouse-list-item__foot">
              Soll: ${escapeHtml(row.menge_soll_gesamt)} | Ist: ${escapeHtml(row.menge_ist_gesamt)}
            </div>
          </article>
        `).join("")
      : `<div class="warehouse-empty">Keine offenen Versandaufträge vorhanden.</div>`;
  }
}

function renderLocations() {
  const search = normalizeLookupValue($("locationSearch")?.value || "");
  const rows = state.refs.locations.filter((location) => {
    if (!search) return true;
    return normalizeLookupValue(location.name).includes(search) || normalizeLookupValue(location.typ).includes(search);
  });

  renderLocationCapacityCards();

  const host = $("locationsTableWrap");
  if (!host) return;

  host.innerHTML = rows.length
    ? `
      <table class="warehouse-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Typ</th>
            <th>Kapazität</th>
            <th>Belegte Positionen</th>
            <th>Freie Stellplätze</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((location) => `
            <tr data-location-id="${location.id}">
              <td>${escapeHtml(location.name)}</td>
              <td>${escapeHtml(location.typ)}</td>
              <td>${escapeHtml(formatNumber(location.kapazitaet))}</td>
              <td>${escapeHtml(formatNumber(location.belegte_positionen || 0))}</td>
              <td>${escapeHtml(formatNumber(locationFreeSlotCount(location)))}</td>
              <td>
                <div class="warehouse-table__actions">
                  <button class="secondary" type="button" data-location-open="${location.id}">Details</button>
                  ${permissionValue("warehouse.storage_locations.manage") ? `<button class="secondary" type="button" data-location-edit="${location.id}">Bearbeiten</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : `<div class="warehouse-empty">Keine Lagerplätze gefunden.</div>`;

  host.querySelectorAll("[data-location-open]").forEach((button) => {
    button.addEventListener("click", () => {
      void openLocationSlotModal(button.dataset.locationOpen);
    });
  });

  host.querySelectorAll("[data-location-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const location = state.refs.locations.find((item) => Number(item.id) === Number(button.dataset.locationEdit));
      if (!location) return;
      state.selected.locationId = location.id;
      $("locationType").value = location.typ;
      $("locationName").value = location.name;
      $("locationCapacity").value = location.kapazitaet;
      clearMessage("locationMsg");
    });
  });
}

function renderCustomers() {
  const search = normalizeLookupValue($("customerSearch")?.value || "");
  const rows = state.refs.customers.filter((customer) => {
    if (!search) return true;
    return normalizeLookupValue(customer.kunden_nr).includes(search) || normalizeLookupValue(customer.name).includes(search);
  });

  const host = $("customersTableWrap");
  if (!host) return;

  host.innerHTML = rows.length
    ? `
      <table class="warehouse-table">
        <thead>
          <tr>
            <th>Kundennummer</th>
            <th>Name</th>
            <th>Adresse</th>
            <th>Kontakt</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((customer) => `
            <tr>
              <td>${escapeHtml(customer.kunden_nr)}</td>
              <td>${escapeHtml(customer.name)}</td>
              <td>${escapeHtml(customer.adresse || "-")}</td>
              <td>${escapeHtml(customer.kontakt || "-")}</td>
              <td>
                <div class="warehouse-table__actions">
                  ${permissionValue("warehouse.customers.manage") ? `<button class="secondary" type="button" data-customer-edit="${customer.id}">Bearbeiten</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : `<div class="warehouse-empty">Keine Kunden gefunden.</div>`;

  host.querySelectorAll("[data-customer-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const customer = state.refs.customers.find((item) => Number(item.id) === Number(button.dataset.customerEdit));
      if (!customer) return;
      state.selected.customerId = customer.id;
      $("customerNumber").value = customer.kunden_nr;
      $("customerName").value = customer.name;
      $("customerAddress").value = customer.adresse || "";
      $("customerContact").value = customer.kontakt || "";
      clearMessage("customerMsg");
    });
  });
}

function renderArticles() {
  const search = normalizeLookupValue($("articleSearch")?.value || "");
  const rows = state.refs.articles.filter((article) => {
    if (!search) return true;
    return normalizeLookupValue(article.artikel_nr).includes(search) || normalizeLookupValue(article.bezeichnung).includes(search);
  });

  const host = $("articlesTableWrap");
  if (!host) return;

  host.innerHTML = rows.length
    ? `
      <table class="warehouse-table">
        <thead>
          <tr>
            <th>Artikelnummer</th>
            <th>Bezeichnung</th>
            <th>Beschreibung</th>
            <th>Bestand</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((article) => `
            <tr>
              <td>${escapeHtml(article.artikel_nr)}</td>
              <td>${escapeHtml(article.bezeichnung)}</td>
              <td>${escapeHtml(article.beschreibung || "-")}</td>
              <td>${escapeHtml(article.bestand_gesamt || 0)}</td>
              <td>
                <div class="warehouse-table__actions">
                  ${permissionValue("warehouse.articles.manage") ? `<button class="secondary" type="button" data-article-edit="${article.id}">Bearbeiten</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : `<div class="warehouse-empty">Keine Artikel gefunden.</div>`;

  host.querySelectorAll("[data-article-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const article = state.refs.articles.find((item) => Number(item.id) === Number(button.dataset.articleEdit));
      if (!article) return;
      state.selected.articleId = article.id;
      $("articleNumber").value = article.artikel_nr;
      $("articleName").value = article.bezeichnung;
      $("articleDescription").value = article.beschreibung || "";
      clearMessage("articleMsg");
    });
  });
}

function renderInventory() {
  const host = $("inventoryTableWrap");
  if (!host) return;

  host.innerHTML = state.inventory.length
    ? `
      <table class="warehouse-table">
        <thead>
          <tr>
            <th>Lagerplatz</th>
            <th>Stellplatz</th>
            <th>Typ</th>
            <th>Artikelnummer</th>
            <th>Artikel</th>
            <th>Verpackungsart</th>
            <th>Menge</th>
            <th>Aktualisiert</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${state.inventory.map((row) => `
            <tr>
              <td>${escapeHtml(row.storage_location_name)}</td>
              <td>${escapeHtml(formatNumber(row.stellplatz_nr))}</td>
              <td>${escapeHtml(row.storage_location_type)}</td>
              <td>${escapeHtml(row.artikel_nr)}</td>
              <td>${escapeHtml(row.bezeichnung)}</td>
              <td>${escapeHtml(row.verpackungsart || "-")}</td>
              <td>${escapeHtml(row.menge)}</td>
              <td>${escapeHtml(formatDateTime(row.updated_at))}</td>
              <td>
                <div class="warehouse-table__actions">
                  ${permissionValue("warehouse.inventory.manage") ? `<button class="secondary" type="button" data-inventory-edit="${row.id}">Bearbeiten</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : `<div class="warehouse-empty">Keine Bestandsdaten gefunden.</div>`;

  host.querySelectorAll("[data-inventory-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = state.inventory.find((item) => Number(item.id) === Number(button.dataset.inventoryEdit));
      if (!row) return;
      state.selected.inventoryId = row.id;
      $("inventoryLocationLookup").value = locationLabel({
        id: row.storage_location_id,
        name: row.storage_location_name,
        typ: row.storage_location_type
      });
      $("inventorySlotNumber").value = row.stellplatz_nr;
      $("inventoryArticleLookup").value = articleLabel({
        id: row.article_id,
        artikel_nr: row.artikel_nr,
        bezeichnung: row.bezeichnung
      });
      $("inventoryPackagingType").value = row.verpackungsart || "";
      $("inventoryQuantity").value = row.menge;
      clearMessage("inventoryMsg");
    });
  });
}

function renderHistory() {
  const host = $("historyTableWrap");
  if (!host) return;

  host.innerHTML = state.transactions.length
    ? `
      <table class="warehouse-table">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Typ</th>
            <th>Beleg</th>
            <th>Kunde</th>
            <th>Artikel</th>
            <th>Verpackungsart</th>
            <th>Menge</th>
            <th>Stellplätze</th>
            <th>Von</th>
            <th>Zu</th>
            <th>Benutzer</th>
          </tr>
        </thead>
        <tbody>
          ${state.transactions.map((row) => `
            <tr>
              <td>${escapeHtml(formatDateTime(row.datum))}</td>
              <td><span class="warehouse-badge ${statusBadgeClass(row.typ)}">${escapeHtml(row.typ)}</span></td>
              <td>${escapeHtml(row.beleg_nr || "-")}</td>
              <td>${escapeHtml(row.customer_name || "-")}</td>
              <td>${escapeHtml(row.artikel_nr || "")} - ${escapeHtml(row.bezeichnung || "")}</td>
              <td>${escapeHtml(row.verpackungsart || "-")}</td>
              <td>${escapeHtml(row.menge)}</td>
              <td>${escapeHtml(formatTransactionSlotSummary(row))}</td>
              <td>${escapeHtml(row.storage_location_from_name || "-")}</td>
              <td>${escapeHtml(row.storage_location_to_name || "-")}</td>
              <td>${escapeHtml(row.username || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : `<div class="warehouse-empty">Keine Transaktionen für den aktuellen Filter gefunden.</div>`;
}

function createPickingDraftItem(item = {}) {
  return {
    localId: nextLocalId("pick"),
    articleLookup: item.articleLookup || (item.artikel_nr && item.bezeichnung ? `${item.artikel_nr} - ${item.bezeichnung}` : ""),
    article_id: item.article_id || null,
    menge_soll: item.menge_soll || 1,
    menge_ist: item.menge_ist || 0
  };
}

function renderPickingItemEditor() {
  const host = $("pickingItemsEditor");
  if (!host) return;

  host.innerHTML = state.pickingDraftItems.map((item, index) => `
    <div class="warehouse-item-row" data-draft-item="${item.localId}">
      <div>
        <label>Artikel</label>
        <input type="text" data-item-field="article" value="${escapeHtml(item.articleLookup || "")}" list="warehouseArticleLookupList" placeholder="Artikel wählen" autocomplete="off" />
      </div>
      <div>
        <label>Menge Soll</label>
        <input type="number" data-item-field="menge_soll" value="${escapeHtml(item.menge_soll || 1)}" min="1" />
      </div>
      <div>
        <label>Menge Ist</label>
        <input type="number" data-item-field="menge_ist" value="${escapeHtml(item.menge_ist || 0)}" min="0" />
      </div>
      <div>
        <label>&nbsp;</label>
        <button class="secondary" type="button" data-item-remove="${item.localId}">${index === 0 ? "Position entfernen" : "Entfernen"}</button>
      </div>
    </div>
  `).join("");

  host.querySelectorAll("[data-item-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.pickingDraftItems.length === 1) {
        state.pickingDraftItems = [createPickingDraftItem()];
      } else {
        state.pickingDraftItems = state.pickingDraftItems.filter((item) => item.localId !== button.dataset.itemRemove);
      }
      renderPickingItemEditor();
    });
  });
}

function readPickingDraftItems() {
  return Array.from(document.querySelectorAll("[data-draft-item]")).map((row) => ({
    articleLookup: row.querySelector('[data-item-field="article"]')?.value || "",
    menge_soll: Number(row.querySelector('[data-item-field="menge_soll"]')?.value || 0),
    menge_ist: Number(row.querySelector('[data-item-field="menge_ist"]')?.value || 0)
  }));
}

function renderPickingTable() {
  const host = $("pickingTableWrap");
  if (!host) return;

  host.innerHTML = state.pickingOrders.length
    ? `
      <table class="warehouse-table">
        <thead>
          <tr>
            <th>Beleg</th>
            <th>Status</th>
            <th>Kunde</th>
            <th>Fällig</th>
            <th>Positionen</th>
            <th>Soll / Ist</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${state.pickingOrders.map((row) => `
            <tr>
              <td>${escapeHtml(row.beleg_nr)}</td>
              <td><span class="warehouse-badge ${statusBadgeClass(row.status)}">${escapeHtml(row.status)}</span></td>
              <td>${escapeHtml(row.customer_name || "-")}</td>
              <td>${escapeHtml(row.faellig_am ? formatDate(row.faellig_am) : "-")}</td>
              <td>${escapeHtml(row.item_count || 0)}</td>
              <td>${escapeHtml(row.menge_soll_gesamt || 0)} / ${escapeHtml(row.menge_ist_gesamt || 0)}</td>
              <td>
                <div class="warehouse-table__actions">
                  ${permissionValue("warehouse.picking.manage") ? `<button class="secondary" type="button" data-picking-edit="${row.id}">Bearbeiten</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : `<div class="warehouse-empty">Keine Versandaufträge gefunden.</div>`;

  host.querySelectorAll("[data-picking-edit]").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectPickingOrder(button.dataset.pickingEdit);
    });
  });
}

function renderPickingProcessBoard() {
  const host = $("pickingProcessWrap");
  if (!host) return;

  const actionable = state.pickingOrders.filter((order) => order.status !== "ERLEDIGT");
  host.innerHTML = actionable.length
    ? actionable.map((order) => `
        <article class="warehouse-order-card" data-process-order="${order.id}">
          <div class="warehouse-order-card__head">
            <div>
              <div class="warehouse-order-card__title">${escapeHtml(order.beleg_nr)}</div>
              <div class="warehouse-order-card__meta">
              ${escapeHtml(order.customer_name || "-")} | Fällig: ${escapeHtml(order.faellig_am ? formatDate(order.faellig_am) : "ohne Termin")}
              </div>
            </div>
            <span class="warehouse-badge ${statusBadgeClass(order.status)}">${escapeHtml(order.status)}</span>
          </div>
          <div class="warehouse-order-card__items">
            ${(order.items || []).map((item) => `
              <div class="warehouse-order-line">
                <div>
                  <strong>${escapeHtml(item.artikel_nr)} - ${escapeHtml(item.bezeichnung)}</strong>
                  <span>Soll ${escapeHtml(item.menge_soll)}</span>
                </div>
                <div>
                  <label>Ist</label>
                  <input type="number" min="0" data-order-item-id="${item.id}" data-order-item-article="${item.article_id}" data-order-item-soll="${item.menge_soll}" value="${escapeHtml(item.menge_ist)}" />
                </div>
                <div>
                  <label>Offen</label>
                  <span>${escapeHtml(Math.max(Number(item.menge_soll) - Number(item.menge_ist), 0))}</span>
                </div>
              </div>
            `).join("")}
          </div>
          <div class="warehouse-order-card__actions">
            ${permissionValue("warehouse.picking.process") ? `
              <button class="secondary" type="button" data-order-start="${order.id}">In Bearbeitung</button>
              <button class="primary" type="button" data-order-complete="${order.id}">Als erledigt markieren</button>
            ` : ""}
          </div>
        </article>
      `).join("")
    : `<div class="warehouse-empty">Keine offenen Versandaufträge vorhanden.</div>`;

  host.querySelectorAll("[data-order-start]").forEach((button) => {
    button.addEventListener("click", async () => {
      clearMessage("pickingMsg");
      try {
        const response = await api(`/api/warehouse/picking-orders/${button.dataset.orderStart}/start`, {
          method: "PUT",
          headers: {}
        });
        const data = await readJsonSafe(response);
        if (!response.ok) {
          setMessage("pickingMsg", data?.error || "Auftrag konnte nicht gestartet werden.");
          return;
        }
        setMessage("pickingMsg", `Auftrag ${data?.beleg_nr || button.dataset.orderStart} ist jetzt in Bearbeitung.`, true);
        await loadPickingOrders();
      } catch (error) {
        setMessage("pickingMsg", error.message || "Auftrag konnte nicht gestartet werden.");
      }
    });
  });

  host.querySelectorAll("[data-order-complete]").forEach((button) => {
    button.addEventListener("click", async () => {
      clearMessage("pickingMsg");
      const card = button.closest("[data-process-order]");
      const orderId = Number(button.dataset.orderComplete);
      const order = state.pickingOrders.find((item) => Number(item.id) === orderId);
      if (!card || !order) return;

      const items = Array.from(card.querySelectorAll("[data-order-item-id]")).map((input) => ({
        article_id: Number(input.dataset.orderItemArticle),
        menge_soll: Number(input.dataset.orderItemSoll),
        menge_ist: Number(input.value || 0)
      }));

      try {
        const response = await api(`/api/warehouse/picking-orders/${orderId}/complete`, {
          method: "PUT",
          body: JSON.stringify({ items })
        });
        const data = await readJsonSafe(response);
        if (!response.ok) {
          setMessage("pickingMsg", data?.error || "Auftrag konnte nicht abgeschlossen werden.");
          return;
        }
        setMessage("pickingMsg", `Auftrag ${data?.beleg_nr || order.beleg_nr} wurde erledigt.`, true);
        await loadPickingOrders();
        await loadDashboard();
      } catch (error) {
        setMessage("pickingMsg", error.message || "Auftrag konnte nicht abgeschlossen werden.");
      }
    });
  });
}

function resetLocationForm() {
  $("locationForm")?.reset();
  $("locationType").value = "Regal";
  $("locationCapacity").value = 1;
  state.selected.locationId = null;
  clearMessage("locationMsg");
}

function resetCustomerForm() {
  $("customerForm")?.reset();
  state.selected.customerId = null;
  clearMessage("customerMsg");
}

function resetArticleForm() {
  $("articleForm")?.reset();
  state.selected.articleId = null;
  clearMessage("articleMsg");
}

function resetInventoryForm() {
  $("inventoryForm")?.reset();
  $("inventorySlotNumber").value = 1;
  renderPackagingOptions("inventoryPackagingType");
  $("inventoryQuantity").value = 1;
  state.selected.inventoryId = null;
  clearMessage("inventoryMsg");
}

function resetPickingForm() {
  $("pickingForm")?.reset();
  state.selected.pickingId = null;
  state.pickingDraftItems = [createPickingDraftItem()];
  renderPickingItemEditor();
  clearMessage("pickingMsg");
}

async function loadDashboard() {
  if (!hasAnyPermission(warehouseAccess())) return;
  const response = await api("/api/warehouse/dashboard", { method: "GET", headers: {} });
  const data = await readJsonSafe(response);
  if (!response.ok) throw new Error(data?.error || "Dashboard konnte nicht geladen werden.");
  state.dashboard = data || {};
  renderDashboard();
}

async function loadCustomers() {
  if (!(permissionValue("warehouse.customers.view") || permissionValue("warehouse.customers.manage"))) return;
  const response = await api("/api/warehouse/customers?limit=1000", { method: "GET", headers: {} });
  const data = await readJsonSafe(response);
  if (!response.ok) throw new Error(data?.error || "Kunden konnten nicht geladen werden.");
  state.refs.customers = Array.isArray(data) ? data : [];
  updateLookupLists();
  renderCustomers();
}

async function loadArticles() {
  if (!(permissionValue("warehouse.articles.view") || permissionValue("warehouse.articles.manage"))) return;
  const response = await api("/api/warehouse/articles?limit=1000", { method: "GET", headers: {} });
  const data = await readJsonSafe(response);
  if (!response.ok) throw new Error(data?.error || "Artikel konnten nicht geladen werden.");
  state.refs.articles = Array.isArray(data) ? data : [];
  updateLookupLists();
  renderArticles();
}

async function loadLocations() {
  if (!(permissionValue("warehouse.storage_locations.view") || permissionValue("warehouse.storage_locations.manage"))) return;
  const response = await api("/api/warehouse/storage-locations?limit=1000", { method: "GET", headers: {} });
  const data = await readJsonSafe(response);
  if (!response.ok) throw new Error(data?.error || "Lagerplätze konnten nicht geladen werden.");
  state.refs.locations = Array.isArray(data) ? data : [];
  invalidateLocationSlotCache();
  updateLookupLists();
  renderLocations();
  updateBookingSubmitState();
  if (state.slotModal.locationId) {
    void openLocationSlotModal(state.slotModal.locationId);
  }
}

async function loadInventory() {
  if (!(permissionValue("warehouse.inventory.view") || permissionValue("warehouse.inventory.manage"))) return;

  const params = new URLSearchParams({ limit: "1000" });
  const search = String($("inventorySearch")?.value || "").trim();
  const article = resolveArticle($("inventoryArticleFilter")?.value || "");
  const location = resolveLocation($("inventoryLocationFilter")?.value || "");
  if (search) params.set("search", search);
  if (article) params.set("article_id", String(article.id));
  if (location) params.set("storage_location_id", String(location.id));

  const response = await api(`/api/warehouse/inventory?${params.toString()}`, { method: "GET", headers: {} });
  const data = await readJsonSafe(response);
  if (!response.ok) throw new Error(data?.error || "Bestand konnte nicht geladen werden.");
  state.inventory = Array.isArray(data) ? data : [];
  renderInventory();
}

async function loadTransactions() {
  if (!(permissionValue("warehouse.transactions.view") || permissionValue("warehouse.transactions.manage"))) return;

  const params = new URLSearchParams({ limit: "500" });
  const search = String($("historySearch")?.value || "").trim();
  const type = String($("historyTypeFilter")?.value || "").trim();
  const dateFrom = String($("historyDateFrom")?.value || "").trim();
  const dateTo = String($("historyDateTo")?.value || "").trim();
  if (search) params.set("search", search);
  if (type) params.set("typ", type);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);

  const response = await api(`/api/warehouse/transactions?${params.toString()}`, { method: "GET", headers: {} });
  const data = await readJsonSafe(response);
  if (!response.ok) throw new Error(data?.error || "Historie konnte nicht geladen werden.");
  state.transactions = Array.isArray(data) ? data : [];
  renderHistory();
}

async function loadPickingOrders() {
  if (!(permissionValue("warehouse.picking.view") || permissionValue("warehouse.picking.manage") || permissionValue("warehouse.picking.process"))) return;

  const params = new URLSearchParams({ limit: "200" });
  const search = String($("pickingSearch")?.value || "").trim();
  const status = String($("pickingStatusFilter")?.value || "").trim();
  if (search) params.set("search", search);
  if (status) params.set("status", status);

  const response = await api(`/api/warehouse/picking-orders?${params.toString()}`, { method: "GET", headers: {} });
  const data = await readJsonSafe(response);
  if (!response.ok) throw new Error(data?.error || "Versandaufträge konnten nicht geladen werden.");

  state.pickingOrders = Array.isArray(data) ? data : [];

  const detailedOrders = await Promise.all(
    state.pickingOrders.map(async (order) => {
      const detailResponse = await api(`/api/warehouse/picking-orders/${order.id}`, { method: "GET", headers: {} });
      const detailData = await readJsonSafe(detailResponse);
      return detailResponse.ok ? detailData : order;
    })
  );

  state.pickingOrders = detailedOrders;
  renderPickingTable();
  renderPickingProcessBoard();
}

async function selectPickingOrder(id) {
  const response = await api(`/api/warehouse/picking-orders/${id}`, { method: "GET", headers: {} });
  const data = await readJsonSafe(response);
  if (!response.ok) throw new Error(data?.error || "Versandauftrag konnte nicht geladen werden.");

  state.selected.pickingId = data.id;
  $("pickingCustomerLookup").value = data.customer_id
    ? customerLabel(resolveCustomer(data.customer_id) || { kunden_nr: data.kunden_nr || "", name: data.customer_name || "" })
    : "";
  $("pickingBelegNr").value = data.beleg_nr || "";
  $("pickingDueDate").value = data.faellig_am || "";
  state.pickingDraftItems = (data.items || []).map((item) => createPickingDraftItem(item));
  if (!state.pickingDraftItems.length) state.pickingDraftItems = [createPickingDraftItem()];
  renderPickingItemEditor();
  setTab("picking");
}

async function loadContext() {
  const meResponse = await api("/api/me", { method: "GET", headers: {} });
  const meData = await readJsonSafe(meResponse);
  if (!meResponse.ok) {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
    return;
  }
  state.me = meData;
  $("warehouseMe").textContent = `${meData.username} | ${meData.business_role_name || "-"}`;

  const permResponse = await api("/api/my-permissions", { method: "GET", headers: {} });
  const permData = await readJsonSafe(permResponse);
  state.permissions = permResponse.ok ? permData || {} : {};
  applyPermissionsToUi();
}

function bindSearchInputs() {
  let inventoryTimer = null;
  let historyTimer = null;
  let pickingTimer = null;

  $("inventorySearch")?.addEventListener("input", () => {
    window.clearTimeout(inventoryTimer);
    inventoryTimer = window.setTimeout(() => void loadInventory().catch((error) => setMessage("inventoryMsg", error.message)), 220);
  });
  $("inventoryArticleFilter")?.addEventListener("change", () => void loadInventory().catch((error) => setMessage("inventoryMsg", error.message)));
  $("inventoryLocationFilter")?.addEventListener("change", () => void loadInventory().catch((error) => setMessage("inventoryMsg", error.message)));
  $("inventoryReloadBtn")?.addEventListener("click", () => void loadInventory().catch((error) => setMessage("inventoryMsg", error.message)));

  $("locationSearch")?.addEventListener("input", renderLocations);
  $("customerSearch")?.addEventListener("input", renderCustomers);
  $("articleSearch")?.addEventListener("input", renderArticles);

  $("historySearch")?.addEventListener("input", () => {
    window.clearTimeout(historyTimer);
    historyTimer = window.setTimeout(() => void loadTransactions().catch((error) => setMessage("historyMsg", error.message)), 260);
  });
  $("historyTypeFilter")?.addEventListener("change", () => void loadTransactions().catch((error) => setMessage("historyMsg", error.message)));
  $("historyDateFrom")?.addEventListener("change", () => void loadTransactions().catch((error) => setMessage("historyMsg", error.message)));
  $("historyDateTo")?.addEventListener("change", () => void loadTransactions().catch((error) => setMessage("historyMsg", error.message)));
  $("historyReloadBtn")?.addEventListener("click", () => void loadTransactions().catch((error) => setMessage("historyMsg", error.message)));
  $("historyResetBtn")?.addEventListener("click", () => {
    $("historySearch").value = "";
    $("historyTypeFilter").value = "";
    $("historyDateFrom").value = "";
    $("historyDateTo").value = "";
    void loadTransactions().catch((error) => setMessage("historyMsg", error.message));
  });

  $("pickingSearch")?.addEventListener("input", () => {
    window.clearTimeout(pickingTimer);
    pickingTimer = window.setTimeout(() => void loadPickingOrders().catch((error) => setMessage("pickingMsg", error.message)), 240);
  });
  $("pickingStatusFilter")?.addEventListener("change", () => void loadPickingOrders().catch((error) => setMessage("pickingMsg", error.message)));
  $("pickingReloadBtn")?.addEventListener("click", () => void loadPickingOrders().catch((error) => setMessage("pickingMsg", error.message)));
}

function bindSlotModal() {
  $("slotModalCloseBtn")?.addEventListener("click", closeSlotModal);
  $("slotModalBack")?.addEventListener("click", (event) => {
    if (event.target === $("slotModalBack")) closeSlotModal();
  });
}

function bindBookingForm() {
  $("bookingType")?.addEventListener("change", () => {
    updateBookingVisibility();
  });
  $("bookingArticleLookup")?.addEventListener("input", () => {
    void syncBookingSlotOptions();
  });
  $("bookingSourceSelect")?.addEventListener("change", () => {
    void syncBookingSlotOptions();
  });
  $("bookingDestinationSelect")?.addEventListener("change", () => {
    void syncBookingSlotOptions();
  });
  $("bookingCustomerLookup")?.addEventListener("input", renderBookingPreview);
  $("bookingPackagingType")?.addEventListener("change", () => {
    renderBookingPreview();
    updateBookingSubmitState();
  });
  ["bookingSourceSlots", "bookingDestinationSlots"].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      syncBookingPackagingFromSource();
      renderBookingPreview();
      updateBookingSubmitState();
    });
  });
  $("bookingQuantity")?.addEventListener("input", () => {
    renderBookingPreview();
    updateBookingSubmitState();
  });
  resetBookingDate();
  renderPackagingOptions("bookingPackagingType");
  renderBookingLocationOptions();
  updateBookingVisibility();

  $("bookingResetBtn")?.addEventListener("click", resetBookingForm);
  $("bookingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage("bookingMsg");

    const type = $("bookingType").value;
    const customer = resolveCustomer($("bookingCustomerLookup").value);
    const validation = validateBookingForm({ showMessage: true });
    if (!validation.valid) return;

    const sourceLocationId = type === "OUT" || type === "TRANSFER" ? validation.source?.id || null : null;
    const destinationLocationId = type === "IN" || type === "TRANSFER" ? validation.destination?.id || null : null;
    const payload = {
      typ: type,
      article_id: validation.article?.id || null,
      menge: validation.quantity,
      storage_location_from_id: sourceLocationId,
      storage_location_to_id: destinationLocationId,
      source_stellplaetze: type === "OUT" || type === "TRANSFER" ? validation.sourceSlots : undefined,
      target_stellplaetze: type === "IN" || type === "TRANSFER" ? validation.destinationSlots : undefined,
      verpackungsart: validation.packaging,
      customer_id: customer?.id || null,
      beleg_nr: $("bookingBelegNr").value.trim() || null,
      positions_nr: $("bookingPositionsNr").value.trim() || null,
      datum: $("bookingDate").value ? new Date($("bookingDate").value).toISOString() : null,
      notiz: $("bookingNote").value.trim() || null
    };

    try {
      const response = await api("/api/warehouse/transactions", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        const error = new Error(data?.error || "Buchung konnte nicht gespeichert werden.");
        error.status = response.status;
        error.details = data?.details || null;
        error.backendResponse = data;
        notifyBookingFailure(error, payload);
        return;
      }
      setMessage("bookingMsg", `Buchung ${data?.beleg_nr || data?.id || ""} wurde gespeichert.`, true);
      resetBookingForm();
      await Promise.all([
        loadInventory().catch(() => {}),
        loadTransactions().catch(() => {}),
        loadDashboard().catch(() => {}),
        loadArticles().catch(() => {}),
        loadLocations().catch(() => {})
      ]);
    } catch (error) {
      notifyBookingFailure(error, payload);
    }
  });
}

function bindInventoryForm() {
  $("inventoryResetBtn")?.addEventListener("click", resetInventoryForm);
  $("inventoryDeleteBtn")?.addEventListener("click", async () => {
    if (!state.selected.inventoryId) {
      setMessage("inventoryMsg", "Bitte zuerst einen Bestandsdatensatz auswählen.");
      return;
    }
    if (!window.confirm("Diesen Bestandsdatensatz wirklich löschen?")) return;
    try {
      const response = await api(`/api/warehouse/inventory/${state.selected.inventoryId}`, {
        method: "DELETE",
        headers: {}
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("inventoryMsg", data?.error || "Bestandsdatensatz konnte nicht gelöscht werden.");
        return;
      }
      setMessage("inventoryMsg", "Bestandsdatensatz wurde gelöscht.", true);
      resetInventoryForm();
      await Promise.all([loadInventory(), loadArticles(), loadLocations(), loadDashboard()]);
    } catch (error) {
      setMessage("inventoryMsg", error.message || "Bestandsdatensatz konnte nicht gelöscht werden.");
    }
  });

  $("inventoryForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage("inventoryMsg");
    const location = resolveLocation($("inventoryLocationLookup").value);
    const article = resolveArticle($("inventoryArticleLookup").value);
    const slotNumber = Number($("inventorySlotNumber").value || 0);
    const verpackungsart = String($("inventoryPackagingType").value || "").trim();
    const menge = Number($("inventoryQuantity").value || 0);

    if (!location || !article || !Number.isInteger(slotNumber) || slotNumber <= 0 || !verpackungsart) {
      setMessage("inventoryMsg", "Bitte Lagerplatz, Stellplatz, Artikel und Verpackungsart korrekt angeben.");
      return;
    }
    if (!Number.isInteger(menge) || menge !== 1) {
      setMessage("inventoryMsg", "Ein Bestandsdatensatz muss genau Menge 1 haben.");
      return;
    }

    const payload = {
      storage_location_id: location.id,
      stellplatz_nr: slotNumber,
      article_id: article.id,
      verpackungsart,
      menge
    };
    const method = state.selected.inventoryId ? "PUT" : "POST";
    const url = state.selected.inventoryId
      ? `/api/warehouse/inventory/${state.selected.inventoryId}`
      : "/api/warehouse/inventory";

    try {
      const response = await api(url, {
        method,
        body: JSON.stringify(payload)
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("inventoryMsg", data?.error || "Bestandsdatensatz konnte nicht gespeichert werden.");
        return;
      }
      setMessage("inventoryMsg", `Bestandsdatensatz für ${data?.artikel_nr || article.artikel_nr} wurde gespeichert.`, true);
      resetInventoryForm();
      await Promise.all([loadInventory(), loadArticles(), loadLocations(), loadDashboard()]);
    } catch (error) {
      setMessage("inventoryMsg", error.message || "Bestandsdatensatz konnte nicht gespeichert werden.");
    }
  });
}

function bindLocationForm() {
  $("locationResetBtn")?.addEventListener("click", resetLocationForm);
  $("locationReloadBtn")?.addEventListener("click", () => void loadLocations().catch((error) => setMessage("locationMsg", error.message)));
  $("locationDeleteBtn")?.addEventListener("click", async () => {
    if (!state.selected.locationId) {
      setMessage("locationMsg", "Bitte zuerst einen Lagerplatz auswählen.");
      return;
    }
    if (!window.confirm("Diesen Lagerplatz wirklich löschen?")) return;
    try {
      const response = await api(`/api/warehouse/storage-locations/${state.selected.locationId}`, {
        method: "DELETE",
        headers: {}
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("locationMsg", data?.error || "Lagerplatz konnte nicht gelöscht werden.");
        return;
      }
      setMessage("locationMsg", "Lagerplatz wurde gelöscht.", true);
      resetLocationForm();
      await Promise.all([loadLocations(), loadInventory(), loadDashboard()]);
    } catch (error) {
      setMessage("locationMsg", error.message || "Lagerplatz konnte nicht gelöscht werden.");
    }
  });

  $("locationForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage("locationMsg");

    const payload = {
      typ: $("locationType").value,
      name: $("locationName").value.trim(),
      kapazitaet: Number($("locationCapacity").value || 0)
    };

    if (!payload.name || !Number.isInteger(payload.kapazitaet) || payload.kapazitaet <= 0) {
      setMessage("locationMsg", "Bitte Typ, Name und Kapazität korrekt eingeben.");
      return;
    }

    const method = state.selected.locationId ? "PUT" : "POST";
    const url = state.selected.locationId
      ? `/api/warehouse/storage-locations/${state.selected.locationId}`
      : "/api/warehouse/storage-locations";

    try {
      const response = await api(url, {
        method,
        body: JSON.stringify(payload)
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("locationMsg", data?.error || "Lagerplatz konnte nicht gespeichert werden.");
        return;
      }
      setMessage("locationMsg", `Lagerplatz ${data?.name || payload.name} wurde gespeichert.`, true);
      resetLocationForm();
      await loadLocations();
    } catch (error) {
      setMessage("locationMsg", error.message || "Lagerplatz konnte nicht gespeichert werden.");
    }
  });
}

function bindCustomerForm() {
  $("customerResetBtn")?.addEventListener("click", resetCustomerForm);
  $("customerDeleteBtn")?.addEventListener("click", async () => {
    if (!state.selected.customerId) {
      setMessage("customerMsg", "Bitte zuerst einen Kunden auswählen.");
      return;
    }
    if (!window.confirm("Diesen Kunden wirklich löschen?")) return;
    try {
      const response = await api(`/api/warehouse/customers/${state.selected.customerId}`, {
        method: "DELETE",
        headers: {}
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("customerMsg", data?.error || "Kunde konnte nicht gelöscht werden.");
        return;
      }
      setMessage("customerMsg", "Kunde wurde gelöscht.", true);
      resetCustomerForm();
      await Promise.all([loadCustomers(), loadPickingOrders(), loadDashboard()]);
    } catch (error) {
      setMessage("customerMsg", error.message || "Kunde konnte nicht gelöscht werden.");
    }
  });

  $("customerForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage("customerMsg");
    const payload = {
      kunden_nr: $("customerNumber").value.trim(),
      name: $("customerName").value.trim(),
      adresse: $("customerAddress").value.trim() || null,
      kontakt: $("customerContact").value.trim() || null
    };

    if (!payload.kunden_nr || !payload.name) {
      setMessage("customerMsg", "Bitte Kundennummer und Name angeben.");
      return;
    }

    const method = state.selected.customerId ? "PUT" : "POST";
    const url = state.selected.customerId
      ? `/api/warehouse/customers/${state.selected.customerId}`
      : "/api/warehouse/customers";

    try {
      const response = await api(url, {
        method,
        body: JSON.stringify(payload)
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("customerMsg", data?.error || "Kunde konnte nicht gespeichert werden.");
        return;
      }
      setMessage("customerMsg", `Kunde ${data?.name || payload.name} wurde gespeichert.`, true);
      resetCustomerForm();
      await Promise.all([loadCustomers(), loadDashboard()]);
    } catch (error) {
      setMessage("customerMsg", error.message || "Kunde konnte nicht gespeichert werden.");
    }
  });
}

function bindArticleForm() {
  $("articleResetBtn")?.addEventListener("click", resetArticleForm);
  $("articleDeleteBtn")?.addEventListener("click", async () => {
    if (!state.selected.articleId) {
      setMessage("articleMsg", "Bitte zuerst einen Artikel auswählen.");
      return;
    }
    if (!window.confirm("Diesen Artikel wirklich löschen?")) return;
    try {
      const response = await api(`/api/warehouse/articles/${state.selected.articleId}`, {
        method: "DELETE",
        headers: {}
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("articleMsg", data?.error || "Artikel konnte nicht gelöscht werden.");
        return;
      }
      setMessage("articleMsg", "Artikel wurde gelöscht.", true);
      resetArticleForm();
      await Promise.all([loadArticles(), loadInventory(), loadPickingOrders(), loadDashboard()]);
    } catch (error) {
      setMessage("articleMsg", error.message || "Artikel konnte nicht gelöscht werden.");
    }
  });

  $("articleForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage("articleMsg");
    const payload = {
      artikel_nr: $("articleNumber").value.trim(),
      bezeichnung: $("articleName").value.trim(),
      beschreibung: $("articleDescription").value.trim() || null
    };

    if (!payload.artikel_nr || !payload.bezeichnung) {
      setMessage("articleMsg", "Bitte Artikelnummer und Bezeichnung angeben.");
      return;
    }

    const method = state.selected.articleId ? "PUT" : "POST";
    const url = state.selected.articleId
      ? `/api/warehouse/articles/${state.selected.articleId}`
      : "/api/warehouse/articles";

    try {
      const response = await api(url, {
        method,
        body: JSON.stringify(payload)
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("articleMsg", data?.error || "Artikel konnte nicht gespeichert werden.");
        return;
      }
      setMessage("articleMsg", `Artikel ${data?.bezeichnung || payload.bezeichnung} wurde gespeichert.`, true);
      resetArticleForm();
      await Promise.all([loadArticles(), loadInventory(), loadDashboard()]);
    } catch (error) {
      setMessage("articleMsg", error.message || "Artikel konnte nicht gespeichert werden.");
    }
  });
}

function bindPickingForm() {
  $("pickingAddItemBtn")?.addEventListener("click", () => {
    state.pickingDraftItems.push(createPickingDraftItem());
    renderPickingItemEditor();
  });

  $("pickingResetBtn")?.addEventListener("click", resetPickingForm);
  $("pickingDeleteBtn")?.addEventListener("click", async () => {
    if (!state.selected.pickingId) {
      setMessage("pickingMsg", "Bitte zuerst einen Versandauftrag auswählen.");
      return;
    }
    if (!window.confirm("Diesen Versandauftrag wirklich löschen?")) return;
    try {
      const response = await api(`/api/warehouse/picking-orders/${state.selected.pickingId}`, {
        method: "DELETE",
        headers: {}
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("pickingMsg", data?.error || "Versandauftrag konnte nicht gelöscht werden.");
        return;
      }
      setMessage("pickingMsg", "Versandauftrag wurde gelöscht.", true);
      resetPickingForm();
      await Promise.all([loadPickingOrders(), loadDashboard()]);
    } catch (error) {
      setMessage("pickingMsg", error.message || "Versandauftrag konnte nicht gelöscht werden.");
    }
  });

  $("pickingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage("pickingMsg");

    const customer = resolveCustomer($("pickingCustomerLookup").value);
    const items = readPickingDraftItems().map((item) => {
      const article = resolveArticle(item.articleLookup);
      return {
        article_id: article?.id,
        menge_soll: Number(item.menge_soll || 0),
        menge_ist: Number(item.menge_ist || 0)
      };
    });

    if (!customer) {
      setMessage("pickingMsg", "Bitte einen gültigen Kunden auswählen.");
      return;
    }
    if (!$("pickingBelegNr").value.trim()) {
      setMessage("pickingMsg", "Bitte eine Belegnummer angeben.");
      return;
    }
    if (!items.length || items.some((item) => !item.article_id || item.menge_soll <= 0 || item.menge_ist < 0)) {
      setMessage("pickingMsg", "Bitte alle Positionen vollständig ausfüllen.");
      return;
    }

    const payload = {
      customer_id: customer.id,
      beleg_nr: $("pickingBelegNr").value.trim(),
      faellig_am: $("pickingDueDate").value || null,
      items
    };

    const method = state.selected.pickingId ? "PUT" : "POST";
    const url = state.selected.pickingId
      ? `/api/warehouse/picking-orders/${state.selected.pickingId}`
      : "/api/warehouse/picking-orders";

    try {
      const response = await api(url, {
        method,
        body: JSON.stringify(payload)
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("pickingMsg", data?.error || "Versandauftrag konnte nicht gespeichert werden.");
        return;
      }
      setMessage("pickingMsg", `Versandauftrag ${data?.beleg_nr || payload.beleg_nr} wurde gespeichert.`, true);
      resetPickingForm();
      await Promise.all([loadPickingOrders(), loadDashboard()]);
    } catch (error) {
      setMessage("pickingMsg", error.message || "Versandauftrag konnte nicht gespeichert werden.");
    }
  });
}

function buildHistoryExportParams() {
  const params = new URLSearchParams();
  const search = String($("historySearch")?.value || "").trim();
  const type = String($("historyTypeFilter")?.value || "").trim();
  const dateFrom = String($("historyDateFrom")?.value || "").trim();
  const dateTo = String($("historyDateTo")?.value || "").trim();
  if (search) params.set("search", search);
  if (type) params.set("typ", type);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  return params;
}

function bindExportButtons() {
  $("historyCsvExportBtn")?.addEventListener("click", async () => {
    try {
      const params = buildHistoryExportParams();
      await downloadWithAuth(`/api/warehouse/transactions/export/csv?${params.toString()}`, "warehouse-transactions.csv");
    } catch (error) {
      setMessage("historyMsg", error.message || "CSV Export fehlgeschlagen.");
    }
  });

  $("historyXlsxExportBtn")?.addEventListener("click", async () => {
    try {
      const params = buildHistoryExportParams();
      await downloadWithAuth(`/api/warehouse/transactions/export/xlsx?${params.toString()}`, "warehouse-transactions.xlsx");
    } catch (error) {
      setMessage("historyMsg", error.message || "Excel Export fehlgeschlagen.");
    }
  });
}

async function initializeData() {
  await loadContext();
  if (!hasAnyPermission(warehouseAccess())) {
    window.location.href = "/public/dashboard.html";
    return;
  }

  await Promise.all([
    loadCustomers().catch((error) => setMessage("customerMsg", error.message)),
    loadArticles().catch((error) => setMessage("articleMsg", error.message)),
    loadLocations().catch((error) => setMessage("locationMsg", error.message))
  ]);

  if (!state.pickingDraftItems.length) state.pickingDraftItems = [createPickingDraftItem()];
  renderPickingItemEditor();

  await Promise.all([
    loadDashboard().catch((error) => setMessage("historyMsg", error.message)),
    loadInventory().catch((error) => setMessage("inventoryMsg", error.message)),
    loadTransactions().catch((error) => setMessage("historyMsg", error.message)),
    loadPickingOrders().catch((error) => setMessage("pickingMsg", error.message))
  ]);
}

(async function init() {
  bindSettingsMenu();
  bindPasswordModal();
  bindSlotModal();
  bindTabNavigation();
  bindSearchInputs();
  bindBookingForm();
  bindInventoryForm();
  bindLocationForm();
  bindCustomerForm();
  bindArticleForm();
  bindPickingForm();
  bindExportButtons();
  resetBookingForm();
  resetInventoryForm();
  resetLocationForm();
  resetCustomerForm();
  resetArticleForm();
  resetPickingForm();
  await initializeData();
})();
