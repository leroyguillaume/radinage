use chrono::NaiveDate;
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
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
}

impl Operation {
    /// The date to use for month attribution: `effective_date` if set, otherwise `date`.
    pub fn accounting_date(&self) -> NaiveDate {
        self.effective_date.unwrap_or(self.date)
    }
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
