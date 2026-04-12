# =============================================================================
# Stage 1: Rust builder
# =============================================================================
FROM rust:1.94.1-alpine3.23 AS rust-builder

RUN apk add --no-cache musl-dev=1.2.5-r21 openssl-dev=3.5.6-r0 openssl-libs-static=3.5.6-r0

WORKDIR /usr/src/local/radinage

COPY Cargo.toml Cargo.lock ./
COPY radinage-api/Cargo.toml radinage-api/Cargo.toml
COPY radinage-mcp/Cargo.toml radinage-mcp/Cargo.toml

# Create dummy source files to cache dependency builds
RUN mkdir -p radinage-api/src radinage-mcp/src \
    && echo "fn main() {}" > radinage-api/src/main.rs \
    && echo "fn main() {}" > radinage-mcp/src/main.rs \
    && cargo build --release \
    && rm -rf radinage-api/src radinage-mcp/src

COPY radinage-api/ radinage-api/
COPY radinage-mcp/ radinage-mcp/

# Touch main.rs so cargo detects the source change
RUN touch radinage-api/src/main.rs radinage-mcp/src/main.rs \
    && cargo build --release

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
    && mkdir -p /var/cache/nginx /var/run \
    && chown -R radinage:radinage /var/cache/nginx /var/run /etc/nginx/conf.d

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=webapp-builder /usr/src/local/radinage/dist /usr/share/nginx/html

USER radinage

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
