-- Foundation only. Run with a dedicated migration owner; no runtime grants are provided.
-- This migration does not implement farmer data access or ABAC/RLS.
CREATE SCHEMA authn;
REVOKE ALL ON SCHEMA authn FROM PUBLIC;

CREATE TABLE authn.account (
  id uuid PRIMARY KEY,
  login_name text NOT NULL UNIQUE CHECK (length(login_name) BETWEEN 1 AND 200),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  CHECK (active OR disabled_at IS NOT NULL)
);

CREATE TABLE authn.device (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES authn.account(id),
  state text NOT NULL CHECK (state IN ('pending', 'approved', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (id, account_id),
  CHECK (state <> 'approved' OR (approved_at IS NOT NULL AND revoked_at IS NULL)),
  CHECK (state <> 'pending' OR (approved_at IS NULL AND revoked_at IS NULL)),
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE TABLE authn.login_session (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES authn.account(id),
  device_id uuid,
  device_required boolean NOT NULL DEFAULT false,
  -- SHA-256 of a random cookie secret; never store the cookie value itself.
  cookie_secret_hash bytea NOT NULL UNIQUE CHECK (octet_length(cookie_secret_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE (id, account_id),
  FOREIGN KEY (device_id, account_id) REFERENCES authn.device(id, account_id),
  CHECK (NOT device_required OR device_id IS NOT NULL),
  CHECK (created_at < idle_expires_at AND idle_expires_at <= absolute_expires_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE authn.revocation_event (
  id uuid PRIMARY KEY,
  actor_account_id uuid REFERENCES authn.account(id),
  target_account_id uuid NOT NULL REFERENCES authn.account(id),
  session_id uuid,
  device_id uuid,
  FOREIGN KEY (session_id, target_account_id) REFERENCES authn.login_session(id, account_id),
  FOREIGN KEY (device_id, target_account_id) REFERENCES authn.device(id, account_id),
  kind text NOT NULL CHECK (kind IN ('session', 'device', 'account')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'account' AND session_id IS NULL AND device_id IS NULL) OR
         (kind = 'session' AND session_id IS NOT NULL AND device_id IS NULL) OR
         (kind = 'device' AND device_id IS NOT NULL AND session_id IS NULL))
);

REVOKE ALL ON ALL TABLES IN SCHEMA authn FROM PUBLIC;
