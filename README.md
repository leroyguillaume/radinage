# Radinage

[![Docker Publish](https://github.com/leroyguillaume/radinage/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/leroyguillaume/radinage/actions/workflows/docker-publish.yml)

A personal bank account tracking application for managing finances, budgets, and operations. Built with a Rust backend and a React TypeScript frontend.

## Features

- **Operation tracking** -- Import bank statements (CSV/Excel) or add operations manually
- **Budget management** -- Create recurring or one-off budgets with periods and track spending against them
- **Auto-categorization** -- Define matching rules to automatically categorize operations into budgets
- **Monthly summaries** -- View aggregated monthly reports comparing budgets vs. actual spending
- **Statistics** -- Charts and analytics for visualizing financial data
- **Multi-user** -- JWT-based authentication with admin and invitation system
- **LLM integration** -- MCP server exposes the API as tools for Claude and other AI assistants
- **Mobile-friendly** -- Responsive design, usable on all screen sizes

## Architecture

```
radinage/
├── radinage-api/       Rust REST API (Axum, SQLx, PostgreSQL)
├── radinage-mcp/       Rust MCP server (exposes API as LLM tools)
├── radinage-webapp/    React SPA (TypeScript, Mantine, TanStack)
├── helm/               Kubernetes Helm charts
├── docker-compose.yml  Multi-service orchestration
├── Dockerfile              Multi-stage build (API, MCP, Webapp)
└── nginx.conf.template     Frontend reverse proxy config (envsubst at startup)
```

### Backend (`radinage-api`)

- **Framework:** Axum 0.8
- **Database:** PostgreSQL via SQLx 0.8 (runtime queries)
- **Auth:** JWT tokens + Argon2 password hashing
- **API docs:** Auto-generated OpenAPI via aide (served at `/openapi.json`)
- **Config:** clap with environment variable support

### MCP Server (`radinage-mcp`)

- **Protocol:** Model Context Protocol via rmcp
- **Function:** Fetches the OpenAPI spec from the running API and exposes each endpoint as an MCP tool
- **Transport:** Streamable HTTP (hyper)

### Frontend (`radinage-webapp`)

- **Framework:** React 19 with strict TypeScript
- **Build:** Vite
- **UI:** Mantine v7 + Tailwind CSS v4
- **Routing:** TanStack Router (file-based)
- **Server state:** TanStack Query
- **Client state:** Zustand
- **i18n:** i18next

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (1.94+)
- [Node.js](https://nodejs.org/) (25+)
- [PostgreSQL](https://www.postgresql.org/) (16+)
- [Docker](https://www.docker.com/) and Docker Compose (optional)

### Run with Docker Compose

The quickest way to get everything running:

```bash
docker-compose --profile radinage up
```

This starts:

| Service    | URL                    |
|------------|------------------------|
| PostgreSQL | `localhost:5432`       |
| API        | `http://localhost:3000` |
| MCP Server | `http://localhost:3001` |
| Webapp     | `http://localhost:8080` |

### Run Locally

#### 1. Start the database

```bash
# Using Docker
docker run -d --name radinage-db \
  -e POSTGRES_USER=radinage \
  -e POSTGRES_PASSWORD=radinage \
  -e POSTGRES_DB=radinage \
  -p 5432:5432 \
  postgres:16
```

#### 2. Start the API

```bash
cd radinage-api
export DATABASE_URL="postgres://radinage:radinage@localhost:5432/radinage"
export JWT_SECRET="your-secret-key"
export ADMIN_PASSWORD="admin"
export WEBAPP_URL="http://localhost:5173"
export CORS_ORIGINS="http://localhost:5173"

cargo run
```

The API runs on `http://localhost:3000` by default. Database migrations are applied automatically on startup.

#### 3. Start the frontend

```bash
cd radinage-webapp
npm install
npm run dev
```

The webapp runs on `http://localhost:5173` with hot-reload enabled.

#### 4. (Optional) Start the MCP server

```bash
cd radinage-mcp
export RADINAGE_API_URL="http://localhost:3000"
cargo run
```

The MCP server runs on `http://localhost:3001`.

## Configuration

All API configuration is done via environment variables (or CLI flags):

| Variable               | Description                          | Default            |
|------------------------|--------------------------------------|--------------------|
| `DATABASE_URL`         | PostgreSQL connection string         | *required*         |
| `JWT_SECRET`           | Secret key for JWT signing           | *required*         |
| `ADMIN_PASSWORD`       | Initial admin account password       | *required*         |
| `WEBAPP_URL`           | Frontend URL (for invitation links)  | *required*         |
| `CORS_ORIGINS`         | Allowed CORS origins                 | --                 |
| `ROOT_PATH`            | API root path prefix                 | `/`                |
| `LOG_FILTER`           | tracing filter directive             | `info`             |
| `LOG_JSON`             | Output logs as JSON                  | `false`            |
| `JWT_EXPIRATION_SECS`  | Token expiration in seconds          | `86400`            |

The webapp (nginx) image also accepts:

| Variable    | Description                              | Default    |
|-------------|------------------------------------------|------------|
| `API_HOST`  | Upstream API host:port for `/api/` proxy | `api:3000` |

## Deployment

### Kubernetes

Helm charts are provided in the `helm/` directory for Kubernetes deployment.

### Docker

The multi-stage `Dockerfile` produces three separate images via build targets:

```bash
# Build the API image
docker build --target api -t radinage-api .

# Build the MCP server image
docker build --target mcp -t radinage-mcp .

# Build the webapp image
docker build --target webapp -t radinage-webapp .
```

## License

This project is licensed under the Apache License 2.0. See [LICENSE.md](LICENSE.md) for details.
