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
  const date = new Date(`${value}T00:00:00`);
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
const PALLET_ASSET_VERSION = "20260316-5";

let ME = null;
let PERMS = {};
let OPEN_PALLET_ITEMS = [];
let OPEN_PALLET_PAGE = 0;
let OPEN_PALLET_HAS_MORE = false;
let OPEN_PALLET_TRUCK_MODAL_CONTEXT = null;

const socket = io();

function statusLabel(status) {
  return OPEN_PALLET_STATUS_LABELS[status] || status || "-";
}

function urgencyLabel(level) {
  return OPEN_PALLET_URGENCY_LABELS[level] || OPEN_PALLET_URGENCY_LABELS.medium;
}

function getTruckInfoText(item) {
  const parts = [];
  if (item?.truck_license_plate) parts.push(`Kennzeichen: ${item.truck_license_plate}`);
  if (item?.truck_planned_for) parts.push(`Datum: ${formatDate(item.truck_planned_for)}`);
  return parts.join(" | ");
}

function showOpenPalletModal(show) {
  const back = $("openPalletModalBack");
  if (!back) return;
  back.style.display = show ? "flex" : "none";
  back.setAttribute("aria-hidden", show ? "false" : "true");
  if (show) {
    window.requestAnimationFrame(() => $("openPalletTitle")?.focus());
  }
}

function openTruckPlanningModal(context) {
  OPEN_PALLET_TRUCK_MODAL_CONTEXT = context;
  $("truckPlanningPlate").value = context?.truckLicensePlate || "";
  $("truckPlanningDate").value = context?.truckPlannedFor || "";
  setMsg("truckPlanningModalMsg", "");

  const back = $("truckPlanningModalBack");
  if (!back) return;
  back.style.display = "flex";
  back.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => $("truckPlanningPlate")?.focus());
}

function closeTruckPlanningModal({ restoreStatus = false } = {}) {
  if (restoreStatus && OPEN_PALLET_TRUCK_MODAL_CONTEXT?.selectEl) {
    OPEN_PALLET_TRUCK_MODAL_CONTEXT.selectEl.value = OPEN_PALLET_TRUCK_MODAL_CONTEXT.previousStatus;
  }

  const back = $("truckPlanningModalBack");
  if (back) {
    back.style.display = "none";
    back.setAttribute("aria-hidden", "true");
  }
  setMsg("truckPlanningModalMsg", "");
  OPEN_PALLET_TRUCK_MODAL_CONTEXT = null;
}

function resetCreateForm() {
  $("openPalletTitle").value = "";
  $("openPalletCompany").value = "";
  $("openPalletCity").value = "";
  $("openPalletPostalCode").value = "";
  $("openPalletOrderNo").value = "";
  $("openPalletCount").value = "1";
  $("openPalletUrgency").value = "medium";
  $("openPalletNote").value = "";
  setMsg("openPalletCreateMsg", "");
}

function updatePaginationUi() {
  const prevBtn = $("openPalletPrevBtn");
  const nextBtn = $("openPalletNextBtn");
  if (prevBtn) prevBtn.disabled = OPEN_PALLET_PAGE === 0;
  if (nextBtn) nextBtn.disabled = !OPEN_PALLET_HAS_MORE;
}

