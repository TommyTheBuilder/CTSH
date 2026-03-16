const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Parser } = require("json2csv");
const ExcelJS = require("exceljs");
const path = require('path');
const crypto = require("crypto");

const { pool } = require("./db_pg");
const { authRequired, adminRequired, JWT_SECRET } = require("./middleware_auth");
const { requirePermission } = require("./middleware_permissions");
const { checkIpBlocked, registerFailedLogin, clearFailedLogin } = require("./security/loginRateLimit");
const { createWarehouseRouter } = require("./modules/warehouse/router");
const permissionsConfig = require("./permissions_config");
const {
  buildDashboardModules,
  canAccessAppAdmin,
  canAccessCustomerAdmin,
  canAccessModule,
  canAccessModuleAdmin,
  canAccessPalletModuleAdmin,
  filterPermissionsByEnabledModules,
  getCustomerById,
  getEnabledModuleKeysForCustomer,
  getInstallationCustomer,
  getInstallationCustomerId,
  getUserContext,
  getUserPermissions,
  isAppAdmin,
  listCustomers,
  resolveManagedCustomerId
} = require("./core/platform_access");
const { getModuleByKey, listModules } = require("./core/module_registry");

const CORS_ORIGIN = process.env.CORS_ORIGIN || "https://paletten-ms.de";
const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || "100kb";
const PRODUCT_TYPES = ["euro", "h1", "gitterbox"];
const SHARED_AUTH_SECRET = String(process.env.SHARED_AUTH_SECRET || "13215489156189421598412").trim();
const SSO_MAX_TOKEN_AGE_SECONDS = Number(process.env.SSO_MAX_TOKEN_AGE_SECONDS || 300);
const MODULE_PALLETS_PATH = "/modules/pallets/index.html";
const MODULE_PALLETS_ADMIN_PATH = "/modules/pallets/admin.html";
const MODULE_CONTAINER_PLANNING_PATH = "/modules/container-planning/index.html";
const MODULE_CONTAINER_REGISTRATION_ADMIN_PATH = "/modules/container-registration/admin.html";
const MODULE_CONTAINER_REGISTRATION_DRIVER_PATH = "/modules/container-registration/driver.html";
const MODULE_CONTAINER_REGISTRATION_VIEWER_PATH = "/modules/container-registration/viewer.html";

const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || "portal_auth").trim();
const AUTH_COOKIE_DOMAIN = String(process.env.AUTH_COOKIE_DOMAIN || "paletten-ms.de").trim();
const AUTH_COOKIE_SAME_SITE = String(process.env.AUTH_COOKIE_SAME_SITE || "None").trim();
const AUTH_COOKIE_MAX_AGE_SECONDS = Number(process.env.AUTH_COOKIE_MAX_AGE_SECONDS || 12 * 60 * 60);

function buildAuthCookieOptions() {
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: AUTH_COOKIE_SAME_SITE,
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS * 1000
  };
  if (AUTH_COOKIE_DOMAIN) {
    options.domain = AUTH_COOKIE_DOMAIN;
  }
  return options;
}

function setAuthCookie(res, token) {
  if (!AUTH_COOKIE_NAME || !token) return;
  res.cookie(AUTH_COOKIE_NAME, token, buildAuthCookieOptions());
}

function clearAuthCookie(res) {
  if (!AUTH_COOKIE_NAME) return;
  const { maxAge, ...clearOptions } = buildAuthCookieOptions();
  res.clearCookie(AUTH_COOKIE_NAME, clearOptions);
}

function getRequestToken(req, options = {}) {
  const {
    allowHeader = true,
    allowQuery = true,
    allowCookie = true
  } = options;

  if (allowHeader) {
    const header = String(req.headers.authorization || "");
    const headerToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (headerToken) return headerToken;
  }

  if (allowQuery) {
    const queryToken = String(req.query?.portalToken || req.query?.token || "").trim();
    if (queryToken) return queryToken;
  }

  if (allowCookie) {
    const cookieHeader = String(req.headers.cookie || "");
    const cookieMatch = cookieHeader.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE_NAME}=([^;]+)`));
    if (cookieMatch?.[1]) {
      return decodeURIComponent(cookieMatch[1]);
    }
  }

  return "";
}

async function getAuthenticatedPortalUser(req, options) {
  const token = getRequestToken(req, options);
  if (!token) return null;

  try {
    const claims = jwt.verify(token, JWT_SECRET);
    return await getUserContext(claims?.id);
  } catch {
    return null;
  }
}

function requireModulePageAccess(permissionResolver) {
  return async (req, res, next) => {
    const user = await getAuthenticatedPortalUser(req, { allowHeader: false, allowQuery: false, allowCookie: true });
    if (!user) {
      return res.redirect("/login.html");
    }

    try {
      const perms = await getMyPermissions(user);
      const allowed = typeof permissionResolver === "function"
        ? await permissionResolver(user, perms, req)
        : true;
      if (!allowed) {
        return res.redirect("/public/dashboard.html");
      }

      req.user = user;
      req.portalPermissions = perms;
      return next();
    } catch (error) {
      console.error("requireModulePageAccess error:", error);
      return res.status(500).send("Permission check failed");
    }
  };
}

function getAllowedOrigins() {
  if (CORS_ORIGIN === "*") return "*";
  return Array.from(new Set(CORS_ORIGIN.split(",").map((x) => x.trim()).filter(Boolean)));
}

function corsOriginResolver(origin, callback) {
  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins === "*") return callback(null, true);
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  console.warn("[CORS] Blocked origin:", origin, "Allowed origins:", allowedOrigins.join(", "));
  return callback(new Error("Not allowed by CORS"));
}

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:"],
      "connect-src": ["'self'", "ws:", "wss:"]
    }
  }
}));
app.use(cors({ origin: corsOriginResolver, credentials: true }));
app.use(express.json({ limit: MAX_BODY_SIZE }));
app.get("/", (req, res) => res.redirect("/login.html"));
app.get("/login", (req, res) => res.redirect("/login.html"));
app.use(async (req, res, next) => {
  if (!req.path.endsWith(".html")) return next();

  const gatedPages = new Set([
    "/dashboard.html",
    "/public/dashboard.html",
    "/admin.html",
    "/public/admin.html",
    "/app-admin.html",
    "/public/app-admin.html",
    "/app.html",
    "/public/app.html",
    "/entrepreneurs.html",
    "/public/entrepreneurs.html"
  ]);

  if (!gatedPages.has(req.path)) return next();

  const user = await getAuthenticatedPortalUser(req, { allowHeader: false, allowQuery: false, allowCookie: true });
  if (!user) return res.redirect("/login.html");

  const permissions = await getMyPermissions(user);
  const enabledModuleKeys = await getActiveModuleKeysForUser(user);

  if (req.path.endsWith("/dashboard.html")) return next();

  if (req.path.endsWith("/admin.html")) {
    if (!canAccessCustomerAdmin(user, permissions)) {
      return res.redirect("/public/dashboard.html");
    }
    return next();
  }

  if (req.path.endsWith("/app-admin.html")) {
    if (!canAccessAppAdmin(user)) {
      return res.redirect("/public/dashboard.html");
    }
    return next();
  }

  if (req.path.endsWith("/app.html")) {
    if (!canAccessModule("pallets", user, permissions, enabledModuleKeys)) {
      return res.redirect("/public/dashboard.html");
    }
    return next();
  }

  if (req.path.endsWith("/entrepreneurs.html")) {
    if (!canAccessModuleAdmin("pallets", user, permissions, enabledModuleKeys)) {
      return res.redirect("/public/dashboard.html");
    }
    return next();
  }

  return next();
});
// Backward compatibility: some deployments still open pages via /public/*.html.
// Mount static assets on both / and /public so relative links keep working.
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/modules", async (req, res, next) => {
  if (!req.path.endsWith(".html")) return next();

  const user = await getAuthenticatedPortalUser(req, { allowHeader: false, allowQuery: false, allowCookie: true });
  if (!user) return res.redirect("/login.html");

  try {
    const perms = await getMyPermissions(user);
    let allowed = false;
    if (req.path === "/pallets/index.html" || req.path === "/pallets/open-pallets.html") {
      const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
      allowed = canAccessModule("pallets", user, perms, enabledModuleKeys);
    } else if (req.path === "/pallets/admin.html") {
      const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req, { allowRequestedCustomer: true });
      allowed = canAccessModuleAdmin("pallets", user, perms, enabledModuleKeys);
    } else if (req.path.startsWith("/container-planning")) {
      const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
      allowed = canAccessModule("container_planning", user, perms, enabledModuleKeys);
    } else if (req.path === "/container-registration/admin.html") {
      const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
      allowed = canAccessModuleAdmin("container_registration", user, perms, enabledModuleKeys);
    } else if (req.path === "/container-registration/driver.html") {
      const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
      allowed = canAccessModule("container_registration", user, perms, enabledModuleKeys);
    } else if (req.path === "/container-registration/viewer.html") {
      const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
      allowed = canAccessModule("container_registration", user, perms, enabledModuleKeys)
        && hasContainerViewerPermission(perms);
    } else if (req.path.startsWith("/warehouse")) {
      const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
      allowed = canAccessModule("warehouse", user, perms, enabledModuleKeys);
    }

    if (!allowed) return res.redirect("/public/dashboard.html");
    return next();
  } catch (error) {
    console.error("Module HTML gate failed:", error);
    return res.status(500).send("Permission check failed");
  }
});
app.use("/modules", express.static(path.join(__dirname, "public/modules")));
app.use(express.static(path.join(__dirname, 'public')));

const httpServer = require("http").createServer(app);
const io = require("socket.io")(httpServer, {
  cors: {
    origin: corsOriginResolver,
    credentials: true
  }
});

io.on("connection", (socket) => {
  socket.on("joinLocation", (locationId) => {
    if (locationId) socket.join(`loc:${locationId}`);
  });

  socket.on("joinUser", (userId) => {
    const parsedUserId = Number(userId);
    if (Number.isInteger(parsedUserId) && parsedUserId > 0) {
      socket.join(`user:${parsedUserId}`);
    }
  });
});

const containerRegistrationNamespace = io.of("/container-registration");
const containerPlanningNamespace = io.of("/container-planning");
const CONTAINER_REGISTRATION_STATUS_SLOT_CREATED = "slot_created";
const CONTAINER_REGISTRATION_STATUS_REGISTERED = "registered";
const CONTAINER_REGISTRATION_STATUS_TO_RAMP = "to_ramp";
const CONTAINER_REGISTRATION_STATUS_WAITING_CUSTOMS = "waiting_customs";
const CONTAINER_REGISTRATION_STATUS_CUSTOMS_RELEASED = "customs_released";
const CONTAINER_REGISTRATION_STATUSES = [
  CONTAINER_REGISTRATION_STATUS_SLOT_CREATED,
  CONTAINER_REGISTRATION_STATUS_REGISTERED,
  CONTAINER_REGISTRATION_STATUS_TO_RAMP,
  CONTAINER_REGISTRATION_STATUS_WAITING_CUSTOMS,
  CONTAINER_REGISTRATION_STATUS_CUSTOMS_RELEASED
];
const CONTAINER_REGISTRATION_HISTORY_MAX = Number(process.env.CONTAINER_REGISTRATION_HISTORY_MAX || 5000);
let containerRegistrationState = {};

async function q(sql, params = []) {
  return pool.query(sql, params);
}

function normalizeProductType(value) {
  const normalized = String(value || "euro").trim().toLowerCase();
  if (!PRODUCT_TYPES.includes(normalized)) {
    return { ok: false, msg: "product_type invalid" };
  }
  return { ok: true, productType: normalized };
}

function toPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function getUserCustomerId(user) {
  return toPositiveInt(user?.app_customer_id);
}

async function getActiveModuleKeysForUser(user) {
  const customerId = getUserCustomerId(user) || await getInstallationCustomerId(user);
  return getEnabledModuleKeysForCustomer(customerId);
}

async function getActiveModuleKeysForModuleRequest(user, _req, _options = {}) {
  const managedCustomerId = await resolveManagedCustomerId(user, null);
  if (managedCustomerId) {
    return getEnabledModuleKeysForCustomer(managedCustomerId);
  }
  return getActiveModuleKeysForUser(user);
}

async function isModuleEnabledForUser(user, moduleKey) {
  const enabledModules = await getActiveModuleKeysForUser(user);
  return enabledModules.includes(moduleKey);
}

async function assertRecordBelongsToCustomer(tableName, recordId, customerId, options = {}) {
  const normalizedRecordId = toPositiveInt(recordId);
  const normalizedCustomerId = toPositiveInt(customerId);
  if (!normalizedRecordId || !normalizedCustomerId) return false;

  const idColumn = options.idColumn || "id";
  const result = await q(
    `
    SELECT 1
    FROM ${tableName}
    WHERE ${idColumn} = $1
      AND app_customer_id = $2
    `,
    [normalizedRecordId, normalizedCustomerId]
  );

  return result.rowCount > 0;
}

function requireModuleEnabled(moduleKey) {
  return async (req, res, next) => {
    if (await isModuleEnabledForUser(req.user, moduleKey)) return next();
    return res.status(403).json({ error: "Module not enabled" });
  };
}

async function resolveRequestedCustomer(req) {
  return resolveManagedCustomerId(req.user, null);
}

function serializeInstallationModules(enabledModuleKeys) {
  const enabledSet = new Set(enabledModuleKeys || []);
  return listModules().map((moduleDefinition) => ({
    key: moduleDefinition.key,
    name: moduleDefinition.name,
    short_name: moduleDefinition.shortName,
    description: moduleDefinition.dashboard?.description || "",
    is_enabled: enabledSet.has(moduleDefinition.key),
    is_base_module: Boolean(moduleDefinition.licensing?.includedInBaseProduct),
    license_label: moduleDefinition.licensing?.label || "Zusatzmodul",
    license_note: moduleDefinition.licensing?.salesDescription || "",
    launch_path: moduleDefinition.launchPath,
    admin_path: moduleDefinition.adminPath || null
  }));
}

// ---------- Helpers ----------
async function nextReceiptNo(locationId) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const datePart = `${y}${m}${d}`;
  const loc = await q(`SELECT name FROM locations WHERE id=$1`, [locationId]);
  const locName = loc.rowCount ? String(loc.rows[0].name || "") : "";
  const letterMatch = locName.match(/[A-Za-zÄÖÜ]/);
  const numberMatch = locName.match(/\d+/);
  const locLetter = letterMatch ? letterMatch[0].toUpperCase() : "L";
  const locNumber = numberMatch ? numberMatch[0] : String(locationId);
  const locationIndicator = `${locLetter}${locNumber}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query(`SELECT next_no FROM receipt_seq WHERE id=1 FOR UPDATE`);
    const no = Number(row.rows[0].next_no);
    await client.query(`UPDATE receipt_seq SET next_no = next_no + 1 WHERE id=1`);
    await client.query("COMMIT");
    return `ICS${locationIndicator}-${datePart}-${String(no).padStart(6, "0")}`;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function previewReceiptNo(locationId) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const datePart = `${y}${m}${d}`;
  const loc = await q(`SELECT name FROM locations WHERE id=$1`, [locationId]);
  const locName = loc.rowCount ? String(loc.rows[0].name || "") : "";
  const letterMatch = locName.match(/[A-Za-zÄÖÜ]/);
  const numberMatch = locName.match(/\d+/);
  const locLetter = letterMatch ? letterMatch[0].toUpperCase() : "L";
  const locNumber = numberMatch ? numberMatch[0] : String(locationId);
  const locationIndicator = `${locLetter}${locNumber}`;

  const row = await q(`SELECT next_no FROM receipt_seq WHERE id=1`);
  const no = Number(row.rows[0]?.next_no || 1);
  return `ICS${locationIndicator}-${datePart}-${String(no).padStart(6, "0")}`;
}

function normalizePlate(plateRaw) {
  const plate = String(plateRaw || "").trim().toUpperCase();
  if (!plate) return { ok: false, msg: "Kennzeichen ist Pflicht" };
  if (plate.includes("-")) return { ok: false, msg: "Kennzeichen bitte ohne '-' eingeben" };
  if (/\s/.test(plate)) return { ok: false, msg: "Kennzeichen bitte ohne Leerzeichen eingeben" };
  if (!/^[A-Z0-9ÄÖÜ]+$/.test(plate)) return { ok: false, msg: "Kennzeichen nur Buchstaben/Zahlen (ohne Sonderzeichen)" };
  if (plate.length < 3) return { ok: false, msg: "Kennzeichen zu kurz" };
  return { ok: true, plate };
}

function normalizeEmployeeCode(codeRaw) {
  const code = safeTrim(codeRaw);
  if (!code) return null;
  const normalized = code.toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(normalized)) {
    return { ok: false, msg: "Lagermitarbeiter muss genau 2 Zeichen haben (Buchstaben/Zahlen)" };
  }
  return { ok: true, code: normalized };
}

function safeTrim(v) {
  const s = (v === undefined || v === null) ? "" : String(v);
  const t = s.trim();
  return t ? t : null;
}

const OPEN_PALLET_STATUSES = {
  open: "Offen",
  truck_planned: "LKW eingeplant",
  completed_waiting_document: "Erledigt - warten auf Beleg",
  document_booked_scanned: "Beleg gebucht und gescannt"
};

function normalizeOpenPalletStatus(statusRaw, { allowEmpty = false } = {}) {
  const status = String(statusRaw || "").trim().toLowerCase();
  if (!status) {
    if (allowEmpty) return { ok: true, status: null };
    return { ok: false, msg: "Status ist Pflicht" };
  }
  if (!Object.prototype.hasOwnProperty.call(OPEN_PALLET_STATUSES, status)) {
    return { ok: false, msg: "Ungueltiger Status" };
  }
  return { ok: true, status };
}

function canViewAllOpenPallets(perms) {
  return Boolean(perms?.admin?.full_access || perms?.open_pallets?.view_all);
}

function getOpenPalletDepartmentScope(user, perms) {
  const fixedDepartmentId = user?.fixed_department_id ? Number(user.fixed_department_id) : null;
  const canViewAll = canViewAllOpenPallets(perms);
  return {
    canViewAll,
    fixedDepartmentId,
    restrictedDepartmentId: canViewAll ? null : fixedDepartmentId
  };
}

function flattenPermissionRoles(perms, prefix = "") {
  const roles = [];
  if (!perms || typeof perms !== "object") return roles;
  for (const [key, value] of Object.entries(perms)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value === true) {
      roles.push(nextKey);
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      roles.push(...flattenPermissionRoles(value, nextKey));
    }
  }
  return roles;
}


function hasContainerRegistrationPermission(perms) {
  return permissionsConfig.hasContainerRegistrationPermission(perms);
}

function hasContainerRegistrationModuleAccess(perms) {
  return permissionsConfig.hasContainerRegistrationModuleAccess(perms);
}

function hasContainerPlanningPermission(perms) {
  return permissionsConfig.hasContainerPlanningPermission(perms);
}

function hasContainerPlanningCreatePermission(perms) {
  return permissionsConfig.hasContainerPlanningCreatePermission(perms);
}

function hasContainerPlanningEditPermission(perms) {
  return permissionsConfig.hasContainerPlanningEditPermission(perms);
}

function hasContainerPlanningDeletePermission(perms) {
  return permissionsConfig.hasContainerPlanningDeletePermission(perms);
}

function hasContainerViewerPermission(perms) {
  return permissionsConfig.hasContainerViewerPermission(perms);
}

function hasContainerAdminPermission(user, perms) {
  return isAppAdmin(user) || permissionsConfig.hasContainerRegistrationAdminAccess(perms);
}

function hasContainerHistoryPermission(perms) {
  return permissionsConfig.hasContainerHistoryPermission(perms);
}

function hasContainerHistoryExportPermission(perms) {
  return permissionsConfig.hasContainerHistoryExportPermission(perms);
}

function hasContainerHistoryClearPermission(perms) {
  return permissionsConfig.hasContainerHistoryClearPermission(perms);
}

function hasContainerTimeManagementPermission(perms) {
  return permissionsConfig.hasContainerTimeManagementPermission(perms);
}

function hasContainerStatusManagementPermission(perms) {
  return permissionsConfig.hasContainerStatusManagementPermission(perms);
}

function hasContainerResetPermission(perms) {
  return permissionsConfig.hasContainerResetPermission(perms);
}

function hasContainerResetAllPermission(perms) {
  return permissionsConfig.hasContainerResetAllPermission(perms);
}

function hasWarehouseModulePermission(perms) {
  return permissionsConfig.hasWarehouseModulePermission(perms);
}

function buildContainerSessionToken(payload) {
  const payloadEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signatureEncoded = crypto.createHmac("sha256", SHARED_AUTH_SECRET)
    .update(payloadEncoded)
    .digest("base64url");
  return `${payloadEncoded}.${signatureEncoded}`;
}

function buildSharedAuthJwt(payload) {
  return jwt.sign(payload, SHARED_AUTH_SECRET, { algorithm: "HS256" });
}

async function logCaseHistory({
  caseId,
  locationId,
  departmentId,
  appCustomerId,
  receiptNo = null,
  changedBy,
  action,
  changes = []
}) {
  await q(
    `
    INSERT INTO booking_case_history (case_id, location_id, department_id, app_customer_id, receipt_no, changed_by, action, changes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    `,
    [
      Number(caseId),
      Number(locationId),
      Number(departmentId),
      Number(appCustomerId),
      receiptNo || null,
      Number(changedBy),
      String(action || "change"),
      JSON.stringify(Array.isArray(changes) ? changes : [])
    ]
  );
}

