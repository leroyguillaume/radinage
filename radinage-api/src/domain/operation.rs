use chrono::NaiveDate;
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: Uuid,
    pub user_id: Uuid,
    pub amount: Decimal,
    pub date: NaiveDate,
    /// Optional override date used to attribute the operation to a different month.
    pub effective_date: Option<NaiveDate>,
    pub label: String,
    pub budget_link: BudgetLink,
    pub ignored: bool,
    /// Parts the operation is split into, ordered by position; empty when not split.
    pub splits: Vec<OperationSplit>,
}

impl Operation {
    /// The date to use for month attribution: `effective_date` if set, otherwise `date`.
    pub fn accounting_date(&self) -> NaiveDate {
        self.effective_date.unwrap_or(self.date)
    }

    /// A split operation is accounted through its parts, never through its own budget link.
    pub fn is_split(&self) -> bool {
        !self.splits.is_empty()
    }
}

/// One part of a split operation, sharing the operation's dates and ignored flag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationSplit {
    pub id: Uuid,
    pub amount: Decimal,
    pub budget_id: Option<Uuid>,
}

/// A part to store when (re)splitting an operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewOperationSplit {
    pub amount: Decimal,
    pub budget_id: Option<Uuid>,
}

/// Highest number of decimal places the `NUMERIC(15, 4)` amount column stores exactly.
const MAX_AMOUNT_SCALE: u32 = 4;

/// Why a set of parts cannot split an operation. Part numbers are 1-based.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum SplitError {
    #[error("a split needs at least 2 parts")]
    TooFewParts,
    #[error("part {0} amount must not be zero")]
    ZeroAmount(usize),
    #[error("part {0} amount must have the same sign as the operation amount")]
    SignMismatch(usize),
    #[error("part {0} amount must have at most 4 decimal places")]
    TooPrecise(usize),
    #[error("parts sum to {actual} but the operation amount is {expected}")]
    SumMismatch { expected: Decimal, actual: Decimal },
}

/// Check that `parts` can split an operation of `amount`: at least two non-zero parts of the
/// operation's sign, summing exactly to it.
pub fn validate_splits(amount: Decimal, parts: &[NewOperationSplit]) -> Result<(), SplitError> {
    if parts.len() < 2 {
        return Err(SplitError::TooFewParts);
    }
    for (index, part) in parts.iter().enumerate() {
        let number = index + 1;
        if part.amount.is_zero() {
            return Err(SplitError::ZeroAmount(number));
        }
        if amount.is_zero() || part.amount.is_sign_negative() != amount.is_sign_negative() {
            return Err(SplitError::SignMismatch(number));
        }
        if part.amount.normalize().scale() > MAX_AMOUNT_SCALE {
            return Err(SplitError::TooPrecise(number));
        }
    }
    let actual: Decimal = parts.iter().map(|p| p.amount).sum();
    if actual != amount {
        return Err(SplitError::SumMismatch {
            expected: amount.normalize(),
            actual: actual.normalize(),
        });
    }
    Ok(())
}

/// How an operation is linked to a budget category. Discriminated by the `type` field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BudgetLink {
    /// The operation is not linked to any budget.
    Unlinked,
    /// The operation was manually linked to a budget by the user.
    Manual {
        /// Identifier of the linked budget.
        #[serde(rename = "budgetId")]
        budget_id: Uuid,
    },
    /// The operation was automatically linked by a budget's matching rules.
    Auto {
        /// Identifier of the linked budget.
        #[serde(rename = "budgetId")]
        budget_id: Uuid,
    },
}

