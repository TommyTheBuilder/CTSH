const weekdayHeader = document.getElementById("weekdayHeader");
const calendarGrid = document.getElementById("calendarGrid");
const rangeLabel = document.getElementById("rangeLabel");
const topbarTitle = document.querySelector(".topbar__title-wrap h1");
const topbarSubtitle = document.querySelector(".topbar__subtitle");
const todayBtn = document.getElementById("todayBtn");
const monthViewBtn = document.getElementById("monthViewBtn");
const weekViewBtn = document.getElementById("weekViewBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const languageMenu = document.getElementById("languageMenu");
const languageMenuToggle = document.getElementById("languageMenuToggle");
const languageMenuDropdown = document.getElementById("languageMenuDropdown");
const languageButtons = Array.from(document.querySelectorAll("[data-language]"));
const gearMenu = document.getElementById("gearMenu");
const gearMenuToggle = document.getElementById("gearMenuToggle");
const gearMenuDropdown = document.getElementById("gearMenuDropdown");
const darkModeToggle = document.getElementById("darkModeToggle");
const moduleDashboardBtn = document.getElementById("moduleDashboardBtn");
const logoutBtn = document.getElementById("logoutBtn");

const LANGUAGE_KEY = "containerplanung.language";
const TOKEN_KEY = "token";
const SUPPORTED_LANGUAGES = ["de", "hr", "sr"];
const I18N = {
  de: {
    documentTitle: "Container und LKW Planung",
    pageTitle: "Container und LKW Planung",
    pageSubtitle: "Logistik- und LKW-Planungsdashboard",
    today: "Heute",
    month: "Monat",
    week: "Woche",
    previous: "Zuruck",
    next: "Vor",
    settings: "Einstellungen",
    language: "Sprache",
    langDe: "Deutsch",
    langHr: "Hrvatski",
    langSr: "Srpski",
    darkMode: "Dark Mode",
    lightMode: "Light Mode",
    moduleDashboard: "Modul-Dashboard",
    logout: "Logout",
    weekdays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
    bookingLoadFailed: "Buchungen konnten nicht geladen werden.",
    bookingSaveFailed: "Buchung konnte nicht gespeichert werden.",
    bookingDeleteFailed: "Buchung konnte nicht geloscht werden.",
    bookingMoveFailed: "Buchung konnte nicht verschoben werden.",
    bookingDateSaveFailed: "Buchungsdatum konnte nicht gespeichert werden.",
    bookingCreateTitle: "Neue Buchung erstellen",
    titleLabel: "Titel",
    containerLabel: "Containernummer",
    optional: "(optional)",
    licensePlateLabel: "Kennzeichen",
    orderNumberLabel: "Auftragsnummer",
    warehouseLabel: "Lager",
    dateLabel: "Datum",
    typeLabel: "Typ",
    bookingHint: "Hinweis: Fotos und Dateien bleiben lokal im Browser wie im Altmodul.",
    cancel: "Abbrechen",
    save: "Speichern",
    confirmEyebrow: "Bitte bestatigen",
    confirmDeleteTitle: "Eintrag loschen?",
    confirmHint: "Dieser Vorgang kann nicht ruckgangig gemacht werden.",
    confirmDeleteAction: "Endgultig loschen",
    detailsTitle: "Buchungsdetails",
    close: "Schliessen",
    attachmentsTitle: "Anhaenge (Fotos / Dateien)",
    attachmentsHint: "Uploads bleiben wie im Altmodul lokal im aktuellen Browser.",
    deleteBooking: "Buchung loschen",
    bookingPrefix: "Buchung",
    noAttachments: "Noch keine Anhaenge vorhanden.",
    download: "Download",
    remove: "Entfernen",
    deleteBookingConfirmTitle: "Buchung endgultig loschen?",
    deleteBookingConfirmMessage: "Mochten Sie die Buchung \"{title}\" wirklich loschen?",
    bookingCardContainer: "Container",
    bookingCardPlate: "Kennzeichen",
    bookingCardOrder: "Auftrag",
    bookingCardWarehouse: "Lager",
    dayStatusEmpty: "Frei",
    dayStatusOne: "1 Buchung",
    dayStatusMany: "{count} Buchungen",
    dayEmptyHint: "Noch keine Planung fur diesen Tag.",
    bookingType_direct_unload: "Container Direktentladung",
    bookingType_hand_unload: "Container Handentladung",
    bookingType_truck_delivery: "LKW Anlieferung",
    bookingType_special_storage: "Sonderarbeiten Lager",
    bookingTypeOption_direct_unload: "Container Direktentladung (Blau)",
    bookingTypeOption_hand_unload: "Container Handentladung (Grun)",
    bookingTypeOption_truck_delivery: "LKW Anlieferung (Grau)",
    bookingTypeOption_special_storage: "Sonderarbeiten Lager (Rot)"
  },
  hr: {
    documentTitle: "Planiranje kontejnera i kamiona",
    pageTitle: "Planiranje kontejnera i kamiona",
    pageSubtitle: "Nadzorna ploca za logistiku i planiranje kamiona",
    today: "Danas",
    month: "Mjesec",
    week: "Tjedan",
    previous: "Natrag",
    next: "Naprijed",
    settings: "Postavke",
    language: "Jezik",
    langDe: "Deutsch",
    langHr: "Hrvatski",
    langSr: "Srpski",
    darkMode: "Tamni nacin",
    lightMode: "Svijetli nacin",
    moduleDashboard: "Pregled modula",
    logout: "Odjava",
    weekdays: ["Ponedjeljak", "Utorak", "Srijeda", "Cetvrtak", "Petak", "Subota", "Nedjelja"],
    bookingLoadFailed: "Rezervacije nije moguce ucitati.",
    bookingSaveFailed: "Rezervaciju nije moguce spremiti.",
    bookingDeleteFailed: "Rezervaciju nije moguce izbrisati.",
    bookingMoveFailed: "Rezervaciju nije moguce premjestiti.",
    bookingDateSaveFailed: "Datum rezervacije nije moguce spremiti.",
    bookingCreateTitle: "Kreiraj novu rezervaciju",
    titleLabel: "Naziv",
    containerLabel: "Broj kontejnera",
    optional: "(opcionalno)",
    licensePlateLabel: "Registarska oznaka",
    orderNumberLabel: "Broj naloga",
    warehouseLabel: "Skladiste",
    dateLabel: "Datum",
    typeLabel: "Vrsta",
    bookingHint: "Napomena: fotografije i datoteke ostaju lokalno u pregledniku kao i u starom modulu.",
    cancel: "Odustani",
    save: "Spremi",
    confirmEyebrow: "Molimo potvrdite",
    confirmDeleteTitle: "Izbrisati unos?",
    confirmHint: "Ovu radnju nije moguce ponistiti.",
    confirmDeleteAction: "Trajno izbrisi",
    detailsTitle: "Detalji rezervacije",
    close: "Zatvori",
    attachmentsTitle: "Privici (fotografije / datoteke)",
    attachmentsHint: "Prijenosi ostaju lokalno u trenutnom pregledniku kao i u starom modulu.",
    deleteBooking: "Izbrisi rezervaciju",
    bookingPrefix: "Rezervacija",
    noAttachments: "Jos nema privitaka.",
    download: "Preuzmi",
    remove: "Ukloni",
    deleteBookingConfirmTitle: "Trajno izbrisati rezervaciju?",
    deleteBookingConfirmMessage: "Zelite li stvarno izbrisati rezervaciju \"{title}\"?",
    bookingCardContainer: "Kontejner",
    bookingCardPlate: "Registarska oznaka",
    bookingCardOrder: "Nalog",
    bookingCardWarehouse: "Skladiste",
    dayStatusEmpty: "Slobodno",
    dayStatusOne: "1 rezervacija",
    dayStatusMany: "{count} rezervacija",
    dayEmptyHint: "Jos nema planiranih unosa za ovaj dan.",
    bookingType_direct_unload: "Kontejner izravni istovar",
    bookingType_hand_unload: "Kontejner rucni istovar",
    bookingType_truck_delivery: "Dostava kamionom",
    bookingType_special_storage: "Posebni radovi u skladistu",
    bookingTypeOption_direct_unload: "Kontejner izravni istovar (plavo)",
    bookingTypeOption_hand_unload: "Kontejner rucni istovar (zeleno)",
    bookingTypeOption_truck_delivery: "Dostava kamionom (sivo)",
    bookingTypeOption_special_storage: "Posebni radovi u skladistu (crveno)"
  },
  sr: {
    documentTitle: "Planiranje kontejnera i kamiona",
    pageTitle: "Planiranje kontejnera i kamiona",
    pageSubtitle: "Kontrolna tabla za logistiku i planiranje kamiona",
    today: "Danas",
    month: "Mesec",
    week: "Nedelja",
    previous: "Nazad",
    next: "Napred",
    settings: "Podesavanja",
    language: "Jezik",
    langDe: "Deutsch",
    langHr: "Hrvatski",
    langSr: "Srpski",
    darkMode: "Tamni rezim",
    lightMode: "Svetli rezim",
    moduleDashboard: "Kontrolna tabla modula",
    logout: "Odjava",
    weekdays: ["Ponedeljak", "Utorak", "Sreda", "Cetvrtak", "Petak", "Subota", "Nedelja"],
    bookingLoadFailed: "Nije moguce ucitati rezervacije.",
    bookingSaveFailed: "Nije moguce sacuvati rezervaciju.",
    bookingDeleteFailed: "Nije moguce obrisati rezervaciju.",
    bookingMoveFailed: "Nije moguce pomeriti rezervaciju.",
    bookingDateSaveFailed: "Nije moguce sacuvati datum rezervacije.",
    bookingCreateTitle: "Kreiraj novu rezervaciju",
    titleLabel: "Naziv",
    containerLabel: "Broj kontejnera",
    optional: "(opciono)",
    licensePlateLabel: "Registracija",
    orderNumberLabel: "Broj naloga",
    warehouseLabel: "Skladiste",
    dateLabel: "Datum",
    typeLabel: "Tip",
    bookingHint: "Napomena: fotografije i fajlovi ostaju lokalno u pregledaÄu kao i u starom modulu.",
    cancel: "Otkazi",
    save: "Sacuvaj",
    confirmEyebrow: "Molimo potvrdite",
    confirmDeleteTitle: "Obrisati unos?",
    confirmHint: "Ovu radnju nije moguce opozvati.",
    confirmDeleteAction: "Trajno obrisi",
    detailsTitle: "Detalji rezervacije",
    close: "Zatvori",
    attachmentsTitle: "Prilozi (fotografije / fajlovi)",
    attachmentsHint: "Otpremanja ostaju lokalno u trenutnom pregledaÄu kao i u starom modulu.",
    deleteBooking: "Obrisi rezervaciju",
    bookingPrefix: "Rezervacija",
    noAttachments: "Jos nema priloga.",
    download: "Preuzmi",
    remove: "Ukloni",
    deleteBookingConfirmTitle: "Trajno obrisati rezervaciju?",
    deleteBookingConfirmMessage: "Da li zaista zelite da obrisete rezervaciju \"{title}\"?",
    bookingCardContainer: "Kontejner",
    bookingCardPlate: "Registracija",
    bookingCardOrder: "Nalog",
    bookingCardWarehouse: "Skladiste",
    dayStatusEmpty: "Slobodno",
    dayStatusOne: "1 rezervacija",
    dayStatusMany: "{count} rezervacija",
    dayEmptyHint: "Jos nema planiranih unosa za ovaj dan.",
    bookingType_direct_unload: "Kontejner direktan istovar",
    bookingType_hand_unload: "Kontejner rucni istovar",
    bookingType_truck_delivery: "Dostava kamionom",
    bookingType_special_storage: "Posebni radovi u skladistu",
    bookingTypeOption_direct_unload: "Kontejner direktan istovar (plavo)",
    bookingTypeOption_hand_unload: "Kontejner rucni istovar (zeleno)",
    bookingTypeOption_truck_delivery: "Dostava kamionom (sivo)",
    bookingTypeOption_special_storage: "Posebni radovi u skladistu (crveno)"
  }
};
const urlState = new URL(window.location.href);
const queryPortalToken = String(urlState.searchParams.get("portalToken") || "").trim();
if (queryPortalToken) {
  localStorage.setItem(TOKEN_KEY, queryPortalToken);
  urlState.searchParams.delete("portalToken");
  history.replaceState({}, document.title, `${urlState.pathname}${urlState.search}${urlState.hash}`);
}
const portalToken = String(localStorage.getItem(TOKEN_KEY) || "").trim();
const bookings = [];
let viewMode = "month";
let cursorDate = new Date();
let refreshInFlight = null;
let refreshQueued = false;
let liveRefreshTimer = null;
let currentLanguage = normalizeLanguage(localStorage.getItem(LANGUAGE_KEY) || "de");
let planningPermissions = { open: false, create: false, edit: false, delete: false };
const mobileCalendarMedia = window.matchMedia("(max-width: 720px)");

function canCreatePlanningBookings() {
  return !!planningPermissions.create;
}

function canEditPlanningBookings() {
  return !!planningPermissions.edit;
}

function canDeletePlanningBookings() {
  return !!planningPermissions.delete;
}

function normalizeLanguage(value) {
  const normalized = String(value || "").trim().toLowerCase().slice(0, 2);
  return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : "de";
}

function getLocale() {
  return {
    de: "de-DE",
    hr: "hr-HR",
    sr: "sr-RS"
  }[currentLanguage] || "de-DE";
}

function t(key, vars = {}) {
  const value = I18N[currentLanguage]?.[key] ?? I18N.de[key] ?? key;
  return Object.entries(vars).reduce(
    (text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)),
    String(value)
  );
}