function normalizeEmail(emailRaw) {
  const email = safeTrim(emailRaw);
  if (!email) return null;
  const normalized = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, msg: "E-Mail-Adresse ungültig" };
  }
  return { ok: true, email: normalized };
}

async function createLocationStatus1Notifications(caseRow) {
  try {
    const locationInfo = await q(
      `SELECT name FROM locations WHERE id=$1`,
      [caseRow.location_id]
    );
    const locationName = locationInfo.rowCount ? locationInfo.rows[0].name : `Standort ${caseRow.location_id}`;

    const recipients = await q(
      `SELECT id FROM users WHERE is_active=TRUE AND location_id=$1`,
      [caseRow.location_id]
    );

    for (const recipient of recipients.rows) {
      if (Number(recipient.id) === Number(caseRow.created_by)) continue;
      const inserted = await q(
        `INSERT INTO user_notifications (user_id, case_id, title, message)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, case_id, title, message, is_read, created_at`,
        [recipient.id, caseRow.id, "Aviso Standort (Status 1)", `Neues Aviso #${caseRow.id} am ${locationName}.`]
      );
      io.to(`user:${recipient.id}`).emit("notificationCreated", inserted.rows[0]);
    }
  } catch (err) {
    console.error("Standort-Notification fehlgeschlagen:", err);
  }
}

async function createDepartmentStatus3Notifications(caseRow) {
  try {
    if (!caseRow.department_id) return;

    const departmentInfo = await q(
      `SELECT name FROM departments WHERE id=$1`,
      [caseRow.department_id]
    );
    const departmentName = departmentInfo.rowCount ? departmentInfo.rows[0].name : `Abteilung ${caseRow.department_id}`;

    const recipients = await q(
      `SELECT id FROM users WHERE is_active=TRUE AND fixed_department_id=$1`,
      [caseRow.department_id]
    );

    for (const recipient of recipients.rows) {
      if (Number(recipient.id) === Number(caseRow.submitted_by || caseRow.created_by)) continue;
      const inserted = await q(
        `INSERT INTO user_notifications (user_id, case_id, title, message)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, case_id, title, message, is_read, created_at`,
        [recipient.id, caseRow.id, "Aviso Abteilung (Status 3)", `Aviso #${caseRow.id} ist in Prüfung (${departmentName}).`]
      );
      io.to(`user:${recipient.id}`).emit("notificationCreated", inserted.rows[0]);
    }
  } catch (err) {
    console.error("Abteilungs-Notification fehlgeschlagen:", err);
  }
}

async function pruneNotificationsForUser(userId) {
  const deletedByStatus = await q(
    `DELETE FROM user_notifications n
     USING booking_cases c
     WHERE n.case_id = c.id
       AND n.user_id = $1
       AND (
         (n.title='Aviso Standort (Status 1)' AND c.status >= 3)
         OR (n.title='Aviso Abteilung (Status 3)' AND c.status >= 4)
       )
     RETURNING n.id`,
    [userId]
  );

  const deletedOrphans = await q(
    `DELETE FROM user_notifications n
     WHERE n.user_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM booking_cases c WHERE c.id = n.case_id
       )
     RETURNING n.id`,
    [userId]
  );

  const deletedIds = [
    ...deletedByStatus.rows.map((row) => row.id),
    ...deletedOrphans.rows.map((row) => row.id)
  ];
  if (deletedIds.length > 0) {
    io.to(`user:${userId}`).emit("notificationsDeleted", {
      notification_ids: deletedIds
    });
  }
}

function emitNotificationsDeleted(payloadByUser) {
  for (const [userId, notificationIds] of payloadByUser.entries()) {
    io.to(`user:${userId}`).emit("notificationsDeleted", {
      notification_ids: notificationIds
    });
  }
}

function emitOpenPalletBookingsUpdated(payload = {}) {
  io.emit("openPalletBookingsUpdated", payload);
}

async function logPalletAdminHistory({
  appCustomerId,
  entityType,
  entityLabel,
  action,
  details = {},
  changedBy = null
}) {
  if (!appCustomerId || !entityType || !entityLabel || !action) return;
  await q(
    `
    INSERT INTO pallet_admin_history (
      app_customer_id,
      entity_type,
      entity_label,
      action,
      details,
      changed_by
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    `,
    [
      Number(appCustomerId),
      String(entityType),
      String(entityLabel),
      String(action),
      JSON.stringify(details && typeof details === "object" ? details : {}),
      changedBy ? Number(changedBy) : null
    ]
  );
}

async function deleteNotificationsForCase(caseId) {
  const deleted = await q(
    `DELETE FROM user_notifications
     WHERE case_id=$1
     RETURNING id, user_id`,
    [caseId]
  );

  if (deleted.rowCount === 0) return;

  const payloadByUser = new Map();
  for (const row of deleted.rows) {
    if (!payloadByUser.has(row.user_id)) payloadByUser.set(row.user_id, []);
    payloadByUser.get(row.user_id).push(row.id);
  }
  emitNotificationsDeleted(payloadByUser);
}

async function deleteNotificationsForCaseByTitle(caseId, title) {
  const deleted = await q(
    `DELETE FROM user_notifications
     WHERE case_id=$1 AND title=$2
     RETURNING id, user_id`,
    [caseId, title]
  );

  if (deleted.rowCount === 0) return;

  const payloadByUser = new Map();
  for (const row of deleted.rows) {
    if (!payloadByUser.has(row.user_id)) payloadByUser.set(row.user_id, []);
    payloadByUser.get(row.user_id).push(row.id);
  }
  emitNotificationsDeleted(payloadByUser);
}

async function getMyPermissions(user) {
  return getUserPermissions(user);
}

// ---------- AUTH ----------
async function loginHandler(req, res) {
  const clientIp = req.clientIp || "unknown";

  const { username, password } = req.body || {};
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername || !password) return res.status(400).json({ error: "username/password required" });

  const r = await q(
    `SELECT id, username, password_hash, role, location_id, role_id, is_active
     FROM users
     WHERE LOWER(username)=LOWER($1)
     LIMIT 1`,
    [normalizedUsername]
  );

  const user = r.rows[0];
  if (!user || user.is_active !== true) {
    registerFailedLogin(clientIp);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    registerFailedLogin(clientIp);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  clearFailedLogin(clientIp);

  const userContext = await getUserContext(user.id);
  if (!userContext) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    {
      id: userContext.id,
      username: userContext.username,
      role: userContext.role,
      location_id: userContext.location_id,
      role_id: userContext.role_id || null,
      app_customer_id: userContext.app_customer_id,
      fixed_department_id: userContext.fixed_department_id || null,
      is_app_admin: Boolean(userContext.is_app_admin)
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );

  setAuthCookie(res, token);

  return res.json({
    token,
    user: userContext
  });
}

// Brute-force protection applies only to login routes.
app.post("/login", checkIpBlocked, loginHandler);
app.post("/api/login", checkIpBlocked, loginHandler);

function resolveIncomingSsoToken(req) {
  return String(
    req.body?.token
    || req.body?.ssoToken
    || req.body?.session
    || req.query?.token
    || req.query?.ssoToken
    || req.query?.session
    || ""
  ).trim();
}

async function exchangeSsoToken(req, res) {
  const ssoToken = resolveIncomingSsoToken(req);
  if (!ssoToken) {
    return res.status(400).json({ error: "token required" });
  }

  let claims;
  try {
    claims = jwt.verify(ssoToken, SHARED_AUTH_SECRET, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ error: "Invalid SSO token" });
  }

  const issuedAt = Number(claims?.iat || 0);
  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (!issuedAt || (nowInSeconds - issuedAt) > SSO_MAX_TOKEN_AGE_SECONDS) {
    return res.status(401).json({ error: "SSO token expired" });
  }

  const username = String(claims?.username || "").trim();
  if (!username) {
    return res.status(401).json({ error: "Invalid SSO token" });
  }

  const userResult = await q(
    `SELECT id, username, role, location_id, role_id, is_active
     FROM users
     WHERE LOWER(username)=LOWER($1)
     LIMIT 1`,
    [username]
  );

  const user = userResult.rows[0];
  if (!user || user.is_active !== true) {
    return res.status(401).json({ error: "Invalid SSO token" });
  }

  const userContext = await getUserContext(user.id);
  if (!userContext) {
    return res.status(401).json({ error: "Invalid SSO token" });
  }

  const roleFromClaim = String(claims?.role || "").trim();
  const tokenRole = roleFromClaim || userContext.role;

  const token = jwt.sign(
    {
      id: userContext.id,
      username: userContext.username,
      role: tokenRole,
      location_id: userContext.location_id,
      role_id: userContext.role_id || null,
      app_customer_id: userContext.app_customer_id,
      fixed_department_id: userContext.fixed_department_id || null,
      is_app_admin: Boolean(userContext.is_app_admin)
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );

  setAuthCookie(res, token);

  return res.json({
    token,
    user: {
      id: userContext.id,
      username: userContext.username,
      role: tokenRole,
      location_id: userContext.location_id,
      role_id: userContext.role_id || null,
      app_customer_id: userContext.app_customer_id,
      fixed_department_id: userContext.fixed_department_id || null,
      is_app_admin: Boolean(userContext.is_app_admin)
    }
  });
}

app.post("/api/auth/sso-exchange", exchangeSsoToken);
app.post("/api/auth/sso-forward-token", exchangeSsoToken);
app.get("/api/auth/sso-forward-token", exchangeSsoToken);

app.get("/api/me", authRequired, async (req, res) => {
  if (!req.user || req.user.is_active !== true) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json(req.user);
});

app.post("/api/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.post("/api/change-password", authRequired, async (req, res) => {
  const currentPassword = String(req.body?.current_password || "").trim();
  const newPassword = String(req.body?.new_password || "").trim();

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "current_password und new_password erforderlich" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Neues Passwort muss mindestens 8 Zeichen lang sein" });
  }

  const userResult = await q(
    "SELECT id, password_hash FROM users WHERE id=$1 LIMIT 1",
    [req.user.id]
  );
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden" });

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return res.status(400).json({ error: "Aktuelles Passwort ist nicht korrekt" });

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "Neues Passwort muss sich vom alten Passwort unterscheiden" });
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await q(`UPDATE users SET password_hash=$1 WHERE id=$2`, [hash, req.user.id]);
  res.json({ ok: true });
});

app.get("/api/theme", authRequired, async (req,res) => {

  const userId = req.user.id;

  const pref = await q(
    `SELECT theme
     FROM user_preferences
     WHERE user_id=$1`,
    [userId]
  );

  res.json({
    theme: pref.rowCount ? pref.rows[0].theme : "light"
  });
});

app.put("/api/theme", authRequired, async (req, res) => {

  const nextTheme = String(req.body?.theme || "").trim().toLowerCase();

  if (!["light","dark"].includes(nextTheme)) {
    return res.status(400).json({ error: "invalid theme" });
  }

  const userId = req.user.id;

  await q(
    `INSERT INTO user_preferences (user_id, theme)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET theme = EXCLUDED.theme, updated_at = now()`,
    [userId, nextTheme]
  );

  res.json({ ok: true, theme: nextTheme });
});

app.get("/api/my-permissions", authRequired, async (req, res) => {
  const perms = await getMyPermissions(req.user);
  res.json(perms);
});

function requireAppAdminArea(req, res, next) {
  if (canAccessAppAdmin(req.user)) return next();
  return res.status(403).json({ error: "App admin only" });
}

app.get("/api/core/context", authRequired, async (req, res) => {
  const permissions = await getMyPermissions(req.user);
  const activeModuleKeys = await getActiveModuleKeysForUser(req.user);
  const installation = await getInstallationCustomer(req.user);

  res.json({
    user: req.user,
    customer: installation,
    installation,
    deployment_model: "single-tenant",
    active_modules: activeModuleKeys,
    dashboard_modules: buildDashboardModules({
      user: req.user,
      permissions,
      enabledModuleKeys: activeModuleKeys
    }),
    admin: {
      can_open_customer_admin: canAccessCustomerAdmin(req.user, permissions),
      can_open_app_admin: canAccessAppAdmin(req.user),
      can_open_pallet_admin: canAccessPalletModuleAdmin(req.user, permissions, activeModuleKeys)
    }
  });
});

app.get("/api/admin/context", authRequired, requireCustomerAdminAccess, async (req, res) => {
  const installation = await getInstallationCustomer(req.user);
  const locations = (await q(
    `
    SELECT id, name
    FROM locations
    WHERE app_customer_id = $1
    ORDER BY name
    `,
    [req.managedCustomerId]
  )).rows;
  const departments = (await q(
    `
    SELECT id, name
    FROM departments
    WHERE app_customer_id = $1
    ORDER BY name
    `,
    [req.managedCustomerId]
  )).rows;

  res.json({
    user: req.user,
    managed_customer: installation,
    installation,
    available_customers: [],
    deployment_model: "single-tenant",
    active_modules: req.activeModuleKeys,
    locations,
    departments,
    permissions: req.portalPermissions,
    admin: {
      can_open_app_admin: isAppAdmin(req.user),
      can_open_pallet_admin: canAccessModuleAdmin("pallets", req.user, req.portalPermissions, req.activeModuleKeys)
    }
  });
});

async function loadInstallationOptions(customerId) {
  const [installation, activeModules, rolesResult, locationsResult, departmentsResult] = await Promise.all([
    getCustomerById(customerId),
    getEnabledModuleKeysForCustomer(customerId),
    q(
      `
      SELECT id, name
      FROM roles
      WHERE app_customer_id = $1
      ORDER BY name
      `,
      [customerId]
    ),
    q(
      `
      SELECT id, name
      FROM locations
      WHERE app_customer_id = $1
      ORDER BY name
      `,
      [customerId]
    ),
    q(
      `
      SELECT id, name
      FROM departments
      WHERE app_customer_id = $1
      ORDER BY name
      `,
      [customerId]
    )
  ]);

  return {
    installation,
    active_modules: activeModules,
    roles: rolesResult.rows,
    locations: locationsResult.rows,
    departments: departmentsResult.rows
  };
}

async function updateInstallationRecord(installationId, payload = {}) {
  const updates = [];
  const values = [];
  const nextName = String(payload?.name || "").trim();
  const nextSlug = String(payload?.slug || "").trim().toLowerCase();

  if (nextName) {
    values.push(nextName);
    updates.push(`name = $${values.length}`);
  }
  if (nextSlug) {
    values.push(nextSlug);
    updates.push(`slug = $${values.length}`);
  }
  if (typeof payload?.is_active === "boolean") {
    values.push(Boolean(payload.is_active));
    updates.push(`is_active = $${values.length}`);
  }

  if (!updates.length) {
    return null;
  }

  values.push(installationId);
  const updated = await q(
    `
    UPDATE app_customers
    SET ${updates.join(", ")}
    WHERE id = $${values.length}
    RETURNING id, name, slug, is_active, created_at
    `,
    values
  );
  return updated.rowCount ? updated.rows[0] : null;
}

async function loadInstallationModules(customerId) {
  const installation = await getCustomerById(customerId);
  if (!installation) return null;

  return {
    installation,
    modules: serializeInstallationModules(await getEnabledModuleKeysForCustomer(customerId))
  };
}

async function requireInstallationCustomerId(req, res) {
  const installation = await getInstallationCustomer(req.user);
  if (req.params.customerId !== undefined && req.params.customerId !== null && req.params.customerId !== "") {
    const requestedId = toPositiveInt(req.params.customerId);
    if (!requestedId) {
      res.status(400).json({ error: "Ungültige Installations-ID." });
      return null;
    }
    if (requestedId !== Number(installation?.id)) {
      res.status(404).json({ error: "Installation nicht gefunden." });
      return null;
    }
  }
  return installation;
}

app.get("/api/app-admin/customers", authRequired, requireAppAdminArea, async (req, res) => {
  res.json(await listCustomers(req.user));
});

app.post("/api/app-admin/customers", authRequired, requireAppAdminArea, async (_req, res) => {
  return res.status(409).json({ error: "Pro Server ist nur eine Installation zulässig." });
});

app.get("/api/app-admin/installation", authRequired, requireAppAdminArea, async (req, res) => {
  const installation = await getInstallationCustomer(req.user);
  res.json({
    installation,
    deployment_model: "single-tenant",
    product_name: "CTSH Portal"
  });
});

app.put("/api/app-admin/installation", authRequired, requireAppAdminArea, async (req, res) => {
  const installation = await getInstallationCustomer(req.user);
  const updated = await updateInstallationRecord(installation.id, req.body || {});
  if (!updated) return res.status(400).json({ error: "Keine Änderungen für die Installation übergeben." });
  res.json(updated);
});

app.put("/api/app-admin/customers/:customerId", authRequired, requireAppAdminArea, async (req, res) => {
  const installation = await requireInstallationCustomerId(req, res);
  if (!installation) return;

  const updated = await updateInstallationRecord(installation.id, req.body || {});
  if (!updated) return res.status(400).json({ error: "Keine Änderungen für die Installation übergeben." });
  res.json(updated);
});

app.get("/api/app-admin/product-modules", authRequired, requireAppAdminArea, async (req, res) => {
  const installation = await getInstallationCustomer(req.user);
  res.json(await loadInstallationModules(installation.id));
});

app.get("/api/app-admin/customer-modules/:customerId", authRequired, requireAppAdminArea, async (req, res) => {
  const installation = await requireInstallationCustomerId(req, res);
  if (!installation) return;
  res.json(await loadInstallationModules(installation.id));
});

app.put("/api/app-admin/product-modules", authRequired, requireAppAdminArea, async (req, res) => {
  const installation = await getInstallationCustomer(req.user);
  const modules = Array.isArray(req.body?.modules) ? req.body.modules : [];
  for (const moduleEntry of modules) {
    const moduleKey = String(moduleEntry?.key || "").trim();
    const moduleDefinition = getModuleByKey(moduleKey);
    if (!moduleDefinition) continue;
    const isEnabled = Boolean(moduleEntry?.is_enabled) || Boolean(moduleDefinition.licensing?.includedInBaseProduct);
    await q(
      `
      INSERT INTO app_customer_modules (app_customer_id, module_key, is_enabled)
      VALUES ($1, $2, $3)
      ON CONFLICT (app_customer_id, module_key)
      DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = now()
      `,
      [installation.id, moduleKey, isEnabled]
    );
  }

  res.json(await loadInstallationModules(installation.id));
});

app.put("/api/app-admin/customer-modules/:customerId", authRequired, requireAppAdminArea, async (req, res) => {
  const installation = await requireInstallationCustomerId(req, res);
  if (!installation) return;

  const modules = Array.isArray(req.body?.modules) ? req.body.modules : [];
  for (const moduleEntry of modules) {
    const moduleKey = String(moduleEntry?.key || "").trim();
    const moduleDefinition = getModuleByKey(moduleKey);
    if (!moduleDefinition) continue;
    const isEnabled = Boolean(moduleEntry?.is_enabled) || Boolean(moduleDefinition.licensing?.includedInBaseProduct);
    await q(
      `
      INSERT INTO app_customer_modules (app_customer_id, module_key, is_enabled)
      VALUES ($1, $2, $3)
      ON CONFLICT (app_customer_id, module_key)
      DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = now()
      `,
      [installation.id, moduleKey, isEnabled]
    );
  }

  res.json(await loadInstallationModules(installation.id));
});

app.get("/api/app-admin/installation-options", authRequired, requireAppAdminArea, async (req, res) => {
  const installation = await getInstallationCustomer(req.user);
  res.json(await loadInstallationOptions(installation.id));
});

app.get("/api/app-admin/customer-options/:customerId", authRequired, requireAppAdminArea, async (req, res) => {
  const installation = await requireInstallationCustomerId(req, res);
  if (!installation) return;
  res.json(await loadInstallationOptions(installation.id));
});

app.get("/api/app-admin/users", authRequired, requireAppAdminArea, async (req, res) => {
  const installationCustomerId = await getInstallationCustomerId(req.user);
  const result = await q(
    `
    SELECT
      u.id,
      u.username,
      u.email,
      u.role,
      u.role_id,
      u.location_id,
      u.fixed_department_id,
      u.is_active,
      u.is_app_admin,
      u.app_customer_id,
      c.name AS customer_name,
      ro.name AS business_role_name,
      l.name AS location_name,
      d.name AS fixed_department_name
    FROM users u
    LEFT JOIN app_customers c ON c.id = u.app_customer_id
    LEFT JOIN roles ro ON ro.id = u.role_id
    LEFT JOIN locations l ON l.id = u.location_id
    LEFT JOIN departments d ON d.id = u.fixed_department_id
    WHERE u.app_customer_id = $1
    ORDER BY c.name, u.username
    `,
    [installationCustomerId]
  );
  res.json(result.rows);
});

