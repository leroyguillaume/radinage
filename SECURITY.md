# Security policy

## Reporting a vulnerability

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/leroyguillaume/radinage/security/advisories/new).
The report opens a draft advisory that only the maintainers and you can see.

Do not open a public issue, pull request or discussion for a vulnerability:
describing it in public discloses it before it is fixed.

A useful report holds:

- the affected version;
- the steps to reproduce it;
- the impact as you see it.

## Supported versions

Fixes ship in a new release. Only the latest release is supported.

## Scope

In scope are the project's own code and the artifacts it publishes:

- the REST API: authentication, authorisation, data isolation between users,
  and the parsing of imported CSV and Excel files;
- the webapp;
- the container images and the Helm chart, including their defaults.

Out of scope:

- a vulnerability in a dependency that is already public upstream: report it
  there, the dependency updates bring the fix in;
- a finding that needs an already-compromised host or account;
- scanner output with no path to exploitation.

## What happens next

Reports are handled on a best-effort basis.

1. The report is acknowledged.
2. The vulnerability is assessed.
3. The fix is prepared in the advisory's private fork.
4. A release ships the fix.
5. The advisory is published, with a CVE requested through GitHub when the
   impact warrants one, and you are credited unless you prefer otherwise.
