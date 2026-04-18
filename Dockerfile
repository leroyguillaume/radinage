# =============================================================================
# Stage 1: Rust builder — uses cargo-chef to cache dependency compilation
# independently from package version bumps.
# =============================================================================
FROM rust:1.94.1-alpine3.23 AS chef

RUN apk add --no-cache musl-dev~=1.2.5-r23 openssl-dev~=3.5.6 openssl-libs-static~=3.5.6 \
    && cargo install cargo-chef@0.1.77 --locked

WORKDIR /usr/src/local/radinage

# Planner: produces a recipe.json describing only the dependency graph. It
# ignores workspace package versions, so bumping the release version does not
# invalidate the downstream `cargo chef cook` cache.
FROM chef AS planner

COPY Cargo.toml Cargo.lock ./
COPY radinage-api/Cargo.toml radinage-api/Cargo.toml
COPY radinage-mcp/Cargo.toml radinage-mcp/Cargo.toml

RUN mkdir -p radinage-api/src radinage-mcp/src \
    && echo "fn main() {}" > radinage-api/src/main.rs \
    && echo "fn main() {}" > radinage-mcp/src/main.rs \
    && cargo chef prepare --recipe-path recipe.json

# Actual build: cook dependencies from the recipe (cached until deps change),
# then compile the real workspace sources.
FROM chef AS rust-builder

COPY --from=planner /usr/src/local/radinage/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

COPY Cargo.toml Cargo.lock ./
COPY radinage-api/ radinage-api/
COPY radinage-mcp/ radinage-mcp/

RUN cargo build --release

# =============================================================================
# Stage 2: Node builder (webapp)
# =============================================================================
FROM node:25.9.0-alpine3.23 AS webapp-builder

WORKDIR /usr/src/local/radinage

COPY radinage-webapp/package.json radinage-webapp/package-lock.json ./
RUN npm ci

COPY radinage-webapp/ .
RUN npm run build

# =============================================================================
# Target: radinage-api
# =============================================================================
FROM alpine:3.23 AS api

RUN addgroup -g 1000 -S radinage && adduser -u 1000 -S radinage -G radinage

COPY --from=rust-builder /usr/src/local/radinage/target/release/radinage-api /usr/local/bin/radinage-api
COPY radinage-api/migrations /opt/radinage/migrations

USER radinage

EXPOSE 3000

ENTRYPOINT ["radinage-api"]

# =============================================================================
# Target: radinage-mcp
# =============================================================================
FROM alpine:3.23 AS mcp

RUN addgroup -g 1000 -S radinage && adduser -u 1000 -S radinage -G radinage

COPY --from=rust-builder /usr/src/local/radinage/target/release/radinage-mcp /usr/local/bin/radinage-mcp

USER radinage

ENTRYPOINT ["radinage-mcp"]

# =============================================================================
# Target: radinage-webapp
# =============================================================================
FROM nginx:1.29.8-alpine3.23 AS webapp

RUN addgroup -g 1000 -S radinage && adduser -u 1000 -S radinage -G radinage \
    && mkdir -p /var/cache/nginx /var/run /etc/nginx/templates \
    && chown -R radinage:radinage /var/cache/nginx /var/run /etc/nginx/conf.d /etc/nginx/templates

COPY nginx.conf /etc/nginx/nginx.conf
COPY --chown=radinage:radinage default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=webapp-builder /usr/src/local/radinage/dist /usr/share/nginx/html

ENV API_HOST=api:3000

USER radinage

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