app.put("/api/app-admin/users/:id", authRequired, requireAppAdminArea, async (req, res) => {
  const userId = toPositiveInt(req.params.id);
  if (!userId) return res.status(400).json({ error: "Ungültige Benutzer-ID." });

  const installationCustomerId = await getInstallationCustomerId(req.user);
  const existingUser = await getUserContext(userId);
  if (!existingUser) return res.status(404).json({ error: "user not found" });
  if (Number(existingUser.app_customer_id || 0) !== Number(installationCustomerId || 0)) {
    return res.status(404).json({ error: "user not found" });
  }

  const updates = [];
  const values = [];
  let nextCustomerId = Number(installationCustomerId || 0) || null;
  let effectiveRoleId = existingUser.role_id ? Number(existingUser.role_id) : null;
  let effectiveLocationId = existingUser.location_id ? Number(existingUser.location_id) : null;
  let effectiveFixedDepartmentId = existingUser.fixed_department_id ? Number(existingUser.fixed_department_id) : null;

  if (req.body?.app_customer_id !== undefined) {
    const customerId = toPositiveInt(req.body.app_customer_id);
    if (!customerId || customerId !== installationCustomerId) {
      return res.status(400).json({ error: "Benutzer können keiner anderen Installation zugeordnet werden." });
    }
    values.push(customerId);
    updates.push(`app_customer_id = $${values.length}`);
    nextCustomerId = customerId;
  }

  if (req.body?.role_id !== undefined) {
    const roleId = req.body.role_id === null || req.body.role_id === "" ? null : toPositiveInt(req.body.role_id);
    if (roleId) {
      const roleExists = await q(`SELECT 1 FROM roles WHERE id = $1 AND app_customer_id = $2`, [roleId, nextCustomerId]);
      if (!roleExists.rowCount) return res.status(400).json({ error: "Die gewählte Rolle ist in dieser Installation nicht verfügbar." });
    }
    values.push(roleId);
    updates.push(`role_id = $${values.length}`);
    effectiveRoleId = roleId;
  }

  if (req.body?.location_id !== undefined) {
    const locationId = req.body.location_id === null || req.body.location_id === "" ? null : toPositiveInt(req.body.location_id);
    if (locationId) {
      const locationExists = await q(`SELECT 1 FROM locations WHERE id = $1 AND app_customer_id = $2`, [locationId, nextCustomerId]);
      if (!locationExists.rowCount) return res.status(400).json({ error: "Der gewählte Standort ist in dieser Installation nicht verfügbar." });
    }
    values.push(locationId);
    updates.push(`location_id = $${values.length}`);
    effectiveLocationId = locationId;
  }

  if (req.body?.fixed_department_id !== undefined) {
    const fixedDepartmentId = req.body.fixed_department_id === null || req.body.fixed_department_id === "" ? null : toPositiveInt(req.body.fixed_department_id);
    if (fixedDepartmentId) {
      const departmentExists = await q(`SELECT 1 FROM departments WHERE id = $1 AND app_customer_id = $2`, [fixedDepartmentId, nextCustomerId]);
      if (!departmentExists.rowCount) return res.status(400).json({ error: "Die gewählte Abteilung ist in dieser Installation nicht verfügbar." });
    }
    values.push(fixedDepartmentId);
    updates.push(`fixed_department_id = $${values.length}`);
    effectiveFixedDepartmentId = fixedDepartmentId;
  }

  if (typeof req.body?.is_active === "boolean") {
    values.push(Boolean(req.body.is_active));
    updates.push(`is_active = $${values.length}`);
  }

  if (typeof req.body?.is_app_admin === "boolean") {
    values.push(Boolean(req.body.is_app_admin));
    updates.push(`is_app_admin = $${values.length}`);
  }

  if (req.body?.app_customer_id !== undefined) {
    if (req.body?.role_id === undefined && effectiveRoleId) {
      const roleExists = await q(`SELECT 1 FROM roles WHERE id = $1 AND app_customer_id = $2`, [effectiveRoleId, nextCustomerId]);
      if (!roleExists.rowCount) {
        values.push(null);
        updates.push(`role_id = $${values.length}`);
      }
    }

    if (req.body?.location_id === undefined && effectiveLocationId) {
      const locationExists = await q(`SELECT 1 FROM locations WHERE id = $1 AND app_customer_id = $2`, [effectiveLocationId, nextCustomerId]);
      if (!locationExists.rowCount) {
        values.push(null);
        updates.push(`location_id = $${values.length}`);
      }
    }

    if (req.body?.fixed_department_id === undefined && effectiveFixedDepartmentId) {
      const departmentExists = await q(`SELECT 1 FROM departments WHERE id = $1 AND app_customer_id = $2`, [effectiveFixedDepartmentId, nextCustomerId]);
      if (!departmentExists.rowCount) {
        values.push(null);
        updates.push(`fixed_department_id = $${values.length}`);
      }
    }
  }

  if (!updates.length) {
    return res.status(400).json({ error: "Keine Änderungen für den Benutzer übergeben." });
  }

  values.push(userId);
  const updated = await q(
    `
    UPDATE users
    SET ${updates.join(", ")}
    WHERE id = $${values.length}
    RETURNING id
    `,
    values
  );

  if (!updated.rowCount) return res.status(404).json({ error: "user not found" });
  const userContext = await getUserContext(userId);
  res.json(userContext);
});

app.use("/api/warehouse", createWarehouseRouter({ authRequired, requirePermission }));

async function createContainerRegistrationSession(req, res) {
  const perms = await getMyPermissions(req.user);
  const enabledModuleKeys = await getActiveModuleKeysForUser(req.user);
  const canOpenContainerRegistration = canAccessModule(
    "container_registration",
    req.user,
    perms,
    enabledModuleKeys
  );

  if (!canOpenContainerRegistration) {
    return res.status(403).json({ error: "No Permissions" });
  }

  const targetUrl = hasContainerAdminPermission(req.user, perms)
    ? MODULE_CONTAINER_REGISTRATION_ADMIN_PATH
    : MODULE_CONTAINER_REGISTRATION_DRIVER_PATH;

  return res.json({
    session: null,
    token: null,
    user: req.user.username,
    url: targetUrl
  });
}

app.get("/api/container-registration-session", authRequired, createContainerRegistrationSession);
app.get("/api/sso/container-session", authRequired, createContainerRegistrationSession);


async function createContainerPlanningSession(req, res) {
  const perms = await getMyPermissions(req.user);
  const enabledModuleKeys = await getActiveModuleKeysForUser(req.user);
  if (!canAccessModule("container_planning", req.user, perms, enabledModuleKeys)) {
    return res.status(403).json({ error: "No Permissions" });
  }

  const portalToken = getRequestToken(req);
  const separator = MODULE_CONTAINER_PLANNING_PATH.includes("?") ? "&" : "?";

  return res.json({
    session: null,
    ssoToken: null,
    token: null,
    user: req.user.username,
    url: portalToken ? `${MODULE_CONTAINER_PLANNING_PATH}${separator}portalToken=${encodeURIComponent(portalToken)}` : MODULE_CONTAINER_PLANNING_PATH
  });
}

app.get("/api/container-planning-session", authRequired, createContainerPlanningSession);
app.get("/api/sso/container-planning-session", authRequired, createContainerPlanningSession);

app.get("/pallets", requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
  return canAccessModule("pallets", user, perms, enabledModuleKeys);
}), (_req, res) => {
  res.redirect(MODULE_PALLETS_PATH);
});
app.get("/pallets/admin", requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req, { allowRequestedCustomer: true });
  return canAccessModuleAdmin("pallets", user, perms, enabledModuleKeys);
}), (req, res) => {
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect(`${MODULE_PALLETS_ADMIN_PATH}${search}`);
});
app.get("/container-planning", requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
  return canAccessModule("container_planning", user, perms, enabledModuleKeys);
}), (_req, res) => {
  res.redirect(MODULE_CONTAINER_PLANNING_PATH);
});
app.get("/container-registration", requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
  return canAccessModule("container_registration", user, perms, enabledModuleKeys);
}), (req, res) => {
  const targetUrl = hasContainerAdminPermission(req.user, req.portalPermissions)
    ? MODULE_CONTAINER_REGISTRATION_ADMIN_PATH
    : MODULE_CONTAINER_REGISTRATION_DRIVER_PATH;
  res.redirect(targetUrl);
});
app.get("/warehouse", requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
  return canAccessModule("warehouse", user, perms, enabledModuleKeys);
}), (_req, res) => {
  res.redirect("/modules/warehouse/index.html");
});
app.get(MODULE_PALLETS_PATH, requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
  return canAccessModule("pallets", user, perms, enabledModuleKeys);
}), (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "modules", "pallets", "index.html"));
});
app.get(MODULE_PALLETS_ADMIN_PATH, requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req, { allowRequestedCustomer: true });
  return canAccessModuleAdmin("pallets", user, perms, enabledModuleKeys);
}), (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "modules", "pallets", "admin.html"));
});
app.get(MODULE_CONTAINER_PLANNING_PATH, requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
  return canAccessModule("container_planning", user, perms, enabledModuleKeys);
}), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "modules", "container-planning", "index.html"));
});
app.get(MODULE_CONTAINER_REGISTRATION_ADMIN_PATH, requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
  return canAccessModuleAdmin("container_registration", user, perms, enabledModuleKeys);
}), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "modules", "container-registration", "admin.html"));
});
app.get(MODULE_CONTAINER_REGISTRATION_DRIVER_PATH, requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
  return canAccessModule("container_registration", user, perms, enabledModuleKeys);
}), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "modules", "container-registration", "driver.html"));
});
app.get(MODULE_CONTAINER_REGISTRATION_VIEWER_PATH, requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
  return canAccessModule("container_registration", user, perms, enabledModuleKeys)
    && hasContainerViewerPermission(perms);
}), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "modules", "container-registration", "viewer.html"));
});
app.get("/container-registration/viewer-sw.js", requireModulePageAccess(async (user, perms, req) => {
  const enabledModuleKeys = await getActiveModuleKeysForModuleRequest(user, req);
  return canAccessModule("container_registration", user, perms, enabledModuleKeys)
    && hasContainerViewerPermission(perms);
}), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "modules", "container-registration", "viewer-sw.js"));
});

function defaultRegistrationContainer(id) {
  return {
    id,
    status: CONTAINER_REGISTRATION_STATUS_SLOT_CREATED,
    plate: "",
    time: "",
    registeredAt: "",
    bookingNo: null
  };
}

function cloneRegistrationState() {
  const state = {};
  for (let i = 1; i <= 8; i += 1) {
    state[i] = { ...(containerRegistrationState[i] || defaultRegistrationContainer(i)) };
  }
  return state;
}

async function loadContainerRegistrationState() {
  const result = await q(
    `SELECT id, status, plate, time, registered_at, booking_no
     FROM container_registration_containers
     ORDER BY id`
  );

  containerRegistrationState = {};
  for (let i = 1; i <= 8; i += 1) {
    containerRegistrationState[i] = defaultRegistrationContainer(i);
  }

  for (const row of result.rows) {
    containerRegistrationState[row.id] = {
      id: Number(row.id),
      status: CONTAINER_REGISTRATION_STATUSES.includes(row.status)
        ? row.status
        : CONTAINER_REGISTRATION_STATUS_SLOT_CREATED,
      plate: String(row.plate || ""),
      time: String(row.time || ""),
      registeredAt: row.registered_at ? new Date(row.registered_at).toISOString() : "",
      bookingNo: Number.isInteger(row.booking_no) ? row.booking_no : null
    };
  }
}

async function saveContainerRegistrationContainer(id, data) {
  await q(
    `UPDATE container_registration_containers
     SET status=$2, plate=$3, time=$4, registered_at=$5, booking_no=$6
     WHERE id=$1`,
    [id, data.status, data.plate, data.time, data.registeredAt || null, data.bookingNo || null]
  );
}

async function saveAllContainerRegistrationContainers(state) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 1; i <= 8; i += 1) {
      const data = state[i] || defaultRegistrationContainer(i);
      await client.query(
        `UPDATE container_registration_containers
         SET status=$2, plate=$3, time=$4, registered_at=$5, booking_no=$6
         WHERE id=$1`,
        [i, data.status, data.plate, data.time, data.registeredAt || null, data.bookingNo || null]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function logContainerRegistrationEvent(event) {
  await q(
    `INSERT INTO container_registration_history (at, type, container_id, plate, details)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [
      event.at,
      event.type,
      event.containerId,
      event.plate || "",
      JSON.stringify(event.details || {})
    ]
  );

  await q(
    `DELETE FROM container_registration_history
     WHERE id IN (
       SELECT id
       FROM container_registration_history
       ORDER BY id DESC
       OFFSET $1
     )`,
    [CONTAINER_REGISTRATION_HISTORY_MAX]
  );
}

async function nextContainerRegistrationBookingNo() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE container_registration_booking_counter
       SET value = value + 1
       WHERE id = 1
       RETURNING value`
    );
    await client.query("COMMIT");
    return Number(updated.rows[0]?.value || 1);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getContainerRegistrationHistory(limit) {
  const normalizedLimit = Math.max(1, Math.min(Number(limit || 200), 2000));
  const result = await q(
    `SELECT at, type, container_id AS "containerId", plate, details
     FROM container_registration_history
     ORDER BY id DESC
     LIMIT $1`,
    [normalizedLimit]
  );
  return result.rows;
}

async function getContainerRegistrationBookingTimeline(bookingNo) {
  const normalizedBookingNo = Number(bookingNo);
  if (!Number.isInteger(normalizedBookingNo) || normalizedBookingNo <= 0) return [];

  const result = await q(
    `SELECT at, type, container_id AS "containerId", plate, details
     FROM container_registration_history
     WHERE details->>'bookingNo' = $1
     ORDER BY id ASC`,
    [String(normalizedBookingNo)]
  );
  return result.rows;
}

async function clearContainerRegistrationHistory() {
  await q("TRUNCATE TABLE container_registration_history RESTART IDENTITY");
}

function historyRowsToCsv(entries) {
  const header = ["at", "type", "containerId", "plate", "details"];
  const rows = [header.join(";")];
  for (const entry of entries) {
    rows.push([
      entry.at || "",
      entry.type || "",
      entry.containerId || "",
      String(entry.plate || "").replaceAll(";", " "),
      JSON.stringify(entry.details || {}).replaceAll(";", " ")
    ].join(";"));
  }
  return rows.join("\n");
}

function emitContainerRegistrationInit(socket) {
  socket.emit("init", cloneRegistrationState());
}

function emitContainerRegistrationUpdate(id) {
  containerRegistrationNamespace.emit("statusChanged", { id, data: { ...containerRegistrationState[id] } });
}

function getSocketPortalUser(socket, options = {}) {
  const handshakeToken = String(
    socket.handshake.auth?.token
    || socket.handshake.query?.portalToken
    || socket.handshake.query?.token
    || ""
  ).trim();
  const fakeReq = {
    headers: {
      cookie: socket.handshake.headers.cookie || "",
      ...(handshakeToken ? { authorization: `Bearer ${handshakeToken}` } : {})
    },
    query: {
      portalToken: String(socket.handshake.query?.portalToken || "").trim(),
      token: String(socket.handshake.query?.token || "").trim()
    }
  };
  return getAuthenticatedPortalUser(fakeReq, options);
}

function emitContainerPlanningChange(action, bookingId) {
  containerPlanningNamespace.emit("bookingsChanged", {
    action,
    bookingId,
    at: new Date().toISOString()
  });
}

function normalizeDashboardFeedLimit(rawLimit) {
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit <= 0) return 10;
  return Math.min(limit, 25);
}

function dashboardFeedJoin(parts) {
  return parts.filter((part) => String(part || "").trim()).join(" | ");
}

function getDashboardCaseActionLabel(action) {
  const labels = {
    create: "Vorgang angelegt",
    edit: "Vorgang bearbeitet",
    claim: "Vorgang übernommen",
    submit: "Zur Prüfung eingereicht",
    approve: "Vorgang gebucht",
    cancel: "Vorgang storniert",
    set_translogica: "Translogica aktualisiert"
  };
  return labels[action] || "Vorgang aktualisiert";
}

function getDashboardContainerEventLabel(type) {
  const labels = {
    driver_register: "Container wurde angemeldet",
    admin_set_status: "Containerstatus wurde aktualisiert",
    admin_set_time: "Zeitfenster wurde aktualisiert",
    admin_reset_container: "Containerdaten wurden zurückgesetzt"
  };
  return labels[type] || "Container-Vorgang aktualisiert";
}

function buildContainerEventMeta(row) {
  const details = row?.details || {};
  const bookingNo = String(details.bookingNo || "").trim();
  const from = String(details.from || "").trim();
  const to = String(details.to || "").trim();
  const timeSlot = String(details.timeSlot || "").trim();
  const changeLabel = row?.type === "admin_set_time" ? "Zeitfenster" : "Status";
  const pieces = [
    row?.containerId ? `Container: ${row.containerId}` : "",
    row?.plate ? `Kennzeichen: ${row.plate}` : "",
    bookingNo ? `Buchungsnummer: ${bookingNo}` : "",
    from || to ? `${changeLabel}: von ${from || "-"} auf ${to || "-"}` : "",
    timeSlot ? `Zeitfenster: ${timeSlot}` : ""
  ];
  return dashboardFeedJoin(pieces);
}

async function getDashboardLiveFeedItems(req, limit) {
  const perms = await getMyPermissions(req.user);
  const canUseAllLocations = !!perms?.filters?.all_locations;
  const lockedLocationId = (req.user.role !== "admin" && req.user.location_id && !canUseAllLocations)
    ? Number(req.user.location_id)
    : null;
  const lockedDepartmentId = req.user.fixed_department_id ? Number(req.user.fixed_department_id) : null;
  const perSourceLimit = Math.min(Math.max(limit, 8), 25);
  const items = [];

  if (perms?.bookings?.view) {
    const params = [req.user.app_customer_id];
    const where = ["b.app_customer_id = $1"];
    let idx = 2;

    if (lockedLocationId) {
      where.push(`b.location_id = $${idx++}`);
      params.push(lockedLocationId);
    }

    if (lockedDepartmentId) {
      where.push(`b.department_id = $${idx++}`);
      params.push(lockedDepartmentId);
    }

    params.push(perSourceLimit);
    const rows = (await q(
      `
      SELECT
        MIN(b.id) AS id,
        MIN(b.created_at) AS created_at,
        MAX(b.receipt_no) AS receipt_no,
        MAX(b.license_plate) AS license_plate,
        MAX(b.entrepreneur) AS entrepreneur,
        COALESCE(SUM(CASE WHEN b.type = 'IN' THEN b.quantity ELSE 0 END), 0) AS qty_in,
        COALESCE(SUM(CASE WHEN b.type = 'OUT' THEN b.quantity ELSE 0 END), 0) AS qty_out,
        COALESCE(l.name, 'Standort') AS location_name,
        COALESCE(d.name, 'Abteilung') AS department_name
      FROM bookings b
      LEFT JOIN locations l ON l.id = b.location_id AND l.app_customer_id = b.app_customer_id
      LEFT JOIN departments d ON d.id = b.department_id AND d.app_customer_id = b.app_customer_id
      WHERE ${where.join(" AND ")}
      GROUP BY
        COALESCE(NULLIF(b.receipt_no, ''), CONCAT('booking-', b.id::text)),
        l.name,
        d.name
      ORDER BY MIN(b.created_at) DESC, MIN(b.id) DESC
      LIMIT $${idx}
      `,
      params
    )).rows;

    for (const row of rows) {
      items.push({
        id: `booking-case-${row.id}`,
        app: "Paletten Buchungen",
        title: row.receipt_no ? `Palettenbuchung ${row.receipt_no}` : "Palettenbuchung",
        meta: dashboardFeedJoin([
          row.license_plate ? `Kennzeichen: ${row.license_plate}` : "",
          row.entrepreneur ? `Unternehmer: ${row.entrepreneur}` : "",
          `Eingang: ${Number(row.qty_in || 0)}, Ausgang: ${Number(row.qty_out || 0)}`,
          row.location_name ? `Standort: ${row.location_name}` : "",
          row.department_name ? `Abteilung: ${row.department_name}` : ""
        ]),
        at: row.created_at
      });
    }
  }

  if (
    hasContainerViewerPermission(perms)
    || hasContainerRegistrationPermission(perms)
    || hasContainerAdminPermission(req.user, perms)
  ) {
    // Container registration history is not customer-scoped yet.
    if (isAppAdmin(req.user)) {
      const rows = (await q(
        `
        SELECT
          id,
          at,
          type,
          container_id AS "containerId",
          plate,
          details
        FROM container_registration_history
        WHERE type = 'driver_register'
        ORDER BY at DESC, id DESC
        LIMIT $1
        `,
        [perSourceLimit]
      )).rows;

      for (const row of rows) {
        const bookingNo = String(row?.details?.bookingNo || "").trim();
        items.push({
          id: `container-registration-${row.id}`,
          app: "Container Anmeldung",
          title: bookingNo ? `Container-Anmeldung ${bookingNo}` : "Container-Anmeldung",
          meta: buildContainerEventMeta(row),
          at: row.at
        });
      }
    }
  }

  if (hasContainerPlanningPermission(perms)) {
    // Planning data is not customer-scoped yet.
    if (isAppAdmin(req.user)) {
      const rows = (await q(
        `
        SELECT
          id,
          title,
          container_no AS "containerNo",
          plate,
          warehouse,
          order_no AS "orderNo",
          booking_date::text AS date,
          created_at
        FROM container_planning_bookings
        ORDER BY created_at DESC, id DESC
        LIMIT $1
        `,
        [perSourceLimit]
      )).rows;

      for (const row of rows) {
        items.push({
          id: `container-planning-${row.id}`,
          app: "Container und LKW Planung",
          title: row.title ? `Planungsbuchung: ${row.title}` : "Planungsbuchung",
          meta: dashboardFeedJoin([
            row.date ? `Termin: ${row.date}` : "",
            row.containerNo ? `Container: ${row.containerNo}` : "",
            row.plate ? `Kennzeichen: ${row.plate}` : "",
            row.warehouse && row.warehouse !== "-" ? `Lager: ${row.warehouse}` : "",
            row.orderNo ? `Auftrag: ${row.orderNo}` : ""
          ]),
          at: row.created_at
        });
      }
    }
  }

  return items
    .filter((item) => item.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

async function requireContainerPlanningAccess(req, res, next) {
  const perms = await getMyPermissions(req.user);
  if (!hasContainerPlanningPermission(perms)) {
    return res.status(403).json({ error: "No Permissions" });
  }
  req.portalPermissions = perms;
  return next();
}

async function requireContainerPlanningCreateAccess(req, res, next) {
  const perms = await getMyPermissions(req.user);
  if (!hasContainerPlanningCreatePermission(perms)) {
    return res.status(403).json({ error: "No Permissions" });
  }
  req.portalPermissions = perms;
  return next();
}

async function requireContainerPlanningEditAccess(req, res, next) {
  const perms = await getMyPermissions(req.user);
  if (!hasContainerPlanningEditPermission(perms)) {
    return res.status(403).json({ error: "No Permissions" });
  }
  req.portalPermissions = perms;
  return next();
}

async function requireContainerPlanningDeleteAccess(req, res, next) {
  const perms = await getMyPermissions(req.user);
  if (!hasContainerPlanningDeletePermission(perms)) {
    return res.status(403).json({ error: "No Permissions" });
  }
  req.portalPermissions = perms;
  return next();
}

async function requireContainerViewerAccess(req, res, next) {
  const perms = await getMyPermissions(req.user);
  if (!hasContainerViewerPermission(perms)) {
    return res.status(403).json({ error: "No Permissions" });
  }
  req.portalPermissions = perms;
  return next();
}

async function requireContainerRegistrationAccess(req, res, next) {
  const perms = await getMyPermissions(req.user);
  if (!hasContainerRegistrationPermission(perms)) {
    return res.status(403).json({ error: "No Permissions" });
  }
  req.portalPermissions = perms;
  return next();
}

async function requireContainerHistoryAccess(req, res, next) {
  const perms = await getMyPermissions(req.user);
  if (!hasContainerHistoryPermission(perms)) {
    return res.status(403).json({ error: "No Permissions" });
  }
  req.portalPermissions = perms;
  return next();
}

async function requireContainerHistoryExportAccess(req, res, next) {
  const perms = await getMyPermissions(req.user);
  if (!hasContainerHistoryExportPermission(perms)) {
    return res.status(403).json({ error: "No Permissions" });
  }
  req.portalPermissions = perms;
  return next();
}

async function requireContainerAdminAccess(req, res, next) {
  const perms = await getMyPermissions(req.user);
  if (!hasContainerAdminPermission(req.user, perms)) {
    return res.status(403).json({ error: "No Permissions" });
  }
  req.portalPermissions = perms;
  return next();
}

app.get("/api/modules/container-planning/bookings", authRequired, requireContainerPlanningAccess, async (req, res) => {
  const month = String(req.query.month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ message: "Parameter month im Format YYYY-MM erforderlich." });
  }

  const from = `${month}-01`;
  const toDate = new Date(`${from}T00:00:00`);
  toDate.setMonth(toDate.getMonth() + 1);
  const to = toDate.toISOString().slice(0, 10);

  const result = await q(
    `SELECT id, title, container_no AS "containerNo", customer, warehouse, plate,
            order_no AS "orderNo", booking_date::text AS date, color
     FROM container_planning_bookings
     WHERE booking_date >= $1 AND booking_date < $2
     ORDER BY booking_date ASC, created_at ASC`,
    [from, to]
  );

  res.json(result.rows);
});

app.post("/api/modules/container-planning/bookings", authRequired, requireContainerPlanningCreateAccess, async (req, res) => {
  const { title, containerNo, customer, warehouse, plate, orderNo, date, color } = req.body || {};
  if (!title || !date) {
    return res.status(400).json({ message: "Titel und Datum sind erforderlich." });
  }

  const result = await q(
    `INSERT INTO container_planning_bookings
       (title, container_no, customer, warehouse, plate, order_no, booking_date, color, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, title, container_no AS "containerNo", customer, warehouse, plate,
               order_no AS "orderNo", booking_date::text AS date, color`,
    [
      String(title).trim(),
      String(containerNo || "").trim(),
      String(customer || "-").trim() || "-",
      String(warehouse || "-").trim() || "-",
      String(plate || "").trim(),
      String(orderNo || "").trim(),
      String(date).trim(),
      String(color || "#0ea5e9").trim(),
      req.user.id
    ]
  );

  emitContainerPlanningChange("created", result.rows[0].id);
  res.status(201).json(result.rows[0]);
});

app.patch("/api/modules/container-planning/bookings/:id/date", authRequired, requireContainerPlanningEditAccess, async (req, res) => {
  const id = Number(req.params.id);
  const date = String(req.body?.date || "").trim();
  if (!id) return res.status(400).json({ message: "Ungültige ID." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: "Datum muss im Format YYYY-MM-DD sein." });
  }

  const result = await q(
    `UPDATE container_planning_bookings
     SET booking_date = $2
     WHERE id = $1
     RETURNING id, title, container_no AS "containerNo", customer, warehouse, plate,
               order_no AS "orderNo", booking_date::text AS date, color`,
    [id, date]
  );

  if (!result.rowCount) return res.status(404).json({ message: "Eintrag nicht gefunden." });
  emitContainerPlanningChange("moved", result.rows[0].id);
  res.json(result.rows[0]);
});

app.delete("/api/modules/container-planning/bookings/:id", authRequired, requireContainerPlanningDeleteAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Ungültige ID." });

  const result = await q("DELETE FROM container_planning_bookings WHERE id = $1 RETURNING id", [id]);
  if (!result.rowCount) return res.status(404).json({ message: "Eintrag nicht gefunden." });
  emitContainerPlanningChange("deleted", id);
  res.json({ ok: true });
});

