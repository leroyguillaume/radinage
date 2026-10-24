-- Rules that make transfers between two accounts of the same user, tried oldest first: the
-- operations of the account whose label matches the pattern, and, when the other account
-- receives operations too, those of the other account whose label matches its own pattern.
-- They go with either account.
CREATE TABLE transfer_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    counterpart_account_id UUID NOT NULL,
    pattern_type TEXT NOT NULL CHECK (pattern_type IN ('starts_with', 'ends_with', 'contains')),
    pattern_value TEXT NOT NULL,
    counterpart_pattern_type TEXT CHECK (
        counterpart_pattern_type IN ('starts_with', 'ends_with', 'contains')
    ),
    counterpart_pattern_value TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT transfer_rules_counterpart_pattern_check CHECK (
        (counterpart_pattern_type IS NULL) = (counterpart_pattern_value IS NULL)
    ),
    CONSTRAINT transfer_rules_account_fkey FOREIGN KEY (account_id, user_id)
    REFERENCES accounts (id, user_id) ON DELETE CASCADE,
    CONSTRAINT transfer_rules_counterpart_fkey FOREIGN KEY (counterpart_account_id, user_id)
    REFERENCES accounts (id, user_id) ON DELETE CASCADE,
    CONSTRAINT transfer_rules_accounts_check CHECK (account_id <> counterpart_account_id)
);

CREATE INDEX transfer_rules_user_id_idx ON transfer_rules (user_id);

-- A transfer names the other account, the rule that made it one (NULL when set by hand or by
-- pairing) and, between two accounts receiving operations, the operation on the other side.
ALTER TABLE operations
ADD COLUMN transfer_account_id UUID,
ADD COLUMN transfer_rule_id UUID REFERENCES transfer_rules (id) ON DELETE SET NULL,
ADD COLUMN transfer_operation_id UUID REFERENCES operations (id) ON DELETE SET NULL,
ADD CONSTRAINT operations_transfer_account_fkey FOREIGN KEY (transfer_account_id, user_id)
REFERENCES accounts (id, user_id),
ADD CONSTRAINT operations_transfer_other_account_check CHECK (
    transfer_account_id <> account_id
),
ADD CONSTRAINT operations_transfer_details_check CHECK (
    transfer_account_id IS NOT NULL
    OR (transfer_rule_id IS NULL AND transfer_operation_id IS NULL)
);

CREATE INDEX operations_transfer_account_id_idx ON operations (transfer_account_id);

-- An operation is the other side of one transfer at most.
CREATE UNIQUE INDEX operations_transfer_operation_id_key ON operations (transfer_operation_id);
