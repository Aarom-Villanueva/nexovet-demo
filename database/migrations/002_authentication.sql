-- Límites persistentes compartidos por todas las instancias de la API.
CREATE TABLE auth_rate_limits (
  key char(64) PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  window_ends_at timestamptz NOT NULL
);
CREATE INDEX auth_rate_limits_expiry_idx ON auth_rate_limits(window_ends_at);
CREATE INDEX user_sessions_expiry_idx ON user_sessions(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX password_reset_expiry_idx ON password_reset_tokens(expires_at) WHERE used_at IS NULL;