impl BudgetLink {
    pub fn is_manual(&self) -> bool {
        matches!(self, BudgetLink::Manual { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn parts(amounts: &[Decimal]) -> Vec<NewOperationSplit> {
        amounts
            .iter()
            .map(|&amount| NewOperationSplit {
                amount,
                budget_id: None,
            })
            .collect()
    }

    #[test]
    fn validate_splits_accepts_exact_sum() {
        assert_eq!(
            validate_splits(dec!(-100), &parts(&[dec!(-30), dec!(-30), dec!(-40)])),
            Ok(())
        );
    }

    #[test]
    fn validate_splits_accepts_positive_operation() {
        assert_eq!(
            validate_splits(dec!(10.50), &parts(&[dec!(0.25), dec!(10.25)])),
            Ok(())
        );
    }

    #[test]
    fn validate_splits_rejects_sum_mismatch() {
        assert_eq!(
            validate_splits(dec!(-100), &parts(&[dec!(-30), dec!(-30), dec!(-39.99)])),
            Err(SplitError::SumMismatch {
                expected: dec!(-100),
                actual: dec!(-99.99),
            })
        );
    }

    #[test]
    fn validate_splits_rejects_sign_mismatch() {
        assert_eq!(
            validate_splits(dec!(-100), &parts(&[dec!(-120), dec!(20)])),
            Err(SplitError::SignMismatch(2))
        );
    }

    #[test]
    fn validate_splits_rejects_zero_part() {
        assert_eq!(
            validate_splits(dec!(-100), &parts(&[dec!(-100), dec!(0)])),
            Err(SplitError::ZeroAmount(2))
        );
    }

    #[test]
    fn validate_splits_rejects_fewer_than_two_parts() {
        assert_eq!(
            validate_splits(dec!(-100), &parts(&[dec!(-100)])),
            Err(SplitError::TooFewParts)
        );
        assert_eq!(
            validate_splits(dec!(-100), &[]),
            Err(SplitError::TooFewParts)
        );
    }

    #[test]
    fn validate_splits_rejects_zero_operation() {
        assert_eq!(
            validate_splits(Decimal::ZERO, &parts(&[dec!(-1), dec!(1)])),
            Err(SplitError::SignMismatch(1))
        );
    }

    #[test]
    fn validate_splits_rejects_more_than_four_decimals() {
        assert_eq!(
            validate_splits(dec!(-1), &parts(&[dec!(-0.33333), dec!(-0.66667)])),
            Err(SplitError::TooPrecise(1))
        );
    }

    #[test]
    fn validate_splits_ignores_trailing_zeros_in_scale() {
        assert_eq!(
            validate_splits(dec!(-1), &parts(&[dec!(-0.500000), dec!(-0.5)])),
            Ok(())
        );
    }

    #[test]
    fn is_split_reflects_parts() {
        let mut op = Operation {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            amount: dec!(-10),
            date: NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
            effective_date: None,
            label: "Op".to_string(),
            budget_link: BudgetLink::Unlinked,
            ignored: false,
            splits: vec![],
        };
        assert!(!op.is_split());
        op.splits.push(OperationSplit {
            id: Uuid::nil(),
            amount: dec!(-10),
            budget_id: None,
        });
        assert!(op.is_split());
    }

    #[test]
    fn unlinked_is_not_manual() {
        assert!(!BudgetLink::Unlinked.is_manual());
    }

    #[test]
    fn manual_is_manual() {
        assert!(
            BudgetLink::Manual {
                budget_id: Uuid::new_v4()
            }
            .is_manual()
        );
    }

    #[test]
    fn auto_is_not_manual() {
        assert!(
            !BudgetLink::Auto {
                budget_id: Uuid::new_v4()
            }
            .is_manual()
        );
    }

    #[test]
    fn budget_link_serializes_budget_id_as_camel_case() {
        let id = Uuid::nil();
        let manual = BudgetLink::Manual { budget_id: id };
        let json = serde_json::to_string(&manual).unwrap();
        assert!(
            json.contains("\"budgetId\""),
            "expected budgetId in JSON: {json}"
        );
        assert!(
            !json.contains("\"budget_id\""),
            "unexpected budget_id in JSON: {json}"
        );

        let auto = BudgetLink::Auto { budget_id: id };
        let json = serde_json::to_string(&auto).unwrap();
        assert!(
            json.contains("\"budgetId\""),
            "expected budgetId in JSON: {json}"
        );
    }

    #[test]
    fn budget_link_deserializes_from_camel_case() {
        let json = r#"{"type":"manual","budgetId":"00000000-0000-0000-0000-000000000000"}"#;
        let link: BudgetLink = serde_json::from_str(json).unwrap();
        assert!(matches!(link, BudgetLink::Manual { .. }));
    }
}
