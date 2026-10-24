-- Bank accounts a user follows. Only an imported checking account holds operations, which come
-- from its statements; every other account is valued by its balances alone.
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('checking', 'savings')),
    imported BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT accounts_user_name_key UNIQUE (user_id, name),
    -- Target of the (account_id, user_id) foreign keys that keep rows on their owner's accounts.
    CONSTRAINT accounts_id_user_key UNIQUE (id, user_id),
    CONSTRAINT accounts_imported_checking_check CHECK (NOT imported OR kind = 'checking')
);

-- Balances read on an account, operations accounted on that date included. The latest one is
-- the starting point an imported checking account adds its later operations to.
CREATE TABLE account_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    date DATE NOT NULL,
    amount NUMERIC(15, 4) NOT NULL,
    CONSTRAINT account_balances_account_date_key UNIQUE (account_id, date)
);

-- Users with anything to carry over get one imported checking account holding it all.
INSERT INTO accounts (user_id, name, kind, imported)
SELECT
    u.id AS user_id,
    'Default' AS name,
    'checking' AS kind,
    TRUE AS imported
FROM users AS u
WHERE
    u.balance_date IS NOT NULL
    OR EXISTS (
        SELECT 1 FROM operations AS o
        WHERE o.user_id = u.id
    )
    OR EXISTS (
        SELECT 1 FROM import_profiles AS p
        WHERE p.user_id = u.id
    );

INSERT INTO account_balances (account_id, date, amount)
SELECT
    a.id,
    u.balance_date,
    u.balance_amount
FROM users AS u
INNER JOIN accounts AS a ON u.id = a.user_id
WHERE u.balance_date IS NOT NULL;

ALTER TABLE operations ADD COLUMN account_id UUID;

UPDATE operations AS o
SET account_id = a.id
FROM accounts AS a
WHERE o.user_id = a.user_id;

ALTER TABLE operations
ALTER COLUMN account_id SET NOT NULL,
ADD CONSTRAINT operations_account_fkey FOREIGN KEY (account_id, user_id)
REFERENCES accounts (id, user_id);

CREATE INDEX operations_account_id_idx ON operations (account_id);

ALTER TABLE import_profiles ADD COLUMN account_id UUID;

UPDATE import_profiles AS p
SET account_id = a.id
FROM accounts AS a
WHERE p.user_id = a.user_id;

ALTER TABLE import_profiles
ALTER COLUMN account_id SET NOT NULL,
ADD CONSTRAINT import_profiles_account_fkey FOREIGN KEY (account_id, user_id)
REFERENCES accounts (id, user_id);

ALTER TABLE users
DROP CONSTRAINT users_balance_complete,
DROP COLUMN balance_amount,
DROP COLUMN balance_date;
