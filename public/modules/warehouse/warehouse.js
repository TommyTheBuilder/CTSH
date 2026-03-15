const token = localStorage.getItem("token");
if (!token) window.location.href = "/login.html";

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

function resetBookingDate() {
  if ($("bookingDate")) $("bookingDate").value = formatLocalDateTimeInput();
}

function setSidebarNote() {
  const note = $("warehouseSidebarNote");
  if (!note) return;

  const actions = [];
  if (permissionValue("warehouse.transactions.create")) actions.push("Buchungen");
  if (permissionValue("warehouse.inventory.view")) actions.push("Live-Bestand");
  if (permissionValue("warehouse.storage_locations.manage")) actions.push("Lagerplaetze");
  if (permissionValue("warehouse.customers.manage") || permissionValue("warehouse.articles.manage")) actions.push("Stammdaten");
  if (permissionValue("warehouse.picking.manage")) actions.push("Versandauftraege Buero");
  if (permissionValue("warehouse.picking.process")) actions.push("Versandauftraege Lager");
  if (permissionValue("warehouse.transactions.view")) actions.push("Historie");

  note.textContent = actions.length
    ? `Freigeschaltet: ${actions.join(", ")}.`
    : "Fuer dieses Konto sind aktuell keine Warehouse-Bereiche freigeschaltet.";
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

  setFormEnabled("locationForm", canManageLocations);
  setFormEnabled("customerForm", canManageCustomers);
  setFormEnabled("articleForm", canManageArticles);
  setFormEnabled("inventoryForm", canManageInventory);
  setFormEnabled("pickingForm", canManagePicking);

  setSidebarNote();
  ensureVisibleActiveTab();
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
      setMessage("passwordModalMsg", "Bitte alle Felder ausfuellen.");
      return;
    }
    if (newPassword.length < 8) {
      setMessage("passwordModalMsg", "Das neue Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("passwordModalMsg", "Die neuen Passwoerter stimmen nicht ueberein.");
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
        setMessage("passwordModalMsg", data?.error || "Passwort konnte nicht geaendert werden.");
        return;
      }
      setMessage("passwordModalMsg", "Passwort erfolgreich geaendert.", true);
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

  if (sourceField) sourceField.style.display = type === "IN" ? "none" : "";
  if (destinationField) destinationField.style.display = type === "OUT" ? "none" : "";

  renderBookingPreview();
}

function getBookingScannerFields() {
  const fields = [
    $("bookingBelegNr"),
    $("bookingArticleLookup")
  ];
  const type = $("bookingType")?.value || "IN";

  if (type === "OUT" || type === "TRANSFER") fields.push($("bookingSourceLookup"));
  if (type === "IN" || type === "TRANSFER") fields.push($("bookingDestinationLookup"));

  fields.push($("bookingQuantity"));

  return fields.filter((field) => field && field.offsetParent !== null && !field.disabled);
}

function bindScannerFlow() {
  ["bookingBelegNr", "bookingArticleLookup", "bookingSourceLookup", "bookingDestinationLookup", "bookingQuantity"].forEach((id) => {
    const field = $(id);
    if (!field) return;
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const fields = getBookingScannerFields();
      const index = fields.indexOf(field);
      const next = fields[index + 1];
      if (next) {
        next.focus();
        if (typeof next.select === "function") next.select();
      } else {
        $("bookingForm")?.requestSubmit();
      }
    });
  });
}

function renderBookingPreview() {
  const type = $("bookingType")?.value || "-";
  const article = $("bookingArticleLookup")?.value || "-";
  const quantity = $("bookingQuantity")?.value || "-";
  const source = $("bookingSourceLookup")?.value || "-";
  const destination = $("bookingDestinationLookup")?.value || "-";
  const locationText = type === "IN"
    ? destination
    : type === "OUT"
      ? source
      : `${source} -> ${destination}`;

  const preview = $("bookingPreview");
  if (!preview) return;
  preview.innerHTML = `
    <div class="warehouse-preview__row"><span>Typ</span><strong>${escapeHtml(type)}</strong></div>
    <div class="warehouse-preview__row"><span>Artikel</span><strong>${escapeHtml(article)}</strong></div>
    <div class="warehouse-preview__row"><span>Lagerplatz</span><strong>${escapeHtml(locationText || "-")}</strong></div>
    <div class="warehouse-preview__row"><span>Menge</span><strong>${escapeHtml(quantity)}</strong></div>
  `;
}

