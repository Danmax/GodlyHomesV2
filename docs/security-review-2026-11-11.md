# Godly Homes security review — 2026-11-11

## Scope and method

Reviewed Express route ordering, public/private boundaries, authentication and account activation, password reset, roles and podcaster approval, newsletter consent, Resend/Gmail/SMTP transports, Stripe checkout/webhooks/fulfillment, media import/restoration/render workers, database access, browser storage, and supplied deployment configuration. Reproductions used disposable local media files and an isolated MySQL instance with networking disabled. Live checks were read-only except the authorized deployment and schema migration; no real payments, role promotions, account-password changes, or exploit payloads were sent to production.

Severity describes practical impact in this application. “Fixed” means a code correction with regression coverage; it does not imply the whole application or host is vulnerability-free. No native-code memory-corruption exploit was attempted.

## Confirmed findings and corrections

### 1. High — uploaded playlists could import other local audio files

**Before:** Import constrained network protocols to `file,pipe`, but still auto-detected playlist demuxers. A crafted HLS playlist supplied an absolute path to a different local WAV. The existing conversion command read it and produced a 20,339-byte FLAC in the reproduction. Any server-readable media path known to a publisher could therefore become an audio source despite source ownership checks. This proves local media inclusion, not arbitrary text-file extraction or remote code execution.

**Correction:** `server/audio.js` defines an explicit allowlist of self-contained input demuxers. `server/app.js` uses it for imports; HLS, DASH and concat are excluded. Workers explicitly interpret stored source recordings as FLAC with restricted protocols. WAV, MP3, M4A, OGG, WebM and FLAC still pass conversion tests. The native process timeout and output limits remain in place.

**Evidence:** `test/media-security.test.js` rejects the same HLS payload and checks six supported media formats; the integration suite exercises real conversion and rendering.

### 2. High — activation could preserve an attacker-selected pre-registration password

**Before:** Public registration stored the supplied password before proving email ownership. Registering an existing unverified email was ignored, and clicking its verification link only set a verification timestamp. If an attacker registered the address first, the mailbox owner could subsequently verify an account retaining the attacker's password.

**Correction:** Registration accepts an email and generates an unknown random placeholder password. The email owner sets the active password on the verification page, atomically with token consumption and session revocation. This also protects unverified accounts created before the fix. Existing verified accounts keep their credentials. Old API clients cannot activate with a token alone.

**Evidence:** Account integration tests assert that pre-verification supplied credentials do not match the stored hash, that activation sets the mailbox owner's selected password, and that the attacker's earlier password cannot sign in. Browser tests cover the revised signup and activation forms.

### 3. Medium — provider stalls could exhaust the database connection pool

**Before:** Verification/reset mail, welcome mail and newsletter contact synchronization called external services while holding MySQL transactions and row locks. A provider outage could occupy the eight-connection pool and block unrelated requests. A repeatedly failing welcome recipient could also prevent later recipients being attempted.

**Correction:** Token changes commit before delivery. Welcome/contact synchronization claims a two-minute database lease, releases the connection, calls the provider, then writes completion only if it still owns the lease. Failures back off, crashed leases expire, and one failed welcome does not abort the rest of a retry batch. Failed link requests retain a durable recipient cooldown. `account_tokens.sent_at` records acknowledged acceptance without storing the raw link token.

**Evidence:** An integration test reserves seven of eight connections, stalls Resend synchronization, and proves a health query can still obtain the final connection. Tests also cover concurrent synchronization, cooldowns, retries and token replay.

### 4. Medium — audio-restoration uploads bypassed processing reservations

**Before:** The authenticated source/render restoration endpoints and worker output reception accepted large streamed files without the database-backed concurrency gate used by normal uploads. Multiple requests could write temporary copies simultaneously even for an existing immutable destination.

**Correction:** Restoration has its own global/per-account transfer reservations (two globally and one per account with the existing configuration). Files already counted in asset/job storage are not charged twice. The reservations are released before success responses and after interruptions; transfer size is bounded by the configured upload maximum. This prevents unlimited simultaneous temporary copies but is not a network bandwidth firewall.

**Evidence:** Upload security integration tests hold a reservation and prove restoration is rejected with HTTP 429, then verify reservation cleanup on failure. Existing checksum/length/ownership/immutable-file tests still pass.

### 5. Medium — newsletter signups did not prove mailbox ownership

**Before:** A caller could submit any address with `consent: true` and add it to Resend. The checkbox recorded a claim of consent but did not establish control of the mailbox.

**Correction:** New subscribers remain pending until they consume a hashed, single-use, 24-hour confirmation token. Both immediate and background Resend sync exclude unconfirmed records. Confirmation requests have an IP limit and one-minute recipient cooldown. The owner approved this change during the review. Migration 013 preserves previously collected subscribers as confirmed rather than silently removing the existing list. Existing Resend unsubscribe status is never overwritten.

**Evidence:** Tests cover missing consent, unconfirmed exclusion from both sync paths, confirmation, expiry, renewal, replay, simultaneous confirmation, provider outage and browser confirmation without account creation.

### 6. Medium / defense in depth — sensitive admin access changes needed no reauthentication

**Before:** A valid full-admin session and CSRF token could grant another full administrator, deactivate an account, or revoke sessions without the operator proving their password again. This increased the persistence/denial impact of a stolen or unattended admin session; it was not an unauthenticated role bypass.

