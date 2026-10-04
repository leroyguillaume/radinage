use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A year-month pair representing a month with no day precision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct YearMonth {
    /// Four-digit year.
    pub year: i32,
    /// Month number (1–12).
    pub month: u32,
}

impl YearMonth {
    pub fn new(year: i32, month: u32) -> Self {
        Self { year, month }
    }

    /// The month containing `date`.
    pub fn of(date: NaiveDate) -> Self {
        Self::new(date.year(), date.month())
    }

    /// The month right after this one.
    pub fn next(self) -> Self {
        if self.month == 12 {
            Self::new(self.year + 1, 1)
        } else {
            Self::new(self.year, self.month + 1)
        }
    }

    /// First day of the month, or `None` when the month is out of range.
    pub fn first_day(self) -> Option<NaiveDate> {
        NaiveDate::from_ymd_opt(self.year, self.month, 1)
    }

    /// Last day of the month, or `None` when the month is out of range.
    pub fn last_day(self) -> Option<NaiveDate> {
        super::last_day_of_month(self.year, self.month)
    }

    /// Number of months from `self` to `later` (negative when `later` is earlier).
    fn months_until(self, later: Self) -> i64 {
        (i64::from(later.year) - i64::from(self.year)) * 12 + i64::from(later.month)
            - i64::from(self.month)
    }
}

impl PartialOrd for YearMonth {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for YearMonth {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.year
            .cmp(&other.year)
            .then(self.month.cmp(&other.month))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    pub id: Uuid,
    pub user_id: Uuid,
    pub label: String,
    pub budget_type: BudgetType,
    pub kind: BudgetKind,
    pub rules: Vec<Rule>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Classification of what a budget tracks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[schemars(transform = crate::schema::flatten_string_enum)]
#[serde(rename_all = "lowercase")]
pub enum BudgetType {
    /// Tracks money going out (negative amounts).
    Expense,
    /// Tracks money coming in (positive amounts).
    Income,
    /// Tracks money set aside for savings.
    Savings,
}

impl BudgetType {
    pub fn as_str(&self) -> &'static str {
        match self {
            BudgetType::Expense => "expense",
            BudgetType::Income => "income",
            BudgetType::Savings => "savings",
        }
    }
}

impl std::str::FromStr for BudgetType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "expense" => Ok(BudgetType::Expense),
            "income" => Ok(BudgetType::Income),
            "savings" => Ok(BudgetType::Savings),
            other => Err(format!("unknown budget type: {other}")),
        }
    }
}

/// How often a recurring budget repeats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[schemars(transform = crate::schema::flatten_string_enum)]
#[serde(rename_all = "lowercase")]
pub enum Recurrence {
    /// Every week.
    Weekly,
    /// Every month.
    Monthly,
    /// Every three months.
    Quarterly,
    /// Every year.
    Yearly,
}

impl Recurrence {
    pub fn as_str(&self) -> &'static str {
        match self {
            Recurrence::Weekly => "weekly",
            Recurrence::Monthly => "monthly",
            Recurrence::Quarterly => "quarterly",
            Recurrence::Yearly => "yearly",
        }
    }
}

impl std::str::FromStr for Recurrence {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "weekly" => Ok(Recurrence::Weekly),
            "monthly" => Ok(Recurrence::Monthly),
            "quarterly" => Ok(Recurrence::Quarterly),
            "yearly" => Ok(Recurrence::Yearly),
            other => Err(format!("unknown recurrence: {other}")),
        }
    }
}

/// The kind of a budget: recurring (list of periods) or occasional (single month/amount). Discriminated by the `type` field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BudgetKind {
    /// A recurring budget with at least one period. Past periods have a
    /// definite end date; only the current (last) period may be open-ended.
    Recurring {
        /// How often the budget repeats (weekly, monthly, quarterly, yearly).
        recurrence: Recurrence,
        /// Past periods whose date range is fully known (may be empty).
        #[serde(rename = "closedPeriods")]
        closed_periods: Vec<ClosedPeriod>,
        /// The latest / active period, whose end date is optional.
        #[serde(rename = "currentPeriod")]
        current_period: CurrentPeriod,
    },
    /// A one-off budget for a single specific month.
    Occasional {
        /// Month number (1–12).
        month: u32,
        /// Four-digit year.
        year: u32,
        /// Budgeted amount for that month.
        #[schemars(with = "String")]
        amount: Decimal,
    },
}

