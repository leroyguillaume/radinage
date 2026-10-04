# =============================================================================
# Stage 1: Rust builder — uses cargo-chef to cache dependency compilation
# independently from package version bumps.
# =============================================================================
FROM rust:1.94.1-alpine3.23 AS chef

RUN apk add --no-cache musl-dev=1.2.5-r23 openssl-dev=3.5.9-r0 openssl-libs-static=3.5.9-r0 \
    && cargo install cargo-chef@0.1.77 --locked

WORKDIR /usr/src/local/radinage

# Planner: produces a recipe.json describing only the dependency graph. It
# ignores workspace package versions, so bumping the release version does not
# invalidate the downstream `cargo chef cook` cache.
FROM chef AS planner

COPY Cargo.toml Cargo.lock ./
COPY radinage-api/Cargo.toml radinage-api/Cargo.toml

RUN mkdir -p radinage-api/src \
    && echo "fn main() {}" > radinage-api/src/main.rs \
    && cargo chef prepare --recipe-path recipe.json

# Actual build: cook dependencies from the recipe (cached until deps change),
# then compile the real workspace sources.
FROM chef AS rust-builder

COPY --from=planner /usr/src/local/radinage/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

COPY Cargo.toml Cargo.lock ./
COPY radinage-api/ radinage-api/

RUN cargo build --release

# =============================================================================
# Stage 2: Node builder (webapp)
# =============================================================================
FROM node:26.10.0-alpine3.23 AS webapp-builder

WORKDIR /usr/src/local/radinage

COPY radinage-webapp/package.json radinage-webapp/package-lock.json ./
RUN npm ci

COPY radinage-webapp/ .
RUN npm run build

# =============================================================================
# Target: radinage-api
# =============================================================================
FROM alpine:3.23 AS api

RUN addgroup -g 65532 -S radinage && adduser -u 65532 -S radinage -G radinage

COPY --from=rust-builder /usr/src/local/radinage/target/release/radinage-api /usr/local/bin/radinage-api
COPY radinage-api/migrations /opt/radinage/migrations

USER 65532:65532

EXPOSE 3000

HEALTHCHECK CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:3000/health"]

ENTRYPOINT ["radinage-api"]

# =============================================================================
# Target: radinage-webapp
# =============================================================================
FROM nginx:1.31.6-alpine3.24 AS webapp

# The nginx image lags behind Alpine security updates; these clear CVE-2026-93990
# (libexpat) and CVE-2026-103111 (pcre2) until a newer nginx image ships them.
RUN apk add --no-cache libexpat=2.8.5-r0 pcre2=10.49-r0 \
    && addgroup -g 65532 -S radinage && adduser -u 65532 -S radinage -G radinage \
    && mkdir -p /var/cache/nginx /var/run /etc/nginx/templates \
    && chown -R radinage:radinage /var/cache/nginx /var/run /etc/nginx/conf.d /etc/nginx/templates

COPY nginx.conf /etc/nginx/nginx.conf
COPY --chown=radinage:radinage default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=webapp-builder /usr/src/local/radinage/dist /usr/share/nginx/html

ENV API_HOST=api:3000

USER 65532:65532

EXPOSE 8080

HEALTHCHECK CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]

CMD ["nginx", "-g", "daemon off;"]
