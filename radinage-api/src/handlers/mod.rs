pub mod accounts;
pub mod auth;
pub mod budgets;
pub mod categories;
pub mod data;
pub mod forecast;
pub mod ignore_rules;
pub mod import;
pub mod import_profiles;
pub mod monthly_operations;
pub mod operations;
pub mod summary;
pub mod transfer_rules;
pub mod users;

use crate::{
    domain::budget::LabelPattern,
    error::{AppError, AppResult},
};

/// A rule's label pattern with its value trimmed, `BadRequest` unless 1 to `max_len`
/// characters remain.
fn trimmed_label_pattern(pattern: LabelPattern, max_len: usize) -> AppResult<LabelPattern> {
    let trim = |value: String| {
        let value = value.trim().to_string();
        if value.is_empty() || value.chars().count() > max_len {
            return Err(AppError::BadRequest(format!(
                "pattern value must be 1 to {max_len} characters"
            )));
        }
        Ok(value)
    };
    Ok(match pattern {
        LabelPattern::StartsWith(v) => LabelPattern::StartsWith(trim(v)?),
        LabelPattern::EndsWith(v) => LabelPattern::EndsWith(trim(v)?),
        LabelPattern::Contains(v) => LabelPattern::Contains(trim(v)?),
    })
}
