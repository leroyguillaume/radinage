use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Where the label, amount and date sit in a bank statement file, and how to read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportProfileFields {
    pub name: String,
    pub label_col: usize,
    pub amount_col: usize,
    pub date_col: usize,
    pub date_format: String,
    pub skip_lines: usize,
}

/// A named file layout a user imports operations with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportProfile {
    pub id: Uuid,
    pub user_id: Uuid,
    pub fields: ImportProfileFields,
    /// When an import last used this profile, `None` if never.
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}
