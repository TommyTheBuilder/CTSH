const {
  WAREHOUSE_PERMISSION_DEFAULTS,
  WAREHOUSE_PERMISSION_FULL_ACCESS
} = require("./modules/warehouse/permissions");

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  const output = deepClone(base);
  for (const [key, value] of Object.entries(override || {})) {
    if (isObject(value) && isObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = deepClone(value);
    }
  }
  return output;
}

function hasAnyPermission(value) {
  if (value === true) return true;
  if (!isObject(value)) return false;
  return Object.values(value).some((entry) => hasAnyPermission(entry));
}

function createPermissionDefaults() {
  return {
    bookings: {
      create: true,
      view: true,
      export: true,
      receipt: true,
      edit: false,
      delete: false,
      translogica: false
    },
    stock: { view: true, overall: true },
    cases: {
      create: true,
      internal_transfer: false,
      claim: false,
      edit: false,
      submit: false,
      approve: false,
      cancel: false,
      delete: false,
      require_employee_code: false
    },
    filters: { all_locations: false },
    masterdata: { manage: false, entrepreneurs_manage: false },
    users: { manage: false, view_department: false },
    roles: { manage: false },
    integrations: {
      container_login: false,
      container_registration: false,
      container_planning: false,
      container_viewer: false,
      container_admin: false
    },
    modules: {
      container_registration: {
        open: false,
        viewer: false,
        history: false,
        history_export: false,
        history_clear: false,
        manage_time: false,
        manage_status: false,
        reset_container: false,
        reset_all: false
      },
      container_planning: {
        open: false,
        create: false,
        edit: false,
        delete: false
      }
    },
    warehouse: deepClone(WAREHOUSE_PERMISSION_DEFAULTS),
    admin: { full_access: false }
  };
}

function createFullAccessPermissions() {
  return {
    bookings: {
      create: true,
      view: true,
      export: true,
      receipt: true,
      edit: true,
      delete: true,
      translogica: true
    },
    stock: { view: true, overall: true },
    cases: {
      create: true,
      internal_transfer: true,
      claim: true,
      edit: true,
      submit: true,
      approve: true,
      cancel: true,
      delete: true,
      require_employee_code: false
    },
    filters: { all_locations: true },
    masterdata: { manage: true, entrepreneurs_manage: true },
    users: { manage: true, view_department: true },
    roles: { manage: true },
    integrations: {
      container_login: true,
      container_registration: true,
      container_planning: true,
      container_viewer: true,
      container_admin: true
    },
    modules: {
      container_registration: {
        open: true,
        viewer: true,
        history: true,
        history_export: true,
        history_clear: true,
        manage_time: true,
        manage_status: true,
        reset_container: true,
        reset_all: true
      },
      container_planning: {
        open: true,
        create: true,
        edit: true,
        delete: true
      }
    },
    warehouse: deepClone(WAREHOUSE_PERMISSION_FULL_ACCESS),
    admin: { full_access: true }
  };
}

function syncLegacyPermissionAliases(perms) {
  const output = deepMerge(createPermissionDefaults(), perms || {});
  const containerRegistration = output.modules.container_registration || {};
  const containerPlanning = output.modules.container_planning || {};
  const legacyIntegrations = output.integrations || {};

  const containerAdmin = Boolean(
    legacyIntegrations.container_admin
    || containerRegistration.history
    || containerRegistration.history_export
    || containerRegistration.history_clear
    || containerRegistration.manage_time
    || containerRegistration.manage_status
    || containerRegistration.reset_container
    || containerRegistration.reset_all
  );

  output.modules.container_registration = {
    open: Boolean(
      containerRegistration.open
      || legacyIntegrations.container_login
      || legacyIntegrations.container_registration
      || legacyIntegrations.container_admin
    ),
    viewer: Boolean(
      containerRegistration.viewer
      || legacyIntegrations.container_viewer
      || legacyIntegrations.container_admin
    ),
    history: Boolean(
      containerRegistration.history
      || containerRegistration.history_export
      || containerRegistration.history_clear
      || legacyIntegrations.container_admin
    ),
    history_export: Boolean(
      containerRegistration.history_export
      || legacyIntegrations.container_admin
    ),
    history_clear: Boolean(containerRegistration.history_clear || legacyIntegrations.container_admin),
    manage_time: Boolean(containerRegistration.manage_time || legacyIntegrations.container_admin),
    manage_status: Boolean(containerRegistration.manage_status || legacyIntegrations.container_admin),
    reset_container: Boolean(containerRegistration.reset_container || legacyIntegrations.container_admin),
    reset_all: Boolean(containerRegistration.reset_all || legacyIntegrations.container_admin)
  };

  output.modules.container_planning = {
    open: Boolean(
      containerPlanning.open
      || legacyIntegrations.container_planning
      || legacyIntegrations.container_admin
      || containerPlanning.create
      || containerPlanning.edit
      || containerPlanning.delete
    ),
    create: Boolean(containerPlanning.create || legacyIntegrations.container_admin),
    edit: Boolean(containerPlanning.edit || legacyIntegrations.container_admin),
    delete: Boolean(containerPlanning.delete || legacyIntegrations.container_admin)
  };

  output.integrations = {
    ...legacyIntegrations,
    container_login: output.modules.container_registration.open,
    container_registration: output.modules.container_registration.open,
    container_planning: output.modules.container_planning.open,
    container_viewer: output.modules.container_registration.viewer,
    container_admin: containerAdmin
  };

  if (output.warehouse && typeof output.warehouse === "object") {
    delete output.warehouse.articles;
  }

  return output;
}

