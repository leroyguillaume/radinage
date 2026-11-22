# Contributing

Bugs and ideas go to [GitHub issues](https://github.com/leroyguillaume/radinage/issues); code goes through pull requests against `main`. In short: `mise install`, `task setup`, keep `task lint` and `task test` green, and open a labelled PR.

How to run the project itself is in [README.md](README.md#getting-started).

## Development setup

Install [mise](https://mise.jdx.dev/installing-mise.html) and [Docker](https://docs.docker.com/get-started/get-docker/) with the Compose plugin. mise installs every other tool at the version pinned in [mise.toml](mise.toml): the Rust toolchain, Node.js, Python, `pre-commit`, Task, and the binaries the hooks and [scripts/release.sh](scripts/release.sh) call. Docker runs PostgreSQL for the Rust tests and builds the images.

From a fresh clone:

```bash
mise trust
```

```bash
mise install
```

```bash
task setup
```

`task setup` installs the webapp dependencies and the git hooks. `task --list` shows every task in [Taskfile.yml](Taskfile.yml). The setup works when `task lint` passes.

mise also sets `DATABASE_URL` to the Compose PostgreSQL; put local overrides in a `mise.local.toml`, which git ignores.

## Running the tests

The Rust tests need PostgreSQL:

```bash
docker compose up -d postgres
```

Both suites, as CI runs them:

```bash
task test
```

One suite, or a subset: arguments after `--` go to `cargo test` or `vitest run`.

```bash
task test:api -- -p radinage-api matcher
```

```bash
task test:webapp -- src/__tests__/budgets.test.tsx
```

The webapp tests (Vitest + React Testing Library) run in jsdom and need nothing else.

Every new behaviour comes with tests, and every bug fix with a test that fails without it.

The service worker is not registered under `npm run dev`. To try the installable app and its update prompt, serve a production build from `radinage-webapp/`:

```bash
npm run build
```

```bash
npm run preview
```

The PWA icons in `radinage-webapp/public/` (`pwa-*.png`, `maskable-icon-*.png`, `apple-touch-icon-*.png`) are generated from `logo.svg` and committed. After changing the logo, regenerate them from `radinage-webapp/` and commit the result:

```bash
npm run generate-pwa-assets
```

## Pre-commit hooks

Hooks must pass before a commit is pushed. Run them on the whole repository, or one hook at a time while iterating:

```bash
task lint
```

```bash
pre-commit run cargo-clippy --all-files
```

| Hook | Checks | Fix |
| --- | --- | --- |
| `trailing-whitespace`, `end-of-file-fixer`, `pretty-format-json`, `pretty-format-toml` | whitespace and formatting | fixes itself, re-run |
| `check-yaml`, `check-toml`, `check-json`, `check-merge-conflict`, `check-added-large-files`, `detect-private-key` | files parse, no conflict markers, no large files, no keys | edit the file |
| `check-taskfile` | [Taskfile.yml](Taskfile.yml) matches Task's schema | edit the Taskfile |
| `mise-fmt` | [mise.toml](mise.toml) formatting | fixes itself, re-run; after changing a tool, run `mise lock` too |
| `yamllint` | YAML style, configured in [.yamllint.yaml](.yamllint.yaml) | edit the file |
| `hadolint`, `trivy-dockerfile` | [Dockerfile](Dockerfile) lint and misconfigurations | edit the Dockerfile |
| `trivy-chart` | misconfigurations in the rendered chart; [.trivy/](.trivy/) and [.trivyignore](.trivyignore) hold its configuration | edit the chart |
| `helm-lint`, `helm-docs` | the chart lints, and its README matches `values.yaml` | edit the chart; `helm-docs` regenerates the README |
| `actionlint` | GitHub workflows | edit the workflow |
| `renovate-config-validator` | [renovate.json](renovate.json) is valid and uses no renamed option | `npx --package renovate renovate-config-validator --migrate` rewrites a stale key |
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
| [quality](.github/workflows/quality.yaml) | every PR, push to `main` | `task lint`, `task test:api` against PostgreSQL, `task test:webapp` | `task lint`, then [Running the tests](#running-the-tests) |
| [security](.github/workflows/security.yaml) | every PR, push to `main`, daily, manual | `trivy fs` on the lockfiles and secrets; on the daily and manual runs, `trivy image` on the latest stable release's images | `trivy fs --scanners vuln,secret --severity HIGH,CRITICAL --ignore-unfixed .` |
| [build](.github/workflows/build.yaml) | PRs and pushes to `main` that touch the images' sources, manual | builds the two images natively for amd64 and arm64 and scans each with `trivy image`; pushes only on a manual run asked to, or from `release`, then attests each multi-arch image and its CycloneDX SBOM in GHCR | `docker build --target api .`, then `trivy image` on the result |
| [release](.github/workflows/release.yaml) | tag `v*` | checks the tag against the committed version, runs `build` with push, creates the GitHub release with generated notes and the images' SBOMs (stable tags only) | — |
| [chart](.github/workflows/chart.yaml) | tag `chart-*`, manual | checks the tag against `Chart.yaml` and the README, publishes the chart to `oci://ghcr.io/leroyguillaume/charts` and attests it there | `helm package helm/radinage` |
| [scorecard](.github/workflows/scorecard.yaml) | push to `main`, weekly, branch protection rule changes | OpenSSF Scorecard analysis, published to the Scorecard API and code scanning | — |
| [renovate](.github/workflows/renovate.yaml) | daily, manual | runs Renovate on the repository, see [Dependency updates](#dependency-updates) | — |

`quality` and `security` run on every PR and must be green to merge. `build` only runs when the images' sources change, and `scorecard` and `renovate` never run on a PR, so none of them is a merge requirement.

Only runs on `main` save the Rust build cache and the Docker layer cache; every other run, PRs and release tags included, reads `main`'s. GitHub lets a PR read its own caches and the default branch's, nobody else's, so a PR-saved cache only ever serves that PR's reruns, while its few gigabytes evict `main`'s from the repository's 10 GB quota.

Every job installs its tools with mise from [mise.lock](mise.lock), which records each download's checksum, and runs the same tasks as a contributor.

The workflows use the built-in `GITHUB_TOKEN`, except `renovate`. Pushing images and the chart needs `packages: write`, granted only to the jobs that publish. A PR from a fork gets a read-only token, so its `security` run cannot upload results to code scanning; the scan itself still runs.

### Dependency updates

[Renovate](https://docs.renovatebot.com/) runs self-hosted from the `renovate` workflow, configured in [renovate.json](renovate.json). It covers Cargo, npm, the Dockerfile and Compose images, GitHub Actions, pre-commit hooks and mise, and opens:

- new versions once they are three days old, on Monday mornings: one PR per ecosystem for minor and patch bumps, one PR per major, and one per group of packages released in lockstep;
- a weekly lock file maintenance PR, which moves the transitive dependencies;
- a security PR as soon as a Dependabot alert has a fix, labelled `security`.

Bot PRs carry the `dependencies` label and are reviewed and merged by hand, like any other: nothing automerges. The [dependency dashboard](https://github.com/leroyguillaume/radinage/issues?q=is%3Aissue+in%3Atitle+%22Dependency+dashboard%22) issue lists every pending update, including the ones Renovate holds back.

The workflow authenticates with the `RENOVATE_TOKEN` secret, a fine-grained personal access token on this repository: PRs opened with `GITHUB_TOKEN` would not trigger CI. It needs read and write on contents, commit statuses, pull requests, issues (the dashboard) and workflows (to bump actions), and read on Dependabot alerts.

To see what Renovate would do, for instance after changing [renovate.json](renovate.json), run the workflow manually with `dryRun` ticked and `logLevel` set to `debug`, then read the job log:

```bash
gh workflow run renovate.yaml -f dryRun=true -f logLevel=debug
```

## Submitting a change

- Branch from `main`, one change per branch.
- Commit subjects are imperative and lowercase, prefixed with the area when it helps: `webapp: add budget filter`, `chart: expose revision history`. `git log --oneline` is the reference.
- Code follows the rules in [CLAUDE.md](CLAUDE.md).
- A PR updates the documentation it affects, and carries exactly one category label from [.github/release.yaml](.github/release.yaml) (`feature`, `fix`, `chore`, …), plus `breaking` when it breaks something. The label decides where it lands in the release notes.
- PRs are squash-merged.

## Releasing

Releases are cut with `task release`, which runs [scripts/release.sh](scripts/release.sh), from an up-to-date `main`, and only with it: the publishing workflows refuse a tag that disagrees with the committed version.

The application (tag `vX.Y.Z`, published by `release`):

```bash
task release -- 0.2.0
```

The chart (tag `chart-X.Y.Z`, published by `chart`), pinning `appVersion` to the latest `v*` tag unless `--app-version` says otherwise:

```bash
task release -- --chart 0.2.0
```

The script bumps the versions, regenerates the chart README, commits, tags and asks before pushing. `task release -- --dry-run 0.2.0` shows what it would do. A pre-release such as `0.2.0-rc1` publishes images but no GitHub release.