function isMobileCalendarViewport() {
  return mobileCalendarMedia.matches;
}

function handleMobileCalendarViewportChange() {
  render();
}

if (typeof mobileCalendarMedia.addEventListener === "function") {
  mobileCalendarMedia.addEventListener("change", handleMobileCalendarViewportChange);
} else if (typeof mobileCalendarMedia.addListener === "function") {
  mobileCalendarMedia.addListener(handleMobileCalendarViewportChange);
}

const liveSocket = typeof window.io === "function"
  ? window.io("/container-planning", {
      query: portalToken ? { portalToken } : undefined,
      auth: portalToken ? { token: portalToken } : undefined
    })
  : null;

const bookingModal = createBookingModal({
  async onSave(newBooking) {
    const createdBooking = await createBooking(newBooking);
    bookings.push(createdBooking);
    render();
  }
});

const confirmDialog = createConfirmDialog();

const detailsModal = createBookingDetailsModal({
  onBookingUpdate(updated) {
    const index = bookings.findIndex((booking) => booking.id === updated.id);
    if (index >= 0) bookings[index] = updated;
    render();
  },
  async onBookingDelete(bookingId) {
    await deleteBooking(bookingId);
    const index = bookings.findIndex((booking) => booking.id === bookingId);
    if (index < 0) return;

    const [removedBooking] = bookings.splice(index, 1);
    (removedBooking.attachments || []).forEach((file) => {
      if (file?.url) URL.revokeObjectURL(file.url);
    });
    render();
  }
});

