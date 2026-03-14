const weekdayHeader = document.getElementById("weekdayHeader");
const calendarGrid = document.getElementById("calendarGrid");
const rangeLabel = document.getElementById("rangeLabel");
const todayBtn = document.getElementById("todayBtn");
const monthViewBtn = document.getElementById("monthViewBtn");
const weekViewBtn = document.getElementById("weekViewBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const gearMenu = document.getElementById("gearMenu");
const gearMenuToggle = document.getElementById("gearMenuToggle");
const gearMenuDropdown = document.getElementById("gearMenuDropdown");
const darkModeToggle = document.getElementById("darkModeToggle");
const moduleDashboardBtn = document.getElementById("moduleDashboardBtn");
const logoutBtn = document.getElementById("logoutBtn");

const DARK_MODE_KEY = "containerplanung.darkmode";
const TOKEN_KEY = "token";
const urlState = new URL(window.location.href);
const queryPortalToken = String(urlState.searchParams.get("portalToken") || "").trim();
if (queryPortalToken) {
  localStorage.setItem(TOKEN_KEY, queryPortalToken);
  urlState.searchParams.delete("portalToken");
  history.replaceState({}, document.title, `${urlState.pathname}${urlState.search}${urlState.hash}`);
}
const portalToken = String(localStorage.getItem(TOKEN_KEY) || "").trim();
const weekdays = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const bookings = [];
let viewMode = "month";
let cursorDate = new Date();

const bookingModal = createBookingModal({
  async onSave(newBooking) {
    const createdBooking = await createBooking(newBooking);
    bookings.push(createdBooking);
    render();
  }
});

const deleteConfirmationModal = createDeleteConfirmationModal();

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
document.body.append(deleteConfirmationModal.overlay);
document.body.append(detailsModal.overlay);

initApp();

async function initApp() {
  const authenticated = await ensureAuthenticated();
  if (!authenticated) return;
  applyInitialTheme();
  render();
  refreshDataAndRender();
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
    throw new Error("Buchungen konnten nicht geladen werden.");
  }

  const rows = await response.json();
  bookings.splice(0, bookings.length, ...rows.map(mapApiBookingToUi));
}

async function createBooking(booking) {
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
    throw new Error(payload?.message || "Buchung konnte nicht gespeichert werden.");
  }

  return mapApiBookingToUi(await response.json());
}

async function deleteBooking(bookingId) {
  const response = await fetch(`/api/modules/container-planning/bookings/${encodeURIComponent(bookingId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: portalToken ? { Authorization: `Bearer ${portalToken}` } : {}
  });
  if (!response.ok) {
    const payload = await safeReadJson(response);
    throw new Error(payload?.message || "Buchung konnte nicht geloescht werden.");
  }
}

async function updateBookingDate(bookingId, date) {
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
    throw new Error(payload?.message || "Buchungsdatum konnte nicht gespeichert werden.");
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
    node.textContent = cursorDate.toLocaleDateString("de-DE", { weekday: "long" });
    weekdayHeader.append(node);
    return;
  }

  weekdayHeader.innerHTML = "";
  weekdays.forEach((day) => {
    const node = document.createElement("div");
    node.className = "weekday";
    node.textContent = day;
    weekdayHeader.append(node);
  });
}

function renderRangeLabel() {
  if (!rangeLabel) return;
  if (viewMode === "month") {
    rangeLabel.textContent = cursorDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  } else if (viewMode === "day") {
    rangeLabel.textContent = cursorDate.toLocaleDateString("de-DE", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  } else {
    const { start, end } = getWeekRange(cursorDate);
    rangeLabel.textContent = `${start.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} - ${end.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
  }
}

function renderGrid() {
  calendarGrid.innerHTML = "";
  calendarGrid.classList.toggle("calendar-grid--day", viewMode === "day");
  weekdayHeader.classList.toggle("weekdays--day", viewMode === "day");
  const days = viewMode === "month" ? buildMonthCells(cursorDate) : buildWeekCells(cursorDate);

  days.forEach(({ date, isCurrentMonth }) => {
    const ymd = toYmd(date);
    const dayCard = document.createElement("article");
    dayCard.className = `day-card ${isCurrentMonth ? "" : "day-card--other-month"} ${isToday(date) ? "day-card--today" : ""}`.trim();
    dayCard.dataset.date = ymd;

    const dateNode = document.createElement("div");
    dateNode.className = "day-card__date";
    dateNode.textContent = `${date.getDate()}.${date.getMonth() + 1}.`;
    dayCard.append(dateNode);

    const matches = bookings.filter((item) => item.date === ymd);
    const compact = matches.length > 1;
    matches.forEach((booking) => dayCard.append(createBookingCard(booking, { compact })));

    dayCard.addEventListener("click", (event) => {
      if (event.target.closest(".booking-card")) return;
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
        window.alert(error.message || "Buchung konnte nicht verschoben werden.");
      }
    });

    calendarGrid.append(dayCard);
  });
}

