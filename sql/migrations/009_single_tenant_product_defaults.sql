UPDATE app_customers
SET name = 'Standardinstallation'
WHERE name = 'Standardkunde'
  AND NOT EXISTS (
    SELECT 1
    FROM app_customers
    WHERE name = 'Standardinstallation'
  );

UPDATE app_customers
SET slug = 'standardinstallation'
WHERE slug = 'standardkunde'
  AND NOT EXISTS (
    SELECT 1
    FROM app_customers
    WHERE slug = 'standardinstallation'
  );

INSERT INTO app_customer_modules (app_customer_id, module_key, is_enabled)
SELECT
  c.id,
  m.module_key,
  CASE WHEN m.module_key = 'pallets' THEN TRUE ELSE FALSE END
FROM app_customers c
JOIN app_modules m
  ON m.module_key IN ('pallets', 'warehouse', 'container_registration', 'container_planning')
ON CONFLICT (app_customer_id, module_key) DO NOTHING;

UPDATE app_customer_modules
SET is_enabled = TRUE,
    updated_at = now()
WHERE module_key = 'pallets';

UPDATE app_customer_modules
SET is_enabled = FALSE,
    updated_at = now()
WHERE module_key IN ('warehouse', 'container_registration', 'container_planning');