document.body.append(bookingModal.overlay);
document.body.append(confirmDialog.overlay);
document.body.append(detailsModal.overlay);

initApp();

async function initApp() {
  const authenticated = await ensureAuthenticated();
  if (!authenticated) return;
  await loadPlanningPermissions();
  await applyInitialTheme();
  applyTranslations();
  render();
  refreshDataAndRender();
}

function updateDarkModeLabel() {
  if (!darkModeToggle) return;
  darkModeToggle.textContent = document.body.classList.contains("theme-dark")
    ? t("lightMode")
    : t("darkMode");
}

function updateLanguageMenu() {
  if (languageMenuToggle) {
    const currentLabel = currentLanguage === "hr" ? t("langHr") : currentLanguage === "sr" ? t("langSr") : t("langDe");
    languageMenuToggle.textContent = `${t("language")}: ${currentLabel}`;
    languageMenuToggle.setAttribute("aria-label", `${t("language")}: ${currentLabel}`);
  }

  languageButtons.forEach((button) => {
    const lang = button.dataset.language;
    if (lang === "de") button.textContent = t("langDe");
    if (lang === "hr") button.textContent = t("langHr");
    if (lang === "sr") button.textContent = t("langSr");
    button.classList.toggle("is-active", lang === currentLanguage);
  });
}

function applyTranslations() {
  document.documentElement.lang = currentLanguage;
  document.title = t("documentTitle");
  if (topbarTitle) topbarTitle.textContent = t("pageTitle");
  if (topbarSubtitle) topbarSubtitle.textContent = t("pageSubtitle");
  if (todayBtn) todayBtn.textContent = t("today");
  if (monthViewBtn) monthViewBtn.textContent = t("month");
  if (weekViewBtn) weekViewBtn.textContent = t("week");
  if (prevBtn) prevBtn.setAttribute("aria-label", t("previous"));
  if (nextBtn) nextBtn.setAttribute("aria-label", t("next"));
  if (gearMenuToggle) gearMenuToggle.setAttribute("aria-label", t("settings"));
  if (moduleDashboardBtn) moduleDashboardBtn.textContent = t("moduleDashboard");
  if (logoutBtn) logoutBtn.textContent = t("logout");
  updateDarkModeLabel();
  updateLanguageMenu();
  bookingModal.updateTexts();
  confirmDialog.updateTexts();
  detailsModal.updateTexts();
}

function setLanguage(nextLanguage) {
  const normalized = normalizeLanguage(nextLanguage);
  if (normalized === currentLanguage) {
    languageMenu?.classList.remove("is-open");
    return;
  }

  currentLanguage = normalized;
  localStorage.setItem(LANGUAGE_KEY, currentLanguage);
  applyTranslations();
  render();
  languageMenu?.classList.remove("is-open");
}

async function ensureAuthenticated() {
  try {
    const response = await fetch("/api/me", {
      credentials: "include",
      headers: portalToken ? { Authorization: `Bearer ${portalToken}` } : {}
    });
    if (response.ok) return true;
  } catch {
    // handled below
  }

  window.location.replace("/login.html");
  return false;
}

