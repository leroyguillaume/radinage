/// Transforms a schemars-generated `oneOf [{ const: "a" }, { const: "b" }]` schema
/// into the simpler `{ type: "string", enum: ["a", "b"] }` form that Scalar renders
/// correctly.
pub fn flatten_string_enum(schema: &mut schemars::Schema) {
    let Some(obj) = schema.as_object_mut() else {
        return;
    };
    let Some(one_of) = obj.get("oneOf").and_then(|v| v.as_array()).cloned() else {
        return;
    };
    let values: Vec<serde_json::Value> = one_of
        .iter()
        .filter_map(|v| v.as_object()?.get("const").cloned())
        .collect();
    if values.len() != one_of.len() {
        return;
    }
    obj.remove("oneOf");
    obj.insert("type".into(), serde_json::Value::String("string".into()));
    obj.insert("enum".into(), serde_json::Value::Array(values));
}

#[cfg(test)]
mod tests {
    use super::*;
    use schemars::Schema;

    #[test]
    fn converts_one_of_const_to_enum() {
        let mut schema: Schema = serde_json::from_value(serde_json::json!({
            "oneOf": [
                { "const": "expense" },
                { "const": "income" },
                { "const": "savings" }
            ]
        }))
        .unwrap();

        flatten_string_enum(&mut schema);

        let obj = schema.as_object().unwrap();
        assert_eq!(obj.get("type").unwrap(), "string");
        assert_eq!(
            obj.get("enum").unwrap(),
            &serde_json::json!(["expense", "income", "savings"])
        );
        assert!(obj.get("oneOf").is_none());
    }

    #[test]
    fn leaves_non_const_one_of_untouched() {
        let original = serde_json::json!({
            "oneOf": [
                { "type": "object", "properties": {} },
                { "type": "object", "properties": {} }
            ]
        });
        let mut schema: Schema = serde_json::from_value(original.clone()).unwrap();

        flatten_string_enum(&mut schema);

        assert_eq!(serde_json::to_value(&schema).unwrap(), original);
    }
}