app.get("/api/modules/container-registration/state", authRequired, requireContainerViewerAccess, async (_req, res) => {
  res.json(cloneRegistrationState());
});

app.get("/api/modules/container-registration/history", authRequired, requireContainerHistoryAccess, async (req, res) => {
  const entries = await getContainerRegistrationHistory(req.query.limit);
  res.json({ entries });
});

app.get("/api/modules/container-registration/history/:bookingNo", authRequired, requireContainerHistoryAccess, async (req, res) => {
  const entries = await getContainerRegistrationBookingTimeline(req.params.bookingNo);
  res.json({ bookingNo: Number(req.params.bookingNo), entries });
});

app.get("/api/modules/container-registration/admin-history.csv", authRequired, requireContainerHistoryExportAccess, async (_req, res) => {
  const entries = await getContainerRegistrationHistory(1000);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=container-registration-history.csv");
  res.send(historyRowsToCsv(entries.slice().reverse()));
});

app.get("/api/dashboard/live-feed", authRequired, async (req, res) => {
  try {
    const limit = normalizeDashboardFeedLimit(req.query.limit);
    const items = await getDashboardLiveFeedItems(req, limit);
    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: error.message || "Live-Feed konnte nicht geladen werden." });
  }
});

containerRegistrationNamespace.use(async (socket, next) => {
  const user = await getSocketPortalUser(socket, { allowHeader: true, allowQuery: true, allowCookie: true });
  if (!user) return next(new Error("UNAUTHENTICATED"));

  try {
    const perms = await getMyPermissions(user);
    socket.data.portalUser = user;
    socket.data.portalPermissions = perms;
    socket.data.canAdmin = hasContainerAdminPermission(user, perms);
    socket.data.canRegister = socket.data.canAdmin || hasContainerRegistrationPermission(perms);
    socket.data.canView = socket.data.canRegister || hasContainerViewerPermission(perms);
    socket.data.canViewHistory = hasContainerHistoryPermission(perms);
    socket.data.canExportHistory = hasContainerHistoryExportPermission(perms);
    socket.data.canClearHistory = hasContainerHistoryClearPermission(perms);
    socket.data.canManageTime = hasContainerTimeManagementPermission(perms);
    socket.data.canManageStatus = hasContainerStatusManagementPermission(perms);
    socket.data.canResetContainer = hasContainerResetPermission(perms);
    socket.data.canResetAll = hasContainerResetAllPermission(perms);
    if (!socket.data.canView) return next(new Error("FORBIDDEN"));
    return next();
  } catch (error) {
    return next(error);
  }
});

containerPlanningNamespace.use(async (socket, next) => {
  const user = await getSocketPortalUser(socket, { allowHeader: true, allowQuery: true, allowCookie: true });
  if (!user) return next(new Error("UNAUTHENTICATED"));

  try {
    const perms = await getMyPermissions(user);
    if (!hasContainerPlanningPermission(perms)) return next(new Error("FORBIDDEN"));
    socket.data.portalUser = user;
    socket.data.portalPermissions = perms;
    return next();
  } catch (error) {
    return next(error);
  }
});

containerRegistrationNamespace.on("connection", (socket) => {
  socket.data.isAdmin = false;
  emitContainerRegistrationInit(socket);

  socket.on("adminAuth", () => {
    if (!socket.data.canAdmin) {
      socket.data.isAdmin = false;
      socket.emit("adminAuthResult", { ok: false });
      return;
    }
    socket.data.isAdmin = true;
    socket.emit("adminAuthResult", {
      ok: true,
      user: socket.data.portalUser?.username || "",
      roles: flattenPermissionRoles(socket.data.portalPermissions),
      permissions: {
        history: !!socket.data.canViewHistory,
        historyExport: !!socket.data.canExportHistory,
        historyClear: !!socket.data.canClearHistory,
        manageTime: !!socket.data.canManageTime,
        manageStatus: !!socket.data.canManageStatus,
        resetContainer: !!socket.data.canResetContainer,
        resetAll: !!socket.data.canResetAll
      }
    });
  });

  socket.on("adminGetHistory", async ({ limit } = {}) => {
    if (!socket.data.canViewHistory) return;
    try {
      const entries = await getContainerRegistrationHistory(limit);
      socket.emit("adminHistory", { entries });
    } catch (error) {
      socket.emit("adminHistory", { entries: [], error: error.message });
    }
  });

  socket.on("adminGetBookingTimeline", async ({ bookingNo } = {}) => {
    if (!socket.data.canViewHistory) return;
    try {
      const entries = await getContainerRegistrationBookingTimeline(bookingNo);
      socket.emit("adminBookingTimeline", { bookingNo, entries });
    } catch (error) {
      socket.emit("adminBookingTimeline", { bookingNo, entries: [], error: error.message });
    }
  });

  socket.on("adminClearHistory", async () => {
    if (!socket.data.canClearHistory) return;
    await clearContainerRegistrationHistory();
    socket.emit("adminHistory", { entries: [] });
  });

  socket.on("driverRegister", async ({ id, plate } = {}) => {
    if (!socket.data.canRegister) {
      socket.emit("driverRegisterResult", { ok: false, message: "Keine Berechtigung." });
      return;
    }

    const cid = Number(id);
    if (!containerRegistrationState[cid]) {
      socket.emit("driverRegisterResult", { ok: false, message: "Ungültiger Container." });
      return;
    }

    const normalizedPlate = String(plate || "").trim().toUpperCase().slice(0, 20);
    if (!normalizedPlate) {
      socket.emit("driverRegisterResult", { ok: false, message: "Bitte Kennzeichen eingeben." });
      return;
    }

    const selected = containerRegistrationState[cid];
    const isFree = selected.status === CONTAINER_REGISTRATION_STATUS_SLOT_CREATED && !String(selected.plate || "").trim();
    if (!isFree) {
      socket.emit("driverRegisterResult", {
        ok: false,
        message: "Dieser Container ist bereits belegt. Bitte anderen Container wählen."
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const bookingNo = await nextContainerRegistrationBookingNo();
    selected.plate = normalizedPlate;
    selected.status = CONTAINER_REGISTRATION_STATUS_REGISTERED;
    selected.registeredAt = nowIso;
    selected.bookingNo = bookingNo;

    await saveContainerRegistrationContainer(cid, selected);
    emitContainerRegistrationUpdate(cid);

    await logContainerRegistrationEvent({
      type: "driver_register",
      at: nowIso,
      containerId: cid,
      plate: normalizedPlate,
      details: { bookingNo, timeSlot: selected.time || "", startedAt: nowIso }
    });

    socket.emit("driverRegisterResult", { ok: true, message: "Erfolgreich angemeldet. Bitte warten." });
  });

  socket.on("adminSetStatus", async ({ id, status } = {}) => {
    if (!socket.data.canManageStatus) return;
    const cid = Number(id);
    if (!containerRegistrationState[cid] || !CONTAINER_REGISTRATION_STATUSES.includes(status)) return;

    const before = containerRegistrationState[cid].status;
    containerRegistrationState[cid].status = status;
    await saveContainerRegistrationContainer(cid, containerRegistrationState[cid]);
    emitContainerRegistrationUpdate(cid);

    await logContainerRegistrationEvent({
      type: "admin_set_status",
      at: new Date().toISOString(),
      containerId: cid,
      plate: containerRegistrationState[cid].plate || "",
      details: { bookingNo: containerRegistrationState[cid].bookingNo || null, from: before, to: status }
    });
  });

  socket.on("adminSetTime", async ({ id, time } = {}) => {
    if (!socket.data.canManageTime) return;
    const cid = Number(id);
    if (!containerRegistrationState[cid]) return;

    const safeTime = String(time || "").trim().slice(0, 5);
    if (safeTime && !/^\d{2}:\d{2}$/.test(safeTime)) return;

    const before = containerRegistrationState[cid].time;
    containerRegistrationState[cid].time = safeTime;
    await saveContainerRegistrationContainer(cid, containerRegistrationState[cid]);
    emitContainerRegistrationUpdate(cid);

    await logContainerRegistrationEvent({
      type: "admin_set_time",
      at: new Date().toISOString(),
      containerId: cid,
      plate: containerRegistrationState[cid].plate || "",
      details: { bookingNo: containerRegistrationState[cid].bookingNo || null, from: before, to: safeTime }
    });
  });

  socket.on("adminResetContainer", async ({ id } = {}) => {
    if (!socket.data.canResetContainer) return;
    const cid = Number(id);
    if (!containerRegistrationState[cid]) return;

    const before = { ...containerRegistrationState[cid] };
    containerRegistrationState[cid] = defaultRegistrationContainer(cid);
    await saveContainerRegistrationContainer(cid, containerRegistrationState[cid]);
    emitContainerRegistrationUpdate(cid);

    await logContainerRegistrationEvent({
      type: "admin_reset_container",
      at: new Date().toISOString(),
      containerId: cid,
      plate: before.plate || "",
      details: { bookingNo: before.bookingNo || null, completedAt: new Date().toISOString(), before }
    });
  });

  socket.on("resetAll", async () => {
    if (!socket.data.canResetAll) return;
    const nextState = {};
    for (let i = 1; i <= 8; i += 1) {
      nextState[i] = defaultRegistrationContainer(i);
    }
    containerRegistrationState = nextState;
    await saveAllContainerRegistrationContainers(containerRegistrationState);
    containerRegistrationNamespace.emit("init", cloneRegistrationState());

    await logContainerRegistrationEvent({
      type: "admin_reset_all",
      at: new Date().toISOString(),
      containerId: 0,
      plate: "",
      details: {}
    });
  });
});

app.get("/api/notifications", authRequired, async (req, res) => {
  await pruneNotificationsForUser(req.user.id);

  const rows = (await q(
    `SELECT id, user_id, case_id, title, message, is_read, created_at
     FROM user_notifications
     WHERE user_id=$1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.user.id]
  )).rows;
  const unread = rows.filter((item) => !item.is_read).length;
  res.json({ items: rows, unread });
});

app.put("/api/notifications/:id/read", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  await q(
    `UPDATE user_notifications
     SET is_read=TRUE, read_at=now()
     WHERE id=$1 AND user_id=$2`,
    [id, req.user.id]
  );
  res.json({ ok: true });
});

async function requireCustomerAdminAccess(req, res, next) {
  const perms = await getMyPermissions(req.user);
  if (!canAccessCustomerAdmin(req.user, perms)) {
    return res.status(403).json({ error: "No Permissions" });
  }

  req.portalPermissions = perms;
  req.managedCustomerId = await resolveRequestedCustomer(req);
  if (!req.managedCustomerId) {
    return res.status(400).json({ error: "installation context missing" });
  }
  req.activeModuleKeys = await getEnabledModuleKeysForCustomer(req.managedCustomerId);
  return next();
}

async function requirePalletModuleAdminAccess(req, res, next) {
  const perms = await getMyPermissions(req.user);
  const targetCustomerId = await resolveRequestedCustomer(req);
  if (!targetCustomerId) {
    return res.status(400).json({ error: "installation context missing" });
  }
  const activeModuleKeys = await getEnabledModuleKeysForCustomer(targetCustomerId);
  if (!canAccessModuleAdmin("pallets", req.user, perms, activeModuleKeys)) {
    return res.status(403).json({ error: "No Permissions" });
  }
  req.portalPermissions = perms;
  req.activeModuleKeys = activeModuleKeys;
  req.moduleCustomerId = targetCustomerId;
  return next();
}

// ---------- LOCATIONS ----------
app.get("/api/locations", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  res.json((await q(
    `SELECT id, name
     FROM locations
     WHERE app_customer_id = $1
     ORDER BY name`,
    [req.user.app_customer_id]
  )).rows);
});

app.get("/api/modules/pallets/admin/context", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const installation = await getInstallationCustomer(req.user);
  res.json({
    user: req.user,
    managed_customer: installation,
    installation,
    available_customers: [],
    deployment_model: "single-tenant",
    active_modules: req.activeModuleKeys,
    admin: {
      can_open_app_admin: isAppAdmin(req.user),
      can_open_customer_admin: canAccessCustomerAdmin(req.user, req.portalPermissions)
    }
  });
});

app.get("/api/modules/pallets/admin/history", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const rows = (await q(
    `
    SELECT
      h.id,
      h.entity_type,
      h.entity_label,
      h.action,
      h.details,
      h.created_at,
      COALESCE(u.username, '(gelöscht)') AS changed_by
    FROM pallet_admin_history h
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.app_customer_id = $1
    ORDER BY h.created_at DESC, h.id DESC
    LIMIT 200
    `,
    [req.moduleCustomerId]
  )).rows;
  res.json(rows);
});

app.get("/api/modules/pallets/admin/locations", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  res.json((await q(
    `SELECT id, name
     FROM locations
     WHERE app_customer_id = $1
     ORDER BY name`,
    [req.moduleCustomerId]
  )).rows);
});

app.post("/api/modules/pallets/admin/locations", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });

  const nm = String(name).trim();
  const r = await q(
    `INSERT INTO locations (name, app_customer_id)
     VALUES ($1, $2)
     RETURNING id, name`,
    [nm, req.moduleCustomerId]
  );
  await logPalletAdminHistory({
    appCustomerId: req.moduleCustomerId,
    entityType: "location",
    entityLabel: nm,
    action: "create",
    changedBy: req.user.id
  });
  res.json(r.rows[0]);
});

app.delete("/api/modules/pallets/admin/locations/:id", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const locationResult = await q(`SELECT id, name FROM locations WHERE id=$1 AND app_customer_id=$2`, [id, req.moduleCustomerId]);
  if (!locationResult.rowCount) {
    return res.status(404).json({ error: "Standort nicht gefunden" });
  }
  if (!(await assertRecordBelongsToCustomer("locations", id, req.moduleCustomerId))) {
    return res.status(404).json({ error: "Standort nicht gefunden" });
  }

  const used = await q(`SELECT 1 FROM bookings WHERE location_id=$1 AND app_customer_id=$2 LIMIT 1`, [id, req.moduleCustomerId]);
  if (used.rowCount > 0) return res.status(400).json({ error: "Standort hat bereits Buchungen und kann nicht gelöscht werden" });

  const usedCases = await q(`SELECT 1 FROM booking_cases WHERE location_id=$1 AND app_customer_id=$2 LIMIT 1`, [id, req.moduleCustomerId]);
  if (usedCases.rowCount > 0) return res.status(400).json({ error: "Standort hat bereits Vorgänge und kann nicht gelöscht werden" });

  await q(`DELETE FROM locations WHERE id=$1 AND app_customer_id=$2`, [id, req.moduleCustomerId]);
  await logPalletAdminHistory({
    appCustomerId: req.moduleCustomerId,
    entityType: "location",
    entityLabel: locationResult.rows[0].name,
    action: "delete",
    changedBy: req.user.id
  });
  res.json({ ok: true });
});

// ---------- DEPARTMENTS ----------
app.get("/api/departments", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  res.json((await q(
    `SELECT id, name
     FROM departments
     WHERE app_customer_id = $1
     ORDER BY name`,
    [req.user.app_customer_id]
  )).rows);
});

app.get("/api/modules/pallets/admin/departments", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  res.json((await q(
    `SELECT id, name
     FROM departments
     WHERE app_customer_id = $1
     ORDER BY name`,
    [req.moduleCustomerId]
  )).rows);
});

app.post("/api/modules/pallets/admin/departments", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });

  const nm = String(name).trim();
  const r = await q(
    `INSERT INTO departments (name, app_customer_id)
     VALUES ($1, $2)
     RETURNING id, name`,
    [nm, req.moduleCustomerId]
  );
  await logPalletAdminHistory({
    appCustomerId: req.moduleCustomerId,
    entityType: "department",
    entityLabel: nm,
    action: "create",
    changedBy: req.user.id
  });
  res.json(r.rows[0]);
});

app.delete("/api/modules/pallets/admin/departments/:id", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const departmentResult = await q(`SELECT id, name FROM departments WHERE id=$1 AND app_customer_id=$2`, [id, req.moduleCustomerId]);
  if (!departmentResult.rowCount) {
    return res.status(404).json({ error: "Abteilung nicht gefunden" });
  }
  if (!(await assertRecordBelongsToCustomer("departments", id, req.moduleCustomerId))) {
    return res.status(404).json({ error: "Abteilung nicht gefunden" });
  }

  await q(`DELETE FROM departments WHERE id=$1 AND app_customer_id=$2`, [id, req.moduleCustomerId]);
  await logPalletAdminHistory({
    appCustomerId: req.moduleCustomerId,
    entityType: "department",
    entityLabel: departmentResult.rows[0].name,
    action: "delete",
    changedBy: req.user.id
  });
  res.json({ ok: true });
});

// ---------- OPEN PALLET BOOKINGS ----------
app.get("/api/modules/pallets/open-pallets/feed", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const perms = await getMyPermissions(req.user);
  if (!perms?.open_pallets?.view) {
    return res.status(403).json({ error: "Keine Berechtigung" });
  }

  const scope = getOpenPalletDepartmentScope(req.user, perms);
  if (!scope.canViewAll && !scope.fixedDepartmentId) {
    return res.json({ items: [] });
  }

  const where = [
    "op.app_customer_id = $1",
    "op.status <> 'document_booked_scanned'"
  ];
  const params = [req.user.app_customer_id];
  let idx = 2;

  if (scope.restrictedDepartmentId) {
    where.push(`op.department_id = $${idx}`);
    params.push(scope.restrictedDepartmentId);
    idx += 1;
  }

  params.push(6);
  const rows = (await q(
    `
    SELECT
      op.id,
      op.title,
      op.company,
      op.city,
      op.postal_code,
      op.order_no,
      op.pallet_count,
      op.status,
      op.updated_at,
      COALESCE(d.name, 'Abteilung') AS department_name
    FROM open_pallet_bookings op
    LEFT JOIN departments d
      ON d.id = op.department_id
     AND d.app_customer_id = op.app_customer_id
    WHERE ${where.join(" AND ")}
    ORDER BY op.updated_at DESC, op.id DESC
    LIMIT $${idx}
    `,
    params
  )).rows;

  res.json({ items: rows });
});

app.get("/api/modules/pallets/open-pallets", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const perms = await getMyPermissions(req.user);
  if (!perms?.open_pallets?.view) {
    return res.status(403).json({ error: "Keine Berechtigung" });
  }

  const scope = getOpenPalletDepartmentScope(req.user, perms);
  if (!scope.canViewAll && !scope.fixedDepartmentId) {
    return res.json({ items: [] });
  }

  const title = safeTrim(req.query?.title);
  const company = safeTrim(req.query?.company);
  const city = safeTrim(req.query?.city);
  const postalCode = safeTrim(req.query?.postal_code);
  const orderNo = safeTrim(req.query?.order_no);
  const statusCheck = normalizeOpenPalletStatus(req.query?.status, { allowEmpty: true });
  if (!statusCheck.ok) return res.status(400).json({ error: statusCheck.msg });

  const where = ["op.app_customer_id = $1"];
  const params = [req.user.app_customer_id];
  let idx = 2;

  if (scope.restrictedDepartmentId) {
    where.push(`op.department_id = $${idx}`);
    params.push(scope.restrictedDepartmentId);
    idx += 1;
  }

  if (title) {
    where.push(`op.title ILIKE $${idx}`);
    params.push(`%${title}%`);
    idx += 1;
  }
  if (company) {
    where.push(`COALESCE(op.company, '') ILIKE $${idx}`);
    params.push(`%${company}%`);
    idx += 1;
  }
  if (city) {
    where.push(`COALESCE(op.city, '') ILIKE $${idx}`);
    params.push(`%${city}%`);
    idx += 1;
  }
  if (postalCode) {
    where.push(`COALESCE(op.postal_code, '') ILIKE $${idx}`);
    params.push(`%${postalCode}%`);
    idx += 1;
  }
  if (orderNo) {
    where.push(`COALESCE(op.order_no, '') ILIKE $${idx}`);
    params.push(`%${orderNo}%`);
    idx += 1;
  }
  if (statusCheck.status) {
    where.push(`op.status = $${idx}`);
    params.push(statusCheck.status);
    idx += 1;
  }

  const rows = (await q(
    `
    SELECT
      op.id,
      op.title,
      op.company,
      op.city,
      op.postal_code,
      op.order_no,
      op.pallet_count,
      op.note,
      op.status,
      op.department_id,
      op.created_at,
      op.updated_at,
      COALESCE(d.name, 'Abteilung') AS department_name,
      COALESCE(uc.username, '(geloescht)') AS created_by_name,
      COALESCE(uu.username, '(geloescht)') AS updated_by_name
    FROM open_pallet_bookings op
    LEFT JOIN departments d
      ON d.id = op.department_id
     AND d.app_customer_id = op.app_customer_id
    LEFT JOIN users uc ON uc.id = op.created_by
    LEFT JOIN users uu ON uu.id = op.updated_by
    WHERE ${where.join(" AND ")}
    ORDER BY op.updated_at DESC, op.id DESC
    LIMIT 250
    `
    ,
    params
  )).rows;

  res.json({ items: rows });
});

app.post("/api/modules/pallets/open-pallets", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const perms = await getMyPermissions(req.user);
  if (!perms?.open_pallets?.create) {
    return res.status(403).json({ error: "Keine Berechtigung" });
  }

  const scope = getOpenPalletDepartmentScope(req.user, perms);
  const fallbackDepartmentId = scope.fixedDepartmentId;
  const requestedDepartmentId = req.body?.department_id ? Number(req.body.department_id) : null;
  const departmentId = fallbackDepartmentId || (scope.canViewAll ? requestedDepartmentId : null);
  if (!departmentId) {
    return res.status(400).json({ error: "Diesem Konto ist keine Abteilung zugeordnet." });
  }

  if (!(await assertRecordBelongsToCustomer("departments", departmentId, req.user.app_customer_id))) {
    return res.status(400).json({ error: "Abteilung nicht gefunden" });
  }

  const title = safeTrim(req.body?.title);
  const company = safeTrim(req.body?.company);
  const city = safeTrim(req.body?.city);
  const postalCode = safeTrim(req.body?.postal_code);
  const orderNo = safeTrim(req.body?.order_no);
  const note = safeTrim(req.body?.note);
  const palletCount = Number(req.body?.pallet_count || 0);
  const statusCheck = normalizeOpenPalletStatus(req.body?.status || "open");

  if (!title) return res.status(400).json({ error: "Titel ist Pflicht" });
  if (!Number.isInteger(palletCount) || palletCount <= 0) {
    return res.status(400).json({ error: "Anzahl der Paletten muss groesser als 0 sein" });
  }
  if (!statusCheck.ok) return res.status(400).json({ error: statusCheck.msg });

  const result = await q(
    `
    INSERT INTO open_pallet_bookings (
      app_customer_id,
      department_id,
      created_by,
      updated_by,
      title,
      company,
      city,
      postal_code,
      order_no,
      pallet_count,
      note,
      status
    )
    VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id
    `,
    [
      req.user.app_customer_id,
      departmentId,
      req.user.id,
      title,
      company,
      city,
      postalCode,
      orderNo,
      palletCount,
      note,
      statusCheck.status
    ]
  );

  emitOpenPalletBookingsUpdated({
    app_customer_id: req.user.app_customer_id,
    department_id: departmentId,
    booking_id: result.rows[0].id,
    action: "create"
  });

  res.json({ id: result.rows[0].id });
});

app.patch("/api/modules/pallets/open-pallets/:id", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const perms = await getMyPermissions(req.user);
  if (!perms?.open_pallets?.edit) {
    return res.status(403).json({ error: "Keine Berechtigung" });
  }

  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const existing = await q(
    `
    SELECT id, app_customer_id, department_id
    FROM open_pallet_bookings
    WHERE id = $1
      AND app_customer_id = $2
    `,
    [id, req.user.app_customer_id]
  );
  if (!existing.rowCount) return res.status(404).json({ error: "Nicht gefunden" });

  const current = existing.rows[0];
  const scope = getOpenPalletDepartmentScope(req.user, perms);
  if (scope.restrictedDepartmentId && Number(current.department_id || 0) !== Number(scope.restrictedDepartmentId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const updates = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "title")) {
    const title = safeTrim(req.body?.title);
    if (!title) return res.status(400).json({ error: "Titel ist Pflicht" });
    values.push(title);
    updates.push(`title = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "company")) {
    values.push(safeTrim(req.body?.company));
    updates.push(`company = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "city")) {
    values.push(safeTrim(req.body?.city));
    updates.push(`city = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "postal_code")) {
    values.push(safeTrim(req.body?.postal_code));
    updates.push(`postal_code = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "order_no")) {
    values.push(safeTrim(req.body?.order_no));
    updates.push(`order_no = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "note")) {
    values.push(safeTrim(req.body?.note));
    updates.push(`note = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "pallet_count")) {
    const palletCount = Number(req.body?.pallet_count || 0);
    if (!Number.isInteger(palletCount) || palletCount <= 0) {
      return res.status(400).json({ error: "Anzahl der Paletten muss groesser als 0 sein" });
    }
    values.push(palletCount);
    updates.push(`pallet_count = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "status")) {
    const statusCheck = normalizeOpenPalletStatus(req.body?.status);
    if (!statusCheck.ok) return res.status(400).json({ error: statusCheck.msg });
    values.push(statusCheck.status);
    updates.push(`status = $${values.length}`);
  }

  if (!updates.length) {
    return res.status(400).json({ error: "Keine Aenderungen uebergeben" });
  }

  values.push(req.user.id);
  updates.push(`updated_by = $${values.length}`);
  updates.push("updated_at = now()");

  values.push(id, req.user.app_customer_id);
  await q(
    `
    UPDATE open_pallet_bookings
    SET ${updates.join(", ")}
    WHERE id = $${values.length - 1}
      AND app_customer_id = $${values.length}
    `,
    values
  );

  emitOpenPalletBookingsUpdated({
    app_customer_id: req.user.app_customer_id,
    department_id: current.department_id,
    booking_id: id,
    action: "update"
  });

  res.json({ ok: true });
});

app.delete("/api/modules/pallets/open-pallets/:id", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const perms = await getMyPermissions(req.user);
  if (!perms?.open_pallets?.delete) {
    return res.status(403).json({ error: "Keine Berechtigung" });
  }

  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const existing = await q(
    `
    SELECT id, department_id
    FROM open_pallet_bookings
    WHERE id = $1
      AND app_customer_id = $2
    `,
    [id, req.user.app_customer_id]
  );
  if (!existing.rowCount) return res.status(404).json({ error: "Nicht gefunden" });

  const current = existing.rows[0];
  const scope = getOpenPalletDepartmentScope(req.user, perms);
  if (scope.restrictedDepartmentId && Number(current.department_id || 0) !== Number(scope.restrictedDepartmentId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await q(
    `
    DELETE FROM open_pallet_bookings
    WHERE id = $1
      AND app_customer_id = $2
    `,
    [id, req.user.app_customer_id]
  );

  emitOpenPalletBookingsUpdated({
    app_customer_id: req.user.app_customer_id,
    department_id: current.department_id,
    booking_id: id,
    action: "delete"
  });

  res.json({ ok: true });
});

// ---------- ENTREPRENEURS ----------
app.get("/api/entrepreneurs", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  res.json((await q(
    `SELECT id, name, street, postal_code, city
     FROM entrepreneurs
     WHERE app_customer_id = $1
     ORDER BY name`,
    [req.user.app_customer_id]
  )).rows);
});

app.post("/api/entrepreneurs", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const name = safeTrim(req.body?.name);
  const street = safeTrim(req.body?.street);
  const postal_code = safeTrim(req.body?.postal_code);
  const city = safeTrim(req.body?.city);
  if (!name) return res.status(400).json({ error: "Name erforderlich" });

  const existing = await q(
    `
    SELECT id
    FROM entrepreneurs
    WHERE app_customer_id = $1
      AND LOWER(name) = LOWER($2)
    LIMIT 1
    `,
    [req.user.app_customer_id, name]
  );

  if (existing.rowCount > 0) {
    const updated = await q(
      `
      UPDATE entrepreneurs
      SET street = COALESCE($1, street),
          postal_code = COALESCE($2, postal_code),
          city = COALESCE($3, city)
      WHERE id = $4
      RETURNING id, name, street, postal_code, city
      `,
      [street, postal_code, city, existing.rows[0].id]
    );
    return res.json(updated.rows[0]);
  }

  const inserted = await q(
    `INSERT INTO entrepreneurs (name, street, postal_code, city, app_customer_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, street, postal_code, city`,
    [name, street, postal_code, city, req.user.app_customer_id]
  );
  res.json(inserted.rows[0]);
});

app.get("/api/entrepreneurs/manage", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  res.json((await q(
    `SELECT id, name, street, postal_code, city
     FROM entrepreneurs
     WHERE app_customer_id = $1
     ORDER BY name`,
    [req.moduleCustomerId]
  )).rows);
});

app.get("/api/modules/pallets/admin/entrepreneurs", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  res.json((await q(
    `SELECT id, name, street, postal_code, city
     FROM entrepreneurs
     WHERE app_customer_id = $1
     ORDER BY name`,
    [req.moduleCustomerId]
  )).rows);
});

