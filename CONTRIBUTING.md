# Contributing to Radinage

Thank you for your interest in contributing to Radinage! This document outlines the guidelines and expectations for contributing to this project.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. We expect all contributors to:

- Be respectful and considerate in all interactions
- Accept constructive criticism gracefully
- Focus on what is best for the project and community
- Show empathy towards other contributors

Harassment, trolling, or any form of discrimination will not be tolerated. Maintainers reserve the right to remove, edit, or reject contributions that do not align with these principles.

## How to Contribute

### Reporting Bugs

1. Check existing issues to avoid duplicates.
2. Open a new issue with a clear title and description.
3. Include steps to reproduce, expected behavior, and actual behavior.
4. Add relevant logs, screenshots, or error messages.

### Suggesting Features

1. Open an issue describing the feature and its motivation.
2. Explain the use case and how it fits into the existing application.
3. Wait for feedback from maintainers before starting implementation.

### Submitting Code

1. Fork the repository.
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes following the code standards described below.
4. Ensure all checks pass (see [Pre-commit Checklist](#pre-commit-checklist)).
5. Commit with a clear, descriptive message.
6. Push your branch and open a pull request against `main`.

## Code Standards

### Rust (radinage-api, radinage-mcp)

- **JSON fields** must be `camelCase`. Always use `#[serde(rename_all = "camelCase")]`.
- **Never expose `userId`** in API responses. Use dedicated response DTOs.
- **No compile-time query macros** (`query!`, `query_as!`). Use runtime `sqlx::query()` / `sqlx::query_as()`.
- **No `std::env::var`**. All config goes through clap.
- **No dynamic dispatch** (`dyn Trait`). Use generics.
- **No `async-trait` crate**. Use native async traits (Rust 2024 edition).
- **No code duplication**. Extract shared logic into helpers or generics.
- **Tests with `mockall`**. Every non-trivial unit of logic must be tested.
- **Zero Clippy warnings**. No `#[allow(...)]` unless strictly unavoidable.
- **Comments in English**.
- **Formatted with `cargo fmt`**.

### TypeScript/React (radinage-webapp)

- **Strict TypeScript**. Never use `any`, `@ts-ignore`, or non-null assertions (`!`).
- **Functional components only**. No class components.
- **No code duplication**. Extract shared logic into hooks or utilities.
- **Tests required**. Use Vitest + React Testing Library.
- **Zero lint warnings**. Must pass `biome check`.
- **Comments in English**.
- **Formatted with `biome format`**.
- **Absolute imports** via `@/` path alias.
- **No `console.log`**. Use proper logging or remove debug statements.
- **Mobile-first** responsive design.

For the full set of rules, refer to [CLAUDE.md](CLAUDE.md).

## Pre-commit Checklist

Before committing, ensure all of the following pass:

### Rust

```bash
# Format code
cargo fmt

# Run linter
cargo clippy -- -D warnings

# Run tests
cargo test
```

### Frontend

```bash
cd radinage-webapp

# Format code
npx biome format --write .

# Lint
npx biome check .

# Type check
npx tsc --noEmit

# Run tests
npm test
```

### All checks at once

```bash
# From the project root
cargo fmt && cargo clippy -- -D warnings && cargo test && \
cd radinage-webapp && npx biome check . && npx tsc --noEmit && npm test
```

## Pull Request Guidelines

- Keep PRs focused on a single change. Avoid mixing unrelated modifications.
- Write a clear description explaining **what** changed and **why**.
- Reference any related issues (e.g., `Closes #42`).
- Ensure CI passes before requesting review.
- Be responsive to review feedback.

## Branching Strategy

- `main` is the default and production branch.

## License

By contributing to Radinage, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE.md).
