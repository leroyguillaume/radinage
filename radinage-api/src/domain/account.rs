use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

string_enum! {
    /// What an account is for: day-to-day money, or money set aside.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
    #[schemars(transform = crate::schema::flatten_string_enum)]
    #[serde(rename_all = "camelCase")]
    pub enum AccountKind ("account kind") {
        Checking => "checking",
        Savings => "savings",
    }
}

/// What a user sets on an account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountFields {
    pub name: String,
    pub kind: AccountKind,
    /// Whether the user imports the account's statements; only a checking account can be.
    pub imported: bool,
}

impl AccountFields {
    /// Only an imported checking account holds operations: its balance follows from them.
    pub fn receives_operations(&self) -> bool {
        self.kind == AccountKind::Checking && self.imported
    }
}

/// A balance read on an account at a date. Operations accounted on `date` are considered
/// already included in `amount`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountBalance {
    pub amount: Decimal,
    pub date: NaiveDate,
}

/// A balance kept in an account's history, at most one per date.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BalanceEntry {
    pub id: Uuid,
    pub balance: AccountBalance,
}

/// What an account gained (or lost, when negative) over one day, apart from its balances:
/// its operations when it receives them, what its savings budgets saved on a savings account.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DailyMovement {
    pub date: NaiveDate,
    pub amount: Decimal,
}

/// A bank account a user follows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub id: Uuid,
    pub user_id: Uuid,
    pub fields: AccountFields,
    /// Most recent balance read, the starting point of an account receiving operations.
    pub balance: Option<BalanceEntry>,
    /// Balance today: `balance`, plus every operation of the account dated after it when the
    /// account receives operations, ignored ones included since they still moved the money.
    /// On a savings account, the non-ignored amounts dated after it that are linked to its
    /// savings budgets, sign flipped: they left the account they are on to land here.
    /// `None` without a balance.
    pub current_balance: Option<Decimal>,
    /// Whether operations of other accounts are transfers with this one.
    pub transferred_into: bool,
    pub created_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields(kind: AccountKind, imported: bool) -> AccountFields {
        AccountFields {
            name: "Main".to_string(),
            kind,
            imported,
        }
    }

    #[test]
    fn kind_round_trips_through_its_string() {
        for kind in AccountKind::ALL {
            assert_eq!(kind.as_str().parse::<AccountKind>().as_ref(), Ok(kind));
            assert_eq!(
                serde_json::to_string(kind).unwrap(),
                format!("\"{}\"", kind.as_str())
            );
        }
        assert!("brokerage".parse::<AccountKind>().is_err());
    }

    #[test]
    fn only_an_imported_checking_account_receives_operations() {
        assert!(fields(AccountKind::Checking, true).receives_operations());
        assert!(!fields(AccountKind::Checking, false).receives_operations());
        assert!(!fields(AccountKind::Savings, false).receives_operations());
    }
}