function createBookingCard(booking, { compact = false } = {}) {
  const card = document.createElement("div");
  card.className = `booking-card ${compact ? "booking-card--compact" : ""}`.trim();
  card.draggable = true;
  card.dataset.type = booking.type;
  card.innerHTML = compact
    ? `<strong>${escapeHtml(booking.title)}</strong>Container: ${escapeHtml(booking.container)}`
    : `
      <strong>${escapeHtml(booking.title)}</strong>
      Container: ${escapeHtml(booking.container)}<br />
      Kennzeichen: ${escapeHtml(booking.kennzeichen)}<br />
      Auftrag: ${escapeHtml(booking.auftrag)}<br />
      Lager: ${escapeHtml(booking.lager || "-")}
    `;

  card.addEventListener("click", (event) => {
    event.stopPropagation();
    detailsModal.open(booking);
  });

  card.addEventListener("dragstart", (event) => {
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
  loadBookingsForCurrentMonth()
    .then(() => render())
    .catch((error) => {
      console.error(error);
      render();
    });
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
  return {
    direct_unload: "Container Direktentladung",
    hand_unload: "Container Handentladung",
    truck_delivery: "LKW Anlieferung",
    special_storage: "Sonderarbeiten Lager"
  }[type] || type;
}

function syncViewButtons() {
  monthViewBtn?.classList.toggle("is-active", viewMode === "month");
  monthViewBtn?.classList.toggle("btn--primary", viewMode === "month");
  monthViewBtn?.classList.toggle("btn--ghost", viewMode !== "month");
  weekViewBtn?.classList.toggle("is-active", viewMode === "week");
  weekViewBtn?.classList.toggle("btn--primary", viewMode === "week");
  weekViewBtn?.classList.toggle("btn--ghost", viewMode !== "week");
}

function applyInitialTheme() {
  const isDark = localStorage.getItem(DARK_MODE_KEY) === "1";
  document.body.classList.toggle("theme-dark", isDark);
  if (darkModeToggle) darkModeToggle.textContent = isDark ? "Light Mode" : "Dark Mode";
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

gearMenuToggle?.addEventListener("click", (event) => {
  event.stopPropagation();
  gearMenu.classList.toggle("is-open");
});

document.addEventListener("click", () => gearMenu?.classList.remove("is-open"));
gearMenuDropdown?.addEventListener("click", (event) => event.stopPropagation());

darkModeToggle?.addEventListener("click", () => {
  const enabled = !document.body.classList.contains("theme-dark");
  document.body.classList.toggle("theme-dark", enabled);
  localStorage.setItem(DARK_MODE_KEY, enabled ? "1" : "0");
  darkModeToggle.textContent = enabled ? "Light Mode" : "Dark Mode";
  gearMenu?.classList.remove("is-open");
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

function createBookingModal({ onSave }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>Neue Buchung erstellen</h3>
      <form id="bookingCreateForm" class="form-grid">
        <label>Titel<input name="title" required /></label>
        <label>Containernummer<input name="container" required /></label>
        <label>Kennzeichen<input name="kennzeichen" required /></label>
        <label>Auftragsnummer<input name="auftrag" required /></label>
        <label>Lager<input name="lager" required /></label>
        <label>Datum<input type="date" name="date" required /></label>
        <label>Typ
          <select name="type">
            <option value="direct_unload">Container Direktentladung (Blau)</option>
            <option value="hand_unload">Container Handentladung (Gruen)</option>
            <option value="truck_delivery">LKW Anlieferung (Grau)</option>
            <option value="special_storage">Sonderarbeiten Lager (Rot)</option>
          </select>
        </label>
        <p class="hint-text">Hinweis: Fotos und Dateien bleiben lokal im Browser wie im Altmodul.</p>
        <div class="modal-actions">
          <button type="button" class="btn" data-close>Abbrechen</button>
          <button type="submit" class="btn btn--primary">Speichern</button>
        </div>
      </form>
    </div>
  `;

  const form = overlay.querySelector("#bookingCreateForm");

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
        window.alert(error.message || "Buchung konnte nicht gespeichert werden.");
      });
  });

  return { overlay, open, close };
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
  let currentBooking = null;
  let deleteInFlight = false;

  function renderDetails() {
    if (!currentBooking) return;
    detailsTitle.textContent = `Buchung: ${currentBooking.title}`;
    meta.innerHTML = `
      <article><span>Titel</span><strong>${escapeHtml(currentBooking.title)}</strong></article>
      <article><span>Container</span><strong>${escapeHtml(currentBooking.container)}</strong></article>
      <article><span>Kennzeichen</span><strong>${escapeHtml(currentBooking.kennzeichen)}</strong></article>
      <article><span>Auftrag</span><strong>${escapeHtml(currentBooking.auftrag)}</strong></article>
      <article><span>Lager</span><strong>${escapeHtml(currentBooking.lager || "-")}</strong></article>
      <article><span>Datum</span><strong>${escapeHtml(currentBooking.date)}</strong></article>
      <article><span>Typ</span><strong>${escapeHtml(getBookingTypeLabel(currentBooking.type))}</strong></article>
    `;

    attachmentList.innerHTML = "";
    if (!(currentBooking.attachments || []).length) {
      const empty = document.createElement("li");
      empty.className = "attachment-empty";
      empty.textContent = "Noch keine Anhaenge vorhanden.";
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
          <a class="btn" href="${file.url}" download="${escapeHtml(file.name)}">Download</a>
          <button class="btn btn--danger" data-delete="${idx}">Entfernen</button>
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

  overlay.addEventListener("click", async (event) => {
    if (event.target === overlay || event.target.dataset.close !== undefined) {
      close();
      return;
    }

    if (event.target.dataset.deleteBooking !== undefined && currentBooking) {
      if (deleteInFlight) return;
      const confirmed = await deleteConfirmationModal.open({
        title: currentBooking.title,
        date: currentBooking.date,
        container: currentBooking.container
      });
      if (!confirmed || !currentBooking) return;

      deleteInFlight = true;
      onBookingDelete(currentBooking.id)
        .then(() => close())
        .catch((error) => {
          console.error(error);
          window.alert(error.message || "Buchung konnte nicht gel\u00f6scht werden.");
        })
        .finally(() => {
          deleteInFlight = false;
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

  return { overlay, open, close };
}

function createDeleteConfirmationModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal modal--confirm" role="dialog" aria-modal="true" aria-labelledby="deleteConfirmTitle">
      <div class="confirm-dialog">
        <div class="confirm-dialog__badge">Sicherheitsabfrage</div>
        <h3 class="confirm-dialog__title" id="deleteConfirmTitle">Buchung endg\u00fcltig l\u00f6schen?</h3>
        <p class="confirm-dialog__text">
          Bitte pr\u00fcfen Sie den Vorgang sorgf\u00e4ltig. Nach dem Best\u00e4tigen wird die ausgew\u00e4hlte Buchung dauerhaft entfernt und kann nicht wiederhergestellt werden.
        </p>
        <div class="confirm-delete">
          <p class="confirm-delete__text" id="deleteConfirmBooking"></p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" data-confirm-cancel>Abbrechen</button>
          <button type="button" class="btn btn--danger" data-confirm-accept>Endg\u00fcltig l\u00f6schen</button>
        </div>
      </div>
    </div>
  `;

  const bookingText = overlay.querySelector("#deleteConfirmBooking");
  let resolver = null;

  function close(result) {
    overlay.classList.remove("is-open");
    const resolve = resolver;
    resolver = null;
    if (resolve) resolve(result);
  }

  function open({ title, date, container }) {
    bookingText.textContent = `Buchung: ${title || "-"} | Termin: ${date || "-"} | Container: ${container || "-"}`;
    overlay.classList.add("is-open");
    return new Promise((resolve) => {
      resolver = resolve;
    });
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.dataset.confirmCancel !== undefined) {
      close(false);
      return;
    }

    if (event.target.dataset.confirmAccept !== undefined) {
      close(true);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.classList.contains("is-open")) {
      close(false);
    }
  });

  return { overlay, open, close };
}
