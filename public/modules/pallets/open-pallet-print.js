const token = localStorage.getItem("token");
if (!token) window.location.href = "/login.html";

const PALLET_ASSET_VERSION = "20260317-6";
const PDF_LANGUAGE_STORAGE_KEY = "openPalletPdfLanguage";

const I18N = {
  de: {
    locale: "de-DE",
    language: "PDF-Sprache",
    printPdf: "PDF drucken",
    close: "Schlie\u00dfen",
    pageTitle: "Fahrerinformation",
    pageSubtitle: "Offene Paletten",
    bookingType: "Buchungstyp",
    orderNo: "Auftragsnummer",
    route: "Route",
    palletCount: "Paletten",
    generatedAt: "Erstellt",
    bookingLabel: "Buchung",
    sectionAddresses: "Adressdaten",
    note: "Hinweis",
    customer: "Kunde",
    company: "Firma",
    street: "Stra\u00dfe",
    postalCity: "PLZ + Ort",
    country: "Land",
    reference: "Referenz",
    referenceStart: "Referenz Start",
    referenceDestination: "Referenz Ziel",
    pickupAddress: "Abholadresse",
    returnAddress: "R\u00fcckgabeadresse",
    startAddress: "Startadresse",
    destinationAddress: "Zieladresse",
    address: "Adresse",
    fallbackType: "Buchung",
    singleRouteConnector: "Ziel",
    transferConnector: "an",
    titles: {
      abholung: "Abholung",
      rueckfuehrung: "R\u00fcckf\u00fchrung",
      firma_zu_firma: "Firma zu Firma"
    }
  },
  en: {
    locale: "en-GB",
    language: "PDF language",
    printPdf: "Print PDF",
    close: "Close",
    pageTitle: "Driver information",
    pageSubtitle: "Open pallets",
    bookingType: "Order type",
    orderNo: "Order number",
    route: "Route",
    palletCount: "Pallets",
    generatedAt: "Created",
    bookingLabel: "Order",
    sectionAddresses: "Addresses",
    note: "Notes",
    customer: "Customer",
    company: "Company",
    street: "Street",
    postalCity: "Postal code + city",
    country: "Country",
    reference: "Reference",
    referenceStart: "Start reference",
    referenceDestination: "Destination reference",
    pickupAddress: "Pickup address",
    returnAddress: "Return address",
    startAddress: "Start address",
    destinationAddress: "Destination address",
    address: "Address",
    fallbackType: "Order",
    singleRouteConnector: "Destination",
    transferConnector: "to",
    titles: {
      abholung: "Pickup",
      rueckfuehrung: "Return",
      firma_zu_firma: "Company to Company"
    }
  },
  hr: {
    locale: "hr-HR",
    language: "PDF jezik",
    printPdf: "Ispis PDF-a",
    close: "Zatvori",
    pageTitle: "Informacije za voza\u010da",
    pageSubtitle: "Otvorene palete",
    bookingType: "Vrsta naloga",
    orderNo: "Broj naloga",
    route: "Ruta",
    palletCount: "Palete",
    generatedAt: "Izra\u0111eno",
    bookingLabel: "Nalog",
    sectionAddresses: "Adrese",
    note: "Napomena",
    customer: "Klijent",
    company: "Tvrtka",
    street: "Ulica",
    postalCity: "Po\u0161tanski broj + grad",
    country: "Dr\u017eava",
    reference: "Referenca",
    referenceStart: "Po\u010detna referenca",
    referenceDestination: "Odredi\u0161na referenca",
    pickupAddress: "Adresa preuzimanja",
    returnAddress: "Adresa povrata",
    startAddress: "Polazna adresa",
    destinationAddress: "Odredi\u0161na adresa",
    address: "Adresa",
    fallbackType: "Nalog",
    singleRouteConnector: "Odredi\u0161te",
    transferConnector: "do",
    titles: {
      abholung: "Preuzimanje",
      rueckfuehrung: "Povrat",
      firma_zu_firma: "Od tvrtke do tvrtke"
    }
  },
  ru: {
    locale: "ru-RU",
    language: "\u042f\u0437\u044b\u043a PDF",
    printPdf: "\u041f\u0435\u0447\u0430\u0442\u044c PDF",
    close: "\u0417\u0430\u043a\u0440\u044b\u0442\u044c",
    pageTitle: "\u0418\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u044f \u0434\u043b\u044f \u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044f",
    pageSubtitle: "\u041e\u0442\u043a\u0440\u044b\u0442\u044b\u0435 \u043f\u0430\u043b\u0435\u0442\u044b",
    bookingType: "\u0422\u0438\u043f \u0437\u0430\u044f\u0432\u043a\u0438",
    orderNo: "\u041d\u043e\u043c\u0435\u0440 \u0437\u0430\u043a\u0430\u0437\u0430",
    route: "\u041c\u0430\u0440\u0448\u0440\u0443\u0442",
    palletCount: "\u041f\u0430\u043b\u0435\u0442\u044b",
    generatedAt: "\u0421\u043e\u0437\u0434\u0430\u043d\u043e",
    bookingLabel: "\u0417\u0430\u044f\u0432\u043a\u0430",
    sectionAddresses: "\u0410\u0434\u0440\u0435\u0441\u0430",
    note: "\u041f\u0440\u0438\u043c\u0435\u0447\u0430\u043d\u0438\u0435",
    customer: "\u041a\u043b\u0438\u0435\u043d\u0442",
    company: "\u041a\u043e\u043c\u043f\u0430\u043d\u0438\u044f",
    street: "\u0423\u043b\u0438\u0446\u0430",
    postalCity: "\u0418\u043d\u0434\u0435\u043a\u0441 \u0438 \u0433\u043e\u0440\u043e\u0434",
    country: "\u0421\u0442\u0440\u0430\u043d\u0430",
    reference: "\u0420\u0435\u0444\u0435\u0440\u0435\u043d\u0441",
    referenceStart: "\u0420\u0435\u0444\u0435\u0440\u0435\u043d\u0441 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438",
    referenceDestination: "\u0420\u0435\u0444\u0435\u0440\u0435\u043d\u0441 \u043f\u0440\u0438\u0431\u044b\u0442\u0438\u044f",
    pickupAddress: "\u0410\u0434\u0440\u0435\u0441 \u0437\u0430\u0431\u043e\u0440\u0430",
    returnAddress: "\u0410\u0434\u0440\u0435\u0441 \u0432\u043e\u0437\u0432\u0440\u0430\u0442\u0430",
    startAddress: "\u0410\u0434\u0440\u0435\u0441 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438",
    destinationAddress: "\u0410\u0434\u0440\u0435\u0441 \u043f\u0440\u0438\u0431\u044b\u0442\u0438\u044f",
    address: "\u0410\u0434\u0440\u0435\u0441",
    fallbackType: "\u0417\u0430\u044f\u0432\u043a\u0430",
    singleRouteConnector: "\u041f\u0443\u043d\u043a\u0442",
    transferConnector: "\u0432",
    titles: {
      abholung: "\u0417\u0430\u0431\u043e\u0440",
      rueckfuehrung: "\u0412\u043e\u0437\u0432\u0440\u0430\u0442",
      firma_zu_firma: "\u041e\u0442 \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u0438 \u043a \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u0438"
    }
  }
};

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

