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
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

const TITLE_LABELS = {
  abholung: "Abholung",
  rueckfuehrung: "R\u00fcckf\u00fchrung",
  firma_zu_firma: "Firma zu Firma"
};

const STATUS_LABELS = {
  open: "Offen",
  truck_planned: "LKW eingeplant",
  completed_waiting_document: "Erledigt - warten auf Beleg",
  document_booked_scanned: "Beleg gebucht und gescannt"
};

const URGENCY_LABELS = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch"
};

const PALLET_ASSET_VERSION = "20260317-9";
const PDF_LANGUAGE_STORAGE_KEY = "openPalletPdfLanguage";

function titleLabel(value) {
  return TITLE_LABELS[value] || value || "-";
}

function statusLabel(value) {
  return STATUS_LABELS[value] || value || "-";
}

function urgencyLabel(value) {
  return URGENCY_LABELS[value] || URGENCY_LABELS.medium;
}

function isTransferTitle(value) {
  return String(value || "") === "firma_zu_firma";
}

function joinTextParts(parts, separator = ", ") {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(separator);
}

function streetLine(street, addressExtra) {
  return joinTextParts([street, addressExtra]) || "-";
}

function postalCityLine(postalCode, city, country) {
  const locality = joinTextParts([postalCode, city], " ");
  const countryCode = String(country ?? "").trim();
  if (countryCode && locality) return `${countryCode}-${locality}`;
  return locality || countryCode || "-";
}

function extractFilename(response, fallback) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