**Correction:** These access changes now require the acting administrator's current password and have an authenticated request limit. Podcaster application reviews remain available to authorized junior administrators without exposing full-admin controls. Passwords are explicitly removed from audit event details. Self-access and last-admin safeguards remain.

**Evidence:** Role-management tests reject wrong/missing credentials, preserve junior restrictions and concurrent-demotion protection, and assert access history contains no reauthentication field. Browser tests exercise the new masked confirmation input.

### 7. Low — upload success could race reservation cleanup

**Before:** Image/audio handlers sent HTTP 201 before their asynchronous `finally` block removed the reservation. An immediate next upload could be rejected as already in progress even though the previous request had completed.

**Correction:** Upload handlers return their result to the wrapper. It releases reservations before emitting success, including the remote image-forwarding path. Existing import/image/concurrency tests cover the resulting flow.

### 8. Medium — automatic deployment could publish code before its schema migration

**Observed:** The latest Git-triggered security build was already published while production still recorded migration 012. The frontend-only build did not enforce the database prerequisite, so routes using migration 013 could fail until the manual migration ran.

**Correction:** Added `build:deploy` (`npm run db:migrate && npm run build`) and configured the hosted build to use it. Migration failure now prevents publication. Ordinary local/frontend builds remain database-free. Existing versioned migrations still use the database advisory lock to serialize runners. This is release ordering, not automatic rollback of MySQL DDL.

## Additional checks and results

- `npm audit --json`: **0 reported advisories**, including production and development npm dependencies at review time. This is not a native-binary or zero-day guarantee.
- Scanned tracked text and Git history for common private-key/Stripe/Resend credential patterns: no matches. No tracked `.env` history was found. This is pattern scanning, not proof that no secret ever existed elsewhere.
- Live `/.env` and `/.git/config`: HTTP 403. `/package.json` and `/server/auth.js`: HTTP 404. No config/source material was returned in these checks.
- Anonymous admin user and order APIs: HTTP 401. Junior-admin product access, encoded product paths, order/customer data, role grants and destructive cross-author episode actions remain blocked in integration tests.
- Live API response included HSTS, CSP, `nosniff`, and `Cache-Control: no-store`.
- Reviewed SQL parameterization and bounded numeric interpolation, source/episode ownership, private-channel and hidden-episode media/RSS gates, DOM rendering and URL validation. No new SQL injection, stored-script execution or unauthenticated admin-access reproduction was found in this pass.
- Stripe tests continue to cover server-owned pricing, mode matching, signed raw-body webhooks, event deduplication, refunds/disputes, delayed payment state, and fail-closed fulfillment. No live card or real refund was used.

## Remaining risks and verification limits

1. **High-priority operational follow-up: old native FFmpeg.** The installed local `ffmpeg-static` executable reports **FFmpeg 6.0**, even though its npm wrapper is 5.3.0. No current security patch level was established for this executable. Replace the actual render/import runtime with a patched supported FFmpeg/ffprobe distribution and rerun media tests. Package-lock/npm audit cannot attest to the native executable. The playlist fix narrows input behavior but does not fix codec memory-safety defects. The precise native version installed inside Hostinger was not available through the connected hosting API and was not verified. Native sandbox isolation also remains advisable. See [FFmpeg security](https://ffmpeg.org/security.html) and [wrapper documentation](https://github.com/eugeneware/ffmpeg-static).
2. **Rate limits are process-local.** Existing Express limiter counters reset on restart and are not coordinated across multiple Node processes. A shared limiter store or edge controls are still needed for aggregate limits when running multiple instances. Database-backed recipient cooldowns, upload/transfer reservations and render budgets are shared, but they do not replace a global abuse policy. Newsletter confirmation prevents list enrollment without proof; it does not by itself prevent distributed confirmation-email bombing.
3. **No administrator MFA.** Reauthentication reduces stolen-session persistence but does not provide a second factor or protect a stolen password. MFA/passkeys, account-recovery policy and sign-in alerts remain follow-up work.
4. **Docker deployment not validated.** The supplied Compose file uses `DB_HOST=mysql`, while remote DB connections require trusted, hostname-verified TLS. MySQL's default self-signed certificates are insufficient without deliberate CA/certificate provisioning. Configure trusted certificates for that path rather than disabling verification. This review used the existing Hostinger setup; it did not start Docker or validate a restore drill.
5. **No exhaustive penetration test or infrastructure audit.** Host-level access, SSH, upstream proxy-header topology, OS patch status, native binaries, provider account permissions, backups/restore, and sustained load were not independently verified. No destructive production test or inbox-reading access was used.

## Release and validation

Schema migration: `013_security_review.sql`. No existing verified passwords, roles, or confirmed newsletter memberships are changed by it. Apply the migration before the matching API release. Public registration now collects email first; the owner chooses a password in the activation step. New newsletter signups must confirm; existing list entries are grandfathered. Admin operators will see a current-password field for sensitive access changes.

Validation commands: `npm test`, `npm run test:integration`, `npm run build`, `npm run test:pages`. The media security test uses real FFmpeg; database/provider tests use isolated MySQL and simulated external services. One integration attempt encountered a local HTTP/TLS transport parse error while running simulated Stripe checks; a complete rerun passed. No payment defect was reproduced from that transport failure.
