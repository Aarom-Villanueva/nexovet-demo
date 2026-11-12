ALTER TABLE sales ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version>0);
ALTER TABLE sales ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sales ADD COLUMN note text NOT NULL DEFAULT '';
ALTER TABLE sales ADD COLUMN client_name text;
ALTER TABLE sales ADD COLUMN confirmed_by uuid REFERENCES users(id);
ALTER TABLE sales ADD COLUMN request_id uuid UNIQUE;
ALTER TABLE sales ADD COLUMN request_fingerprint char(64);
ALTER TABLE sales ADD COLUMN confirm_request_id uuid UNIQUE;
ALTER TABLE sales ADD COLUMN confirm_fingerprint char(64);
ALTER TABLE sales ADD CONSTRAINT sale_request_pair CHECK ((request_id IS NULL)=(request_fingerprint IS NULL));
ALTER TABLE sales ADD CONSTRAINT sale_confirm_request_pair CHECK ((confirm_request_id IS NULL)=(confirm_fingerprint IS NULL));
ALTER TABLE sales ADD CONSTRAINT sale_confirmer CHECK (status<>'confirmed' OR confirmed_by IS NOT NULL);
ALTER TABLE sale_lines ADD COLUMN sku_snapshot text;
CREATE SEQUENCE sale_number_seq;
CREATE INDEX sales_created_idx ON sales(created_at DESC,id);
CREATE INDEX sales_client_idx ON sales(client_id);
CREATE UNIQUE INDEX sale_product_once ON sale_lines(sale_id,product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX sale_service_once ON sale_lines(sale_id,service_id) WHERE service_id IS NOT NULL;
CREATE FUNCTION protect_final_sale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'draft' THEN RAISE EXCEPTION 'La venta finalizada es de solo lectura' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER final_sale_immutable BEFORE UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION protect_final_sale();
CREATE FUNCTION protect_sale_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent uuid; state text;
BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM sale_lines WHERE id=NEW.id) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.sale_id<>OLD.sale_id THEN RAISE EXCEPTION 'No se transfieren líneas entre ventas' USING ERRCODE='23514'; END IF;
 parent:=CASE WHEN TG_OP='DELETE' THEN OLD.sale_id ELSE NEW.sale_id END;
 SELECT status INTO state FROM sales WHERE id=parent FOR UPDATE;
 IF state<>'draft' THEN RAISE EXCEPTION 'Solo se modifican líneas de borradores' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER sale_line_draft BEFORE INSERT OR UPDATE OR DELETE ON sale_lines FOR EACH ROW EXECUTE FUNCTION protect_sale_line();
CREATE FUNCTION payment_for_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 SELECT status INTO state FROM sales WHERE id=NEW.sale_id FOR UPDATE;
 IF state<>'draft' THEN RAISE EXCEPTION 'Los pagos se registran al confirmar el borrador' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER payment_draft BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION payment_for_draft();
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE FUNCTION check_confirmed_sale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total numeric; paid numeric; count_lines integer;
BEGIN
 IF NEW.status<>'confirmed' THEN RETURN NULL; END IF;
 SELECT coalesce(sum(line_total),0),count(*) INTO total,count_lines FROM sale_lines WHERE sale_id=NEW.id;
 SELECT coalesce(sum(amount),0) INTO paid FROM payments WHERE sale_id=NEW.id;
 IF count_lines=0 OR total<>paid THEN
  RAISE EXCEPTION 'La venta confirmada requiere líneas y cobros conciliados' USING ERRCODE='23514',CONSTRAINT='sale_confirm_integrity';
 END IF;
 IF EXISTS(SELECT 1 FROM sale_lines l LEFT JOIN stock_movements m ON m.sale_line_id=l.id WHERE l.sale_id=NEW.id AND l.product_id IS NOT NULL AND (m.id IS NULL OR m.kind<>'sale' OR m.quantity<>-l.quantity)) THEN
  RAISE EXCEPTION 'La venta requiere una salida exacta por producto' USING ERRCODE='23514',CONSTRAINT='sale_confirm_integrity';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER sale_confirm_integrity AFTER INSERT OR UPDATE ON sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_confirmed_sale();
