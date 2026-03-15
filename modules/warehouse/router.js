const express = require("express");
const { Parser } = require("json2csv");
const ExcelJS = require("exceljs");

const {
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
  updateCustomer,
  updateInventoryRecord,
  updatePickingOrder,
  updatePickingOrderItem,
  updateStorageLocation,
  updateTransactionRecord
} = require("./service");

function formatTimestamp(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString();
}

function buildExportRows(rows) {
  return rows.map((row) => ({
    id: row.id,
    datum: formatTimestamp(row.datum),
    typ: row.typ,
    beleg_nr: row.beleg_nr || "",
    positions_nr: row.positions_nr || "",
    kunden_nr: row.kunden_nr || "",
    customer_name: row.customer_name || "",
    stellplatz_nr: row.stellplatz_nr ?? "",
    stellplaetze: Array.isArray(row.stellplaetze) ? row.stellplaetze.join(", ") : "",
    source_stellplaetze: Array.isArray(row.source_stellplaetze) ? row.source_stellplaetze.join(", ") : "",
    target_stellplaetze: Array.isArray(row.target_stellplaetze) ? row.target_stellplaetze.join(", ") : "",
    verpackungsart: row.verpackungsart || "",
    menge: row.menge,
    storage_location_from: row.storage_location_from_name || "",
    storage_location_to: row.storage_location_to_name || "",
    username: row.username || "",
    notiz: row.notiz || ""
  }));
}

function handleRoute(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof WarehouseError) {
        return res.status(error.status).json({
          error: error.message,
          details: error.details || null
        });
      }
      console.error("warehouse route error:", error);
      return res.status(500).json({ error: "Warehouse request failed" });
    }
  };
}

