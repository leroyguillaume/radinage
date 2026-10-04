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
            let flows = project_month(input, month, status);
            cumulative += flows.balance();
            totals += flows;
            ForecastMonth {
                month,
                status,
                flows,
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

/// Flows of one month: what was accounted for past and current months, what the budgets
/// expect for future ones.
fn project_month(input: &ForecastInput<'_>, month: YearMonth, status: MonthStatus) -> Flows {
    match status {
        MonthStatus::Past | MonthStatus::Current => actual_flows(
            input
                .rows
                .iter()
                .filter(|row| YearMonth::of(row.date) == month),
        ),
        MonthStatus::Future => expected_flows(input.budgets, month),
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
            (
                YearMonth::new(2026, 2),
                MonthStatus::Current,
                flows(dec!(0), dec!(-50), dec!(0)),
                dec!(1850),
            ),
            (
                YearMonth::new(2026, 3),
                MonthStatus::Future,
                flows(dec!(2500), dec!(-800), dec!(0)),
                dec!(3550),
            ),
        ];
        let actual: Vec<_> = forecast
            .months
            .iter()
            .map(|m| (m.month, m.status, m.flows, m.cumulative))
            .collect();
        assert_eq!(actual, expected);
        assert_eq!(forecast.totals, flows(dec!(4500), dec!(-950), dec!(0)));
        assert_eq!(forecast.totals.balance(), dec!(3550));
        assert_eq!(forecast.end_balance, dec!(3550));
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
}
