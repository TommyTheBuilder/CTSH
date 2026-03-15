INSERT INTO roles (name, permissions)
VALUES (
  'Warehouse Buero',
  '{
    "warehouse": {
      "dashboard": { "view": true },
      "customers": { "view": true, "manage": true },
      "articles": { "view": true, "manage": true },
      "storage_locations": { "view": true, "manage": true },
      "inventory": { "view": true, "manage": false },
      "transactions": { "create": false, "view": true, "export": true, "manage": false },
      "picking": { "view": true, "manage": true, "process": false }
    }
  }'::jsonb
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO roles (name, permissions)
VALUES (
  'Warehouse Lagerist',
  '{
    "warehouse": {
      "dashboard": { "view": true },
      "customers": { "view": true, "manage": false },
      "articles": { "view": true, "manage": false },
      "storage_locations": { "view": true, "manage": false },
      "inventory": { "view": true, "manage": false },
      "transactions": { "create": true, "view": false, "export": false, "manage": false },
      "picking": { "view": true, "manage": false, "process": true }
    }
  }'::jsonb
)
ON CONFLICT (name) DO NOTHING;
