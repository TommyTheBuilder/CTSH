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

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
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

const TITLE_LABELS = { abholung: "Abholung", rueckfuehrung: "R\u00fcckf\u00fchrung" };
const STATUS_LABELS = {
  open: "Offen",
  truck_planned: "LKW eingeplant",
  completed_waiting_document: "Erledigt - warten auf Beleg",
  document_booked_scanned: "Beleg gebucht und gescannt"
};
const URGENCY_LABELS = { low: "Niedrig", medium: "Mittel", high: "Hoch", critical: "Kritisch" };
const PALLET_ASSET_VERSION = "20260317-3";

function titleLabel(value) {
  return TITLE_LABELS[value] || value || "-";
}

function statusLabel(value) {
  return STATUS_LABELS[value] || value || "-";
}

function urgencyLabel(value) {
  return URGENCY_LABELS[value] || URGENCY_LABELS.medium;
}

function fullAddress(item) {
  const lineOne = [item?.street, item?.address_extra].filter(Boolean).join(", ");
  const lineTwo = [item?.postal_code, item?.city].filter(Boolean).join(" ");
  return [lineOne, lineTwo, item?.country].filter(Boolean).join(" | ") || "-";
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const bookingId = Number(params.get("id") || 0);
  if (!bookingId) {
    $("detailContent").innerHTML = `<div class="pallet-open-feed__empty">Keine Buchungs-ID \u00fcbergeben.</div>`;
    return;
  }

  const response = await api(`/api/modules/pallets/open-pallets/${bookingId}`, { method: "GET", headers: {} });
  const booking = await response.json().catch(() => null);
  if (!response.ok || !booking) {
    $("detailContent").innerHTML = `<div class="pallet-open-feed__empty">${escapeHtml(booking?.error || "Buchung konnte nicht geladen werden.")}</div>`;
    return;
  }

  $("detailPageTitle").textContent = `Details f\u00fcr ${booking.customer_name || booking.company || titleLabel(booking.title)}`;
  $("detailPageBadge").textContent = statusLabel(booking.status);
  $("openInModuleBtn").textContent = booking.can_edit ? "Im Modul bearbeiten" : "Im Modul \u00f6ffnen";
  $("openInModuleBtn").addEventListener("click", () => {
    window.location.href = `/modules/pallets/open-pallets.html?v=${PALLET_ASSET_VERSION}&booking=${encodeURIComponent(booking.id)}`;
  });
  $("printDetailBtn").addEventListener("click", () => window.print());
  $("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  });

  $("detailContent").innerHTML = `
    <section class="pallet-detail-layout">
      <article class="pallet-detail-main-card">
        <div class="pallet-detail-main-card__head">
          <div>
            <span class="module-section-kicker">Buchung</span>
            <h2>${escapeHtml(titleLabel(booking.title))}</h2>
          </div>
          <div class="pallet-detail-main-card__badges">
            <span class="pallet-status-badge pallet-status-badge--${escapeHtml(booking.status || "open")}">${escapeHtml(statusLabel(booking.status))}</span>
            <span class="pallet-urgency-badge pallet-urgency-badge--${escapeHtml(booking.urgency_level || "medium")}">${escapeHtml(urgencyLabel(booking.urgency_level))}</span>
          </div>
        </div>

        <div class="pallet-detail-grid">
          <div class="pallet-detail-field"><label>Kunde</label><div>${escapeHtml(booking.customer_name || booking.company || "-")}</div></div>
          <div class="pallet-detail-field"><label>Firma</label><div>${escapeHtml(booking.company || "-")}</div></div>
          <div class="pallet-detail-field"><label>Auftragsnummer</label><div>${escapeHtml(booking.order_no || "-")}</div></div>
          <div class="pallet-detail-field"><label>Paletten</label><div>${escapeHtml(booking.pallet_count)}</div></div>
          <div class="pallet-detail-field pallet-detail-field--wide"><label>Adresse</label><div>${escapeHtml(fullAddress(booking))}</div></div>
          <div class="pallet-detail-field"><label>Abteilung</label><div>${escapeHtml(booking.department_name || "-")}</div></div>
          <div class="pallet-detail-field"><label>Erstellt von</label><div>${escapeHtml(booking.created_by_name || "-")}</div></div>
          <div class="pallet-detail-field"><label>Aktualisiert von</label><div>${escapeHtml(booking.updated_by_name || "-")}</div></div>
          <div class="pallet-detail-field"><label>Aktualisiert am</label><div>${escapeHtml(formatDateTime(booking.updated_at))}</div></div>
          <div class="pallet-detail-field"><label>LKW Kennzeichen</label><div>${escapeHtml(booking.truck_license_plate || "-")}</div></div>
          <div class="pallet-detail-field"><label>Einplanung f\u00fcr</label><div>${escapeHtml(formatDate(booking.truck_planned_for))}</div></div>
          <div class="pallet-detail-field"><label>Disponent Status 2</label><div>${escapeHtml(booking.truck_planned_by_name || "-")}</div></div>
          <div class="pallet-detail-field pallet-detail-field--wide"><label>Notiz</label><div>${escapeHtml(booking.note || "-")}</div></div>
        </div>
      </article>

      <aside class="pallet-detail-side-card">
        <div class="pallet-detail-side-card__head">\u00dcbersicht</div>
        <div class="pallet-detail-side-card__body">
          <div class="pallet-detail-side-item"><span>Status</span><strong>${escapeHtml(statusLabel(booking.status))}</strong></div>
          <div class="pallet-detail-side-item"><span>Dringlichkeit</span><strong>${escapeHtml(urgencyLabel(booking.urgency_level))}</strong></div>
          <div class="pallet-detail-side-item"><span>Erstellt</span><strong>${escapeHtml(formatDateTime(booking.created_at))}</strong></div>
          <div class="pallet-detail-side-item"><span>Letztes Update</span><strong>${escapeHtml(formatDateTime(booking.updated_at))}</strong></div>
        </div>
      </aside>
    </section>
  `;
}

init();
