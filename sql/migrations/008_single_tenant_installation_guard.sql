CREATE OR REPLACE FUNCTION enforce_single_tenant_app_customer()
RETURNS trigger AS $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM app_customers
    WHERE id <> COALESCE(NEW.id, -1)
  ) >= 1 THEN
    RAISE EXCEPTION 'Pro Server ist nur eine Installation zulässig.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_customers_single_tenant ON app_customers;

CREATE TRIGGER trg_app_customers_single_tenant
BEFORE INSERT ON app_customers
FOR EACH ROW
EXECUTE FUNCTION enforce_single_tenant_app_customer();
