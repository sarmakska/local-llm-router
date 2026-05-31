# Security Policy

## Reporting a vulnerability

If you have found a security issue in this project, please report it privately by email to security@sarmalinux.com rather than opening a public GitHub issue. Include a clear description of the issue, the steps to reproduce it, the commit SHA you tested against, and any proof-of-concept code or output. The more detail you give me, the faster I can confirm and fix it.

## Response policy

I respond within 7 days. I will acknowledge your report, confirm whether I can reproduce the issue, and tell you my planned fix and timeline. Confirmed issues are patched on `main` and released as a tagged version, and I credit reporters in the release notes unless you ask me not to.

## Supported versions

Security fixes land on `main` and ship in the next tagged release. Only the latest minor release line receives fixes, so pin to a recent tag and upgrade promptly.

| Version | Supported |
|---|---|
| 1.1.x | Yes |
| 1.0.x | No |
| < 1.0 | No |

## Scope

This policy covers the code in this repository. Vulnerabilities in upstream dependencies should be reported to those projects directly, and issues in third-party services, findings that require physical access to a developer machine, and purely theoretical risks without a working proof of concept are out of scope.
