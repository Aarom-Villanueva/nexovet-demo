ALTER TABLE products ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE products ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE suppliers ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE suppliers ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE suppliers ADD COLUMN address text;
ALTER TABLE purchase_orders ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE purchase_orders ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE purchase_orders ADD COLUMN note text NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN received_by uuid REFERENCES users(id);
ALTER TABLE purchase_orders ADD COLUMN request_id uuid UNIQUE;
ALTER TABLE purchase_orders ADD COLUMN request_fingerprint char(64);
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_request_pair CHECK ((request_id IS NULL) = (request_fingerprint IS NULL));
CREATE SEQUENCE purchase_number_seq;
CREATE INDEX purchases_date_idx ON purchase_orders(ordered_at DESC,id);
CREATE INDEX purchases_supplier_idx ON purchase_orders(supplier_id);
CREATE INDEX purchase_lines_order_idx ON purchase_order_lines(purchase_order_id);
CREATE UNIQUE INDEX products_sku_folded ON products(lower(sku));
ALTER TABLE stock_movements ADD COLUMN request_id uuid UNIQUE;
ALTER TABLE stock_movements ADD COLUMN request_fingerprint char(64);
ALTER TABLE stock_movements ADD CONSTRAINT stock_request_pair CHECK ((request_id IS NULL) = (request_fingerprint IS NULL));

CREATE FUNCTION protect_final_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'La compra finalizada es de solo lectura' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER final_purchase_immutable BEFORE UPDATE OR DELETE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION protect_final_purchase();
CREATE FUNCTION protect_purchase_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent uuid; state text;
BEGIN
  -- Un INSERT repetido de la semilla no modifica una línea existente.
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM purchase_order_lines WHERE id=NEW.id) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.purchase_order_id<>OLD.purchase_order_id THEN
    RAISE EXCEPTION 'No se transfieren líneas entre compras' USING ERRCODE='23514';
  END IF;
  parent := CASE WHEN TG_OP='DELETE' THEN OLD.purchase_order_id ELSE NEW.purchase_order_id END;
  SELECT status INTO state FROM purchase_orders WHERE id=parent FOR UPDATE;
  IF state <> 'draft' THEN RAISE EXCEPTION 'Solo se modifican líneas de borradores' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_line_draft BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_lines FOR EACH ROW EXECUTE FUNCTION protect_purchase_line();
-- Identificación visible del documento recibido, aunque luego se renombre el catálogo.
ALTER TABLE purchase_orders ADD COLUMN supplier_snapshot text;
ALTER TABLE purchase_order_lines ADD COLUMN product_sku text;
ALTER TABLE purchase_order_lines ADD COLUMN product_name text;
