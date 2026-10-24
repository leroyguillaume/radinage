use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Character separating the fields of a CSV file.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[schemars(transform = crate::schema::flatten_string_enum)]
#[serde(rename_all = "lowercase")]
pub enum CsvDelimiter {
    /// `,`
    #[default]
    Comma,
    /// `;`
    Semicolon,
    /// A tab character.
    Tab,
    /// `|`
    Pipe,
}

impl CsvDelimiter {
    pub fn as_str(&self) -> &'static str {
        match self {
            CsvDelimiter::Comma => "comma",
            CsvDelimiter::Semicolon => "semicolon",
            CsvDelimiter::Tab => "tab",
            CsvDelimiter::Pipe => "pipe",
        }
    }

    /// The byte the CSV reader splits fields on.
    pub fn as_byte(&self) -> u8 {
        match self {
            CsvDelimiter::Comma => b',',
            CsvDelimiter::Semicolon => b';',
            CsvDelimiter::Tab => b'\t',
            CsvDelimiter::Pipe => b'|',
        }
    }
}

impl std::str::FromStr for CsvDelimiter {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "comma" => Ok(CsvDelimiter::Comma),
            "semicolon" => Ok(CsvDelimiter::Semicolon),
            "tab" => Ok(CsvDelimiter::Tab),
            "pipe" => Ok(CsvDelimiter::Pipe),
            other => Err(format!("unknown CSV delimiter: {other}")),
        }
    }
}

/// Where the label, amount and date sit in a bank statement file, and how to read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportProfileFields {
    pub name: String,
    pub label_col: usize,
    pub amount_col: usize,
    pub date_col: usize,
    pub date_format: String,
    pub skip_lines: usize,
    pub csv_delimiter: CsvDelimiter,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delimiter_round_trips_through_its_name() {
        for d in [
            CsvDelimiter::Comma,
            CsvDelimiter::Semicolon,
            CsvDelimiter::Tab,
            CsvDelimiter::Pipe,
        ] {
            assert_eq!(d.as_str().parse::<CsvDelimiter>(), Ok(d));
        }
        assert!("colon".parse::<CsvDelimiter>().is_err());
    }
}
