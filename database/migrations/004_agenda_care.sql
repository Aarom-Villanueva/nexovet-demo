ALTER TABLE appointments ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE appointments ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE encounters ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE encounters ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Una consulta firmada conserva su contenido. El API no publica DELETE.
CREATE TRIGGER closed_encounter_immutable BEFORE UPDATE ON encounters
  FOR EACH ROW WHEN (OLD.closed_at IS NOT NULL) EXECUTE FUNCTION immutable_record();

CREATE FUNCTION ensure_encounter_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM appointments a WHERE a.id=NEW.appointment_id
    AND a.professional_id=NEW.veterinarian_id AND a.status='in_progress') THEN
    RAISE EXCEPTION 'La consulta debe corresponder al profesional y cita en atención' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER encounter_assignment BEFORE INSERT OR UPDATE OF appointment_id,veterinarian_id ON encounters
  FOR EACH ROW EXECUTE FUNCTION ensure_encounter_assignment();

CREATE FUNCTION protect_attended_appointment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM encounters WHERE appointment_id=OLD.id) AND
    (NEW.pet_id,NEW.professional_id,NEW.service_id,NEW.starts_at,NEW.ends_at)
      IS DISTINCT FROM (OLD.pet_id,OLD.professional_id,OLD.service_id,OLD.starts_at,OLD.ends_at) THEN
    RAISE EXCEPTION 'Una cita con atención conserva paciente, profesional y horario' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER attended_appointment BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION protect_attended_appointment();
