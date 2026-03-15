const { pool } = require("../../db_pg");

const STORAGE_LOCATION_TYPES = ["Regal", "Bodenstellplatz"];
const TRANSACTION_TYPES = ["IN", "OUT", "TRANSFER"];
const PICKING_STATUSES = ["OFFEN", "IN_BEARBEITUNG", "ERLEDIGT"];
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 1000;

const INVENTORY_SELECT = `
  SELECT
    i.id,
    i.storage_location_id,
    sl.typ AS storage_location_type,
    sl.name AS storage_location_name,
    sl.kapazitaet AS storage_location_capacity,
    i.article_id,
    a.artikel_nr,
    a.bezeichnung,
    a.beschreibung,
    i.menge,
    i.created_at,
    i.updated_at
  FROM inventory i
  INNER JOIN storage_locations sl ON sl.id = i.storage_location_id
  INNER JOIN articles a ON a.id = i.article_id
`;

const TRANSACTION_SELECT = `
  SELECT
    t.id,
    t.typ,
    t.article_id,
    a.artikel_nr,
    a.bezeichnung,
    a.beschreibung,
    t.menge,
    t.storage_location_from_id,
    slf.name AS storage_location_from_name,
    t.storage_location_to_id,
    slt.name AS storage_location_to_name,
    t.customer_id,
    c.kunden_nr,
    c.name AS customer_name,
    t.beleg_nr,
    t.positions_nr,
    t.user_id,
    u.username,
    t.datum,
    t.notiz,
    t.created_at
  FROM transactions t
  INNER JOIN articles a ON a.id = t.article_id
  LEFT JOIN storage_locations slf ON slf.id = t.storage_location_from_id
  LEFT JOIN storage_locations slt ON slt.id = t.storage_location_to_id
  LEFT JOIN customers c ON c.id = t.customer_id
  LEFT JOIN users u ON u.id = t.user_id
`;

const PICKING_ORDER_SELECT = `
  SELECT
    po.id,
    po.status,
    po.customer_id,
    c.kunden_nr,
    c.name AS customer_name,
    po.beleg_nr,
    po.ersteller_user_id,
    eu.username AS ersteller_username,
    po.bearbeiter_user_id,
    bu.username AS bearbeiter_username,
    po.faellig_am,
    po.created_at,
    COUNT(poi.id)::int AS item_count,
    COALESCE(SUM(poi.menge_soll), 0)::int AS menge_soll_gesamt,
    COALESCE(SUM(poi.menge_ist), 0)::int AS menge_ist_gesamt
  FROM picking_orders po
  LEFT JOIN customers c ON c.id = po.customer_id
  LEFT JOIN users eu ON eu.id = po.ersteller_user_id
  LEFT JOIN users bu ON bu.id = po.bearbeiter_user_id
  LEFT JOIN picking_order_items poi ON poi.order_id = po.id
`;

class WarehouseError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "WarehouseError";
    this.status = status;
    this.details = details;
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeLimit(value) {
  const parsed = Number(value || DEFAULT_LIST_LIMIT);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(parsed, MAX_LIST_LIMIT);
}

function normalizeText(value, field, options = {}) {
  const { required = false, maxLength = 255, allowEmpty = false } = options;
  const raw = value === null || value === undefined ? "" : String(value).trim();
  if (!raw) {
    if (required) throw new WarehouseError(400, `${field} is required`);
    return allowEmpty ? "" : null;
  }
  if (raw.length > maxLength) {
    throw new WarehouseError(400, `${field} exceeds ${maxLength} characters`);
  }
  return raw;
}

function normalizeInteger(value, field, options = {}) {
  const { required = false, min = null, max = null, allowNull = false } = options;
  if (value === null || value === undefined || value === "") {
    if (required) throw new WarehouseError(400, `${field} is required`);
    return allowNull ? null : undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new WarehouseError(400, `${field} must be an integer`);
  }
  if (min !== null && parsed < min) {
    throw new WarehouseError(400, `${field} must be >= ${min}`);
  }
  if (max !== null && parsed > max) {
    throw new WarehouseError(400, `${field} must be <= ${max}`);
  }
  return parsed;
}

function normalizeEnum(value, allowedValues, field, options = {}) {
  const { required = false, defaultValue = null } = options;
  if (value === null || value === undefined || value === "") {
    if (required && defaultValue === null) throw new WarehouseError(400, `${field} is required`);
    return defaultValue;
  }
  const normalized = String(value).trim();
  if (!allowedValues.includes(normalized)) {
    throw new WarehouseError(400, `${field} is invalid`);
  }
  return normalized;
}

function normalizeDateTime(value, field, options = {}) {
  const { required = false, defaultNow = false } = options;
  if (value === null || value === undefined || value === "") {
    if (defaultNow) return new Date().toISOString();
    if (required) throw new WarehouseError(400, `${field} is required`);
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new WarehouseError(400, `${field} is invalid`);
  }
  return parsed.toISOString();
}

