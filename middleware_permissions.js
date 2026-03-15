const { isAppAdmin, getUserPermissions } = require("./core/platform_access");

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

function requirePermission(permissionPath) {
  return async (req, res, next) => {
    try {
      if (isAppAdmin(req.user)) return next();

      if (!req.user.permissions) {
        req.user.permissions = await getUserPermissions(req.user);
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
