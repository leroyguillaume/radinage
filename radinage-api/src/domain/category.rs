use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

string_enum! {
    /// Colour a category is shown with, a key of the web app's palette.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
    #[schemars(transform = crate::schema::flatten_string_enum)]
    #[serde(rename_all = "camelCase")]
    pub enum CategoryColor ("category color") {
        Forest => "forest",
        Blue => "blue",
        Cyan => "cyan",
        Teal => "teal",
        Lime => "lime",
        Yellow => "yellow",
        Orange => "orange",
        Red => "red",
        Pink => "pink",
        Grape => "grape",
        Violet => "violet",
        Indigo => "indigo",
        Gray => "gray",
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
    fn color_round_trips_through_its_string() {
        assert_round_trips(CategoryColor::ALL, CategoryColor::as_str);
    }

    #[test]
    fn icon_round_trips_through_its_string() {
        assert_round_trips(CategoryIcon::ALL, CategoryIcon::as_str);
    }

    #[test]
    fn unknown_color_is_rejected() {
        assert!("purple".parse::<CategoryColor>().is_err());
    }

    #[test]
    fn unknown_icon_is_rejected() {
        assert!("rocket".parse::<CategoryIcon>().is_err());
    }
}
