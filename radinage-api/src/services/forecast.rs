//! Month-by-month projection of income, expenses, savings and running balance over a horizon,
//! from the operations already accounted and the budgets' expected amounts.

use crate::{
    domain::budget::{Budget, BudgetType, YearMonth},
    repositories::{SummaryCategory, SummaryRow},
};
use chrono::{Datelike, Months, NaiveDate};
use rust_decimal::{Decimal, RoundingStrategy};
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
    /// Unbudgeted spending expected for the rest of this month at the unbudgeted rate,
    /// included in `flows.expenses`; zero for past months, never positive.
    pub unbudgeted_forecast: Decimal,
    /// Running balance at the end of this month, starting from zero before the horizon.
    pub cumulative: Decimal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Forecast {
    pub months: Vec<ForecastMonth>,
    pub totals: Flows,
    /// Cumulative balance of the last month, zero for an empty horizon.
    pub end_balance: Decimal,
    /// Average daily unbudgeted spending over the history window, never positive.
    pub unbudgeted_rate: Decimal,
    /// Days from today, or from the horizon start when it is still ahead, to the last day of
    /// the horizon, both included; zero once the horizon is over.
    pub days_left: u32,
    /// What can be spent per day outside any budget over `days_left` days without ending the
    /// horizon below zero; `None` when no day is left. Negative when the budgets alone already
    /// end in the red.
    pub daily_budget: Option<Decimal>,
    /// First month whose cumulative balance is below zero.
    pub first_negative_month: Option<YearMonth>,
}

/// Everything a forecast is computed from.
pub struct ForecastInput<'a> {
    pub from: YearMonth,
    pub months: usize,
    pub today: NaiveDate,
    pub budgets: &'a [Budget],
    /// Accounted amounts covering at least the past and current months of the horizon.
    pub rows: &'a [SummaryRow],
    /// Accounted amounts covering at least [`unbudgeted_history`]`(today)`; rows outside it
    /// are ignored, so the same slice as `rows` may be passed when it covers that window.
    pub history: &'a [SummaryRow],
}

/// Complete months before the current one that the unbudgeted rate averages.
const UNBUDGETED_HISTORY_MONTHS: u32 = 3;

/// First and last days of the complete months the unbudgeted rate is averaged over: the
/// [`UNBUDGETED_HISTORY_MONTHS`] months right before the month of `today`.
pub fn unbudgeted_history(today: NaiveDate) -> (NaiveDate, NaiveDate) {
    let current_start = today.with_day(1).unwrap_or(today);
    let start = current_start
        .checked_sub_months(Months::new(UNBUDGETED_HISTORY_MONTHS))
        .unwrap_or(NaiveDate::MIN);
    let end = current_start.pred_opt().unwrap_or(NaiveDate::MIN);
    (start, end)
}

/// Average daily unbudgeted spending over [`unbudgeted_history`]`(today)`, rounded to four
/// decimals. Only negative unbudgeted amounts count: an unlinked refund or transfer in does
/// not lower the expected spending. Days without operations count as zero, so a shorter
/// history dilutes the rate rather than extrapolating from a few days.
pub fn unbudgeted_rate<'a>(
    rows: impl IntoIterator<Item = &'a SummaryRow>,
    today: NaiveDate,
) -> Decimal {
    let (start, end) = unbudgeted_history(today);
    let days = (end - start).num_days() + 1;
    if days <= 0 {
        return Decimal::ZERO;
    }
    let spent: Decimal = rows
        .into_iter()
        .filter(|row| {
            (start..=end).contains(&row.date)
                && row.amount < Decimal::ZERO
                && row.category() == Some(SummaryCategory::Unbudgeted)
        })
        .map(|row| row.amount)
        .sum();
    (spent / Decimal::from(days)).round_dp_with_strategy(4, RoundingStrategy::MidpointAwayFromZero)
}

/// Unbudgeted spending expected over `days` days at `rate`, rounded to the cent.
pub fn unbudgeted_forecast(rate: Decimal, days: u32) -> Decimal {
    (rate * Decimal::from(days)).round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
}

/// Days of `month` the unbudgeted rate still applies to: none for a past month, those
/// after `today` for the current one, all of them for a future one.
fn days_to_forecast(month: YearMonth, status: MonthStatus, today: NaiveDate) -> u32 {
    let Some(last_day) = month.last_day() else {
        return 0;
    };
    match status {
        MonthStatus::Past => 0,
        MonthStatus::Current => last_day.day() - today.day(),
        MonthStatus::Future => last_day.day(),
    }
}

