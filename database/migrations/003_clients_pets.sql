-- Control optimista: una edición antigua no sobrescribe una edición posterior.
ALTER TABLE clients ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE clients ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pets ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE pets ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
