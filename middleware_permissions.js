const { pool } = require("./db_pg");
const {
  createFullAccessPermissions,
  createPermissionDefaults,
  normalizePermissions
} = require("./permissions_config");

function hasPerm(perms, permPath) {
  if (perms?.admin?.full_access) return true;
  const parts = String(permPath || "").split(".");
  let current = perms;
  for (const part of parts) {
    if (!current || typeof current !== "object") return false;
    current = current[part];
  }
  return current === true;
}

async function loadPermissionsForUser(user) {
  if (user?.role === "admin") {
    return createFullAccessPermissions();
  }

  if (!user?.role_id) {
    return createPermissionDefaults();
  }

  const result = await pool.query(`SELECT permissions FROM roles WHERE id=$1`, [Number(user.role_id)]);
  const raw = (result.rowCount ? result.rows[0].permissions : {}) || {};
  return normalizePermissions(raw);
}

function requirePermission(permissionPath) {
  return async (req, res, next) => {
    try {
      if (req.user?.role === "admin") return next();

      if (!req.user.permissions) {
        req.user.permissions = await loadPermissionsForUser(req.user);
      }

      if (!hasPerm(req.user.permissions, permissionPath)) {
        return res.status(403).json({ error: "No Permissions" });
      }

      return next();
    } catch (error) {
      console.error("requirePermission error:", error);
      return res.status(500).json({ error: "Permission check failed" });
    }
  };
}

module.exports = {
  requirePermission
};
