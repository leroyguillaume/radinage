//! SQL behind the transfer rule methods of [`super::PgAccountRepository`]: a rule belongs to
//! the account whose operations it applies to.

use crate::{
    domain::transfer::{TransferRule, TransferRuleFields},
    error::AppResult,
    repositories::{label_pattern_from_cols, label_pattern_to_cols},
};
use sqlx::{PgPool, Row, postgres::PgRow};
use uuid::Uuid;

const COLUMNS: &str = "id, user_id, account_id, counterpart_account_id, pattern_type, \
     pattern_value, counterpart_pattern_type, counterpart_pattern_value, created_at";

fn row_to_rule(row: &PgRow) -> AppResult<TransferRule> {
    let pattern_type: &str = row.try_get("pattern_type")?;
    let counterpart_type: Option<&str> = row.try_get("counterpart_pattern_type")?;
    let counterpart_value: Option<String> = row.try_get("counterpart_pattern_value")?;
    Ok(TransferRule {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        fields: TransferRuleFields {
            account_id: row.try_get("account_id")?,
            counterpart_account_id: row.try_get("counterpart_account_id")?,
            label_pattern: label_pattern_from_cols(pattern_type, row.try_get("pattern_value")?)?,
            counterpart_label_pattern: counterpart_type
                .zip(counterpart_value)
                .map(|(t, v)| label_pattern_from_cols(t, v))
                .transpose()?,
        },
        created_at: row.try_get("created_at")?,
    })
}

/// The `counterpart_pattern_*` columns, both null without a pattern for the other side.
fn counterpart_cols(fields: &TransferRuleFields) -> (Option<&'static str>, Option<&str>) {
    fields
        .counterpart_label_pattern
        .as_ref()
        .map(label_pattern_to_cols)
        .unzip()
}

pub(super) async fn list(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<TransferRule>> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM transfer_rules WHERE user_id = $1 ORDER BY created_at, id"
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(row_to_rule).collect()
}

pub(super) async fn count(pool: &PgPool, user_id: Uuid) -> AppResult<i64> {
    let row = sqlx::query("SELECT COUNT(*) AS n FROM transfer_rules WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await?;
    Ok(row.try_get("n")?)
}

pub(super) async fn find(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> AppResult<Option<TransferRule>> {
    let row = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM transfer_rules WHERE id = $1 AND user_id = $2"
    ))
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(row_to_rule).transpose()
}

pub(super) async fn create(
    pool: &PgPool,
    user_id: Uuid,
    fields: &TransferRuleFields,
) -> AppResult<TransferRule> {
    let (pattern_type, pattern_value) = label_pattern_to_cols(&fields.label_pattern);
    let (counterpart_type, counterpart_value) = counterpart_cols(fields);
    let row = sqlx::query(&format!(
        "INSERT INTO transfer_rules
             (user_id, account_id, counterpart_account_id, pattern_type, pattern_value,
              counterpart_pattern_type, counterpart_pattern_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING {COLUMNS}"
    ))
    .bind(user_id)
    .bind(fields.account_id)
    .bind(fields.counterpart_account_id)
    .bind(pattern_type)
    .bind(pattern_value)
    .bind(counterpart_type)
    .bind(counterpart_value)
    .fetch_one(pool)
    .await?;
    row_to_rule(&row)
}

pub(super) async fn update(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    fields: &TransferRuleFields,
) -> AppResult<Option<TransferRule>> {
    let (pattern_type, pattern_value) = label_pattern_to_cols(&fields.label_pattern);
    let (counterpart_type, counterpart_value) = counterpart_cols(fields);
    let row = sqlx::query(&format!(
        "UPDATE transfer_rules
         SET account_id = $3, counterpart_account_id = $4, pattern_type = $5, pattern_value = $6,
             counterpart_pattern_type = $7, counterpart_pattern_value = $8
         WHERE id = $1 AND user_id = $2 RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(user_id)
    .bind(fields.account_id)
    .bind(fields.counterpart_account_id)
    .bind(pattern_type)
    .bind(pattern_value)
    .bind(counterpart_type)
    .bind(counterpart_value)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(row_to_rule).transpose()
}

pub(super) async fn delete(pool: &PgPool, id: Uuid, user_id: Uuid) -> AppResult<bool> {
    let mut tx = pool.begin().await?;
    // The other side of a transfer the rule made stays one only through a rule of its own.
    sqlx::query(
        "UPDATE operations p
         SET transfer_operation_id = NULL,
             transfer_account_id = CASE WHEN p.transfer_rule_id IS NULL THEN NULL
                                        ELSE p.transfer_account_id END
         WHERE p.user_id = $2 AND p.transfer_rule_id IS DISTINCT FROM $1
           AND p.transfer_operation_id IN (SELECT id FROM operations WHERE transfer_rule_id = $1)",
    )
    .bind(id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE operations
         SET transfer_account_id = NULL, transfer_rule_id = NULL, transfer_operation_id = NULL
         WHERE transfer_rule_id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    let deleted = sqlx::query("DELETE FROM transfer_rules WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?
        .rows_affected()
        > 0;
    tx.commit().await?;
    Ok(deleted)
}
