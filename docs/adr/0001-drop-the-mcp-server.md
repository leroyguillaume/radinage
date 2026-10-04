# 0001. Drop the MCP server

- **Status**: accepted
- **Date**: 2026-10-04

## Context

Radinage shipped a third component next to the API and the web app:
`radinage-mcp`, a Model Context Protocol server that fetched the API's OpenAPI
document at startup and exposed each operation as a tool for AI assistants,
forwarding the caller's JWT to the API.

No MCP client uses it. It still costs as much as a real component: a Rust crate
to keep compiling, an image to build, scan and publish for two architectures, a
Deployment, Service and Ingress path in the Helm chart, and a dependency
(`rmcp`) with HIGH advisories whose fix is a major version bump.

## Decision

We remove `radinage-mcp`: its crate, its image, its Compose service, its chart
templates and values, and its CI entries. The system is the API and the web
app in front of PostgreSQL.

## Consequences

- One less image to build, scan and publish, one less workload in the chart,
  and no `rmcp` to keep patched.
- AI assistants have no packaged way to use Radinage. The API still serves its
  OpenAPI document at `/openapi.json`, so a client can be built against it
  without code in this repository.
- Breaking for chart users: `apps.mcp.*` and `ingress.apps.mcp` disappear, and
  `/mcp` is no longer routed. Values that set them must drop them.
- `ghcr.io/leroyguillaume/radinage-mcp` receives no new tags; published tags
  stay as they are.

## Alternatives considered

- **Keep it and upgrade `rmcp` to 2.x**: fixes the advisories, but keeps
  paying for a component with no users.
- **Keep the code, disable it in the chart by default**: the image is still
  built, scanned and published, and the dependency still needs patching.
