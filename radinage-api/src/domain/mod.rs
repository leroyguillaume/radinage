/// Declares a unit enum stored and sent as one fixed string per variant, with the
/// `as_str` / `FromStr` pair repositories read and write it through. The strings must
/// match the enum's serde names: a test per enum checks it over `ALL`.
macro_rules! string_enum {
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident ($what:literal) {
            $($(#[$vmeta:meta])* $variant:ident => $str:literal,)+
        }
    ) => {
        $(#[$meta])*
        $vis enum $name {
            $($(#[$vmeta])* $variant,)+
        }

        impl $name {
            #[cfg(test)]
            pub const ALL: &[Self] = &[$(Self::$variant,)+];

            pub fn as_str(&self) -> &'static str {
                match self {
                    $(Self::$variant => $str,)+
                }
            }
        }

        impl std::str::FromStr for $name {
            type Err = String;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                match s {
                    $($str => Ok(Self::$variant),)+
                    other => Err(format!("unknown {}: {other}", $what)),
                }
            }
        }
    };
}

pub mod account;
pub mod budget;
pub mod category;
pub mod ignore_rule;
pub mod import_profile;
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
