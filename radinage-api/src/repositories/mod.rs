pub mod budget;
pub mod operation;
pub mod user;

use schemars::JsonSchema;
use serde::Deserialize;

pub use budget::{BudgetRepository, BudgetSortField, ListBudgetsParams, PgBudgetRepository};
pub use operation::{
    ListOperationsParams, OperationRepository, OperationSortField, PgOperationRepository,
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

#[cfg(test)]
pub use budget::MockBudgetRepository;
#[cfg(test)]
pub use operation::{MockOperationRepository, SummaryRow};
#[cfg(test)]
pub use user::{MockUserRepository, UserCredentials};
