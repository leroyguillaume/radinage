use crate::domain::{
    budget::{Budget, BudgetKind, YearMonth},
    operation::Operation,
};
use chrono::Datelike;
use rust_decimal::Decimal;
use uuid::Uuid;

/// Evaluates budget matching rules against an operation.
///
/// Returns the id of the first budget whose rules match the operation, or `None`.
pub trait MatcherService {
    fn match_operation(&self, op: &Operation, budgets: &[Budget]) -> Option<Uuid>;
}

pub struct MatcherServiceImpl;

impl MatcherService for MatcherServiceImpl {
    fn match_operation(&self, op: &Operation, budgets: &[Budget]) -> Option<Uuid> {
        for budget in budgets {
            if !Self::date_in_budget(op, &budget.kind) {
                continue;
            }
            for rule in &budget.rules {
                if !rule.label_pattern.matches(&op.label) {
                    continue;
                }
                if rule.match_amount {
                    let expected = Self::period_amount_at(op, &budget.kind);
                    if expected != Some(op.amount) {
                        continue;
                    }
                }
                return Some(budget.id);
            }
        }
        None
    }
}

impl MatcherServiceImpl {
    fn op_year_month(op: &Operation) -> YearMonth {
        let d = op.accounting_date();
        YearMonth::new(d.year(), d.month())
    }

    /// Check whether the operation date falls within any period of the budget.
    fn date_in_budget(op: &Operation, kind: &BudgetKind) -> bool {
        let ym = Self::op_year_month(op);
        match kind {
            BudgetKind::Recurring {
                closed_periods,
                current_period,
                ..
            } => {
                let in_closed = closed_periods.iter().any(|p| ym >= p.start && ym <= p.end);
                let in_current =
                    ym >= current_period.start && current_period.end.is_none_or(|end| ym <= end);
                in_closed || in_current
            }
            BudgetKind::Occasional { month, year, .. } => {
                ym.month == *month && ym.year as u32 == *year
            }
        }
    }