function normalizeDateOnly(value, field, options = {}) {
  const { required = false } = options;
  if (value === null || value === undefined || value === "") {
    if (required) throw new WarehouseError(400, `${field} is required`);
    return null;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new WarehouseError(400, `${field} is invalid`);
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeDateTimeFilter(value, mode) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const suffix = mode === "end" ? "T23:59:59.999" : "T00:00:00.000";
    const parsed = new Date(`${raw}${suffix}`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return normalizeDateTime(raw, `date_${mode}`, { required: false });
}

function translateDbError(error, options = {}) {
  if (error instanceof WarehouseError) return error;
  if (error?.code === "23505") {
    return new WarehouseError(409, options.uniqueMessage || "Record already exists");
  }
  if (error?.code === "23503") {
    return new WarehouseError(400, options.fkMessage || "Referenced record not found");
  }
  if (error?.code === "23514") {
    return new WarehouseError(400, options.checkMessage || "Validation failed");
  }
  return error;
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getOneOrNull(executor, sql, params = []) {
  const result = await executor.query(sql, params);
  return result.rowCount ? result.rows[0] : null;
}

async function getInventoryById(executor, id) {
  return getOneOrNull(
    executor,
    `${INVENTORY_SELECT}
     WHERE i.id = $1`,
    [id]
  );
}

async function getTransactionById(executor, id) {
  return getOneOrNull(
    executor,
    `${TRANSACTION_SELECT}
     WHERE t.id = $1`,
    [id]
  );
}

async function getPickingOrderById(executor, id) {
  const order = await getOneOrNull(
    executor,
    `${PICKING_ORDER_SELECT}
     WHERE po.id = $1
     GROUP BY po.id, c.kunden_nr, c.name, eu.username, bu.username`,
    [id]
  );
  if (!order) return null;

  const items = (
    await executor.query(
      `
      SELECT
        poi.id,
        poi.order_id,
        poi.article_id,
        a.artikel_nr,
        a.bezeichnung,
        poi.menge_soll,
        poi.menge_ist
      FROM picking_order_items poi
      INNER JOIN articles a ON a.id = poi.article_id
      WHERE poi.order_id = $1
      ORDER BY poi.id ASC
      `,
      [id]
    )
  ).rows;

  return { ...order, items };
}

function normalizeMovementPayload(payload, options = {}) {
  const { requireAll = true } = options;
  const typ = normalizeEnum(payload.typ, TRANSACTION_TYPES, "typ", { required: requireAll });
  const articleId = normalizeInteger(payload.article_id, "article_id", { required: requireAll, min: 1 });
  const menge = normalizeInteger(payload.menge, "menge", { required: requireAll, min: 1 });
  const storageLocationFromId = normalizeInteger(payload.storage_location_from_id, "storage_location_from_id", {
    required: false,
    min: 1,
    allowNull: true
  });
  const storageLocationToId = normalizeInteger(payload.storage_location_to_id, "storage_location_to_id", {
    required: false,
    min: 1,
    allowNull: true
  });
  const customerId = normalizeInteger(payload.customer_id, "customer_id", {
    required: false,
    min: 1,
    allowNull: true
  });
  const belegNr = normalizeText(payload.beleg_nr, "beleg_nr", { required: false, maxLength: 120 });
  const positionsNr = normalizeText(payload.positions_nr, "positions_nr", { required: false, maxLength: 120 });
  const datum = normalizeDateTime(payload.datum, "datum", { required: false, defaultNow: true });
  const notiz = normalizeText(payload.notiz, "notiz", { required: false, maxLength: 4000 });

  if (!typ && !requireAll) {
    throw new WarehouseError(400, "typ is required");
  }

  if (typ === "IN") {
    if (!storageLocationToId) throw new WarehouseError(400, "storage_location_to_id is required for IN");
    if (storageLocationFromId) throw new WarehouseError(400, "storage_location_from_id must be empty for IN");
  }
  if (typ === "OUT") {
    if (!storageLocationFromId) throw new WarehouseError(400, "storage_location_from_id is required for OUT");
    if (storageLocationToId) throw new WarehouseError(400, "storage_location_to_id must be empty for OUT");
  }
  if (typ === "TRANSFER") {
    if (!storageLocationFromId || !storageLocationToId) {
      throw new WarehouseError(400, "storage_location_from_id and storage_location_to_id are required for TRANSFER");
    }
    if (storageLocationFromId === storageLocationToId) {
      throw new WarehouseError(400, "TRANSFER requires different source and destination locations");
    }
  }

  return {
    typ,
    article_id: articleId,
    menge,
    storage_location_from_id: storageLocationFromId || null,
    storage_location_to_id: storageLocationToId || null,
    customer_id: customerId || null,
    beleg_nr: belegNr,
    positions_nr: positionsNr,
    datum,
    notiz
  };
}

function buildInventoryEffects(movement, direction) {
  const qty = movement.menge * direction;
  if (movement.typ === "IN") {
    return [{ locationId: movement.storage_location_to_id, delta: qty }];
  }
  if (movement.typ === "OUT") {
    return [{ locationId: movement.storage_location_from_id, delta: qty * -1 }];
  }
  return [
    { locationId: movement.storage_location_from_id, delta: qty * -1 },
    { locationId: movement.storage_location_to_id, delta: qty }
  ];
}

async function applyInventoryDelta(client, articleId, locationId, delta) {
  if (!delta) return;

  if (delta > 0) {
    await client.query(
      `
      INSERT INTO inventory (storage_location_id, article_id, menge, created_at, updated_at)
      VALUES ($1, $2, $3, now(), now())
      ON CONFLICT (storage_location_id, article_id)
      DO UPDATE SET menge = inventory.menge + EXCLUDED.menge, updated_at = now()
      `,
      [locationId, articleId, delta]
    );
    return;
  }

  const amount = Math.abs(delta);
  const updated = await client.query(
    `
    UPDATE inventory
    SET menge = menge - $3,
        updated_at = now()
    WHERE storage_location_id = $1
      AND article_id = $2
      AND menge >= $3
    RETURNING id, menge
    `,
    [locationId, articleId, amount]
  );

  if (updated.rowCount === 0) {
    throw new WarehouseError(
      409,
      `Insufficient inventory for article ${articleId} at storage location ${locationId}`
    );
  }

  await client.query(
    `
    DELETE FROM inventory
    WHERE storage_location_id = $1
      AND article_id = $2
      AND menge <= 0
    `,
    [locationId, articleId]
  );
}

async function applyMovement(client, movement, direction) {
  const effects = buildInventoryEffects(movement, direction);
  for (const effect of effects) {
    await applyInventoryDelta(client, movement.article_id, effect.locationId, effect.delta);
  }
}

function normalizePickingItems(items, options = {}) {
  const { required = false } = options;
  if (!Array.isArray(items)) {
    if (required) throw new WarehouseError(400, "items must be an array");
    return null;
  }
  if (required && items.length === 0) {
    throw new WarehouseError(400, "items must not be empty");
  }

  return items.map((item, index) => ({
    article_id: normalizeInteger(item?.article_id, `items[${index}].article_id`, { required: true, min: 1 }),
    menge_soll: normalizeInteger(item?.menge_soll, `items[${index}].menge_soll`, { required: true, min: 1 }),
    menge_ist: normalizeInteger(item?.menge_ist ?? 0, `items[${index}].menge_ist`, { required: true, min: 0 })
  }));
}

function buildTransactionFilters(filters = {}, options = {}) {
  const { withLimit = true } = options;
  const where = [];
  const values = [];

  const search = normalizeText(filters.search, "search", { required: false, maxLength: 200 });
  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    const idx = values.length;
    where.push(
      `(
        LOWER(COALESCE(t.beleg_nr, '')) LIKE $${idx}
        OR LOWER(COALESCE(t.positions_nr, '')) LIKE $${idx}
        OR LOWER(COALESCE(c.kunden_nr, '')) LIKE $${idx}
        OR LOWER(COALESCE(c.name, '')) LIKE $${idx}
        OR LOWER(COALESCE(a.artikel_nr, '')) LIKE $${idx}
        OR LOWER(COALESCE(a.bezeichnung, '')) LIKE $${idx}
      )`
    );
  }

  const typ = filters.typ ? normalizeEnum(filters.typ, TRANSACTION_TYPES, "typ", { required: false }) : null;
  if (typ) {
    values.push(typ);
    where.push(`t.typ = $${values.length}`);
  }

  const articleId = normalizeInteger(filters.article_id, "article_id", { required: false, min: 1, allowNull: true });
  if (articleId) {
    values.push(articleId);
    where.push(`t.article_id = $${values.length}`);
  }

  const customerId = normalizeInteger(filters.customer_id, "customer_id", { required: false, min: 1, allowNull: true });
  if (customerId) {
    values.push(customerId);
    where.push(`t.customer_id = $${values.length}`);
  }

  const fromId = normalizeInteger(filters.storage_location_from_id, "storage_location_from_id", {
    required: false,
    min: 1,
    allowNull: true
  });
  if (fromId) {
    values.push(fromId);
    where.push(`t.storage_location_from_id = $${values.length}`);
  }

  const toId = normalizeInteger(filters.storage_location_to_id, "storage_location_to_id", {
    required: false,
    min: 1,
    allowNull: true
  });
  if (toId) {
    values.push(toId);
    where.push(`t.storage_location_to_id = $${values.length}`);
  }

  const dateFrom = normalizeDateTimeFilter(filters.date_from, "start");
  if (dateFrom) {
    values.push(dateFrom);
    where.push(`t.datum >= $${values.length}`);
  }

  const dateTo = normalizeDateTimeFilter(filters.date_to, "end");
  if (dateTo) {
    values.push(dateTo);
    where.push(`t.datum <= $${values.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = withLimit ? normalizeLimit(filters.limit) : null;

  return { whereSql, values, limit };
}

async function getDashboardSummary() {
  try {
    const summary = (
      await pool.query(
        `
        SELECT
          (SELECT COUNT(*)::int FROM customers) AS customers_count,
          (SELECT COUNT(*)::int FROM articles) AS articles_count,
          (SELECT COUNT(*)::int FROM storage_locations) AS storage_locations_count,
          (SELECT COUNT(*)::int FROM inventory) AS inventory_positions_count,
          (SELECT COALESCE(SUM(menge), 0)::int FROM inventory) AS inventory_quantity_total,
          (SELECT COUNT(*)::int FROM picking_orders WHERE status = 'OFFEN') AS picking_open_count,
          (SELECT COUNT(*)::int FROM picking_orders WHERE status = 'IN_BEARBEITUNG') AS picking_in_progress_count
        `
      )
    ).rows[0];

    const recentTransactions = (
      await pool.query(
        `
        ${TRANSACTION_SELECT}
        ORDER BY t.datum DESC, t.id DESC
        LIMIT 10
        `
      )
    ).rows;

    const openPickingOrders = (
      await pool.query(
        `
        ${PICKING_ORDER_SELECT}
        WHERE po.status <> 'ERLEDIGT'
        GROUP BY po.id, c.kunden_nr, c.name, eu.username, bu.username
        ORDER BY
          CASE po.status
            WHEN 'IN_BEARBEITUNG' THEN 1
            WHEN 'OFFEN' THEN 2
            ELSE 3
          END,
          po.faellig_am NULLS LAST,
          po.created_at DESC
        LIMIT 8
        `
      )
    ).rows;

    return {
      summary,
      recent_transactions: recentTransactions,
      open_picking_orders: openPickingOrders
    };
  } catch (error) {
    throw translateDbError(error);
  }
}

async function listCustomers(filters = {}) {
  const values = [];
  const where = [];
  const search = normalizeText(filters.search, "search", { required: false, maxLength: 200 });
  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    const idx = values.length;
    where.push(
      `(LOWER(c.kunden_nr) LIKE $${idx} OR LOWER(c.name) LIKE $${idx} OR LOWER(COALESCE(c.kontakt, '')) LIKE $${idx})`
    );
  }

  values.push(normalizeLimit(filters.limit));

  try {
    return (
      await pool.query(
        `
        SELECT c.id, c.kunden_nr, c.name, c.adresse, c.kontakt, c.created_at
        FROM customers c
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY c.name ASC, c.created_at DESC
        LIMIT $${values.length}
        `,
        values
      )
    ).rows;
  } catch (error) {
    throw translateDbError(error);
  }
}

async function getCustomer(id) {
  const customerId = normalizeInteger(id, "id", { required: true, min: 1 });
  const row = await getOneOrNull(
    pool,
    `
    SELECT id, kunden_nr, name, adresse, kontakt, created_at
    FROM customers
    WHERE id = $1
    `,
    [customerId]
  );
  if (!row) throw new WarehouseError(404, "Customer not found");
  return row;
}

async function createCustomer(payload) {
  const kundenNr = normalizeText(payload.kunden_nr, "kunden_nr", { required: true, maxLength: 120 });
  const name = normalizeText(payload.name, "name", { required: true, maxLength: 255 });
  const adresse = normalizeText(payload.adresse, "adresse", { required: false, maxLength: 1000 });
  const kontakt = normalizeText(payload.kontakt, "kontakt", { required: false, maxLength: 500 });

  try {
    return (
      await pool.query(
        `
        INSERT INTO customers (kunden_nr, name, adresse, kontakt)
        VALUES ($1, $2, $3, $4)
        RETURNING id, kunden_nr, name, adresse, kontakt, created_at
        `,
        [kundenNr, name, adresse, kontakt]
      )
    ).rows[0];
  } catch (error) {
    throw translateDbError(error, { uniqueMessage: "Customer number already exists" });
  }
}

async function updateCustomer(id, payload) {
  const customerId = normalizeInteger(id, "id", { required: true, min: 1 });
  const updates = [];
  const values = [];

  if (hasOwn(payload, "kunden_nr")) {
    values.push(normalizeText(payload.kunden_nr, "kunden_nr", { required: true, maxLength: 120 }));
    updates.push(`kunden_nr = $${values.length}`);
  }
  if (hasOwn(payload, "name")) {
    values.push(normalizeText(payload.name, "name", { required: true, maxLength: 255 }));
    updates.push(`name = $${values.length}`);
  }
  if (hasOwn(payload, "adresse")) {
    values.push(normalizeText(payload.adresse, "adresse", { required: false, maxLength: 1000 }));
    updates.push(`adresse = $${values.length}`);
  }
  if (hasOwn(payload, "kontakt")) {
    values.push(normalizeText(payload.kontakt, "kontakt", { required: false, maxLength: 500 }));
    updates.push(`kontakt = $${values.length}`);
  }

  if (!updates.length) throw new WarehouseError(400, "No customer changes provided");

  values.push(customerId);

  try {
    const result = await pool.query(
      `
      UPDATE customers
      SET ${updates.join(", ")}
      WHERE id = $${values.length}
      RETURNING id, kunden_nr, name, adresse, kontakt, created_at
      `,
      values
    );
    if (!result.rowCount) throw new WarehouseError(404, "Customer not found");
    return result.rows[0];
  } catch (error) {
    throw translateDbError(error, { uniqueMessage: "Customer number already exists" });
  }
}

async function deleteCustomer(id) {
  const customerId = normalizeInteger(id, "id", { required: true, min: 1 });
  try {
    const result = await pool.query(
      `
      DELETE FROM customers
      WHERE id = $1
      RETURNING id
      `,
      [customerId]
    );
    if (!result.rowCount) throw new WarehouseError(404, "Customer not found");
    return { ok: true };
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Customer is still referenced by warehouse records"
    });
  }
}

async function listArticles(filters = {}) {
  const values = [];
  const where = [];
  const search = normalizeText(filters.search, "search", { required: false, maxLength: 200 });
  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    const idx = values.length;
    where.push(
      `(LOWER(a.artikel_nr) LIKE $${idx} OR LOWER(a.bezeichnung) LIKE $${idx} OR LOWER(COALESCE(a.beschreibung, '')) LIKE $${idx})`
    );
  }

  values.push(normalizeLimit(filters.limit));

  try {
    return (
      await pool.query(
        `
        SELECT
          a.id,
          a.artikel_nr,
          a.bezeichnung,
          a.beschreibung,
          a.created_at,
          COALESCE(SUM(i.menge), 0)::int AS bestand_gesamt
        FROM articles a
        LEFT JOIN inventory i ON i.article_id = a.id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY a.id
        ORDER BY a.bezeichnung ASC, a.created_at DESC
        LIMIT $${values.length}
        `,
        values
      )
    ).rows;
  } catch (error) {
    throw translateDbError(error);
  }
}

async function getArticle(id) {
  const articleId = normalizeInteger(id, "id", { required: true, min: 1 });
  const row = await getOneOrNull(
    pool,
    `
    SELECT
      a.id,
      a.artikel_nr,
      a.bezeichnung,
      a.beschreibung,
      a.created_at,
      COALESCE(SUM(i.menge), 0)::int AS bestand_gesamt
    FROM articles a
    LEFT JOIN inventory i ON i.article_id = a.id
    WHERE a.id = $1
    GROUP BY a.id
    `,
    [articleId]
  );
  if (!row) throw new WarehouseError(404, "Article not found");
  return row;
}

async function createArticle(payload) {
  const artikelNr = normalizeText(payload.artikel_nr, "artikel_nr", { required: true, maxLength: 120 });
  const bezeichnung = normalizeText(payload.bezeichnung, "bezeichnung", { required: true, maxLength: 255 });
  const beschreibung = normalizeText(payload.beschreibung, "beschreibung", { required: false, maxLength: 4000 });

  try {
    return (
      await pool.query(
        `
        INSERT INTO articles (artikel_nr, bezeichnung, beschreibung)
        VALUES ($1, $2, $3)
        RETURNING id, artikel_nr, bezeichnung, beschreibung, created_at
        `,
        [artikelNr, bezeichnung, beschreibung]
      )
    ).rows[0];
  } catch (error) {
    throw translateDbError(error, { uniqueMessage: "Article number already exists" });
  }
}

async function updateArticle(id, payload) {
  const articleId = normalizeInteger(id, "id", { required: true, min: 1 });
  const updates = [];
  const values = [];

  if (hasOwn(payload, "artikel_nr")) {
    values.push(normalizeText(payload.artikel_nr, "artikel_nr", { required: true, maxLength: 120 }));
    updates.push(`artikel_nr = $${values.length}`);
  }
  if (hasOwn(payload, "bezeichnung")) {
    values.push(normalizeText(payload.bezeichnung, "bezeichnung", { required: true, maxLength: 255 }));
    updates.push(`bezeichnung = $${values.length}`);
  }
  if (hasOwn(payload, "beschreibung")) {
    values.push(normalizeText(payload.beschreibung, "beschreibung", { required: false, maxLength: 4000 }));
    updates.push(`beschreibung = $${values.length}`);
  }

  if (!updates.length) throw new WarehouseError(400, "No article changes provided");

  values.push(articleId);

  try {
    const result = await pool.query(
      `
      UPDATE articles
      SET ${updates.join(", ")}
      WHERE id = $${values.length}
      RETURNING id, artikel_nr, bezeichnung, beschreibung, created_at
      `,
      values
    );
    if (!result.rowCount) throw new WarehouseError(404, "Article not found");
    return result.rows[0];
  } catch (error) {
    throw translateDbError(error, { uniqueMessage: "Article number already exists" });
  }
}

async function deleteArticle(id) {
  const articleId = normalizeInteger(id, "id", { required: true, min: 1 });
  try {
    const result = await pool.query(
      `
      DELETE FROM articles
      WHERE id = $1
      RETURNING id
      `,
      [articleId]
    );
    if (!result.rowCount) throw new WarehouseError(404, "Article not found");
    return { ok: true };
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Article is still referenced by inventory, transactions or picking orders"
    });
  }
}

async function listStorageLocations(filters = {}) {
  const values = [];
  const where = [];
  const search = normalizeText(filters.search, "search", { required: false, maxLength: 200 });
  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    const idx = values.length;
    where.push(`(LOWER(sl.name) LIKE $${idx} OR LOWER(sl.typ::text) LIKE $${idx})`);
  }

  const type = filters.typ ? normalizeEnum(filters.typ, STORAGE_LOCATION_TYPES, "typ", { required: false }) : null;
  if (type) {
    values.push(type);
    where.push(`sl.typ = $${values.length}`);
  }

  values.push(normalizeLimit(filters.limit));

  try {
    return (
      await pool.query(
        `
        SELECT
          sl.id,
          sl.typ,
          sl.name,
          sl.kapazitaet,
          sl.created_at,
          COUNT(i.id)::int AS belegte_positionen,
          COALESCE(SUM(i.menge), 0)::int AS belegte_menge
        FROM storage_locations sl
        LEFT JOIN inventory i ON i.storage_location_id = sl.id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY sl.id
        ORDER BY sl.name ASC
        LIMIT $${values.length}
        `,
        values
      )
    ).rows;
  } catch (error) {
    throw translateDbError(error);
  }
}

async function getStorageLocation(id) {
  const locationId = normalizeInteger(id, "id", { required: true, min: 1 });
  const row = await getOneOrNull(
    pool,
    `
    SELECT
      sl.id,
      sl.typ,
      sl.name,
      sl.kapazitaet,
      sl.created_at,
      COUNT(i.id)::int AS belegte_positionen,
      COALESCE(SUM(i.menge), 0)::int AS belegte_menge
    FROM storage_locations sl
    LEFT JOIN inventory i ON i.storage_location_id = sl.id
    WHERE sl.id = $1
    GROUP BY sl.id
    `,
    [locationId]
  );
  if (!row) throw new WarehouseError(404, "Storage location not found");
  return row;
}

async function createStorageLocation(payload) {
  const typ = normalizeEnum(payload.typ, STORAGE_LOCATION_TYPES, "typ", { required: true });
  const name = normalizeText(payload.name, "name", { required: true, maxLength: 120 });
  const kapazitaet = normalizeInteger(payload.kapazitaet, "kapazitaet", { required: true, min: 1 });

  try {
    return (
      await pool.query(
        `
        INSERT INTO storage_locations (typ, name, kapazitaet)
        VALUES ($1, $2, $3)
        RETURNING id, typ, name, kapazitaet, created_at
        `,
        [typ, name, kapazitaet]
      )
    ).rows[0];
  } catch (error) {
    throw translateDbError(error, { uniqueMessage: "Storage location name already exists" });
  }
}

async function updateStorageLocation(id, payload) {
  const locationId = normalizeInteger(id, "id", { required: true, min: 1 });
  const updates = [];
  const values = [];

  if (hasOwn(payload, "typ")) {
    values.push(normalizeEnum(payload.typ, STORAGE_LOCATION_TYPES, "typ", { required: true }));
    updates.push(`typ = $${values.length}`);
  }
  if (hasOwn(payload, "name")) {
    values.push(normalizeText(payload.name, "name", { required: true, maxLength: 120 }));
    updates.push(`name = $${values.length}`);
  }
  if (hasOwn(payload, "kapazitaet")) {
    values.push(normalizeInteger(payload.kapazitaet, "kapazitaet", { required: true, min: 1 }));
    updates.push(`kapazitaet = $${values.length}`);
  }

  if (!updates.length) throw new WarehouseError(400, "No storage location changes provided");

  values.push(locationId);

  try {
    const result = await pool.query(
      `
      UPDATE storage_locations
      SET ${updates.join(", ")}
      WHERE id = $${values.length}
      RETURNING id, typ, name, kapazitaet, created_at
      `,
      values
    );
    if (!result.rowCount) throw new WarehouseError(404, "Storage location not found");
    return result.rows[0];
  } catch (error) {
    throw translateDbError(error, { uniqueMessage: "Storage location name already exists" });
  }
}

async function deleteStorageLocation(id) {
  const locationId = normalizeInteger(id, "id", { required: true, min: 1 });
  try {
    const result = await pool.query(
      `
      DELETE FROM storage_locations
      WHERE id = $1
      RETURNING id
      `,
      [locationId]
    );
    if (!result.rowCount) throw new WarehouseError(404, "Storage location not found");
    return { ok: true };
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Storage location is still referenced by inventory or transactions"
    });
  }
}

async function listInventory(filters = {}) {
  const values = [];
  const where = [];
  const search = normalizeText(filters.search, "search", { required: false, maxLength: 200 });
  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    const idx = values.length;
    where.push(
      `(
        LOWER(sl.name) LIKE $${idx}
        OR LOWER(a.artikel_nr) LIKE $${idx}
        OR LOWER(a.bezeichnung) LIKE $${idx}
      )`
    );
  }

  const articleId = normalizeInteger(filters.article_id, "article_id", { required: false, min: 1, allowNull: true });
  if (articleId) {
    values.push(articleId);
    where.push(`i.article_id = $${values.length}`);
  }

  const locationId = normalizeInteger(filters.storage_location_id, "storage_location_id", {
    required: false,
    min: 1,
    allowNull: true
  });
  if (locationId) {
    values.push(locationId);
    where.push(`i.storage_location_id = $${values.length}`);
  }

  values.push(normalizeLimit(filters.limit));

  try {
    return (
      await pool.query(
        `
        ${INVENTORY_SELECT}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY sl.name ASC, a.bezeichnung ASC
        LIMIT $${values.length}
        `,
        values
      )
    ).rows;
  } catch (error) {
    throw translateDbError(error);
  }
}

async function getInventoryRecord(id) {
  const inventoryId = normalizeInteger(id, "id", { required: true, min: 1 });
  const row = await getInventoryById(pool, inventoryId);
  if (!row) throw new WarehouseError(404, "Inventory record not found");
  return row;
}

async function createInventoryRecord(payload) {
  const storageLocationId = normalizeInteger(payload.storage_location_id, "storage_location_id", { required: true, min: 1 });
  const articleId = normalizeInteger(payload.article_id, "article_id", { required: true, min: 1 });
  const menge = normalizeInteger(payload.menge, "menge", { required: true, min: 1 });

  try {
    const result = await pool.query(
      `
      INSERT INTO inventory (storage_location_id, article_id, menge, created_at, updated_at)
      VALUES ($1, $2, $3, now(), now())
      RETURNING id
      `,
      [storageLocationId, articleId, menge]
    );
    return getInventoryRecord(result.rows[0].id);
  } catch (error) {
    throw translateDbError(error, {
      uniqueMessage: "Inventory record for this article and storage location already exists",
      fkMessage: "Article or storage location not found"
    });
  }
}

async function updateInventoryRecord(id, payload) {
  const inventoryId = normalizeInteger(id, "id", { required: true, min: 1 });
  const updates = [];
  const values = [];

  if (hasOwn(payload, "storage_location_id")) {
    values.push(normalizeInteger(payload.storage_location_id, "storage_location_id", { required: true, min: 1 }));
    updates.push(`storage_location_id = $${values.length}`);
  }
  if (hasOwn(payload, "article_id")) {
    values.push(normalizeInteger(payload.article_id, "article_id", { required: true, min: 1 }));
    updates.push(`article_id = $${values.length}`);
  }
  if (hasOwn(payload, "menge")) {
    values.push(normalizeInteger(payload.menge, "menge", { required: true, min: 1 }));
    updates.push(`menge = $${values.length}`);
  }

  if (!updates.length) throw new WarehouseError(400, "No inventory changes provided");

  updates.push(`updated_at = now()`);
  values.push(inventoryId);

  try {
    const result = await pool.query(
      `
      UPDATE inventory
      SET ${updates.join(", ")}
      WHERE id = $${values.length}
      RETURNING id
      `,
      values
    );
    if (!result.rowCount) throw new WarehouseError(404, "Inventory record not found");
    return getInventoryRecord(result.rows[0].id);
  } catch (error) {
    throw translateDbError(error, {
      uniqueMessage: "Inventory record for this article and storage location already exists",
      fkMessage: "Article or storage location not found"
    });
  }
}

async function deleteInventoryRecord(id) {
  const inventoryId = normalizeInteger(id, "id", { required: true, min: 1 });
  const result = await pool.query(
    `
    DELETE FROM inventory
    WHERE id = $1
    RETURNING id
    `,
    [inventoryId]
  );
  if (!result.rowCount) throw new WarehouseError(404, "Inventory record not found");
  return { ok: true };
}

async function listTransactions(filters = {}) {
  const { whereSql, values, limit } = buildTransactionFilters(filters, { withLimit: true });
  const params = [...values, limit];

  try {
    return (
      await pool.query(
        `
        ${TRANSACTION_SELECT}
        ${whereSql}
        ORDER BY t.datum DESC, t.id DESC
        LIMIT $${params.length}
        `,
        params
      )
    ).rows;
  } catch (error) {
    throw translateDbError(error);
  }
}

async function exportTransactions(filters = {}) {
  const { whereSql, values } = buildTransactionFilters(filters, { withLimit: false });
  try {
    return (
      await pool.query(
        `
        ${TRANSACTION_SELECT}
        ${whereSql}
        ORDER BY t.datum DESC, t.id DESC
        `,
        values
      )
    ).rows;
  } catch (error) {
    throw translateDbError(error);
  }
}

async function fetchTransactionRecord(id) {
  const transactionId = normalizeInteger(id, "id", { required: true, min: 1 });
  const row = await getTransactionById(pool, transactionId);
  if (!row) throw new WarehouseError(404, "Transaction not found");
  return row;
}

async function createTransactionRecord(payload, userId) {
  const actorId = normalizeInteger(userId, "user_id", { required: true, min: 1 });
  const movement = normalizeMovementPayload(payload, { requireAll: true });

  try {
    return await withTransaction(async (client) => {
      await applyMovement(client, movement, 1);
      const inserted = await client.query(
        `
        INSERT INTO transactions (
          typ,
          article_id,
          menge,
          storage_location_from_id,
          storage_location_to_id,
          customer_id,
          beleg_nr,
          positions_nr,
          user_id,
          datum,
          notiz
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
        `,
        [
          movement.typ,
          movement.article_id,
          movement.menge,
          movement.storage_location_from_id,
          movement.storage_location_to_id,
          movement.customer_id,
          movement.beleg_nr,
          movement.positions_nr,
          actorId,
          movement.datum,
          movement.notiz
        ]
      );

      return getTransactionById(client, inserted.rows[0].id);
    });
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Referenced article, customer, storage location or user not found",
      checkMessage: "Transaction data is invalid"
    });
  }
}

async function updateTransactionRecord(id, payload) {
  const transactionId = normalizeInteger(id, "id", { required: true, min: 1 });
  const movement = normalizeMovementPayload(payload, { requireAll: true });

  try {
    return await withTransaction(async (client) => {
      const current = await getOneOrNull(
        client,
        `
        SELECT
          id,
          typ,
          article_id,
          menge,
          storage_location_from_id,
          storage_location_to_id,
          customer_id,
          beleg_nr,
          positions_nr,
          user_id,
          datum,
          notiz
        FROM transactions
        WHERE id = $1
        FOR UPDATE
        `,
        [transactionId]
      );

      if (!current) throw new WarehouseError(404, "Transaction not found");

      await applyMovement(client, current, -1);
      await applyMovement(client, movement, 1);

      await client.query(
        `
        UPDATE transactions
        SET
          typ = $1,
          article_id = $2,
          menge = $3,
          storage_location_from_id = $4,
          storage_location_to_id = $5,
          customer_id = $6,
          beleg_nr = $7,
          positions_nr = $8,
          datum = $9,
          notiz = $10
        WHERE id = $11
        `,
        [
          movement.typ,
          movement.article_id,
          movement.menge,
          movement.storage_location_from_id,
          movement.storage_location_to_id,
          movement.customer_id,
          movement.beleg_nr,
          movement.positions_nr,
          movement.datum,
          movement.notiz,
          transactionId
        ]
      );

      return getTransactionById(client, transactionId);
    });
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Referenced article, customer or storage location not found",
      checkMessage: "Transaction data is invalid"
    });
  }
}

async function deleteTransactionRecord(id) {
  const transactionId = normalizeInteger(id, "id", { required: true, min: 1 });

  try {
    return await withTransaction(async (client) => {
      const current = await getOneOrNull(
        client,
        `
        SELECT
          id,
          typ,
          article_id,
          menge,
          storage_location_from_id,
          storage_location_to_id,
          customer_id,
          beleg_nr,
          positions_nr,
          user_id,
          datum,
          notiz
        FROM transactions
        WHERE id = $1
        FOR UPDATE
        `,
        [transactionId]
      );

      if (!current) throw new WarehouseError(404, "Transaction not found");

      await applyMovement(client, current, -1);
      await client.query(`DELETE FROM transactions WHERE id = $1`, [transactionId]);
      return { ok: true };
    });
  } catch (error) {
    throw translateDbError(error);
  }
}

async function listPickingOrders(filters = {}) {
  const values = [];
  const where = [];

  const search = normalizeText(filters.search, "search", { required: false, maxLength: 200 });
  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    const idx = values.length;
    where.push(
      `(
        LOWER(COALESCE(po.beleg_nr, '')) LIKE $${idx}
        OR LOWER(COALESCE(c.kunden_nr, '')) LIKE $${idx}
        OR LOWER(COALESCE(c.name, '')) LIKE $${idx}
      )`
    );
  }

  const status = filters.status ? normalizeEnum(filters.status, PICKING_STATUSES, "status", { required: false }) : null;
  if (status) {
    values.push(status);
    where.push(`po.status = $${values.length}`);
  }

  const customerId = normalizeInteger(filters.customer_id, "customer_id", { required: false, min: 1, allowNull: true });
  if (customerId) {
    values.push(customerId);
    where.push(`po.customer_id = $${values.length}`);
  }

  values.push(normalizeLimit(filters.limit));

  try {
    return (
      await pool.query(
        `
        ${PICKING_ORDER_SELECT}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY po.id, c.kunden_nr, c.name, eu.username, bu.username
        ORDER BY
          CASE po.status
            WHEN 'OFFEN' THEN 1
            WHEN 'IN_BEARBEITUNG' THEN 2
            ELSE 3
          END,
          po.faellig_am NULLS LAST,
          po.created_at DESC
        LIMIT $${values.length}
        `,
        values
      )
    ).rows;
  } catch (error) {
    throw translateDbError(error);
  }
}

async function fetchPickingOrder(id) {
  const orderId = normalizeInteger(id, "id", { required: true, min: 1 });
  const row = await getPickingOrderById(pool, orderId);
  if (!row) throw new WarehouseError(404, "Picking order not found");
  return row;
}

async function createPickingOrder(payload, userId) {
  const actorId = normalizeInteger(userId, "user_id", { required: true, min: 1 });
  const status = normalizeEnum(payload.status, PICKING_STATUSES, "status", {
    required: false,
    defaultValue: "OFFEN"
  });
  const customerId = normalizeInteger(payload.customer_id, "customer_id", { required: true, min: 1 });
  const belegNr = normalizeText(payload.beleg_nr, "beleg_nr", { required: true, maxLength: 120 });
  const bearbeiterUserId = normalizeInteger(payload.bearbeiter_user_id, "bearbeiter_user_id", {
    required: false,
    min: 1,
    allowNull: true
  });
  const faelligAm = normalizeDateOnly(payload.faellig_am, "faellig_am", { required: false });
  const items = normalizePickingItems(payload.items, { required: true });

  try {
    return await withTransaction(async (client) => {
      const inserted = await client.query(
        `
        INSERT INTO picking_orders (
          status,
          customer_id,
          beleg_nr,
          ersteller_user_id,
          bearbeiter_user_id,
          faellig_am
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        `,
        [status, customerId, belegNr, actorId, bearbeiterUserId, faelligAm]
      );

      for (const item of items) {
        await client.query(
          `
          INSERT INTO picking_order_items (order_id, article_id, menge_soll, menge_ist)
          VALUES ($1, $2, $3, $4)
          `,
          [inserted.rows[0].id, item.article_id, item.menge_soll, item.menge_ist]
        );
      }

      return getPickingOrderById(client, inserted.rows[0].id);
    });
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Referenced customer, article or user not found",
      checkMessage: "Picking order data is invalid"
    });
  }
}

async function updatePickingOrder(id, payload) {
  const orderId = normalizeInteger(id, "id", { required: true, min: 1 });
  const updates = [];
  const values = [];
  const itemsProvided = hasOwn(payload, "items");
  const items = itemsProvided ? normalizePickingItems(payload.items, { required: true }) : null;

  if (hasOwn(payload, "status")) {
    values.push(normalizeEnum(payload.status, PICKING_STATUSES, "status", { required: true }));
    updates.push(`status = $${values.length}`);
  }
  if (hasOwn(payload, "customer_id")) {
    values.push(normalizeInteger(payload.customer_id, "customer_id", { required: true, min: 1 }));
    updates.push(`customer_id = $${values.length}`);
  }
  if (hasOwn(payload, "beleg_nr")) {
    values.push(normalizeText(payload.beleg_nr, "beleg_nr", { required: true, maxLength: 120 }));
    updates.push(`beleg_nr = $${values.length}`);
  }
  if (hasOwn(payload, "bearbeiter_user_id")) {
    values.push(normalizeInteger(payload.bearbeiter_user_id, "bearbeiter_user_id", {
      required: false,
      min: 1,
      allowNull: true
    }));
    updates.push(`bearbeiter_user_id = $${values.length}`);
  }
  if (hasOwn(payload, "faellig_am")) {
    values.push(normalizeDateOnly(payload.faellig_am, "faellig_am", { required: false }));
    updates.push(`faellig_am = $${values.length}`);
  }

  if (!updates.length && !itemsProvided) {
    throw new WarehouseError(400, "No picking order changes provided");
  }

  try {
    return await withTransaction(async (client) => {
      const exists = await getOneOrNull(client, `SELECT id FROM picking_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      if (!exists) throw new WarehouseError(404, "Picking order not found");

      if (updates.length) {
        values.push(orderId);
        await client.query(
          `
          UPDATE picking_orders
          SET ${updates.join(", ")}
          WHERE id = $${values.length}
          `,
          values
        );
      }

      if (itemsProvided) {
        await client.query(`DELETE FROM picking_order_items WHERE order_id = $1`, [orderId]);
        for (const item of items) {
          await client.query(
            `
            INSERT INTO picking_order_items (order_id, article_id, menge_soll, menge_ist)
            VALUES ($1, $2, $3, $4)
            `,
            [orderId, item.article_id, item.menge_soll, item.menge_ist]
          );
        }
      }

      return getPickingOrderById(client, orderId);
    });
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Referenced customer, article or user not found",
      checkMessage: "Picking order data is invalid"
    });
  }
}

async function deletePickingOrder(id) {
  const orderId = normalizeInteger(id, "id", { required: true, min: 1 });
  const result = await pool.query(
    `
    DELETE FROM picking_orders
    WHERE id = $1
    RETURNING id
    `,
    [orderId]
  );
  if (!result.rowCount) throw new WarehouseError(404, "Picking order not found");
  return { ok: true };
}

async function startPickingOrder(id, userId) {
  const orderId = normalizeInteger(id, "id", { required: true, min: 1 });
  const actorId = normalizeInteger(userId, "user_id", { required: true, min: 1 });

  try {
    return await withTransaction(async (client) => {
      const updated = await client.query(
        `
        UPDATE picking_orders
        SET status = 'IN_BEARBEITUNG',
            bearbeiter_user_id = $2
        WHERE id = $1
        RETURNING id
        `,
        [orderId, actorId]
      );
      if (!updated.rowCount) throw new WarehouseError(404, "Picking order not found");
      return getPickingOrderById(client, orderId);
    });
  } catch (error) {
    throw translateDbError(error, { fkMessage: "User not found" });
  }
}

async function updatePickingOrderItem(orderId, itemId, payload, userId) {
  const normalizedOrderId = normalizeInteger(orderId, "order_id", { required: true, min: 1 });
  const normalizedItemId = normalizeInteger(itemId, "item_id", { required: true, min: 1 });
  const actorId = normalizeInteger(userId, "user_id", { required: true, min: 1 });
  const mengeIst = normalizeInteger(payload.menge_ist, "menge_ist", { required: true, min: 0 });

  try {
    return await withTransaction(async (client) => {
      const item = await getOneOrNull(
        client,
        `
        SELECT id
        FROM picking_order_items
        WHERE id = $1 AND order_id = $2
        FOR UPDATE
        `,
        [normalizedItemId, normalizedOrderId]
      );
      if (!item) throw new WarehouseError(404, "Picking order item not found");

      await client.query(
        `
        UPDATE picking_order_items
        SET menge_ist = $1
        WHERE id = $2 AND order_id = $3
        `,
        [mengeIst, normalizedItemId, normalizedOrderId]
      );

      await client.query(
        `
        UPDATE picking_orders
        SET status = CASE WHEN status = 'OFFEN' THEN 'IN_BEARBEITUNG' ELSE status END,
            bearbeiter_user_id = COALESCE(bearbeiter_user_id, $2)
        WHERE id = $1
        `,
        [normalizedOrderId, actorId]
      );

      return getPickingOrderById(client, normalizedOrderId);
    });
  } catch (error) {
    throw translateDbError(error, { fkMessage: "User not found" });
  }
}

async function completePickingOrder(id, payload, userId) {
  const orderId = normalizeInteger(id, "id", { required: true, min: 1 });
  const actorId = normalizeInteger(userId, "user_id", { required: true, min: 1 });
  const items = hasOwn(payload, "items") ? normalizePickingItems(payload.items, { required: true }) : null;

  try {
    return await withTransaction(async (client) => {
      const exists = await getOneOrNull(client, `SELECT id FROM picking_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      if (!exists) throw new WarehouseError(404, "Picking order not found");

      if (items) {
        await client.query(`DELETE FROM picking_order_items WHERE order_id = $1`, [orderId]);
        for (const item of items) {
          await client.query(
            `
            INSERT INTO picking_order_items (order_id, article_id, menge_soll, menge_ist)
            VALUES ($1, $2, $3, $4)
            `,
            [orderId, item.article_id, item.menge_soll, item.menge_ist]
          );
        }
      }

      await client.query(
        `
        UPDATE picking_orders
        SET status = 'ERLEDIGT',
            bearbeiter_user_id = $2
        WHERE id = $1
        `,
        [orderId, actorId]
      );

      return getPickingOrderById(client, orderId);
    });
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Referenced article or user not found"
    });
  }
}

module.exports = {
  PICKING_STATUSES,
  STORAGE_LOCATION_TYPES,
  TRANSACTION_TYPES,
  WarehouseError,
  completePickingOrder,
  createArticle,
  createCustomer,
  createInventoryRecord,
  createPickingOrder,
  createStorageLocation,
  createTransactionRecord,
  deleteArticle,
  deleteCustomer,
  deleteInventoryRecord,
  deletePickingOrder,
  deleteStorageLocation,
  deleteTransactionRecord,
  exportTransactions,
  fetchPickingOrder,
  fetchTransactionRecord,
  getArticle,
  getCustomer,
  getDashboardSummary,
  getInventoryRecord,
  getStorageLocation,
  listArticles,
  listCustomers,
  listInventory,
  listPickingOrders,
  listStorageLocations,
  listTransactions,
  startPickingOrder,
  updateArticle,
  updateCustomer,
  updateInventoryRecord,
  updatePickingOrder,
  updatePickingOrderItem,
  updateStorageLocation,
  updateTransactionRecord
};
