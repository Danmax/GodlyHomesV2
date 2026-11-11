# Godly Homes MVP

Solo podcast recording and publishing for **godlyhomes.com**. The original two JSX prototypes remain in the repository for reference; the runnable application is in `src/` and `server/`.

## Included

- Responsive public homepage, real episode audio players, episode pages and `/podcast/feed.xml`.
- About (`/about`), searchable Reflexions (`/resources`) linking to selected external resources, and Store (`/store`) for upcoming digital resources and physical products. Shared desktop/mobile navigation connects the pages. Purchases are not enabled until a catalog and checkout are configured.
- Private studio accounts, scrypt password hashes, database-backed sessions, origin/CSRF checks and per-user ownership.
- MySQL episode drafts with debounced autosave, explicit save, revision conflicts and undo during an editing session.
- Solo microphone capture, input meter, pause/resume, local IndexedDB chunk backups and recovery/download after interruption or upload failure.
- Audio import, source preview/waveform for smaller files, playhead trimming, range cuts, split/reorder, fades, gain and optional looping music with voice ducking. Reuse library audio as intro, segment, musical transition, or closing clips.
- Durable background render jobs with leases, heartbeat, interrupted-job recovery, FFmpeg two-pass loudness normalization, MP3 review and explicit publishing.
- Published versions remain unchanged during later draft edits. Unpublishing removes the public player/feed access.
- Episode owners can delete a draft or published episode from the list or editor after confirmation. Deletion removes the episode, its publication and render jobs; original/shared source audio remains available. Queued jobs are removed and running workers discard results for deleted jobs.
- Newsletter email collection with explicit consent, durable Resend Contacts/Segment sync, and retry after provider outages.
- Website Admin through the same login: edit About, homepage and announcement copy, Reflexions/store page headings, logo, navigation, contact/footer and signup text. Create, edit, publish, unpublish and delete external Reflexions and digital/physical store items, including images, prices and checkout links.

The runtime is React/Vite + Express + `mysql2`, using versioned SQL migrations. This keeps the existing React components usable without a framework migration. Audio is converted into lossless FLAC sources on a persistent volume; database rows contain paths/metadata and edit instructions, not audio blobs. A separate worker renders MP3 exports. This is the single-VPS MVP storage implementation; S3/CDN integration is a later deployment option.

## Local development

Requires Node 22.14+, MySQL 8.0+ (tested locally with MySQL 9.6), FFmpeg and ffprobe. Do not expose the database port publicly.

1. `npm ci`
2. Copy `.env.example` to `.env`, create a dedicated local MySQL database and user, and fill in its credentials. The migration runner does not create databases or database users.
3. `npm run db:migrate`
4. Set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters in `.env`, then run `npm run admin:create`. Remove `ADMIN_PASSWORD` afterward. No default credentials exist. Public member registration requires the account email setup below.
5. `npm run dev` starts the API on port 3001, the frontend on port 5173, and the audio worker together. Open **http://localhost:5173** so the browser origin matches `APP_URL`.

Local development automatically uses the installed `ffmpeg-static` and `ffprobe-static` binaries. Explicit `FFMPEG_PATH` and `FFPROBE_PATH` executable paths override them. The production image uses OS-installed tools.

For a local production build, `npm run build`, set `APP_URL` to your served origin, then `npm start` and `npm run worker`. Microphone capture needs localhost or HTTPS.

### Account registration and email (Resend)

Apply migration `010_account_email.sql` with `npm run db:migrate` before deploying this version. It preserves existing users and treats their email addresses as verified. Public signups create **member** accounts with no podcast, media, channel, or Website Admin access; publisher/admin CLI workflows remain available.