async function loadPlanningPermissions() {
  try {
    const response = await fetch("/api/my-permissions", {
      credentials: "include",
      headers: portalToken ? { Authorization: `Bearer ${portalToken}` } : {}
    });
    const payload = response.ok ? await response.json() : {};
    planningPermissions = {
      open: !!payload?.modules?.container_planning?.open,
      create: !!payload?.modules?.container_planning?.create,
      edit: !!payload?.modules?.container_planning?.edit,
      delete: !!payload?.modules?.container_planning?.delete
    };
  } catch {
    planningPermissions = { open: false, create: false, edit: false, delete: false };
  }
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function loadBookingsForCurrentMonth() {
  const month = toYearMonth(cursorDate);
  const response = await fetch(`/api/modules/container-planning/bookings?month=${encodeURIComponent(month)}`, {
    credentials: "include",
    headers: portalToken ? { Authorization: `Bearer ${portalToken}` } : {}
  });

  if (!response.ok) {
    if (response.status === 401) {
      window.location.replace("/login.html");
      return;
    }
    throw new Error(t("bookingLoadFailed"));
  }

  const rows = await response.json();
  const previousBookingsById = new Map(bookings.map((booking) => [booking.id, booking]));
  const nextBookings = rows.map((row) => {
    const mapped = mapApiBookingToUi(row);
    const existing = previousBookingsById.get(mapped.id);
    if (existing?.attachments?.length) mapped.attachments = existing.attachments;
    return mapped;
  });
  const nextIds = new Set(nextBookings.map((booking) => booking.id));

  bookings
    .filter((booking) => !nextIds.has(booking.id))
    .forEach((booking) => {
      (booking.attachments || []).forEach((file) => {
        if (file?.url) URL.revokeObjectURL(file.url);
      });
    });

  bookings.splice(0, bookings.length, ...nextBookings);
}

async function createBooking(booking) {
  if (!canCreatePlanningBookings()) {
    throw new Error("Keine Berechtigung zum Anlegen von Planungsbuchungen.");
  }
  const response = await fetch("/api/modules/container-planning/bookings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(portalToken ? { Authorization: `Bearer ${portalToken}` } : {})
    },
    credentials: "include",
    body: JSON.stringify({
      title: booking.title,
      containerNo: booking.container,
      customer: "-",
      warehouse: booking.lager,
      plate: booking.kennzeichen,
      orderNo: booking.auftrag,
      date: booking.date,
      color: getColorForBookingType(booking.type)
    })
  });

  if (!response.ok) {
    const payload = await safeReadJson(response);
    throw new Error(payload?.message || t("bookingSaveFailed"));
  }

  return mapApiBookingToUi(await response.json());
}