app.post("/api/entrepreneurs/manage", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const name = safeTrim(req.body?.name);
  const street = safeTrim(req.body?.street);
  const postal_code = safeTrim(req.body?.postal_code);
  const city = safeTrim(req.body?.city);
  if (!name) return res.status(400).json({ error: "Name erforderlich" });

  try {
    const r = await q(
      `INSERT INTO entrepreneurs (name, street, postal_code, city, app_customer_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, street, postal_code, city`,
      [name, street, postal_code, city, req.moduleCustomerId]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e && e.code === "23505") return res.status(400).json({ error: "Unternehmer existiert bereits" });
    throw e;
  }
});

app.post("/api/modules/pallets/admin/entrepreneurs", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const name = safeTrim(req.body?.name);
  const street = safeTrim(req.body?.street);
  const postal_code = safeTrim(req.body?.postal_code);
  const city = safeTrim(req.body?.city);
  if (!name) return res.status(400).json({ error: "Name erforderlich" });

  const r = await q(
    `INSERT INTO entrepreneurs (name, street, postal_code, city, app_customer_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, street, postal_code, city`,
    [name, street, postal_code, city, req.moduleCustomerId]
  );
  await logPalletAdminHistory({
    appCustomerId: req.moduleCustomerId,
    entityType: "entrepreneur",
    entityLabel: name,
    action: "create",
    changedBy: req.user.id
  });
  res.json(r.rows[0]);
});

app.put("/api/entrepreneurs/manage/:id", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  if (!(await assertRecordBelongsToCustomer("entrepreneurs", id, req.moduleCustomerId))) {
    return res.status(404).json({ error: "Unternehmer nicht gefunden" });
  }

  const name = safeTrim(req.body?.name);
  const street = safeTrim(req.body?.street);
  const postal_code = safeTrim(req.body?.postal_code);
  const city = safeTrim(req.body?.city);
  if (!name) return res.status(400).json({ error: "Name erforderlich" });

  try {
    const r = await q(
      `UPDATE entrepreneurs
       SET name=$1, street=$2, postal_code=$3, city=$4
       WHERE id=$5 AND app_customer_id=$6
       RETURNING id, name, street, postal_code, city`,
      [name, street, postal_code, city, id, req.moduleCustomerId]
    );
    if (!r.rowCount) return res.status(404).json({ error: "Unternehmer nicht gefunden" });
    res.json(r.rows[0]);
  } catch (e) {
    if (e && e.code === "23505") return res.status(400).json({ error: "Unternehmer existiert bereits" });
    throw e;
  }
});

app.put("/api/modules/pallets/admin/entrepreneurs/:id", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  if (!(await assertRecordBelongsToCustomer("entrepreneurs", id, req.moduleCustomerId))) {
    return res.status(404).json({ error: "Unternehmer nicht gefunden" });
  }

  const existing = await q(
    `SELECT id, name, street, postal_code, city FROM entrepreneurs WHERE id=$1 AND app_customer_id=$2`,
    [id, req.moduleCustomerId]
  );
  if (!existing.rowCount) return res.status(404).json({ error: "Unternehmer nicht gefunden" });

  const name = safeTrim(req.body?.name);
  const street = safeTrim(req.body?.street);
  const postal_code = safeTrim(req.body?.postal_code);
  const city = safeTrim(req.body?.city);
  if (!name) return res.status(400).json({ error: "Name erforderlich" });

  const r = await q(
    `UPDATE entrepreneurs
     SET name=$1, street=$2, postal_code=$3, city=$4
     WHERE id=$5 AND app_customer_id=$6
     RETURNING id, name, street, postal_code, city`,
    [name, street, postal_code, city, id, req.moduleCustomerId]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Unternehmer nicht gefunden" });
  await logPalletAdminHistory({
    appCustomerId: req.moduleCustomerId,
    entityType: "entrepreneur",
    entityLabel: name,
    action: "update",
    changedBy: req.user.id,
    details: {
      before: existing.rows[0],
      after: r.rows[0]
    }
  });
  res.json(r.rows[0]);
});

app.delete("/api/entrepreneurs/manage/:id", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  await q(`DELETE FROM entrepreneurs WHERE id=$1 AND app_customer_id=$2`, [id, req.moduleCustomerId]);
  res.json({ ok: true });
});

app.delete("/api/modules/pallets/admin/entrepreneurs/:id", authRequired, requirePalletModuleAdminAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const existing = await q(
    `SELECT id, name FROM entrepreneurs WHERE id=$1 AND app_customer_id=$2`,
    [id, req.moduleCustomerId]
  );
  if (!existing.rowCount) return res.status(404).json({ error: "Unternehmer nicht gefunden" });
  await q(`DELETE FROM entrepreneurs WHERE id=$1 AND app_customer_id=$2`, [id, req.moduleCustomerId]);
  await logPalletAdminHistory({
    appCustomerId: req.moduleCustomerId,
    entityType: "entrepreneur",
    entityLabel: existing.rows[0].name,
    action: "delete",
    changedBy: req.user.id
  });
  res.json({ ok: true });
});

function sanitizeManagedRolePermissions(permissions, activeModuleKeys) {
  const normalized = permissionsConfig.normalizePermissions(
    (permissions && typeof permissions === "object") ? permissions : {}
  );
  const filtered = filterPermissionsByEnabledModules(normalized, activeModuleKeys, { appAdmin: false });
  if (filtered?.admin?.full_access) {
    filtered.admin.full_access = false;
  }
  return filtered;
}

// ---------- ROLES (Admin) ----------
app.get("/api/admin/roles", authRequired, requireCustomerAdminAccess, async (req, res) => {
  if (!isAppAdmin(req.user) && !req.portalPermissions?.roles?.manage && !req.portalPermissions?.users?.manage) {
    return res.status(403).json({ error: "No Permissions" });
  }

  const rows = (await q(
    `SELECT id, name, permissions, created_at
     FROM roles
     WHERE app_customer_id = $1
     ORDER BY name`,
    [req.managedCustomerId]
  )).rows;
  res.json(rows.map((row) => ({
    ...row,
    permissions: sanitizeManagedRolePermissions(row.permissions, req.activeModuleKeys)
  })));
});

app.post("/api/admin/roles", authRequired, requireCustomerAdminAccess, async (req, res) => {
  if (!isAppAdmin(req.user) && !req.portalPermissions?.roles?.manage) {
    return res.status(403).json({ error: "No Permissions" });
  }

  const { name, permissions } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "name required" });

  const roleName = String(name).trim();
  const perms = sanitizeManagedRolePermissions(permissions, req.activeModuleKeys);

  try {
      const r = await q(
        `INSERT INTO roles (name, permissions, app_customer_id) VALUES ($1, $2::jsonb, $3)
         RETURNING id, name, permissions`,
        [roleName, JSON.stringify(perms), req.managedCustomerId]
      );
      res.json({
        ...r.rows[0],
        permissions: sanitizeManagedRolePermissions(r.rows[0].permissions, req.activeModuleKeys)
      });
  } catch (e) {
    if (e && e.code === "23505") return res.status(400).json({ error: "role name already exists" });
    throw e;
  }
});

app.put("/api/admin/roles/:id", authRequired, requireCustomerAdminAccess, async (req, res) => {
  if (!isAppAdmin(req.user) && !req.portalPermissions?.roles?.manage) {
    return res.status(403).json({ error: "No Permissions" });
  }

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const { name, permissions } = req.body || {};
  const roleName = name ? String(name).trim() : null;
  const perms = (permissions && typeof permissions === "object")
    ? sanitizeManagedRolePermissions(permissions, req.activeModuleKeys)
    : null;

  await q(
    `UPDATE roles
     SET name = COALESCE($1, name),
         permissions = COALESCE($2::jsonb, permissions)
     WHERE id=$3
       AND app_customer_id = $4`,
    [roleName, perms ? JSON.stringify(perms) : null, id, req.managedCustomerId]
  );

  res.json({ ok: true });
});

app.delete("/api/admin/roles/:id", authRequired, requireCustomerAdminAccess, async (req, res) => {
  if (!isAppAdmin(req.user) && !req.portalPermissions?.roles?.manage) {
    return res.status(403).json({ error: "No Permissions" });
  }

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const used = await q(`SELECT 1 FROM users WHERE role_id=$1 AND app_customer_id=$2 LIMIT 1`, [id, req.managedCustomerId]);
  if (used.rowCount > 0) return res.status(400).json({ error: "role is assigned to users" });

  await q(`DELETE FROM roles WHERE id=$1 AND app_customer_id=$2`, [id, req.managedCustomerId]);
  res.json({ ok: true });
});