The sign-in form at `/studio` or `/account` includes registration, forgot password, and resend verification. New users verify their email and choose their password on the activation link before signing in. Signup never activates a password supplied before email ownership is proved. Verification links expire after 24 hours; password reset links after 30 minutes. Links are single-use, store only their SHA-256 hashes, and carry the raw token in the browser URL fragment, which is removed when the page opens. Visiting a link alone does not consume it: the user confirms with a button. A reset revokes all sessions and outstanding reset links; a signed-in password change also revokes reset links. Welcome messages send after verification; the running API retries pending welcome messages every minute using short database leases and backoff. External email/contact requests run outside database transactions. The email provider may deliver a duplicate welcome if the connection or process fails after acceptance but before the database records success.

Account emails use **Resend**. Google Workspace continues hosting the domain’s inboxes; no Google OAuth client, Google password, or app password is needed for this delivery provider.

1. In [Resend → Domains](https://resend.com/domains), add `godlyhomes.com`. Copy the exact sending verification DNS records supplied by Resend into Hostinger, then verify the domain. Keep the existing Google Workspace MX and DKIM records. The return-path MX record supplied by Resend belongs at its specified subdomain (typically `send`), not at the root. Do not enable Resend inbound receiving for the root domain. See [Resend domain setup](https://resend.com/docs/dashboard/domains/introduction).
2. In [Resend → API Keys](https://resend.com/api-keys), create a key with **Sending access**, restricted to the verified domain. See [API key permissions](https://resend.com/docs/dashboard/api-keys/introduction). Store it privately in the ignored local `.env` and separately in Hostinger’s environment settings. Edit individual values in hPanel to preserve unrelated database and Stripe secrets.

```dotenv
MAIL_PROVIDER=resend
MAIL_FROM=hello@godlyhomes.com
RESEND_API_KEY=<sending API key>
REGISTRATION_ENABLED=true
```

3. Run `npm run email:check` to check that configuration is present. This does **not** validate the Resend key or domain and does not send mail. Run `npm run email:test` to send one real message to `MAIL_TEST_TO`, or `ADMIN_EMAIL` when no test recipient is configured. An accepted API response means Resend queued the message; confirm delivery in Resend’s dashboard and the recipient’s inbox or spam folder.
4. Restart/redeploy the API with these environment settings, then test registration, verification, welcome, and password reset on the live website. No additional database migration is needed for the provider switch.

Keep local `APP_URL=http://localhost:5173` during development; use `APP_URL=https://godlyhomes.com` on the hosted app. Never put the API key in a `VITE_` variable, source control, or client-side JavaScript. The Resend transport has a 20-second request timeout, rejects HTTP redirects, and omits provider response details from application logs. It does not automatically retry ambiguous send failures. Welcome retries use a stable per-user idempotency key, which Resend deduplicates for 24 hours; duplicates can still occur after that window. See [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

`resend` is the default provider. Legacy transports remain available explicitly with `MAIL_PROVIDER=gmail` plus `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, or `MAIL_PROVIDER=smtp` plus the SMTP settings. Selecting Resend never falls back to either of them if its API key is absent or rejected. Missing provider credentials disable email flows while preserving existing sign-in. Set `REGISTRATION_ENABLED=false` to close new signups while retaining reset/verification for existing accounts. Request endpoints return the same message for unknown and existing accounts and enforce IP limits plus a database-backed one-minute cooldown per recipient/purpose. Verification/reset email requests are not retried automatically; users can request a new link. Welcome messages are retried by the API. Newsletter membership and campaign composing are available in Website Admin, using Resend for delivery.

Validate on the hosted app with a real new address: register, confirm the verification and welcome messages, verify sign-in and member access, request a reset, and confirm the new password works and old sessions are revoked. Automated integration tests use a fake mail transport and never send real mail. Domain DNS alone does not authorize the app to send.

### Newsletter studio and Resend Contacts

No name is required: the current form keeps email and explicit newsletter consent, followed by email ownership confirmation. Apply migration `011_newsletter_resend.sql` before deploying newsletter sync. New signups are saved locally as pending, emailed a single-use confirmation link valid for 24 hours, and synchronized to Resend Contacts only after confirmation. Names remain optional. Migration `013_security_review.sql` preserves subscribers already on the list as confirmed. Failures retain the consent record and retry through the running API every minute, with exponential delay up to one hour. Existing consented subscribers are backfilled automatically after configuration. Account registration alone never enrolls someone in the newsletter.

Resend now uses global [Contacts](https://resend.com/docs/api-reference/contacts/create-contact) and [Segments](https://resend.com/docs/api-reference/contacts/add-contact-to-segment) for lists. Set these server-only variables locally and in Hostinger:

```dotenv
RESEND_CONTACTS_API_KEY=<separate Resend Full access key>
RESEND_NEWSLETTER_SEGMENT_ID=<optional newsletter segment UUID>
```

The transactional sending-only key cannot manage contacts. Keep it unchanged and use the separate contact-management key above. Without a segment ID, signup sync uses the general Contacts list; sending newsletters requires a segment. Changing the configured segment queues existing subscribers for addition to the new segment and does not remove earlier memberships. Names are optional. Routine sync preserves existing names and unsubscribe preferences. Rejoining requires a fresh single-use mailbox confirmation before explicitly opting the contact back in. Account registration never enrolls someone in the newsletter.

Apply migration `014_newsletter_studio.sql` before starting this version (`npm run build:deploy` runs migrations first). Full administrators can open **Website Admin → Newsletters & members**. Junior administrators retain website copy editing but cannot access newsletter members or send campaigns.

- **Newsletters:** Compose saved drafts in Sage & cream or Navy & gold. Add up to 12 reorderable highlights from the latest 30 public podcast episodes, published Reflexions, store products, site pages, the current announcement, or custom notes with HTTPS links. Drafts capture content snapshots; hidden, private, and removed items are checked again before preview, test, and send. Duplicate a previous newsletter to start another issue.
- **Preview and send:** Save to generate desktop/mobile previews, then send one test email. Saving changes clears the test approval. Before sending, supply the organization mailing address, the administrator’s current password, and `SEND`, then confirm. The app creates a draft through [Resend Broadcasts](https://resend.com/docs/api-reference/broadcasts/create-broadcast), records its ID, and sends it to the configured segment. Each live newsletter includes Resend’s personal unsubscribe link. Configuration changes invalidate prior tests. Concurrent requests cannot send the same draft twice, and uncertain provider results stay locked for review rather than retrying automatically. Use **Check Resend status** and the Resend dashboard to review delivery.
- **Members:** Search/filter local consent records; browse the live GH newsletter segment; edit optional names; refresh remote status; retry confirmed syncs; invite via confirmation email; unsubscribe with password confirmation. Unsubscribing preserves website accounts and transactional emails. Local remote-status fields are a cache refreshed manually or during sync, not a webhook mirror; the Resend segment tab reads the live provider state. Resend remains authoritative for broadcast suppression and delivery.

No new key is needed when the existing contacts key has Full access. Resend marketing approval and account limits may still apply. Automated tests mock all email and marketing operations and never broadcast to real subscribers.

### Users, podcaster approvals, and junior administrators

Apply migration `012_user_management.sql` before deploying this version. Sign in as a full administrator and open **Website Admin → Users & approvals**. Search verified member accounts, review pending podcaster requests, assign Member/Podcaster/Junior admin/Full admin roles, deactivate/reactivate access, sign out all devices, and inspect access history. A person first creates and verifies their own account at `/account`; administrators then assign elevated access. No account passwords are shown or set through user management. Full administrators must confirm role, deactivation/reactivation, and session-revocation changes with their own current password. Reauthentication passwords are never stored in access history.

Members request podcaster access from **My account → Share your voice**, explaining their podcast. A full or junior administrator can approve or decline, with an optional note shown to the applicant. Approval gives podcast creation/channel/publishing access. The person signs in again after a review or role change. Administrators can also assign Podcaster directly to a verified active member. Previously approved publishers retain their access.

| Role | Access |
| --- | --- |
| Member | Own account and podcaster access requests |
| Podcaster | Own podcast drafts, media, channel, and publishing |
| Junior admin | Podcast access, podcaster request reviews, episode hide/restore moderation, page/settings and Reflexion editing |
| Full admin | All of the above, user roles/access, other authors’ episode deletion, store items, Stripe, orders/customer data, and access history |

Junior administrators cannot change user roles, deactivate accounts, revoke other users’ sessions, access store item records/customer/Stripe data, or delete other authors’ episodes. Role changes, reviews, deactivation, and explicit revocation sign out the affected account’s current sessions. Disabled accounts cannot sign in, use old sessions, or redeem reset/verification links; reactivation is required first. Deactivation leaves already-published material under the separate episode visibility controls. Self access changes are blocked; use another full administrator. Account changes serialize against each other, recheck the acting administrator’s role, reject stale versions, and retain at least one active full administrator. Access changes are recorded with actor, target, action and timestamp. No role notifications are emailed automatically.

### Website Admin

**Website Admin → Podcast episodes** lists drafts and published episodes across all authors and channels. Search by title, channel, or author email, and filter public, hidden, or draft episodes. **Hide episode** removes public page/API, RSS, and audio access while retaining the draft and renders; author republishing cannot override this setting. **Restore visibility** exposes an existing publication only when its channel is public, and never publishes a draft. **Delete episode** requires confirmation and permanently removes the draft, publication, and render jobs/exports while preserving original recordings used by other episodes. External podcast apps may retain downloads or cached feed entries. Apply migration `009_episode_visibility.sql` before deploying this version.

Run migrations before upgrading the application. Migration `002_website_admin.sql` adds admin/publisher roles and website content tables. Migration `004_reflexions.sql` converts the public Resource area to Reflexions and saves the earlier internal guides as private drafts so their external links and images can be added in Website Admin. Existing accounts default to podcast publisher access.

To give the configured owner account website editing access, set `ADMIN_EMAIL` to that existing account and run `npm run admin:grant`. This changes only that account's role and preserves its credentials. New accounts created by `npm run admin:create` have the admin role. Admin access is checked from MySQL on every private request; being signed in as a publisher is insufficient.

Sign in at `/studio` and choose **Website Admin**, or open `/admin`. Page/settings forms use **Save and publish**. Each Reflexion has a title, short description, type, image, image description and HTTPS external URL; published links open in a new tab. Reflexion/store drafts are excluded from public APIs and pages. Version checks prevent an old browser tab from overwriting a newer edit. Text is rendered as plain text with line breaks rather than executable HTML.

Images accept PNG, JPEG and WebP up to 5 MB and use persistent media storage. A local admin configured with `MEDIA_REMOTE_URL` forwards uploads to the hosted site using the same authenticated session. Products can use the Stripe integration below or an external HTTPS checkout link. Products without either offer a contact action. Email signup editing changes the form copy, not email delivery configuration.

In **Studio → Arrange & edit**, select a clip to trim its boundaries, split at the playhead, or remove a range from its middle. Source recordings remain intact, and Undo restores an edit. The audio library adds intros first, closings last, and musical transitions after the selected clip. Transitions are separate music clips with adjustable trim, fades, and gain. Render the episode to hear all clips and background music together before publishing.

**Website Admin → Podcast branding** controls the show title, description, cover artwork, and author spotlight (name, biography, portrait, and profile link). Show branding appears on the homepage podcast section and episode pages, and title/description/artwork/author are included in RSS. Apply migration `006_podcast_branding.sql` before opening this settings page on an existing installation. The spotlight is hidden until enabled with an author name and biography.

### Author profiles, channels, and series

Every signed-in publisher or administrator can open **My channel** to set up their author name, biography, portrait, profile link, show title, description, cover artwork, and brand color. Each account owns one channel and its series. Account email addresses remain private. Author permissions do not grant Website Admin access, and author image uploads use the authenticated `/api/channel/images` endpoint.

Make the channel public to publish episodes under that branding. A private channel hides its profile, episodes, media URLs, and RSS feeds from public requests. Existing episodes from accounts without a channel retain their existing publication behavior. Changing a channel or series address changes its public links.

Create series in **My channel**, then assign an episode in **Review & publish → Podcast series**. Series placement is saved in the published episode snapshot, so a draft reassignment becomes public only after rendering and publishing again. Series pages appear after their first published episode; a standalone episode needs no series. Each author can only assign and edit their own series.

Public pages: `/channels` (directory), `/authors/:slug` (author profile), `/channels/:slug` (show), and `/channels/:slug/series/:seriesSlug` (series). Channel RSS uses `/channels/:slug/feed.xml`; series RSS uses `/channels/:slug/series/:seriesSlug/feed.xml`. The original `/podcast/feed.xml` remains the site-wide feed. Migration `007_author_channels.sql` adds the author and series tables and episode/publication series fields; apply it before deploying this version.

In **My channel → Distribution & subscriptions**, authors can set their own Spotify and Apple Podcasts show URLs. Only the current channel's configured provider buttons appear on its channel, author, series, and episode pages. The all-channel homepage and episodes without a channel offer RSS without a provider fallback. Leaving a provider URL blank hides that button. Spotify links must use `https://open.spotify.com/show/…`; Apple links must use `https://podcasts.apple.com/…/podcast/…`.

**RSS ownership email** is optional and intentionally public in the RSS feed. It lets an author receive directory ownership-verification messages at an inbox they control; a blank value uses the site's show contact email. Existing channel records need no migration for these optional distribution fields.

Godly Homes hosts the feed and MP3 files. Authors submit the public channel or series RSS URL to a directory such as Apple Podcasts Connect or Spotify for Creators, complete its verification/review, then paste the resulting show URL into their channel settings. An existing listing should be claimed or its feed updated rather than creating a duplicate. Provider-link fields alone do not submit or syndicate a show. Use public HTTPS URLs, appropriate cover artwork, and at least one published episode. Feed readers and directories retrieve later episode updates from that same feed. A localhost development feed is available only on that computer and is not suitable for public directory submission. On-site distribution already happens through channel/series pages and the channel directory. Listener pages include **Copy RSS URL** and an **Add by URL** explanation for RSS-compatible podcast apps.

The Homepage announcement is displayed across every public page. Use it for a current promotion or update; its text, link label, destination, and visibility are managed in **Website Admin → Homepage**. In **Website Admin → Discount codes**, create percentage or fixed-amount Stripe promotion codes. Stripe Checkout collects the code securely; the server never receives or stores a shopper-entered code. Restricted Stripe keys need read/write access to Coupons and Promotion Codes in addition to the existing Products, Prices, Checkout Sessions, and Shipping Rates permissions.

## Stripe store and orders

Run `npm run db:migrate` to apply additive migration `003_store_orders.sql`. The site uses the official Stripe Node SDK and Stripe-hosted Checkout; card details never pass through this app. Set server-only `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Hostinger's Node.js environment settings, then restart/redeploy. Never expose them with a `VITE_` prefix or commit them. Use sandbox keys and products to verify the flow first; the Stripe plugin connection does not configure the website's runtime keys.

In Stripe Workbench, create a webhook destination for **your account**, using **Snapshot** events, at `https://godlyhomes.com/api/stripe/webhook`. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. Set its signing secret as `STRIPE_WEBHOOK_SECRET`; sandbox and live endpoints have different secrets. Webhook signatures are checked against the raw request body. Duplicate events are handled transactionally; current Stripe session state and payment status determine whether an order is paid. The return page only reads the order's status and never marks it paid.

Open Website Admin → Stripe catalog. Import an active, fixed, one-time price in USD, CAD, EUR, GBP or AUD. Select digital or physical, then review the resulting draft in Store items before publishing. Reimporting a price updates its amount/currency and preserves website descriptions, visibility, and shipping settings. Pricing changes in Stripe require a manual sync; checkout refuses mismatched prices and live/test modes. Recurring, tiered and variable prices are outside this release. Every checkout buys one item with quantity one; there is no multi-item cart or inventory reservation.

For a physical item, enter your allowed two-letter shipping country codes and up to five existing Stripe shipping rate IDs in Store items. Rates must be active fixed amounts in the item's currency and mode. An explicit zero-cost rate enables free shipping; missing settings block checkout. Collected shipping addresses appear only in administrator order views. Enable `STRIPE_AUTOMATIC_TAX=true` only after configuring Stripe Tax. Otherwise automatic tax is off; configure the appropriate tax treatment before accepting live orders. Enable Stripe receipt emails in the Stripe Dashboard as appropriate.

Website Admin → Orders lists pending/paid/failed/expired payments, refund and dispute states, refunded amounts, payment review time, test/live mode, customer contact details, totals, shipping addresses and fulfillment notes. **Sync payment status** retrieves the current Stripe state. Every newly fulfilled order is checked again with Stripe; pending/partial/full refunds and unresolved/lost disputes block fulfillment. If Stripe cannot be checked, the site does not mark the order fulfilled. Orders already fulfilled retain that history when later refunded. Digital delivery and physical shipping remain manual. Product deletion preserves order history. Buyer confirmation links use a random capability and expose only minimal order status, never customer addresses or email.

Apply migration `008_security_and_order_sync.sql` before deploying these protections. The restricted Stripe key additionally needs **read access to Payment Intents, Charges, Refunds, and Disputes**, plus existing Checkout Sessions read access. Keep the original checkout webhook events and add `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, and `charge.dispute.funds_reinstated`. The webhook checks current Stripe state and deduplicates events. Unrelated payments are ignored. Refund/dispute events can recover older orders through their Checkout Session even if a payment-intent ID has not yet been stored.

### Security controls

Remote MySQL connections automatically require TLS with certificate and hostname validation. Use the database's certificate hostname, not its IP address. `DB_SSL_CA_FILE` can specify a trusted CA; insecure remote overrides are rejected. Loopback and Unix-socket connections remain local, with `DB_TLS=required` available for loopback TLS.

Password changes replace the session cookie and CSRF token, revoke all prior sessions, and serialize against concurrent logins. Published audio requires private-cache revalidation on every request, so changing a channel's visibility or unpublishing is checked before a conditional response is issued. Previously downloaded copies cannot be revoked.

Uploads have database-backed concurrency and storage reservations across app instances. Each author can process one audio upload and one image upload at a time; global capacity is two audio imports and four image uploads. Audio imports are limited to 12 per author per hour and images to 30; renders are limited to 20 per hour and three pending/running per author, with a global queue cap of 50. Account storage defaults to 5 GB (`AUTHOR_STORAGE_MB=5120`) and includes source audio, tracked image uploads, completed exports, and reservations. Audio input and processed output are each capped at 512 MB. New image uploads are tracked from this migration onward. Local image forwarding delegates reservations to the hosted endpoint. Limits also apply to administrators.

Validation uses an isolated MySQL database and a simulated Stripe client with real SDK webhook signatures; optional Chrome tests exercise import, publication, checkout redirect, pending-to-paid confirmation and fulfillment. These tests never charge a real card. After configuring the real account, complete a Stripe sandbox checkout, verify a successful webhook delivery and paid order, then configure and verify live mode before publishing live products.

### Sharing a database between local development and Hostinger

A shared MySQL database does not share audio files. If the local studio uses the production database, set `MEDIA_REMOTE_URL=https://godlyhomes.com` **locally only**. Publishing then copies the render and its source files to the hosted app before updating the public episode. Transfers use the current owner's session, verify SHA-256 and byte length, and never overwrite a different existing file. The hosted app must use the same database and have this version of the API deployed.

Set the same `MEDIA_REMOTE_URL` on a separate render worker connected to the shared database. It downloads missing sources from the hosted app and uploads the MP3 before marking a render ready for review. Transfers use the current job's unexpired lease, are restricted to that job's sources/output, and verify checksums and sizes. No administrator password is needed for worker transfers. On managed hosting, keep this separate worker running (`npm run worker`); a worker on a local computer is available only while that computer and process are running.

To restore an already-published local render, configure `ADMIN_EMAIL` and `ADMIN_PASSWORD` locally for the episode owner, then run `npm run media:sync -- --job <render-job-id>`. The command transfers existing files, leaves the publication unchanged, and signs out its temporary session. Remove the administrator password after use. Originals and exports remain private except for the current published MP3 URL.

On Hostinger, relative `MEDIA_DIR` paths are resolved under the domain's `storage/` directory outside `hbuilds/versions/`, so future releases keep using the same media. Absolute paths (including the Docker media volume) are respected. Back up this storage with MySQL. Existing files from earlier release directories need restoration before those releases are removed.

## Verification

```sh
npm test
npm run build
npm run test:pages
npm run test:integration
RUN_BROWSER=1 npm run test:integration
```

The integration script initializes a **new temporary MySQL instance with networking disabled**, creates test users/audio, verifies the API and real FFmpeg output, and removes its data afterward. It never uses `.env` database settings. Set `MYSQLD_PATH` if it is not `/opt/homebrew/bin/mysqld`. MySQL initialization needs an ordinary user with permission to start that binary. Some macOS sandboxes prevent its initialization.

The optional browser pass uses installed Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (override with `CHROME_PATH`) and fake microphone input. It exercises recording/upload/autosave/render/review/publish, reload persistence and mobile overflow, with screenshots in ignored `test-results/`. Build before running it.

`npm run test:pages` uses the same Chrome executable and a temporary production server to check public routes, navigation, page titles, and external Reflexion link/search behavior. Its populated layout audit covers all public route types, every admin section, content editors, the studio workflow, and channel/series editors at 320/390/768/1024/1440 pixels. It checks long-title overflow, 16px phone fields, 44px phone buttons, and navigation on a short landscape screen. It uses isolated API fixtures and does not connect to a database. Run the build first. See [the mobile review](docs/mobile-review-2026-11-11.md) for findings and verification limits.

## Hostinger VPS deployment

This application includes an always-running audio worker and persistent filesystem storage. Use a VPS with Docker Compose; managed Node.js hosting would need a separate worker/storage service. Deployment has not been performed, and the existing site/DNS have not been changed.

1. Inventory and back up the current `godlyhomes.com` website, DNS and mail records. Select a VPS and verify enough memory, CPU and disk for the expected media volume. Start with one worker and measure before scaling.
2. Create a private staging hostname and deploy this checkout to the VPS. Install Docker Engine with Compose. Only SSH, HTTP and HTTPS need public ingress; restrict SSH appropriately.
3. Create a server-only `.env` using `.env.example`. Set strong, distinct `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD`, `DB_NAME=godly_homes`, `DB_USER=godly_homes`, `NODE_ENV=production`, `APP_URL=https://staging.godlyhomes.com`, `SITE_HOST=staging.godlyhomes.com`, and `TRUST_PROXY=1`. `DB_SOCKET` must be unset. The compose file sets the private MySQL host and media/tool paths.
4. Run:

   ```sh
   docker compose build
   docker compose up -d mysql
   docker compose run --rm app npm run db:migrate
   docker compose run --rm app npm run admin:create
   docker compose up -d
   ```

   Provide the administrator email/password through the server environment before account creation and remove the password afterward. Restart/recreate services if it was present during their creation. These commands do not reset existing credentials.

5. Point the staging A/AAAA records at the VPS. Caddy obtains HTTPS certificates automatically when its hostname resolves and ports 80/443 are reachable. Only advertise IPv6 if it is configured. Staging should be restricted to the team before recording real content.
6. Test sign-in, microphone capture, refresh recovery, offline recovery download, long uploads, editing, renders, public playback/seek and RSS. Supply a real square cover at `SHOW_IMAGE_URL` and verify show metadata before podcast directory submission. Submission to Apple/Spotify is separate from hosting an RSS feed.
7. Back up and restore **both** the MySQL and media volumes in a staging drill, preserving their point-in-time relationship. Backups must be encrypted and copied off the VPS. Named volumes survive container recreation; never use `docker compose down -v` on production.
8. For production, use `APP_URL=https://godlyhomes.com`, `SITE_HOST=godlyhomes.com`, and a production database/media set. Deploy the tested release, migrate, confirm origin readiness, then switch only the required web DNS records. Preserve mail records. Keep the previous site backup and DNS values for rollback.

The Dockerfile runs as an unprivileged user; Caddy is the sole exposed app entry point. Uploaded media and MySQL reside in named volumes outside the application image. Compose files are supplied but cannot be executed on a machine without Docker; validate them on the chosen VPS before cutover.

## Operational scope and limits

- Solo audio only, maximum two hours per source/episode and 512 MB per uploaded file. Upload conversion occurs before the asset is returned, so large imports may take time. A VPS avoids managed-host request timeouts.
- During recording, chunks are backed up **on the current device**. They upload as a complete take after Stop. Recovery depends on browser storage availability and is not cross-device. Keep the tab/device awake and stop/download if local storage errors appear. Do not clear browser data until recordings are saved.
- A force-quit can lose the latest chunk or leave an incomplete media container. Recovery attempts to import captured chunks; the download option remains available if decoding fails. Real-device/browser and long-session acceptance tests remain required before production.
- Source playback honors trim points. Fades, gain and music are heard in the completed server render. Whole-episode browser mixing is avoided.
- The worker performs stereo -16 LUFS / -1 dBTP normalization. Lossy encoding may slightly change measured peaks; verify long representative exports and listening quality before a public launch. MP3 only in this MVP; WAV masters are not exposed.
- Media remains on the VPS, with no automatic retention cleanup or quotas per user. Monitor volume free space, worker failures and queue age. Orphaned source assets/old exports are retained to avoid accidental loss; add reviewed retention rules as usage grows.
- No remote guests, video, transcription, scheduled publishing, automatic product fulfillment or bulk email delivery. Publisher/admin account creation and role grants remain administrator CLI operations.
- Publisher accounts own private drafts and sources. Any publisher account can publish its own episodes into the shared Godly Homes feed; only create accounts for trusted publishers.

See `DEPLOYMENT_PLAN.md` for the broader architecture and later phases. No Hostinger purchase, DNS change or deployment is performed by local setup commands.

## Security review (2026-11-11)

Apply `013_security_review.sql` before deploying the review fixes. Account activation now sets the password after mailbox ownership; newsletter signup requires a separate confirmation link before Resend sync. Existing accounts and newsletter subscribers remain active. Audio imports reject playlists and external references, worker sources are forced to canonical FLAC, and restoration uploads use per-account/global transfer reservations. Completed image/audio upload reservations are released before their HTTP success response. Admin access changes require the acting administrator’s current password. External mail/contact operations use short leases instead of holding database connections across network requests.

See [the detailed findings and verification limits](docs/security-review-2026-11-11.md). In particular, the local bundled FFmpeg reports version 6.0 and still needs a maintained, patched runtime replacement; npm audit does not audit native codec binaries. MFA and cross-process rate-limit storage remain follow-up items. The Docker Compose database requires trusted TLS certificates before that deployment path can be considered operational; this review validated the existing Hostinger deployment, not a Docker rollout.

Hostinger should use `build:deploy` as its build script. It runs migrations before the frontend build and publication, so a failed migration blocks a new release. The ordinary `npm run build` remains database-free for local builds and tests.
