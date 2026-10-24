-- Rules that ignore the operations whose label, and optionally amount, they match.
CREATE TABLE ignore_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    pattern_type TEXT NOT NULL CHECK (pattern_type IN ('starts_with', 'ends_with', 'contains')),
    pattern_value TEXT NOT NULL,
    amount NUMERIC(15, 4) CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ignore_rules_user_id_idx ON ignore_rules (user_id);

-- The rule that ignored the operation; NULL when it is ignored by hand or not at all.
ALTER TABLE operations
ADD COLUMN ignore_rule_id UUID REFERENCES ignore_rules (id) ON DELETE SET NULL,
ADD CONSTRAINT operations_ignore_rule_ignored_check CHECK (ignore_rule_id IS NULL OR ignored);

CREATE INDEX operations_ignore_rule_id_idx ON operations (ignore_rule_id);