// ---------- USERS (Admin) ----------
app.get("/api/admin/users", authRequired, requireCustomerAdminAccess, async (req, res) => {
  const canManageUsers = Boolean(isAppAdmin(req.user) || req.portalPermissions?.users?.manage);
  const canViewDepartment = Boolean(req.portalPermissions?.users?.view_department);
  if (!canManageUsers && !canViewDepartment) return res.status(403).json({ error: "No Permissions" });

  if (!canManageUsers) {
    const fixedDepartmentId = req.user.fixed_department_id;
    if (!fixedDepartmentId) return res.status(400).json({ error: "Kein fixe Abteilung gesetzt" });

    const rows = (await q(
      `SELECT id, username, role, location_id, role_id, is_active, created_at, email, fixed_department_id, app_customer_id
       FROM users
       WHERE app_customer_id = $1
         AND fixed_department_id = $2
       ORDER BY username`,
      [req.managedCustomerId, fixedDepartmentId]
    )).rows;
    return res.json(rows);
  }

  const rows = (await q(
    `SELECT id, username, role, location_id, role_id, is_active, created_at, email, fixed_department_id, app_customer_id
     FROM users
     WHERE app_customer_id = $1
     ORDER BY username`,
    [req.managedCustomerId]
  )).rows;
  return res.json(rows);
});

app.post("/api/admin/users", authRequired, requireCustomerAdminAccess, async (req, res) => {
  if (!isAppAdmin(req.user) && !req.portalPermissions?.users?.manage) {
    return res.status(403).json({ error: "No Permissions" });
  }

  const {
    username,
    password,
    location_id = null,
    role_id = null,
    email,
    fixed_department_id = null
  } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "username + password required" });

  const name = String(username).trim();
  if (name.length < 3) return res.status(400).json({ error: "username too short" });

  const hash = await bcrypt.hash(String(password), 10);
  const emailCheck = normalizeEmail(email);
  if (emailCheck && emailCheck.ok === false) return res.status(400).json({ error: emailCheck.msg });
  const roleId = (role_id === null || role_id === undefined || role_id === "") ? null : Number(role_id);
  if (!roleId) return res.status(400).json({ error: "business role required" });
  const roleExists = await q(`SELECT 1 FROM roles WHERE id=$1 AND app_customer_id=$2`, [roleId, req.managedCustomerId]);
  if (roleExists.rowCount === 0) return res.status(400).json({ error: "Business-Rolle nicht gefunden" });

  const locationId = (location_id === null || location_id === undefined || location_id === "") ? null : Number(location_id);
  if (locationId) {
    const locExists = await q(`SELECT 1 FROM locations WHERE id=$1 AND app_customer_id=$2`, [locationId, req.managedCustomerId]);
    if (locExists.rowCount === 0) return res.status(400).json({ error: "Standort nicht gefunden" });
  }

  const fixedDepartmentId = (fixed_department_id === null || fixed_department_id === undefined || fixed_department_id === "")
    ? null
    : Number(fixed_department_id);
  if (fixedDepartmentId) {
    const depExists = await q(`SELECT 1 FROM departments WHERE id=$1 AND app_customer_id=$2`, [fixedDepartmentId, req.managedCustomerId]);
    if (depExists.rowCount === 0) return res.status(400).json({ error: "Abteilung nicht gefunden" });
  }

  try {
    const r = await q(
      `INSERT INTO users (username, password_hash, role, location_id, role_id, is_active, email, fixed_department_id, app_customer_id, is_app_admin)
       VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,$8,FALSE)
       RETURNING id, username, role, location_id, role_id, is_active, email, fixed_department_id, app_customer_id`,
      [
        name,
        hash,
        "disponent",
        locationId,
        roleId,
        emailCheck?.email || null,
        fixedDepartmentId,
        req.managedCustomerId
      ]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e && e.code === "23505") return res.status(400).json({ error: "username already exists" });
    throw e;
  }
});

app.put("/api/admin/users/:id", authRequired, requireCustomerAdminAccess, async (req, res) => {
  if (!isAppAdmin(req.user) && !req.portalPermissions?.users?.manage) {
    return res.status(403).json({ error: "No Permissions" });
  }

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  if (!(await assertRecordBelongsToCustomer("users", id, req.managedCustomerId))) {
    return res.status(404).json({ error: "Benutzer nicht gefunden" });
  }

  const { location_id, is_active, role_id, email, fixed_department_id } = req.body || {};

  const updates = [];
  const values = [];
  let idx = 1;


  if (Object.prototype.hasOwnProperty.call(req.body || {}, "location_id")) {
    const locValue = (location_id === null || location_id === undefined || location_id === "") ? null : Number(location_id);
    if (locValue) {
      const locExists = await q(`SELECT 1 FROM locations WHERE id=$1 AND app_customer_id=$2`, [locValue, req.managedCustomerId]);
      if (locExists.rowCount === 0) return res.status(400).json({ error: "Standort nicht gefunden" });
    }
    updates.push(`location_id=$${idx++}`);
    values.push(locValue);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "is_active")) {
    if (typeof is_active !== "boolean") return res.status(400).json({ error: "invalid is_active" });
    updates.push(`is_active=$${idx++}`);
    values.push(is_active);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "role_id")) {
    const roleValue = (role_id === null || role_id === undefined || role_id === "") ? null : Number(role_id);
    if (!roleValue) return res.status(400).json({ error: "business role required" });
    const roleExists = await q(`SELECT 1 FROM roles WHERE id=$1 AND app_customer_id=$2`, [roleValue, req.managedCustomerId]);
    if (roleExists.rowCount === 0) return res.status(400).json({ error: "Business-Rolle nicht gefunden" });
    updates.push(`role_id=$${idx++}`);
    values.push(roleValue);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "email")) {
    const emailCheck = normalizeEmail(email);
    if (emailCheck && emailCheck.ok === false) return res.status(400).json({ error: emailCheck.msg });
    updates.push(`email=$${idx++}`);
    values.push(emailCheck?.email || null);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "fixed_department_id")) {
    const fixedDepartmentId = (fixed_department_id === null || fixed_department_id === undefined || fixed_department_id === "")
      ? null
      : Number(fixed_department_id);
    if (fixedDepartmentId) {
      const depExists = await q(`SELECT 1 FROM departments WHERE id=$1 AND app_customer_id=$2`, [fixedDepartmentId, req.managedCustomerId]);
      if (depExists.rowCount === 0) return res.status(400).json({ error: "Abteilung nicht gefunden" });
    }
    updates.push(`fixed_department_id=$${idx++}`);
    values.push(fixedDepartmentId);
  }

  if (updates.length === 0) return res.status(400).json({ error: "no changes" });

  values.push(id);
  await q(
    `UPDATE users SET ${updates.join(", ")} WHERE id=$${idx} AND app_customer_id = $${idx + 1}`,
    [...values, req.managedCustomerId]
  );

  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", authRequired, requireCustomerAdminAccess, async (req, res) => {
  if (!isAppAdmin(req.user) && !req.portalPermissions?.users?.manage) {
    return res.status(403).json({ error: "No Permissions" });
  }

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  if (id === req.user.id) return res.status(400).json({ error: "cannot delete yourself" });
  if (!(await assertRecordBelongsToCustomer("users", id, req.managedCustomerId))) {
    return res.status(404).json({ error: "Benutzer nicht gefunden" });
  }

  await q(`DELETE FROM users WHERE id=$1 AND app_customer_id=$2`, [id, req.managedCustomerId]);
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/reset-password", authRequired, requireCustomerAdminAccess, async (req, res) => {
  if (!isAppAdmin(req.user) && !req.portalPermissions?.users?.manage) {
    return res.status(403).json({ error: "No Permissions" });
  }

  const id = Number(req.params.id);
  const { password } = req.body || {};
  if (!id) return res.status(400).json({ error: "invalid id" });
  if (!password) return res.status(400).json({ error: "password required" });
  if (!(await assertRecordBelongsToCustomer("users", id, req.managedCustomerId))) {
    return res.status(404).json({ error: "Benutzer nicht gefunden" });
  }

  const hash = await bcrypt.hash(String(password), 10);
  await q(`UPDATE users SET password_hash=$1 WHERE id=$2 AND app_customer_id=$3`, [hash, id, req.managedCustomerId]);
  res.json({ ok: true });
});

// ---------- WORKFLOW CASES (Status 1-4) ----------
app.get("/api/cases", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const status = req.query.status ? Number(req.query.status) : null;
  const translogicaRaw = req.query.translogica_transferred;
  const translogicaFilter = translogicaRaw === "1" ? true : translogicaRaw === "0" ? false : null;
  const search = (req.query.search || "").trim();

  if (!location_id) return res.status(400).json({ error: "location_id required" });

  const perms = await getMyPermissions(req.user);
  const canUseAllLocations = !!perms?.filters?.all_locations;
  const isAllLocations = location_id === -1;

  if (isAllLocations) {
    if (!canUseAllLocations) return res.status(403).json({ error: "Keine Berechtigung für Alle Standorte" });
  } else if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id) && !canUseAllLocations) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const where = ["c.app_customer_id=$1"];
  const params = [req.user.app_customer_id];
  let idx = 2;
  if (!isAllLocations) {
    where.push(`c.location_id=$${idx}`);
    params.push(location_id);
    idx += 1;
  }

  if (status) { where.push(`c.status=$${idx}`); params.push(status); idx++; }
  if (translogicaFilter !== null) { where.push(`c.translogica_transferred=$${idx}`); params.push(translogicaFilter); idx++; }

  if (search) {
    const like = `%${search}%`;
    const isNum = /^\d+$/.test(search);
    if (isNum) {
      where.push(`(
        c.id=$${idx}
        OR c.license_plate ILIKE $${idx + 1}
        OR COALESCE(c.entrepreneur,'') ILIKE $${idx + 1}
        OR COALESCE(c.note,'') ILIKE $${idx + 1}
        OR EXISTS (SELECT 1 FROM departments d1 WHERE d1.id=c.department_id AND d1.name ILIKE $${idx + 1})
        OR EXISTS (SELECT 1 FROM locations l1 WHERE l1.id=c.location_id AND l1.name ILIKE $${idx + 1})
      )`);
      params.push(Number(search));
      params.push(like);
      idx += 2;
    } else {
      where.push(`(
        c.license_plate ILIKE $${idx}
        OR COALESCE(c.entrepreneur,'') ILIKE $${idx}
        OR COALESCE(c.note,'') ILIKE $${idx}
        OR EXISTS (SELECT 1 FROM departments d1 WHERE d1.id=c.department_id AND d1.name ILIKE $${idx})
        OR EXISTS (SELECT 1 FROM locations l1 WHERE l1.id=c.location_id AND l1.name ILIKE $${idx})
      )`);
      params.push(like);
      idx += 1;
    }
  }

  const rows = (await q(
    `
    SELECT
      c.*,
      COALESCE(d.name, '(gelöschte Abteilung)') AS department,
      l.name AS location,
      COALESCE(u.username, '(gelöscht)') AS created_by_name,
      COALESCE(cu.username, '(gelöscht)') AS claimed_by_name,
      COALESCE(su.username, '(gelöscht)') AS submitted_by_name,
      COALESCE(au.username, '(gelöscht)') AS approved_by_name
    FROM booking_cases c
    LEFT JOIN departments d ON d.id=c.department_id
    JOIN locations l ON l.id=c.location_id
    LEFT JOIN users u ON u.id=c.created_by
    LEFT JOIN users cu ON cu.id=c.claimed_by
    LEFT JOIN users su ON su.id=c.submitted_by
    LEFT JOIN users au ON au.id=c.approved_by
    WHERE ${where.join(" AND ")}
    ORDER BY c.id DESC
    LIMIT 500
    `,
    params
  )).rows;

  res.json(rows);
});

