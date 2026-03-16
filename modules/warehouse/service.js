const { pool } = require("../../db_pg");

const STORAGE_LOCATION_TYPES = ["Regal", "Bodenstellplatz"];
const SLOT_STATUS_TYPES = ["FREE", "OCCUPIED"];
const TRANSACTION_TYPES = ["IN", "OUT", "TRANSFER"];
const PACKAGING_TYPES = ["Karton groß", "Karton klein"];
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
    i.stellplatz_nr,
    i.verpackungsart,
    i.menge,
    i.created_at,
    i.updated_at,
    tx.id AS last_transaction_id,
    tx.typ AS last_transaction_type,
    tx.datum AS last_transaction_datum,
    tx.beleg_nr,
    tx.positions_nr,
    tx.verpackungsart AS last_transaction_verpackungsart,
    tx.customer_id,
    c.kunden_nr,
    c.name AS customer_name,
    tx.user_id AS stored_by_user_id,
    u.username AS stored_by_username
  FROM inventory i
  INNER JOIN storage_locations sl ON sl.id = i.storage_location_id
  LEFT JOIN LATERAL (
    SELECT
      t.id,
      t.typ,
      t.datum,
      t.beleg_nr,
      t.positions_nr,
      t.verpackungsart,
      t.customer_id,
      t.user_id
    FROM transaction_slot_assignments tsa
    INNER JOIN transactions t ON t.id = tsa.transaction_id
    WHERE tsa.phase = 'TARGET'
      AND tsa.storage_location_id = i.storage_location_id
      AND tsa.stellplatz_nr = i.stellplatz_nr
    ORDER BY t.datum DESC, t.id DESC
    LIMIT 1
  ) tx ON TRUE
  LEFT JOIN customers c ON c.id = tx.customer_id
  LEFT JOIN users u ON u.id = tx.user_id
`;

const TRANSACTION_SELECT = `
  SELECT
    t.id,
    t.typ,
    t.menge,
    t.storage_location_from_id,
    slf.name AS storage_location_from_name,
    t.storage_location_to_id,
    slt.name AS storage_location_to_name,
    t.stellplatz_nr,
    t.verpackungsart,
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
    po.notiz,
    po.ersteller_user_id,
    eu.username AS ersteller_username,
    po.bearbeiter_user_id,
    bu.username AS bearbeiter_username,
    po.faellig_am,
    po.created_at,
    COUNT(poi.id)::int AS item_count,
    COALESCE(
      STRING_AGG(
        CASE
          WHEN NULLIF(BTRIM(poi.rollen_nummern), '') IS NULL THEN NULL
          WHEN NULLIF(BTRIM(poi.positions_nr), '') IS NULL THEN poi.rollen_nummern
          ELSE poi.positions_nr || ': ' || poi.rollen_nummern
        END,
        ' | ' ORDER BY poi.id
      ),
      ''
    ) AS rollen_nummern_gesamt
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