/// Two year-month ranges overlap when both start <= the other's end.
fn ranges_overlap(
    a_start: YearMonth,
    a_end: Option<YearMonth>,
    b_start: YearMonth,
    b_end: Option<YearMonth>,
) -> bool {
    let a_before_b = a_end.is_some_and(|a_e| a_e < b_start);
    let b_before_a = b_end.is_some_and(|b_e| b_e < a_start);
    !a_before_b && !b_before_a
}

impl BudgetKind {
    /// Validate that no two periods overlap. Returns an error message if they do.
    pub fn validate_no_overlap(&self) -> Result<(), String> {
        let BudgetKind::Recurring {
            closed_periods,
            current_period,
            ..
        } = self
        else {
            return Ok(());
        };

        // Check closed periods against each other.
        for i in 0..closed_periods.len() {
            for j in (i + 1)..closed_periods.len() {
                if ranges_overlap(
                    closed_periods[i].start,
                    Some(closed_periods[i].end),
                    closed_periods[j].start,
                    Some(closed_periods[j].end),
                ) {
                    return Err(format!("closed periods {i} and {j} overlap"));
                }
            }
        }

        // Check current period against each closed period.
        for (i, cp) in closed_periods.iter().enumerate() {
            if ranges_overlap(
                cp.start,
                Some(cp.end),
                current_period.start,
                current_period.end,
            ) {
                return Err(format!("current period overlaps with closed period {i}"));
            }
        }

        Ok(())
    }

    /// Amount this budget expects in the given month, `None` when it expects nothing.
    ///
    /// The period covering the month gives the base amount. A weekly budget expects it once
    /// per week of the month (days / 7, rounded half up: 4 for every month); a quarterly or
    /// yearly budget only in the months that are a multiple of 3 or 12 months after the
    /// period's start.
    pub fn expected_amount_for_month(&self, year: i32, month: u32) -> Option<Decimal> {
        let ym = YearMonth::new(year, month);
        match self {
            BudgetKind::Recurring {
                recurrence,
                closed_periods,
                current_period,
            } => {
                let (start, amount) = closed_periods
                    .iter()
                    .find(|p| p.start <= ym && p.end >= ym)
                    .map(|p| (p.start, p.amount))
                    .or_else(|| {
                        (current_period.start <= ym
                            && current_period.end.is_none_or(|end| end >= ym))
                        .then_some((current_period.start, current_period.amount))
                    })?;
                match recurrence {
                    Recurrence::Monthly => Some(amount),
                    Recurrence::Weekly => {
                        let days = ym.last_day()?.day();
                        Some(amount * Decimal::from((days * 2 + 7) / 14))
                    }
                    Recurrence::Quarterly => (start.months_until(ym) % 3 == 0).then_some(amount),
                    Recurrence::Yearly => (start.months_until(ym) % 12 == 0).then_some(amount),
                }
            }
            BudgetKind::Occasional {
                month: m,
                year: y,
                amount,
            } => (i64::from(*y) == i64::from(year) && *m == month).then_some(*amount),
        }
    }
}

/// A past period within a recurring budget whose month range is fully known.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClosedPeriod {
    /// First month of the period (inclusive).
    pub start: YearMonth,
    /// Last month of the period (inclusive).
    pub end: YearMonth,
    /// Budgeted amount for this period.
    #[schemars(with = "String")]
    pub amount: Decimal,
}

/// The current (last) period of a recurring budget. Its end month is optional,
/// meaning the budget is still active with no planned end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurrentPeriod {
    /// First month of the period (inclusive).
    pub start: YearMonth,
    /// Last month of the period (inclusive). `None` means the period is open-ended.
    pub end: Option<YearMonth>,
    /// Budgeted amount for this period.
    #[schemars(with = "String")]
    pub amount: Decimal,
}