app.get("/api/cases/:id", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const result = await q(
    `
    SELECT
      c.*,
      COALESCE(d.name, '(gelöschte Abteilung)') AS department,
      l.name AS location,
      COALESCE(u.username, '(gelöscht)') AS created_by_name,
      COALESCE(cu.username, '(gelöscht)') AS claimed_by_name,
      COALESCE(su.username, '(gelöscht)') AS submitted_by_name,
      COALESCE(au.username, '(gelöscht)') AS approved_by_name
    FROM booking_cases c
    LEFT JOIN departments d ON d.id=c.department_id
    JOIN locations l ON l.id=c.location_id
    LEFT JOIN users u ON u.id=c.created_by
    LEFT JOIN users cu ON cu.id=c.claimed_by
    LEFT JOIN users su ON su.id=c.submitted_by
    LEFT JOIN users au ON au.id=c.approved_by
    WHERE c.id=$1
      AND c.app_customer_id=$2
    LIMIT 1
    `,
    [id, req.user.app_customer_id]
  );

  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  const row = result.rows[0];

  if (req.user.role !== "admin" && req.user.location_id && Number(req.user.location_id) !== Number(row.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  res.json(row);
});

app.post("/api/cases", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const perms = await getMyPermissions(req.user);
  if (!perms?.cases?.create) return res.status(403).json({ error: "Keine Berechtigung" });

  const { location_id, department_id, license_plate, entrepreneur, note, qty_in, qty_out, employee_code, product_type } = req.body || {};
  const locId = Number(location_id);
  const depId = Number(department_id);

  if (!locId || !depId) return res.status(400).json({ error: "location_id + department_id required" });

  const plateCheck = normalizePlate(license_plate);
  if (!plateCheck.ok) return res.status(400).json({ error: plateCheck.msg });

  const inQty = Number(qty_in ?? 0);
  const outQty = Number(qty_out ?? 0);
  if (!Number.isInteger(inQty) || inQty < 0) return res.status(400).json({ error: "qty_in invalid" });
  if (!Number.isInteger(outQty) || outQty < 0) return res.status(400).json({ error: "qty_out invalid" });
  if (inQty === 0 && outQty === 0) return res.status(400).json({ error: "qty_in oder qty_out muss > 0 sein" });

  const productTypeCheck = normalizeProductType(product_type);
  if (!productTypeCheck.ok) return res.status(400).json({ error: productTypeCheck.msg });

  const employeeCodeCheck = normalizeEmployeeCode(employee_code);
  if (employeeCodeCheck && employeeCodeCheck.ok === false) {
    return res.status(400).json({ error: employeeCodeCheck.msg });
  }

  if (req.user.role !== "admin" && req.user.location_id && locId !== Number(req.user.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!(await assertRecordBelongsToCustomer("locations", locId, req.user.app_customer_id))) {
    return res.status(400).json({ error: "Standort nicht gefunden" });
  }
  if (!(await assertRecordBelongsToCustomer("departments", depId, req.user.app_customer_id))) {
    return res.status(400).json({ error: "Abteilung nicht gefunden" });
  }

  const r = await q(
    `
    INSERT INTO booking_cases (location_id, department_id, created_by, status, license_plate, entrepreneur, note, qty_in, qty_out, employee_code, product_type, app_customer_id)
    VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id
    `,
    [locId, depId, req.user.id, plateCheck.plate, safeTrim(entrepreneur), safeTrim(note), inQty, outQty, employeeCodeCheck?.code || null, productTypeCheck.productType, req.user.app_customer_id]
  );

  if (safeTrim(entrepreneur)) {
    await q(
      `
      INSERT INTO entrepreneur_history (location_id, department_id, created_by, entrepreneur, license_plate, qty_in, qty_out, product_type, app_customer_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [locId, depId, req.user.id, safeTrim(entrepreneur), plateCheck.plate, inQty, outQty, productTypeCheck.productType, req.user.app_customer_id]
    );
  }

  const caseId = Number(r.rows[0].id);
  await logCaseHistory({
    caseId,
    locationId: locId,
    departmentId: depId,
    appCustomerId: req.user.app_customer_id,
    changedBy: req.user.id,
    action: "create",
    changes: [
      { field: "status", from: null, to: 1 },
      { field: "license_plate", from: null, to: plateCheck.plate || null },
      { field: "entrepreneur", from: null, to: safeTrim(entrepreneur) },
      { field: "note", from: null, to: safeTrim(note) },
      { field: "qty_in", from: null, to: inQty },
      { field: "qty_out", from: null, to: outQty },
      { field: "product_type", from: null, to: productTypeCheck.productType },
      { field: "employee_code", from: null, to: employeeCodeCheck?.code || null }
    ]
  });

  io.to(`loc:${locId}`).emit("casesUpdated", { location_id: locId });
  void createLocationStatus1Notifications({
    id: caseId,
    location_id: locId,
    created_by: req.user.id
  });
  res.json({ id: caseId });
});

app.post("/api/internal-transfers", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const perms = await getMyPermissions(req.user);
  if (!perms?.cases?.internal_transfer) return res.status(403).json({ error: "Keine Berechtigung" });

  const fromLocationIdRaw = req.body?.from_location_id;
  const fromLocationId = fromLocationIdRaw !== null && fromLocationIdRaw !== undefined && String(fromLocationIdRaw) !== ""
    ? Number(fromLocationIdRaw)
    : null;
  const toLocationId = Number(req.body?.to_location_id || 0);
  const qty = Number(req.body?.qty || 0);
  const note = safeTrim(req.body?.note);

  if (!toLocationId) return res.status(400).json({ error: "to_location_id required" });
  if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "qty invalid" });
  if (!note) return res.status(400).json({ error: "Notiz ist Pflicht" });
  if (fromLocationId && fromLocationId === toLocationId) return res.status(400).json({ error: "from_location_id und to_location_id dürfen nicht identisch sein" });

  const productTypeCheck = normalizeProductType(req.body?.product_type || "euro");
  if (!productTypeCheck.ok) return res.status(400).json({ error: productTypeCheck.msg });

  const userLocationLock = (req.user.role !== "admin" && req.user.location_id) ? Number(req.user.location_id) : null;
  if (userLocationLock) {
    if (toLocationId !== userLocationLock) return res.status(403).json({ error: "Forbidden" });
    if (fromLocationId && fromLocationId !== userLocationLock) return res.status(403).json({ error: "Forbidden" });
  }
  if (!(await assertRecordBelongsToCustomer("locations", toLocationId, req.user.app_customer_id))) {
    return res.status(400).json({ error: "Standort nicht gefunden" });
  }
  if (fromLocationId && !(await assertRecordBelongsToCustomer("locations", fromLocationId, req.user.app_customer_id))) {
    return res.status(400).json({ error: "Standort nicht gefunden" });
  }

  const groupId = crypto.randomUUID();
  let line = 1;

  if (fromLocationId) {
    await q(
      `
      INSERT INTO bookings (location_id, department_id, user_id, type, quantity, note, receipt_no, license_plate, entrepreneur, booking_group_id, line_no, product_type, app_customer_id)
      VALUES ($1,NULL,$2,'OUT',$3,$4,NULL,NULL,NULL,$5,$6,$7,$8)
      `,
      [fromLocationId, req.user.id, qty, note, groupId, line, productTypeCheck.productType, req.user.app_customer_id]
    );
    line += 1;
  }

  await q(
    `
    INSERT INTO bookings (location_id, department_id, user_id, type, quantity, note, receipt_no, license_plate, entrepreneur, booking_group_id, line_no, product_type, app_customer_id)
    VALUES ($1,NULL,$2,'IN',$3,$4,NULL,NULL,NULL,$5,$6,$7,$8)
    `,
    [toLocationId, req.user.id, qty, note, groupId, line, productTypeCheck.productType, req.user.app_customer_id]
  );

  if (fromLocationId) {
    io.to(`loc:${fromLocationId}`).emit("stockUpdated", { from_location_id: fromLocationId, to_location_id: toLocationId });
    io.to(`loc:${fromLocationId}`).emit("bookingsUpdated", { location_id: fromLocationId });
  }
  io.to(`loc:${toLocationId}`).emit("stockUpdated", { from_location_id: fromLocationId, to_location_id: toLocationId });
  io.to(`loc:${toLocationId}`).emit("bookingsUpdated", { location_id: toLocationId });

  res.json({ ok: true, mode: fromLocationId ? "transfer" : "in_only" });
});

app.put("/api/cases/:id", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const existing = await q(`SELECT * FROM booking_cases WHERE id=$1 AND app_customer_id=$2`, [id, req.user.app_customer_id]);
  if (existing.rowCount === 0) return res.status(404).json({ error: "Not found" });
  const c = existing.rows[0];

  if (req.user.role !== "admin" && req.user.location_id && Number(req.user.location_id) !== Number(c.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const perms = await getMyPermissions(req.user);
  const { action, department_id, license_plate, entrepreneur, note, qty_in, qty_out, non_exchangeable_qty, employee_code, product_type, translogica_transferred } = req.body || {};

  const inQty = qty_in !== undefined ? Number(qty_in) : null;
  const outQty = qty_out !== undefined ? Number(qty_out) : null;
  const nonExchangeableQty = non_exchangeable_qty !== undefined ? Number(non_exchangeable_qty) : null;

  if (action === "edit") {
    if (!perms?.cases?.edit) return res.status(403).json({ error: "Keine Berechtigung" });
    if (![1, 2].includes(Number(c.status))) return res.status(400).json({ error: "Nur in Status 1/2 editierbar" });

    let plate = null;
    if (license_plate !== undefined) {
      const check = normalizePlate(license_plate);
      if (!check.ok) return res.status(400).json({ error: check.msg });
      plate = check.plate;
    }

    if (inQty !== null && (!Number.isInteger(inQty) || inQty < 0)) return res.status(400).json({ error: "qty_in invalid" });
    if (outQty !== null && (!Number.isInteger(outQty) || outQty < 0)) return res.status(400).json({ error: "qty_out invalid" });
    if (nonExchangeableQty !== null && (!Number.isInteger(nonExchangeableQty) || nonExchangeableQty < 0)) {
      return res.status(400).json({ error: "non_exchangeable_qty invalid" });
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "department_id")) {
      const depId = Number(department_id || 0);
      if (!depId) return res.status(400).json({ error: "department_id invalid" });
      if (!(await assertRecordBelongsToCustomer("departments", depId, req.user.app_customer_id))) {
        return res.status(400).json({ error: "Abteilung nicht gefunden" });
      }
    }

    const nextInQty = inQty !== null ? inQty : Number(c.qty_in || 0);
    const nextOutQty = outQty !== null ? outQty : Number(c.qty_out || 0);
    const positiveSoll = Math.max(nextInQty - nextOutQty, 0);

    if (Number(c.status) !== 2 && nonExchangeableQty !== null) {
      return res.status(400).json({ error: "non_exchangeable_qty nur in Status 2 editierbar" });
    }
    if (Number(c.status) === 2 && nonExchangeableQty !== null && nonExchangeableQty > positiveSoll) {
      return res.status(400).json({ error: "non_exchangeable_qty darf positives Soll nicht übersteigen" });
    }

    const productTypeCheck = product_type !== undefined ? normalizeProductType(product_type) : null;
    if (productTypeCheck && !productTypeCheck.ok) return res.status(400).json({ error: productTypeCheck.msg });

    let employeeCode = undefined;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "employee_code")) {
      if (Number(c.status) !== 2) {
        return res.status(400).json({ error: "employee_code nur in Status 2 editierbar" });
      }
      const employeeCodeCheck = normalizeEmployeeCode(employee_code);
      if (employeeCodeCheck && !employeeCodeCheck.ok) return res.status(400).json({ error: employeeCodeCheck.msg });
      employeeCode = employeeCodeCheck?.code || null;
      if (perms?.cases?.require_employee_code && !employeeCode) {
        return res.status(400).json({ error: "Lagermitarbeiter (2-stellig) ist bei Status 2 Pflicht" });
      }
    }

    const hasDepartmentId = Object.prototype.hasOwnProperty.call(req.body || {}, "department_id");
    const hasLicensePlate = Object.prototype.hasOwnProperty.call(req.body || {}, "license_plate");
    const hasEntrepreneur = Object.prototype.hasOwnProperty.call(req.body || {}, "entrepreneur");
    const hasNote = Object.prototype.hasOwnProperty.call(req.body || {}, "note");
    const hasQtyIn = Object.prototype.hasOwnProperty.call(req.body || {}, "qty_in");
    const hasQtyOut = Object.prototype.hasOwnProperty.call(req.body || {}, "qty_out");
    const hasProductType = Object.prototype.hasOwnProperty.call(req.body || {}, "product_type");

    await q(
      `
      UPDATE booking_cases
      SET department_id = CASE WHEN $1::boolean THEN $2 ELSE department_id END,
          license_plate = CASE WHEN $3::boolean THEN $4 ELSE license_plate END,
          entrepreneur = CASE WHEN $5::boolean THEN $6 ELSE entrepreneur END,
          note = CASE WHEN $7::boolean THEN $8 ELSE note END,
          qty_in = CASE WHEN $9::boolean THEN $10 ELSE qty_in END,
          qty_out = CASE WHEN $11::boolean THEN $12 ELSE qty_out END,
          product_type = CASE WHEN $13::boolean THEN $14 ELSE product_type END,
          non_exchangeable_qty = CASE WHEN status = 2 THEN COALESCE($15, non_exchangeable_qty) ELSE non_exchangeable_qty END,
          employee_code = CASE
            WHEN status = 2 AND $16::boolean THEN $17
            ELSE employee_code
          END,
          updated_at = now()
      WHERE id=$18
      `,
      [
        hasDepartmentId,
        department_id ? Number(department_id) : null,
        hasLicensePlate,
        plate,
        hasEntrepreneur,
        safeTrim(entrepreneur),
        hasNote,
        safeTrim(note),
        hasQtyIn,
        inQty,
        hasQtyOut,
        outQty,
        hasProductType,
        productTypeCheck?.productType || null,
        nonExchangeableQty,
        employeeCode !== undefined,
        employeeCode ?? null,
        id
      ]
    );

    const editChanges = [];
    if (department_id !== undefined && Number(department_id) !== Number(c.department_id)) editChanges.push({ field: "department_id", from: Number(c.department_id), to: Number(department_id) });
    if (license_plate !== undefined && plate !== c.license_plate) editChanges.push({ field: "license_plate", from: c.license_plate || null, to: plate || null });
    if (entrepreneur !== undefined && safeTrim(entrepreneur) !== (c.entrepreneur || null)) editChanges.push({ field: "entrepreneur", from: c.entrepreneur || null, to: safeTrim(entrepreneur) });
    if (note !== undefined && safeTrim(note) !== (c.note || null)) editChanges.push({ field: "note", from: c.note || null, to: safeTrim(note) });
    if (inQty !== null && Number(inQty) !== Number(c.qty_in)) editChanges.push({ field: "qty_in", from: Number(c.qty_in), to: Number(inQty) });
    if (outQty !== null && Number(outQty) !== Number(c.qty_out)) editChanges.push({ field: "qty_out", from: Number(c.qty_out), to: Number(outQty) });
    if (productTypeCheck?.productType && productTypeCheck.productType !== (c.product_type || "euro")) editChanges.push({ field: "product_type", from: c.product_type || "euro", to: productTypeCheck.productType });
    if (nonExchangeableQty !== null && Number(nonExchangeableQty) !== Number(c.non_exchangeable_qty)) editChanges.push({ field: "non_exchangeable_qty", from: Number(c.non_exchangeable_qty || 0), to: Number(nonExchangeableQty) });
    if (employeeCode !== undefined && (employeeCode || null) !== (c.employee_code || null)) editChanges.push({ field: "employee_code", from: c.employee_code || null, to: employeeCode || null });

    if (editChanges.length > 0) {
      await logCaseHistory({
        caseId: id,
        locationId: c.location_id,
        departmentId: Number(department_id) || Number(c.department_id),
        appCustomerId: c.app_customer_id,
        receiptNo: c.receipt_no || null,
        changedBy: req.user.id,
        action: "edit",
        changes: editChanges
      });
    }

    io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
    return res.json({ ok: true });
  }

  if (action === "claim") {
    if (!perms?.cases?.claim) return res.status(403).json({ error: "Keine Berechtigung" });
    if (Number(c.status) !== 1) return res.status(400).json({ error: "Nur aus Status 1 möglich" });

    await q(
      `UPDATE booking_cases SET status=2, claimed_by=$1, claimed_at=now(), updated_at=now() WHERE id=$2`,
      [req.user.id, id]
    );

    await logCaseHistory({
      caseId: id,
      locationId: c.location_id,
      departmentId: c.department_id,
      appCustomerId: c.app_customer_id,
      receiptNo: c.receipt_no || null,
      changedBy: req.user.id,
      action: "claim",
      changes: [{ field: "status", from: Number(c.status), to: 2 }]
    });

    io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
    return res.json({ ok: true });
  }

  if (action === "submit") {
    if (!perms?.cases?.submit) return res.status(403).json({ error: "Keine Berechtigung" });
    if (Number(c.status) !== 2) return res.status(400).json({ error: "Nur aus Status 2 möglich" });

    if (nonExchangeableQty !== null) {
      if (!Number.isInteger(nonExchangeableQty) || nonExchangeableQty < 0) {
        return res.status(400).json({ error: "non_exchangeable_qty invalid" });
      }
      const positiveSoll = Math.max(Number(c.qty_in || 0) - Number(c.qty_out || 0), 0);
      if (nonExchangeableQty > positiveSoll) {
        return res.status(400).json({ error: "non_exchangeable_qty darf positives Soll nicht übersteigen" });
      }
    }

    let employeeCode = c.employee_code || null;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "employee_code")) {
      const employeeCodeCheck = normalizeEmployeeCode(employee_code);
      if (employeeCodeCheck && !employeeCodeCheck.ok) return res.status(400).json({ error: employeeCodeCheck.msg });
      employeeCode = employeeCodeCheck?.code || null;
    }

    if (perms?.cases?.require_employee_code && !employeeCode) {
      return res.status(400).json({ error: "Lagermitarbeiter (2-stellig) ist bei Status 2 Pflicht" });
    }

    await q(
      `UPDATE booking_cases
       SET status=3,
           submitted_by=$1,
           submitted_at=now(),
           non_exchangeable_qty=COALESCE($2, non_exchangeable_qty),
           employee_code=$3,
           updated_at=now()
       WHERE id=$4`,
      [req.user.id, nonExchangeableQty, employeeCode, id]
    );

    const submitChanges = [{ field: "status", from: Number(c.status), to: 3 }];
    if (nonExchangeableQty !== null && Number(nonExchangeableQty) !== Number(c.non_exchangeable_qty || 0)) {
      submitChanges.push({ field: "non_exchangeable_qty", from: Number(c.non_exchangeable_qty || 0), to: Number(nonExchangeableQty) });
    }
    if ((employeeCode || null) !== (c.employee_code || null)) {
      submitChanges.push({ field: "employee_code", from: c.employee_code || null, to: employeeCode || null });
    }
    await logCaseHistory({
      caseId: id,
      locationId: c.location_id,
      departmentId: c.department_id,
      appCustomerId: c.app_customer_id,
      receiptNo: c.receipt_no || null,
      changedBy: req.user.id,
      action: "submit",
      changes: submitChanges
    });

    await deleteNotificationsForCaseByTitle(id, "Aviso Standort (Status 1)");
    void createDepartmentStatus3Notifications({
      id,
      department_id: c.department_id,
      submitted_by: req.user.id
    });
    io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
    return res.json({ ok: true });
  }

  if (action === "approve") {
    if (!perms?.cases?.approve) return res.status(403).json({ error: "Keine Berechtigung" });
    if (Number(c.status) !== 3) return res.status(400).json({ error: "Nur aus Status 3 möglich" });

    const receipt_no = await nextReceiptNo(c.location_id);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE booking_cases
         SET status=4, approved_by=$1, approved_at=now(), receipt_no=$2, updated_at=now()
         WHERE id=$3`,
        [req.user.id, receipt_no, id]
      );

      await client.query(
        `
        INSERT INTO booking_case_history (case_id, location_id, department_id, app_customer_id, receipt_no, changed_by, action, changes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
        `,
        [id, c.location_id, c.department_id, c.app_customer_id, receipt_no, req.user.id, "approve", JSON.stringify([
          { field: "status", from: Number(c.status), to: 4 },
          { field: "receipt_no", from: c.receipt_no || null, to: receipt_no }
        ])]
      );

      const groupId = crypto.randomUUID();
      let line = 1;

      const nonExchangeableQty = Number(c.non_exchangeable_qty || 0);
      const bookedInQty = Math.max(Number(c.qty_in || 0) - nonExchangeableQty, 0);

      if (bookedInQty > 0) {
        await client.query(
          `
          INSERT INTO bookings (location_id, department_id, user_id, type, quantity, note, receipt_no, license_plate, entrepreneur, booking_group_id, line_no, product_type, app_customer_id)
          VALUES ($1,$2,$3,'IN',$4,$5,$6,$7,$8,$9,$10,$11,$12)
          `,
          [c.location_id, c.department_id, req.user.id, bookedInQty, c.note, receipt_no, c.license_plate, c.entrepreneur, groupId, line, c.product_type || "euro", req.user.app_customer_id]
        );
        line++;
      }

      if (Number(c.qty_out) > 0) {
        await client.query(
          `
          INSERT INTO bookings (location_id, department_id, user_id, type, quantity, note, receipt_no, license_plate, entrepreneur, booking_group_id, line_no, product_type, app_customer_id)
          VALUES ($1,$2,$3,'OUT',$4,$5,$6,$7,$8,$9,$10,$11,$12)
          `,
          [c.location_id, c.department_id, req.user.id, Number(c.qty_out), c.note, receipt_no, c.license_plate, c.entrepreneur, groupId, line, c.product_type || "euro", req.user.app_customer_id]
        );
      }

      await client.query("COMMIT");

      io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
      io.to(`loc:${c.location_id}`).emit("stockUpdated", { location_id: c.location_id });

      // ✅ NEU: Historie/Bookings live aktualisieren
      io.to(`loc:${c.location_id}`).emit("bookingsUpdated", {
        location_id: c.location_id,
        department_id: c.department_id,
        receipt_no
      });

      await deleteNotificationsForCaseByTitle(id, "Aviso Abteilung (Status 3)");

      return res.json({ ok: true, receipt_no });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  if (action === "set_translogica") {
    if (!perms?.bookings?.translogica) return res.status(403).json({ error: "Keine Berechtigung" });
    if (Number(c.status) !== 4) return res.status(400).json({ error: "Nur für gebuchte Vorgänge möglich" });
    if (typeof translogica_transferred !== "boolean") {
      return res.status(400).json({ error: "translogica_transferred must be boolean" });
    }

    await q(
      `UPDATE booking_cases SET translogica_transferred=$1, updated_at=now() WHERE id=$2`,
      [translogica_transferred, id]
    );

    await logCaseHistory({
      caseId: id,
      locationId: c.location_id,
      departmentId: c.department_id,
      appCustomerId: c.app_customer_id,
      receiptNo: c.receipt_no || null,
      changedBy: req.user.id,
      action: "set_translogica",
      changes: [{ field: "translogica_transferred", from: !!c.translogica_transferred, to: !!translogica_transferred }]
    });

    io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
    return res.json({ ok: true });
  }

  if (action === "cancel") {
    if (!perms?.cases?.cancel) return res.status(403).json({ error: "Keine Berechtigung" });
    if (Number(c.status) === 4) return res.status(400).json({ error: "Gebuchte Vorgänge können nicht storniert werden" });
    if (Number(c.status) === 0) return res.status(400).json({ error: "Vorgang ist bereits storniert" });

    await q(
      `UPDATE booking_cases SET status=0, updated_at=now() WHERE id=$1`,
      [id]
    );

    await logCaseHistory({
      caseId: id,
      locationId: c.location_id,
      departmentId: c.department_id,
      appCustomerId: c.app_customer_id,
      receiptNo: c.receipt_no || null,
      changedBy: req.user.id,
      action: "cancel",
      changes: [{ field: "status", from: Number(c.status), to: 0 }]
    });

    await deleteNotificationsForCase(id);

    io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: "unknown action" });
});

app.delete("/api/cases/:id", authRequired, requireModuleEnabled("pallets"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const existing = await q(`SELECT * FROM booking_cases WHERE id=$1 AND app_customer_id=$2`, [id, req.user.app_customer_id]);
  if (existing.rowCount === 0) return res.status(404).json({ error: "Not found" });
  const c = existing.rows[0];

  if (req.user.role !== "admin" && req.user.location_id && Number(req.user.location_id) !== Number(c.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const perms = await getMyPermissions(req.user);
  if (!perms?.cases?.delete) return res.status(403).json({ error: "Keine Berechtigung" });
  await q(`DELETE FROM booking_cases WHERE id=$1 AND app_customer_id=$2`, [id, req.user.app_customer_id]);
  await deleteNotificationsForCase(id);

  io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
  res.json({ ok: true });
});

app.get("/api/cases/:id/receipt", authRequired, requireModuleEnabled("pallets"), requirePermission("bookings.receipt"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const r = await q(
    `
    SELECT
      c.id, c.created_at, c.license_plate, c.entrepreneur, c.note,
      c.qty_in, c.qty_out, c.non_exchangeable_qty, c.employee_code, c.product_type, c.status, c.receipt_no,
      l.id AS location_id, l.name AS location,
      d.id AS department_id, COALESCE(d.name, '(gelöschte Abteilung)') AS department,
      COALESCE(u.username, '(gelöscht)') AS aviso_created_by,
      e.street AS entrepreneur_street,
      e.postal_code AS entrepreneur_postal_code,
      e.city AS entrepreneur_city
    FROM booking_cases c
    JOIN locations l ON l.id=c.location_id
    LEFT JOIN departments d ON d.id=c.department_id
    LEFT JOIN users u ON u.id=c.created_by
    LEFT JOIN entrepreneurs e ON e.name=c.entrepreneur AND e.app_customer_id=c.app_customer_id
    WHERE c.id=$1
      AND c.app_customer_id=$2
    LIMIT 1
    `,
    [id, req.user.app_customer_id]
  );

  if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
  const row = r.rows[0];

  if (req.user.role !== "admin" && req.user.location_id && Number(req.user.location_id) !== Number(row.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const qty_in = Number(row.qty_in ?? 0);
  const qty_out = Number(row.qty_out ?? 0);
  const nonExchangeableQty = Number(row.non_exchangeable_qty ?? 0);
  const displayQtyIn = Math.max(qty_in - nonExchangeableQty, 0);
  const isBooked = Number(row.status) === 4 && !!row.receipt_no;
  const displayReceiptNo = isBooked ? row.receipt_no : await previewReceiptNo(row.location_id);
  const lines = [];
  if (displayQtyIn > 0) lines.push({ type: "IN", quantity: displayQtyIn });
  if (qty_out > 0) lines.push({ type: "OUT", quantity: qty_out });

  res.json({
    receipt_no: displayReceiptNo,
    provisional: !isBooked,
    created_at: row.created_at,
    location: row.location,
    department: row.department,
    username: row.aviso_created_by,
    aviso_created_by: row.aviso_created_by,
    employee_code: row.employee_code,
    license_plate: row.license_plate,
    entrepreneur: row.entrepreneur,
    entrepreneur_street: row.entrepreneur_street,
    entrepreneur_postal_code: row.entrepreneur_postal_code,
    entrepreneur_city: row.entrepreneur_city,
    note: row.note,
    qty_in: displayQtyIn,
    qty_out,
    non_exchangeable_qty: nonExchangeableQty,
    product_type: row.product_type || "euro",
    lines
  });
});

// ---------- STOCK ----------
app.get("/api/stock", authRequired, requireModuleEnabled("pallets"), requirePermission("stock.view"), async (req, res) => {
  const mode = (req.query.mode || "location").toLowerCase();
  const productTypeCheck = normalizeProductType(req.query.product_type || "euro");
  if (!productTypeCheck.ok) return res.status(400).json({ error: productTypeCheck.msg });
  const productType = productTypeCheck.productType;
  const userLocationLock =
    (req.user.role !== "admin" && req.user.location_id) ? Number(req.user.location_id) : null;

  if (mode === "entrepreneur") {
    const rows = (await q(
      `
      SELECT
        COALESCE(b.entrepreneur, '') AS entrepreneur,
        COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS ins,
        COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS outs,
        COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0) -
        COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS saldo
      FROM bookings b
      JOIN entrepreneurs e ON e.name=b.entrepreneur AND e.app_customer_id=$2
      WHERE b.entrepreneur IS NOT NULL
        AND b.entrepreneur <> ''
        AND b.app_customer_id=$2
        AND COALESCE(b.product_type, 'euro')=$1
      GROUP BY COALESCE(b.entrepreneur, '')
      ORDER BY COALESCE(b.entrepreneur, '')
      `,
      [productType, req.user.app_customer_id]
    )).rows;

    return res.json(rows);
  }

  if (mode === "overall") {
    // Extra-Schalter: Komplett Bestand nur wenn erlaubt
    const perms = await getMyPermissions(req.user);
    if (!perms?.stock?.overall) return res.status(403).json({ error: "Keine Berechtigung" });
    const sql = userLocationLock
      ? `
        SELECT d.id AS department_id, d.name AS department,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS ins,
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS outs,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0) -
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS saldo
        FROM departments d
        LEFT JOIN bookings b ON b.department_id=d.id AND b.app_customer_id=$1 AND b.location_id=$2 AND COALESCE(b.product_type, 'euro')=$3
        WHERE d.app_customer_id=$1
        GROUP BY d.id
        ORDER BY d.name
      `
      : `
        SELECT d.id AS department_id, d.name AS department,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS ins,
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS outs,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0) -
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS saldo
        FROM departments d
        LEFT JOIN bookings b ON b.department_id=d.id AND b.app_customer_id=$1 AND COALESCE(b.product_type, 'euro')=$2
        WHERE d.app_customer_id=$1
        GROUP BY d.id
        ORDER BY d.name
      `;

    return res.json((await q(
      sql,
      userLocationLock
        ? [req.user.app_customer_id, userLocationLock, productType]
        : [req.user.app_customer_id, productType]
    )).rows);
  }

  if (mode === "location_total") {
    const sql = userLocationLock
      ? `
        SELECT l.id AS location_id, l.name AS location,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS ins,
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS outs,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0) -
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS saldo
        FROM locations l
        LEFT JOIN bookings b ON b.location_id=l.id AND b.app_customer_id=$1 AND COALESCE(b.product_type, 'euro')=$3
        WHERE l.app_customer_id=$1 AND l.id=$2
        GROUP BY l.id
        ORDER BY l.name
      `
      : `
        SELECT l.id AS location_id, l.name AS location,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS ins,
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS outs,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0) -
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS saldo
        FROM locations l
        LEFT JOIN bookings b ON b.location_id=l.id AND b.app_customer_id=$1 AND COALESCE(b.product_type, 'euro')=$2
        WHERE l.app_customer_id=$1
        GROUP BY l.id
        ORDER BY l.name
      `;

    return res.json((await q(
      sql,
      userLocationLock
        ? [req.user.app_customer_id, userLocationLock, productType]
        : [req.user.app_customer_id, productType]
    )).rows);
  }

  const location_id = Number(req.query.location_id || 0);
  if (!location_id) return res.status(400).json({ error: "location_id required for mode=location" });
  if (userLocationLock && location_id !== userLocationLock) return res.status(403).json({ error: "Forbidden" });

  const rows = (await q(
    `
    SELECT d.id AS department_id, d.name AS department,
           COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS ins,
           COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS outs,
           COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0) -
           COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS saldo
    FROM departments d
    LEFT JOIN bookings b ON b.department_id=d.id AND b.location_id=$1 AND b.app_customer_id=$2 AND COALESCE(b.product_type, 'euro')=$3
    WHERE d.app_customer_id=$2
    GROUP BY d.id
    ORDER BY d.name
    `,
    [location_id, req.user.app_customer_id, productType]
  )).rows;

  res.json(rows);
});

// ---------- BOOKINGS LIST (Historie aggregiert pro Beleg) ----------
app.get("/api/bookings", authRequired, requireModuleEnabled("pallets"), requirePermission("bookings.view"), async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const department_id = Number(req.query.department_id || 0);
  const date_from = (req.query.date_from || "").trim();
  const date_to = (req.query.date_to || "").trim();
  const entrepreneur = (req.query.entrepreneur || "").trim();
  const license_plate = (req.query.license_plate || "").trim();
  const receipt_no = (req.query.receipt_no || "").trim();
  const limitRaw = Number(req.query.limit || 20);
  const offsetRaw = Number(req.query.offset || 0);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  const offset = Number.isInteger(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  if (!location_id) return res.status(400).json({ error: "location_id required" });

  const perms = await getMyPermissions(req.user);
  const canUseAllLocations = !!perms?.filters?.all_locations;
  const isAllLocations = location_id === -1;

  if (isAllLocations) {
    if (!canUseAllLocations) return res.status(403).json({ error: "Keine Berechtigung für Alle Standorte" });
  } else if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id) && !canUseAllLocations) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const where = ["b.app_customer_id=$1"];
  const params = [req.user.app_customer_id];
  let idx = 2;

  if (department_id > 0) {
    where.push(`b.department_id=$${idx}`);
    params.push(department_id);
    idx += 1;
  }

  if (!isAllLocations) {
    where.push(`b.location_id=$${idx}`);
    params.push(location_id);
    idx += 1;
  }

  if (date_from) { where.push(`b.created_at >= $${idx}::date`); params.push(date_from); idx++; }
  if (date_to) { where.push(`b.created_at < ($${idx}::date + interval '1 day')`); params.push(date_to); idx++; }
  if (entrepreneur) { where.push(`COALESCE(b.entrepreneur,'') ILIKE $${idx}`); params.push(`%${entrepreneur}%`); idx++; }
  if (license_plate) { where.push(`COALESCE(b.license_plate,'') ILIKE $${idx}`); params.push(`%${license_plate}%`); idx++; }
  if (receipt_no) { where.push(`b.receipt_no ILIKE $${idx}`); params.push(`%${receipt_no}%`); idx++; }

  params.push(limit + 1, offset);

  const rows = (await q(
    `
    SELECT
      MIN(b.id) AS id,
      MAX(bc.id) AS case_id,
      MIN(b.created_at) AS created_at,
      b.receipt_no,
      MAX(b.license_plate) AS license_plate,
      MAX(b.entrepreneur) AS entrepreneur,
      MAX(b.note) AS note,
      MAX(COALESCE(u.username, '(gelöscht)')) AS "user",
      MAX(COALESCE(uc.username, '(gelöscht)')) AS aviso_created_by,
      MAX(COALESCE(ua.username, '(gelöscht)')) AS aviso_approved_by,
      MAX(bc.employee_code) AS employee_code,
      MAX(COALESCE(b.product_type, 'euro')) AS product_type,
      COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS qty_in,
      COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS qty_out
    FROM bookings b
    LEFT JOIN users u ON u.id=b.user_id
    LEFT JOIN booking_cases bc ON bc.receipt_no=b.receipt_no
    LEFT JOIN users uc ON uc.id=bc.created_by
    LEFT JOIN users ua ON ua.id=bc.approved_by
    WHERE ${where.join(" AND ")}
    GROUP BY b.receipt_no
    ORDER BY MIN(b.id) DESC
    LIMIT $${idx}
    OFFSET $${idx + 1}
    `,
    params
  )).rows;

  const has_more = rows.length > limit;
  res.json({
    items: has_more ? rows.slice(0, limit) : rows,
    has_more,
    limit,
    offset
  });
});

// ---------- ENTREPRENEUR HISTORY ----------
app.get("/api/entrepreneur-history", authRequired, requireModuleEnabled("pallets"), requirePermission("bookings.view"), async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const department_id = Number(req.query.department_id || 0);
  const entrepreneur = (req.query.entrepreneur || "").trim();
  const license_plate = (req.query.license_plate || "").trim();

  if (!location_id) return res.status(400).json({ error: "location_id required" });

  const perms = await getMyPermissions(req.user);
  const canUseAllLocations = !!perms?.filters?.all_locations;
  const isAllLocations = location_id === -1;

  if (isAllLocations) {
    if (!canUseAllLocations) return res.status(403).json({ error: "Keine Berechtigung für Alle Standorte" });
  } else if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id) && !canUseAllLocations) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const where = [`c.status <> 0`, `c.app_customer_id = $1`];
  const params = [req.user.app_customer_id];
  let idx = 2;
  if (!isAllLocations) {
    where.push(`c.location_id=$${idx}`);
    params.push(location_id);
    idx += 1;
  }

  if (department_id) { where.push(`c.department_id=$${idx}`); params.push(department_id); idx++; }
  if (entrepreneur) { where.push(`c.entrepreneur ILIKE $${idx}`); params.push(`%${entrepreneur}%`); idx++; }
  if (license_plate) { where.push(`c.license_plate ILIKE $${idx}`); params.push(`%${license_plate}%`); idx++; }

  const rows = (await q(
    `
    SELECT
      MAX(c.created_at) AS last_seen,
      c.entrepreneur,
      c.license_plate,
      COALESCE(c.product_type, 'euro') AS product_type,
      COALESCE(d.name, '(gelöschte Abteilung)') AS department,
      COALESCE(SUM(c.qty_in), 0) AS qty_in,
      COALESCE(SUM(c.qty_out), 0) AS qty_out,
      COALESCE(SUM(c.qty_in), 0) - COALESCE(SUM(c.qty_out), 0)
        - COALESCE(SUM(CASE WHEN (c.qty_in - c.qty_out) > 0 THEN c.non_exchangeable_qty ELSE 0 END), 0) AS soll
    FROM booking_cases c
    LEFT JOIN departments d ON d.id=c.department_id
    WHERE ${where.join(" AND ")}
      AND COALESCE(c.entrepreneur, '') <> ''
    GROUP BY c.entrepreneur, c.license_plate, COALESCE(c.product_type, 'euro'), COALESCE(d.name, '(gelöschte Abteilung)')
    ORDER BY MAX(c.created_at) DESC
    LIMIT 500
    `,
    params
  )).rows;

  res.json(rows);
});

