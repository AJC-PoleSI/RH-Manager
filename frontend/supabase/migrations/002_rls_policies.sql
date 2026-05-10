-- Enable Row-Level Security on employees table
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Create roles (assuming they exist in Supabase auth)
-- Admin role: full access to all employees
CREATE POLICY "admin_all_employees" ON employees
  FOR ALL USING (
    (SELECT auth.jwt() ->> 'role') = 'admin'
  );

-- Manager role: can view and update employees in their department
CREATE POLICY "manager_own_department" ON employees
  FOR SELECT USING (
    (SELECT auth.jwt() ->> 'role') = 'manager'
    OR (SELECT auth.jwt() ->> 'role') = 'admin'
  );

CREATE POLICY "manager_update_own_department" ON employees
  FOR UPDATE USING (
    (SELECT auth.jwt() ->> 'role') = 'manager'
    AND department = (
      SELECT department FROM employees
      WHERE id = auth.uid()
      LIMIT 1
    )
  )
  WITH CHECK (
    (SELECT auth.jwt() ->> 'role') = 'manager'
    AND department = (
      SELECT department FROM employees
      WHERE id = auth.uid()
      LIMIT 1
    )
  );

-- Employee role: can view own record only
CREATE POLICY "employee_own_record" ON employees
  FOR SELECT USING (
    (SELECT auth.jwt() ->> 'role') = 'employee'
    AND id = auth.uid()
  );

-- Prevent unauthorized inserts
CREATE POLICY "insert_only_admin" ON employees
  FOR INSERT WITH CHECK (
    (SELECT auth.jwt() ->> 'role') = 'admin'
  );

-- Prevent unauthorized deletes
CREATE POLICY "delete_only_admin" ON employees
  FOR DELETE USING (
    (SELECT auth.jwt() ->> 'role') = 'admin'
  );

-- Enable RLS on audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Admins can view all audit logs
CREATE POLICY "admin_view_audit_logs" ON audit_logs
  FOR SELECT USING (
    (SELECT auth.jwt() ->> 'role') = 'admin'
  );

-- Create audit trigger function
CREATE OR REPLACE FUNCTION log_employee_changes()
RETURNS TRIGGER AS $$
DECLARE
  changes JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    changes := row_to_json(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    changes := jsonb_build_object(
      'old', row_to_json(OLD),
      'new', row_to_json(NEW)
    );
  ELSIF TG_OP = 'DELETE' THEN
    changes := row_to_json(OLD);
  END IF;

  INSERT INTO audit_logs (table_name, record_id, action, changes, user_id)
  VALUES ('employees', COALESCE(NEW.id, OLD.id), TG_OP, changes, auth.uid());

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger to log changes
CREATE TRIGGER audit_employee_changes
AFTER INSERT OR UPDATE OR DELETE ON employees
FOR EACH ROW
EXECUTE FUNCTION log_employee_changes();