function typeHeroIcon(title) {
  switch (title) {
    case "rueckfuehrung":
      return `
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <path d="M48 18H22l8-8" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M22 18l8 8" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="14" y="38" width="36" height="10" rx="3" fill="currentColor" opacity=".88"/>
          <rect x="24" y="30" width="16" height="8" rx="2" fill="currentColor" opacity=".55"/>
        </svg>
      `;
    case "firma_zu_firma":
      return `
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <rect x="10" y="22" width="16" height="28" rx="2" fill="currentColor" opacity=".75"/>
          <rect x="38" y="18" width="16" height="32" rx="2" fill="currentColor" opacity=".95"/>
          <path d="M24 34h16" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
          <path d="M34 26l8 8-8 8" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
    default:
      return `
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <path d="M16 18h26" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
          <path d="M34 10l8 8-8 8" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="14" y="38" width="36" height="10" rx="3" fill="currentColor" opacity=".88"/>
          <rect x="24" y="30" width="16" height="8" rx="2" fill="currentColor" opacity=".55"/>
        </svg>
      `;
  }
}

function addressCardIcon(kind) {
  if (kind === "destination") {
    return `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect x="18" y="16" width="26" height="34" rx="3" fill="currentColor" opacity=".9"/>
        <path d="M10 32h18" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
        <path d="M22 24l8 8-8 8" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M16 18h26" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
      <path d="M34 10l8 8-8 8" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="14" y="38" width="36" height="10" rx="3" fill="currentColor" opacity=".88"/>
    </svg>
  `;
}

function detailAddressCards(booking) {
  const cards = [
    {
      kind: "pickup",
      title: isTransferTitle(booking.title) ? "Startadresse" : titleLabel(booking.title),
      customer: booking.customer_name || booking.company || "-",
      company: booking.company || "-",
      street: streetLine(booking.street, booking.address_extra),
      postalCity: postalCityLine(booking.postal_code, booking.city, booking.country),
      referenceLabel: isTransferTitle(booking.title) ? "Referenz Start" : "Referenz",
      reference: booking.reference_no || "-"
    }
  ];

  if (isTransferTitle(booking.title)) {
    cards.push({
      kind: "destination",
      title: "Zieladresse",
      customer: booking.destination_customer_name || booking.destination_company || "-",
      company: booking.destination_company || "-",
      street: streetLine(booking.destination_street, booking.destination_address_extra),
      postalCity: postalCityLine(booking.destination_postal_code, booking.destination_city, booking.destination_country),
      referenceLabel: "Referenz Ziel",
      reference: booking.destination_reference_no || "-"
    });
  }

  return cards;
}

function getSelectedPdfLanguage() {
  const selected = $("pdfLanguageSelect")?.value || "";
  if (["de", "en", "hr", "ru"].includes(selected)) {
    return selected;
  }
  return "de";
}

function initializePdfLanguageSelect() {
  const select = $("pdfLanguageSelect");
  if (!select) return;

  const stored = localStorage.getItem(PDF_LANGUAGE_STORAGE_KEY) || "de";
  select.value = ["de", "en", "hr", "ru"].includes(stored) ? stored : "de";
  select.addEventListener("change", () => {
    localStorage.setItem(PDF_LANGUAGE_STORAGE_KEY, getSelectedPdfLanguage());
  });
}

function downloadPdf(bookingId) {
  const language = getSelectedPdfLanguage();
  localStorage.setItem(PDF_LANGUAGE_STORAGE_KEY, language);
  const url = `/modules/pallets/open-pallet-print.html?v=${PALLET_ASSET_VERSION}&id=${encodeURIComponent(bookingId)}&lang=${encodeURIComponent(language)}&autoprint=1`;
  const tab = window.open(url, "_blank");
  if (!tab) {
    window.location.href = url;
  }
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
  initializePdfLanguageSelect();
  $("openInModuleBtn").textContent = booking.can_edit ? "Im Modul bearbeiten" : "Im Modul \u00f6ffnen";
  $("openInModuleBtn").addEventListener("click", () => {
    window.location.href = `/modules/pallets/open-pallets.html?v=${PALLET_ASSET_VERSION}&booking=${encodeURIComponent(booking.id)}`;
  });
  $("downloadPdfBtn").addEventListener("click", () => downloadPdf(booking.id));
  $("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  });

  $("detailContent").innerHTML = `
    <section class="pallet-detail-layout">
      <div class="pallet-detail-stack">
        <article class="pallet-detail-type-hero">
          <div class="pallet-detail-type-hero__icon">${typeHeroIcon(booking.title)}</div>
          <div class="pallet-detail-type-hero__copy">
            <span class="module-section-kicker">Buchungstyp</span>
            <h2>${escapeHtml(titleLabel(booking.title))}</h2>
          </div>
          <div class="pallet-detail-main-card__badges">
            <span class="pallet-status-badge pallet-status-badge--${escapeHtml(booking.status || "open")}">${escapeHtml(statusLabel(booking.status))}</span>
            <span class="pallet-urgency-badge pallet-urgency-badge--${escapeHtml(booking.urgency_level || "medium")}">${escapeHtml(urgencyLabel(booking.urgency_level))}</span>
          </div>
        </article>

        <section class="pallet-detail-route-grid">
          ${detailAddressCards(booking).map((card) => `
            <article class="pallet-detail-route-card">
              <div class="pallet-detail-route-card__icon">${addressCardIcon(card.kind)}</div>
              <div class="pallet-detail-route-card__body">
                <div class="pallet-detail-route-card__head">${escapeHtml(card.title)}</div>
                <div class="pallet-detail-route-row"><span>Kunde</span><strong>${escapeHtml(card.customer)}</strong></div>
                <div class="pallet-detail-route-row"><span>Firma</span><strong>${escapeHtml(card.company)}</strong></div>
                <div class="pallet-detail-route-row"><span>Stra\u00dfe</span><strong>${escapeHtml(card.street)}</strong></div>
                <div class="pallet-detail-route-row"><span>PLZ + Ort</span><strong>${escapeHtml(card.postalCity)}</strong></div>
                <div class="pallet-detail-route-row"><span>${escapeHtml(card.referenceLabel)}</span><strong>${escapeHtml(card.reference)}</strong></div>
              </div>
            </article>
          `).join("")}
        </section>

        <article class="pallet-detail-main-card">
          <div class="pallet-detail-main-card__head">
            <div><span class="module-section-kicker">Buchungsdaten</span></div>
          </div>
          <div class="pallet-detail-grid">
            <div class="pallet-detail-field"><label>Auftragsnummer</label><div>${escapeHtml(booking.order_no || "-")}</div></div>
            <div class="pallet-detail-field"><label>Paletten</label><div>${escapeHtml(booking.pallet_count)}</div></div>
            ${booking.truck_license_plate ? `<div class="pallet-detail-field"><label>LKW Kennzeichen</label><div>${escapeHtml(booking.truck_license_plate)}</div></div>` : ""}
            <div class="pallet-detail-field"><label>Abteilung</label><div>${escapeHtml(booking.department_name || "-")}</div></div>
            <div class="pallet-detail-field pallet-detail-field--wide"><label>Notiz</label><div>${escapeHtml(booking.note || "-")}</div></div>
          </div>
        </article>
      </div>

      <aside class="pallet-detail-side-card">
        <div class="pallet-detail-side-card__head">\u00dcbersicht</div>
        <div class="pallet-detail-side-card__body">
          <div class="pallet-detail-side-item"><span>Typ</span><strong>${escapeHtml(titleLabel(booking.title))}</strong></div>
          <div class="pallet-detail-side-item"><span>Status</span><strong>${escapeHtml(statusLabel(booking.status))}</strong></div>
          <div class="pallet-detail-side-item"><span>Dringlichkeit</span><strong>${escapeHtml(urgencyLabel(booking.urgency_level))}</strong></div>
          <div class="pallet-detail-side-item"><span>Auftragsnummer</span><strong>${escapeHtml(booking.order_no || "-")}</strong></div>
          <div class="pallet-detail-side-item"><span>Paletten</span><strong>${escapeHtml(booking.pallet_count)}</strong></div>
          ${booking.reference_no ? `<div class="pallet-detail-side-item"><span>Referenz</span><strong>${escapeHtml(booking.reference_no)}</strong></div>` : ""}
          ${booking.destination_reference_no ? `<div class="pallet-detail-side-item"><span>Referenz Ziel</span><strong>${escapeHtml(booking.destination_reference_no)}</strong></div>` : ""}
          ${booking.truck_license_plate ? `<div class="pallet-detail-side-item"><span>LKW Kennzeichen</span><strong>${escapeHtml(booking.truck_license_plate)}</strong></div>` : ""}
        </div>
      </aside>
    </section>
  `;
}

init();