function normalizeIntegerArray(value, field, options = {}) {
  const { required = false, min = null, max = null, allowEmpty = false, allowNull = false } = options;
  if (value === null || value === undefined || value === "") {
    if (required) throw new WarehouseError(400, `${field} is required`);
    return allowNull ? null : [];
  }

  const entries = Array.isArray(value) ? value : [value];
  if (!entries.length && !allowEmpty) {
    throw new WarehouseError(400, `${field} must not be empty`);
  }

  const normalized = entries.map((entry, index) =>
    normalizeInteger(entry, `${field}[${index}]`, { required: true, min, max })
  );

  if (new Set(normalized).size !== normalized.length) {
    throw new WarehouseError(400, `${field} contains duplicate values`);
  }

  return [...normalized].sort((left, right) => left - right);
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

function normalizePackagingType(value, field = "verpackungsart", options = {}) {
  return normalizeEnum(value, PACKAGING_TYPES, field, options);
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

async function getCustomerCore(executor, id) {
  return getOneOrNull(
    executor,
    `
    SELECT id, kunden_nr, name, adresse, kontakt, created_at
    FROM customers
    WHERE id = $1
    `,
    [id]
  );
}

async function findCustomerByName(executor, name) {
  return getOneOrNull(
    executor,
    `
    SELECT id, kunden_nr, name, adresse, kontakt, created_at
    FROM customers
    WHERE LOWER(BTRIM(name)) = LOWER(BTRIM($1))
    ORDER BY id ASC
    LIMIT 1
    `,
    [name]
  );
}

async function resolveCustomerReference(executor, payload, options = {}) {
  const { required = false } = options;
  const customerIdProvided = hasOwn(payload, "customer_id");
  const customerNameProvided = hasOwn(payload, "customer_name");

  if (!customerIdProvided && !customerNameProvided) {
    if (required) throw new WarehouseError(400, "customer_id or customer_name is required");
    return { provided: false, customer_id: undefined, customer: null };
  }

  const customerId = customerIdProvided
    ? normalizeInteger(payload.customer_id, "customer_id", { required: false, min: 1, allowNull: true })
    : null;

  if (customerId) {
    const customer = await getCustomerCore(executor, customerId);
    if (!customer) throw new WarehouseError(400, "Referenced customer not found");
    return { provided: true, customer_id: customer.id, customer };
  }

  const customerName = customerNameProvided
    ? normalizeText(payload.customer_name, "customer_name", { required: false, maxLength: 255 })
    : null;

  if (customerName) {
    const lockKey = customerName.toLowerCase();
    await executor.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);

    const existing = await findCustomerByName(executor, customerName);
    if (existing) {
      return { provided: true, customer_id: existing.id, customer: existing };
    }

    const inserted = (
      await executor.query(
        `
        INSERT INTO customers (kunden_nr, name, adresse, kontakt)
        VALUES (NULL, $1, NULL, NULL)
        RETURNING id, kunden_nr, name, adresse, kontakt, created_at
        `,
        [customerName]
      )
    ).rows[0];

    return { provided: true, customer_id: inserted.id, customer: inserted };
  }

  if (required) throw new WarehouseError(400, "customer_id or customer_name is required");
  return { provided: true, customer_id: null, customer: null };
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

async function getStorageLocationCore(executor, id) {
  return getOneOrNull(
    executor,
    `
    SELECT id, typ, name, kapazitaet, created_at
    FROM storage_locations
    WHERE id = $1
    `,
    [id]
  );
}

async function ensureStorageLocationSlot(executor, locationId, stellplatzNr, field = "stellplatz_nr") {
  const normalizedLocationId = normalizeInteger(locationId, "storage_location_id", { required: true, min: 1 });
  const normalizedSlot = normalizeInteger(stellplatzNr, field, { required: true, min: 1 });
  const location = await getStorageLocationCore(executor, normalizedLocationId);

  if (!location) {
    throw new WarehouseError(400, `Storage location ${normalizedLocationId} not found`);
  }
  if (normalizedSlot > Number(location.kapazitaet || 0)) {
    throw new WarehouseError(
      400,
      `${field} must be between 1 and ${location.kapazitaet} for storage location ${location.name}`
    );
  }

  return {
    location,
    stellplatz_nr: normalizedSlot
  };
}

async function ensureStorageLocationSlots(executor, locationId, stellplaetze, field = "stellplaetze") {
  const normalizedLocationId = normalizeInteger(locationId, "storage_location_id", { required: true, min: 1 });
  const normalizedSlots = normalizeIntegerArray(stellplaetze, field, { required: true, min: 1 });
  const location = await getStorageLocationCore(executor, normalizedLocationId);

  if (!location) {
    throw new WarehouseError(400, `Storage location ${normalizedLocationId} not found`);
  }

  const invalidSlot = normalizedSlots.find((slotNo) => slotNo > Number(location.kapazitaet || 0));
  if (invalidSlot) {
    throw new WarehouseError(
      400,
      `${field} must stay within capacity 1..${location.kapazitaet} for storage location ${location.name}`
    );
  }

  return {
    location,
    stellplaetze: normalizedSlots
  };
}

async function ensureStorageLocationCapacity(executor, locationId, kapazitaet) {
  const normalizedLocationId = normalizeInteger(locationId, "id", { required: true, min: 1 });
  const normalizedCapacity = normalizeInteger(kapazitaet, "kapazitaet", { required: true, min: 1 });
  const maxUsedSlotRow = await getOneOrNull(
    executor,
    `
    SELECT COALESCE(MAX(stellplatz_nr), 0)::int AS max_slot
    FROM inventory
    WHERE storage_location_id = $1
    `,
    [normalizedLocationId]
  );
  const maxUsedSlot = Number(maxUsedSlotRow?.max_slot || 0);
  if (normalizedCapacity < maxUsedSlot) {
    throw new WarehouseError(
      409,
      `Capacity cannot be reduced below occupied slot ${maxUsedSlot}`
    );
  }
  return normalizedCapacity;
}

async function getInventoryById(executor, id) {
  return getOneOrNull(
    executor,
    `${INVENTORY_SELECT}
     WHERE i.id = $1`,
    [id]
  );
}

function uniqueSortedSlots(values = []) {
  return [...new Set((values || []).map((value) => Number(value)).filter(Number.isInteger))].sort(
    (left, right) => left - right
  );
}

function getRepresentativeTransactionSlot(typ, sourceSlots = [], targetSlots = []) {
  if (typ === "OUT") {
    return sourceSlots.length === 1 ? sourceSlots[0] : null;
  }
  return targetSlots.length === 1 ? targetSlots[0] : null;
}

function resolveMovementSlots(movement = {}) {
  const legacySlotValue = movement.stellplatz_nr;
  const legacySlot = legacySlotValue === null || legacySlotValue === undefined || legacySlotValue === ""
    ? null
    : Number(legacySlotValue);
  const sourceSlots = uniqueSortedSlots(movement.source_stellplaetze);
  const targetSlots = uniqueSortedSlots(movement.target_stellplaetze);

  const resolvedSource = sourceSlots.length
    ? sourceSlots
    : Number.isInteger(legacySlot) && (movement.typ === "OUT" || movement.typ === "TRANSFER")
      ? [legacySlot]
      : [];
  const resolvedTarget = targetSlots.length
    ? targetSlots
    : Number.isInteger(legacySlot) && (movement.typ === "IN" || movement.typ === "TRANSFER")
      ? [legacySlot]
      : [];
  const representativeSlot = Number.isInteger(legacySlot)
    ? legacySlot
    : getRepresentativeTransactionSlot(movement.typ, resolvedSource, resolvedTarget);

  return {
    ...movement,
    stellplatz_nr: representativeSlot,
    source_stellplaetze: resolvedSource,
    target_stellplaetze: resolvedTarget,
    stellplaetze: movement.typ === "OUT" ? resolvedSource : resolvedTarget
  };
}

async function attachTransactionSlotAssignments(executor, rows = []) {
  if (!rows.length) return [];

  const transactionIds = [...new Set(rows.map((row) => String(row.id)))];
  const assignments = (
    await executor.query(
      `
      SELECT
        tsa.transaction_id,
        tsa.phase,
        tsa.storage_location_id,
        tsa.stellplatz_nr
      FROM transaction_slot_assignments tsa
      WHERE tsa.transaction_id = ANY($1::bigint[])
      ORDER BY tsa.transaction_id ASC, tsa.phase ASC, tsa.stellplatz_nr ASC
      `,
      [transactionIds]
    )
  ).rows;

  const assignmentMap = new Map();
  for (const transactionId of transactionIds) {
    assignmentMap.set(String(transactionId), {
      source_stellplaetze: [],
      target_stellplaetze: [],
      slot_assignments: []
    });
  }

  for (const assignment of assignments) {
    const key = String(assignment.transaction_id);
    const current = assignmentMap.get(key) || {
      source_stellplaetze: [],
      target_stellplaetze: [],
      slot_assignments: []
    };

    if (assignment.phase === "SOURCE") {
      current.source_stellplaetze.push(Number(assignment.stellplatz_nr));
    } else {
      current.target_stellplaetze.push(Number(assignment.stellplatz_nr));
    }
    current.slot_assignments.push({
      phase: assignment.phase,
      storage_location_id: Number(assignment.storage_location_id),
      stellplatz_nr: Number(assignment.stellplatz_nr)
    });
    assignmentMap.set(key, current);
  }

  return rows.map((row) => {
    const current = assignmentMap.get(String(row.id)) || {
      source_stellplaetze: [],
      target_stellplaetze: [],
      slot_assignments: []
    };
    const resolved = resolveMovementSlots({
      ...row,
      source_stellplaetze: current.source_stellplaetze,
      target_stellplaetze: current.target_stellplaetze
    });

    return {
      ...resolved,
      verpackungsart: row.verpackungsart || null,
      slot_assignments: current.slot_assignments
    };
  });
}

async function getTransactionById(executor, id) {
  const row = await getOneOrNull(
    executor,
    `${TRANSACTION_SELECT}
     WHERE t.id = $1`,
    [id]
  );
  if (!row) return null;
  const [transaction] = await attachTransactionSlotAssignments(executor, [row]);
  return transaction || null;
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
        poi.positions_nr,
        poi.rollen_nummern
      FROM picking_order_items poi
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
  const verpackungsart = normalizePackagingType(payload.verpackungsart, "verpackungsart", {
    required: requireAll,
    defaultValue: null
  });
  const sharedSlots = hasOwn(payload, "stellplaetze")
    ? normalizeIntegerArray(payload.stellplaetze, "stellplaetze", { required: true, min: 1 })
    : null;
  const sourceSlotsInput = hasOwn(payload, "source_stellplaetze")
    ? normalizeIntegerArray(payload.source_stellplaetze, "source_stellplaetze", { required: true, min: 1 })
    : null;
  const targetSlotsInput = hasOwn(payload, "target_stellplaetze")
    ? normalizeIntegerArray(payload.target_stellplaetze, "target_stellplaetze", { required: true, min: 1 })
    : null;
  const legacySlot = hasOwn(payload, "stellplatz_nr")
    ? normalizeInteger(payload.stellplatz_nr, "stellplatz_nr", { required: false, min: 1, allowNull: true })
    : null;

  let sourceSlots = [];
  let targetSlots = [];

  if (!typ && !requireAll) {
    throw new WarehouseError(400, "typ is required");
  }

  if (typ === "IN") {
    if (!storageLocationToId) throw new WarehouseError(400, "storage_location_to_id is required for IN");
    if (storageLocationFromId) throw new WarehouseError(400, "storage_location_from_id must be empty for IN");
    targetSlots = targetSlotsInput ?? sharedSlots ?? (legacySlot ? [legacySlot] : []);
    if (!targetSlots.length) {
      throw new WarehouseError(400, "target_stellplaetze is required for IN");
    }
  }
  if (typ === "OUT") {
    if (!storageLocationFromId) throw new WarehouseError(400, "storage_location_from_id is required for OUT");
    if (storageLocationToId) throw new WarehouseError(400, "storage_location_to_id must be empty for OUT");
    sourceSlots = sourceSlotsInput ?? sharedSlots ?? (legacySlot ? [legacySlot] : []);
    if (!sourceSlots.length) {
      throw new WarehouseError(400, "source_stellplaetze is required for OUT");
    }
  }
  if (typ === "TRANSFER") {
    if (!storageLocationFromId || !storageLocationToId) {
      throw new WarehouseError(400, "storage_location_from_id and storage_location_to_id are required for TRANSFER");
    }
    if (storageLocationFromId === storageLocationToId) {
      throw new WarehouseError(400, "TRANSFER requires different source and destination locations");
    }
    sourceSlots = sourceSlotsInput ?? sharedSlots ?? (legacySlot ? [legacySlot] : []);
    targetSlots = targetSlotsInput ?? sharedSlots ?? (legacySlot ? [legacySlot] : []);
    if (!sourceSlots.length || !targetSlots.length) {
      throw new WarehouseError(400, "source_stellplaetze and target_stellplaetze are required for TRANSFER");
    }
    if (sourceSlots.length !== targetSlots.length) {
      throw new WarehouseError(400, "TRANSFER requires the same number of source and target slots");
    }
  }

  if (typ === "IN" && menge !== targetSlots.length) {
    throw new WarehouseError(400, "menge must match the number of selected target slots");
  }
  if (typ === "OUT" && menge !== sourceSlots.length) {
    throw new WarehouseError(400, "menge must match the number of selected source slots");
  }
  if (typ === "TRANSFER" && (menge !== sourceSlots.length || menge !== targetSlots.length)) {
    throw new WarehouseError(400, "menge must match the number of selected source and target slots");
  }

  return resolveMovementSlots({
    typ,
    menge,
    stellplatz_nr: getRepresentativeTransactionSlot(typ, sourceSlots, targetSlots),
    source_stellplaetze: sourceSlots,
    target_stellplaetze: targetSlots,
    storage_location_from_id: storageLocationFromId || null,
    storage_location_to_id: storageLocationToId || null,
    customer_id: customerId || null,
    verpackungsart,
    beleg_nr: belegNr,
    positions_nr: positionsNr,
    datum,
    notiz
  });
}

async function addInventoryOccupancy(client, movement, locationId, stellplatzNr) {
  const normalizedMovement = resolveMovementSlots(movement);
  await ensureStorageLocationSlot(client, locationId, stellplatzNr);

  const existing = await getOneOrNull(
    client,
    `
    SELECT id
    FROM inventory
    WHERE storage_location_id = $1
      AND stellplatz_nr = $2
    FOR UPDATE
    `,
    [locationId, stellplatzNr]
  );

  if (existing) {
    throw new WarehouseError(
      409,
      `Slot ${stellplatzNr} at storage location ${locationId} is already occupied`
    );
  }

  await client.query(
    `
    INSERT INTO inventory (
      storage_location_id,
      stellplatz_nr,
      menge,
      verpackungsart,
      created_at,
      updated_at
    )
    VALUES ($1, $2, 1, $3, now(), now())
    `,
    [locationId, stellplatzNr, normalizedMovement.verpackungsart]
  );
}

async function removeInventoryOccupancy(client, movement, locationId, stellplatzNr) {
  const normalizedMovement = resolveMovementSlots(movement);
  await ensureStorageLocationSlot(client, locationId, stellplatzNr);

  const existing = await getOneOrNull(
    client,
    `
    SELECT id, verpackungsart
    FROM inventory
    WHERE storage_location_id = $1
      AND stellplatz_nr = $2
    FOR UPDATE
    `,
    [locationId, stellplatzNr]
  );

  if (!existing) {
    throw new WarehouseError(
      409,
      `Slot ${stellplatzNr} at storage location ${locationId} is not occupied`
    );
  }

  if (
    normalizedMovement.verpackungsart
    && existing.verpackungsart
    && normalizedMovement.verpackungsart !== existing.verpackungsart
  ) {
    throw new WarehouseError(
      409,
      `Slot ${stellplatzNr} at storage location ${locationId} uses another packaging type`
    );
  }

  await client.query(
    `
    DELETE FROM inventory
    WHERE id = $1
    `,
    [existing.id]
  );

  return existing;
}

async function replaceTransactionSlotAssignments(client, transactionId, movement) {
  const normalizedMovement = resolveMovementSlots(movement);
  await client.query(`DELETE FROM transaction_slot_assignments WHERE transaction_id = $1`, [transactionId]);

  const assignments = [
    ...normalizedMovement.source_stellplaetze.map((slotNo) => ({
      phase: "SOURCE",
      storage_location_id: normalizedMovement.storage_location_from_id,
      stellplatz_nr: slotNo
    })),
    ...normalizedMovement.target_stellplaetze.map((slotNo) => ({
      phase: "TARGET",
      storage_location_id: normalizedMovement.storage_location_to_id,
      stellplatz_nr: slotNo
    }))
  ];

  if (!assignments.length) return;

  const placeholders = [];
  const values = [];
  assignments.forEach((assignment, index) => {
    const baseIndex = index * 4;
    placeholders.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4})`);
    values.push(
      transactionId,
      assignment.phase,
      assignment.storage_location_id,
      assignment.stellplatz_nr
    );
  });

  await client.query(
    `
    INSERT INTO transaction_slot_assignments (
      transaction_id,
      phase,
      storage_location_id,
      stellplatz_nr
    )
    VALUES ${placeholders.join(", ")}
    `,
    values
  );
}

async function applyMovement(client, movement, direction) {
  const normalizedMovement = resolveMovementSlots(movement);
  if (![1, -1].includes(direction)) {
    throw new WarehouseError(500, "Invalid movement direction");
  }

  if (normalizedMovement.typ === "IN") {
    await ensureStorageLocationSlots(
      client,
      normalizedMovement.storage_location_to_id,
      normalizedMovement.target_stellplaetze,
      "target_stellplaetze"
    );

    for (const slotNo of normalizedMovement.target_stellplaetze) {
      if (direction === 1) {
        await addInventoryOccupancy(client, normalizedMovement, normalizedMovement.storage_location_to_id, slotNo);
      } else {
        await removeInventoryOccupancy(client, normalizedMovement, normalizedMovement.storage_location_to_id, slotNo);
      }
    }
    return;
  }

  if (normalizedMovement.typ === "OUT") {
    await ensureStorageLocationSlots(
      client,
      normalizedMovement.storage_location_from_id,
      normalizedMovement.source_stellplaetze,
      "source_stellplaetze"
    );

    for (const slotNo of normalizedMovement.source_stellplaetze) {
      if (direction === 1) {
        await removeInventoryOccupancy(client, normalizedMovement, normalizedMovement.storage_location_from_id, slotNo);
      } else {
        await addInventoryOccupancy(client, normalizedMovement, normalizedMovement.storage_location_from_id, slotNo);
      }
    }
    return;
  }

  await ensureStorageLocationSlots(
    client,
    normalizedMovement.storage_location_from_id,
    normalizedMovement.source_stellplaetze,
    "source_stellplaetze"
  );
  await ensureStorageLocationSlots(
    client,
    normalizedMovement.storage_location_to_id,
    normalizedMovement.target_stellplaetze,
    "target_stellplaetze"
  );

  if (direction === 1) {
    for (const slotNo of normalizedMovement.source_stellplaetze) {
      await removeInventoryOccupancy(client, normalizedMovement, normalizedMovement.storage_location_from_id, slotNo);
    }
    for (const slotNo of normalizedMovement.target_stellplaetze) {
      await addInventoryOccupancy(client, normalizedMovement, normalizedMovement.storage_location_to_id, slotNo);
    }
    return;
  }

  for (const slotNo of normalizedMovement.target_stellplaetze) {
    await removeInventoryOccupancy(client, normalizedMovement, normalizedMovement.storage_location_to_id, slotNo);
  }
  for (const slotNo of normalizedMovement.source_stellplaetze) {
    await addInventoryOccupancy(client, normalizedMovement, normalizedMovement.storage_location_from_id, slotNo);
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
    positions_nr: normalizeText(item?.positions_nr, `items[${index}].positions_nr`, {
      required: true,
      maxLength: 120
    }),
    rollen_nummern: normalizeText(item?.rollen_nummern, `items[${index}].rollen_nummern`, {
      required: true,
      maxLength: 255
    })
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
        OR LOWER(COALESCE(t.verpackungsart, '')) LIKE $${idx}
        OR CAST(COALESCE(t.stellplatz_nr, 0) AS TEXT) LIKE $${idx}
        OR EXISTS (
          SELECT 1
          FROM transaction_slot_assignments tsa
          WHERE tsa.transaction_id = t.id
            AND CAST(tsa.stellplatz_nr AS TEXT) LIKE $${idx}
        )
      )`
    );
  }

  const typ = filters.typ ? normalizeEnum(filters.typ, TRANSACTION_TYPES, "typ", { required: false }) : null;
  if (typ) {
    values.push(typ);
    where.push(`t.typ = $${values.length}`);
  }

  const customerId = normalizeInteger(filters.customer_id, "customer_id", { required: false, min: 1, allowNull: true });
  if (customerId) {
    values.push(customerId);
    where.push(`t.customer_id = $${values.length}`);
  }

  const positionsNr = normalizeText(filters.positions_nr, "positions_nr", { required: false, maxLength: 120 });
  if (positionsNr) {
    values.push(`%${positionsNr.toLowerCase()}%`);
    where.push(`LOWER(COALESCE(t.positions_nr, '')) LIKE $${values.length}`);
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

  const stellplatzNr = normalizeInteger(filters.stellplatz_nr, "stellplatz_nr", {
    required: false,
    min: 1,
    allowNull: true
  });
  if (stellplatzNr) {
    values.push(stellplatzNr);
    where.push(
      `(
        t.stellplatz_nr = $${values.length}
        OR EXISTS (
          SELECT 1
          FROM transaction_slot_assignments tsa
          WHERE tsa.transaction_id = t.id
            AND tsa.stellplatz_nr = $${values.length}
        )
      )`
    );
  }

  const verpackungsart = filters.verpackungsart
    ? normalizePackagingType(filters.verpackungsart, "verpackungsart", { required: false })
    : null;
  if (verpackungsart) {
    values.push(verpackungsart);
    where.push(`t.verpackungsart = $${values.length}`);
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
      recent_transactions: await attachTransactionSlotAssignments(pool, recentTransactions),
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
  const row = await getCustomerCore(pool, customerId);
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
          COALESCE(SUM(i.menge), 0)::int AS belegte_menge,
          GREATEST(sl.kapazitaet - COUNT(i.id)::int, 0)::int AS freie_stellplaetze,
          COALESCE(MAX(i.stellplatz_nr), 0)::int AS max_belegter_stellplatz
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
      COALESCE(SUM(i.menge), 0)::int AS belegte_menge,
      GREATEST(sl.kapazitaet - COUNT(i.id)::int, 0)::int AS freie_stellplaetze,
      COALESCE(MAX(i.stellplatz_nr), 0)::int AS max_belegter_stellplatz
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

async function listStorageLocationSlots(id, filters = {}) {
  const locationId = normalizeInteger(id, "id", { required: true, min: 1 });
  const location = await getStorageLocationCore(pool, locationId);
  if (!location) throw new WarehouseError(404, "Storage location not found");

  const status = filters.status
    ? normalizeEnum(String(filters.status).toUpperCase(), SLOT_STATUS_TYPES, "status", { required: false })
    : null;

  try {
    return (
      await pool.query(
        `
        WITH slot_base AS (
          SELECT
            sl.id AS storage_location_id,
            sl.name AS storage_location_name,
            sl.typ AS storage_location_type,
            sl.kapazitaet AS storage_location_capacity,
            gs.slot_no::int AS stellplatz_nr,
            i.id AS inventory_id,
            i.verpackungsart,
            i.menge,
            i.created_at,
            i.updated_at
          FROM storage_locations sl
          CROSS JOIN LATERAL generate_series(1, sl.kapazitaet) AS gs(slot_no)
          LEFT JOIN inventory i
            ON i.storage_location_id = sl.id
           AND i.stellplatz_nr = gs.slot_no
          WHERE sl.id = $1
        )
        SELECT
          sb.storage_location_id,
          sb.storage_location_name,
          sb.storage_location_type,
          sb.storage_location_capacity,
          sb.stellplatz_nr,
          CASE WHEN sb.inventory_id IS NULL THEN 'FREE' ELSE 'OCCUPIED' END AS status,
          sb.inventory_id,
          sb.verpackungsart,
          sb.menge,
          sb.created_at,
          sb.updated_at,
          tx.id AS last_transaction_id,
          tx.typ AS last_transaction_type,
          tx.datum AS last_transaction_datum,
          tx.user_id AS stored_by_user_id,
          u.username AS stored_by_username,
          tx.beleg_nr,
          tx.positions_nr,
          tx.verpackungsart AS last_transaction_verpackungsart,
          c.id AS customer_id,
          c.kunden_nr,
          c.name AS customer_name
        FROM slot_base sb
        LEFT JOIN LATERAL (
          SELECT
            t.id,
            t.typ,
            t.datum,
            t.user_id,
            t.beleg_nr,
            t.positions_nr,
            t.customer_id,
            t.verpackungsart
          FROM transaction_slot_assignments tsa
          INNER JOIN transactions t ON t.id = tsa.transaction_id
          WHERE tsa.phase = 'TARGET'
            AND tsa.storage_location_id = sb.storage_location_id
            AND tsa.stellplatz_nr = sb.stellplatz_nr
          ORDER BY t.datum DESC, t.id DESC
          LIMIT 1
        ) tx ON sb.inventory_id IS NOT NULL
        LEFT JOIN users u ON u.id = tx.user_id
        LEFT JOIN customers c ON c.id = tx.customer_id
        WHERE ($2::text IS NULL OR CASE WHEN sb.inventory_id IS NULL THEN 'FREE' ELSE 'OCCUPIED' END = $2)
        ORDER BY sb.stellplatz_nr ASC
        `,
        [locationId, status]
      )
    ).rows;
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Storage location not found"
    });
  }
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
    values.push(await ensureStorageLocationCapacity(pool, locationId, payload.kapazitaet));
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
        OR LOWER(COALESCE(tx.beleg_nr, '')) LIKE $${idx}
        OR LOWER(COALESCE(tx.positions_nr, '')) LIKE $${idx}
        OR LOWER(COALESCE(c.kunden_nr, '')) LIKE $${idx}
        OR LOWER(COALESCE(c.name, '')) LIKE $${idx}
        OR LOWER(COALESCE(i.verpackungsart, '')) LIKE $${idx}
        OR CAST(i.stellplatz_nr AS TEXT) LIKE $${idx}
      )`
    );
  }

  const customerId = normalizeInteger(filters.customer_id, "customer_id", {
    required: false,
    min: 1,
    allowNull: true
  });
  if (customerId) {
    values.push(customerId);
    where.push(`tx.customer_id = $${values.length}`);
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

  const stellplatzNr = normalizeInteger(filters.stellplatz_nr, "stellplatz_nr", {
    required: false,
    min: 1,
    allowNull: true
  });
  if (stellplatzNr) {
    values.push(stellplatzNr);
    where.push(`i.stellplatz_nr = $${values.length}`);
  }

  const positionsNr = normalizeText(filters.positions_nr, "positions_nr", { required: false, maxLength: 120 });
  if (positionsNr) {
    values.push(`%${positionsNr.toLowerCase()}%`);
    where.push(`LOWER(COALESCE(tx.positions_nr, '')) LIKE $${values.length}`);
  }

  const verpackungsart = filters.verpackungsart
    ? normalizePackagingType(filters.verpackungsart, "verpackungsart", { required: false })
    : null;
  if (verpackungsart) {
    values.push(verpackungsart);
    where.push(`i.verpackungsart = $${values.length}`);
  }

  values.push(normalizeLimit(filters.limit));

  try {
    return (
      await pool.query(
        `
        ${INVENTORY_SELECT}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY sl.name ASC, i.stellplatz_nr ASC, tx.positions_nr ASC NULLS LAST
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
  const stellplatzNr = normalizeInteger(payload.stellplatz_nr, "stellplatz_nr", { required: true, min: 1 });
  const menge = normalizeInteger(payload.menge, "menge", { required: true, min: 1 });
  const verpackungsart = normalizePackagingType(payload.verpackungsart, "verpackungsart", { required: true });

  if (menge !== 1) {
    throw new WarehouseError(400, "Inventory records must use menge = 1 per slot");
  }

  try {
    return await withTransaction(async (client) => {
      await ensureStorageLocationSlot(client, storageLocationId, stellplatzNr);
      const result = await client.query(
        `
        INSERT INTO inventory (
          storage_location_id,
          stellplatz_nr,
          menge,
          verpackungsart,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, now(), now())
        RETURNING id
        `,
        [storageLocationId, stellplatzNr, menge, verpackungsart]
      );
      return getInventoryById(client, result.rows[0].id);
    });
  } catch (error) {
    throw translateDbError(error, {
      uniqueMessage: "Inventory record for this storage location and slot already exists",
      fkMessage: "Storage location not found"
    });
  }
}

