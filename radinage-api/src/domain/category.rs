use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Colour a category is shown with, a key of the web app's palette.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[schemars(transform = crate::schema::flatten_string_enum)]
#[serde(rename_all = "camelCase")]
pub enum CategoryColor {
    Forest,
    Blue,
    Cyan,
    Teal,
    Lime,
    Yellow,
    Orange,
    Red,
    Pink,
    Grape,
    Violet,
    Indigo,
    Gray,
}

impl CategoryColor {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Forest => "forest",
            Self::Blue => "blue",
            Self::Cyan => "cyan",
            Self::Teal => "teal",
            Self::Lime => "lime",
            Self::Yellow => "yellow",
            Self::Orange => "orange",
            Self::Red => "red",
            Self::Pink => "pink",
            Self::Grape => "grape",
            Self::Violet => "violet",
            Self::Indigo => "indigo",
            Self::Gray => "gray",
        }
    }
}

impl std::str::FromStr for CategoryColor {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "forest" => Ok(Self::Forest),
            "blue" => Ok(Self::Blue),
            "cyan" => Ok(Self::Cyan),
            "teal" => Ok(Self::Teal),
            "lime" => Ok(Self::Lime),
            "yellow" => Ok(Self::Yellow),
            "orange" => Ok(Self::Orange),
            "red" => Ok(Self::Red),
            "pink" => Ok(Self::Pink),
            "grape" => Ok(Self::Grape),
            "violet" => Ok(Self::Violet),
            "indigo" => Ok(Self::Indigo),
            "gray" => Ok(Self::Gray),
            other => Err(format!("unknown category color: {other}")),
        }
    }
}

/// What a user chooses for a category.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CategoryFields {
    pub name: String,
    pub color: CategoryColor,
}

/// A user-defined category operations are sorted into.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Category {
    pub id: Uuid,
    pub user_id: Uuid,
    pub fields: CategoryFields,
    pub created_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_round_trips_through_its_string() {
        for color in [
            CategoryColor::Forest,
            CategoryColor::Grape,
            CategoryColor::Gray,
        ] {
            assert_eq!(color.as_str().parse::<CategoryColor>(), Ok(color));
            assert_eq!(
                serde_json::to_string(&color).unwrap(),
                format!("\"{}\"", color.as_str())
            );
        }
    }

    #[test]
    fn unknown_color_is_rejected() {
        assert!("purple".parse::<CategoryColor>().is_err());
    }
}
