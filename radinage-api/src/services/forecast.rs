//! Month-by-month projection of income, expenses, savings and running balance over a horizon,
//! from the operations already accounted and the budgets' expected amounts.

use crate::{
    domain::budget::{Budget, BudgetType, YearMonth},
    repositories::{SummaryCategory, SummaryRow},
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::ops::AddAssign;

/// Position of a month relative to today.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MonthStatus {
    Past,
    Current,
    Future,
}

impl MonthStatus {
    pub fn of(month: YearMonth, today: NaiveDate) -> Self {
        match month.cmp(&YearMonth::of(today)) {
            std::cmp::Ordering::Less => Self::Past,
            std::cmp::Ordering::Equal => Self::Current,
            std::cmp::Ordering::Greater => Self::Future,
        }
    }
}

/// Money flows of a period, signed like operations: income positive, expenses and savings
/// negative.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Flows {
    pub income: Decimal,
    pub expenses: Decimal,
    pub savings: Decimal,
}

impl Flows {
    pub fn balance(&self) -> Decimal {
        self.income + self.expenses + self.savings
    }

    fn add_budgeted(&mut self, budget_type: BudgetType, amount: Decimal) {
        match budget_type {
            BudgetType::Income => self.income += amount,
            BudgetType::Expense => self.expenses += amount,
            BudgetType::Savings => self.savings += amount,
        }
    }

    /// An amount outside any budget counts as income or expense by its own sign.
    fn add_unbudgeted(&mut self, amount: Decimal) {
        if amount.is_sign_positive() {
            self.income += amount;
        } else {
            self.expenses += amount;
        }
    }
}

impl AddAssign for Flows {
    fn add_assign(&mut self, other: Self) {
        self.income += other.income;
        self.expenses += other.expenses;
        self.savings += other.savings;
    }
}

/// One month of the forecast.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForecastMonth {
    pub month: YearMonth,
    pub status: MonthStatus,
    pub flows: Flows,
    /// Part of `flows` the budgets still expect this month on top of what is already linked
    /// to them; zero outside the current month.
    pub committed: Decimal,
    /// Running balance at the end of this month, starting from zero before the horizon.
    pub cumulative: Decimal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Forecast {
    pub months: Vec<ForecastMonth>,
    pub totals: Flows,
    /// Cumulative balance of the last month, zero for an empty horizon.
    pub end_balance: Decimal,
}

/// Everything a forecast is computed from.
pub struct ForecastInput<'a> {
    pub from: YearMonth,
    pub months: usize,
    pub today: NaiveDate,
    pub budgets: &'a [Budget],
    /// Accounted amounts covering at least the past and current months of the horizon.
    pub rows: &'a [SummaryRow],
}

/// The `months` consecutive months starting at `from`, in order.
pub fn horizon(from: YearMonth, months: usize) -> impl Iterator<Item = YearMonth> {
    std::iter::successors(Some(from), |m| Some(m.next())).take(months)
}

pub fn compute_forecast(input: &ForecastInput<'_>) -> Forecast {
    let mut cumulative = Decimal::ZERO;
    let mut totals = Flows::default();
    let months: Vec<ForecastMonth> = horizon(input.from, input.months)
        .map(|month| {
            let status = MonthStatus::of(month, input.today);
            let MonthProjection { flows, committed } = project_month(input, month, status);
            cumulative += flows.balance();
            totals += flows;
            ForecastMonth {
                month,
                status,
                flows,
                committed,
                cumulative,
            }
        })
        .collect();
    Forecast {
        months,
        totals,
        end_balance: cumulative,
    }
}

struct MonthProjection {
    flows: Flows,
    committed: Decimal,
}

/// Flows of one month: what was accounted for past months; for the current month, that
/// plus what each budget still expects; what the budgets expect for future months.
fn project_month(
    input: &ForecastInput<'_>,
    month: YearMonth,
    status: MonthStatus,
) -> MonthProjection {
    let month_rows = || {
        input
            .rows
            .iter()
            .filter(move |row| YearMonth::of(row.date) == month)
    };
    match status {
        MonthStatus::Past => MonthProjection {
            flows: actual_flows(month_rows()),
            committed: Decimal::ZERO,
        },
        MonthStatus::Current => {
            let mut flows = actual_flows(month_rows());
            let mut committed = Decimal::ZERO;
            for budget in input.budgets {
                let remaining = budget_progress(budget, month, input.rows).remaining;
                flows.add_budgeted(budget.budget_type, remaining);
                committed += remaining;
            }
            MonthProjection { flows, committed }
        }
        MonthStatus::Future => MonthProjection {
            flows: expected_flows(input.budgets, month),
            committed: Decimal::ZERO,
        },
    }
}