function normalizePermissions(rawPermissions) {
  const merged = deepMerge(createPermissionDefaults(), isObject(rawPermissions) ? rawPermissions : {});
  const normalized = syncLegacyPermissionAliases(merged);
  if (normalized?.admin?.full_access) {
    return createFullAccessPermissions();
  }
  return normalized;
}

function hasContainerRegistrationAdminAccess(perms) {
  if (perms?.admin?.full_access) return true;
  const section = perms?.modules?.container_registration;
  return Boolean(
    section?.history
    || section?.history_export
    || section?.history_clear
    || section?.manage_time
    || section?.manage_status
    || section?.reset_container
    || section?.reset_all
  );
}

function hasContainerRegistrationPermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_registration?.open);
}

function hasContainerRegistrationModuleAccess(perms) {
  return Boolean(hasContainerRegistrationPermission(perms) || hasContainerRegistrationAdminAccess(perms));
}

function hasContainerViewerPermission(perms) {
  if (perms?.admin?.full_access) return true;
  return Boolean(
    perms?.modules?.container_registration?.viewer
    || hasContainerRegistrationModuleAccess(perms)
  );
}

function hasContainerHistoryPermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_registration?.history);
}

function hasContainerHistoryExportPermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_registration?.history_export);
}

function hasContainerHistoryClearPermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_registration?.history_clear);
}

function hasContainerTimeManagementPermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_registration?.manage_time);
}

function hasContainerStatusManagementPermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_registration?.manage_status);
}

function hasContainerResetPermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_registration?.reset_container);
}

function hasContainerResetAllPermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_registration?.reset_all);
}

function hasContainerPlanningPermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_planning?.open);
}

function hasContainerPlanningCreatePermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_planning?.create);
}

function hasContainerPlanningEditPermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_planning?.edit);
}

function hasContainerPlanningDeletePermission(perms) {
  return Boolean(perms?.admin?.full_access || perms?.modules?.container_planning?.delete);
}

function hasWarehouseModulePermission(perms) {
  return Boolean(perms?.admin?.full_access || hasAnyPermission(perms?.warehouse));
}

function hasPalletModulePermission(perms) {
  if (perms?.admin?.full_access) return true;
  return Boolean(
    hasAnyPermission(perms?.bookings)
    || hasAnyPermission(perms?.stock)
    || hasAnyPermission(perms?.cases)
    || hasAnyPermission(perms?.filters)
    || hasAnyPermission(perms?.masterdata)
  );
}

function hasPalletModuleAdminPermission(perms) {
  if (perms?.admin?.full_access) return true;
  return Boolean(
    perms?.masterdata?.manage
    || perms?.masterdata?.entrepreneurs_manage
  );
}

module.exports = {
  createPermissionDefaults,
  createFullAccessPermissions,
  deepMerge,
  hasAnyPermission,
  hasContainerHistoryPermission,
  hasContainerHistoryExportPermission,
  hasContainerHistoryClearPermission,
  hasContainerPlanningPermission,
  hasContainerPlanningCreatePermission,
  hasContainerPlanningDeletePermission,
  hasContainerPlanningEditPermission,
  hasContainerRegistrationAdminAccess,
  hasContainerRegistrationModuleAccess,
  hasContainerRegistrationPermission,
  hasContainerResetAllPermission,
  hasContainerResetPermission,
  hasContainerStatusManagementPermission,
  hasContainerTimeManagementPermission,
  hasContainerViewerPermission,
  hasPalletModuleAdminPermission,
  hasPalletModulePermission,
  hasWarehouseModulePermission,
  normalizePermissions
};
