use super::*;
use crate::domain::{account::AccountKind, budget::LabelPattern, transfer::TransferRuleFields};
use crate::repositories::{AccountRepository, PgAccountRepository};
use rust_decimal_macros::dec;

/// A user's accounts: two imported checking ones and a savings one.
struct Accounts {
    user_id: Uuid,
    main: Uuid,
    joint: Uuid,
    livret: Uuid,
}

async fn setup(pool: &PgPool) -> Accounts {
    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, 'h', 'user')",
    )
    .bind(user_id)
    .bind(format!("user_{user_id}"))
    .execute(pool)
    .await
    .unwrap();
    let account = |name: &'static str, kind: &'static str, imported: bool| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar(
                "INSERT INTO accounts (user_id, name, kind, imported) VALUES ($1, $2, $3, $4)
                 RETURNING id",
            )
            .bind(user_id)
            .bind(name)
            .bind(kind)
            .bind(imported)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    Accounts {
        user_id,
        main: account("Main", "checking", true).await,
        joint: account("Joint", "checking", true).await,
        livret: account("Livret A", "savings", false).await,
    }
}

fn day(d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 3, d).unwrap()
}

async fn insert(
    repo: &PgOperationRepository,
    user_id: Uuid,
    account_id: Uuid,
    amount: Decimal,
    date: NaiveDate,
) -> Uuid {
    let id = Uuid::new_v4();
    repo.insert(
        id,
        user_id,
        &NewOperation {
            account_id,
            amount,
            date,
            effective_date: None,
            label: "VIR INTERNE".to_string(),
        },
    )
    .await
    .unwrap();
    id
}

async fn budget(pool: &PgPool, user_id: Uuid, budget_type: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO budgets (user_id, label, budget_type, kind_type)
         VALUES ($1, $2, $3, 'occasional') RETURNING id",
    )
    .bind(user_id)
    .bind(Uuid::new_v4().to_string())
    .bind(budget_type)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn transfer_of(repo: &PgOperationRepository, a: &Accounts, id: Uuid) -> Option<Transfer> {
    repo.find_by_id(id, a.user_id).await.unwrap().transfer
}