    /// Return the budget amount for the period covering the operation date.
    fn period_amount_at(op: &Operation, kind: &BudgetKind) -> Option<Decimal> {
        let ym = Self::op_year_month(op);
        match kind {
            BudgetKind::Recurring {
                closed_periods,
                current_period,
                ..
            } => {
                let from_closed = closed_periods
                    .iter()
                    .find(|p| ym >= p.start && ym <= p.end)
                    .map(|p| p.amount);
                from_closed.or_else(|| {
                    let in_current = ym >= current_period.start
                        && current_period.end.is_none_or(|end| ym <= end);
                    in_current.then_some(current_period.amount)
                })
            }
            BudgetKind::Occasional {
                month,
                year,
                amount,
            } => {
                let matches = ym.month == *month && ym.year as u32 == *year;
                matches.then_some(*amount)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::budget::{
        BudgetType, CurrentPeriod, LabelPattern, Recurrence, Rule, YearMonth,
    };
    use chrono::NaiveDate;
    use rust_decimal::Decimal;
    use uuid::Uuid;

    fn make_budget(kind: BudgetKind, rules: Vec<Rule>) -> Budget {
        Budget {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            label: "Test".to_string(),
            budget_type: BudgetType::Expense,
            kind,
            rules,
            created_at: chrono::Utc::now(),
        }
    }

    fn make_op(label: &str, amount: Decimal, date: NaiveDate) -> Operation {
        Operation {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            amount,
            date,
            label: label.to_string(),
            effective_date: None,
            budget_link: crate::domain::operation::BudgetLink::Unlinked,
            ignored: false,
        }
    }

    #[test]
    fn matches_by_label_contains() {
        let budget = make_budget(
            BudgetKind::Occasional {
                month: 1,
                year: 2024,
                amount: Decimal::new(100, 0),
            },
            vec![Rule {
                label_pattern: LabelPattern::Contains("AMAZON".to_string()),
                match_amount: false,
            }],
        );
        let op = make_op(
            "PRLV AMAZON EU",
            Decimal::new(50, 0),
            NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(
            matcher.match_operation(&op, std::slice::from_ref(&budget)),
            Some(budget.id)
        );
    }

    #[test]
    fn no_match_when_label_doesnt_match() {
        let budget = make_budget(
            BudgetKind::Occasional {
                month: 1,
                year: 2024,
                amount: Decimal::new(100, 0),
            },
            vec![Rule {
                label_pattern: LabelPattern::StartsWith("EDF".to_string()),
                match_amount: false,
            }],
        );
        let op = make_op(
            "PRLV AMAZON",
            Decimal::new(100, 0),
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(matcher.match_operation(&op, &[budget]), None);
    }

    #[test]
    fn match_amount_false_ignores_amount() {
        let budget = make_budget(
            BudgetKind::Occasional {
                month: 1,
                year: 2024,
                amount: Decimal::new(200, 0),
            },
            vec![Rule {
                label_pattern: LabelPattern::Contains("EDF".to_string()),
                match_amount: false,
            }],
        );
        let op = make_op(
            "PRLV EDF",
            Decimal::new(150, 0), // different from budget amount
            NaiveDate::from_ymd_opt(2024, 1, 5).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(
            matcher.match_operation(&op, std::slice::from_ref(&budget)),
            Some(budget.id)
        );
    }

    #[test]
    fn match_amount_true_requires_exact_occasional_amount() {
        let budget = make_budget(
            BudgetKind::Occasional {
                month: 1,
                year: 2024,
                amount: Decimal::new(200, 0),
            },
            vec![Rule {
                label_pattern: LabelPattern::Contains("EDF".to_string()),
                match_amount: true,
            }],
        );
        let op_wrong = make_op(
            "PRLV EDF",
            Decimal::new(150, 0),
            NaiveDate::from_ymd_opt(2024, 1, 5).unwrap(),
        );
        let op_right = make_op(
            "PRLV EDF",
            Decimal::new(200, 0),
            NaiveDate::from_ymd_opt(2024, 1, 5).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(
            matcher.match_operation(&op_wrong, std::slice::from_ref(&budget)),
            None
        );
        assert_eq!(
            matcher.match_operation(&op_right, std::slice::from_ref(&budget)),
            Some(budget.id)
        );
    }

    #[test]
    fn match_amount_true_recurring_uses_period_amount() {
        let budget = make_budget(
            BudgetKind::Recurring {
                recurrence: Recurrence::Monthly,
                closed_periods: vec![],
                current_period: CurrentPeriod {
                    start: YearMonth::new(2024, 1),
                    end: Some(YearMonth::new(2024, 12)),
                    amount: Decimal::new(1000, 0),
                },
            },
            vec![Rule {
                label_pattern: LabelPattern::StartsWith("SALAIRE".to_string()),
                match_amount: true,
            }],
        );
        let op_right = make_op(
            "SALAIRE JANVIER",
            Decimal::new(1000, 0),
            NaiveDate::from_ymd_opt(2024, 1, 31).unwrap(),
        );
        let op_wrong = make_op(
            "SALAIRE JANVIER",
            Decimal::new(999, 0),
            NaiveDate::from_ymd_opt(2024, 1, 31).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(
            matcher.match_operation(&op_right, std::slice::from_ref(&budget)),
            Some(budget.id)
        );
        assert_eq!(matcher.match_operation(&op_wrong, &[budget]), None);
    }

    #[test]
    fn first_matching_budget_wins() {
        let b1 = make_budget(
            BudgetKind::Occasional {
                month: 1,
                year: 2024,
                amount: Decimal::new(50, 0),
            },
            vec![Rule {
                label_pattern: LabelPattern::Contains("TEST".to_string()),
                match_amount: false,
            }],
        );
        let b2 = make_budget(
            BudgetKind::Occasional {
                month: 1,
                year: 2024,
                amount: Decimal::new(50, 0),
            },
            vec![Rule {
                label_pattern: LabelPattern::Contains("TEST".to_string()),
                match_amount: false,
            }],
        );
        let op = make_op(
            "TEST OP",
            Decimal::new(50, 0),
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        let result = matcher.match_operation(&op, &[b1.clone(), b2]);
        assert_eq!(result, Some(b1.id));
    }

    #[test]
    fn empty_budget_list_returns_none() {
        let op = make_op(
            "ANY LABEL",
            Decimal::new(100, 0),
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(matcher.match_operation(&op, &[]), None);
    }

    #[test]
    fn budget_with_no_rules_never_matches() {
        let budget = make_budget(
            BudgetKind::Occasional {
                month: 1,
                year: 2024,
                amount: Decimal::new(100, 0),
            },
            vec![],
        );
        let op = make_op(
            "ANYTHING",
            Decimal::new(100, 0),
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(matcher.match_operation(&op, &[budget]), None);
    }

    #[test]
    fn match_amount_true_occasional_wrong_month_skipped() {
        // Budget is for month 2, operation is in month 1 → no period match → no link
        let budget = make_budget(
            BudgetKind::Occasional {
                month: 2,
                year: 2024,
                amount: Decimal::new(100, 0),
            },
            vec![Rule {
                label_pattern: LabelPattern::Contains("EDF".to_string()),
                match_amount: true,
            }],
        );
        let op = make_op(
            "PRLV EDF",
            Decimal::new(100, 0),
            NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(matcher.match_operation(&op, &[budget]), None);
    }

    #[test]
    fn ends_with_pattern_matches_correctly() {
        let budget = make_budget(
            BudgetKind::Occasional {
                month: 1,
                year: 2024,
                amount: Decimal::new(100, 0),
            },
            vec![Rule {
                label_pattern: LabelPattern::EndsWith("EDF".to_string()),
                match_amount: false,
            }],
        );
        let op_match = make_op(
            "PRLV EDF",
            Decimal::new(50, 0),
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
        );
        let op_no_match = make_op(
            "EDF PRLV",
            Decimal::new(50, 0),
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(
            matcher.match_operation(&op_match, std::slice::from_ref(&budget)),
            Some(budget.id)
        );
        assert_eq!(matcher.match_operation(&op_no_match, &[budget]), None);
    }

    #[test]
    fn no_match_when_op_date_outside_recurring_period() {
        let budget = make_budget(
            BudgetKind::Recurring {
                recurrence: Recurrence::Monthly,
                closed_periods: vec![],
                current_period: CurrentPeriod {
                    start: YearMonth::new(2024, 6),
                    end: Some(YearMonth::new(2024, 12)),
                    amount: Decimal::new(-100, 0),
                },
            },
            vec![Rule {
                label_pattern: LabelPattern::Contains("LOYER".to_string()),
                match_amount: false,
            }],
        );
        // Label matches but date is before the period
        let op = make_op(
            "PRLV LOYER",
            Decimal::new(-100, 0),
            NaiveDate::from_ymd_opt(2024, 3, 15).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(matcher.match_operation(&op, &[budget]), None);
    }

    #[test]
    fn match_when_op_date_inside_recurring_period() {
        let budget = make_budget(
            BudgetKind::Recurring {
                recurrence: Recurrence::Monthly,
                closed_periods: vec![],
                current_period: CurrentPeriod {
                    start: YearMonth::new(2024, 1),
                    end: Some(YearMonth::new(2024, 12)),
                    amount: Decimal::new(-100, 0),
                },
            },
            vec![Rule {
                label_pattern: LabelPattern::Contains("LOYER".to_string()),
                match_amount: false,
            }],
        );
        let op = make_op(
            "PRLV LOYER",
            Decimal::new(-100, 0),
            NaiveDate::from_ymd_opt(2024, 6, 15).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(
            matcher.match_operation(&op, std::slice::from_ref(&budget)),
            Some(budget.id)
        );
    }

    #[test]
    fn no_match_when_op_date_outside_occasional_month() {
        let budget = make_budget(
            BudgetKind::Occasional {
                month: 3,
                year: 2024,
                amount: Decimal::new(-500, 0),
            },
            vec![Rule {
                label_pattern: LabelPattern::Contains("VACANCES".to_string()),
                match_amount: false,
            }],
        );
        // Label matches but date is in a different month
        let op = make_op(
            "CB VACANCES",
            Decimal::new(-200, 0),
            NaiveDate::from_ymd_opt(2024, 7, 10).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(matcher.match_operation(&op, &[budget]), None);
    }

    #[test]
    fn match_recurring_op_in_closed_period() {
        use crate::domain::budget::ClosedPeriod;
        let budget = make_budget(
            BudgetKind::Recurring {
                recurrence: Recurrence::Monthly,
                closed_periods: vec![ClosedPeriod {
                    start: YearMonth::new(2023, 1),
                    end: YearMonth::new(2023, 12),
                    amount: Decimal::new(-90, 0),
                }],
                current_period: CurrentPeriod {
                    start: YearMonth::new(2024, 1),
                    end: None,
                    amount: Decimal::new(-100, 0),
                },
            },
            vec![Rule {
                label_pattern: LabelPattern::Contains("LOYER".to_string()),
                match_amount: false,
            }],
        );
        // Op in 2023 → falls in the closed period
        let op = make_op(
            "PRLV LOYER",
            Decimal::new(-90, 0),
            NaiveDate::from_ymd_opt(2023, 6, 15).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(
            matcher.match_operation(&op, std::slice::from_ref(&budget)),
            Some(budget.id)
        );
    }

    #[test]
    fn no_match_recurring_op_between_periods() {
        use crate::domain::budget::ClosedPeriod;
        let budget = make_budget(
            BudgetKind::Recurring {
                recurrence: Recurrence::Monthly,
                closed_periods: vec![ClosedPeriod {
                    start: YearMonth::new(2023, 1),
                    end: YearMonth::new(2023, 6),
                    amount: Decimal::new(-90, 0),
                }],
                current_period: CurrentPeriod {
                    start: YearMonth::new(2024, 1),
                    end: None,
                    amount: Decimal::new(-100, 0),
                },
            },
            vec![Rule {
                label_pattern: LabelPattern::Contains("LOYER".to_string()),
                match_amount: false,
            }],
        );
        // Op in Oct 2023 — between closed period (ends June) and current (starts Jan 2024)
        let op = make_op(
            "PRLV LOYER",
            Decimal::new(-90, 0),
            NaiveDate::from_ymd_opt(2023, 10, 15).unwrap(),
        );
        let matcher = MatcherServiceImpl;
        assert_eq!(matcher.match_operation(&op, &[budget]), None);
    }
}