async function deleteBooking(bookingId) {
  if (!canDeletePlanningBookings()) {
    throw new Error("Keine Berechtigung zum Loeschen von Planungsbuchungen.");
  }
  const response = await fetch(`/api/modules/container-planning/bookings/${encodeURIComponent(bookingId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: portalToken ? { Authorization: `Bearer ${portalToken}` } : {}
  });
  if (!response.ok) {
    const payload = await safeReadJson(response);
    throw new Error(payload?.message || t("bookingDeleteFailed"));
  }
}

async function updateBookingDate(bookingId, date) {
  if (!canEditPlanningBookings()) {
    throw new Error("Keine Berechtigung zum Verschieben von Planungsbuchungen.");
  }
  const response = await fetch(`/api/modules/container-planning/bookings/${encodeURIComponent(bookingId)}/date`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(portalToken ? { Authorization: `Bearer ${portalToken}` } : {})
    },
    credentials: "include",
    body: JSON.stringify({ date })
  });

  if (!response.ok) {
    const payload = await safeReadJson(response);
    throw new Error(payload?.message || t("bookingDateSaveFailed"));
  }

  return mapApiBookingToUi(await response.json());
}

function mapApiBookingToUi(row) {
  return {
    id: String(row.id),
    title: String(row.title || ""),
    container: String(row.containerNo || ""),
    kennzeichen: String(row.plate || ""),
    auftrag: String(row.orderNo || ""),
    lager: String(row.warehouse || ""),
    date: String(row.date || ""),
    type: getBookingTypeFromColor(row.color),
    attachments: []
  };
}

function render() {
  if (!weekdayHeader || !calendarGrid) return;
  renderWeekdays();
  renderRangeLabel();
  renderGrid();
  syncViewButtons();
}

function renderWeekdays() {
  if (viewMode === "day") {
    weekdayHeader.innerHTML = "";
    const node = document.createElement("div");
    node.className = "weekday";
    node.textContent = cursorDate.toLocaleDateString(getLocale(), { weekday: "long" });
    weekdayHeader.append(node);
    return;
  }

  weekdayHeader.innerHTML = "";
  I18N[currentLanguage].weekdays.forEach((day) => {
    const node = document.createElement("div");
    node.className = "weekday";
    node.textContent = day;
    weekdayHeader.append(node);
  });
}

function renderRangeLabel() {
  if (!rangeLabel) return;
  if (viewMode === "month") {
    rangeLabel.textContent = cursorDate.toLocaleDateString(getLocale(), { month: "long", year: "numeric" });
  } else if (viewMode === "day") {
    rangeLabel.textContent = cursorDate.toLocaleDateString(getLocale(), {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  } else {
    const { start, end } = getWeekRange(cursorDate);
    rangeLabel.textContent = `${start.toLocaleDateString(getLocale(), { day: "2-digit", month: "2-digit" })} - ${end.toLocaleDateString(getLocale(), { day: "2-digit", month: "2-digit", year: "numeric" })}`;
  }
}

function renderGrid() {
  calendarGrid.innerHTML = "";
  calendarGrid.classList.toggle("calendar-grid--day", viewMode === "day");
  weekdayHeader.classList.toggle("weekdays--day", viewMode === "day");
  const isMobileMonthView = viewMode === "month" && isMobileCalendarViewport();
  const days = (viewMode === "month" ? buildMonthCells(cursorDate) : buildWeekCells(cursorDate))
    .filter(({ isCurrentMonth }) => !isMobileMonthView || isCurrentMonth);

  days.forEach(({ date, isCurrentMonth }) => {
    const ymd = toYmd(date);
    const matches = bookings.filter((item) => item.date === ymd);
    const compact = matches.length > 1 && !isMobileCalendarViewport();
    const dayCard = document.createElement("article");
    dayCard.className = `day-card ${isCurrentMonth ? "" : "day-card--other-month"} ${isToday(date) ? "day-card--today" : ""}`.trim();
    dayCard.dataset.date = ymd;
    dayCard.classList.toggle("day-card--has-bookings", matches.length > 0);

    const header = document.createElement("div");
    header.className = "day-card__header";

    const headerMain = document.createElement("div");
    headerMain.className = "day-card__header-main";

    const weekdayNode = document.createElement("div");
    weekdayNode.className = "day-card__weekday";
    weekdayNode.textContent = date.toLocaleDateString(getLocale(), { weekday: "long" });

    const dateNode = document.createElement("div");
    dateNode.className = "day-card__date";
    dateNode.textContent = formatDayCardDate(date);
    headerMain.append(weekdayNode, dateNode);

    const countNode = document.createElement("div");
    countNode.className = `day-card__count ${matches.length ? "" : "is-empty"}`.trim();
    countNode.textContent = getDayStatusLabel(matches.length);

    header.append(headerMain, countNode);
    dayCard.append(header);

    const bookingsNode = document.createElement("div");
    bookingsNode.className = "day-card__bookings";
    if (matches.length) {
      matches.forEach((booking) => bookingsNode.append(createBookingCard(booking, { compact })));
    } else {
      const emptyNode = document.createElement("p");
      emptyNode.className = "day-card__empty";
      emptyNode.textContent = t("dayEmptyHint");
      bookingsNode.append(emptyNode);
    }
    dayCard.append(bookingsNode);

    dayCard.addEventListener("click", (event) => {
      if (event.target.closest(".booking-card")) return;
      if (!canCreatePlanningBookings()) return;
      bookingModal.open(ymd);
    });

    dayCard.addEventListener("dragover", (event) => {
      event.preventDefault();
      dayCard.classList.add("is-drop-target");
    });

    dayCard.addEventListener("dragleave", () => dayCard.classList.remove("is-drop-target"));

    dayCard.addEventListener("drop", async (event) => {
      event.preventDefault();
      dayCard.classList.remove("is-drop-target");
      if (!canEditPlanningBookings()) return;
      const bookingId = event.dataTransfer.getData("text/booking-id");
      const booking = bookings.find((item) => item.id === bookingId);
      if (!booking) return;

      const previousDate = booking.date;
      if (previousDate === ymd) return;

      booking.date = ymd;
      render();

      try {
        const updatedBooking = await updateBookingDate(booking.id, ymd);
        const index = bookings.findIndex((item) => item.id === booking.id);
        if (index >= 0) bookings[index] = updatedBooking;
      } catch (error) {
        booking.date = previousDate;
        render();
        window.alert(error.message || t("bookingMoveFailed"));
      }
    });

    calendarGrid.append(dayCard);
  });
}

function formatDayCardDate(date) {
  if (isMobileCalendarViewport()) {
    return date.toLocaleDateString(getLocale(), { day: "2-digit", month: "long" });
  }
  return `${date.getDate()}.${date.getMonth() + 1}.`;
}

function getDayStatusLabel(count) {
  if (count <= 0) return t("dayStatusEmpty");
  if (count === 1) return t("dayStatusOne");
  return t("dayStatusMany", { count });
}

function createBookingCard(booking, { compact = false } = {}) {
  const card = document.createElement("div");
  card.className = `booking-card ${compact ? "booking-card--compact" : ""}`.trim();
  card.draggable = canEditPlanningBookings();
  card.dataset.type = booking.type;
  const detailLines = [
    hasDisplayValue(booking.container) ? `${escapeHtml(t("bookingCardContainer"))}: ${escapeHtml(booking.container)}` : "",
    hasDisplayValue(booking.kennzeichen) ? `${escapeHtml(t("bookingCardPlate"))}: ${escapeHtml(booking.kennzeichen)}` : "",
    hasDisplayValue(booking.auftrag) ? `${escapeHtml(t("bookingCardOrder"))}: ${escapeHtml(booking.auftrag)}` : "",
    hasDisplayValue(booking.lager) ? `${escapeHtml(t("bookingCardWarehouse"))}: ${escapeHtml(booking.lager)}` : ""
  ].filter(Boolean);
  card.innerHTML = compact
    ? `<strong>${escapeHtml(booking.title)}</strong>${detailLines[0] ? `<span>${detailLines[0]}</span>` : ""}`
    : `
      <strong>${escapeHtml(booking.title)}</strong>
      ${detailLines.join("<br />")}
    `;

  card.addEventListener("click", (event) => {
    event.stopPropagation();
    detailsModal.open(booking);
  });

  card.addEventListener("dragstart", (event) => {
    if (!canEditPlanningBookings()) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/booking-id", booking.id);
    event.dataTransfer.effectAllowed = "move";
  });

  return card;
}

function buildMonthCells(baseDate) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const startWeekDay = (monthStart.getDay() + 6) % 7;
  const cells = [];

  for (let i = startWeekDay; i > 0; i -= 1) cells.push({ date: new Date(year, month, 1 - i), isCurrentMonth: false });
  for (let day = 1; day <= monthEnd.getDate(); day += 1) cells.push({ date: new Date(year, month, day), isCurrentMonth: true });
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const next = new Date(last);
    next.setDate(last.getDate() + 1);
    cells.push({ date: next, isCurrentMonth: false });
  }
  return cells;
}

function buildWeekCells(baseDate) {
  if (viewMode === "day") return [{ date: new Date(baseDate), isCurrentMonth: true }];
  const { start } = getWeekRange(baseDate);
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);
    return { date, isCurrentMonth: true };
  });
}

function getWeekRange(baseDate) {
  const start = new Date(baseDate);
  const weekDay = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekDay);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function refreshDataAndRender() {
  if (refreshInFlight) {
    refreshQueued = true;
    return refreshInFlight;
  }

  refreshInFlight = loadBookingsForCurrentMonth()
    .catch((error) => {
      console.error(error);
    })
    .finally(() => {
      detailsModal.syncWithBookings(bookings);
      render();
      refreshInFlight = null;

      if (refreshQueued) {
        refreshQueued = false;
        refreshDataAndRender();
      }
    });

  return refreshInFlight;
}

function scheduleLiveRefresh() {
  window.clearTimeout(liveRefreshTimer);
  liveRefreshTimer = window.setTimeout(() => {
    refreshDataAndRender();
  }, 120);
}

function toYearMonth(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function toYmd(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isToday(date) {
  return toYmd(new Date()) === toYmd(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hasDisplayValue(value) {
  return String(value ?? "").trim() !== "";
}

function formatOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || "-";
}

function getColorForBookingType(type) {
  return {
    direct_unload: "#0ea5e9",
    hand_unload: "#22c55e",
    truck_delivery: "#6b7280",
    special_storage: "#ef4444"
  }[type] || "#0ea5e9";
}

function getBookingTypeFromColor(color) {
  return {
    "#0ea5e9": "direct_unload",
    "#22c55e": "hand_unload",
    "#6b7280": "truck_delivery",
    "#ef4444": "special_storage"
  }[String(color || "").toLowerCase()] || "direct_unload";
}

function getBookingTypeLabel(type) {
  const key = `bookingType_${type}`;
  return I18N[currentLanguage]?.[key] ?? I18N.de[key] ?? type;
}

function syncViewButtons() {
  monthViewBtn?.classList.toggle("is-active", viewMode === "month");
  monthViewBtn?.classList.toggle("btn--primary", viewMode === "month");
  monthViewBtn?.classList.toggle("btn--ghost", viewMode !== "month");
  weekViewBtn?.classList.toggle("is-active", viewMode === "week");
  weekViewBtn?.classList.toggle("btn--primary", viewMode === "week");
  weekViewBtn?.classList.toggle("btn--ghost", viewMode !== "week");
}

async function applyInitialTheme() {
  if (window.CtshTheme?.resolveInitialTheme) {
    await window.CtshTheme.resolveInitialTheme({
      bodyClass: "theme-dark",
      tokenStorageKeys: [TOKEN_KEY],
      onApply: () => updateDarkModeLabel()
    });
    return;
  }

  document.body.classList.toggle("theme-dark", false);
  updateDarkModeLabel();
}

todayBtn?.addEventListener("click", () => {
  viewMode = "day";
  cursorDate = new Date();
  bookingModal.close();
  detailsModal.close();
  refreshDataAndRender();
});

monthViewBtn?.addEventListener("click", () => {
  viewMode = "month";
  refreshDataAndRender();
});

weekViewBtn?.addEventListener("click", () => {
  viewMode = "week";
  refreshDataAndRender();
});

prevBtn?.addEventListener("click", () => {
  cursorDate = new Date(cursorDate);
  if (viewMode === "month") cursorDate.setMonth(cursorDate.getMonth() - 1);
  else if (viewMode === "day") cursorDate.setDate(cursorDate.getDate() - 1);
  else cursorDate.setDate(cursorDate.getDate() - 7);
  refreshDataAndRender();
});

nextBtn?.addEventListener("click", () => {
  cursorDate = new Date(cursorDate);
  if (viewMode === "month") cursorDate.setMonth(cursorDate.getMonth() + 1);
  else if (viewMode === "day") cursorDate.setDate(cursorDate.getDate() + 1);
  else cursorDate.setDate(cursorDate.getDate() + 7);
  refreshDataAndRender();
});

languageMenuToggle?.addEventListener("click", (event) => {
  event.stopPropagation();
  const willOpen = !languageMenu?.classList.contains("is-open");
  languageMenu?.classList.toggle("is-open");
  languageMenuToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
  gearMenu?.classList.remove("is-open");
});

languageButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setLanguage(button.dataset.language);
  });
});

gearMenuToggle?.addEventListener("click", (event) => {
  event.stopPropagation();
  gearMenu.classList.toggle("is-open");
  gearMenuToggle.setAttribute("aria-expanded", gearMenu.classList.contains("is-open") ? "true" : "false");
  languageMenu?.classList.remove("is-open");
  languageMenuToggle?.setAttribute("aria-expanded", "false");
});

document.addEventListener("click", () => {
  gearMenu?.classList.remove("is-open");
  gearMenuToggle?.setAttribute("aria-expanded", "false");
  languageMenu?.classList.remove("is-open");
  languageMenuToggle?.setAttribute("aria-expanded", "false");
});
languageMenuDropdown?.addEventListener("click", (event) => event.stopPropagation());
gearMenuDropdown?.addEventListener("click", (event) => event.stopPropagation());

darkModeToggle?.addEventListener("click", async () => {
  const nextTheme = document.body.classList.contains("theme-dark") ? "light" : "dark";
  if (window.CtshTheme?.applyTheme) {
    window.CtshTheme.applyTheme(nextTheme, {
      bodyClass: "theme-dark",
      onApply: () => updateDarkModeLabel()
    });
    await window.CtshTheme.persistTheme(nextTheme, { tokenStorageKeys: [TOKEN_KEY] });
  } else {
    document.body.classList.toggle("theme-dark", nextTheme === "dark");
  }
  updateDarkModeLabel();
  gearMenu?.classList.remove("is-open");
  gearMenuToggle?.setAttribute("aria-expanded", "false");
});

moduleDashboardBtn?.addEventListener("click", () => {
  window.location.href = "/public/dashboard.html";
});

logoutBtn?.addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "include" });
  } catch {
    // ignore
  }
  window.location.href = "/login.html";
});

liveSocket?.on("connect", () => {
  scheduleLiveRefresh();
});

liveSocket?.on("bookingsChanged", () => {
  scheduleLiveRefresh();
});

liveSocket?.on("connect_error", (error) => {
  console.error("Container planning live update connection failed:", error?.message || error);
});

function createBookingModal({ onSave }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3 data-booking-create-title></h3>
      <form id="bookingCreateForm" class="form-grid">
        <label><span data-booking-title-label></span><input name="title" required /></label>
        <label><span><span data-booking-container-label></span> <span class="field-optional" data-booking-optional-label></span></span><input name="container" /></label>
        <label><span data-booking-plate-label></span><input name="kennzeichen" /></label>
        <label><span data-booking-order-label></span><input name="auftrag" /></label>
        <label><span data-booking-warehouse-label></span><input name="lager" required /></label>
        <label><span data-booking-date-label></span><input type="date" name="date" required /></label>
        <label><span data-booking-type-label></span>
          <select name="type">
            <option value="direct_unload"></option>
            <option value="hand_unload"></option>
            <option value="truck_delivery"></option>
            <option value="special_storage"></option>
          </select>
        </label>
        <p class="hint-text" data-booking-hint></p>
        <div class="modal-actions">
          <button type="button" class="btn" data-close data-booking-cancel></button>
          <button type="submit" class="btn btn--primary" data-booking-save></button>
        </div>
      </form>
    </div>
  `;

  const form = overlay.querySelector("#bookingCreateForm");
  const titleNode = overlay.querySelector("[data-booking-create-title]");
  const titleLabelNode = overlay.querySelector("[data-booking-title-label]");
  const containerLabelNode = overlay.querySelector("[data-booking-container-label]");
  const optionalLabelNode = overlay.querySelector("[data-booking-optional-label]");
  const plateLabelNode = overlay.querySelector("[data-booking-plate-label]");
  const orderLabelNode = overlay.querySelector("[data-booking-order-label]");
  const warehouseLabelNode = overlay.querySelector("[data-booking-warehouse-label]");
  const dateLabelNode = overlay.querySelector("[data-booking-date-label]");
  const typeLabelNode = overlay.querySelector("[data-booking-type-label]");
  const typeSelect = form.querySelector('select[name="type"]');
  const hintNode = overlay.querySelector("[data-booking-hint]");
  const cancelButton = overlay.querySelector("[data-booking-cancel]");
  const saveButton = overlay.querySelector("[data-booking-save]");

  function updateTexts() {
    titleNode.textContent = t("bookingCreateTitle");
    titleLabelNode.textContent = t("titleLabel");
    containerLabelNode.textContent = t("containerLabel");
    optionalLabelNode.textContent = t("optional");
    plateLabelNode.textContent = t("licensePlateLabel");
    orderLabelNode.textContent = t("orderNumberLabel");
    warehouseLabelNode.textContent = t("warehouseLabel");
    dateLabelNode.textContent = t("dateLabel");
    typeLabelNode.textContent = t("typeLabel");
    typeSelect.options[0].textContent = t("bookingTypeOption_direct_unload");
    typeSelect.options[1].textContent = t("bookingTypeOption_hand_unload");
    typeSelect.options[2].textContent = t("bookingTypeOption_truck_delivery");
    typeSelect.options[3].textContent = t("bookingTypeOption_special_storage");
    hintNode.textContent = t("bookingHint");
    cancelButton.textContent = t("cancel");
    saveButton.textContent = t("save");
  }

  function open(defaultDate) {
    form.reset();
    form.date.value = defaultDate;
    overlay.classList.add("is-open");
  }

  function close() {
    overlay.classList.remove("is-open");
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.dataset.close !== undefined) close();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    onSave({
      title: data.get("title").toString().trim(),
      container: data.get("container").toString().trim(),
      kennzeichen: data.get("kennzeichen").toString().trim(),
      auftrag: data.get("auftrag").toString().trim(),
      lager: data.get("lager").toString().trim(),
      date: data.get("date").toString(),
      type: data.get("type").toString(),
      attachments: []
    })
      .then(() => close())
      .catch((error) => {
        console.error(error);
        window.alert(error.message || t("bookingSaveFailed"));
      });
  });

  updateTexts();
  return { overlay, open, close, updateTexts };
}