/// How far one budget has got in a month, amounts signed like operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BudgetProgress {
    /// What the budget expects this month, `None` when it expects nothing.
    pub expected: Option<Decimal>,
    /// Net of the amounts linked to the budget this month.
    pub actual: Decimal,
    /// Part of `expected` not reached yet, in the budget's direction; zero once reached or
    /// exceeded.
    pub remaining: Decimal,
}

/// Progress of `budget` in `month` from the accounted `rows` (rows of other budgets or
/// months are ignored).
pub fn budget_progress<'a>(
    budget: &Budget,
    month: YearMonth,
    rows: impl IntoIterator<Item = &'a SummaryRow>,
) -> BudgetProgress {
    let actual: Decimal = rows
        .into_iter()
        .filter(|row| {
            row.budget_id == Some(budget.id)
                && YearMonth::of(row.date) == month
                && matches!(row.category(), Some(SummaryCategory::Budgeted(_)))
        })
        .map(|row| row.amount)
        .sum();
    let expected = budget
        .kind
        .expected_amount_for_month(month.year, month.month);
    let remaining = match expected {
        Some(expected) if expected > Decimal::ZERO => (expected - actual).max(Decimal::ZERO),
        Some(expected) if expected < Decimal::ZERO => (expected - actual).min(Decimal::ZERO),
        _ => Decimal::ZERO,
    };
    BudgetProgress {
        expected,
        actual,
        remaining,
    }
}

/// Flows of accounted amounts: each budgeted amount under its budget's type, each
/// unbudgeted one under income or expenses by its own sign.
pub fn actual_flows<'a>(rows: impl IntoIterator<Item = &'a SummaryRow>) -> Flows {
    let mut flows = Flows::default();
    for row in rows {
        match row.category() {
            Some(SummaryCategory::Budgeted(budget_type)) => {
                flows.add_budgeted(budget_type, row.amount);
            }
            Some(SummaryCategory::Unbudgeted) => flows.add_unbudgeted(row.amount),
            None => {}
        }
    }
    flows
}

