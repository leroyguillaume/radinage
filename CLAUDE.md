# radinage

Personal bank account tracking app. Rust API + React SPA + MCP server.

## Quick reference

```
radinage-api/          Rust REST API (Axum + SQLx + PostgreSQL)
  src/main.rs          AppState<U,O,B> generic over repos, route registration
  src/config.rs        clap-based config, all env vars declared here
  src/auth/            JWT middleware, password hashing (argon2)
  src/domain/          Core types: user, operation, budget
  src/handlers/        HTTP handlers — each defines its own *Response DTO
  src/repositories/    Trait-based repos (Pg* impls) + MockXxxRepository for tests
  src/services/        matcher (auto-categorize), importer (CSV/Excel)
  src/error.rs         AppError type, IntoResponse impl
  migrations/          SQLx migrations (001–011)

radinage-mcp/          MCP server — reads API's OpenAPI spec, exposes tools
  src/server.rs        MCP handler
  src/openapi.rs       OpenAPI → MCP tool generation

radinage-webapp/       React 19 + TypeScript SPA
  src/routes/          File-based routes (TanStack Router)
  src/components/      Reusable components (BudgetModal, ImportModal)
  src/lib/api.ts       HTTP client (fetch wrapper)
  src/lib/types.ts     Shared TypeScript types
  src/lib/hooks.ts     Custom hooks
  src/stores/          Zustand stores
  src/theme.ts         Mantine theme (primary: green #33c463)
  src/i18n/            i18next translations
```

## Build & check commands

```bash
# Rust — from project root
cargo build                          # compile both API and MCP
cargo test                           # run all tests
cargo clippy -- -D warnings          # lint (must be zero warnings)
cargo fmt                            # format

# Frontend — from radinage-webapp/
npm install                          # install deps
npm run dev                          # dev server (localhost:5173)
npm run build                        # tsc + vite build
npm test                             # vitest
npx biome check .                    # lint + format check
npx biome format --write .           # auto-format
npx biome check --fix .              # auto-fix lint

# Docker
docker-compose --profile radinage up # full stack (postgres + api + mcp + webapp)
```

## Architecture patterns

**API layering:** handler → service → repository → database.
Repositories are traits (`UserRepository`, `OperationRepository`, `BudgetRepository`) with `Pg*` impls. `AppState<U, O, B>` is generic over the three repo types — handlers take `State<ConcreteAppState>`. Tests use `Mock*Repository` from mockall.

**Handler response pattern:** Domain structs may contain `user_id`. Handlers must define a `*Response` DTO that omits `user_id` and implement `From<DomainType>` for it. Never return domain structs directly in `Json(...)`.

**Frontend state:** TanStack Query for server state (API calls), Zustand for client-only state. Routes are file-based via TanStack Router.

---

## Rust rules (radinage-api, radinage-mcp)

Violating any of these is a bug.

| # | Rule | Detail |
|---|------|--------|
| 1 | **camelCase JSON** | `#[serde(rename_all = "camelCase")]` on every serialized struct/enum |
| 2 | **No `userId` in responses** | Use `*Response` DTOs in handlers that omit `user_id` |
| 3 | **Runtime SQL only** | `sqlx::query()` / `sqlx::query_as()` — never `query!` / `query_as!` macros |
| 4 | **Config via clap** | No `std::env::var`, no `env!()`, no dotenv — use `#[arg(long, env = "...")]` |
| 5 | **No `dyn Trait`** | Static dispatch only — no `Box<dyn>`, `&dyn`, `Arc<dyn>` |
| 6 | **No `async-trait`** | Rust 2024 edition — native async in traits |
| 7 | **No duplication** | Factor shared logic into helpers or generics |
| 8 | **Tests with mockall** | Every non-trivial unit must have tests |
| 9 | **Zero Clippy warnings** | No `#[allow(...)]` unless justified with comment |
| 10 | **English comments** | All doc-comments (`///`, `//!`) and inline comments |
| 11 | **cargo fmt** | All code formatted |

## Frontend rules (radinage-webapp)

Violating any of these is a bug.

| # | Rule | Detail |
|---|------|--------|
| 1 | **Stack** | React 19, Vite, Mantine v7, Tailwind v4, TanStack Query + Router, Zustand, Vitest, Biome |
| 2 | **Strict TS** | No `any`, no `@ts-ignore`, no non-null `!` — narrow types properly |
| 3 | **Functional only** | No class components |
| 4 | **No duplication** | Extract to hooks or utilities |
| 5 | **Tests** | Vitest + React Testing Library — test behavior, not implementation |
| 6 | **Zero biome warnings** | `biome check` must pass clean |
| 7 | **English comments** | All comments in English |
| 8 | **biome format** | All code formatted |
| 9 | **Imports** | `@/` alias → `src/`. Named exports only (except route components) |
| 10 | **No console.log** | `console.error` / `console.warn` OK for real error paths |
| 11 | **Logo colors** | Respect the theme (green palette in `theme.ts`) |
| 12 | **Mobile-first** | Design for small screens first. Mantine responsive props + Tailwind `sm:`/`md:`/`lg:`. Touch targets ≥ 44×44px |
