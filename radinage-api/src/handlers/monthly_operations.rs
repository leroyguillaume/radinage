use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::last_day_of_month,
    error::AppResult,
    handlers::operations::OperationResponse,
    repositories::{ListOperationsParams, OperationRepository, OperationSortField, SortOrder},
};
use axum::{
    Json,
    extract::{Path, State},
};
use chrono::NaiveDate;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// All operations for a given month.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyOperationsResponse {
    /// All operations recorded during the requested month.
    pub operations: Vec<OperationResponse>,
}

pub async fn get_monthly_operations<U, O: OperationRepository, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path((year, month)): Path<(i32, u32)>,
) -> AppResult<Json<MonthlyOperationsResponse>> {
    let user_id = auth_user.id;

    let month_start = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| crate::error::AppError::BadRequest("invalid year/month".to_string()))?;
    let month_end = last_day_of_month(year, month)
        .ok_or_else(|| crate::error::AppError::BadRequest("invalid year/month".to_string()))?;

    let params = ListOperationsParams {
        date_from: Some(month_start),
        date_to: Some(month_end),
        label_filter: None,
        amount: None,
        sort: OperationSortField::Date,
        order: SortOrder::Desc,
        limit: i64::MAX,
        offset: 0,
        include_ignored: false,
    };

    let (ops, _total) = state.operation_repo.list(user_id, &params).await?;
    let operations = ops.into_iter().map(OperationResponse::from).collect();

    Ok(Json(MonthlyOperationsResponse { operations }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{
            operation::{BudgetLink, Operation},
            user::UserRole,
        },
        repositories::{MockBudgetRepository, MockOperationRepository, MockUserRepository},
        test_util::{auth_header, build_test_router, json_request, make_test_state, response_json},
    };
    use axum::http::StatusCode;
    use rust_decimal::Decimal;
    use tower::ServiceExt;
    use uuid::Uuid;

    fn make_op(id: Uuid, user_id: Uuid, date: NaiveDate) -> Operation {
        Operation {
            id,
            user_id,
            amount: Decimal::new(-50, 0),
            date,
            label: "Test op".to_string(),
            effective_date: None,
            budget_link: BudgetLink::Unlinked,
            ignored: false,
        }
    }

    fn build_app(or: MockOperationRepository) -> axum::Router {
        build_test_router(make_test_state(
            MockUserRepository::new(),
            or,
            MockBudgetRepository::new(),
        ))
    }

    #[tokio::test]
    async fn returns_empty_operations() {
        let user_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_list()
            .returning(|_, _| Box::pin(async { Ok((vec![], 0)) }));
        let app = build_app(or);

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request("GET", "/operations/monthly/2024/1", None, Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: MonthlyOperationsResponse = response_json(resp).await;
        assert!(json.operations.is_empty());
    }

    #[tokio::test]
    async fn returns_operations_for_the_month() {
        let user_id = Uuid::new_v4();
        let ops = vec![
            make_op(
                Uuid::new_v4(),
                user_id,
                NaiveDate::from_ymd_opt(2024, 3, 5).unwrap(),
            ),
            make_op(
                Uuid::new_v4(),
                user_id,
                NaiveDate::from_ymd_opt(2024, 3, 20).unwrap(),
            ),
        ];
        let mut or = MockOperationRepository::new();
        let total = ops.len() as i64;
        or.expect_list().returning(move |_, _| {
            let ops = ops.clone();
            let total = total;
            Box::pin(async move { Ok((ops, total)) })
        });
        let app = build_app(or);

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request("GET", "/operations/monthly/2024/3", None, Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: MonthlyOperationsResponse = response_json(resp).await;
        assert_eq!(json.operations.len(), 2);
    }

    #[tokio::test]
    async fn invalid_month_returns_bad_request() {
        let user_id = Uuid::new_v4();
        let app = build_app(MockOperationRepository::new());

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request("GET", "/operations/monthly/2024/13", None, Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