#[sqlx::test(migrations = "./migrations")]
async fn a_transfer_keeps_a_savings_budget_only_on_money_put_aside(pool: PgPool) {
    let repo = PgOperationRepository::new(pool.clone());
    let a = setup(&pool).await;
    let savings = budget(&pool, a.user_id, "savings").await;
    let groceries = budget(&pool, a.user_id, "expense").await;
    let category = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO categories (user_id, name, color) VALUES ($1, 'Food', 'teal') RETURNING id",
    )
    .bind(a.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let put_aside = insert(&repo, a.user_id, a.main, dec!(-300), day(10)).await;
    let other = insert(&repo, a.user_id, a.main, dec!(-50), day(11)).await;
    for (op, budget_id) in [(put_aside, savings), (other, groceries)] {
        repo.set_budget_link(op, a.user_id, &BudgetLink::Manual { budget_id })
            .await
            .unwrap();
        repo.set_category(op, a.user_id, Some(category))
            .await
            .unwrap();
        assert!(
            repo.set_transfer(op, a.user_id, a.livret, None)
                .await
                .unwrap()
        );
    }

    let put_aside = repo.find_by_id(put_aside, a.user_id).await.unwrap();
    assert_eq!(
        put_aside.transfer,
        Some(Transfer {
            account_id: a.livret,
            account_kind: AccountKind::Savings,
            rule_id: None,
            operation_id: None,
        })
    );
    assert_eq!(
        put_aside.budget_link,
        BudgetLink::Manual { budget_id: savings }
    );
    assert_eq!(put_aside.category_id, None);
    let other = repo.find_by_id(other, a.user_id).await.unwrap();
    assert_eq!(other.budget_link, BudgetLink::Unlinked);
    assert!(
        !repo
            .set_transfer(Uuid::new_v4(), a.user_id, a.livret, None)
            .await
            .unwrap()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_transfer_pairs_with_the_closest_opposite_operation_and_clears_with_it(pool: PgPool) {
    let repo = PgOperationRepository::new(pool.clone());
    let a = setup(&pool).await;
    let out = insert(&repo, a.user_id, a.main, dec!(-450), day(10)).await;
    let far = insert(&repo, a.user_id, a.joint, dec!(450), day(13)).await;
    let near = insert(&repo, a.user_id, a.joint, dec!(450), day(11)).await;
    let same_sign = insert(&repo, a.user_id, a.joint, dec!(-450), day(10)).await;
    let too_late = insert(&repo, a.user_id, a.joint, dec!(450), day(16)).await;

    repo.set_transfer(out, a.user_id, a.joint, None)
        .await
        .unwrap();
    let paired = repo.pair_transfer(out, a.user_id, None).await.unwrap();

    assert_eq!(paired, Some(near));
    assert_eq!(
        transfer_of(&repo, &a, out)
            .await
            .and_then(|t| t.operation_id),
        Some(near)
    );
    let other_side = transfer_of(&repo, &a, near).await.unwrap();
    assert_eq!(other_side.account_id, a.main);
    assert_eq!(other_side.operation_id, Some(out));
    for untouched in [far, same_sign, too_late] {
        assert_eq!(transfer_of(&repo, &a, untouched).await, None);
    }

    // Pairing with another operation by hand undoes the first pairing.
    let repaired = repo.pair_transfer(out, a.user_id, Some(far)).await.unwrap();
    assert_eq!(repaired, Some(far));
    assert_eq!(transfer_of(&repo, &a, near).await, None);
    assert_eq!(
        transfer_of(&repo, &a, far)
            .await
            .and_then(|t| t.operation_id),
        Some(out)
    );

    assert!(repo.clear_transfer(out, a.user_id).await.unwrap());
    assert_eq!(transfer_of(&repo, &a, out).await, None);
    assert_eq!(transfer_of(&repo, &a, far).await, None);
    assert!(
        !repo
            .clear_transfer(Uuid::new_v4(), a.user_id)
            .await
            .unwrap()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_transfer_with_an_account_not_receiving_operations_waits_for_nothing(pool: PgPool) {
    let repo = PgOperationRepository::new(pool.clone());
    let a = setup(&pool).await;
    let out = insert(&repo, a.user_id, a.main, dec!(-300), day(10)).await;
    repo.set_transfer(out, a.user_id, a.livret, None)
        .await
        .unwrap();

    assert_eq!(
        repo.pair_transfer(out, a.user_id, None).await.unwrap(),
        None
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn an_operation_imported_later_becomes_the_other_side_of_a_waiting_transfer(pool: PgPool) {
    let repo = PgOperationRepository::new(pool.clone());
    let a = setup(&pool).await;
    let out = insert(&repo, a.user_id, a.main, dec!(-450), day(10)).await;
    repo.set_transfer(out, a.user_id, a.joint, None)
        .await
        .unwrap();
    assert_eq!(
        repo.pair_transfer(out, a.user_id, None).await.unwrap(),
        None
    );

    let unrelated = insert(&repo, a.user_id, a.joint, dec!(80), day(12)).await;
    let incoming = insert(&repo, a.user_id, a.joint, dec!(450), day(12)).await;

    assert_eq!(
        repo.pair_with_waiting_transfer(unrelated).await.unwrap(),
        None
    );
    assert_eq!(
        repo.pair_with_waiting_transfer(incoming).await.unwrap(),
        Some(out)
    );
    let other_side = transfer_of(&repo, &a, incoming).await.unwrap();
    assert_eq!(
        (other_side.account_id, other_side.operation_id),
        (a.main, Some(out))
    );
    // Already paired: nothing waits any more.
    let again = insert(&repo, a.user_id, a.joint, dec!(450), day(12)).await;
    assert_eq!(repo.pair_with_waiting_transfer(again).await.unwrap(), None);
}

#[sqlx::test(migrations = "./migrations")]
async fn moving_an_operation_ends_its_transfer_on_both_sides(pool: PgPool) {
    let repo = PgOperationRepository::new(pool.clone());
    let a = setup(&pool).await;
    let out = insert(&repo, a.user_id, a.main, dec!(-450), day(10)).await;
    let incoming = insert(&repo, a.user_id, a.joint, dec!(450), day(10)).await;
    repo.set_transfer(out, a.user_id, a.joint, None)
        .await
        .unwrap();
    repo.pair_transfer(out, a.user_id, None).await.unwrap();

    assert_eq!(
        repo.set_accounts(&[out], a.user_id, a.joint).await.unwrap(),
        1
    );

    assert_eq!(transfer_of(&repo, &a, out).await, None);
    assert_eq!(transfer_of(&repo, &a, incoming).await, None);
}

#[sqlx::test(migrations = "./migrations")]
async fn summary_rows_say_how_each_transfer_counts(pool: PgPool) {
    let repo = PgOperationRepository::new(pool.clone());
    let a = setup(&pool).await;
    let savings = budget(&pool, a.user_id, "savings").await;
    let budgeted = insert(&repo, a.user_id, a.main, dec!(-300), day(5)).await;
    repo.set_budget_link(
        budgeted,
        a.user_id,
        &BudgetLink::Manual { budget_id: savings },
    )
    .await
    .unwrap();
    let put_aside = insert(&repo, a.user_id, a.main, dec!(-100), day(6)).await;
    let taken_back = insert(&repo, a.user_id, a.main, dec!(500), day(7)).await;
    let internal = insert(&repo, a.user_id, a.main, dec!(-450), day(8)).await;
    insert(&repo, a.user_id, a.main, dec!(-20), day(9)).await;
    for (op, to) in [
        (budgeted, a.livret),
        (put_aside, a.livret),
        (taken_back, a.livret),
        (internal, a.joint),
    ] {
        repo.set_transfer(op, a.user_id, to, None).await.unwrap();
    }

    let mut rows = repo
        .list_for_summary(a.user_id, day(1), day(31))
        .await
        .unwrap();
    rows.sort_by_key(|r| r.date);
    let categories: Vec<_> = rows.iter().map(|r| (r.amount, r.category())).collect();

    assert_eq!(
        categories,
        vec![
            (
                dec!(-300),
                Some(SummaryCategory::Budgeted(BudgetType::Savings))
            ),
            (
                dec!(-100),
                Some(SummaryCategory::Transfer(TransferFlow::ToSavings))
            ),
            (
                dec!(500),
                Some(SummaryCategory::Transfer(TransferFlow::FromSavings))
            ),
            (
                dec!(-450),
                Some(SummaryCategory::Transfer(TransferFlow::Internal))
            ),
            (dec!(-20), Some(SummaryCategory::Unbudgeted)),
        ]
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn transfers_stay_out_of_categories_and_can_be_listed_by_their_other_account(pool: PgPool) {
    let repo = PgOperationRepository::new(pool.clone());
    let a = setup(&pool).await;
    let to_livret = insert(&repo, a.user_id, a.main, dec!(-300), day(5)).await;
    let to_joint = insert(&repo, a.user_id, a.main, dec!(-450), day(6)).await;
    insert(&repo, a.user_id, a.main, dec!(-20), day(7)).await;
    repo.set_transfer(to_livret, a.user_id, a.livret, None)
        .await
        .unwrap();
    repo.set_transfer(to_joint, a.user_id, a.joint, None)
        .await
        .unwrap();

    let totals = repo
        .category_totals(a.user_id, day(1), day(31))
        .await
        .unwrap();
    assert_eq!(
        totals,
        vec![CategoryTotal {
            category_id: None,
            income: dec!(0),
            expense: dec!(-20),
        }]
    );

    let (ops, _) = repo
        .list(
            a.user_id,
            &ListOperationsParams {
                transfer_account_ids: vec![a.livret],
                limit: 10,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(
        ops.iter().map(|op| op.id).collect::<Vec<_>>(),
        vec![to_livret]
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_savings_account_adds_each_transfer_once_after_its_latest_balance(pool: PgPool) {
    let repo = PgOperationRepository::new(pool.clone());
    let accounts = PgAccountRepository::new(pool.clone());
    let a = setup(&pool).await;
    accounts
        .add_balance(
            a.livret,
            a.user_id,
            crate::domain::account::AccountBalance {
                amount: dec!(1000),
                date: day(1),
            },
        )
        .await
        .unwrap();
    let savings = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO budgets (user_id, label, budget_type, kind_type, account_id)
         VALUES ($1, 'Livret', 'savings', 'occasional', $2) RETURNING id",
    )
    .bind(a.user_id)
    .bind(a.livret)
    .fetch_one(&pool)
    .await
    .unwrap();
    let before = insert(&repo, a.user_id, a.main, dec!(-70), day(1)).await;
    let budgeted = insert(&repo, a.user_id, a.main, dec!(-300), day(10)).await;
    let taken_back = insert(&repo, a.user_id, a.main, dec!(100), day(12)).await;
    let ignored = insert(&repo, a.user_id, a.main, dec!(-40), day(14)).await;
    repo.set_budget_link(
        budgeted,
        a.user_id,
        &BudgetLink::Manual { budget_id: savings },
    )
    .await
    .unwrap();
    for op in [before, budgeted, taken_back, ignored] {
        repo.set_transfer(op, a.user_id, a.livret, None)
            .await
            .unwrap();
    }
    repo.set_ignored(ignored, a.user_id, true).await.unwrap();

    let livret = accounts.find(a.livret, a.user_id).await.unwrap().unwrap();
    // 1000 + 300 (once, budget or not) - 100 + 40 (ignored, the money still moved).
    assert_eq!(livret.current_balance, Some(dec!(1240)));
    assert!(livret.transferred_into);
    let main = accounts.find(a.main, a.user_id).await.unwrap().unwrap();
    assert!(!main.transferred_into);

    let moved: Decimal = accounts
        .daily_movements(a.livret, a.user_id)
        .await
        .unwrap()
        .iter()
        .filter(|m| m.date > day(1))
        .map(|m| m.amount)
        .sum();
    assert_eq!(moved, dec!(240));
}

#[sqlx::test(migrations = "./migrations")]
async fn deleting_a_transfer_rule_undoes_its_transfers(pool: PgPool) {
    let repo = PgOperationRepository::new(pool.clone());
    let accounts = PgAccountRepository::new(pool.clone());
    let a = setup(&pool).await;
    let rule = |account_id, counterpart_account_id| TransferRuleFields {
        account_id,
        counterpart_account_id,
        label_pattern: LabelPattern::Contains("VIR".to_string()),
    };
    let main_rule = accounts
        .create_transfer_rule(a.user_id, &rule(a.main, a.joint))
        .await
        .unwrap();
    let joint_rule = accounts
        .create_transfer_rule(a.user_id, &rule(a.joint, a.main))
        .await
        .unwrap();
    assert_eq!(
        accounts
            .list_transfer_rules(a.user_id)
            .await
            .unwrap()
            .iter()
            .map(|r| r.id)
            .collect::<Vec<_>>(),
        vec![main_rule.id, joint_rule.id]
    );

    // A pair whose other side is a transfer only through the pairing.
    let out = insert(&repo, a.user_id, a.main, dec!(-450), day(10)).await;
    let incoming = insert(&repo, a.user_id, a.joint, dec!(450), day(10)).await;
    repo.set_transfer(out, a.user_id, a.joint, Some(main_rule.id))
        .await
        .unwrap();
    repo.pair_transfer(out, a.user_id, None).await.unwrap();
    // A pair whose other side has a rule of its own.
    let out2 = insert(&repo, a.user_id, a.main, dec!(-80), day(20)).await;
    let incoming2 = insert(&repo, a.user_id, a.joint, dec!(80), day(20)).await;
    repo.set_transfer(incoming2, a.user_id, a.main, Some(joint_rule.id))
        .await
        .unwrap();
    repo.set_transfer(out2, a.user_id, a.joint, Some(main_rule.id))
        .await
        .unwrap();
    repo.pair_transfer(out2, a.user_id, None).await.unwrap();
    assert_eq!(
        transfer_of(&repo, &a, incoming2)
            .await
            .and_then(|t| t.rule_id),
        Some(joint_rule.id)
    );

    assert!(
        accounts
            .delete_transfer_rule(main_rule.id, a.user_id)
            .await
            .unwrap()
    );

    assert_eq!(transfer_of(&repo, &a, out).await, None);
    assert_eq!(transfer_of(&repo, &a, incoming).await, None);
    assert_eq!(transfer_of(&repo, &a, out2).await, None);
    let kept = transfer_of(&repo, &a, incoming2).await.unwrap();
    assert_eq!(
        (kept.account_id, kept.rule_id, kept.operation_id),
        (a.main, Some(joint_rule.id), None)
    );
    assert!(
        !accounts
            .delete_transfer_rule(main_rule.id, a.user_id)
            .await
            .unwrap()
    );
}
