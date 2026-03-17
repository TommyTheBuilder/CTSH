ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS is_warehouse_role BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_warehouse_user BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE roles
SET is_warehouse_role = TRUE
WHERE COALESCE(is_warehouse_role, FALSE) = FALSE
  AND (
    LOWER(name) LIKE 'warehouse %'
    OR COALESCE((permissions -> 'warehouse')::text, '{}') LIKE '%true%'
  );

UPDATE users
SET is_warehouse_user = TRUE
WHERE COALESCE(is_warehouse_user, FALSE) = FALSE
  AND role_id IN (
    SELECT id
    FROM roles
    WHERE COALESCE(is_warehouse_role, FALSE) = TRUE
  );

UPDATE users
SET is_warehouse_user = FALSE
WHERE COALESCE(is_app_admin, FALSE) = TRUE;

CREATE INDEX IF NOT EXISTS idx_roles_customer_warehouse_scope
  ON roles (app_customer_id, is_warehouse_role, name);

CREATE INDEX IF NOT EXISTS idx_users_customer_admin_scope
  ON users (app_customer_id, is_app_admin, is_warehouse_user, username);
