BEGIN;

ALTER TABLE otp_verifications
  DROP CONSTRAINT IF EXISTS otp_verifications_purpose_check,
  ADD CONSTRAINT otp_verifications_purpose_check
    CHECK (purpose IN ('REGISTER', 'LOGIN', 'PASSWORD_RESET', 'DELIVERY', 'PICKUP', 'PHONE_CHANGE', 'EMAIL_CHANGE', 'PARTNER_SETUP', 'PARTNER_RESET'));

CREATE TABLE partner_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE partner_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('SETUP', 'RESET')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  password_set_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX partner_invites_member_idx
  ON partner_invites (partner_id, user_id, created_at DESC);
CREATE INDEX partner_invites_expiry_idx
  ON partner_invites (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE partner_password_login_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone_e164 varchar(16) NOT NULL,
  request_ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_password_login_attempts_time_idx
  ON partner_password_login_attempts (created_at);

COMMIT;
