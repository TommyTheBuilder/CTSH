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

let ME = null;
let PERMS = {};
let DEPARTMENTS = [];
let OPEN_PALLET_ITEMS = [];

const socket = io();

function statusLabel(status) {
  return OPEN_PALLET_STATUS_LABELS[status] || status || "-";
}

function departmentNameById(departmentId) {
  return DEPARTMENTS.find((department) => Number(department.id) === Number(departmentId))?.name || null;
}

function buildScopeHint() {
  const hint = $("openPalletsScopeHint");
  const tableHint = $("openPalletsTableHint");
  if (!hint || !tableHint) return;

  const fixedDepartmentId = Number(ME?.fixed_department_id || 0) || null;
  const fixedDepartmentName = fixedDepartmentId ? departmentNameById(fixedDepartmentId) : null;
  const canViewAll = !!PERMS?.open_pallets?.view_all;

  if (canViewAll) {
    hint.textContent = "Sie sehen alle Offene-Paletten-Buchungen. Diese Buchungen bleiben weiterhin separat vom normalen Palettenbestand.";
    tableHint.textContent = fixedDepartmentName
      ? `Buchungen koennen fuer Ihre feste Abteilung ${fixedDepartmentName} angelegt werden.`
      : "Es ist kein feste Abteilung im Account hinterlegt. Ohne Abteilung kann keine neue Buchung angelegt werden.";
    return;
  }

  if (fixedDepartmentName) {
    hint.textContent = `Sie sehen ausschliesslich die Offene-Paletten-Buchungen Ihrer Abteilung ${fixedDepartmentName}. Diese Buchungen beeinflussen den normalen Bestand nicht.`;
    tableHint.textContent = "Loeschen ist nur in dieser Seite moeglich, nicht im Live Feed.";
    return;
  }

  hint.textContent = "Dem Account ist keine Abteilung zugeordnet. Ohne feste Abteilung koennen keine Offene-Paletten-Buchungen angezeigt oder angelegt werden.";
  tableHint.textContent = "Bitte eine Abteilung im Benutzerkonto hinterlegen.";
}

function resetCreateForm() {
  $("openPalletTitle").value = "";
  $("openPalletCompany").value = "";
  $("openPalletCity").value = "";
  $("openPalletPostalCode").value = "";
  $("openPalletOrderNo").value = "";
  $("openPalletCount").value = "1";
  $("openPalletStatus").value = "open";
  $("openPalletNote").value = "";
}

function applyPermissionsToUI() {
  const canView = !!PERMS?.open_pallets?.view;
  const canCreate = !!PERMS?.open_pallets?.create;
  if (!canView) {
    $("openPalletsTableWrap").innerHTML = `
      <div class="pallet-open-feed__empty">Keine Berechtigung fuer Offene Paletten.</div>
    `;
  }
  if ($("openPalletCreateCard")) {
    $("openPalletCreateCard").style.display = canCreate ? "" : "none";
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

async function loadDepartments() {
  const response = await api("/api/departments", { method: "GET", headers: {} });
  DEPARTMENTS = response.ok ? await response.json() : [];
  buildScopeHint();
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

async function loadOpenPallets() {
  if (!PERMS?.open_pallets?.view) return;

  const params = new URLSearchParams();
  const filters = currentFilters();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  const response = await api(`/api/modules/pallets/open-pallets?${params.toString()}`, { method: "GET", headers: {} });
  if (!response.ok) {
    const data = await readJsonSafe(response);
    $("openPalletsTableWrap").innerHTML = `
      <div class="pallet-open-feed__empty">Fehler: ${escapeHtml(data?.error || "Buchungen konnten nicht geladen werden.")}</div>
    `;
    return;
  }

  const data = await response.json();
  OPEN_PALLET_ITEMS = Array.isArray(data?.items) ? data.items : [];
  renderOpenPallets();
}

function renderOpenPallets() {
  const wrap = $("openPalletsTableWrap");
  if (!wrap) return;

  if (OPEN_PALLET_ITEMS.length === 0) {
    wrap.innerHTML = `<div class="pallet-open-feed__empty">Keine Buchungen gefunden.</div>`;
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
          <th>Notiz</th>
          <th>Abteilung</th>
          <th>Aktualisiert</th>
          <th>Aktion</th>
        </tr>
      </thead>
      <tbody>
        ${OPEN_PALLET_ITEMS.map((item) => `
          <tr>
            <td><strong>${escapeHtml(item.title || "-")}</strong></td>
            <td>${escapeHtml(item.company || "-")}</td>
            <td>${escapeHtml(item.city || "-")}</td>
            <td>${escapeHtml(item.postal_code || "-")}</td>
            <td>${escapeHtml(item.order_no || "-")}</td>
            <td>${escapeHtml(item.pallet_count)}</td>
            <td class="pallet-open-table__status">
              ${PERMS?.open_pallets?.edit ? `
                <select data-status-id="${item.id}">
                  ${Object.entries(OPEN_PALLET_STATUS_LABELS).map(([value, label]) => `
                    <option value="${escapeHtml(value)}" ${item.status === value ? "selected" : ""}>${escapeHtml(label)}</option>
                  `).join("")}
                </select>
              ` : `
                <span class="pallet-status-badge pallet-status-badge--${escapeHtml(item.status || "open")}">${escapeHtml(statusLabel(item.status))}</span>
              `}
            </td>
            <td>${escapeHtml(item.note || "-")}</td>
            <td>${escapeHtml(item.department_name || "-")}</td>
            <td>
              ${escapeHtml(formatDateTime(item.updated_at))}
              <div class="muted">von ${escapeHtml(item.updated_by_name || item.created_by_name || "-")}</div>
            </td>
            <td>
              <div class="pallet-open-table__actions">
                ${PERMS?.open_pallets?.delete ? `<button class="danger" data-delete-id="${item.id}" type="button">Loeschen</button>` : "-"}
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  document.querySelectorAll("[data-status-id]").forEach((select) => {
    select.addEventListener("change", async () => {
      const bookingId = Number(select.getAttribute("data-status-id") || 0);
      const status = select.value;
      const response = await api(`/api/modules/pallets/open-pallets/${bookingId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        alert(data?.error || "Status konnte nicht gespeichert werden.");
        await loadOpenPallets();
        return;
      }
      await loadOpenPallets();
    });
  });

  document.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const bookingId = Number(button.getAttribute("data-delete-id") || 0);
      if (!bookingId) return;
      const confirmed = confirm("Buchung wirklich loeschen?");
      if (!confirmed) return;

      const response = await api(`/api/modules/pallets/open-pallets/${bookingId}`, {
        method: "DELETE"
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        alert(data?.error || "Buchung konnte nicht geloescht werden.");
        return;
      }
      await loadOpenPallets();
    });
  });
}

