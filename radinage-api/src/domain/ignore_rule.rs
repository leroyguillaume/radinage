use super::{budget::LabelPattern, operation::Operation};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IgnoreRule {
    pub id: Uuid,
    pub user_id: Uuid,
    pub fields: IgnoreRuleFields,
    pub created_at: DateTime<Utc>,
}

/// What a user chooses for an ignore rule, as written on creation or update.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IgnoreRuleFields {
    pub label_pattern: LabelPattern,
    /// Positive amount the operation's amount must equal, whatever its sign; `None` matches any.
    pub amount: Option<Decimal>,
}

impl IgnoreRuleFields {
    pub fn matches(&self, op: &Operation) -> bool {
        self.label_pattern.matches(&op.label) && self.amount.is_none_or(|a| op.amount.abs() == a)
    }
}

/// The first of `rules` that matches the operation.
pub fn first_match<'a>(rules: &'a [IgnoreRule], op: &Operation) -> Option<&'a IgnoreRule> {
    rules.iter().find(|rule| rule.fields.matches(op))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::operation::BudgetLink;
    use chrono::NaiveDate;
    use rust_decimal_macros::dec;

    fn op(label: &str, amount: Decimal) -> Operation {
        Operation {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            amount,
            date: NaiveDate::from_ymd_opt(2026, 10, 14).unwrap(),
            effective_date: None,
            label: label.to_string(),
            budget_link: BudgetLink::Unlinked,
            ignored: false,
            ignore_rule_id: None,
            category_id: None,
            budget_category_id: None,
            splits: vec![],
        }
    }

    fn rule(label_pattern: LabelPattern, amount: Option<Decimal>) -> IgnoreRule {
        IgnoreRule {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            fields: IgnoreRuleFields {
                label_pattern,
                amount,
            },
            created_at: Utc::now(),
        }
    }

    #[test]
    fn matches_label_case_insensitively() {
        let fields = rule(LabelPattern::Contains("vir interne".into()), None).fields;
        assert!(fields.matches(&op("VIR INTERNE VERS LIVRET A", dec!(-500))));
        assert!(!fields.matches(&op("CB AMAZON", dec!(-500))));
    }

    #[test]
    fn amount_matches_either_sign() {
        let fields = rule(LabelPattern::StartsWith("REMB".into()), Some(dec!(250))).fields;
        assert!(fields.matches(&op("REMB AVANCE", dec!(250))));
        assert!(fields.matches(&op("REMB AVANCE", dec!(-250.00))));
        assert!(!fields.matches(&op("REMB AVANCE", dec!(-249.99))));
    }

    #[test]
    fn first_match_keeps_rule_order() {
        let rules = [
            rule(LabelPattern::EndsWith("LOYER".into()), None),
            rule(LabelPattern::Contains("VIR".into()), None),
            rule(LabelPattern::Contains("VIR INTERNE".into()), None),
        ];
        let found = first_match(&rules, &op("VIR INTERNE", dec!(-10)));
        assert_eq!(found.map(|r| r.id), Some(rules[1].id));
        assert!(first_match(&rules, &op("CB", dec!(-10))).is_none());
    }
}