async function updateInventoryRecord(id, payload) {
  const inventoryId = normalizeInteger(id, "id", { required: true, min: 1 });

  try {
    return await withTransaction(async (client) => {
      const current = await getOneOrNull(
        client,
        `
        SELECT id, storage_location_id, stellplatz_nr, menge, verpackungsart
        FROM inventory
        WHERE id = $1
        FOR UPDATE
        `,
        [inventoryId]
      );

      if (!current) throw new WarehouseError(404, "Inventory record not found");

      const nextStorageLocationId = hasOwn(payload, "storage_location_id")
        ? normalizeInteger(payload.storage_location_id, "storage_location_id", { required: true, min: 1 })
        : current.storage_location_id;
      const nextStellplatzNr = hasOwn(payload, "stellplatz_nr")
        ? normalizeInteger(payload.stellplatz_nr, "stellplatz_nr", { required: true, min: 1 })
        : current.stellplatz_nr;
      const nextMenge = hasOwn(payload, "menge")
        ? normalizeInteger(payload.menge, "menge", { required: true, min: 1 })
        : current.menge;
      const nextVerpackungsart = hasOwn(payload, "verpackungsart")
        ? normalizePackagingType(payload.verpackungsart, "verpackungsart", { required: true })
        : current.verpackungsart;

      if (Number(nextMenge) !== 1) {
        throw new WarehouseError(400, "Inventory records must use menge = 1 per slot");
      }

      if (
        Number(nextStorageLocationId) === Number(current.storage_location_id)
        && Number(nextStellplatzNr) === Number(current.stellplatz_nr)
        && Number(nextMenge) === Number(current.menge)
        && (nextVerpackungsart || null) === (current.verpackungsart || null)
      ) {
        throw new WarehouseError(400, "No inventory changes provided");
      }

      await ensureStorageLocationSlot(client, nextStorageLocationId, nextStellplatzNr);

      const result = await client.query(
        `
        UPDATE inventory
        SET
          storage_location_id = $1,
          stellplatz_nr = $2,
          menge = $3,
          verpackungsart = $4,
          updated_at = now()
        WHERE id = $5
        RETURNING id
        `,
        [nextStorageLocationId, nextStellplatzNr, nextMenge, nextVerpackungsart, inventoryId]
      );

      return getInventoryById(client, result.rows[0].id);
    });
  } catch (error) {
    throw translateDbError(error, {
      uniqueMessage: "Inventory record for this storage location and slot already exists",
      fkMessage: "Storage location not found"
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
    const rows = (
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
    return attachTransactionSlotAssignments(pool, rows);
  } catch (error) {
    throw translateDbError(error);
  }
}

async function exportTransactions(filters = {}) {
  const { whereSql, values } = buildTransactionFilters(filters, { withLimit: false });
  try {
    const rows = (
      await pool.query(
        `
        ${TRANSACTION_SELECT}
        ${whereSql}
        ORDER BY t.datum DESC, t.id DESC
        `,
        values
      )
    ).rows;
    return attachTransactionSlotAssignments(pool, rows);
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

async function insertMovementTransaction(client, movement, actorId) {
  const inserted = await client.query(
    `
    INSERT INTO transactions (
      typ,
      menge,
      storage_location_from_id,
      storage_location_to_id,
      stellplatz_nr,
      verpackungsart,
      customer_id,
      beleg_nr,
      positions_nr,
      user_id,
      datum,
      notiz
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
    `,
    [
      movement.typ,
      movement.menge,
      movement.storage_location_from_id,
      movement.storage_location_to_id,
      movement.stellplatz_nr,
      movement.verpackungsart,
      movement.customer_id,
      movement.beleg_nr,
      movement.positions_nr,
      actorId,
      movement.datum,
      movement.notiz
    ]
  );

  await replaceTransactionSlotAssignments(client, inserted.rows[0].id, movement);
  return getTransactionById(client, inserted.rows[0].id);
}

async function createTransactionRecord(payload, userId) {
  const actorId = normalizeInteger(userId, "user_id", { required: true, min: 1 });
  const movement = normalizeMovementPayload(payload, { requireAll: true });

  try {
    return await withTransaction(async (client) => {
      await applyMovement(client, movement, 1);
      return insertMovementTransaction(client, movement, actorId);
    });
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Referenced customer, storage location or user not found",
      checkMessage: "Transaction data is invalid"
    });
  }
}

async function transferInventorySlot(payload, userId) {
  const actorId = normalizeInteger(userId, "user_id", { required: true, min: 1 });
  const sourceLocationId = normalizeInteger(payload.storage_location_from_id, "storage_location_from_id", {
    required: true,
    min: 1
  });
  const targetLocationId = normalizeInteger(payload.storage_location_to_id, "storage_location_to_id", {
    required: true,
    min: 1
  });
  const sourceSlot = normalizeInteger(payload.source_stellplatz_nr, "source_stellplatz_nr", {
    required: true,
    min: 1
  });
  const targetSlot = normalizeInteger(payload.target_stellplatz_nr, "target_stellplatz_nr", {
    required: true,
    min: 1
  });
  const datum = normalizeDateTime(payload.datum, "datum", { required: false, defaultNow: true });
  const notiz = normalizeText(payload.notiz, "notiz", { required: false, maxLength: 4000 });

  if (sourceLocationId === targetLocationId && sourceSlot === targetSlot) {
    throw new WarehouseError(400, "Source and target slot must differ for a transfer");
  }

  try {
    return await withTransaction(async (client) => {
      await ensureStorageLocationSlot(client, sourceLocationId, sourceSlot, "source_stellplatz_nr");
      await ensureStorageLocationSlot(client, targetLocationId, targetSlot, "target_stellplatz_nr");

      const sourceInventory = await getOneOrNull(
        client,
        `
        SELECT
          i.id,
          i.storage_location_id,
          i.stellplatz_nr,
          i.verpackungsart,
          tx.customer_id,
          tx.beleg_nr,
          tx.positions_nr
        FROM inventory i
        LEFT JOIN LATERAL (
          SELECT
            t.customer_id,
            t.beleg_nr,
            t.positions_nr
          FROM transaction_slot_assignments tsa
          INNER JOIN transactions t ON t.id = tsa.transaction_id
          WHERE tsa.phase = 'TARGET'
            AND tsa.storage_location_id = i.storage_location_id
            AND tsa.stellplatz_nr = i.stellplatz_nr
          ORDER BY t.datum DESC, t.id DESC
          LIMIT 1
        ) tx ON TRUE
        WHERE i.storage_location_id = $1
          AND i.stellplatz_nr = $2
        FOR UPDATE OF i
        `,
        [sourceLocationId, sourceSlot]
      );

      if (!sourceInventory) {
        throw new WarehouseError(404, "Source slot is not occupied");
      }

      const targetInventory = await getOneOrNull(
        client,
        `
        SELECT id
        FROM inventory
        WHERE storage_location_id = $1
          AND stellplatz_nr = $2
        FOR UPDATE
        `,
        [targetLocationId, targetSlot]
      );

      if (targetInventory) {
        throw new WarehouseError(409, "Target slot is already occupied");
      }

      const movement = normalizeMovementPayload(
        {
          typ: "TRANSFER",
          menge: 1,
          storage_location_from_id: sourceLocationId,
          storage_location_to_id: targetLocationId,
          source_stellplaetze: [sourceSlot],
          target_stellplaetze: [targetSlot],
          verpackungsart: sourceInventory.verpackungsart,
          customer_id: sourceInventory.customer_id,
          beleg_nr: sourceInventory.beleg_nr,
          positions_nr: sourceInventory.positions_nr,
          datum,
          notiz: notiz || "Umlagerung via Drag & Drop"
        },
        { requireAll: true }
      );

      await applyMovement(client, movement, 1);
      const transaction = await insertMovementTransaction(client, movement, actorId);
      const movedInventory = await getOneOrNull(
        client,
        `
        SELECT id
        FROM inventory
        WHERE storage_location_id = $1
          AND stellplatz_nr = $2
        `,
        [targetLocationId, targetSlot]
      );

      return {
        ok: true,
        inventory: movedInventory ? await getInventoryById(client, movedInventory.id) : null,
        transaction
      };
    });
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Referenced storage location or user not found",
      checkMessage: "Transfer data is invalid"
    });
  }
}

async function updateTransactionRecord(id, payload) {
  const transactionId = normalizeInteger(id, "id", { required: true, min: 1 });
  const movement = normalizeMovementPayload(payload, { requireAll: true });

  try {
    return await withTransaction(async (client) => {
      const currentBase = await getOneOrNull(
        client,
        `
        SELECT
          id,
          typ,
          menge,
          storage_location_from_id,
          storage_location_to_id,
          stellplatz_nr,
          verpackungsart,
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

      if (!currentBase) throw new WarehouseError(404, "Transaction not found");
      const [current] = await attachTransactionSlotAssignments(client, [currentBase]);

      await applyMovement(client, current, -1);
      await applyMovement(client, movement, 1);

      await client.query(
        `
        UPDATE transactions
        SET
          typ = $1,
          menge = $2,
          storage_location_from_id = $3,
          storage_location_to_id = $4,
          stellplatz_nr = $5,
          verpackungsart = $6,
          customer_id = $7,
          beleg_nr = $8,
          positions_nr = $9,
          datum = $10,
          notiz = $11
        WHERE id = $12
        `,
        [
          movement.typ,
          movement.menge,
          movement.storage_location_from_id,
          movement.storage_location_to_id,
          movement.stellplatz_nr,
          movement.verpackungsart,
          movement.customer_id,
          movement.beleg_nr,
          movement.positions_nr,
          movement.datum,
          movement.notiz,
          transactionId
        ]
      );

      await replaceTransactionSlotAssignments(client, transactionId, movement);
      return getTransactionById(client, transactionId);
    });
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Referenced customer or storage location not found",
      checkMessage: "Transaction data is invalid"
    });
  }
}

async function deleteTransactionRecord(id) {
  const transactionId = normalizeInteger(id, "id", { required: true, min: 1 });

  try {
    return await withTransaction(async (client) => {
      const currentBase = await getOneOrNull(
        client,
        `
        SELECT
          id,
          typ,
          menge,
          storage_location_from_id,
          storage_location_to_id,
          stellplatz_nr,
          verpackungsart,
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

      if (!currentBase) throw new WarehouseError(404, "Transaction not found");
      const [current] = await attachTransactionSlotAssignments(client, [currentBase]);

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
        LOWER(COALESCE(po.notiz, '')) LIKE $${idx}
        OR LOWER(COALESCE(c.kunden_nr, '')) LIKE $${idx}
        OR LOWER(COALESCE(c.name, '')) LIKE $${idx}
        OR EXISTS (
          SELECT 1
          FROM picking_order_items poi
          WHERE poi.order_id = po.id
            AND (
              LOWER(COALESCE(poi.positions_nr, '')) LIKE $${idx}
              OR LOWER(COALESCE(poi.rollen_nummern, '')) LIKE $${idx}
            )
        )
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
  const notiz = normalizeText(payload.notiz, "notiz", { required: false, maxLength: 2000 });
  const bearbeiterUserId = normalizeInteger(payload.bearbeiter_user_id, "bearbeiter_user_id", {
    required: false,
    min: 1,
    allowNull: true
  });
  const faelligAm = normalizeDateOnly(payload.faellig_am, "faellig_am", { required: false });
  const items = normalizePickingItems(payload.items, { required: true });

  try {
    return await withTransaction(async (client) => {
      const customerRef = await resolveCustomerReference(client, payload, { required: true });
      const inserted = await client.query(
        `
        INSERT INTO picking_orders (
          status,
          customer_id,
          notiz,
          ersteller_user_id,
          bearbeiter_user_id,
          faellig_am
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        `,
        [status, customerRef.customer_id, notiz, actorId, bearbeiterUserId, faelligAm]
      );

      for (const item of items) {
        await client.query(
          `
          INSERT INTO picking_order_items (order_id, positions_nr, rollen_nummern)
          VALUES ($1, $2, $3)
          `,
          [inserted.rows[0].id, item.positions_nr, item.rollen_nummern]
        );
      }

      return getPickingOrderById(client, inserted.rows[0].id);
    });
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Referenced customer or user not found",
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
  const customerChangeProvided = hasOwn(payload, "customer_id") || hasOwn(payload, "customer_name");
  if (hasOwn(payload, "notiz")) {
    values.push(normalizeText(payload.notiz, "notiz", { required: false, maxLength: 2000 }));
    updates.push(`notiz = $${values.length}`);
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

  if (!updates.length && !itemsProvided && !customerChangeProvided) {
    throw new WarehouseError(400, "No picking order changes provided");
  }

  try {
    return await withTransaction(async (client) => {
      const exists = await getOneOrNull(client, `SELECT id FROM picking_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      if (!exists) throw new WarehouseError(404, "Picking order not found");

      if (customerChangeProvided) {
        const customerRef = await resolveCustomerReference(client, payload, { required: false });
        values.push(customerRef.customer_id ?? null);
        updates.push(`customer_id = $${values.length}`);
      }

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
            INSERT INTO picking_order_items (order_id, positions_nr, rollen_nummern)
            VALUES ($1, $2, $3)
            `,
            [orderId, item.positions_nr, item.rollen_nummern]
          );
        }
      }

      return getPickingOrderById(client, orderId);
    });
  } catch (error) {
    throw translateDbError(error, {
      fkMessage: "Referenced customer or user not found",
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
  const rollenNummern = normalizeText(payload.rollen_nummern, "rollen_nummern", { required: true, maxLength: 255 });

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
        SET rollen_nummern = $1
        WHERE id = $2 AND order_id = $3
        `,
        [rollenNummern, normalizedItemId, normalizedOrderId]
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
            INSERT INTO picking_order_items (order_id, positions_nr, rollen_nummern)
            VALUES ($1, $2, $3)
            `,
            [orderId, item.positions_nr, item.rollen_nummern]
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
      fkMessage: "Referenced user not found"
    });
  }
}

module.exports = {
  PACKAGING_TYPES,
  PICKING_STATUSES,
  STORAGE_LOCATION_TYPES,
  TRANSACTION_TYPES,
  WarehouseError,
  completePickingOrder,
  createCustomer,
  createInventoryRecord,
  createPickingOrder,
  createStorageLocation,
  createTransactionRecord,
  deleteCustomer,
  deleteInventoryRecord,
  deletePickingOrder,
  deleteStorageLocation,
  deleteTransactionRecord,
  exportTransactions,
  fetchPickingOrder,
  fetchTransactionRecord,
  getCustomer,
  getDashboardSummary,
  getInventoryRecord,
  getStorageLocation,
  listCustomers,
  listInventory,
  listPickingOrders,
  listStorageLocationSlots,
  listStorageLocations,
  listTransactions,
  startPickingOrder,
  transferInventorySlot,
  updateCustomer,
  updateInventoryRecord,
  updatePickingOrder,
  updatePickingOrderItem,
  updateStorageLocation,
  updateTransactionRecord
};