function resetBookingForm() {
  $("bookingForm")?.reset();
  if ($("bookingType")) $("bookingType").value = "IN";
  resetBookingDate();
  updateBookingVisibility();
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
  $("dashboardInventoryQuantityMeta").textContent = `${summary.inventory_quantity_total || 0} Stueck insgesamt`;
  updateQuickStats(summary);

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
              Beleg: ${escapeHtml(row.beleg_nr || "-")} | Menge: ${escapeHtml(row.menge)} | Kunde: ${escapeHtml(row.customer_name || "-")}
            </div>
            <div class="warehouse-list-item__foot">
              ${escapeHtml(row.storage_location_from_name || "-")} -> ${escapeHtml(row.storage_location_to_name || "-")}
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
      : `<div class="warehouse-empty">Keine offenen Versandauftraege vorhanden.</div>`;
  }
}

function renderLocations() {
  const search = normalizeLookupValue($("locationSearch")?.value || "");
  const rows = state.refs.locations.filter((location) => {
    if (!search) return true;
    return normalizeLookupValue(location.name).includes(search) || normalizeLookupValue(location.typ).includes(search);
  });

  const host = $("locationsTableWrap");
  if (!host) return;

  host.innerHTML = rows.length
    ? `
      <table class="warehouse-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Typ</th>
            <th>Kapazitaet</th>
            <th>Belegte Positionen</th>
            <th>Belegte Menge</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((location) => `
            <tr data-location-id="${location.id}">
              <td>${escapeHtml(location.name)}</td>
              <td>${escapeHtml(location.typ)}</td>
              <td>${escapeHtml(location.kapazitaet)}</td>
              <td>${escapeHtml(location.belegte_positionen || 0)}</td>
              <td>${escapeHtml(location.belegte_menge || 0)}</td>
              <td>
                <div class="warehouse-table__actions">
                  ${permissionValue("warehouse.storage_locations.manage") ? `<button class="secondary" type="button" data-location-edit="${location.id}">Bearbeiten</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : `<div class="warehouse-empty">Keine Lagerplaetze gefunden.</div>`;

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
            <th>Typ</th>
            <th>Artikelnummer</th>
            <th>Artikel</th>
            <th>Menge</th>
            <th>Aktualisiert</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${state.inventory.map((row) => `
            <tr>
              <td>${escapeHtml(row.storage_location_name)}</td>
              <td>${escapeHtml(row.storage_location_type)}</td>
              <td>${escapeHtml(row.artikel_nr)}</td>
              <td>${escapeHtml(row.bezeichnung)}</td>
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
      $("inventoryArticleLookup").value = articleLabel({
        id: row.article_id,
        artikel_nr: row.artikel_nr,
        bezeichnung: row.bezeichnung
      });
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
            <th>Menge</th>
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
              <td>${escapeHtml(row.menge)}</td>
              <td>${escapeHtml(row.storage_location_from_name || "-")}</td>
              <td>${escapeHtml(row.storage_location_to_name || "-")}</td>
              <td>${escapeHtml(row.username || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : `<div class="warehouse-empty">Keine Transaktionen fuer den aktuellen Filter gefunden.</div>`;
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
        <input type="text" data-item-field="article" value="${escapeHtml(item.articleLookup || "")}" list="warehouseArticleLookupList" placeholder="Artikel waehlen" autocomplete="off" />
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
            <th>Faellig</th>
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
    : `<div class="warehouse-empty">Keine Versandauftraege gefunden.</div>`;

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
                ${escapeHtml(order.customer_name || "-")} | Faellig: ${escapeHtml(order.faellig_am ? formatDate(order.faellig_am) : "ohne Termin")}
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
    : `<div class="warehouse-empty">Keine offenen Versandauftraege vorhanden.</div>`;

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
  if (!response.ok) throw new Error(data?.error || "Lagerplaetze konnten nicht geladen werden.");
  state.refs.locations = Array.isArray(data) ? data : [];
  updateLookupLists();
  renderLocations();
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
  if (!response.ok) throw new Error(data?.error || "Versandauftraege konnten nicht geladen werden.");

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

function bindBookingForm() {
  $("bookingType")?.addEventListener("change", updateBookingVisibility);
  ["bookingType", "bookingArticleLookup", "bookingSourceLookup", "bookingDestinationLookup", "bookingQuantity"].forEach((id) => {
    $(id)?.addEventListener("input", renderBookingPreview);
  });
  bindScannerFlow();
  resetBookingDate();
  updateBookingVisibility();

  $("bookingResetBtn")?.addEventListener("click", resetBookingForm);
  $("bookingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage("bookingMsg");

    const article = resolveArticle($("bookingArticleLookup").value);
    const customer = resolveCustomer($("bookingCustomerLookup").value);
    const source = resolveLocation($("bookingSourceLookup").value);
    const destination = resolveLocation($("bookingDestinationLookup").value);
    const payload = {
      typ: $("bookingType").value,
      article_id: article?.id,
      menge: Number($("bookingQuantity").value || 0),
      storage_location_from_id: source?.id || null,
      storage_location_to_id: destination?.id || null,
      customer_id: customer?.id || null,
      beleg_nr: $("bookingBelegNr").value.trim() || null,
      positions_nr: $("bookingPositionsNr").value.trim() || null,
      datum: $("bookingDate").value ? new Date($("bookingDate").value).toISOString() : null,
      notiz: $("bookingNote").value.trim() || null
    };

    if (!article) {
      setMessage("bookingMsg", "Bitte einen gueltigen Artikel auswaehlen.");
      return;
    }
    if (!Number.isInteger(payload.menge) || payload.menge <= 0) {
      setMessage("bookingMsg", "Bitte eine gueltige Menge eingeben.");
      return;
    }
    if (payload.typ === "IN" && !destination) {
      setMessage("bookingMsg", "Bitte einen gueltigen Ziel-Lagerplatz auswaehlen.");
      return;
    }
    if (payload.typ === "OUT" && !source) {
      setMessage("bookingMsg", "Bitte einen gueltigen Quell-Lagerplatz auswaehlen.");
      return;
    }
    if (payload.typ === "TRANSFER" && (!source || !destination)) {
      setMessage("bookingMsg", "Bitte Quelle und Ziel fuer die Umlagerung angeben.");
      return;
    }

    try {
      const response = await api("/api/warehouse/transactions", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("bookingMsg", data?.error || "Buchung konnte nicht gespeichert werden.");
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
      setMessage("bookingMsg", error.message || "Buchung konnte nicht gespeichert werden.");
    }
  });
}

function bindInventoryForm() {
  $("inventoryResetBtn")?.addEventListener("click", resetInventoryForm);
  $("inventoryDeleteBtn")?.addEventListener("click", async () => {
    if (!state.selected.inventoryId) {
      setMessage("inventoryMsg", "Bitte zuerst einen Bestandsdatensatz auswaehlen.");
      return;
    }
    if (!window.confirm("Diesen Bestandsdatensatz wirklich loeschen?")) return;
    try {
      const response = await api(`/api/warehouse/inventory/${state.selected.inventoryId}`, {
        method: "DELETE",
        headers: {}
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("inventoryMsg", data?.error || "Bestandsdatensatz konnte nicht geloescht werden.");
        return;
      }
      setMessage("inventoryMsg", "Bestandsdatensatz wurde geloescht.", true);
      resetInventoryForm();
      await Promise.all([loadInventory(), loadArticles(), loadLocations(), loadDashboard()]);
    } catch (error) {
      setMessage("inventoryMsg", error.message || "Bestandsdatensatz konnte nicht geloescht werden.");
    }
  });

  $("inventoryForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage("inventoryMsg");
    const location = resolveLocation($("inventoryLocationLookup").value);
    const article = resolveArticle($("inventoryArticleLookup").value);
    const menge = Number($("inventoryQuantity").value || 0);

    if (!location || !article || !Number.isInteger(menge) || menge <= 0) {
      setMessage("inventoryMsg", "Bitte Lagerplatz, Artikel und Menge korrekt angeben.");
      return;
    }

    const payload = {
      storage_location_id: location.id,
      article_id: article.id,
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
      setMessage("inventoryMsg", `Bestandsdatensatz fuer ${data?.artikel_nr || article.artikel_nr} wurde gespeichert.`, true);
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
      setMessage("locationMsg", "Bitte zuerst einen Lagerplatz auswaehlen.");
      return;
    }
    if (!window.confirm("Diesen Lagerplatz wirklich loeschen?")) return;
    try {
      const response = await api(`/api/warehouse/storage-locations/${state.selected.locationId}`, {
        method: "DELETE",
        headers: {}
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("locationMsg", data?.error || "Lagerplatz konnte nicht geloescht werden.");
        return;
      }
      setMessage("locationMsg", "Lagerplatz wurde geloescht.", true);
      resetLocationForm();
      await Promise.all([loadLocations(), loadInventory(), loadDashboard()]);
    } catch (error) {
      setMessage("locationMsg", error.message || "Lagerplatz konnte nicht geloescht werden.");
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
      setMessage("locationMsg", "Bitte Typ, Name und Kapazitaet korrekt eingeben.");
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
      setMessage("customerMsg", "Bitte zuerst einen Kunden auswaehlen.");
      return;
    }
    if (!window.confirm("Diesen Kunden wirklich loeschen?")) return;
    try {
      const response = await api(`/api/warehouse/customers/${state.selected.customerId}`, {
        method: "DELETE",
        headers: {}
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("customerMsg", data?.error || "Kunde konnte nicht geloescht werden.");
        return;
      }
      setMessage("customerMsg", "Kunde wurde geloescht.", true);
      resetCustomerForm();
      await Promise.all([loadCustomers(), loadPickingOrders(), loadDashboard()]);
    } catch (error) {
      setMessage("customerMsg", error.message || "Kunde konnte nicht geloescht werden.");
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
      setMessage("articleMsg", "Bitte zuerst einen Artikel auswaehlen.");
      return;
    }
    if (!window.confirm("Diesen Artikel wirklich loeschen?")) return;
    try {
      const response = await api(`/api/warehouse/articles/${state.selected.articleId}`, {
        method: "DELETE",
        headers: {}
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("articleMsg", data?.error || "Artikel konnte nicht geloescht werden.");
        return;
      }
      setMessage("articleMsg", "Artikel wurde geloescht.", true);
      resetArticleForm();
      await Promise.all([loadArticles(), loadInventory(), loadPickingOrders(), loadDashboard()]);
    } catch (error) {
      setMessage("articleMsg", error.message || "Artikel konnte nicht geloescht werden.");
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
      setMessage("pickingMsg", "Bitte zuerst einen Versandauftrag auswaehlen.");
      return;
    }
    if (!window.confirm("Diesen Versandauftrag wirklich loeschen?")) return;
    try {
      const response = await api(`/api/warehouse/picking-orders/${state.selected.pickingId}`, {
        method: "DELETE",
        headers: {}
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        setMessage("pickingMsg", data?.error || "Versandauftrag konnte nicht geloescht werden.");
        return;
      }
      setMessage("pickingMsg", "Versandauftrag wurde geloescht.", true);
      resetPickingForm();
      await Promise.all([loadPickingOrders(), loadDashboard()]);
    } catch (error) {
      setMessage("pickingMsg", error.message || "Versandauftrag konnte nicht geloescht werden.");
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
      setMessage("pickingMsg", "Bitte einen gueltigen Kunden auswaehlen.");
      return;
    }
    if (!$("pickingBelegNr").value.trim()) {
      setMessage("pickingMsg", "Bitte eine Belegnummer angeben.");
      return;
    }
    if (!items.length || items.some((item) => !item.article_id || item.menge_soll <= 0 || item.menge_ist < 0)) {
      setMessage("pickingMsg", "Bitte alle Positionen vollstaendig ausfuellen.");
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