function normalizeLanguage(value) {
  return Object.prototype.hasOwnProperty.call(I18N, value) ? value : "de";
}

function getLanguage() {
  const params = new URLSearchParams(window.location.search);
  return normalizeLanguage(params.get("lang") || localStorage.getItem(PDF_LANGUAGE_STORAGE_KEY) || "de");
}

function getTranslations(lang) {
  return I18N[normalizeLanguage(lang)];
}

function titleLabel(title, lang) {
  const dict = getTranslations(lang);
  return dict.titles[title] || dict.fallbackType;
}

function isTransferTitle(value) {
  return String(value || "") === "firma_zu_firma";
}

function streetLine(street, addressExtra) {
  return [street, addressExtra].filter(Boolean).join(", ") || "-";
}

function postalCityLine(postalCode, city) {
  return [postalCode, city].filter(Boolean).join(" ") || "-";
}

function formatDateTime(value, lang) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(getTranslations(lang).locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function buildRouteSummary(booking, lang) {
  const dict = getTranslations(lang);
  const start = booking.customer_name || booking.company || "-";
  if (isTransferTitle(booking.title)) {
    const destination = booking.destination_customer_name || booking.destination_company || "-";
    return `${start} ${dict.transferConnector} ${destination}`;
  }
  return `${titleLabel(booking.title, lang)} | ${start}`;
}

function typeIconSvg(title) {
  switch (title) {
    case "rueckfuehrung":
      return `
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <path d="M48 18H22l8-8" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M22 18l8 8" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="14" y="38" width="36" height="10" rx="3" fill="currentColor" opacity=".9"/>
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
          <rect x="14" y="38" width="36" height="10" rx="3" fill="currentColor" opacity=".9"/>
        </svg>
      `;
  }
}

function buildAddressCards(booking, lang) {
  const dict = getTranslations(lang);
  const cards = [
    {
      modifier: "start",
      title: isTransferTitle(booking.title)
        ? dict.startAddress
        : (booking.title === "abholung"
          ? dict.pickupAddress
          : (booking.title === "rueckfuehrung" ? dict.returnAddress : dict.address)),
      rows: [
        { label: dict.customer, value: booking.customer_name || booking.company || "-" },
        { label: dict.company, value: booking.company || "-" },
        { label: dict.street, value: streetLine(booking.street, booking.address_extra) },
        { label: dict.postalCity, value: postalCityLine(booking.postal_code, booking.city) },
        { label: dict.country, value: booking.country || "-" },
        { label: isTransferTitle(booking.title) ? dict.referenceStart : dict.reference, value: booking.reference_no || "-" }
      ]
    }
  ];

  if (isTransferTitle(booking.title)) {
    cards.push({
      modifier: "destination",
      title: dict.destinationAddress,
      rows: [
        { label: dict.customer, value: booking.destination_customer_name || booking.destination_company || "-" },
        { label: dict.company, value: booking.destination_company || "-" },
        { label: dict.street, value: streetLine(booking.destination_street, booking.destination_address_extra) },
        { label: dict.postalCity, value: postalCityLine(booking.destination_postal_code, booking.destination_city) },
        { label: dict.country, value: booking.destination_country || "-" },
        { label: dict.referenceDestination, value: booking.destination_reference_no || "-" }
      ]
    });
  }

  return cards;
}

function renderLanguageOptions(activeLang) {
  const labels = {
    de: "Deutsch",
    en: "English",
    hr: "Hrvatski",
    ru: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439"
  };
  return Object.entries(labels)
    .map(([value, label]) => `<option value="${value}" ${value === activeLang ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

function renderCard(card) {
  return `
    <article class="driver-card ${card.modifier === "destination" ? "driver-card--destination" : ""}">
      <div class="driver-card__head">${escapeHtml(card.title)}</div>
      <div class="driver-card__body">
        ${card.rows.map((row) => `
          <div class="driver-card__row">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.value || "-")}</strong>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function renderError(message) {
  document.title = "Offene Paletten";
  $("app").innerHTML = `<div class="print-empty">${escapeHtml(message || "Daten konnten nicht geladen werden.")}</div>`;
}

function bindToolbar(bookingId, lang) {
  const select = $("pageLanguageSelect");
  const printBtn = $("pagePrintBtn");
  const closeBtn = $("pageCloseBtn");
  if (select) {
    select.addEventListener("change", () => {
      const nextLang = normalizeLanguage(select.value);
      localStorage.setItem(PDF_LANGUAGE_STORAGE_KEY, nextLang);
      const params = new URLSearchParams(window.location.search);
      params.delete("v");
      params.set("lang", nextLang);
      params.set("autoprint", "1");
      window.location.href = `/modules/pallets/open-pallet-print.html?v=${PALLET_ASSET_VERSION}&${params.toString()}`;
    });
  }
  if (printBtn) {
    printBtn.addEventListener("click", () => window.print());
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      if (window.opener) window.close();
      else window.location.href = `/modules/pallets/open-pallet-detail.html?v=${PALLET_ASSET_VERSION}&id=${encodeURIComponent(bookingId)}`;
    });
  }
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const bookingId = Number(params.get("id") || 0);
  const lang = getLanguage();
  localStorage.setItem(PDF_LANGUAGE_STORAGE_KEY, lang);

  if (!bookingId) {
    renderError("Keine Buchungs-ID \u00fcbergeben.");
    return;
  }

  const response = await api(`/api/modules/pallets/open-pallets/${bookingId}`, { method: "GET", headers: {} });
  const booking = await response.json().catch(() => null);
  if (!response.ok || !booking) {
    renderError(booking?.error || "Buchung konnte nicht geladen werden.");
    return;
  }

  const dict = getTranslations(lang);
  const cards = buildAddressCards(booking, lang);
  const routeSummary = buildRouteSummary(booking, lang);
  const printNote = String(booking.note || "").trim();
  const autoPrint = params.get("autoprint") !== "0";

  document.documentElement.lang = lang;
  document.title = `${dict.pageTitle} - ${titleLabel(booking.title, lang)}`;

  $("app").innerHTML = `
    <div class="print-toolbar no-print">
      <div class="print-toolbar__group">
        <span class="print-toolbar__label">${escapeHtml(dict.language)}</span>
        <select id="pageLanguageSelect">${renderLanguageOptions(lang)}</select>
      </div>
      <div class="print-toolbar__group">
        <button class="primary" id="pagePrintBtn" type="button">${escapeHtml(dict.printPdf)}</button>
        <button id="pageCloseBtn" type="button">${escapeHtml(dict.close)}</button>
      </div>
    </div>

    <div class="sheet-wrap">
      <main class="driver-sheet">
        <header class="driver-hero">
          <div class="driver-hero__icon">${typeIconSvg(booking.title)}</div>
          <div class="driver-hero__copy">
            <span class="driver-hero__eyebrow">${escapeHtml(dict.pageSubtitle)}</span>
            <h1>${escapeHtml(titleLabel(booking.title, lang))}</h1>
            <p>${escapeHtml(routeSummary)}</p>
          </div>
          <div class="driver-count">
            <span>${escapeHtml(dict.palletCount)}</span>
            <strong>${escapeHtml(String(booking.pallet_count ?? "-"))}</strong>
          </div>
        </header>

        <section class="driver-meta">
          <div class="driver-meta__item">
            <span>${escapeHtml(dict.bookingType)}</span>
            <strong>${escapeHtml(titleLabel(booking.title, lang))}</strong>
          </div>
          <div class="driver-meta__item">
            <span>${escapeHtml(dict.orderNo)}</span>
            <strong>${escapeHtml(booking.order_no || "-")}</strong>
          </div>
          <div class="driver-meta__item">
            <span>${escapeHtml(dict.generatedAt)}</span>
            <strong>${escapeHtml(formatDateTime(booking.updated_at || booking.created_at || new Date(), lang))}</strong>
          </div>
        </section>

        <section class="driver-section">
          <div class="driver-section__head"><b>${escapeHtml(dict.sectionAddresses)}</b></div>
          <div class="${cards.length > 1 ? "driver-route--transfer" : "driver-route--single"}">
            ${renderCard(cards[0])}
            ${cards.length > 1 ? `
              <div class="driver-arrow" aria-hidden="true">
                <svg viewBox="0 0 64 64">
                  <path d="M12 32h32" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
                  <path d="M34 20l12 12-12 12" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              ${renderCard(cards[1])}
            ` : ""}
          </div>
        </section>

        ${printNote ? `
          <section class="driver-section">
            <div class="driver-note">
              <div class="driver-note__head">${escapeHtml(dict.note)}</div>
              <div class="driver-note__body">${escapeHtml(printNote)}</div>
            </div>
          </section>
        ` : ""}

        <footer class="driver-footer">
          <span>${escapeHtml(dict.bookingLabel)} #${escapeHtml(String(booking.id || "-"))}</span>
          <span>${escapeHtml(dict.generatedAt)} ${escapeHtml(formatDateTime(new Date(), lang))}</span>
        </footer>
      </main>
    </div>
  `;

  bindToolbar(booking.id, lang);

  if (autoPrint) {
    requestAnimationFrame(() => {
      window.setTimeout(() => window.print(), 280);
    });
  }
}

init();