function createConfirmDialog() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay modal-overlay--confirm";
  overlay.innerHTML = `
    <div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmDialogTitle" aria-describedby="confirmDialogMessage">
      <div class="confirm-modal__header">
        <div class="confirm-modal__badge" aria-hidden="true">!</div>
        <div>
          <p class="confirm-modal__eyebrow">Bitte bestÃ¤tigen</p>
          <h3 id="confirmDialogTitle">Eintrag lÃ¶schen?</h3>
        </div>
      </div>
      <p class="confirm-modal__message" id="confirmDialogMessage"></p>
      <p class="confirm-modal__hint">Dieser Vorgang kann nicht rÃ¼ckgÃ¤ngig gemacht werden.</p>
      <div class="modal-actions confirm-modal__actions">
        <button type="button" class="btn" data-confirm-cancel>Abbrechen</button>
        <button type="button" class="btn btn--danger-solid" data-confirm-accept>EndgÃ¼ltig lÃ¶schen</button>
      </div>
    </div>
  `;

  const eyebrowNode = overlay.querySelector(".confirm-modal__eyebrow");
  const titleNode = overlay.querySelector("#confirmDialogTitle");
  const messageNode = overlay.querySelector("#confirmDialogMessage");
  const hintNode = overlay.querySelector(".confirm-modal__hint");
  const cancelBtn = overlay.querySelector("[data-confirm-cancel]");
  const acceptBtn = overlay.querySelector("[data-confirm-accept]");
  let resolver = null;
  let lastState = {
    title: "",
    message: "",
    confirmLabel: ""
  };

  function updateTexts() {
    eyebrowNode.textContent = t("confirmEyebrow");
    hintNode.textContent = t("confirmHint");
    cancelBtn.textContent = t("cancel");
    titleNode.textContent = lastState.title || t("confirmDeleteTitle");
    messageNode.textContent = lastState.message || "";
    acceptBtn.textContent = lastState.confirmLabel || t("confirmDeleteAction");
  }

  function close(result) {
    overlay.classList.remove("is-open");
    if (resolver) resolver(result);
    resolver = null;
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.dataset.confirmCancel !== undefined) close(false);
    if (event.target.dataset.confirmAccept !== undefined) close(true);
  });

  document.addEventListener("keydown", (event) => {
    if (!overlay.classList.contains("is-open")) return;
    if (event.key === "Escape") close(false);
  });

  async function confirm({ title, message, confirmLabel }) {
    titleNode.textContent = title || "Eintrag lÃ¶schen?";
    lastState = {
      title: title || t("confirmDeleteTitle"),
      message: message || "",
      confirmLabel: confirmLabel || t("confirmDeleteAction")
    };
    updateTexts();
    overlay.classList.add("is-open");
    queueMicrotask(() => acceptBtn.focus());
    return new Promise((resolve) => {
      resolver = resolve;
      cancelBtn.blur();
    });
  }

  updateTexts();
  return { overlay, confirm, updateTexts };
}

