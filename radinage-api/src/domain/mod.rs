pub mod budget;
pub mod operation;
pub mod user;

use chrono::NaiveDate;

/// Return the last day of the given month, or `None` for invalid year/month.
pub fn last_day_of_month(year: i32, month: u32) -> Option<NaiveDate> {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(next_year, next_month, 1).and_then(|d| d.pred_opt())
}
