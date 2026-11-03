# Godly Homes MVP

Solo podcast recording and publishing for **godlyhomes.com**. The original two JSX prototypes remain in the repository for reference; the runnable application is in `src/` and `server/`.

## Included

- Responsive public homepage, real episode audio players, episode pages and `/podcast/feed.xml`.
- About (`/about`), searchable Resources (`/resources`) with six guides, downloadable text worksheets and print layouts, and Store (`/store`) for upcoming digital resources and physical products. Shared desktop/mobile navigation connects the pages. Purchases are not enabled until a catalog and checkout are configured.
- Private studio accounts, scrypt password hashes, database-backed sessions, origin/CSRF checks and per-user ownership.
- MySQL episode drafts with debounced autosave, explicit save, revision conflicts and undo during an editing session.
- Solo microphone capture, input meter, pause/resume, local IndexedDB chunk backups and recovery/download after interruption or upload failure.
- Audio import, source preview/waveform for smaller files, trim/split/reorder, fades, gain and optional looping music with voice ducking.
- Durable background render jobs with leases, heartbeat, interrupted-job recovery, FFmpeg two-pass loudness normalization, MP3 review and explicit publishing.
- Published versions remain unchanged during later draft edits. Unpublishing removes the public player/feed access.
- Newsletter email collection with explicit consent. **Email delivery is not configured**; the UI confirms saved signup only.

The runtime is React/Vite + Express + `mysql2`, using versioned SQL migrations. This keeps the existing React components usable without a framework migration. Audio is converted into lossless FLAC sources on a persistent volume; database rows contain paths/metadata and edit instructions, not audio blobs. A separate worker renders MP3 exports. This is the single-VPS MVP storage implementation; S3/CDN integration is a later deployment option.

## Local development

Requires Node 22.14+, MySQL 8.0+ (tested locally with MySQL 9.6), FFmpeg and ffprobe. Do not expose the database port publicly.

1. `npm ci`
2. Copy `.env.example` to `.env`, create a dedicated local MySQL database and user, and fill in its credentials. The migration runner does not create databases or database users.
3. `npm run db:migrate`
4. Set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters in `.env`, then run `npm run admin:create`. Remove `ADMIN_PASSWORD` afterward. No default credentials or public registration exist.
5. `npm run dev` starts the API on port 3001, the frontend on port 5173, and the audio worker together. Open **http://localhost:5173** so the browser origin matches `APP_URL`.

Local development automatically uses the installed `ffmpeg-static` and `ffprobe-static` binaries. Explicit `FFMPEG_PATH` and `FFPROBE_PATH` executable paths override them. The production image uses OS-installed tools.

For a local production build, `npm run build`, set `APP_URL` to your served origin, then `npm start` and `npm run worker`. Microphone capture needs localhost or HTTPS.

### Sharing a database between local development and Hostinger

A shared MySQL database does not share audio files. If the local studio uses the production database, set `MEDIA_REMOTE_URL=https://godlyhomes.com` **locally only**. Publishing then copies the render and its source files to the hosted app before updating the public episode. Transfers use the current owner's session, verify SHA-256 and byte length, and never overwrite a different existing file. The hosted app must use the same database and have this version of the API deployed.

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

`npm run test:pages` uses the same Chrome executable and a temporary production server to check public routes, navigation, page titles, layouts at 1440/390/320 pixels, resource filters/search, downloads and print styling. It does not connect to a database. Run the build first.

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
- No remote guests, video, transcription, scheduled publishing, ecommerce, full resource CMS, password-reset email or bulk email delivery. Account creation is an administrator CLI operation; a production password-reset/revocation workflow should precede wider team access.
- Studio accounts own private drafts and sources. Any studio account can publish its own episodes into the shared Godly Homes feed; only create accounts for trusted publishers.

See `DEPLOYMENT_PLAN.md` for the broader architecture and later phases. No Hostinger purchase, DNS change or deployment is performed by local setup commands.