function createBookingDetailsModal({ onBookingUpdate, onBookingDelete }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal modal--details" role="dialog" aria-modal="true">
      <div class="details-head">
        <h3 id="detailsTitle">Buchungsdetails</h3>
        <button class="btn btn--icon" data-close aria-label="Schliessen">x</button>
      </div>
      <div class="details-content">
        <div class="details-grid" id="detailsMeta"></div>
        <section>
          <h4>Anhaenge (Fotos / Dateien)</h4>
          <input id="detailsUploadInput" type="file" multiple />
          <p class="hint-text">Uploads bleiben wie im Altmodul lokal im aktuellen Browser.</p>
          <ul class="attachment-list" id="attachmentList"></ul>
        </section>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn--danger" data-delete-booking>Buchung l\u00f6schen</button>
        <button type="button" class="btn" data-close>Schliessen</button>
      </div>
    </div>
  `;

  const meta = overlay.querySelector("#detailsMeta");
  const attachmentList = overlay.querySelector("#attachmentList");
  const uploadInput = overlay.querySelector("#detailsUploadInput");
  const detailsTitle = overlay.querySelector("#detailsTitle");
  const detailsCloseIcon = overlay.querySelector(".details-head [data-close]");
  const attachmentsTitle = overlay.querySelector(".details-content h4");
  const attachmentsHint = overlay.querySelector(".details-content .hint-text");
  const deleteBookingButton = overlay.querySelector("[data-delete-booking]");
  const footerCloseButton = overlay.querySelector('.modal-actions [data-close]');
  let currentBooking = null;

  function updateTexts() {
    if (!currentBooking) detailsTitle.textContent = t("detailsTitle");
    detailsCloseIcon.setAttribute("aria-label", t("close"));
    attachmentsTitle.textContent = t("attachmentsTitle");
    attachmentsHint.textContent = t("attachmentsHint");
    deleteBookingButton.textContent = t("deleteBooking");
    deleteBookingButton.style.display = canDeletePlanningBookings() ? "" : "none";
    footerCloseButton.textContent = t("close");
    if (currentBooking) renderDetails();
  }

  function renderDetails() {
    if (!currentBooking) return;
    deleteBookingButton.style.display = canDeletePlanningBookings() ? "" : "none";
    detailsTitle.textContent = `${t("bookingPrefix")}: ${currentBooking.title}`;
    const metaEntries = [
      { label: t("titleLabel"), value: currentBooking.title },
      { label: t("bookingCardContainer"), value: currentBooking.container },
      { label: t("bookingCardPlate"), value: currentBooking.kennzeichen },
      { label: t("bookingCardOrder"), value: currentBooking.auftrag },
      { label: t("bookingCardWarehouse"), value: currentBooking.lager },
      { label: t("dateLabel"), value: currentBooking.date },
      { label: t("typeLabel"), value: getBookingTypeLabel(currentBooking.type) }
    ].filter((entry) => hasDisplayValue(entry.value));

    meta.innerHTML = metaEntries
      .map((entry) => `<article><span>${escapeHtml(entry.label)}</span><strong>${escapeHtml(entry.value)}</strong></article>`)
      .join("");

    attachmentList.innerHTML = "";
    if (!(currentBooking.attachments || []).length) {
      const empty = document.createElement("li");
      empty.className = "attachment-empty";
      empty.textContent = t("noAttachments");
      attachmentList.append(empty);
      return;
    }

    currentBooking.attachments.forEach((file, idx) => {
      const item = document.createElement("li");
      item.className = "attachment-item";
      const isImage = (file.type || "").startsWith("image/");
      item.innerHTML = `
        <div><strong>${escapeHtml(file.name)}</strong><p>${Math.ceil(file.size / 1024)} KB</p></div>
        <div class="attachment-actions">
          <a class="btn" href="${file.url}" download="${escapeHtml(file.name)}">${escapeHtml(t("download"))}</a>
          <button class="btn btn--danger" data-delete="${idx}">${escapeHtml(t("remove"))}</button>
        </div>
      `;
      if (isImage) {
        const img = document.createElement("img");
        img.src = file.url;
        img.alt = file.name;
        img.className = "attachment-preview";
        item.prepend(img);
      }
      attachmentList.append(item);
    });
  }

  function open(booking) {
    currentBooking = booking;
    renderDetails();
    overlay.classList.add("is-open");
  }

  function close() {
    overlay.classList.remove("is-open");
    uploadInput.value = "";
    currentBooking = null;
  }

  function syncWithBookings(nextBookings) {
    if (!currentBooking) return;

    const nextBooking = nextBookings.find((booking) => booking.id === currentBooking.id);
    if (!nextBooking) {
      close();
      return;
    }

    currentBooking = nextBooking;
    renderDetails();
  }

  overlay.addEventListener("click", async (event) => {
    if (event.target === overlay || event.target.dataset.close !== undefined) {
      close();
      return;
    }

    if (event.target.dataset.deleteBooking !== undefined && currentBooking) {
      if (!canDeletePlanningBookings()) return;
      const translatedConfirmed = await confirmDialog.confirm({
        title: t("deleteBookingConfirmTitle"),
        message: t("deleteBookingConfirmMessage", { title: currentBooking.title })
      });
      if (!translatedConfirmed) return;
      onBookingDelete(currentBooking.id)
        .then(() => close())
        .catch((error) => {
          console.error(error);
          window.alert(error.message || t("bookingDeleteFailed"));
        });
      return;
    }

    if (event.target.dataset.delete !== undefined && currentBooking) {
      const index = Number(event.target.dataset.delete);
      const removed = currentBooking.attachments.splice(index, 1)[0];
      if (removed?.url) URL.revokeObjectURL(removed.url);
      onBookingUpdate(currentBooking);
      renderDetails();
    }
  });

  uploadInput.addEventListener("change", () => {
    if (!currentBooking) return;
    const files = Array.from(uploadInput.files || []);
    const mapped = files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      url: URL.createObjectURL(file)
    }));
    currentBooking.attachments = [...(currentBooking.attachments || []), ...mapped];
    onBookingUpdate(currentBooking);
    uploadInput.value = "";
    renderDetails();
  });

  updateTexts();
  return { overlay, open, close, syncWithBookings, updateTexts };
}


