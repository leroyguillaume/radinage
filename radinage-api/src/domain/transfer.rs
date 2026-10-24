use super::{account::AccountKind, budget::LabelPattern, operation::Operation};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An operation's transfer with another account of its owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    /// The other account: where the money went, or where it came from.
    pub account_id: Uuid,
    pub account_kind: AccountKind,
    /// Rule that made the operation a transfer; `None` when set by hand or by pairing.
    pub rule_id: Option<Uuid>,
    /// The operation on the other side, when the other account receives operations too.
    pub operation_id: Option<Uuid>,
}

/// How a transfer counts, from the side of the account the operation is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferFlow {
    /// Money put on a savings account: saved.
    ToSavings,
    /// Money taken back from a savings account: deducted from what is saved.
    FromSavings,
    /// Money moved to or from a checking account: neither income, expense nor savings.
    Internal,
}

impl TransferFlow {
    /// The flow of an `amount` transferred with an account of `kind`.
    pub fn of(kind: AccountKind, amount: Decimal) -> Self {
        match kind {
            AccountKind::Savings if amount.is_sign_negative() => Self::ToSavings,
            AccountKind::Savings => Self::FromSavings,
            AccountKind::Checking => Self::Internal,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferRule {
    pub id: Uuid,
    pub user_id: Uuid,
    pub fields: TransferRuleFields,
    pub created_at: DateTime<Utc>,
}

/// What a user chooses for a transfer rule, as written on creation or update.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferRuleFields {
    /// Account whose operations the rule applies to.
    pub account_id: Uuid,
    /// Account the operations it matches are transfers with.
    pub counterpart_account_id: Uuid,
    pub label_pattern: LabelPattern,
}

impl TransferRuleFields {
    pub fn matches(&self, op: &Operation) -> bool {
        op.account_id == self.account_id && self.label_pattern.matches(&op.label)
    }
}

/// The first of `rules` that matches the operation.
pub fn first_match<'a>(rules: &'a [TransferRule], op: &Operation) -> Option<&'a TransferRule> {
    rules.iter().find(|rule| rule.fields.matches(op))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::operation::BudgetLink;
    use chrono::NaiveDate;
    use rust_decimal_macros::dec;

    fn op(account_id: Uuid, label: &str) -> Operation {
        Operation {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            account_id,
            amount: dec!(-300),
            date: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
            effective_date: None,
            label: label.to_string(),
            budget_link: BudgetLink::Unlinked,
            ignored: false,
            ignore_rule_id: None,
            category_id: None,
            budget_category_id: None,
            transfer: None,
            splits: vec![],
        }
    }

    fn rule(account_id: Uuid, value: &str) -> TransferRule {
        TransferRule {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            fields: TransferRuleFields {
                account_id,
                counterpart_account_id: Uuid::new_v4(),
                label_pattern: LabelPattern::Contains(value.to_string()),
            },
            created_at: Utc::now(),
        }
    }

    #[test]
    fn flow_follows_the_other_account_and_the_sign() {
        assert_eq!(
            TransferFlow::of(AccountKind::Savings, dec!(-300)),
            TransferFlow::ToSavings
        );
        assert_eq!(
            TransferFlow::of(AccountKind::Savings, dec!(500)),
            TransferFlow::FromSavings
        );
        assert_eq!(
            TransferFlow::of(AccountKind::Checking, dec!(-450)),
            TransferFlow::Internal
        );
        assert_eq!(
            TransferFlow::of(AccountKind::Checking, dec!(450)),
            TransferFlow::Internal
        );
    }

    #[test]
    fn a_rule_matches_the_label_on_its_own_account_only() {
        let checking = Uuid::new_v4();
        let rules = [rule(Uuid::new_v4(), "livret a"), rule(checking, "livret a")];
        let matched = first_match(&rules, &op(checking, "VIR INTERNE VERS LIVRET A"));
        assert_eq!(matched.map(|r| r.id), Some(rules[1].id));
        assert!(first_match(&rules, &op(checking, "CB CARREFOUR")).is_none());
    }
}
