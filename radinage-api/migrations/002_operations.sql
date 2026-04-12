CREATE TABLE operations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount           NUMERIC(15, 4) NOT NULL,
    date             DATE NOT NULL,
    label            TEXT NOT NULL,
    budget_link_type TEXT NOT NULL DEFAULT 'unlinked'
                     CHECK (budget_link_type IN ('unlinked', 'manual', 'auto')),
    budget_link_id   UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX operations_user_id_idx ON operations(user_id);
CREATE INDEX operations_date_idx ON operations(date);
