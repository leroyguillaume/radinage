-- Add an optional invitation token to users.
-- When set, the user has not yet activated their account (no password chosen).
ALTER TABLE users ADD COLUMN invitation_token UUID;
CREATE UNIQUE INDEX users_invitation_token_idx ON users (invitation_token) WHERE invitation_token IS NOT NULL;
