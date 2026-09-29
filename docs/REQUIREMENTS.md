# Original Requirements

> Verbatim copy of the project brief. The binding technical design derived from it is in [ARCHITECTURE.md](./ARCHITECTURE.md).

```text
You are a senior software architect and full-stack developer.

Build a complete, production-oriented SCP:SL global anti-cheat, reporting, evidence and trust platform.

The system consists of THREE major components:

1. SCP:SL LabAPI Plugin written in C#
2. Backend/API written in JavaScript/TypeScript
3. Web panel/frontend with authentication and administration

The system must be designed around:

    "Centralized Transparency, Decentralized Enforcement"

The backend provides trusted information, evidence, reports and case history.

Individual SCP:SL servers remain responsible for deciding what action to take.

Do NOT build a system where the central backend blindly forces a global ban on every connected server.


==================================================
1. PROJECT STRUCTURE
==================================================

Create a monorepo with a clean structure similar to:

    /plugin
        SCP:SL LabAPI plugin

    /backend
        REST API
        authentication
        database
        evidence system
        server authentication
        policy/check APIs

    /web
        frontend
        login
        dashboard
        cases
        reports
        players
        servers
        appeals
        whitelist requests
        administration

    /shared
        shared types
        API schemas
        enums
        validation schemas

Use TypeScript for the backend unless there is a strong technical reason not to.

Use PostgreSQL as the primary database.

Use Redis where useful for:
    - caching
    - rate limiting
    - temporary proof codes
    - sessions / short-lived state

Use an object-storage abstraction for evidence files.

Do not hard-code infrastructure-specific assumptions.


==================================================
2. SCP:SL PLUGIN
==================================================

The plugin must be written for SCP:SL LabAPI.

Do NOT use Exiled.

The plugin should:

- register the SCP:SL server
- generate/manage the server identity
- authenticate requests to the backend
- check players when they join
- collect relevant server-side information
- provide Overwatch/evidence proof functionality
- handle VPN/bypass checks
- handle account-age checks
- optionally detect possible alt-account signals
- allow server-specific configuration
- never expose the server private key


==================================================
3. SERVER AUTHENTICATION
==================================================

Use public-key cryptography.

Every SCP:SL server gets:

    server_id
    private_key
    public_key

Use Ed25519.

The private key MUST remain on the SCP:SL server.

The backend stores only the public key.

Every authenticated API request should contain data such as:

    server_id
    timestamp
    nonce
    request_id
    signature

The signature must cover the relevant request data/body.

Backend verifies the signature using the registered public key.

Implement:

- key generation
- server registration
- authentication middleware
- timestamp validation
- nonce/replay protection
- request ID handling
- key rotation
- key revocation

Never send the private key to the backend.

The server should not use one global shared API secret.


==================================================
4. PLAYER JOIN CHECK
==================================================

When a player joins:

    Player joins
        ↓
    LabAPI plugin
        ↓
    Backend API
        ↓
    player check
        ↓
    response
        ↓
    local server policy
        ↓
    allow / warn / notify / kick / ban

Example endpoint:

    POST /api/v1/player/check

Example request:

{
    "server_id": "server_x",
    "player": {
        "type": "steam",
        "id": "765611..."
    },
    "ip": "...",
    "account_created_at": "..."
}

The backend response can contain:

{
    "global_status": "confirmed",
    "case_id": "CASE-2026-001337",

    "reports": 4,
    "confirmed_servers": 3,

    "account_age": {
        "days": 3
    },

    "vpn": {
        "detected": true,
        "confidence": "likely"
    },

    "bypass": {
        "active": false
    },

    "alt_account": {
        "possible": true,
        "confidence": "medium"
    }
}

The server decides what to do based on its own configuration.


==================================================
5. POLICY ENGINE
==================================================

Implement a configurable local policy engine.

Possible actions:

    ALLOW
    ADMIN_NOTIFY
    WARN
    REQUIRE_REVIEW
    KICK
    BAN

Policies should be configurable independently for:

    - global cheating verdict
    - account age
    - VPN detection
    - possible alt account
    - other future signals

Example:

    account_age < 7 days
        -> KICK

    VPN detected
        -> REQUIRE_VPN_WHITELIST

    confirmed global cheating
        -> ADMIN_NOTIFY

Another server might choose:

    confirmed global cheating
        -> BAN

The central backend MUST NOT dictate the local enforcement action.


==================================================
6. ACCOUNT AGE SYSTEM
==================================================

Implement account-age checking.

Servers should be able to configure rules such as:

    < 3 days -> kick
    < 7 days -> kick
    < 14 days -> admin notification

Account age is NOT a cheating verdict.

It is only a server policy signal.

Allow server-specific whitelisting.


==================================================
7. VPN / PROXY DETECTION
==================================================

Implement backend-side VPN/proxy detection through an abstraction.

Do not tightly couple the system to one external provider.

Create something like:

    IVpnDetectionProvider

Possible result:

{
    "detected": true,
    "confidence": "likely",
    "type": "vpn"
}

Confidence levels:

    NOT_DETECTED
    POSSIBLE
    LIKELY
    CONFIRMED

The plugin asks the backend whether a player currently has a valid bypass.

Example:

POST /api/v1/player/bypass/check

{
    "server_id": "...",
    "player": {
        "type": "steam",
        "id": "..."
    }
}

Response:

{
    "vpn": true,
    "bypass": true,
    "bypass_type": "vpn_whitelist",
    "expires_at": "..."
}

Bypasses MUST be server-specific unless explicitly configured otherwise.


==================================================
8. VPN WHITELIST WEBSITE FLOW
==================================================

Players can request a VPN bypass through the website.

Flow:

    Player
        ↓
    Web panel
        ↓
    VPN whitelist request
        ↓
    Backend
        ↓
    Server admin
        ↓
    Approve / Reject
        ↓
    Audit log

Support:

    pending
    approved
    rejected
    expired
    revoked

Every decision must be logged.

The SCP:SL server does not maintain its own VPN whitelist database.

It asks the backend.


==================================================
9. ALT ACCOUNT SYSTEM
==================================================

Implement IP-based alt-account detection only as a signal.

Example:

    Account A = banned
    Account B = same IP

This must NOT automatically mean that Account B is the same person.

Same public IP can be shared by:

    families
    schools
    companies
    NAT
    mobile networks
    VPNs

Therefore return:

    possible_alt_account
    confidence

Example:

{
    "possible": true,
    "confidence": "medium",
    "signals": [
        "same_network_identifier"
    ]
}

Never expose raw IP addresses publicly.

Where possible, use privacy-preserving identifiers such as HMAC-based hashes for correlation.


==================================================
10. REPORT SYSTEM
==================================================

Implement a complete report system.

A report should contain:

    report_id
    case_id
    player_id
    server_id
    reporter
    reason
    evidence
    created_at
    status

Possible report states:

    OPEN
    UNDER_REVIEW
    RESOLVED
    REJECTED

A report should never silently disappear.

Every important change creates an audit event.


==================================================
11. CASE SYSTEM
==================================================

Cases are the central unit of the moderation/evidence system.

Example:

    CASE-2026-001337

Fields:

    case_id
    player
    current_verdict
    reason
    created_at
    updated_at

Possible verdicts:

    UNKNOWN
    INCONCLUSIVE
    CONFIRMED
    REJECTED

A case should contain:

    reports
    evidence
    review history
    appeal history
    server confirmations
    audit events


==================================================
12. EVIDENCE SYSTEM
==================================================

Evidence must have its own status.

Possible evidence statuses:

    UNVERIFIED
    VERIFIED
    REJECTED
    INCONCLUSIVE

Important:

"UNVERIFIED" does NOT mean fake.

It means that the evidence has not yet been independently reviewed.

Separate these questions:

    1. Is the identity correct?
    2. Is the evidence authentic?
    3. Does the evidence actually demonstrate cheating?

Do not automatically turn evidence into a cheating verdict.


==================================================
13. OVERWATCH PROOF SYSTEM
==================================================

Implement a server-side proof system for Overwatch recordings.

When an admin spectates a player:

    plugin creates an Overwatch session.

Backend stores:

    session_id
    server_id
    target_player
    spectator
    started_at
    ended_at

During the session, display a short dynamic proof code on screen.

Example:

    15:42:20 -> 7K4-X92
    15:42:30 -> M8P-Q17
    15:42:40 -> 4KF-91A

The code changes periodically.

The code must be generated/validated using trusted backend/server data.

The purpose is to prove:

    this recording corresponds to a real registered
    Overwatch session and target.

It does NOT prove that the target cheated.

The actual cheating conclusion still requires evidence review.


==================================================
14. PROOF API
==================================================

Implement an endpoint similar to:

    GET /api/v1/evidence/proof

Parameters:

    server_id
    player_id
    spectator_id
    timestamp

Backend verifies whether the timestamp belongs to the registered session.

Example response:

{
    "valid": true,
    "code": "7K4-X92",
    "server_id": "...",
    "player_id": "...",
    "spectator_id": "...",
    "timestamp_window": "..."
}

Use short-lived codes and prevent trivial replay/manipulation.

Consider cryptographic nonces where appropriate.


==================================================
15. EVIDENCE INTEGRITY
==================================================

Evidence should have hashes.

When evidence is uploaded:

    calculate cryptographic hash

Store:

    hash
    size
    MIME type
    upload timestamp
    uploader
    storage reference

Do not allow silent replacement of evidence.

If evidence needs to be replaced:

    create a new evidence object

and preserve the old object and history.


==================================================
16. APPEAL SYSTEM
==================================================

Players can appeal cases.

Flow:

    Player
        ↓
    Appeal
        ↓
    Reviewer
        ↓
    Confirm
    Reverse
    Inconclusive

Preferably an appeal should not be decided solely by the same reviewer
who made the original decision.

All appeal actions must be audited.


==================================================
17. AUDIT LOG
==================================================

Implement an append-only audit system.

Examples:

    REPORT_CREATED
    EVIDENCE_UPLOADED
    EVIDENCE_VERIFIED
    EVIDENCE_REJECTED
    CASE_CREATED
    VERDICT_CHANGED
    REVIEW_STARTED
    APPEAL_CREATED
    APPEAL_RESOLVED
    SERVER_REGISTERED
    SERVER_KEY_ROTATED
    BYPASS_REQUESTED
    BYPASS_APPROVED
    BYPASS_REJECTED
    BYPASS_REVOKED

Each event should contain:

    event_id
    actor
    action
    target
    timestamp
    metadata

Optionally implement hash chaining:

    event_n.hash =
        SHA256(event_n.data + event_(n-1).hash)

This makes tampering detectable.


==================================================
18. GLOBAL CONFIRMATION
==================================================

The backend can track how many independent servers have confirmed a case.

Example:

    reports: 4
    confirmed_servers: 3

This information should be visible to reviewers and servers.

Do NOT implement simplistic logic such as:

    3 reports = automatically guilty

Cases remain evidence-driven.


==================================================
19. WEB PANEL
==================================================

Build a modern professional web panel.

Required:

    Login
    Registration if appropriate
    Password reset
    2FA support
    Session management
    Logout
    Role-based access control

Roles:

    PLAYER
    SERVER_ADMIN
    REVIEWER
    MODERATOR
    ADMIN
    SUPER_ADMIN

Do not expose administrative functions to unauthorized roles.


==================================================
20. WEB DASHBOARD
==================================================

Dashboard should show:

    Open cases
    Pending reports
    Pending appeals
    Evidence awaiting review
    VPN whitelist requests
    Server status
    Recent audit events

Use clean cards/tables and filtering.

Do not over-design the interface.

Prioritize clarity and information density.


==================================================
21. CASE PAGE
==================================================

Case page should show:

    Case ID
    Player
    Verdict
    Reason
    Reports
    Evidence
    Evidence status
    Review history
    Appeal status
    Confirmed servers
    Audit history

Example:

    CASE-2026-001337

    Verdict:
        CONFIRMED

    Evidence:
        Video #1
        Log #2

    Review:
        Reviewer #184

    History:
        Report submitted
        Evidence uploaded
        Evidence verified
        Verdict confirmed
        Appeal submitted


==================================================
22. SERVER MANAGEMENT
==================================================

Server admins should have a server dashboard.

Show:

    Server ID
    Status
    Public key fingerprint
    Created date
    Last seen
    Plugin version
    Configuration

Allow:

    key rotation
    key revocation
    policy configuration
    server-specific whitelist management


==================================================
23. SERVER POLICY UI
==================================================

Create an interface where server admins can configure:

    Global verdict action
    VPN action
    Account-age action
    Alt-account action

Example:

    Confirmed cheating:
        [Admin Notify]

    VPN:
        [Require Whitelist]

    Account < 7 days:
        [Kick]

    Possible alt:
        [Admin Notify]


==================================================
24. PLAYER PAGE
==================================================

Player page should show only appropriate information.

Possible:

    Player identity
    Cases
    Verdicts
    Reports
    Appeals
    Server confirmations

Do not expose sensitive information such as:

    raw IP addresses
    private server secrets
    private reviewer information
    API credentials


==================================================
25. AUTHENTICATION SECURITY
==================================================

Implement secure authentication.

Use:

    Argon2id or bcrypt for passwords
    secure sessions
    CSRF protection where applicable
    secure cookies
    rate limiting
    account lockout / throttling
    email verification
    optional/required 2FA for admins

Never store plaintext passwords.

Use role-based authorization on the backend, not only in the frontend.


==================================================
26. API SECURITY
==================================================

Implement:

    request validation
    schema validation
    authentication middleware
    authorization middleware
    rate limiting
    replay protection
    nonce validation
    timestamp validation
    request size limits
    secure headers
    audit logging

Do not trust anything from the plugin or frontend without verification.


==================================================
27. API VERSIONING
==================================================

Use versioned APIs:

    /api/v1/...

Keep the API modular so future plugin versions can coexist.

The plugin should send its version.

Example:

    plugin_version:
        1.0.0


==================================================
28. DATABASE
==================================================

Use PostgreSQL.

Create proper migrations.

Suggested tables:

    users
    sessions
    servers
    server_keys
    players
    cases
    reports
    evidence
    reviews
    appeals
    audit_events
    overwatch_sessions
    bypasses
    whitelist_requests
    server_policies
    player_signals

Use foreign keys and indexes appropriately.

Do not store everything as unstructured JSON.


==================================================
29. PRIVACY
==================================================

Use data minimization.

Do not expose:

    raw IPs
    private keys
    internal infrastructure
    unnecessary personal information

Provide configurable retention policies.

Evidence should have controlled access.

Public case information should be intentionally limited.


==================================================
30. FRONTEND TECHNOLOGY
==================================================

Choose a modern stack such as:

    React
    TypeScript
    Vite / Next.js

Use a component-based architecture.

Use a proper API client.

Do not put business logic exclusively in the frontend.

The backend must always enforce permissions.


==================================================
31. BACKEND TECHNOLOGY
==================================================

Use:

    Node.js
    TypeScript
    PostgreSQL
    Redis

Framework can be:

    Fastify
    NestJS
    Express

Prefer a structured architecture with:

    controllers/routes
    services
    repositories
    models
    middleware
    validators
    authentication
    authorization


==================================================
32. DOCUMENTATION
==================================================

Generate:

    README.md
    API documentation
    setup instructions
    database setup
    environment variable documentation
    plugin installation guide
    server registration guide
    deployment guide
    security documentation

Document every public API endpoint.


==================================================
33. ENVIRONMENT CONFIGURATION
==================================================

Use environment variables.

Example:

    DATABASE_URL=
    REDIS_URL=
    JWT_SECRET=
    SESSION_SECRET=
    STORAGE_ENDPOINT=
    STORAGE_BUCKET=
    STORAGE_ACCESS_KEY=
    STORAGE_SECRET_KEY=

Never hard-code secrets.

Provide:

    .env.example


==================================================
34. DOCKER
==================================================

Provide Docker support.

At minimum:

    backend
    web
    postgres
    redis

Use docker-compose for local development.

Make production deployment possible without requiring Docker,
but Docker should be supported.


==================================================
35. TESTING
==================================================

Implement tests for important functionality.

Especially:

    Ed25519 request verification
    replay protection
    authentication
    authorization
    case creation
    evidence hashing
    evidence permissions
    appeals
    bypass expiration
    VPN detection logic
    account-age policies
    policy engine
    audit log
    proof-code validation

Do not only test happy paths.

Test invalid signatures, expired requests, revoked keys,
unauthorized users and manipulated data.


==================================================
36. ERROR HANDLING
==================================================

Use consistent API responses.

Example:

{
    "error": {
        "code": "INVALID_SIGNATURE",
        "message": "Request signature is invalid"
    }
}

Never return stack traces or secrets to clients.


==================================================
37. LOGGING
==================================================

Implement structured logging.

Logs should include:

    timestamp
    request_id
    server_id where applicable
    endpoint
    result
    latency

Do not log:

    passwords
    private keys
    authentication tokens
    raw sensitive data unnecessarily


==================================================
38. DEVELOPMENT APPROACH
==================================================

Do NOT generate the entire project as one giant unreadable file.

Build the project in logical modules.

First create:

    project structure
    database schema
    shared types
    backend foundation
    authentication
    server authentication
    player check API
    plugin foundation
    policy engine
    evidence system
    case system
    web authentication
    dashboard
    administration

Then integrate everything.

Keep interfaces clean.


==================================================
39. IMPORTANT ARCHITECTURAL RULES
==================================================

RULE 1:

The central backend provides information.

The individual SCP:SL server decides enforcement.


RULE 2:

Authentication, evidence authenticity and cheating verdicts
are three separate concepts.


RULE 3:

A VPN is not automatically cheating.


RULE 4:

An account being young is not automatically cheating.


RULE 5:

A shared IP is not proof that two accounts belong to the same person.


RULE 6:

A verified video/session proves the recording/session identity,
not automatically the cheating verdict.


RULE 7:

No silent deletion or modification of important case history.


RULE 8:

Every important administrative action must be auditable.


RULE 9:

Private keys never leave the server.


RULE 10:

Frontend permissions are never trusted.
The backend enforces all permissions.


==================================================
40. EXPECTED FINAL RESULT
==================================================

The finished project should provide:

    SCP:SL LabAPI Plugin
            ↕
       Secure API
            ↕
       JavaScript/
       TypeScript Backend
            ↕
       PostgreSQL + Redis
            ↕
       Web Panel

The platform must support:

    ✓ Server registration
    ✓ Ed25519 authentication
    ✓ Player checks
    ✓ Global cases
    ✓ Reports
    ✓ Evidence
    ✓ Evidence verification
    ✓ Overwatch proof codes
    ✓ Appeals
    ✓ Audit logs
    ✓ Global server confirmations
    ✓ Account-age checks
    ✓ VPN detection
    ✓ VPN bypasses
    ✓ Alt-account signals
    ✓ Server-specific policies
    ✓ Server-specific whitelists
    ✓ Login
    ✓ Roles
    ✓ 2FA
    ✓ Server management
    ✓ Case management
    ✓ Player management
    ✓ Admin panel
    ✓ API documentation
    ✓ Database migrations
    ✓ Docker development environment
    ✓ Automated tests

The final implementation should be production-oriented, secure,
maintainable and modular.

Do not simplify the architecture into a toy project.

Before writing large amounts of code, first produce the proposed
repository structure, database schema and API architecture.
Then implement the system incrementally while keeping all components
consistent.```
