//! An account's balance day by day, from the balances read on it and the money it moved.
//!
//! The latest balance read on or before a day, plus what the account moved after it up to
//! that day, gives the balance that day; before the first balance, that first balance minus
//! what was moved from the day to it. A balance read replaces the estimate: what the
//! previous balance plus the movements predicted for its day is kept as its `estimated`.

use crate::domain::account::{AccountBalance, DailyMovement};
use chrono::NaiveDate;
use rust_decimal::Decimal;

/// The balance of an account at the end of `date`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BalancePoint {
    pub date: NaiveDate,
    pub balance: Decimal,
    /// Whether a balance was read that day: `balance` is then that reading.
    pub read: bool,
    /// On a day a balance was read after an earlier one, what the earlier one plus the
    /// movements in between estimated.
    pub estimated: Option<Decimal>,
}

/// Running total of the movements, to sum any range of days in logarithmic time.
struct Cumulative<'a> {
    movements: &'a [DailyMovement],
    totals: Vec<Decimal>,
}

impl<'a> Cumulative<'a> {
    /// `movements` sorted by date, at most one per day.
    fn new(movements: &'a [DailyMovement]) -> Self {
        let totals = movements
            .iter()
            .scan(Decimal::ZERO, |sum, m| {
                *sum += m.amount;
                Some(*sum)
            })
            .collect();
        Self { movements, totals }
    }

    /// Sum of the movements dated `date` or earlier.
    fn through(&self, date: NaiveDate) -> Decimal {
        let count = self.movements.partition_point(|m| m.date <= date);
        count
            .checked_sub(1)
            .map_or(Decimal::ZERO, |last| self.totals[last])
    }
}

/// Balance at the end of `date`, from `readings` sorted by date and not empty.
fn balance_on(readings: &[AccountBalance], cumulative: &Cumulative, date: NaiveDate) -> Decimal {
    let latest = readings.partition_point(|r| r.date <= date);
    let from = readings[latest.saturating_sub(1)];
    from.amount + cumulative.through(date) - cumulative.through(from.date)
}

/// What each of `readings`, sorted by date, was estimated at from the one before it; `None`
/// for the first one.
pub fn estimates(readings: &[AccountBalance], movements: &[DailyMovement]) -> Vec<Option<Decimal>> {
    let cumulative = Cumulative::new(movements);
    let previous = std::iter::once(None).chain(readings.iter().map(Some));
    readings
        .iter()
        .zip(previous)
        .map(|(reading, previous)| {
            previous
                .map(|p| p.amount + cumulative.through(reading.date) - cumulative.through(p.date))
        })
        .collect()
}

