const token = localStorage.getItem("token");
if (!token) window.location.href = "/login.html";

const PACKAGING_OPTIONS = ["Karton groß", "Karton klein"];

const state = {
  activeTab: "dashboard",
  me: null,
  permissions: {},
  refs: {
    customers: [],
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
    rows: [],
    dragSource: null
  },
  selected: {
    customerId: null,
    locationId: null,
    inventoryId: null,
    pickingId: null
  },
  pickingDraftItems: [],
  pickingSearch: {
    query: "",
    results: [],
    loading: false,
    context: null,
    requestId: 0
  }
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

function canCreateTransactions() {
  return !!(permissionValue("warehouse.transactions.create") || permissionValue("warehouse.transactions.manage"));
}

function canPostTransactions() {
  return !!permissionValue("warehouse.transactions.create");
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
  const customerNo = String(customer?.kunden_nr || "").trim();
  const customerName = String(customer?.name || "").trim();
  if (customerNo && customerName) return `${customerNo} - ${customerName}`;
  return customerName || customerNo || "-";
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

function buildPickingSearchContextLabel(context = null) {
  if (!context) return "";
  const parts = [];
  if (context.orderNote) parts.push(context.orderNote);
  else if (context.orderId) parts.push(`Auftrag ${formatNumber(context.orderId)}`);
  if (context.customerName) parts.push(context.customerName);
  return parts.join(" | ");
}

function resetPickingSearch(options = {}) {
  const { clearMessageBox = true } = options;
  state.pickingSearch.query = "";
  state.pickingSearch.results = [];
  state.pickingSearch.loading = false;
  state.pickingSearch.context = null;
  state.pickingSearch.requestId += 1;
  if (clearMessageBox) clearMessage("pickingSearchMsg");
  renderPickingSearchPanel();
}

function renderPickingSearchPanel() {
  const input = $("pickingPositionLookup");
  if (input && input.value !== state.pickingSearch.query) {
    input.value = state.pickingSearch.query;
  }

  const host = $("pickingPositionResults");
  if (!host) return;

  const query = String(state.pickingSearch.query || "").trim();
  const context = state.pickingSearch.context;
  const contextLabel = buildPickingSearchContextLabel(context);
  const summary = query
    ? `
      <div class="warehouse-picking-search-summary">
        <strong>Suchbegriff:</strong> Pos ${escapeHtml(query)}
        ${contextLabel ? `<br /><strong>Kontext:</strong> ${escapeHtml(contextLabel)}` : ""}
      </div>
    `
    : "";

  if (state.pickingSearch.loading) {
    host.innerHTML = `
      ${summary}
      <div class="warehouse-empty">Paletten werden gesucht...</div>
    `;
    return;
  }

  if (!query) {
    host.innerHTML = `<div class="warehouse-empty">Noch keine Palette gesucht.</div>`;
    return;
  }

  if (!state.pickingSearch.results.length) {
    host.innerHTML = `
      ${summary}
      <div class="warehouse-empty">Keine Palette mit dieser Positionsnummer gefunden.</div>
    `;
    return;
  }

  host.innerHTML = `
    ${summary}
    ${state.pickingSearch.results.map((row) => `
      <article class="warehouse-picking-search-result">
        <div class="warehouse-picking-search-result__top">
          <strong>Pos ${escapeHtml(row.positions_nr || query)}</strong>
          <span class="warehouse-badge warehouse-badge--accent">${escapeHtml(row.verpackungsart || "Palette")}</span>
        </div>
        <div class="warehouse-picking-search-result__grid">
          <div class="warehouse-picking-search-result__field">
            <span>Lagerplatz</span>
            <strong>${escapeHtml(row.storage_location_name || "-")}</strong>
          </div>
          <div class="warehouse-picking-search-result__field">
            <span>Stellplatz</span>
            <strong>${escapeHtml(formatNumber(row.stellplatz_nr))}</strong>
          </div>
          <div class="warehouse-picking-search-result__field">
            <span>Kunde</span>
            <strong>${escapeHtml(row.customer_name || row.kunden_nr || "-")}</strong>
          </div>
          <div class="warehouse-picking-search-result__field">
            <span>Beleg</span>
            <strong>${escapeHtml(row.beleg_nr || "-")}</strong>
          </div>
        </div>
        <div class="warehouse-picking-search-result__actions">
          <span class="warehouse-field-help">Lagerplatz ${escapeHtml(row.storage_location_name || "-")} / Stellplatz ${escapeHtml(formatNumber(row.stellplatz_nr))}</span>
          ${canPostTransactions()
            ? `<button class="primary" type="button" data-picking-direct-out="${escapeHtml(row.id)}">Direkt ausbuchen</button>`
            : `<span class="warehouse-field-help">Direktausbuchung nur mit Buchungsrecht verfügbar.</span>`}
        </div>
      </article>
    `).join("")}
  `;

  host.querySelectorAll("[data-picking-direct-out]").forEach((button) => {
    button.addEventListener("click", () => {
      void submitPickingDirectOutbook(button.dataset.pickingDirectOut);
    });
  });
}

async function runPickingPositionSearch(options = {}) {
  const query = String(options.query ?? state.pickingSearch.query ?? "").trim();
  const nextContext = Object.prototype.hasOwnProperty.call(options, "context")
    ? options.context
    : state.pickingSearch.context;
  const silent = options.silent === true;

  state.pickingSearch.query = query;
  state.pickingSearch.context = nextContext || null;

  if (!query) {
    resetPickingSearch({ clearMessageBox: !silent });
    return;
  }

  const requestId = state.pickingSearch.requestId + 1;
  state.pickingSearch.requestId = requestId;
  state.pickingSearch.loading = true;
  if (!silent) clearMessage("pickingSearchMsg");
  renderPickingSearchPanel();

  try {
    const params = new URLSearchParams({
      positions_nr: query,
      limit: "150"
    });
    if (state.pickingSearch.context?.customerId) {
      params.set("customer_id", String(state.pickingSearch.context.customerId));
    }

    const response = await api(`/api/warehouse/picking-slot-search?${params.toString()}`, {
      method: "GET",
      headers: {}
    });
    const data = await readJsonSafe(response);
    if (requestId !== state.pickingSearch.requestId) return;
    if (!response.ok) {
      throw new Error(data?.error || "Palettensuche konnte nicht ausgeführt werden.");
    }

    state.pickingSearch.results = Array.isArray(data) ? data : [];
    state.pickingSearch.loading = false;
    renderPickingSearchPanel();
    if (!state.pickingSearch.results.length && !silent) {
      setMessage("pickingSearchMsg", `Keine Palette zu Pos ${query} gefunden.`);
      return;
    }
    if (!silent) clearMessage("pickingSearchMsg");
  } catch (error) {
    if (requestId !== state.pickingSearch.requestId) return;
    state.pickingSearch.results = [];
    state.pickingSearch.loading = false;
    renderPickingSearchPanel();
    if (!silent) {
      setMessage("pickingSearchMsg", error.message || "Palettensuche konnte nicht ausgeführt werden.");
    }
  }
}

async function submitPickingDirectOutbook(inventoryId) {
  const row = state.pickingSearch.results.find((item) => Number(item.id) === Number(inventoryId));
  if (!row) {
    setMessage("pickingSearchMsg", "Die ausgewählte Palette ist nicht mehr in der Suchliste.");
    return;
  }
  if (!canPostTransactions()) {
    setMessage("pickingSearchMsg", "Direktausbuchung ist für dieses Konto nicht freigeschaltet.");
    return;
  }

  const context = state.pickingSearch.context;
  const locationLabelText = `${row.storage_location_name || "-"} / Stellplatz ${formatNumber(row.stellplatz_nr)}`;
  const confirmText = context?.orderNote
    ? `Palette fuer ${context.orderNote} von ${locationLabelText} jetzt direkt ausbuchen?`
    : `Palette von ${locationLabelText} jetzt direkt ausbuchen?`;
  if (!window.confirm(confirmText)) return;

  const payload = {
    typ: "OUT",
    menge: 1,
    storage_location_from_id: row.storage_location_id,
    source_stellplaetze: [Number(row.stellplatz_nr)],
    verpackungsart: row.verpackungsart,
    customer_id: context?.customerId || row.customer_id || null,
    beleg_nr: row.beleg_nr || null,
    positions_nr: row.positions_nr || state.pickingSearch.query || null,
    datum: new Date().toISOString(),
    notiz: context?.orderId
      ? `Direktausbuchung via Kommissionierung Auftrag ${context.orderId}${context.orderNote ? ` - ${context.orderNote}` : ""}`
      : "Direktausbuchung via Offene Kommissionierungen"
  };

  clearMessage("pickingSearchMsg");
  try {
    const response = await api("/api/warehouse/transactions", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await readJsonSafe(response);
    if (!response.ok) {
      setMessage("pickingSearchMsg", data?.error || "Direktausbuchung konnte nicht gespeichert werden.");
      return;
    }

    await Promise.all([
      loadPickingOrders().catch(() => {}),
      loadInventory().catch(() => {}),
      loadTransactions().catch(() => {}),
      loadDashboard().catch(() => {}),
      loadLocations().catch(() => {})
    ]);
    await runPickingPositionSearch({ query: state.pickingSearch.query, silent: true });
    setMessage(
      "pickingSearchMsg",
      `Palette Pos ${row.positions_nr || state.pickingSearch.query || "-"} aus ${locationLabelText} wurde direkt ausgebucht.`,
      true
    );
  } catch (error) {
    setMessage("pickingSearchMsg", error.message || "Direktausbuchung konnte nicht gespeichert werden.");
  }
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
      ? ` - Pos ${row.positions_nr || "-"} | ${row.customer_name || "kein Kunde"} | ${row.verpackungsart || "-"}`
      : " - frei";
    return `
      <option value="${escapeHtml(slotNo)}" ${currentValues.has(String(slotNo)) ? "selected" : ""}>
        ${escapeHtml(`Stellplatz ${slotNo}${suffix}`)}
      </option>
    `;
  }).join("");

  if (help) {
    help.textContent = mode === "occupied"
      ? "Nur belegte Stellplätze werden angezeigt. Kunde und Positionsnummer grenzen die Auswahl zusätzlich ein."
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
  const customer = resolveCustomer($("bookingCustomerLookup")?.value || "");
  const positionsFilter = normalizeLookupValue($("bookingPositionsNr")?.value || "");
  const source = resolveLocation($("bookingSourceSelect")?.value || "");
  const destination = resolveLocation($("bookingDestinationSelect")?.value || "");

  renderBookingLocationOptions();

  try {
    let sourceRows = [];
    let destinationRows = [];

    if ((type === "OUT" || type === "TRANSFER") && source) {
      sourceRows = (await loadLocationSlots(source.id)).filter((row) => row.status === "OCCUPIED");
      if (customer) {
        sourceRows = sourceRows.filter((row) => Number(row.customer_id) === Number(customer.id));
      }
      if (positionsFilter) {
        sourceRows = sourceRows.filter((row) =>
          normalizeLookupValue(row.positions_nr || "").includes(positionsFilter)
        );
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
  const customer = resolveCustomer($("bookingCustomerLookup")?.value || "");
  const positionsNr = String($("bookingPositionsNr")?.value || "").trim();
  const source = resolveLocation($("bookingSourceSelect")?.value || "");
  const destination = resolveLocation($("bookingDestinationSelect")?.value || "");
  const quantity = Number($("bookingQuantity")?.value || 0);
  const packaging = String($("bookingPackagingType")?.value || "").trim();
  const sourceSlots = selectedValues("bookingSourceSlots");
  const destinationSlots = selectedValues("bookingDestinationSlots");
  const validationHint = $("bookingValidationHint");
  const bookingStarted = Boolean(
    String($("bookingCustomerLookup")?.value || "").trim()
    || positionsNr
    || String($("bookingSourceSelect")?.value || "").trim()
    || String($("bookingDestinationSelect")?.value || "").trim()
    || packaging
    || sourceSlots.length
    || destinationSlots.length
    || quantity > 1
  );

  let message = "";

  if (!Number.isInteger(quantity) || quantity <= 0) message = "Bitte eine gültige Menge eingeben.";
  else if (!packaging) message = "Bitte eine Verpackungsart wählen.";
  else if (type === "IN" && !destination) message = "Bitte einen Ziel-Lagerplatz wählen.";
  else if (type === "OUT" && !source) message = "Bitte einen Quell-Lagerplatz wählen.";
  else if (type === "TRANSFER" && (!source || !destination)) message = "Bitte Quelle und Ziel wählen.";
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
    customer,
    positionsNr,
    source,
    destination,
    packaging
  };
}

function updateBookingSubmitState() {
  const button = $("bookingSubmitBtn");
  if (!button) return;
  const validation = validateBookingForm({ showMessage: false });
  button.disabled = !canCreateTransactions() || !validation.valid;
}

function buildSlotTooltipMarkup(row) {
  return `
    <strong>Pos ${escapeHtml(row.positions_nr || "-")}</strong>
    <span>Beleg: ${escapeHtml(row.beleg_nr || "-")}</span>
    <span>Menge: ${escapeHtml(row.menge || 1)}</span>
    <span>Verpackung: ${escapeHtml(row.verpackungsart || "-")}</span>
    <span>Kunde: ${escapeHtml(row.customer_name || "-")}</span>
    <span>Eingelagert von: ${escapeHtml(row.stored_by_username || "-")}</span>
  `;
}

function canTransferSlots() {
  return canPostTransactions();
}

function resetSlotModalLead(location = null) {
  const lead = $("slotModalLead");
  if (!lead) return;
  lead.style.color = "";
  lead.textContent = location
    ? "Freie und belegte Stellplätze werden als Raster angezeigt. Details öffnen Sie per Hover, Klick oder Drag & Drop."
    : "Belegte und freie Stellplätze werden geladen.";
}

function setSlotModalLead(text, ok = true) {
  const lead = $("slotModalLead");
  if (!lead) return;
  lead.style.color = ok ? "#0a7a2f" : "#b00020";
  lead.textContent = text || "";
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
          <span>Positionsnummer</span>
          <strong>${escapeHtml(row.positions_nr || "-")}</strong>
        </div>
        <div class="warehouse-slot-detail-row">
          <span>Beleg</span>
          <strong>${escapeHtml(row.beleg_nr || "-")}</strong>
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
  clearSlotDropTargets();
  back.style.display = "none";
  back.setAttribute("aria-hidden", "true");
  state.slotModal = {
    locationId: null,
    locationName: "",
    rows: [],
    dragSource: null
  };
}

function clearSlotDropTargets() {
  document.querySelectorAll(".warehouse-slot-cell--drop-target, .warehouse-slot-cell--dragging").forEach((node) => {
    node.classList.remove("warehouse-slot-cell--drop-target", "warehouse-slot-cell--dragging");
  });
}

async function submitSlotTransfer(sourceRow, targetRow, location) {
  if (!sourceRow || !targetRow) return;
  if (sourceRow.status !== "OCCUPIED" || targetRow.status !== "FREE") return;
  if (!canTransferSlots()) {
    setSlotModalLead("Keine Berechtigung für Umlagerungen vorhanden.", false);
    return;
  }

  setSlotModalLead(
    `Umlagerung von Stellplatz ${formatNumber(sourceRow.stellplatz_nr)} nach ${formatNumber(targetRow.stellplatz_nr)} wird gespeichert...`,
    true
  );

  try {
    const response = await api("/api/warehouse/transfer", {
      method: "POST",
      body: JSON.stringify({
        storage_location_from_id: sourceRow.storage_location_id || location.id,
        storage_location_to_id: targetRow.storage_location_id || location.id,
        source_stellplatz_nr: sourceRow.stellplatz_nr,
        target_stellplatz_nr: targetRow.stellplatz_nr,
        notiz: "Umlagerung via Drag & Drop"
      })
    });
    const data = await readJsonSafe(response);
    if (!response.ok) {
      setSlotModalLead(data?.error || "Umlagerung konnte nicht gespeichert werden.", false);
      return;
    }

    invalidateLocationSlotCache(location.id);
    await Promise.all([
      loadInventory().catch(() => {}),
      loadTransactions().catch(() => {}),
      loadDashboard().catch(() => {}),
      loadLocations().catch(() => {})
    ]);
    await openLocationSlotModal(location.id);

    const refreshedLocation = state.refs.locations.find((entry) => Number(entry.id) === Number(location.id)) || location;
    const movedRow = (state.slotModal.rows || []).find((entry) => Number(entry.stellplatz_nr) === Number(targetRow.stellplatz_nr)) || null;
    renderSlotModalDetail(movedRow, refreshedLocation);
    setSlotModalLead(
      `Stellplatz ${formatNumber(sourceRow.stellplatz_nr)} wurde nach ${formatNumber(targetRow.stellplatz_nr)} umgelagert.`,
      true
    );
  } catch (error) {
    setSlotModalLead(error.message || "Umlagerung konnte nicht gespeichert werden.", false);
  }
}

async function openLocationSlotModal(locationId) {
  const location = state.refs.locations.find((entry) => Number(entry.id) === Number(locationId));
  if (!location) return;

  const back = $("slotModalBack");
  const title = $("slotModalTitle");
  const grid = $("slotModalGrid");
  if (!back || !title || !grid) return;

  back.style.display = "flex";
  back.setAttribute("aria-hidden", "false");
  title.textContent = `${location.name} - Stellplatz-Raster`;
  resetSlotModalLead(location);
  grid.innerHTML = `<div class="warehouse-empty">Stellplätze werden geladen...</div>`;
  renderSlotModalDetail(null, location);

  try {
    const rows = await loadLocationSlots(location.id, { force: true });
    state.slotModal = {
      locationId: location.id,
      locationName: location.name,
      rows,
      dragSource: null
    };

    grid.style.setProperty("--slot-columns", String(Math.min(Math.max(Number(location.kapazitaet || 1), 1), 10)));
    grid.innerHTML = rows.map((row) => {
      const occupied = row.status === "OCCUPIED";
      return `
        <button
          class="warehouse-slot-cell warehouse-slot-cell--${occupied ? "occupied" : "free"}"
          type="button"
          draggable="${occupied && canTransferSlots() ? "true" : "false"}"
          data-status="${escapeHtml(row.status)}"
          data-inventory-id="${escapeHtml(row.inventory_id || "")}"
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
      button.addEventListener("dragstart", (event) => {
        if (!row || row.status !== "OCCUPIED" || !canTransferSlots()) {
          event.preventDefault();
          return;
        }
        state.slotModal.dragSource = row;
        clearSlotDropTargets();
        button.classList.add("warehouse-slot-cell--dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(row.stellplatz_nr));
        }
        renderSlotModalDetail(row, location);
      });
      button.addEventListener("dragend", () => {
        state.slotModal.dragSource = null;
        clearSlotDropTargets();
      });
      button.addEventListener("dragover", (event) => {
        const sourceRow = state.slotModal.dragSource;
        if (!sourceRow || !row || row.status !== "FREE") return;
        if (Number(sourceRow.stellplatz_nr) === Number(row.stellplatz_nr)) return;
        event.preventDefault();
        button.classList.add("warehouse-slot-cell--drop-target");
      });
      button.addEventListener("dragleave", () => {
        button.classList.remove("warehouse-slot-cell--drop-target");
      });
      button.addEventListener("drop", async (event) => {
        event.preventDefault();
        const sourceRow = state.slotModal.dragSource;
        state.slotModal.dragSource = null;
        clearSlotDropTargets();
        if (!sourceRow || !row || row.status !== "FREE") return;
        if (Number(sourceRow.stellplatz_nr) === Number(row.stellplatz_nr)) return;
        await submitSlotTransfer(sourceRow, row, location);
      });
    });
  } catch (error) {
    setSlotModalLead(error.message || "Stellplätze konnten nicht geladen werden.", false);
    grid.innerHTML = `<div class="warehouse-empty">${escapeHtml(error.message || "Stellplätze konnten nicht geladen werden.")}</div>`;
  }
}

function setSidebarNote() {
  const note = $("warehouseSidebarNote");
  if (!note) return;
  note.textContent = "";
  note.hidden = true;
  note.setAttribute("aria-hidden", "true");
}

function updateQuickStats(summary = {}) {
  $("warehouseQuickOpenOrders").textContent = String(summary.picking_open_count || 0);
  $("warehouseQuickInventory").textContent = String(summary.inventory_positions_count || 0);
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
    masterdata: canManageCustomers,
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
  if ($("pickingOfficeCard")) $("pickingOfficeCard").style.display = canManagePicking ? "" : "none";
  if ($("pickingProcessCard")) $("pickingProcessCard").style.display = canProcessPicking ? "" : "none";
  if ($("locationDeleteBtn")) $("locationDeleteBtn").style.display = canManageLocations ? "" : "none";
  if ($("customerDeleteBtn")) $("customerDeleteBtn").style.display = canManageCustomers ? "" : "none";
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
  setFormEnabled("inventoryForm", canManageInventory);
  setFormEnabled("pickingForm", canManagePicking);

  setSidebarNote();
  ensureVisibleActiveTab();
  updateBookingSubmitState();
}

function updateLookupLists() {
  const customerList = $("warehouseCustomerLookupList");
  const locationList = $("warehouseLocationLookupList");
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
              <span>${escapeHtml(`${formatNumber(Math.round(metrics.rawPercent))}% Auslastung | Raster öffnen`)}</span>
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
  const customer = $("bookingCustomerLookup")?.value || "-";
  const positionsNr = $("bookingPositionsNr")?.value || "-";
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
    <div class="warehouse-preview__row"><span>Kunde</span><strong>${escapeHtml(customer)}</strong></div>
    <div class="warehouse-preview__row"><span>Positionsnummer</span><strong>${escapeHtml(positionsNr)}</strong></div>
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
            <div class="warehouse-list-item__title">${escapeHtml(row.customer_name || "Ohne Kunde")} | Pos ${escapeHtml(row.positions_nr || "-")}</div>
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
            <div class="warehouse-list-item__title">${escapeHtml(row.notiz || "Ohne Notiz")}</div>
            <div class="warehouse-list-item__meta">
              ${escapeHtml(row.customer_name || "-")} | ${escapeHtml(row.item_count)} Positionen
            </div>
            <div class="warehouse-list-item__foot">
              Rollen: ${escapeHtml(row.rollen_nummern_gesamt || "-")}
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
              <td>${escapeHtml(customer.kunden_nr || "-")}</td>
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
      $("customerNumber").value = customer.kunden_nr || "";
      $("customerName").value = customer.name;
      $("customerAddress").value = customer.adresse || "";
      $("customerContact").value = customer.kontakt || "";
      clearMessage("customerMsg");
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
            <th>Kunde</th>
            <th>Beleg</th>
            <th>Positionsnummer</th>
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
              <td>${escapeHtml(row.customer_name || row.kunden_nr || "-")}</td>
              <td>${escapeHtml(row.beleg_nr || "-")}</td>
              <td>${escapeHtml(row.positions_nr || "-")}</td>
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
            <th>Positionsnummer</th>
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
              <td>${escapeHtml(row.positions_nr || "-")}</td>
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
    positions_nr: String(item.positions_nr || "").trim(),
    rollen_nummern: String(item.rollen_nummern || "").trim()
  };
}

function renderPickingItemEditor() {
  const host = $("pickingItemsEditor");
  if (!host) return;

  host.innerHTML = state.pickingDraftItems.map((item, index) => `
    <div class="warehouse-item-row" data-draft-item="${item.localId}">
      <div>
        <label>Positionsnummer</label>
        <input type="text" data-item-field="positions_nr" value="${escapeHtml(item.positions_nr || "")}" placeholder="Positionsnummer" autocomplete="off" />
      </div>
      <div>
        <label>Rollen Nummern</label>
        <input type="text" data-item-field="rollen_nummern" value="${escapeHtml(item.rollen_nummern || "")}" placeholder="z.B. 1-15 oder 1-6, 8-14" autocomplete="off" />
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
    positions_nr: row.querySelector('[data-item-field="positions_nr"]')?.value || "",
    rollen_nummern: row.querySelector('[data-item-field="rollen_nummern"]')?.value || ""
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
            <th>Notiz</th>
            <th>Status</th>
            <th>Kunde</th>
            <th>Fällig</th>
            <th>Positionen</th>
            <th>Rollen Nummern</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${state.pickingOrders.map((row) => `
            <tr>
              <td>${escapeHtml(row.notiz || "-")}</td>
              <td><span class="warehouse-badge ${statusBadgeClass(row.status)}">${escapeHtml(row.status)}</span></td>
              <td>${escapeHtml(row.customer_name || "-")}</td>
              <td>${escapeHtml(row.faellig_am ? formatDate(row.faellig_am) : "-")}</td>
              <td>${escapeHtml(row.item_count || 0)}</td>
              <td>${escapeHtml(row.rollen_nummern_gesamt || "-")}</td>
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
              <div class="warehouse-order-card__title">${escapeHtml(order.notiz || "Ohne Notiz")}</div>
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
                  <strong>Pos ${escapeHtml(item.positions_nr || "-")}</strong>
                  <div class="warehouse-order-line__meta">Rollen Nummern: ${escapeHtml(item.rollen_nummern || "-")}</div>
                </div>
                <div class="warehouse-order-line__actions">
                  <button
                    class="secondary"
                    type="button"
                    data-order-item-search="${escapeHtml(item.positions_nr || "")}"
                    data-order-id="${escapeHtml(order.id)}"
                    data-order-note="${escapeHtml(order.notiz || "")}"
                    data-order-status="${escapeHtml(order.status || "")}"
                    data-order-customer-id="${escapeHtml(order.customer_id || "")}"
                    data-order-customer-name="${escapeHtml(order.customer_name || "")}"
                  >
                    Palette suchen
                  </button>
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

  renderPickingSearchPanel();

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
        setMessage("pickingMsg", `Auftrag ${data?.notiz || button.dataset.orderStart} ist jetzt in Bearbeitung.`, true);
        await loadPickingOrders();
      } catch (error) {
        setMessage("pickingMsg", error.message || "Auftrag konnte nicht gestartet werden.");
      }
    });
  });

  host.querySelectorAll("[data-order-complete]").forEach((button) => {
    button.addEventListener("click", async () => {
      clearMessage("pickingMsg");
      const orderId = Number(button.dataset.orderComplete);
      const order = state.pickingOrders.find((item) => Number(item.id) === orderId);
      if (!order) return;

      try {
        const response = await api(`/api/warehouse/picking-orders/${orderId}/complete`, {
          method: "PUT",
          body: JSON.stringify({})
        });
        const data = await readJsonSafe(response);
        if (!response.ok) {
          setMessage("pickingMsg", data?.error || "Auftrag konnte nicht abgeschlossen werden.");
          return;
        }
        setMessage("pickingMsg", `Auftrag ${data?.notiz || order.notiz || order.id} wurde erledigt.`, true);
        await loadPickingOrders();
        await loadDashboard();
      } catch (error) {
        setMessage("pickingMsg", error.message || "Auftrag konnte nicht abgeschlossen werden.");
      }
    });
  });

  host.querySelectorAll("[data-order-item-search]").forEach((button) => {
    button.addEventListener("click", () => {
      const query = String(button.dataset.orderItemSearch || "").trim();
      if (!query) {
        setMessage("pickingSearchMsg", "Für diese Position ist keine Positionsnummer hinterlegt.");
        return;
      }
      const context = {
        orderId: button.dataset.orderId ? Number(button.dataset.orderId) : null,
        orderNote: String(button.dataset.orderNote || "").trim(),
        orderStatus: String(button.dataset.orderStatus || "").trim(),
        customerId: button.dataset.orderCustomerId ? Number(button.dataset.orderCustomerId) : null,
        customerName: String(button.dataset.orderCustomerName || "").trim(),
        positionsNr: query
      };
      state.pickingSearch.query = query;
      if ($("pickingPositionLookup")) $("pickingPositionLookup").focus();
      void runPickingPositionSearch({ query, context });
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
  const positionsNr = String($("inventoryPositionsFilter")?.value || "").trim();
  const customer = resolveCustomer($("inventoryCustomerFilter")?.value || "");
  const location = resolveLocation($("inventoryLocationFilter")?.value || "");
  if (search) params.set("search", search);
  if (positionsNr) params.set("positions_nr", positionsNr);
  if (customer) params.set("customer_id", String(customer.id));
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
  const positionsNr = String($("historyPositionsFilter")?.value || "").trim();
  const customer = resolveCustomer($("historyCustomerFilter")?.value || "");
  const type = String($("historyTypeFilter")?.value || "").trim();
  const dateFrom = String($("historyDateFrom")?.value || "").trim();
  const dateTo = String($("historyDateTo")?.value || "").trim();
  if (search) params.set("search", search);
  if (positionsNr) params.set("positions_nr", positionsNr);
  if (customer) params.set("customer_id", String(customer.id));
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
    ? customerLabel({ kunden_nr: data.kunden_nr || "", name: data.customer_name || "" })
    : "";
  $("pickingNote").value = data.notiz || "";
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

  const queueInventoryReload = () => {
    window.clearTimeout(inventoryTimer);
    inventoryTimer = window.setTimeout(() => void loadInventory().catch((error) => setMessage("inventoryMsg", error.message)), 220);
  };
  ["inventorySearch", "inventoryPositionsFilter", "inventoryCustomerFilter", "inventoryLocationFilter"].forEach((id) => {
    $(id)?.addEventListener("input", queueInventoryReload);
    $(id)?.addEventListener("change", queueInventoryReload);
  });
  $("inventoryReloadBtn")?.addEventListener("click", () => void loadInventory().catch((error) => setMessage("inventoryMsg", error.message)));

  $("locationSearch")?.addEventListener("input", renderLocations);
  $("customerSearch")?.addEventListener("input", renderCustomers);

  const queueHistoryReload = () => {
    window.clearTimeout(historyTimer);
    historyTimer = window.setTimeout(() => void loadTransactions().catch((error) => setMessage("historyMsg", error.message)), 260);
  };
  ["historySearch", "historyPositionsFilter", "historyCustomerFilter"].forEach((id) => {
    $(id)?.addEventListener("input", queueHistoryReload);
    $(id)?.addEventListener("change", queueHistoryReload);
  });
  $("historyTypeFilter")?.addEventListener("change", () => void loadTransactions().catch((error) => setMessage("historyMsg", error.message)));
  $("historyDateFrom")?.addEventListener("change", () => void loadTransactions().catch((error) => setMessage("historyMsg", error.message)));
  $("historyDateTo")?.addEventListener("change", () => void loadTransactions().catch((error) => setMessage("historyMsg", error.message)));
  $("historyReloadBtn")?.addEventListener("click", () => void loadTransactions().catch((error) => setMessage("historyMsg", error.message)));
  $("historyResetBtn")?.addEventListener("click", () => {
    $("historySearch").value = "";
    $("historyPositionsFilter").value = "";
    $("historyCustomerFilter").value = "";
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

function bindPickingSearchPanel() {
  $("pickingPositionLookup")?.addEventListener("input", (event) => {
    state.pickingSearch.query = event.target.value || "";
    if (!String(state.pickingSearch.query || "").trim()) {
      resetPickingSearch();
    }
  });

  $("pickingPositionLookup")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const query = event.currentTarget?.value || "";
    state.pickingSearch.query = query;
    void runPickingPositionSearch({ query });
  });

  $("pickingPositionSearchBtn")?.addEventListener("click", () => {
    const query = $("pickingPositionLookup")?.value || "";
    state.pickingSearch.query = query;
    void runPickingPositionSearch({ query });
  });

  $("pickingPositionClearBtn")?.addEventListener("click", () => {
    resetPickingSearch();
    $("pickingPositionLookup")?.focus();
  });

  renderPickingSearchPanel();
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
  $("bookingCustomerLookup")?.addEventListener("input", () => {
    void syncBookingSlotOptions();
  });
  $("bookingPositionsNr")?.addEventListener("input", () => {
    void syncBookingSlotOptions();
  });
  $("bookingSourceSelect")?.addEventListener("change", () => {
    void syncBookingSlotOptions();
  });
  $("bookingDestinationSelect")?.addEventListener("change", () => {
    void syncBookingSlotOptions();
  });
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
    const validation = validateBookingForm({ showMessage: true });
    if (!validation.valid) return;

    const sourceLocationId = type === "OUT" || type === "TRANSFER" ? validation.source?.id || null : null;
    const destinationLocationId = type === "IN" || type === "TRANSFER" ? validation.destination?.id || null : null;
    const payload = {
      typ: type,
      menge: validation.quantity,
      storage_location_from_id: sourceLocationId,
      storage_location_to_id: destinationLocationId,
      source_stellplaetze: type === "OUT" || type === "TRANSFER" ? validation.sourceSlots : undefined,
      target_stellplaetze: type === "IN" || type === "TRANSFER" ? validation.destinationSlots : undefined,
      verpackungsart: validation.packaging,
      customer_id: validation.customer?.id || null,
      beleg_nr: $("bookingBelegNr").value.trim() || null,
      positions_nr: validation.positionsNr || null,
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
      await Promise.all([loadInventory(), loadLocations(), loadDashboard()]);
    } catch (error) {
      setMessage("inventoryMsg", error.message || "Bestandsdatensatz konnte nicht gelöscht werden.");
    }
  });

  $("inventoryForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage("inventoryMsg");
    const location = resolveLocation($("inventoryLocationLookup").value);
    const slotNumber = Number($("inventorySlotNumber").value || 0);
    const verpackungsart = String($("inventoryPackagingType").value || "").trim();
    const menge = Number($("inventoryQuantity").value || 0);

    if (!location || !Number.isInteger(slotNumber) || slotNumber <= 0 || !verpackungsart) {
      setMessage("inventoryMsg", "Bitte Lagerplatz, Stellplatz und Verpackungsart korrekt angeben.");
      return;
    }
    if (!Number.isInteger(menge) || menge !== 1) {
      setMessage("inventoryMsg", "Ein Bestandsdatensatz muss genau Menge 1 haben.");
      return;
    }

    const payload = {
      storage_location_id: location.id,
      stellplatz_nr: slotNumber,
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
      setMessage("inventoryMsg", `Bestandsdatensatz für ${data?.storage_location_name || location.name} / Stellplatz ${data?.stellplatz_nr || slotNumber} wurde gespeichert.`, true);
      resetInventoryForm();
      await Promise.all([loadInventory(), loadLocations(), loadDashboard()]);
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

    const customerValue = String($("pickingCustomerLookup").value || "").trim();
    const customer = resolveCustomer(customerValue);
    const items = readPickingDraftItems().map((item) => ({
      positions_nr: String(item.positions_nr || "").trim(),
      rollen_nummern: String(item.rollen_nummern || "").trim()
    }));

    if (!customerValue) {
      setMessage("pickingMsg", "Bitte einen Kunden eingeben.");
      return;
    }
    if (!items.length || items.some((item) => !item.positions_nr || !item.rollen_nummern)) {
      setMessage("pickingMsg", "Bitte alle Positionen vollständig ausfüllen.");
      return;
    }

    const payload = {
      customer_id: customer?.id || null,
      customer_name: customerValue,
      notiz: $("pickingNote").value.trim() || null,
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
      setMessage("pickingMsg", `Versandauftrag ${data?.notiz || payload.notiz || data?.id} wurde gespeichert.`, true);
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
  const positionsNr = String($("historyPositionsFilter")?.value || "").trim();
  const customer = resolveCustomer($("historyCustomerFilter")?.value || "");
  const type = String($("historyTypeFilter")?.value || "").trim();
  const dateFrom = String($("historyDateFrom")?.value || "").trim();
  const dateTo = String($("historyDateTo")?.value || "").trim();
  if (search) params.set("search", search);
  if (positionsNr) params.set("positions_nr", positionsNr);
  if (customer) params.set("customer_id", String(customer.id));
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
  bindPickingSearchPanel();
  bindBookingForm();
  bindInventoryForm();
  bindLocationForm();
  bindCustomerForm();
  bindPickingForm();
  bindExportButtons();
  resetBookingForm();
  resetInventoryForm();
  resetLocationForm();
  resetCustomerForm();
  resetPickingForm();
  await initializeData();
})();

