# Security policy

This project handles ban evidence, account links and moderator credentials for SCP:SL communities.
Please report anything that could compromise that data **privately**.

## Reporting a vulnerability

**Use GitHub private security advisories:**
<https://github.com/GermanClaude/websiteeine-website/security/advisories/new>

That form is private to you and the maintainers until an advisory is published.

> **Maintainer: fill this in.** An e-mail fallback has deliberately *not* been invented here.
> If you want one, replace this block with a real address you monitor — for example
> `security@your-domain.example` — and say whether it accepts PGP.

**Do not open a public issue, pull request or discussion for a vulnerability**, and do not post it
in a community Discord. If you have already done so, delete it and file an advisory instead.

Helpful reports include: affected component (plugin / backend / web / shared), version or commit,
the exact request or steps, what an attacker gains, and any log excerpt — with secrets redacted.
A proof of concept against your own local stack (`docker compose up`) is ideal; please do not test
against someone else's production instance.

## Response expectations

| Stage | Target |
|---|---|
| Acknowledgement that the report was received | 3 working days |
| Initial assessment (valid / not valid, rough severity) | 10 working days |
| Fix or documented mitigation for a confirmed high-severity issue | 30 days |

This is a volunteer-maintained project, not a funded security team; these are goals, not an SLA.
We will tell you if something is going to take longer. There is no bug bounty. If you would like
credit in the advisory, say so in the report.

Please give us a reasonable chance to ship a fix before disclosing publicly.

## Scope

**In scope** — anything in this repository:

* Backend API (`backend/`): authentication, session and CSRF handling, 2FA, RBAC bypasses,
  IDOR, SQL injection, SSRF, rate-limit and lockout bypasses, insecure file handling.
* Request signing and the server protocol (`shared/`, `plugin/`): Ed25519 signature or
  canonicalization flaws, replay / nonce weaknesses, key-rotation or revocation bypasses,
  registration-token abuse.
* Integrity guarantees: forging or silently altering evidence, cases or the hash-chained audit
  log (R7, R8).
* Privacy: anything that exposes raw IPs, e-mail addresses, password hashes or 2FA secrets, or
  that de-anonymizes the salted network hashes.
* Web panel (`web/`): XSS, CSRF, clickjacking, authorization rendered client-side only (R10).
* Supply chain: a committed secret, a malicious or compromised dependency, an unsafe CI workflow.

**Out of scope:**

* Findings that require an already-compromised host, database or private key.
* Misconfiguration of a third-party deployment (your own reverse proxy, TLS, firewall) rather
  than a defect in this code — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
* Missing hardening headers or rate limits with no demonstrated impact, and automated scanner
  output without a working scenario.
* Vulnerabilities in SCP:SL, LabAPI or the game client itself — report those to their maintainers.
* Social engineering of maintainers or server owners, and denial of service by sheer volume.
* The deliberate design decisions in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §0 — for
  example that the backend never returns an enforcement action. Disagreement is an issue, not a
  vulnerability.

## Threat model and controls

What this system is designed to resist, and how — trust boundaries, attacker classes, signing,
replay protection, audit-chain integrity and data minimization — is documented in
[docs/SECURITY.md](docs/SECURITY.md), with the privacy side in
[docs/PRIVACY.md](docs/PRIVACY.md). Please skim it before reporting: it may already explain why
something works the way it does.

## Supported versions

There is no tagged release yet. Fixes land on `main`; run the latest commit.
