const WAREHOUSE_PERMISSION_DEFAULTS = {
  dashboard: { view: false },
  customers: { view: false, manage: false },
  storage_locations: { view: false, manage: false },
  inventory: { view: false, manage: false },
  transactions: { create: false, view: false, export: false, manage: false },
  picking: { view: false, manage: false, process: false }
};

const WAREHOUSE_PERMISSION_FULL_ACCESS = {
  dashboard: { view: true },
  customers: { view: true, manage: true },
  storage_locations: { view: true, manage: true },
  inventory: { view: true, manage: true },
  transactions: { create: true, view: true, export: true, manage: true },
  picking: { view: true, manage: true, process: true }
};

module.exports = {
  WAREHOUSE_PERMISSION_DEFAULTS,
  WAREHOUSE_PERMISSION_FULL_ACCESS
};
