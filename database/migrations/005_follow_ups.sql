ALTER TABLE follow_up_tasks ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE follow_up_tasks ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE follow_up_tasks ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE follow_up_tasks ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE INDEX tasks_assignee_due_idx ON follow_up_tasks(assigned_to,due_at,id);

ALTER TABLE contact_events ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE contact_events ADD COLUMN request_id uuid UNIQUE;
ALTER TABLE contact_events ADD COLUMN request_fingerprint char(64);
ALTER TABLE contact_events ADD CONSTRAINT contact_request_pair CHECK ((request_id IS NULL) = (request_fingerprint IS NULL));
ALTER TABLE contact_events ADD CONSTRAINT contact_outcome CHECK (outcome IN ('contacted','no_answer','rescheduled','declined','wrong_contact','other'));
-- Los eventos se corrigen con otro registro; no se editan desde la aplicación.
CREATE TRIGGER contact_event_immutable BEFORE UPDATE ON contact_events FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE INDEX contact_events_task_idx ON contact_events(task_id,occurred_at DESC,id);