/// The balance from `from` to `to`, with a point on each of those days a balance was read or
/// something moved, plus both ends. Starts no earlier than the first balance or the eve of
/// the first movement, before which nothing is known; empty without any balance.
pub fn timeline(
    readings: &[AccountBalance],
    movements: &[DailyMovement],
    from: Option<NaiveDate>,
    to: NaiveDate,
) -> Vec<BalancePoint> {
    let Some(first) = readings.first() else {
        return Vec::new();
    };
    let known_from = movements
        .first()
        .and_then(|m| m.date.pred_opt())
        .map_or(first.date, |eve| eve.min(first.date));
    let start = from.map_or(known_from, |from| from.max(known_from));
    if start > to {
        return Vec::new();
    }

    let cumulative = Cumulative::new(movements);
    let estimated = estimates(readings, movements);
    let mut days: Vec<NaiveDate> = readings
        .iter()
        .map(|r| r.date)
        .chain(movements.iter().map(|m| m.date))
        .filter(|d| (start..=to).contains(d))
        .chain([start, to])
        .collect();
    days.sort_unstable();
    days.dedup();

    days.into_iter()
        .map(|date| {
            let reading = readings.iter().position(|r| r.date == date);
            BalancePoint {
                date,
                balance: balance_on(readings, &cumulative, date),
                read: reading.is_some(),
                estimated: reading.and_then(|i| estimated[i]),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn date(m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, d).unwrap()
    }

    fn reading(amount: Decimal, on: NaiveDate) -> AccountBalance {
        AccountBalance { amount, date: on }
    }

    fn moved(amount: Decimal, on: NaiveDate) -> DailyMovement {
        DailyMovement { date: on, amount }
    }

    fn point(on: NaiveDate, balance: Decimal) -> BalancePoint {
        BalancePoint {
            date: on,
            balance,
            read: false,
            estimated: None,
        }
    }

    #[test]
    fn each_reading_after_the_first_keeps_what_was_estimated_for_its_day() {
        let readings = [
            reading(dec!(8240), date(3, 31)),
            reading(dec!(8955.10), date(6, 30)),
            reading(dec!(8742.30), date(9, 30)),
        ];
        let movements = [
            // Included in the first reading.
            moved(dec!(200), date(3, 31)),
            moved(dec!(200), date(4, 10)),
            moved(dec!(200), date(5, 10)),
            moved(dec!(200), date(6, 10)),
            moved(dec!(200), date(7, 10)),
            moved(dec!(200), date(8, 10)),
            moved(dec!(200), date(9, 10)),
        ];

        assert_eq!(
            estimates(&readings, &movements),
            [None, Some(dec!(8840)), Some(dec!(9555.10))]
        );
    }

    #[test]
    fn the_timeline_follows_the_movements_and_resets_on_each_reading() {
        let readings = [
            reading(dec!(1000), date(3, 31)),
            reading(dec!(1150), date(5, 31)),
        ];
        let movements = [
            moved(dec!(100), date(4, 10)),
            moved(dec!(100), date(5, 10)),
            moved(dec!(100), date(6, 10)),
        ];

        let points = timeline(&readings, &movements, Some(date(4, 1)), date(6, 20));

        assert_eq!(
            points,
            [
                point(date(4, 1), dec!(1000)),
                point(date(4, 10), dec!(1100)),
                point(date(5, 10), dec!(1200)),
                BalancePoint {
                    read: true,
                    estimated: Some(dec!(1200)),
                    ..point(date(5, 31), dec!(1150))
                },
                point(date(6, 10), dec!(1250)),
                point(date(6, 20), dec!(1250)),
            ]
        );
    }

    #[test]
    fn before_the_first_reading_its_movements_are_taken_back_out() {
        let readings = [reading(dec!(500), date(3, 15))];
        let movements = [
            moved(dec!(-40), date(3, 2)),
            moved(dec!(-60), date(3, 10)),
            moved(dec!(25), date(3, 20)),
        ];

        let points = timeline(&readings, &movements, None, date(3, 20));

        assert_eq!(
            points,
            [
                point(date(3, 1), dec!(600)),
                point(date(3, 2), dec!(560)),
                point(date(3, 10), dec!(500)),
                BalancePoint {
                    read: true,
                    ..point(date(3, 15), dec!(500))
                },
                point(date(3, 20), dec!(525)),
            ]
        );
    }

    #[test]
    fn the_balance_before_the_first_movement_is_drawn_on_its_eve() {
        let readings = [reading(dec!(14408.55), date(10, 24))];
        let movements = [
            moved(dec!(-2000), date(6, 16)),
            moved(dec!(-2000), date(8, 1)),
            moved(dec!(-1000), date(9, 1)),
            moved(dec!(-4000), date(9, 16)),
        ];

        let points = timeline(&readings, &movements, Some(date(1, 1)), date(10, 24));

        assert_eq!(
            points[..2],
            [
                point(date(6, 15), dec!(23408.55)),
                point(date(6, 16), dec!(21408.55)),
            ]
        );
    }

    #[test]
    fn nothing_is_known_before_the_first_reading_or_movement_nor_without_a_reading() {
        let readings = [reading(dec!(500), date(3, 15))];

        assert_eq!(
            timeline(&readings, &[], Some(date(1, 1)), date(3, 31)),
            [
                BalancePoint {
                    read: true,
                    ..point(date(3, 15), dec!(500))
                },
                point(date(3, 31), dec!(500)),
            ]
        );
        assert!(timeline(&readings, &[], Some(date(4, 1)), date(3, 31)).is_empty());
        assert!(timeline(&[], &[moved(dec!(1), date(3, 1))], None, date(3, 31)).is_empty());
    }
}
