pub mod budget;
pub mod category;
pub mod import_profile;
pub mod operation;
pub mod user;

use crate::{
    domain::budget::LabelPattern,
    error::{AppError, AppResult},
};
use schemars::JsonSchema;
use serde::Deserialize;

pub use budget::{BudgetRepository, BudgetSortField, ListBudgetsParams, PgBudgetRepository};
pub use category::{CategoryRepository, PgCategoryRepository};
pub use import_profile::{ImportProfileRepository, PgImportProfileRepository};
pub use operation::{
    CategoryFilter, CategoryTotal, ListOperationsParams, OperationDirection, OperationRepository,
    OperationSortField, OperationTotals, PgOperationRepository, SummaryCategory, SummaryRow,
};
pub use user::{PgUserRepository, UserRepository};

/// Sort direction shared across all list endpoints.
#[derive(Debug, Deserialize, Clone, Copy, Default, JsonSchema)]
#[schemars(transform = crate::schema::flatten_string_enum)]
#[serde(rename_all = "camelCase")]
pub enum SortOrder {
    /// Ascending order (oldest/lowest first).
    Asc,
    /// Descending order (newest/highest first). This is the default.
    #[default]
    Desc,
}

impl SortOrder {
    pub fn as_sql(&self) -> &'static str {
        match self {
            Self::Asc => "ASC",
            Self::Desc => "DESC",
        }
    }
}

/// The `pattern_type` and `pattern_value` columns a rule's label pattern is stored in.
fn label_pattern_to_cols(pattern: &LabelPattern) -> (&'static str, &str) {
    match pattern {
        LabelPattern::StartsWith(v) => ("starts_with", v.as_str()),
        LabelPattern::EndsWith(v) => ("ends_with", v.as_str()),
        LabelPattern::Contains(v) => ("contains", v.as_str()),
    }
}

/// The label pattern stored in a rule's `pattern_type` and `pattern_value` columns.
fn label_pattern_from_cols(pattern_type: &str, value: String) -> AppResult<LabelPattern> {
    match pattern_type {
        "starts_with" => Ok(LabelPattern::StartsWith(value)),
        "ends_with" => Ok(LabelPattern::EndsWith(value)),
        "contains" => Ok(LabelPattern::Contains(value)),
        other => Err(AppError::Internal(format!(
            "invalid pattern_type in DB: {other}"
        ))),
    }
}

#[cfg(test)]
pub use budget::MockBudgetRepository;
#[cfg(test)]
pub use category::MockCategoryRepository;
#[cfg(test)]
pub use import_profile::MockImportProfileRepository;
#[cfg(test)]
pub use operation::MockOperationRepository;
#[cfg(test)]
pub use user::{MockUserRepository, UserCredentials};