/// Flows the budgets expect in `month`.
pub fn expected_flows(budgets: &[Budget], month: YearMonth) -> Flows {
    let mut flows = Flows::default();
    for budget in budgets {
        if let Some(amount) = budget
            .kind
            .expected_amount_for_month(month.year, month.month)
        {
            flows.add_budgeted(budget.budget_type, amount);
        }
    }
    flows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::budget::{BudgetKind, CurrentPeriod, Recurrence};
    use rust_decimal_macros::dec;
    use uuid::Uuid;

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    fn row(day: NaiveDate, amount: Decimal, budget_type: Option<&str>) -> SummaryRow {
        SummaryRow {
            amount,
            date: day,
            budget_link_type: if budget_type.is_some() {
                "manual"
            } else {
                "unlinked"
            }
            .to_string(),
            budget_id: budget_type.map(|_| Uuid::nil()),
            budget_type: budget_type.map(str::to_string),
        }
    }

    fn monthly_budget(budget_type: BudgetType, amount: Decimal) -> Budget {
        Budget {
            id: Uuid::new_v4(),
            user_id: Uuid::nil(),
            label: "B".to_string(),
            budget_type,
            kind: BudgetKind::Recurring {
                recurrence: Recurrence::Monthly,
                closed_periods: vec![],
                current_period: CurrentPeriod {
                    start: YearMonth::new(2020, 1),
                    end: None,
                    amount,
                },
            },
            rules: vec![],
            created_at: chrono::Utc::now(),
        }
    }

    fn flows(income: Decimal, expenses: Decimal, savings: Decimal) -> Flows {
        Flows {
            income,
            expenses,
            savings,
        }
    }

    #[test]
    fn month_status_is_relative_to_today() {
        let today = date(2026, 3, 15);
        let cases = [
            (YearMonth::new(2025, 12), MonthStatus::Past),
            (YearMonth::new(2026, 2), MonthStatus::Past),
            (YearMonth::new(2026, 3), MonthStatus::Current),
            (YearMonth::new(2026, 4), MonthStatus::Future),
            (YearMonth::new(2027, 1), MonthStatus::Future),
        ];
        for (month, expected) in cases {
            assert_eq!(MonthStatus::of(month, today), expected, "{month:?}");
        }
    }

    #[test]
    fn actual_flows_classify_unbudgeted_amounts_one_by_one() {
        let day = date(2026, 1, 5);
        let rows = [
            row(day, dec!(1200), None),
            row(day, dec!(-1500), None),
            row(day, dec!(-30), None),
            row(day, dec!(2000), Some("income")),
            row(day, dec!(-500), Some("expense")),
            row(day, dec!(-300), Some("savings")),
        ];
        assert_eq!(
            actual_flows(&rows),
            flows(dec!(3200), dec!(-2030), dec!(-300))
        );
    }

    #[test]
    fn expected_flows_sum_budgets_by_type() {
        let budgets = [
            monthly_budget(BudgetType::Income, dec!(2500)),
            monthly_budget(BudgetType::Expense, dec!(-800)),
            monthly_budget(BudgetType::Expense, dec!(-100)),
            monthly_budget(BudgetType::Savings, dec!(-200)),
        ];
        assert_eq!(
            expected_flows(&budgets, YearMonth::new(2026, 7)),
            flows(dec!(2500), dec!(-900), dec!(-200))
        );
        assert_eq!(
            expected_flows(&budgets, YearMonth::new(2019, 12)),
            Flows::default()
        );
    }

    #[test]
    fn forecast_uses_actuals_up_to_the_current_month_then_budgets() {
        let budgets = [
            monthly_budget(BudgetType::Income, dec!(2500)),
            monthly_budget(BudgetType::Expense, dec!(-800)),
        ];
        let rows = [
            row(date(2026, 1, 3), dec!(2000), Some("income")),
            row(date(2026, 1, 9), dec!(-100), None),
            row(date(2026, 2, 27), dec!(-50), None),
            // Future-dated: ignored, March is projected from budgets.
            row(date(2026, 3, 1), dec!(-999), None),
        ];
        let forecast = compute_forecast(&ForecastInput {
            from: YearMonth::new(2026, 1),
            months: 3,
            today: date(2026, 2, 10),
            budgets: &budgets,
            rows: &rows,
        });

        let expected = [
            (
                YearMonth::new(2026, 1),
                MonthStatus::Past,
                flows(dec!(2000), dec!(-100), dec!(0)),
                dec!(1900),
            ),
            // Nothing linked yet: both budgets are still fully expected.
            (
                YearMonth::new(2026, 2),
                MonthStatus::Current,
                flows(dec!(2500), dec!(-850), dec!(0)),
                dec!(3550),
            ),
            (
                YearMonth::new(2026, 3),
                MonthStatus::Future,
                flows(dec!(2500), dec!(-800), dec!(0)),
                dec!(5250),
            ),
        ];
        let actual: Vec<_> = forecast
            .months
            .iter()
            .map(|m| (m.month, m.status, m.flows, m.cumulative))
            .collect();
        assert_eq!(actual, expected);
        let committed: Vec<_> = forecast.months.iter().map(|m| m.committed).collect();
        assert_eq!(committed, vec![dec!(0), dec!(1700), dec!(0)]);
        assert_eq!(forecast.totals, flows(dec!(7000), dec!(-1750), dec!(0)));
        assert_eq!(forecast.totals.balance(), dec!(5250));
        assert_eq!(forecast.end_balance, dec!(5250));
    }

    #[test]
    fn forecast_horizon_crosses_years() {
        let forecast = compute_forecast(&ForecastInput {
            from: YearMonth::new(2026, 11),
            months: 4,
            today: date(2020, 1, 1),
            budgets: &[monthly_budget(BudgetType::Expense, dec!(-10))],
            rows: &[],
        });
        let months: Vec<_> = forecast.months.iter().map(|m| m.month).collect();
        assert_eq!(
            months,
            vec![
                YearMonth::new(2026, 11),
                YearMonth::new(2026, 12),
                YearMonth::new(2027, 1),
                YearMonth::new(2027, 2),
            ]
        );
        assert_eq!(forecast.end_balance, dec!(-40));
    }

    #[test]
    fn empty_horizon_is_zero() {
        let forecast = compute_forecast(&ForecastInput {
            from: YearMonth::new(2026, 1),
            months: 0,
            today: date(2026, 1, 1),
            budgets: &[],
            rows: &[],
        });
        assert!(forecast.months.is_empty());
        assert_eq!(forecast.totals, Flows::default());
        assert_eq!(forecast.end_balance, Decimal::ZERO);
    }

    fn linked(day: NaiveDate, amount: Decimal, budget: &Budget) -> SummaryRow {
        SummaryRow {
            amount,
            date: day,
            budget_link_type: "manual".to_string(),
            budget_id: Some(budget.id),
            budget_type: Some(budget.budget_type.as_str().to_string()),
        }
    }

    #[test]
    fn current_month_adds_what_each_budget_still_expects() {
        let today = date(2026, 3, 12);
        let earlier = date(2026, 3, 5);
        let groceries = monthly_budget(BudgetType::Expense, dec!(-550));
        let salary = monthly_budget(BudgetType::Income, dec!(3420));
        let livret = monthly_budget(BudgetType::Savings, dec!(-200));
        let mut ended = monthly_budget(BudgetType::Expense, dec!(-90));
        if let BudgetKind::Recurring { current_period, .. } = &mut ended.kind {
            current_period.end = Some(YearMonth::new(2026, 2));
        }

        // (case, budgets, rows of the month, expected flows, expected committed)
        let cases = [
            (
                "expense partially spent",
                vec![&groceries],
                vec![linked(earlier, dec!(-330), &groceries)],
                flows(dec!(0), dec!(-550), dec!(0)),
                dec!(-220),
            ),
            (
                "expense exceeded",
                vec![&groceries],
                vec![
                    linked(earlier, dec!(-500), &groceries),
                    linked(today, dec!(-120), &groceries),
                ],
                flows(dec!(0), dec!(-620), dec!(0)),
                dec!(0),
            ),
            (
                "income not yet received",
                vec![&salary],
                vec![],
                flows(dec!(3420), dec!(0), dec!(0)),
                dec!(3420),
            ),
            (
                "income received",
                vec![&salary],
                vec![linked(earlier, dec!(3500), &salary)],
                flows(dec!(3500), dec!(0), dec!(0)),
                dec!(0),
            ),
            (
                "savings partially done",
                vec![&livret],
                vec![linked(earlier, dec!(-50), &livret)],
                flows(dec!(0), dec!(0), dec!(-200)),
                dec!(-150),
            ),
            (
                "budget expecting nothing this month",
                vec![&ended],
                vec![linked(earlier, dec!(-40), &ended)],
                flows(dec!(0), dec!(-40), dec!(0)),
                dec!(0),
            ),
            (
                "unbudgeted actuals unchanged",
                vec![],
                vec![row(earlier, dec!(-35), None), row(earlier, dec!(60), None)],
                flows(dec!(60), dec!(-35), dec!(0)),
                dec!(0),
            ),
            (
                "rows of another budget do not reach this one",
                vec![&groceries, &salary],
                vec![
                    linked(earlier, dec!(-100), &groceries),
                    linked(earlier, dec!(1000), &salary),
                    row(earlier, dec!(-20), None),
                ],
                flows(dec!(3420), dec!(-570), dec!(0)),
                dec!(1970),
            ),
        ];

        for (case, budgets, rows, expected_flows, expected_committed) in cases {
            let budgets: Vec<Budget> = budgets.into_iter().cloned().collect();
            let forecast = compute_forecast(&ForecastInput {
                from: YearMonth::new(2026, 3),
                months: 1,
                today,
                budgets: &budgets,
                rows: &rows,
            });
            let month = &forecast.months[0];
            assert_eq!(month.status, MonthStatus::Current, "{case}");
            assert_eq!(month.flows, expected_flows, "{case}");
            assert_eq!(month.committed, expected_committed, "{case}");
            assert_eq!(month.cumulative, expected_flows.balance(), "{case}");
        }
    }

    #[test]
    fn past_and_future_months_commit_nothing() {
        let groceries = monthly_budget(BudgetType::Expense, dec!(-550));
        let rows = [linked(date(2026, 2, 3), dec!(-100), &groceries)];
        let forecast = compute_forecast(&ForecastInput {
            from: YearMonth::new(2026, 2),
            months: 3,
            today: date(2026, 3, 1),
            budgets: std::slice::from_ref(&groceries),
            rows: &rows,
        });
        let actual: Vec<_> = forecast
            .months
            .iter()
            .map(|m| (m.status, m.flows.expenses, m.committed))
            .collect();
        assert_eq!(
            actual,
            vec![
                (MonthStatus::Past, dec!(-100), dec!(0)),
                (MonthStatus::Current, dec!(-550), dec!(-550)),
                (MonthStatus::Future, dec!(-550), dec!(0)),
            ]
        );
    }

    #[test]
    fn budget_progress_ignores_other_months_and_unknown_link_types() {
        let groceries = monthly_budget(BudgetType::Expense, dec!(-550));
        let mut ignored = linked(date(2026, 3, 2), dec!(-999), &groceries);
        ignored.budget_link_type = "ignored".to_string();
        let rows = [
            linked(date(2026, 3, 2), dec!(-330), &groceries),
            linked(date(2026, 2, 28), dec!(-100), &groceries),
            ignored,
        ];
        assert_eq!(
            budget_progress(&groceries, YearMonth::new(2026, 3), &rows),
            BudgetProgress {
                expected: Some(dec!(-550)),
                actual: dec!(-330),
                remaining: dec!(-220),
            }
        );
    }
}
