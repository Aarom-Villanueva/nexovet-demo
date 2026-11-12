-- PostgreSQL 17. Una sede, un almacén; importes PEN y horas timestamptz.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE business_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  address text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Lima' CHECK (timezone = 'America/Lima'),
  currency char(3) NOT NULL DEFAULT 'PEN' CHECK (currency = 'PEN'),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  email text NOT NULL CHECK (position('@' IN email) > 1),
  role text NOT NULL CHECK (role IN ('admin','reception','veterinarian')),
  password_hash text,
  login_enabled boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT login_enabled OR (password_hash IS NOT NULL AND length(password_hash) > 20))
);
CREATE UNIQUE INDEX users_email_unique ON users(lower(email));

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX user_sessions_user_idx ON user_sessions(user_id);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX password_reset_user_idx ON password_reset_tokens(user_id);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  email text,
  phone text CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'),
  document_type text CHECK (document_type IN ('DNI','CE','RUC','other')),
  document_number text,
  address text,
  contact_consent_at timestamptz,
  contact_consent_note text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((document_type IS NULL) = (document_number IS NULL))
);
CREATE INDEX clients_name_idx ON clients(lower(name));
CREATE UNIQUE INDEX clients_document_unique ON clients(document_type,document_number) WHERE document_number IS NOT NULL;

CREATE TABLE pets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  species text NOT NULL CHECK (species IN ('dog','cat','bird','rabbit','other')),
  breed text,
  sex text NOT NULL DEFAULT 'unknown' CHECK (sex IN ('female','male','unknown')),
  birth_date date,
  microchip text UNIQUE,
  allergies text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,client_id)
);
CREATE INDEX pets_client_idx ON pets(client_id);

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE RESTRICT,
  professional_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','arrived','in_progress','completed','cancelled','no_show')),
  reason text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
    WHERE (status IN ('scheduled','confirmed','arrived','in_progress')),
  EXCLUDE USING gist (pet_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
    WHERE (status IN ('scheduled','confirmed','arrived','in_progress'))
);
CREATE INDEX appointments_pet_idx ON appointments(pet_id,starts_at DESC);
CREATE INDEX appointments_date_idx ON appointments(starts_at);

CREATE TABLE encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE RESTRICT,
  veterinarian_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  weight_kg numeric(7,3) CHECK (weight_kg > 0),
  temperature_c numeric(4,1) CHECK (temperature_c BETWEEN 10 AND 50),
  findings text NOT NULL DEFAULT '',
  diagnosis text NOT NULL DEFAULT '',
  treatment text NOT NULL DEFAULT '',
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE RESTRICT,
  medicine text NOT NULL,
  dosage text NOT NULL,
  instructions text NOT NULL
);
CREATE INDEX prescriptions_encounter_idx ON prescriptions(encounter_id);

CREATE TABLE vaccinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE RESTRICT,
  veterinarian_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  vaccine text NOT NULL,
  lot text,
  administered_at date NOT NULL,
  next_due date,
  CHECK (next_due IS NULL OR next_due >= administered_at)
);
CREATE INDEX vaccinations_pet_idx ON vaccinations(pet_id,administered_at DESC);

CREATE TABLE follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  pet_id uuid,
  assigned_to uuid REFERENCES users(id),
  title text NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,client_id),
  FOREIGN KEY(pet_id,client_id) REFERENCES pets(id,client_id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX tasks_pending_idx ON follow_up_tasks(due_at) WHERE status='pending';
CREATE INDEX tasks_client_idx ON follow_up_tasks(client_id);

CREATE TABLE contact_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  task_id uuid,
  recorded_by uuid NOT NULL REFERENCES users(id),
  channel text NOT NULL CHECK (channel IN ('phone','whatsapp','email','in_person')),
  outcome text NOT NULL,
  note text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(task_id,client_id) REFERENCES follow_up_tasks(id,client_id)
);
CREATE INDEX contact_events_client_idx ON contact_events(client_id,occurred_at DESC);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tax_id text UNIQUE CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{11}$'),
  email text,
  phone text,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  category_id uuid REFERENCES product_categories(id),
  sale_price numeric(12,2) NOT NULL CHECK (sale_price >= 0),
  minimum_stock numeric(12,3) NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','received','cancelled')),
  ordered_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  CHECK ((status = 'received') = (received_at IS NOT NULL))
);
CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  line_total numeric(16,2) GENERATED ALWAYS AS (round(quantity*unit_cost,2)) STORED,
  UNIQUE(purchase_order_id,product_id),
  UNIQUE(id,product_id)
);

CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  client_id uuid REFERENCES clients(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','cancelled')),
  created_by uuid NOT NULL REFERENCES users(id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
);
CREATE TABLE sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES products(id),
  service_id uuid REFERENCES services(id),
  description text NOT NULL,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(16,2) GENERATED ALWAYS AS (round(quantity*unit_price,2)) STORED,
  CHECK (num_nonnulls(product_id,service_id) = 1),
  UNIQUE(id,product_id)
);
CREATE INDEX sale_lines_sale_idx ON sale_lines(sale_id);
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('cash','card','transfer')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reference text,
  recorded_by uuid NOT NULL REFERENCES users(id),
  paid_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_sale_idx ON payments(sale_id);

-- El saldo se calcula del libro de movimientos; no hay otro stock editable.
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity numeric(12,3) NOT NULL CHECK (quantity <> 0),
  kind text NOT NULL CHECK (kind IN ('opening','purchase','sale','adjustment')),
  purchase_line_id uuid UNIQUE,
  sale_line_id uuid UNIQUE,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(purchase_line_id,product_id) REFERENCES purchase_order_lines(id,product_id),
  FOREIGN KEY(sale_line_id,product_id) REFERENCES sale_lines(id,product_id),
  CHECK (
    (kind='purchase' AND quantity>0 AND purchase_line_id IS NOT NULL AND sale_line_id IS NULL) OR
    (kind='sale' AND quantity<0 AND sale_line_id IS NOT NULL AND purchase_line_id IS NULL) OR
    (kind='opening' AND quantity>0 AND purchase_line_id IS NULL AND sale_line_id IS NULL) OR
    (kind='adjustment' AND purchase_line_id IS NULL AND sale_line_id IS NULL)
  )
);
CREATE INDEX stock_movements_product_idx ON stock_movements(product_id);
CREATE VIEW product_stock AS
  SELECT p.id AS product_id,coalesce(sum(m.quantity),0)::numeric(16,3) AS quantity
  FROM products p LEFT JOIN stock_movements m ON m.product_id=p.id GROUP BY p.id;

CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type,entity_id,created_at DESC);

CREATE FUNCTION ensure_veterinarian() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person uuid;
BEGIN
  person := coalesce(to_jsonb(NEW)->>'professional_id',to_jsonb(NEW)->>'veterinarian_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=person AND role='veterinarian' AND active) THEN
    RAISE EXCEPTION 'El profesional debe ser un veterinario activo' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER appointments_veterinarian BEFORE INSERT OR UPDATE OF professional_id ON appointments FOR EACH ROW EXECUTE FUNCTION ensure_veterinarian();
CREATE TRIGGER encounters_veterinarian BEFORE INSERT OR UPDATE OF veterinarian_id ON encounters FOR EACH ROW EXECUTE FUNCTION ensure_veterinarian();
CREATE TRIGGER vaccinations_veterinarian BEFORE INSERT OR UPDATE OF veterinarian_id ON vaccinations FOR EACH ROW EXECUTE FUNCTION ensure_veterinarian();

CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El registro es inmutable; registre una compensación' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER stock_immutable BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE FUNCTION ensure_stock_available() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE available numeric;
BEGIN
  -- Serializa las salidas concurrentes del mismo producto, incluso sin movimientos previos.
  PERFORM 1 FROM products WHERE id=NEW.product_id FOR UPDATE;
  SELECT coalesce(sum(quantity),0) INTO available FROM stock_movements WHERE product_id=NEW.product_id;
  IF available + NEW.quantity < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_available BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION ensure_stock_available();

-- Los flujos transaccionales de recepción, venta, pagos, cierre clínico y auditoría
-- automática se implementarán en sus bloques; no se publican endpoints de escritura aquí.