async function createOpenPalletBooking() {
  setMsg("openPalletCreateMsg", "");
  const response = await api("/api/modules/pallets/open-pallets", {
    method: "POST",
    body: JSON.stringify({
      title: $("openPalletTitle").value.trim(),
      company: $("openPalletCompany").value.trim(),
      city: $("openPalletCity").value.trim(),
      postal_code: $("openPalletPostalCode").value.trim(),
      order_no: $("openPalletOrderNo").value.trim(),
      pallet_count: Number($("openPalletCount").value || 0),
      status: $("openPalletStatus").value,
      note: $("openPalletNote").value.trim()
    })
  });

  const data = await readJsonSafe(response);
  if (!response.ok) {
    setMsg("openPalletCreateMsg", data?.error || "Buchung konnte nicht gespeichert werden.");
    return;
  }

  setMsg("openPalletCreateMsg", `Buchung #${data?.id || ""} wurde gespeichert.`, true);
  resetCreateForm();
  await loadOpenPallets();
}

function bindEvents() {
  $("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  });

  $("backToPalletsBtn").addEventListener("click", () => {
    window.location.href = "/modules/pallets/index.html";
  });

  $("createOpenPalletBtn")?.addEventListener("click", createOpenPalletBooking);
  $("reloadOpenPalletsBtn").addEventListener("click", loadOpenPallets);
  $("resetOpenPalletFiltersBtn").addEventListener("click", async () => {
    $("filterTitle").value = "";
    $("filterCompany").value = "";
    $("filterCity").value = "";
    $("filterPostalCode").value = "";
    $("filterOrderNo").value = "";
    $("filterStatus").value = "";
    await loadOpenPallets();
  });

  ["filterTitle", "filterCompany", "filterCity", "filterPostalCode", "filterOrderNo"].forEach((id) => {
    $(id).addEventListener("input", () => {
      clearTimeout(window.__openPalletFilterTimer);
      window.__openPalletFilterTimer = setTimeout(() => {
        loadOpenPallets();
      }, 250);
    });
  });

  $("filterStatus").addEventListener("change", loadOpenPallets);

  socket.on("openPalletBookingsUpdated", async (payload) => {
    if (payload?.app_customer_id && Number(payload.app_customer_id) !== Number(ME?.app_customer_id || 0)) return;
    await loadOpenPallets();
  });
}

(async function init() {
  bindEvents();
  await loadMe();
  await loadPerms();
  await loadDepartments();
  buildScopeHint();
  await loadOpenPallets();
})();
