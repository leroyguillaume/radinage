# Contributing

Bugs and ideas go to [GitHub issues](https://github.com/leroyguillaume/radinage/issues); code goes through pull requests against `main`. In short: install the tooling below, run `pre-commit install`, keep the hooks and the tests green, and open a labelled PR.

How to run the project itself is in [README.md](README.md#getting-started).

## Development setup

| Tool | Version | Used by |
| --- | --- | --- |
| Rust (`rustup`) | 1.94.1, with `rustfmt` and `clippy` | API, `cargo fmt` / `cargo clippy` hooks |
| Node.js | 25 | webapp, `biome` / `tsc` hooks |
| Docker | with the Compose plugin | PostgreSQL for the Rust tests, image builds |
| `pre-commit` | 4.6 | the commit gate |
| `helm` | 4 | `helm lint` hook |
| `helm-docs` | 1.14.2 | chart README hook |
| `hadolint` | 2.15 | Dockerfile lint hook |
| `trivy` | 0.75 | `trivy config` hooks |
| `shellcheck` | any | shell script hook |
| `cargo-edit`, `jq` | any | [scripts/release.sh](scripts/release.sh) only |

`yamllint`, `actionlint` and `sqlfluff` are installed by `pre-commit` itself.

Rust and the release tooling install the same way on macOS and Linux:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

```bash
rustup toolchain install 1.94.1 --component rustfmt,clippy
```

```bash
cargo install cargo-edit
```

`pre-commit`, `helm-docs` and `trivy` too:

```bash
pipx install pre-commit
```

```bash
go install github.com/norwoodj/helm-docs/cmd/helm-docs@v1.14.2
```

```bash
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin v0.75.0
```

Node.js 25 comes from [nodejs.org](https://nodejs.org/en/download) and Helm from [helm.sh](https://helm.sh/docs/intro/install/). The rest:

**macOS**

```bash
brew install hadolint shellcheck jq
```

**Linux** (Debian/Ubuntu, as in CI)

```bash
sudo apt install -y shellcheck jq
```

```bash
sudo curl -fsSL -o /usr/local/bin/hadolint https://github.com/hadolint/hadolint/releases/download/v2.15.1/hadolint-linux-x86_64 && sudo chmod +x /usr/local/bin/hadolint
```

Then, from a fresh clone:

```bash
(cd radinage-webapp && npm ci)
```

```bash
pre-commit install
```

The setup works when `pre-commit run --all-files` passes.

## Running the tests

The Rust tests need PostgreSQL. Start it and point `DATABASE_URL` at it:

```bash
docker compose up -d postgres
```

```bash
export DATABASE_URL=postgresql://radinage:radinage@localhost:5432/radinage
```

```bash
cargo test
```

One test by name:

```bash
cargo test -p radinage-api matcher
```

The webapp tests (Vitest + React Testing Library) run in jsdom and need nothing else. From `radinage-webapp/`:

```bash
npm test
```

```bash
npx vitest run src/__tests__/budgets.test.tsx
```

Every new behaviour comes with tests, and every bug fix with a test that fails without it.

## Pre-commit hooks

Hooks must pass before a commit is pushed. Run them on the whole repository, or one hook at a time while iterating:

```bash
pre-commit run --all-files
```

```bash
pre-commit run cargo-clippy --all-files
```

| Hook | Checks | Fix |
| --- | --- | --- |
| `trailing-whitespace`, `end-of-file-fixer`, `pretty-format-json`, `pretty-format-toml` | whitespace and formatting | fixes itself, re-run |
| `check-yaml`, `check-toml`, `check-json`, `check-merge-conflict`, `check-added-large-files`, `detect-private-key` | files parse, no conflict markers, no large files, no keys | edit the file |
| `yamllint` | YAML style, configured in [.yamllint.yaml](.yamllint.yaml) | edit the file |
| `hadolint`, `trivy-dockerfile` | [Dockerfile](Dockerfile) lint and misconfigurations | edit the Dockerfile |
| `trivy-chart` | misconfigurations in the rendered chart; [.trivy/](.trivy/) and [.trivyignore](.trivyignore) hold its configuration | edit the chart |
| `helm-lint`, `helm-docs` | the chart lints, and its README matches `values.yaml` | edit the chart; `helm-docs` regenerates the README |
| `actionlint` | GitHub workflows | edit the workflow |
| `shellcheck` | shell scripts | edit the script |
| `sqlfluff-lint` | new SQL migrations, configured in [.sqlfluff](.sqlfluff) | `sqlfluff fix <file>` |
| `cargo-fmt`, `cargo-clippy` | Rust formatting, zero Clippy warnings | `cargo fmt` fixes itself; Clippy needs a code change |
| `biome-check`, `tsc` | webapp lint, formatting and types | `biome` fixes what it can; types need a code change |
| `no-co-authors` | no `Co-Authored-By:` or `Generated with` line in commit messages | reword the commit message |

The full configuration is [.pre-commit-config.yaml](.pre-commit-config.yaml). `--no-verify` and `SKIP=` are not a fix: a red hook is a real finding, so fix the code, or change the configuration in the same PR and say why. CI runs the same hooks.

Migrations 001 to 011 are excluded from `sqlfluff`: the API checksums every applied migration, so an applied migration file can never change.

## Continuous integration

| Workflow | Triggers on | What it does | Reproduce locally |
| --- | --- | --- | --- |
| [quality](.github/workflows/quality.yaml) | every PR, push to `main` | `pre-commit run --all-files`, Rust tests against PostgreSQL, webapp tests | `pre-commit run --all-files`, then the commands in [Running the tests](#running-the-tests) |
| [security](.github/workflows/security.yaml) | every PR, push to `main`, daily, manual | `trivy fs` on the lockfiles and secrets; on the daily and manual runs, `trivy image` on the latest stable release's images | `trivy fs --scanners vuln,secret --severity HIGH,CRITICAL --ignore-unfixed .` |
| [build](.github/workflows/build.yaml) | PRs and pushes to `main` that touch the images' sources, manual | builds the two images natively for amd64 and arm64 and scans each with `trivy image`; pushes only on a manual run asked to, or from `release` | `docker build --target api .`, then `trivy image` on the result |
| [release](.github/workflows/release.yaml) | tag `v*` | checks the tag against the committed version, runs `build` with push, creates the GitHub release with generated notes (stable tags only) | — |
| [chart](.github/workflows/chart.yaml) | tag `chart-*`, manual | checks the tag against `Chart.yaml` and the README, publishes the chart to `oci://ghcr.io/leroyguillaume/charts` | `helm package helm/radinage` |

`quality` and `security` run on every PR and must be green to merge. `build` only runs when the images' sources change, so it is never a merge requirement.

The workflows use the built-in `GITHUB_TOKEN` and no other secret. Pushing images and the chart needs `packages: write`, granted only to the jobs that publish. A PR from a fork gets a read-only token, so its `security` run cannot upload results to code scanning; the scan itself still runs.

[Dependabot](.github/dependabot.yaml) opens weekly update PRs for Cargo, npm, Docker, Docker Compose and GitHub Actions.

## Submitting a change

- Branch from `main`, one change per branch.
- Commit subjects are imperative and lowercase, prefixed with the area when it helps: `webapp: add budget filter`, `chart: expose revision history`. `git log --oneline` is the reference.
- Code follows the rules in [CLAUDE.md](CLAUDE.md).
- A PR updates the documentation it affects, and carries exactly one category label from [.github/release.yaml](.github/release.yaml) (`feature`, `fix`, `chore`, …), plus `breaking` when it breaks something. The label decides where it lands in the release notes.
- PRs are squash-merged.

## Releasing

Releases are cut with [scripts/release.sh](scripts/release.sh) from an up-to-date `main`, and only with it: the publishing workflows refuse a tag that disagrees with the committed version.

The application (tag `vX.Y.Z`, published by `release`):

```bash
scripts/release.sh 0.2.0
```

The chart (tag `chart-X.Y.Z`, published by `chart`), pinning `appVersion` to the latest `v*` tag unless `--app-version` says otherwise:

```bash
scripts/release.sh --chart 0.2.0
```

The script bumps the versions, regenerates the chart README, commits, tags and asks before pushing. `--dry-run` shows what it would do. A pre-release such as `0.2.0-rc1` publishes images but no GitHub release.
