UPDATE roles
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{warehouse}',
  '{
    "dashboard": { "view": true },
    "customers": { "view": true, "manage": true },
    "articles": { "view": true, "manage": true },
    "storage_locations": { "view": true, "manage": true },
    "inventory": { "view": true, "manage": false },
    "transactions": { "create": false, "view": true, "export": true, "manage": false },
    "picking": { "view": true, "manage": true, "process": false }
  }'::jsonb
)
WHERE name = 'Warehouse Buero';

UPDATE roles
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{warehouse}',
  '{
    "dashboard": { "view": true },
    "customers": { "view": true, "manage": false },
    "articles": { "view": true, "manage": false },
    "storage_locations": { "view": true, "manage": false },
    "inventory": { "view": true, "manage": false },
    "transactions": { "create": true, "view": false, "export": false, "manage": false },
    "picking": { "view": true, "manage": false, "process": true }
  }'::jsonb
)
WHERE name = 'Warehouse Lagerist';
