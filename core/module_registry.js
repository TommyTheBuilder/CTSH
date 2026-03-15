const permissionsConfig = require("../permissions_config");

const MODULE_REGISTRY = Object.freeze([
  {
    key: "pallets",
    name: "Paletten",
    shortName: "Paletten",
    launchPath: "/pallets",
    entryPath: "/modules/pallets/index.html",
    adminPath: "/modules/pallets/admin.html",
    enabledByDefault: true,
    permissionRoots: ["bookings", "stock", "cases", "filters", "masterdata"],
    aliasPermissionRoots: [],
    dashboard: {
      theme: "pallets",
      tag: "Modul",
      eyebrow: "Lager und Bewegung",
      description: "Buchungen erfassen, Bestände prüfen und Bewegungen lückenlos nachverfolgen."
    },
    licensing: {
      includedInBaseProduct: true,
      label: "Basismodul",
      salesDescription: "Das Kernmodul für die produktive Nutzung der Installation."
    },
    canAccess(perms) {
      return permissionsConfig.hasPalletModulePermission(perms);
    },
    canAdmin(perms) {
      return permissionsConfig.hasPalletModuleAdminPermission(perms);
    }
  },
  {
    key: "warehouse",
    name: "Lager-Versandsystem",
    shortName: "Warehouse",
    launchPath: "/warehouse",
    entryPath: "/modules/warehouse/index.html",
    adminPath: null,
    enabledByDefault: false,
    permissionRoots: ["warehouse"],
    aliasPermissionRoots: [],
    dashboard: {
      theme: "warehouse",
      tag: "Warehouse",
      eyebrow: "Lager und Versand",
      description: "Artikel, Lagerplätze, Stellplätze, Kommissionierung und Historie zentral steuern."
    },
    licensing: {
      includedInBaseProduct: false,
      label: "Zusatzmodul",
      salesDescription: "Optional buchbares Modul für Lager- und Versandprozesse."
    },
    canAccess(perms) {
      return permissionsConfig.hasWarehouseModulePermission(perms);
    },
    canAdmin() {
      return false;
    }
  },
  {
    key: "container_registration",
    name: "Container Anmeldung",
    shortName: "Anmeldung",
    launchPath: "/container-registration",
    entryPath: "/modules/container-registration/driver.html",
    adminPath: "/modules/container-registration/admin.html",
    enabledByDefault: false,
    permissionRoots: ["modules.container_registration"],
    aliasPermissionRoots: [
      "integrations.container_login",
      "integrations.container_registration",
      "integrations.container_viewer",
      "integrations.container_admin"
    ],
    dashboard: {
      theme: "container-registration",
      tag: "Operations",
      eyebrow: "Anmeldung und Check-in",
      description: "Ankünfte koordinieren, Registrierungen vorbereiten und Prozesse vor Ort beschleunigen."
    },
    licensing: {
      includedInBaseProduct: false,
      label: "Zusatzmodul",
      salesDescription: "Optional buchbares Modul für Check-in, Anmeldung und Statusboard."
    },
    canAccess(perms) {
      return permissionsConfig.hasContainerRegistrationModuleAccess(perms);
    },
    canAdmin(perms) {
      return permissionsConfig.hasContainerRegistrationAdminAccess(perms);
    }
  },
  {
    key: "container_planning",
    name: "Container und LKW Planung",
    shortName: "Planung",
    launchPath: "/container-planning",
    entryPath: "/modules/container-planning/index.html",
    adminPath: null,
    enabledByDefault: false,
    permissionRoots: ["modules.container_planning"],
    aliasPermissionRoots: ["integrations.container_planning"],
    dashboard: {
      theme: "container-planning",
      tag: "Planung",
      eyebrow: "Disposition und Auslastung",
      description: "Slots, Transporte und Ressourcen in einer Planungsansicht abstimmen."
    },
    licensing: {
      includedInBaseProduct: false,
      label: "Zusatzmodul",
      salesDescription: "Optional buchbares Modul für Transport-, Slot- und Ressourcenplanung."
    },
    canAccess(perms) {
      return permissionsConfig.hasContainerPlanningPermission(perms);
    },
    canAdmin() {
      return false;
    }
  }
]);

function listModules() {
  return MODULE_REGISTRY.slice();
}

function getModuleByKey(moduleKey) {
  return MODULE_REGISTRY.find((entry) => entry.key === String(moduleKey || "").trim()) || null;
}

function getDefaultEnabledModuleKeys() {
  return MODULE_REGISTRY.filter((entry) => entry.enabledByDefault).map((entry) => entry.key);
}

module.exports = {
  getDefaultEnabledModuleKeys,
  getModuleByKey,
  listModules
};