app.get("/api/entrepreneur-history/plates", authRequired, requireModuleEnabled("pallets"), requirePermission("bookings.view"), async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const department_id = Number(req.query.department_id || 0);

  if (!location_id) return res.status(400).json({ error: "location_id required" });

  const perms = await getMyPermissions(req.user);
  const canUseAllLocations = !!perms?.filters?.all_locations;
  const isAllLocations = location_id === -1;

  if (isAllLocations) {
    if (!canUseAllLocations) return res.status(403).json({ error: "Keine Berechtigung für Alle Standorte" });
  } else if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id) && !canUseAllLocations) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const where = ["eh.app_customer_id=$1"];
  const params = [req.user.app_customer_id];
  let idx = 2;
  if (!isAllLocations) {
    where.push(`eh.location_id=$${idx}`);
    params.push(location_id);
    idx += 1;
  }
  if (department_id) { where.push(`eh.department_id=$${idx}`); params.push(department_id); idx++; }

  const rows = (await q(
    `
    SELECT DISTINCT eh.license_plate
    FROM entrepreneur_history eh
    WHERE ${where.join(" AND ")} AND eh.license_plate IS NOT NULL AND eh.license_plate <> ''
    ORDER BY eh.license_plate
    `,
    params
  )).rows;

  res.json(rows);
});

app.get("/api/cases/:id/history", authRequired, requireModuleEnabled("pallets"), requirePermission("bookings.view"), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const base = await q(`SELECT id, location_id FROM booking_cases WHERE id=$1 AND app_customer_id=$2`, [id, req.user.app_customer_id]);
  if (base.rowCount === 0) return res.status(404).json({ error: "Not found" });
  const caseRow = base.rows[0];

  const perms = await getMyPermissions(req.user);
  const canUseAllLocations = !!perms?.filters?.all_locations;
  if (req.user.role !== "admin" && req.user.location_id && Number(req.user.location_id) !== Number(caseRow.location_id) && !canUseAllLocations) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const rows = (await q(
    `
    SELECT
      h.id,
      h.case_id,
      h.receipt_no,
      h.action,
      h.changes,
      h.created_at,
      COALESCE(u.username, '(gelöscht)') AS changed_by
    FROM booking_case_history h
    LEFT JOIN users u ON u.id=h.changed_by
    WHERE h.case_id=$1
      AND h.app_customer_id=$2
    ORDER BY h.created_at DESC, h.id DESC
    `,
    [id, req.user.app_customer_id]
  )).rows;

  res.json(rows);
});

// ---------- BOOKINGS EDIT (Ledger) ----------
app.put("/api/bookings/:id", authRequired, requireModuleEnabled("pallets"), requirePermission("bookings.edit"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const { quantity, note, entrepreneur, license_plate } = req.body || {};

  let qty = null;
  if (quantity !== undefined && quantity !== null && quantity !== "") {
    qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "quantity must be positive integer" });
  }

  let plate = null;
  if (license_plate !== undefined && license_plate !== null && String(license_plate).trim() !== "") {
    const check = normalizePlate(license_plate);
    if (!check.ok) return res.status(400).json({ error: check.msg });
    plate = check.plate;
  }

  const existing = await q(`SELECT id, location_id, department_id, receipt_no FROM bookings WHERE id=$1 AND app_customer_id=$2`, [id, req.user.app_customer_id]);
  if (existing.rowCount === 0) return res.status(404).json({ error: "Not found" });

  const row = existing.rows[0];
  if (req.user.role !== "admin" && req.user.location_id && Number(req.user.location_id) !== Number(row.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await q(
    `
    UPDATE bookings
    SET quantity = COALESCE($1, quantity),
        note = COALESCE($2, note),
        entrepreneur = COALESCE($3, entrepreneur),
        license_plate = COALESCE($4, license_plate)
    WHERE id=$5 AND app_customer_id=$6
    `,
    [
      qty,
      (note !== undefined ? safeTrim(note) : null),
      (entrepreneur !== undefined ? safeTrim(entrepreneur) : null),
      plate,
      id,
      req.user.app_customer_id
    ]
  );

  io.to(`loc:${row.location_id}`).emit("stockUpdated", { location_id: row.location_id });

  // ✅ NEU: Historie/Bookings live aktualisieren
  io.to(`loc:${row.location_id}`).emit("bookingsUpdated", {
    location_id: row.location_id,
    department_id: row.department_id,
    receipt_no: row.receipt_no
  });

  res.json({ ok: true });
});

// ---------- RECEIPT ----------
app.get("/api/receipt/:bookingId", authRequired, requireModuleEnabled("pallets"), requirePermission("bookings.receipt"), async (req, res) => {
  const id = Number(req.params.bookingId);

  const base = await q(`SELECT receipt_no FROM bookings WHERE id=$1 AND app_customer_id=$2`, [id, req.user.app_customer_id]);
  if (base.rowCount === 0) return res.status(404).json({ error: "Not found" });
  const receiptNo = base.rows[0].receipt_no;

  const r = await q(
    `
    SELECT
      b.id, b.receipt_no, b.license_plate, b.entrepreneur, b.type, b.quantity, b.note, b.created_at,
      COALESCE(b.product_type, 'euro') AS product_type,
      b.booking_group_id, b.line_no,
      COALESCE(u.username, '(gelöscht)') AS username,
      l.id AS location_id, l.name AS location,
      d.id AS department_id, COALESCE(d.name, '(gelöschte Abteilung)') AS department,
      e.street AS entrepreneur_street,
      e.postal_code AS entrepreneur_postal_code,
      e.city AS entrepreneur_city,
      COALESCE(uc.username, '(gelöscht)') AS aviso_created_by,
      bc.employee_code,
      bc.non_exchangeable_qty
    FROM bookings b
    LEFT JOIN users u ON u.id=b.user_id
    JOIN locations l ON l.id=b.location_id
    LEFT JOIN departments d ON d.id=b.department_id
    LEFT JOIN entrepreneurs e ON e.name=b.entrepreneur AND e.app_customer_id=b.app_customer_id
    LEFT JOIN booking_cases bc ON bc.receipt_no=b.receipt_no AND bc.app_customer_id=b.app_customer_id
    LEFT JOIN users uc ON uc.id=bc.created_by
    WHERE b.receipt_no = $1
      AND b.app_customer_id = $2
    ORDER BY COALESCE(b.line_no, 999999) ASC, b.id ASC
    `,
    [receiptNo, req.user.app_customer_id]
  );

  const rows = r.rows;
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });

  const locationId = Number(rows[0].location_id);
  if (req.user.role !== "admin" && req.user.location_id && locationId !== Number(req.user.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const first = rows[0];
  const lines = rows.map(x => ({ type: x.type, quantity: Number(x.quantity) }));

  const qty_in = lines.reduce((s, x) => s + (x.type === "IN" ? x.quantity : 0), 0);
  const qty_out = lines.reduce((s, x) => s + (x.type === "OUT" ? x.quantity : 0), 0);

  res.json({
    receipt_no: first.receipt_no,
    created_at: first.created_at,
    location: first.location,
    department: first.department,
    username: first.username,
    license_plate: first.license_plate,
    entrepreneur: first.entrepreneur,
    entrepreneur_street: first.entrepreneur_street,
    entrepreneur_postal_code: first.entrepreneur_postal_code,
    entrepreneur_city: first.entrepreneur_city,
    aviso_created_by: first.aviso_created_by,
    employee_code: first.employee_code,
    note: first.note,
    qty_in,
    qty_out,
    non_exchangeable_qty: Number(first.non_exchangeable_qty || 0),
    product_type: first.product_type || "euro",
    lines
  });
});

// ---------- EXPORTS ----------
app.get("/api/export/csv", authRequired, requireModuleEnabled("pallets"), requirePermission("bookings.export"), async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const department_id = Number(req.query.department_id || 0);
  if (!location_id) return res.status(400).json({ error: "location_id required" });

  const perms = await getMyPermissions(req.user);
  const canUseAllLocations = !!perms?.filters?.all_locations;
  const isAllLocations = location_id === -1;

  if (isAllLocations) {
    if (!canUseAllLocations) return res.status(403).json({ error: "Keine Berechtigung für Alle Standorte" });
  } else if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id) && !canUseAllLocations) {
    return res.status(403).json({ error: "Forbidden" });
  }

  let locLabel = "Alle Standorte";
  if (!isAllLocations) {
    const loc = await q(`SELECT name FROM locations WHERE id=$1 AND app_customer_id=$2`, [location_id, req.user.app_customer_id]);
    if (loc.rowCount === 0) return res.status(404).json({ error: "location not found" });
    locLabel = loc.rows[0].name;
  }

  let depLabel = "Alle Abteilungen";
  if (department_id > 0) {
    const dep = await q(`SELECT name FROM departments WHERE id=$1 AND app_customer_id=$2`, [department_id, req.user.app_customer_id]);
    if (dep.rowCount === 0) return res.status(404).json({ error: "department not found" });
    depLabel = dep.rows[0].name;
  }

  const where = ["b.app_customer_id=$1"];
  const params = [req.user.app_customer_id];
  let idx = 2;

  if (!isAllLocations) {
    where.push(`b.location_id=$${idx}`);
    params.push(location_id);
    idx += 1;
  }

  if (department_id > 0) {
    where.push(`b.department_id=$${idx}`);
    params.push(department_id);
    idx += 1;
  }

  const rows = (await q(
    `
    SELECT b.created_at, b.receipt_no, b.license_plate, b.entrepreneur, COALESCE(u.username, '(gelöscht)') AS username, b.type, b.quantity, b.note
    FROM bookings b LEFT JOIN users u ON u.id=b.user_id
    WHERE ${where.join(" AND ")}
    ORDER BY b.id ASC
    `,
    params
  )).rows;

  const parser = new Parser({ fields: ["created_at","receipt_no","license_plate","entrepreneur","username","type","quantity","note"] });
  const csv = parser.parse(rows);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${locLabel}-${depLabel}-buchungen.csv"`);
  res.send(csv);
});

app.get("/api/export/xlsx", authRequired, requireModuleEnabled("pallets"), requirePermission("bookings.export"), async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const department_id = Number(req.query.department_id || 0);
  if (!location_id) return res.status(400).json({ error: "location_id required" });

  const perms = await getMyPermissions(req.user);
  const canUseAllLocations = !!perms?.filters?.all_locations;
  const isAllLocations = location_id === -1;

  if (isAllLocations) {
    if (!canUseAllLocations) return res.status(403).json({ error: "Keine Berechtigung für Alle Standorte" });
  } else if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id) && !canUseAllLocations) {
    return res.status(403).json({ error: "Forbidden" });
  }

  let locLabel = "Alle Standorte";
  if (!isAllLocations) {
    const loc = await q(`SELECT name FROM locations WHERE id=$1 AND app_customer_id=$2`, [location_id, req.user.app_customer_id]);
    if (loc.rowCount === 0) return res.status(404).json({ error: "location not found" });
    locLabel = loc.rows[0].name;
  }

  let depLabel = "Alle Abteilungen";
  if (department_id > 0) {
    const dep = await q(`SELECT name FROM departments WHERE id=$1 AND app_customer_id=$2`, [department_id, req.user.app_customer_id]);
    if (dep.rowCount === 0) return res.status(404).json({ error: "department not found" });
    depLabel = dep.rows[0].name;
  }

  const where = ["b.app_customer_id=$1"];
  const params = [req.user.app_customer_id];
  let idx = 2;

  if (!isAllLocations) {
    where.push(`b.location_id=$${idx}`);
    params.push(location_id);
    idx += 1;
  }

  if (department_id > 0) {
    where.push(`b.department_id=$${idx}`);
    params.push(department_id);
    idx += 1;
  }

  const rows = (await q(
    `
    SELECT b.created_at, b.receipt_no, b.license_plate, b.entrepreneur, COALESCE(u.username, '(gelöscht)') AS username, b.type, b.quantity, b.note
    FROM bookings b LEFT JOIN users u ON u.id=b.user_id
    WHERE ${where.join(" AND ")}
    ORDER BY b.id ASC
    `,
    params
  )).rows;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Buchungen");
  ws.columns = [
    { header: "Datum/Zeit", key: "created_at", width: 22 },
    { header: "Belegnr.", key: "receipt_no", width: 20 },
    { header: "Kennzeichen", key: "license_plate", width: 16 },
    { header: "Unternehmer", key: "entrepreneur", width: 22 },
    { header: "Benutzer", key: "username", width: 18 },
    { header: "Typ", key: "type", width: 8 },
    { header: "Menge", key: "quantity", width: 10 },
    { header: "Notiz", key: "note", width: 30 }
  ];
  ws.addRows(rows);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${locLabel}-${depLabel}-buchungen.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});


async function ensureRuntimeTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      case_id INTEGER REFERENCES booking_cases(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON user_notifications(user_id, created_at DESC);`);

  await q(`ALTER TABLE booking_cases ADD COLUMN IF NOT EXISTS non_exchangeable_qty INTEGER NOT NULL DEFAULT 0;`);

  await q(`
    CREATE TABLE IF NOT EXISTS booking_case_history (
      id SERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL REFERENCES booking_cases(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
      receipt_no TEXT,
      changed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      action TEXT NOT NULL,
      changes JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_booking_case_history_case_created ON booking_case_history(case_id, created_at DESC);`);

  await q(`
    CREATE TABLE IF NOT EXISTS container_planning_bookings (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      container_no TEXT NOT NULL,
      customer TEXT NOT NULL DEFAULT '-',
      warehouse TEXT NOT NULL DEFAULT '-',
      plate TEXT NOT NULL,
      order_no TEXT NOT NULL,
      booking_date DATE NOT NULL,
      color TEXT NOT NULL DEFAULT '#0ea5e9',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_container_planning_bookings_date ON container_planning_bookings(booking_date, created_at);`);

  await q(`
    CREATE TABLE IF NOT EXISTS container_registration_containers (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'slot_created',
      plate TEXT NOT NULL DEFAULT '',
      time TEXT NOT NULL DEFAULT '',
      registered_at TIMESTAMPTZ,
      booking_no BIGINT
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS container_registration_history (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL,
      type TEXT NOT NULL,
      container_id INTEGER NOT NULL,
      plate TEXT NOT NULL DEFAULT '',
      details JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_container_registration_history_booking ON container_registration_history ((details->>'bookingNo'));`);

  await q(`
    CREATE TABLE IF NOT EXISTS container_registration_booking_counter (
      id INTEGER PRIMARY KEY,
      value BIGINT NOT NULL
    );
  `);
  await q(`
    INSERT INTO container_registration_booking_counter (id, value)
    VALUES (1, 0)
    ON CONFLICT (id) DO NOTHING;
  `);

  for (let i = 1; i <= 8; i += 1) {
    await q(
      `INSERT INTO container_registration_containers (id, status, plate, time, registered_at, booking_no)
       VALUES ($1, $2, $3, $4, NULL, NULL)
       ON CONFLICT (id) DO NOTHING`,
      [i, CONTAINER_REGISTRATION_STATUS_SLOT_CREATED, "", ""]
    );
  }
}

const PORT = process.env.PORT || 3001;
ensureRuntimeTables()
  .then(() => loadContainerRegistrationState())
  .then(() => {
    httpServer.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