function createWarehouseRouter({ authRequired, requirePermission }) {
  const router = express.Router();

  router.use(authRequired);

  router.get(
    "/dashboard",
    requirePermission("warehouse.dashboard.view"),
    handleRoute(async (_req, res) => {
      res.json(await getDashboardSummary());
    })
  );

  router.get(
    "/customers",
    requirePermission("warehouse.customers.view"),
    handleRoute(async (req, res) => {
      res.json(await listCustomers(req.query || {}));
    })
  );

  router.get(
    "/customers/:id",
    requirePermission("warehouse.customers.view"),
    handleRoute(async (req, res) => {
      res.json(await getCustomer(req.params.id));
    })
  );

  router.post(
    "/customers",
    requirePermission("warehouse.customers.manage"),
    handleRoute(async (req, res) => {
      res.status(201).json(await createCustomer(req.body || {}));
    })
  );

  router.put(
    "/customers/:id",
    requirePermission("warehouse.customers.manage"),
    handleRoute(async (req, res) => {
      res.json(await updateCustomer(req.params.id, req.body || {}));
    })
  );

  router.delete(
    "/customers/:id",
    requirePermission("warehouse.customers.manage"),
    handleRoute(async (req, res) => {
      res.json(await deleteCustomer(req.params.id));
    })
  );

  router.get(
    "/storage-locations",
    requirePermission("warehouse.storage_locations.view"),
    handleRoute(async (req, res) => {
      res.json(await listStorageLocations(req.query || {}));
    })
  );

  router.get(
    "/storage-locations/:id",
    requirePermission("warehouse.storage_locations.view"),
    handleRoute(async (req, res) => {
      res.json(await getStorageLocation(req.params.id));
    })
  );

  router.get(
    "/storage-locations/:id/slots",
    requirePermission("warehouse.storage_locations.view"),
    handleRoute(async (req, res) => {
      res.json(await listStorageLocationSlots(req.params.id, req.query || {}));
    })
  );

  router.post(
    "/storage-locations",
    requirePermission("warehouse.storage_locations.manage"),
    handleRoute(async (req, res) => {
      res.status(201).json(await createStorageLocation(req.body || {}));
    })
  );

  router.put(
    "/storage-locations/:id",
    requirePermission("warehouse.storage_locations.manage"),
    handleRoute(async (req, res) => {
      res.json(await updateStorageLocation(req.params.id, req.body || {}));
    })
  );

  router.delete(
    "/storage-locations/:id",
    requirePermission("warehouse.storage_locations.manage"),
    handleRoute(async (req, res) => {
      res.json(await deleteStorageLocation(req.params.id));
    })
  );

  router.get(
    "/inventory",
    requirePermission("warehouse.inventory.view"),
    handleRoute(async (req, res) => {
      res.json(await listInventory(req.query || {}));
    })
  );

  router.get(
    "/inventory/:id",
    requirePermission("warehouse.inventory.view"),
    handleRoute(async (req, res) => {
      res.json(await getInventoryRecord(req.params.id));
    })
  );

  router.post(
    "/inventory",
    requirePermission("warehouse.inventory.manage"),
    handleRoute(async (req, res) => {
      res.status(201).json(await createInventoryRecord(req.body || {}));
    })
  );

  router.put(
    "/inventory/:id",
    requirePermission("warehouse.inventory.manage"),
    handleRoute(async (req, res) => {
      res.json(await updateInventoryRecord(req.params.id, req.body || {}));
    })
  );

  router.delete(
    "/inventory/:id",
    requirePermission("warehouse.inventory.manage"),
    handleRoute(async (req, res) => {
      res.json(await deleteInventoryRecord(req.params.id));
    })
  );

  router.get(
    "/transactions/export/csv",
    requirePermission("warehouse.transactions.export"),
    handleRoute(async (req, res) => {
      const rows = buildExportRows(await exportTransactions(req.query || {}));
      const parser = new Parser({
        fields: [
          "id",
          "datum",
          "typ",
          "beleg_nr",
          "positions_nr",
          "kunden_nr",
          "customer_name",
          "stellplatz_nr",
          "stellplaetze",
          "source_stellplaetze",
          "target_stellplaetze",
          "verpackungsart",
          "menge",
          "storage_location_from",
          "storage_location_to",
          "username",
          "notiz"
        ]
      });
      const csv = parser.parse(rows);
      const dateStamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="warehouse-transactions-${dateStamp}.csv"`);
      res.send(csv);
    })
  );

  router.get(
    "/transactions/export/xlsx",
    requirePermission("warehouse.transactions.export"),
    handleRoute(async (req, res) => {
      const rows = buildExportRows(await exportTransactions(req.query || {}));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Transaktionen");
      worksheet.columns = [
        { header: "ID", key: "id", width: 10 },
        { header: "Datum", key: "datum", width: 24 },
        { header: "Typ", key: "typ", width: 12 },
        { header: "Belegnr.", key: "beleg_nr", width: 18 },
        { header: "Positionsnr.", key: "positions_nr", width: 18 },
        { header: "Kundennr.", key: "kunden_nr", width: 16 },
        { header: "Kunde", key: "customer_name", width: 26 },
        { header: "Stellplatz", key: "stellplatz_nr", width: 12 },
        { header: "Stellplätze", key: "stellplaetze", width: 22 },
        { header: "Quelle Stellplätze", key: "source_stellplaetze", width: 22 },
        { header: "Ziel Stellplätze", key: "target_stellplaetze", width: 22 },
        { header: "Verpackungsart", key: "verpackungsart", width: 18 },
        { header: "Menge", key: "menge", width: 12 },
        { header: "Von Lagerplatz", key: "storage_location_from", width: 20 },
        { header: "Zu Lagerplatz", key: "storage_location_to", width: 20 },
        { header: "Benutzer", key: "username", width: 18 },
        { header: "Notiz", key: "notiz", width: 36 }
      ];
      worksheet.addRows(rows);
      worksheet.getRow(1).font = { bold: true };

      const dateStamp = new Date().toISOString().slice(0, 10);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="warehouse-transactions-${dateStamp}.xlsx"`
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      await workbook.xlsx.write(res);
      res.end();
    })
  );

  router.get(
    "/transactions",
    requirePermission("warehouse.transactions.view"),
    handleRoute(async (req, res) => {
      res.json(await listTransactions(req.query || {}));
    })
  );

  router.get(
    "/transactions/:id",
    requirePermission("warehouse.transactions.view"),
    handleRoute(async (req, res) => {
      res.json(await fetchTransactionRecord(req.params.id));
    })
  );

  router.post(
    "/transactions",
    requirePermission("warehouse.transactions.create"),
    handleRoute(async (req, res) => {
      res.status(201).json(await createTransactionRecord(req.body || {}, req.user.id));
    })
  );

  router.put(
    "/transactions/:id",
    requirePermission("warehouse.transactions.manage"),
    handleRoute(async (req, res) => {
      res.json(await updateTransactionRecord(req.params.id, req.body || {}));
    })
  );

  router.delete(
    "/transactions/:id",
    requirePermission("warehouse.transactions.manage"),
    handleRoute(async (req, res) => {
      res.json(await deleteTransactionRecord(req.params.id));
    })
  );

  router.get(
    "/picking-orders",
    requirePermission("warehouse.picking.view"),
    handleRoute(async (req, res) => {
      res.json(await listPickingOrders(req.query || {}));
    })
  );

  router.get(
    "/picking-orders/:id",
    requirePermission("warehouse.picking.view"),
    handleRoute(async (req, res) => {
      res.json(await fetchPickingOrder(req.params.id));
    })
  );

  router.post(
    "/picking-orders",
    requirePermission("warehouse.picking.manage"),
    handleRoute(async (req, res) => {
      res.status(201).json(await createPickingOrder(req.body || {}, req.user.id));
    })
  );

  router.put(
    "/picking-orders/:id/start",
    requirePermission("warehouse.picking.process"),
    handleRoute(async (req, res) => {
      res.json(await startPickingOrder(req.params.id, req.user.id));
    })
  );

  router.put(
    "/picking-orders/:id/complete",
    requirePermission("warehouse.picking.process"),
    handleRoute(async (req, res) => {
      res.json(await completePickingOrder(req.params.id, req.body || {}, req.user.id));
    })
  );

  router.put(
    "/picking-orders/:orderId/items/:itemId",
    requirePermission("warehouse.picking.process"),
    handleRoute(async (req, res) => {
      res.json(await updatePickingOrderItem(req.params.orderId, req.params.itemId, req.body || {}, req.user.id));
    })
  );

  router.put(
    "/picking-orders/:id",
    requirePermission("warehouse.picking.manage"),
    handleRoute(async (req, res) => {
      res.json(await updatePickingOrder(req.params.id, req.body || {}));
    })
  );

  router.delete(
    "/picking-orders/:id",
    requirePermission("warehouse.picking.manage"),
    handleRoute(async (req, res) => {
      res.json(await deletePickingOrder(req.params.id));
    })
  );

  return router;
}

module.exports = { createWarehouseRouter };
