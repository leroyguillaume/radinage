-- Invitation and reset tokens are stored as a SHA-256 with an expiry, never as is.
-- Dropping the plain-text column invalidates pending links: an admin reissues them with a reset.
ALTER TABLE users DROP COLUMN invitation_token;

ALTER TABLE users
ADD COLUMN invitation_token_hash BYTEA,
ADD COLUMN invitation_expires_at TIMESTAMPTZ,
ADD CONSTRAINT users_invitation_expiry_check CHECK (
    (invitation_token_hash IS NULL) = (invitation_expires_at IS NULL)
);

CREATE UNIQUE INDEX users_invitation_token_hash_idx ON users (invitation_token_hash)
WHERE invitation_token_hash IS NOT NULL;
