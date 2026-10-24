-- Whether statistics net a category's amounts, a refund offsetting the spending it refunds,
-- rather than summing its income and expenses apart.
ALTER TABLE categories ADD COLUMN net_totals BOOLEAN NOT NULL DEFAULT FALSE;
