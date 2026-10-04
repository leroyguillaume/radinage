<p align="center">
  <img src="radinage-webapp/public/logo.svg" alt="Radinage logo: a smiling green wallet holding a euro coin" width="160">
</p>

# Radinage

[![quality](https://github.com/leroyguillaume/radinage/actions/workflows/quality.yaml/badge.svg)](https://github.com/leroyguillaume/radinage/actions/workflows/quality.yaml)

A self-hosted personal bank account tracker: import your bank statements, sort them into budgets, and see what you can still spend this year.

## Description

Radinage keeps a record of your bank operations and compares them with the budgets you plan, month by month, so the end-of-year balance is never a surprise. It does not connect to your bank: operations come from the CSV or Excel exports banks already provide.

- **Operations**: import bank statements (CSV/XLSX) or link operations to budgets by hand.
- **Budgets**: recurring (weekly, monthly, quarterly, yearly) or one-off, for expenses, income or savings, with matching rules that categorise operations automatically.
- **Forecast**: actuals up to the current month, budgets beyond it, and the daily amount you can still spend.
- **Statistics**: income, expenses, savings and balance over any range of months.
- **Multi-user**: JWT authentication, an admin account and invitation links.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and the reasoning behind it.

## Getting started

### Prerequisites

To run the stack with Docker Compose:

- [Docker](https://docs.docker.com/get-started/get-docker/) with the Compose plugin

To run the services from source:

- [Rust](https://www.rust-lang.org/tools/install) 1.94
- [Node.js](https://nodejs.org/en/download) 25
- PostgreSQL 18, or Docker to run it

### Installation

```bash
git clone https://github.com/leroyguillaume/radinage.git
```

```bash
cd radinage
```

### Configuration

The API (`radinage-api`) reads its configuration from environment variables, or the equivalent `--kebab-case` flags:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `JWT_SECRET` | yes | — | Secret used to sign JWTs |
| `ADMIN_PASSWORD` | yes | — | Password of the admin account created at startup |
| `WEBAPP_URL` | yes | — | Public URL of the webapp, used to build invitation and reset links |
| `ADMIN_USERNAME` | no | `admin` | Username of the admin account |
| `LISTEN_ADDR` | no | `0.0.0.0:3000` | Address the HTTP server listens on |
| `CORS_ORIGINS` | no | — | Comma-separated allowed CORS origins |
| `ROOT_PATH` | no | — | Path prefix the API is served under |
| `JWT_EXPIRATION_SECS` | no | `86400` | Token lifetime in seconds |
| `MAX_BUDGETS_PER_USER` | no | `100` | Maximum number of budgets per user |
| `LOG_FILTER` | no | `info` | `tracing` filter directive |
| `LOG_JSON` | no | `false` | Emit logs as JSON |

The webapp image (nginx):

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `API_HOST` | no | `api:3000` | Upstream `host:port` that `/api/` is proxied to |

Database migrations are applied by the API at startup.

### Usage

#### With Docker Compose

This builds the two images from the [Dockerfile](Dockerfile), then starts them with PostgreSQL:

```bash
docker compose --profile radinage up
```

| Service | URL |
| --- | --- |
| Webapp | <http://localhost:8080> |
| API | <http://localhost:3000> |
| PostgreSQL | `localhost:5432` |

Sign in to the webapp as `admin` with the `ADMIN_PASSWORD` set in [docker-compose.yaml](docker-compose.yaml).

#### From source

Start PostgreSQL alone:

```bash
docker compose up -d postgres
```

Start the API from `radinage-api/`, with the required variables above exported:

```bash
cargo run
```

Start the webapp from `radinage-webapp/`; it serves on <http://localhost:5173> and proxies `/api` to the API:

```bash
npm install
```

```bash
npm run dev
```

### Deployment

Images are published to GHCR for `linux/amd64` and `linux/arm64`: `ghcr.io/leroyguillaume/radinage-api` and `ghcr.io/leroyguillaume/radinage-webapp`.

The Helm chart reads the database connection string from an existing Secret, `radinage-db` with a `url` key by default:

```bash
kubectl create secret generic radinage-db --from-literal=url='postgresql://USER:PASSWORD@HOST:5432/radinage'
```

```bash
helm install radinage oci://ghcr.io/leroyguillaume/charts/radinage --version 0.1.0 --set global.domain=radinage.example.com
```

Every chart value is documented in [helm/radinage/README.md](helm/radinage/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0 — see [LICENSE.md](LICENSE.md).