function applyPermissionsToUI() {
  const canView = !!PERMS?.open_pallets?.view;
  const canCreate = !!PERMS?.open_pallets?.create;

  if (!canView) {
    $("openPalletsTableWrap").innerHTML = `
      <div class="pallet-open-feed__empty">Keine Berechtigung f&uuml;r Offene Paletten.</div>
    `;
  }

  if ($("openCreateBookingModalBtn")) {
    $("openCreateBookingModalBtn").style.display = canCreate ? "" : "none";
  }
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

function currentFilters() {
  return {
    title: $("filterTitle").value.trim(),
    company: $("filterCompany").value.trim(),
    city: $("filterCity").value.trim(),
    postal_code: $("filterPostalCode").value.trim(),
    order_no: $("filterOrderNo").value.trim(),
    status: $("filterStatus").value
  };
}

async function loadOpenPallets({ resetPage = false } = {}) {
  if (!PERMS?.open_pallets?.view) return;
  if (resetPage) OPEN_PALLET_PAGE = 0;

  const params = new URLSearchParams({
    limit: String(OPEN_PALLET_PAGE_SIZE),
    offset: String(OPEN_PALLET_PAGE * OPEN_PALLET_PAGE_SIZE)
  });

  const filters = currentFilters();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  const response = await api(`/api/modules/pallets/open-pallets?${params.toString()}`, { method: "GET", headers: {} });
  if (!response.ok) {
    const data = await readJsonSafe(response);
    $("openPalletsTableWrap").innerHTML = `
      <div class="pallet-open-feed__empty">${escapeHtml(data?.error || "Buchungen konnten nicht geladen werden.")}</div>
    `;
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

function renderStatusControl(item) {
  const statusControl = PERMS?.open_pallets?.edit
    ? `
        <select data-status-id="${item.id}">
          ${Object.entries(OPEN_PALLET_STATUS_LABELS).map(([value, label]) => `
            <option value="${escapeHtml(value)}" ${item.status === value ? "selected" : ""}>${escapeHtml(label)}</option>
          `).join("")}
        </select>
      `
    : `
        <span class="pallet-status-badge pallet-status-badge--${escapeHtml(item.status || "open")}">${escapeHtml(statusLabel(item.status))}</span>
      `;

  const truckInfo = getTruckInfoText(item);
  return `
    ${statusControl}
    ${truckInfo ? `<div class="pallet-open-table__submeta">${escapeHtml(truckInfo)}</div>` : ""}
  `;
}

function renderUrgencyControl(item) {
  const isCreator = Number(item.created_by || 0) === Number(ME?.id || 0);
  if (isCreator) {
    return `
      <select data-urgency-id="${item.id}">
        ${Object.entries(OPEN_PALLET_URGENCY_LABELS).map(([value, label]) => `
          <option value="${escapeHtml(value)}" ${item.urgency_level === value ? "selected" : ""}>${escapeHtml(label)}</option>
        `).join("")}
      </select>
    `;
  }

  return `
    <span class="pallet-urgency-badge pallet-urgency-badge--${escapeHtml(item.urgency_level || "medium")}">
      ${escapeHtml(urgencyLabel(item.urgency_level))}
    </span>
  `;
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
          <th>Firma</th>
          <th>Ort</th>
          <th>PLZ</th>
          <th>Auftragsnummer</th>
          <th>Paletten</th>
          <th>Status</th>
          <th>Dringlichkeit</th>
          <th>Notiz</th>
          <th>Abteilung</th>
          <th>Aktualisiert</th>
          <th>Aktion</th>
        </tr>
      </thead>
      <tbody>
        ${OPEN_PALLET_ITEMS.map((item) => `
          <tr class="pallet-open-table__row pallet-open-table__row--urgency-${escapeHtml(item.urgency_level || "medium")}">
            <td><strong>${escapeHtml(item.title || "-")}</strong></td>
            <td>${escapeHtml(item.company || "-")}</td>
            <td>${escapeHtml(item.city || "-")}</td>
            <td>${escapeHtml(item.postal_code || "-")}</td>
            <td>${escapeHtml(item.order_no || "-")}</td>
            <td>${escapeHtml(item.pallet_count)}</td>
            <td class="pallet-open-table__status">${renderStatusControl(item)}</td>
            <td class="pallet-open-table__urgency">${renderUrgencyControl(item)}</td>
            <td>${escapeHtml(item.note || "-")}</td>
            <td>${escapeHtml(item.department_name || "-")}</td>
            <td>
              ${escapeHtml(formatDateTime(item.updated_at))}
              <div class="muted">von ${escapeHtml(item.updated_by_name || item.created_by_name || "-")}</div>
            </td>
            <td>
              <div class="pallet-open-table__actions">
                ${PERMS?.open_pallets?.delete ? `<button class="danger" data-delete-id="${item.id}" type="button">L&ouml;schen</button>` : "-"}
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  updatePaginationUi();

  document.querySelectorAll("[data-status-id]").forEach((select) => {
    select.addEventListener("change", async () => {
      const bookingId = Number(select.getAttribute("data-status-id") || 0);
      const nextStatus = select.value;
      const item = OPEN_PALLET_ITEMS.find((entry) => Number(entry.id) === bookingId);
      const previousStatus = item?.status || "open";
      if (!bookingId || nextStatus === previousStatus) return;

      if (nextStatus === "truck_planned") {
        openTruckPlanningModal({
          bookingId,
          previousStatus,
          selectEl: select,
          truckLicensePlate: item?.truck_license_plate || "",
          truckPlannedFor: item?.truck_planned_for ? String(item.truck_planned_for).slice(0, 10) : ""
        });
        return;
      }

      select.disabled = true;
      try {
        const response = await api(`/api/modules/pallets/open-pallets/${bookingId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus })
        });
        const data = await readJsonSafe(response);
        if (!response.ok) {
          alert(data?.error || "Status konnte nicht gespeichert werden.");
          select.value = previousStatus;
          return;
        }
        await loadOpenPallets();
      } finally {
        select.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-urgency-id]").forEach((select) => {
    select.addEventListener("change", async () => {
      const bookingId = Number(select.getAttribute("data-urgency-id") || 0);
      const item = OPEN_PALLET_ITEMS.find((entry) => Number(entry.id) === bookingId);
      const previousUrgency = item?.urgency_level || "medium";
      const nextUrgency = select.value;
      if (!bookingId || nextUrgency === previousUrgency) return;

      select.disabled = true;
      try {
        const response = await api(`/api/modules/pallets/open-pallets/${bookingId}`, {
          method: "PATCH",
          body: JSON.stringify({ urgency_level: nextUrgency })
        });
        const data = await readJsonSafe(response);
        if (!response.ok) {
          alert(data?.error || "Dringlichkeit konnte nicht gespeichert werden.");
          select.value = previousUrgency;
          return;
        }
        await loadOpenPallets();
      } finally {
        select.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const bookingId = Number(button.getAttribute("data-delete-id") || 0);
      if (!bookingId) return;
      if (!confirm("Buchung wirklich l\u00f6schen?")) return;

      const response = await api(`/api/modules/pallets/open-pallets/${bookingId}`, {
        method: "DELETE"
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        alert(data?.error || "Buchung konnte nicht gel\u00f6scht werden.");
        return;
      }
      await loadOpenPallets();
    });
  });
}

async function createOpenPalletBooking() {
  setMsg("openPalletCreateMsg", "");
  const button = $("createOpenPalletBtn");
  if (button) button.disabled = true;

  try {
    const response = await api("/api/modules/pallets/open-pallets", {
      method: "POST",
      body: JSON.stringify({
        title: $("openPalletTitle").value.trim(),
        company: $("openPalletCompany").value.trim(),
        city: $("openPalletCity").value.trim(),
        postal_code: $("openPalletPostalCode").value.trim(),
        order_no: $("openPalletOrderNo").value.trim(),
        pallet_count: Number($("openPalletCount").value || 0),
        urgency_level: $("openPalletUrgency").value,
        note: $("openPalletNote").value.trim()
      })
    });

    const data = await readJsonSafe(response);
    if (!response.ok) {
      setMsg("openPalletCreateMsg", data?.error || "Buchung konnte nicht gespeichert werden.");
      return;
    }

    resetCreateForm();
    showOpenPalletModal(false);
    await loadOpenPallets({ resetPage: true });
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveTruckPlanning() {
  const context = OPEN_PALLET_TRUCK_MODAL_CONTEXT;
  if (!context?.bookingId) return;

  const plate = $("truckPlanningPlate").value.trim();
  const date = $("truckPlanningDate").value;
  if (!plate || !date) {
    setMsg("truckPlanningModalMsg", "Kennzeichen und Datum sind Pflicht.");
    return;
  }

  const saveBtn = $("saveTruckPlanningBtn");
  if (saveBtn) saveBtn.disabled = true;
  setMsg("truckPlanningModalMsg", "");

  try {
    const response = await api(`/api/modules/pallets/open-pallets/${context.bookingId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "truck_planned",
        truck_license_plate: plate,
        truck_planned_for: date
      })
    });
    const data = await readJsonSafe(response);
    if (!response.ok) {
      setMsg("truckPlanningModalMsg", data?.error || "LKW-Daten konnten nicht gespeichert werden.");
      return;
    }

    closeTruckPlanningModal();
    await loadOpenPallets();
  } finally {
    if (saveBtn) saveBtn.disabled = false;
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

  $("openCreateBookingModalBtn")?.addEventListener("click", () => {
    resetCreateForm();
    showOpenPalletModal(true);
  });

  $("closeOpenPalletModalBtn")?.addEventListener("click", () => showOpenPalletModal(false));
  $("cancelOpenPalletModalBtn")?.addEventListener("click", () => showOpenPalletModal(false));
  $("openPalletModalBack")?.addEventListener("click", (event) => {
    if (event.target === $("openPalletModalBack")) showOpenPalletModal(false);
  });

  $("closeTruckPlanningModalBtn")?.addEventListener("click", () => closeTruckPlanningModal({ restoreStatus: true }));
  $("cancelTruckPlanningBtn")?.addEventListener("click", () => closeTruckPlanningModal({ restoreStatus: true }));
  $("saveTruckPlanningBtn")?.addEventListener("click", saveTruckPlanning);
  $("truckPlanningModalBack")?.addEventListener("click", (event) => {
    if (event.target === $("truckPlanningModalBack")) {
      closeTruckPlanningModal({ restoreStatus: true });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if ($("truckPlanningModalBack")?.getAttribute("aria-hidden") === "false") {
      closeTruckPlanningModal({ restoreStatus: true });
      return;
    }

    if ($("openPalletModalBack")?.getAttribute("aria-hidden") === "false") {
      showOpenPalletModal(false);
    }
  });

  $("createOpenPalletBtn")?.addEventListener("click", createOpenPalletBooking);
  $("reloadOpenPalletsBtn").addEventListener("click", () => loadOpenPallets({ resetPage: true }));
  $("resetOpenPalletFiltersBtn").addEventListener("click", async () => {
    $("filterTitle").value = "";
    $("filterCompany").value = "";
    $("filterCity").value = "";
    $("filterPostalCode").value = "";
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

  ["filterTitle", "filterCompany", "filterCity", "filterPostalCode", "filterOrderNo"].forEach((id) => {
    $(id).addEventListener("input", () => {
      clearTimeout(window.__openPalletFilterTimer);
      window.__openPalletFilterTimer = setTimeout(() => {
        loadOpenPallets({ resetPage: true });
      }, 250);
    });
  });

  $("filterStatus").addEventListener("change", () => loadOpenPallets({ resetPage: true }));

  socket.on("openPalletBookingsUpdated", async (payload) => {
    if (payload?.app_customer_id && Number(payload.app_customer_id) !== Number(ME?.app_customer_id || 0)) return;
    await loadOpenPallets();
  });
}

(async function init() {
  bindEvents();
  await loadMe();
  await loadPerms();
  await loadOpenPallets({ resetPage: true });
})();
