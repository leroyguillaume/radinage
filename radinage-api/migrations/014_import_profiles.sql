-- Named file layouts a user imports bank statements with, one per bank or export format.
CREATE TABLE import_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    label_col INTEGER NOT NULL CHECK (label_col >= 0),
    amount_col INTEGER NOT NULL CHECK (amount_col >= 0),
    date_col INTEGER NOT NULL CHECK (date_col >= 0),
    date_format TEXT NOT NULL,
    skip_lines INTEGER NOT NULL CHECK (skip_lines >= 0),
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT import_profiles_user_name_key UNIQUE (user_id, name)
);
