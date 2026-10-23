use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Colour a category is shown with, stored as lowercase `#rrggbb`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct CategoryColor(String);

/// Palette keys category colours were once limited to, with their `#rrggbb` value:
/// exports made then still carry them, and migration 017 converted stored ones.
const PALETTE: &[(&str, &str)] = &[
    ("forest", "#327f56"),
    ("blue", "#228be6"),
    ("cyan", "#15aabf"),
    ("teal", "#12b886"),
    ("lime", "#82c91e"),
    ("yellow", "#fab005"),
    ("orange", "#fd7e14"),
    ("red", "#fa5252"),
    ("pink", "#e64980"),
    ("grape", "#be4bdb"),
    ("violet", "#7950f2"),
    ("indigo", "#4c6ef5"),
    ("gray", "#868e96"),
];

impl CategoryColor {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::str::FromStr for CategoryColor {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if let Some((_, hex)) = PALETTE.iter().find(|(key, _)| *key == s) {
            return Ok(Self((*hex).to_string()));
        }
        match s.strip_prefix('#') {
            Some(digits) if digits.len() == 6 && digits.chars().all(|c| c.is_ascii_hexdigit()) => {
                Ok(Self(s.to_ascii_lowercase()))
            }
            _ => Err(format!("category color must be #rrggbb, got {s:?}")),
        }
    }
}

impl TryFrom<String> for CategoryColor {
    type Error = String;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        s.parse()
    }
}

impl From<CategoryColor> for String {
    fn from(color: CategoryColor) -> Self {
        color.0
    }
}

impl JsonSchema for CategoryColor {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "CategoryColor".into()
    }

    fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
        schemars::json_schema!({
            "type": "string",
            "pattern": "^#[0-9a-fA-F]{6}$",
            "description": "Colour a category is shown with, as #rrggbb.",
            "example": "#12b886",
        })
    }
}

string_enum! {
    /// Icon a category is shown with, drawn by the web app from its own icon set.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
    #[schemars(transform = crate::schema::flatten_string_enum)]
    #[serde(rename_all = "camelCase")]
    pub enum CategoryIcon ("category icon") {
        Cart => "cart",
        Bakery => "bakery",
        Home => "home",
        Rental => "rental",
        Mortgage => "mortgage",
        Apartment => "apartment",
        RealEstate => "realEstate",
        Furniture => "furniture",
        Cleaning => "cleaning",
        Laundry => "laundry",
        Moving => "moving",
        Car => "car",
        Motorbike => "motorbike",
        Bike => "bike",
        Bus => "bus",
        Train => "train",
        Fuel => "fuel",
        Parking => "parking",
        Tolls => "tolls",
        Plane => "plane",
        Restaurant => "restaurant",
        FastFood => "fastFood",
        Coffee => "coffee",
        Drinks => "drinks",
        Health => "health",
        Pharmacy => "pharmacy",
        Doctor => "doctor",
        Dentist => "dentist",
        Optician => "optician",
        Clothes => "clothes",
        OnlineShopping => "onlineShopping",
        Gift => "gift",
        Phone => "phone",
        Internet => "internet",
        Computer => "computer",
        Tv => "tv",
        Electricity => "electricity",
        Water => "water",
        Heating => "heating",
        Education => "education",
        Books => "books",
        Baby => "baby",
        Pets => "pets",
        Movies => "movies",
        Tickets => "tickets",
        Music => "music",
        Photo => "photo",
        Hobbies => "hobbies",
        Games => "games",
        Gambling => "gambling",
        Sport => "sport",
        Fitness => "fitness",
        Holidays => "holidays",
        Accommodation => "accommodation",
        Camping => "camping",
        Repairs => "repairs",
        Bills => "bills",
        Post => "post",
        Taxes => "taxes",
        Bank => "bank",
        Fees => "fees",
        Loan => "loan",
        Transfer => "transfer",
        Refund => "refund",
        Savings => "savings",
        Investments => "investments",
        Crypto => "crypto",
        Cash => "cash",
        Wallet => "wallet",
        Card => "card",
        Salary => "salary",
        Bonus => "bonus",
        Business => "business",
        Pension => "pension",
        Benefits => "benefits",
        Insurance => "insurance",
        Beauty => "beauty",
        Tobacco => "tobacco",
        Garden => "garden",
        Charity => "charity",
        Subscriptions => "subscriptions",
        Family => "family",
        Other => "other",
    }
}

/// What a user chooses for a category.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CategoryFields {
    pub name: String,
    pub color: CategoryColor,
    /// Shown inside the colour; without one, the colour alone identifies the category.
    pub icon: Option<CategoryIcon>,
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

    fn assert_round_trips<T>(all: &[T], as_str: impl Fn(&T) -> &'static str)
    where
        T: std::str::FromStr<Err = String> + Serialize + PartialEq + std::fmt::Debug,
    {
        for value in all {
            assert_eq!(as_str(value).parse::<T>().as_ref(), Ok(value));
            assert_eq!(
                serde_json::to_string(value).unwrap(),
                format!("\"{}\"", as_str(value))
            );
        }
    }

    #[test]
    fn color_is_lowercased_and_sent_as_its_string() {
        let color: CategoryColor = "#12B886".parse().unwrap();
        assert_eq!(color.as_str(), "#12b886");
        assert_eq!(serde_json::to_string(&color).unwrap(), "\"#12b886\"");
    }

    #[test]
    fn color_accepts_a_palette_key() {
        assert_eq!("teal".parse::<CategoryColor>().unwrap().as_str(), "#12b886");
    }

    #[test]
    fn icon_round_trips_through_its_string() {
        assert_round_trips(CategoryIcon::ALL, CategoryIcon::as_str);
    }

    #[test]
    fn unknown_color_is_rejected() {
        for color in ["purple", "#12b88", "#12b8867", "12b886", "#12b88g"] {
            assert!(color.parse::<CategoryColor>().is_err(), "{color}");
        }
    }

    #[test]
    fn unknown_icon_is_rejected() {
        assert!("rocket".parse::<CategoryIcon>().is_err());
    }
}