/// An auto-matching rule that links operations to a budget based on their label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    /// Pattern to match against the operation label.
    pub label_pattern: LabelPattern,
    /// When true, the operation amount must also match the budget amount.
    pub match_amount: bool,
}

/// Pattern used to match operation labels. Discriminated by the `type` field; the matched text goes in `value`. Matching is always case-insensitive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum LabelPattern {
    /// Match labels that begin with the given text.
    StartsWith(String),
    /// Match labels that end with the given text.
    EndsWith(String),
    /// Match labels that contain the given text anywhere.
    Contains(String),
}

impl LabelPattern {
    pub fn matches(&self, label: &str) -> bool {
        let label_lower = label.to_lowercase();
        match self {
            LabelPattern::StartsWith(v) => label_lower.starts_with(&v.to_lowercase()),
            LabelPattern::EndsWith(v) => label_lower.ends_with(&v.to_lowercase()),
            LabelPattern::Contains(v) => label_lower.contains(&v.to_lowercase()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_pattern_starts_with_case_insensitive() {
        let p = LabelPattern::StartsWith("VIR".to_string());
        assert!(p.matches("VIR SALAIRE"));
        assert!(p.matches("vir salaire"));
    }

    #[test]
    fn label_pattern_ends_with() {
        let p = LabelPattern::EndsWith("EDF".to_string());
        assert!(p.matches("PRLV EDF"));
        assert!(!p.matches("EDF PRLV"));
    }

    #[test]
    fn label_pattern_contains() {
        let p = LabelPattern::Contains("AMAZON".to_string());
        assert!(p.matches("PRLV AMAZON EU"));
        assert!(p.matches("amazon prime"));
    }

    #[test]
    fn expected_amount_for_month_recurring_with_closed_end() {
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: Some(YearMonth::new(2024, 12)),
                amount: Decimal::new(1000, 0),
            },
        };
        assert_eq!(
            kind.expected_amount_for_month(2024, 6),
            Some(Decimal::new(1000, 0))
        );
        assert_eq!(kind.expected_amount_for_month(2025, 1), None);
    }

    #[test]
    fn expected_amount_for_month_recurring_open_ended() {
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: None,
                amount: Decimal::new(1000, 0),
            },
        };
        assert_eq!(
            kind.expected_amount_for_month(2024, 6),
            Some(Decimal::new(1000, 0))
        );
        // Open-ended: matches any future month
        assert_eq!(
            kind.expected_amount_for_month(2030, 1),
            Some(Decimal::new(1000, 0))
        );
        // But not before the start
        assert_eq!(kind.expected_amount_for_month(2023, 12), None);
    }

    #[test]
    fn expected_amount_for_month_occasional() {
        let kind = BudgetKind::Occasional {
            month: 3,
            year: 2024,
            amount: Decimal::new(500, 0),
        };
        assert_eq!(
            kind.expected_amount_for_month(2024, 3),
            Some(Decimal::new(500, 0))
        );
        assert_eq!(kind.expected_amount_for_month(2024, 4), None);
    }

    #[test]
    fn expected_amount_for_month_recurring_closed_periods() {
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![ClosedPeriod {
                start: YearMonth::new(2023, 1),
                end: YearMonth::new(2023, 12),
                amount: Decimal::new(800, 0),
            }],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: None,
                amount: Decimal::new(1000, 0),
            },
        };
        assert_eq!(
            kind.expected_amount_for_month(2023, 6),
            Some(Decimal::new(800, 0))
        );
        assert_eq!(
            kind.expected_amount_for_month(2024, 6),
            Some(Decimal::new(1000, 0))
        );
    }

    #[test]
    fn expected_amount_for_month_recurring_period_boundary() {
        // Current period covers only January 2024
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: Some(YearMonth::new(2024, 1)),
                amount: Decimal::new(200, 0),
            },
        };
        assert_eq!(
            kind.expected_amount_for_month(2024, 1),
            Some(Decimal::new(200, 0))
        );
        assert_eq!(kind.expected_amount_for_month(2024, 2), None);
    }

    #[test]
    fn expected_amount_for_month_recurring_cross_year_period() {
        // Current period spanning Nov 2024 → Feb 2025
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 11),
                end: Some(YearMonth::new(2025, 2)),
                amount: Decimal::new(300, 0),
            },
        };
        assert_eq!(
            kind.expected_amount_for_month(2025, 1),
            Some(Decimal::new(300, 0))
        );
        assert_eq!(kind.expected_amount_for_month(2025, 3), None);
    }

    #[test]
    fn budget_type_from_str() {
        assert_eq!(
            "expense".parse::<BudgetType>().unwrap(),
            BudgetType::Expense
        );
        assert_eq!("income".parse::<BudgetType>().unwrap(), BudgetType::Income);
        assert_eq!(
            "savings".parse::<BudgetType>().unwrap(),
            BudgetType::Savings
        );
        assert!("other".parse::<BudgetType>().is_err());
    }

    #[test]
    fn label_pattern_matches_empty_pattern() {
        // An empty Contains pattern matches anything
        let p = LabelPattern::Contains(String::new());
        assert!(p.matches("ANYTHING"));
        assert!(p.matches(""));
    }

    #[test]
    fn recurrence_from_str() {
        assert_eq!("weekly".parse::<Recurrence>().unwrap(), Recurrence::Weekly);
        assert_eq!(
            "monthly".parse::<Recurrence>().unwrap(),
            Recurrence::Monthly
        );
        assert_eq!(
            "quarterly".parse::<Recurrence>().unwrap(),
            Recurrence::Quarterly
        );
        assert_eq!("yearly".parse::<Recurrence>().unwrap(), Recurrence::Yearly);
        assert!("daily".parse::<Recurrence>().is_err());
    }

    #[test]
    fn recurrence_as_str() {
        assert_eq!(Recurrence::Weekly.as_str(), "weekly");
        assert_eq!(Recurrence::Monthly.as_str(), "monthly");
        assert_eq!(Recurrence::Quarterly.as_str(), "quarterly");
        assert_eq!(Recurrence::Yearly.as_str(), "yearly");
    }

    #[test]
    fn expected_amount_for_month_recurring_weekly() {
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Weekly,
            closed_periods: vec![],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: None,
                amount: Decimal::new(100, 0),
            },
        };
        for (year, month) in [(2024, 1), (2024, 2), (2025, 2), (2024, 4)] {
            assert_eq!(
                kind.expected_amount_for_month(year, month),
                Some(Decimal::new(400, 0)),
                "{year}-{month}"
            );
        }
    }

    fn cyclic_kind(recurrence: Recurrence, closed_start: YearMonth) -> BudgetKind {
        BudgetKind::Recurring {
            recurrence,
            closed_periods: vec![ClosedPeriod {
                start: closed_start,
                end: YearMonth::new(2023, 12),
                amount: Decimal::new(-300, 0),
            }],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 3),
                end: None,
                amount: Decimal::new(-400, 0),
            },
        }
    }

    #[test]
    fn expected_amount_for_month_cycles_from_the_covering_period_start() {
        let closed = Some(Decimal::new(-300, 0));
        let current = Some(Decimal::new(-400, 0));
        let cases = [
            (Recurrence::Quarterly, (2023, 2), closed),
            (Recurrence::Quarterly, (2023, 3), None),
            (Recurrence::Quarterly, (2023, 5), closed),
            (Recurrence::Quarterly, (2023, 11), closed),
            (Recurrence::Quarterly, (2024, 1), None),
            (Recurrence::Quarterly, (2024, 3), current),
            (Recurrence::Quarterly, (2024, 4), None),
            (Recurrence::Quarterly, (2024, 6), current),
            (Recurrence::Quarterly, (2025, 3), current),
            (Recurrence::Yearly, (2023, 2), closed),
            (Recurrence::Yearly, (2023, 3), None),
            (Recurrence::Yearly, (2024, 3), current),
            (Recurrence::Yearly, (2024, 6), None),
            (Recurrence::Yearly, (2025, 3), current),
            (Recurrence::Yearly, (2026, 2), None),
        ];
        for (recurrence, (year, month), expected) in cases {
            let kind = cyclic_kind(recurrence, YearMonth::new(2023, 2));
            assert_eq!(
                kind.expected_amount_for_month(year, month),
                expected,
                "{recurrence:?} {year}-{month}"
            );
        }
    }

    #[test]
    fn year_month_navigation() {
        assert_eq!(YearMonth::new(2024, 12).next(), YearMonth::new(2025, 1));
        assert_eq!(YearMonth::new(2024, 3).next(), YearMonth::new(2024, 4));
        assert_eq!(
            YearMonth::of(NaiveDate::from_ymd_opt(2024, 2, 17).unwrap()),
            YearMonth::new(2024, 2)
        );
        assert_eq!(
            YearMonth::new(2024, 2).last_day(),
            NaiveDate::from_ymd_opt(2024, 2, 29)
        );
        assert_eq!(YearMonth::new(2024, 13).first_day(), None);
    }

    #[test]
    fn expected_amount_for_month_recurring_yearly() {
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Yearly,
            closed_periods: vec![],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: Some(YearMonth::new(2024, 12)),
                amount: Decimal::new(12000, 0),
            },
        };
        assert_eq!(
            kind.expected_amount_for_month(2024, 1),
            Some(Decimal::new(12000, 0))
        );
        assert_eq!(kind.expected_amount_for_month(2025, 1), None);
    }

    #[test]
    fn validate_no_overlap_ok_disjoint_periods() {
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![
                ClosedPeriod {
                    start: YearMonth::new(2023, 1),
                    end: YearMonth::new(2023, 6),
                    amount: Decimal::new(800, 0),
                },
                ClosedPeriod {
                    start: YearMonth::new(2023, 7),
                    end: YearMonth::new(2023, 12),
                    amount: Decimal::new(900, 0),
                },
            ],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: None,
                amount: Decimal::new(1000, 0),
            },
        };
        assert!(kind.validate_no_overlap().is_ok());
    }

    #[test]
    fn validate_no_overlap_err_closed_periods_overlap() {
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![
                ClosedPeriod {
                    start: YearMonth::new(2023, 1),
                    end: YearMonth::new(2023, 8),
                    amount: Decimal::new(800, 0),
                },
                ClosedPeriod {
                    start: YearMonth::new(2023, 6),
                    end: YearMonth::new(2023, 12),
                    amount: Decimal::new(900, 0),
                },
            ],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: None,
                amount: Decimal::new(1000, 0),
            },
        };
        let err = kind.validate_no_overlap().unwrap_err();
        assert!(err.contains("closed periods 0 and 1 overlap"));
    }

    #[test]
    fn validate_no_overlap_err_current_overlaps_closed() {
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![ClosedPeriod {
                start: YearMonth::new(2024, 1),
                end: YearMonth::new(2024, 6),
                amount: Decimal::new(800, 0),
            }],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 3),
                end: None,
                amount: Decimal::new(1000, 0),
            },
        };
        let err = kind.validate_no_overlap().unwrap_err();
        assert!(err.contains("current period overlaps with closed period 0"));
    }

    #[test]
    fn validate_no_overlap_ok_occasional() {
        let kind = BudgetKind::Occasional {
            month: 3,
            year: 2024,
            amount: Decimal::new(500, 0),
        };
        assert!(kind.validate_no_overlap().is_ok());
    }

    #[test]
    fn validate_no_overlap_ok_single_current_period() {
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: None,
                amount: Decimal::new(1000, 0),
            },
        };
        assert!(kind.validate_no_overlap().is_ok());
    }

    #[test]
    fn validate_no_overlap_err_open_ended_current_overlaps() {
        let kind = BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![ClosedPeriod {
                start: YearMonth::new(2025, 1),
                end: YearMonth::new(2025, 6),
                amount: Decimal::new(800, 0),
            }],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: None,
                amount: Decimal::new(1000, 0),
            },
        };
        let err = kind.validate_no_overlap().unwrap_err();
        assert!(err.contains("current period overlaps with closed period 0"));
    }
}
