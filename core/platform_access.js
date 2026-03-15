const { pool } = require("../db_pg");
const permissionsConfig = require("../permissions_config");
const { getDefaultEnabledModuleKeys, getModuleByKey, listModules } = require("./module_registry");

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function zeroValue(value) {
  if (value === true || value === false) return false;
  if (Array.isArray(value)) return [];
  if (!isObject(value)) return false;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = zeroValue(entry);
  }
  return output;
}

function clearPermissionPath(target, permissionPath) {
  const parts = String(permissionPath || "")
    .split(".")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!parts.length) return;

  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!isObject(cursor?.[parts[index]])) return;
    cursor = cursor[parts[index]];
  }

  const leafKey = parts[parts.length - 1];
  if (!(leafKey in (cursor || {}))) return;
  cursor[leafKey] = zeroValue(cursor[leafKey]);
}

function isAppAdmin(user) {
  return Boolean(user?.is_app_admin || user?.role === "admin");
}

async function getCustomerById(customerId) {
  const normalizedId = Number(customerId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) return null;
  const result = await pool.query(
    `
    SELECT id, name, slug, is_active, created_at
    FROM app_customers
    WHERE id = $1
    `,
    [normalizedId]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function getUserContext(userId) {
  const normalizedId = Number(userId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) return null;

  const result = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.role,
      u.location_id,
      u.role_id,
      u.is_active,
      u.email,
      u.fixed_department_id,
      u.app_customer_id,
      u.is_app_admin,
      c.name AS customer_name,
      c.slug AS customer_slug,
      c.is_active AS customer_is_active,
      ro.name AS business_role_name
    FROM users u
    LEFT JOIN app_customers c ON c.id = u.app_customer_id
    LEFT JOIN roles ro ON ro.id = u.role_id
    WHERE u.id = $1
    `,
    [normalizedId]
  );

  return result.rowCount ? result.rows[0] : null;
}

async function listCustomers() {
  const result = await pool.query(
    `
    SELECT
      c.id,
      c.name,
      c.slug,
      c.is_active,
      c.created_at,
      COUNT(u.id)::int AS user_count
    FROM app_customers c
    LEFT JOIN users u ON u.app_customer_id = c.id
    GROUP BY c.id
    ORDER BY c.name
    `
  );
  return result.rows;
}

async function getEnabledModuleKeysForCustomer(appCustomerId) {
  const normalizedCustomerId = Number(appCustomerId);
  if (!Number.isInteger(normalizedCustomerId) || normalizedCustomerId <= 0) {
    return getDefaultEnabledModuleKeys();
  }

  const result = await pool.query(
    `
    SELECT module_key
    FROM app_customer_modules
    WHERE app_customer_id = $1
      AND is_enabled = TRUE
    ORDER BY module_key
    `,
    [normalizedCustomerId]
  );

  if (!result.rowCount) return getDefaultEnabledModuleKeys();
  return result.rows.map((row) => row.module_key);
}

function filterPermissionsByEnabledModules(rawPermissions, enabledModuleKeys, options = {}) {
  if (options.appAdmin) return deepClone(rawPermissions || {});

  const enabled = new Set((enabledModuleKeys || []).map((entry) => String(entry)));
  const permissions = deepClone(rawPermissions || {});

  for (const moduleDefinition of listModules()) {
    if (enabled.has(moduleDefinition.key)) continue;
    for (const permissionRoot of moduleDefinition.permissionRoots || []) {
      clearPermissionPath(permissions, permissionRoot);
    }
    for (const permissionRoot of moduleDefinition.aliasPermissionRoots || []) {
      clearPermissionPath(permissions, permissionRoot);
    }
  }

  return permissions;
}

async function getUserPermissions(user) {
  if (isAppAdmin(user)) {
    return permissionsConfig.createFullAccessPermissions();
  }

  const normalizedUser = user?.id ? user : await getUserContext(user?.id);
  if (!normalizedUser?.role_id) {
    return filterPermissionsByEnabledModules(
      permissionsConfig.createPermissionDefaults(),
      await getEnabledModuleKeysForCustomer(normalizedUser?.app_customer_id),
      { appAdmin: false }
    );
  }

  const roleResult = await pool.query(
    `
    SELECT permissions
    FROM roles
    WHERE id = $1
      AND app_customer_id = $2
    `,
    [Number(normalizedUser.role_id), Number(normalizedUser.app_customer_id)]
  );

  const rawPermissions = permissionsConfig.normalizePermissions(
    (roleResult.rowCount ? roleResult.rows[0].permissions : {}) || {}
  );

  return filterPermissionsByEnabledModules(
    rawPermissions,
    await getEnabledModuleKeysForCustomer(normalizedUser.app_customer_id),
    { appAdmin: false }
  );
}

function canAccessCustomerAdmin(user, permissions) {
  return Boolean(
    isAppAdmin(user)
    || permissions?.users?.manage
    || permissions?.roles?.manage
    || permissions?.users?.view_department
  );
}

function canAccessAppAdmin(user) {
  return isAppAdmin(user);
}

function canAccessPalletModuleAdmin(user, permissions, enabledModuleKeys) {
  const enabled = new Set((enabledModuleKeys || []).map((entry) => String(entry)));
  if (!enabled.has("pallets")) return false;
  if (isAppAdmin(user)) return true;
  return permissionsConfig.hasPalletModuleAdminPermission(permissions);
}

function buildDashboardModules({ user, permissions, enabledModuleKeys }) {
  const enabled = new Set((enabledModuleKeys || []).map((entry) => String(entry)));

  return listModules()
    .map((moduleDefinition) => {
      const moduleEnabled = enabled.has(moduleDefinition.key);
      const allowed = moduleEnabled && (
        isAppAdmin(user) || moduleDefinition.canAccess(permissions)
      );
      const adminAllowed = moduleEnabled
        && Boolean(moduleDefinition.adminPath)
        && (isAppAdmin(user) || moduleDefinition.canAdmin(permissions));

      return {
        key: moduleDefinition.key,
        name: moduleDefinition.name,
        shortName: moduleDefinition.shortName,
        launchPath: moduleDefinition.launchPath,
        entryPath: moduleDefinition.entryPath,
        adminPath: adminAllowed ? moduleDefinition.adminPath : null,
        enabled: moduleEnabled,
        visible: Boolean(allowed),
        allowed: Boolean(allowed),
        dashboard: moduleDefinition.dashboard
      };
    })
    .filter((moduleEntry) => moduleEntry.visible);
}

function canAccessModule(moduleKey, user, permissions, enabledModuleKeys) {
  const moduleDefinition = getModuleByKey(moduleKey);
  if (!moduleDefinition) return false;

  const enabled = new Set((enabledModuleKeys || []).map((entry) => String(entry)));
  if (!enabled.has(moduleDefinition.key)) return false;
  if (isAppAdmin(user)) return true;
  return moduleDefinition.canAccess(permissions);
}

function canAccessModuleAdmin(moduleKey, user, permissions, enabledModuleKeys) {
  const moduleDefinition = getModuleByKey(moduleKey);
  if (!moduleDefinition?.adminPath) return false;

  const enabled = new Set((enabledModuleKeys || []).map((entry) => String(entry)));
  if (!enabled.has(moduleDefinition.key)) return false;
  if (isAppAdmin(user)) return true;
  return moduleDefinition.canAdmin(permissions);
}

function parseRequestedCustomerId(value) {
  const normalizedId = Number(value);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) return null;
  return normalizedId;
}

async function resolveManagedCustomerId(user, requestedCustomerId) {
  if (!isAppAdmin(user)) {
    return Number(user?.app_customer_id || 0) || null;
  }

  const normalizedId = parseRequestedCustomerId(requestedCustomerId);
  if (!normalizedId) {
    return Number(user?.app_customer_id || 0) || null;
  }

  const customer = await getCustomerById(normalizedId);
  return customer ? normalizedId : Number(user?.app_customer_id || 0) || null;
}

module.exports = {
  buildDashboardModules,
  canAccessAppAdmin,
  canAccessCustomerAdmin,
  canAccessModule,
  canAccessModuleAdmin,
  canAccessPalletModuleAdmin,
  filterPermissionsByEnabledModules,
  getCustomerById,
  getEnabledModuleKeysForCustomer,
  getUserContext,
  getUserPermissions,
  isAppAdmin,
  listCustomers,
  parseRequestedCustomerId,
  resolveManagedCustomerId
};
