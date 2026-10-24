-- The savings account a savings budget's money goes to: what is linked to the budget after the
-- account's latest balance adds up to its current balance. Deleting the account unlinks it.
ALTER TABLE budgets
ADD COLUMN account_id UUID,
ADD CONSTRAINT budgets_account_fkey FOREIGN KEY (account_id, user_id)
REFERENCES accounts (id, user_id) ON DELETE SET NULL (account_id),
ADD CONSTRAINT budgets_account_savings_check CHECK (
    account_id IS NULL OR budget_type = 'savings'
);

CREATE INDEX budgets_account_id_idx ON budgets (account_id);