/// The `months` consecutive months starting at `from`, in order.
pub fn horizon(from: YearMonth, months: usize) -> impl Iterator<Item = YearMonth> {
    std::iter::successors(Some(from), |m| Some(m.next())).take(months)
}

/// Days from `today` (or from the first day of the horizon when it is later) to the last day of
/// the horizon, both included; zero when the horizon is empty or already over.
pub fn days_left(from: YearMonth, months: usize, today: NaiveDate) -> u32 {
    let (Some(start), Some(end)) = (
        from.first_day(),
        horizon(from, months).last().and_then(YearMonth::last_day),
    ) else {
        return 0;
    };
    let days = (end - today.max(start)).num_days() + 1;
    u32::try_from(days).unwrap_or(0)
}

/// What is left per day for unbudgeted spending: the end balance before the unbudgeted
/// forecast (which already spends the expected unbudgeted amounts) shared over `days_left`,
/// rounded to the cent.
pub fn daily_budget(
    end_balance: Decimal,
    unbudgeted_forecast: Decimal,
    days_left: u32,
) -> Option<Decimal> {
    (days_left > 0).then(|| {
        ((end_balance - unbudgeted_forecast) / Decimal::from(days_left))
            .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
    })
}

pub fn compute_forecast(input: &ForecastInput<'_>) -> Forecast {
    let unbudgeted_rate = unbudgeted_rate(input.history, input.today);
    let mut cumulative = Decimal::ZERO;
    let mut totals = Flows::default();
    let months: Vec<ForecastMonth> = horizon(input.from, input.months)
        .map(|month| {
            let status = MonthStatus::of(month, input.today);
            let MonthProjection {
                mut flows,
                committed,
            } = project_month(input, month, status);
            let unbudgeted_forecast = unbudgeted_forecast(
                unbudgeted_rate,
                days_to_forecast(month, status, input.today),
            );
            flows.expenses += unbudgeted_forecast;
            cumulative += flows.balance();
            totals += flows;
            ForecastMonth {
                month,
                status,
                flows,
                committed,
                unbudgeted_forecast,
                cumulative,
            }
        })
        .collect();
    let days_left = days_left(input.from, input.months, input.today);
    let unbudgeted_total: Decimal = months.iter().map(|m| m.unbudgeted_forecast).sum();
    let first_negative_month = months
        .iter()
        .find(|m| m.cumulative < Decimal::ZERO)
        .map(|m| m.month);
    Forecast {
        daily_budget: daily_budget(cumulative, unbudgeted_total, days_left),
        months,
        totals,
        end_balance: cumulative,
        unbudgeted_rate,
        days_left,
        first_negative_month,
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
            history: &[],
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
            history: &[],
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
            history: &[],
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
                history: &[],
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
            history: &[],
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

    #[test]
    fn unbudgeted_history_is_the_three_complete_months_before_today() {
        let cases = [
            (date(2026, 3, 12), date(2025, 12, 1), date(2026, 2, 28)),
            (date(2026, 1, 1), date(2025, 10, 1), date(2025, 12, 31)),
            (date(2024, 5, 31), date(2024, 2, 1), date(2024, 4, 30)),
        ];
        for (today, start, end) in cases {
            assert_eq!(unbudgeted_history(today), (start, end), "{today}");
        }
    }

    #[test]
    fn unbudgeted_rate_averages_negative_unbudgeted_amounts_over_the_window() {
        // Window: 2026-01-01..=2026-03-31, 90 days.
        let today = date(2026, 4, 15);
        let budget = monthly_budget(BudgetType::Expense, dec!(-1000));
        let full_history = vec![
            row(date(2026, 1, 10), dec!(-300), None),
            row(date(2026, 2, 10), dec!(-350), None),
            row(date(2026, 3, 31), dec!(-250), None),
        ];
        let cases = [
            ("three months of history", full_history.clone(), dec!(-10)),
            (
                "positive unbudgeted amounts do not lower the rate",
                [
                    full_history.clone(),
                    vec![row(date(2026, 3, 5), dec!(500), None)],
                ]
                .concat(),
                dec!(-10),
            ),
            (
                "budgeted amounts are not unbudgeted spending",
                [
                    full_history.clone(),
                    vec![linked(date(2026, 3, 5), dec!(-1000), &budget)],
                ]
                .concat(),
                dec!(-10),
            ),
            (
                "rows outside the window are ignored",
                [
                    full_history,
                    vec![
                        row(date(2025, 12, 31), dec!(-999), None),
                        row(date(2026, 4, 1), dec!(-999), None),
                        row(today, dec!(-999), None),
                    ],
                ]
                .concat(),
                dec!(-10),
            ),
            (
                "a shorter history is averaged over the whole window",
                vec![row(date(2026, 3, 2), dec!(-90), None)],
                dec!(-1),
            ),
            (
                "rounded to four decimals",
                vec![row(date(2026, 2, 1), dec!(-100), None)],
                dec!(-1.1111),
            ),
            (
                "only income: never positive",
                vec![row(date(2026, 2, 1), dec!(2000), None)],
                dec!(0),
            ),
            ("no history", vec![], dec!(0)),
        ];
        for (case, rows, expected) in cases {
            assert_eq!(unbudgeted_rate(&rows, today), expected, "{case}");
        }
    }

    #[test]
    fn unbudgeted_forecast_covers_days_left_then_whole_future_months() {
        // Rate -10/day from 2026-01..=2026-03; March is also in the horizon.
        let rows = [
            row(date(2026, 1, 10), dec!(-300), None),
            row(date(2026, 2, 10), dec!(-350), None),
            row(date(2026, 3, 10), dec!(-250), None),
            row(date(2026, 4, 2), dec!(-40), None),
        ];
        let forecast = compute_forecast(&ForecastInput {
            from: YearMonth::new(2026, 3),
            months: 4,
            today: date(2026, 4, 20),
            budgets: &[],
            rows: &rows,
            history: &rows,
        });
        assert_eq!(forecast.unbudgeted_rate, dec!(-10));
        let actual: Vec<_> = forecast
            .months
            .iter()
            .map(|m| (m.status, m.unbudgeted_forecast, m.flows.expenses))
            .collect();
        assert_eq!(
            actual,
            vec![
                // Past: actuals only, the history rows are not counted twice.
                (MonthStatus::Past, dec!(0), dec!(-250)),
                // Current: 10 days left after the 20th, today excluded.
                (MonthStatus::Current, dec!(-100), dec!(-140)),
                (MonthStatus::Future, dec!(-310), dec!(-310)),
                (MonthStatus::Future, dec!(-300), dec!(-300)),
            ]
        );
        assert_eq!(forecast.totals.expenses, dec!(-1000));
        assert_eq!(forecast.end_balance, dec!(-1000));
    }

    #[test]
    fn nothing_left_to_forecast_on_the_last_day_of_the_month() {
        let history = [row(date(2026, 2, 1), dec!(-890), None)];
        let forecast = compute_forecast(&ForecastInput {
            from: YearMonth::new(2026, 4),
            months: 1,
            today: date(2026, 4, 30),
            budgets: &[],
            rows: &[],
            history: &history,
        });
        assert_eq!(forecast.unbudgeted_rate, dec!(-9.8889));
        assert_eq!(forecast.months[0].unbudgeted_forecast, dec!(0));
    }

    #[test]
    fn unbudgeted_rate_does_not_depend_on_the_horizon() {
        let history = [row(date(2026, 2, 1), dec!(-900), None)];
        let today = date(2026, 4, 20);
        let forecast_from = |from: YearMonth| {
            compute_forecast(&ForecastInput {
                from,
                months: 2,
                today,
                budgets: &[],
                rows: &[],
                history: &history,
            })
        };

        let before = forecast_from(YearMonth::new(2020, 1));
        assert_eq!(before.unbudgeted_rate, dec!(-10));
        assert!(
            before
                .months
                .iter()
                .all(|m| m.unbudgeted_forecast.is_zero())
        );

        let later = forecast_from(YearMonth::new(2099, 2));
        assert_eq!(later.unbudgeted_rate, dec!(-10));
        let forecasts: Vec<_> = later.months.iter().map(|m| m.unbudgeted_forecast).collect();
        assert_eq!(forecasts, vec![dec!(-280), dec!(-310)]);
    }

    #[test]
    fn days_left_count_today_up_to_the_end_of_the_horizon() {
        let from = YearMonth::new(2026, 1);
        // (case, months, today, expected)
        let cases = [
            ("today included", 12, date(2026, 12, 30), 2),
            ("last day of the horizon", 12, date(2026, 12, 31), 1),
            ("first day of the horizon", 12, date(2026, 1, 1), 365),
            ("horizon over", 12, date(2027, 1, 1), 0),
            (
                "horizon ahead counts from its start",
                2,
                date(2025, 6, 15),
                59,
            ),
            ("horizon across years", 14, date(2026, 12, 31), 60),
            ("empty horizon", 0, date(2026, 1, 1), 0),
        ];
        for (case, months, today, expected) in cases {
            assert_eq!(days_left(from, months, today), expected, "{case}");
        }
    }

    /// A 2026 forecast with an income and an expense budget and a -10/day unbudgeted rate.
    fn year_forecast(today: NaiveDate, income: Decimal, expense: Decimal) -> Forecast {
        let budgets = [
            monthly_budget(BudgetType::Income, income),
            monthly_budget(BudgetType::Expense, expense),
        ];
        // 90 days of history before any 2026-04 today: -900 → -10/day.
        let history = [row(date(2026, 2, 1), dec!(-900), None)];
        compute_forecast(&ForecastInput {
            from: YearMonth::new(2026, 1),
            months: 12,
            today,
            budgets: &budgets,
            rows: &[],
            history: &history,
        })
    }

    #[test]
    fn daily_budget_shares_what_the_budgets_leave_over_the_days_left() {
        let today = date(2026, 4, 20);
        let forecast = year_forecast(today, dec!(2000), dec!(-1000));
        // Jan–Mar: no rows. April: budgets fully expected (+1000), 10 unbudgeted days.
        // May–Dec: 8 × 1000 from budgets, 245 unbudgeted days.
        assert_eq!(forecast.unbudgeted_rate, dec!(-10));
        let unbudgeted: Decimal = forecast.months.iter().map(|m| m.unbudgeted_forecast).sum();
        assert_eq!(unbudgeted, dec!(-2550));
        assert_eq!(forecast.end_balance, dec!(9000) - dec!(2550));
        assert_eq!(forecast.days_left, 256);
        // 9000 / 256 = 35.156…
        assert_eq!(forecast.daily_budget, Some(dec!(35.16)));
        assert_eq!(forecast.first_negative_month, None);
    }

    #[test]
    fn daily_budget_is_negative_when_the_budgets_alone_end_in_the_red() {
        let forecast = year_forecast(date(2026, 4, 20), dec!(1000), dec!(-1256));
        // 9 months × -256 = -2304 before unbudgeted spending, over 256 days.
        assert_eq!(forecast.days_left, 256);
        assert_eq!(forecast.daily_budget, Some(dec!(-9)));
    }

    #[test]
    fn daily_budget_is_none_once_the_horizon_is_over() {
        let forecast = year_forecast(date(2027, 1, 1), dec!(2000), dec!(-1000));
        assert_eq!(forecast.days_left, 0);
        assert_eq!(forecast.daily_budget, None);
    }

    #[test]
    fn daily_budget_of_a_future_horizon_spans_all_of_it() {
        let forecast = year_forecast(date(2025, 10, 4), dec!(2000), dec!(-1000));
        // No history before 2025-10: no unbudgeted forecast, 12 × 1000 over 365 days.
        assert_eq!(forecast.days_left, 365);
        assert_eq!(forecast.end_balance, dec!(12000));
        assert_eq!(forecast.daily_budget, Some(dec!(32.88)));
    }

    #[test]
    fn first_negative_month_is_the_first_cumulative_below_zero() {
        // (case, monthly balances from 2026-01, all past, expected)
        let cases: [(&str, Vec<Decimal>, Option<YearMonth>); 5] = [
            ("never negative", vec![dec!(100), dec!(-100), dec!(0)], None),
            (
                "negative from the first month",
                vec![dec!(-1), dec!(500), dec!(-100)],
                Some(YearMonth::new(2026, 1)),
            ),
            (
                "negative several times: the first one",
                vec![dec!(100), dec!(-150), dec!(200), dec!(-300)],
                Some(YearMonth::new(2026, 2)),
            ),
            (
                "negative balance but positive cumulative",
                vec![dec!(300), dec!(-200), dec!(-100)],
                None,
            ),
            ("empty horizon", vec![], None),
        ];
        for (case, balances, expected) in cases {
            let rows: Vec<_> = horizon(YearMonth::new(2026, 1), balances.len())
                .zip(&balances)
                .map(|(month, amount)| row(month.first_day().unwrap(), *amount, None))
                .collect();
            let forecast = compute_forecast(&ForecastInput {
                from: YearMonth::new(2026, 1),
                months: balances.len(),
                today: date(2027, 1, 1),
                budgets: &[],
                rows: &rows,
                history: &[],
            });
            assert_eq!(forecast.first_negative_month, expected, "{case}");
        }
    }
}
