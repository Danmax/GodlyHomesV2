# Availability and system optimization review — November 11, 2026

## Availability

Initial live requests to the homepage and `/api/health` returned Hostinger HTTP 503 pages. After the user reported recovery, both returned HTTP 200. Subsequent homepage, About, Studio, and public website API requests also returned 200. Observed request totals varied from roughly 0.2 to 1.1 seconds; these are spot checks from this machine, not production performance percentiles.

A mobile Chrome pass rendered About, Reflexions, Store, and Studio with HTTP 200, no horizontal overflow, and no browser exceptions. The first automated homepage navigation received Hostinger's browser-verification challenge (HTTP 403), while ordinary HTTPS homepage checks returned 200. The challenge was not treated as an application-rendering failure or bypassed.

The connected Hostinger tools did not expose Node.js runtime logs or restart controls. Plugin discovery found no applicable deployment connection. The cause of the transient 503 and the production process configuration remain unverified.

Local frontend, API, and render worker were initially stopped. They were started for this review. The frontend and database-backed API health checks returned 200. The local render worker announced readiness. These local processes depend on the Mac staying awake and are not a replacement for supervised production services.

The configured database had migration `014_newsletter_studio.sql` recorded, no render jobs, and small tables (the largest reported data allocations were 16 KiB). There was no evidence of a large queue or table growth requiring immediate database scaling. No SQL migration was added.

## Changes implemented

| Item | Before | After |
| --- | ---: | ---: |
| Public entry JavaScript | 382.22 KB / 113.94 KB gzip | 249.07 KB / 77.75 KB gzip |
| Studio JavaScript | Included in public entry | 133.86 KB / 37.56 KB gzip, fetched on demand |
| Shared default logo | 882.78 KB PNG, 2172px wide | 60.71 KB WebP, 864px wide |
| Favicon | 825.06 KB PNG, 1263px wide | 6.14 KB PNG, 64px wide |

Public entry JavaScript is about 35% smaller (32% smaller compressed). The combined default logo/favicon payload is about 96% smaller. Original image files remain in source for reference; built pages use the optimized versions. A custom logo configured in Website Admin retains its own image URL and is unaffected by the fallback-logo optimization.

- Studio/admin code loads only when those routes open. Public episode duration formatting now imports a small shared helper, avoiding a dependency on recorder/recovery code.
- Vite's fingerprinted `/assets` files receive `max-age=31536000, immutable`. HTML keeps its ordinary revalidation behavior, and private API responses retain `no-store`.
- The independent public website document and entry queries run in parallel. No content cache was introduced, so admin saves continue to appear on subsequent requests.

The live homepage still referenced the earlier `index-CxudUINn.js` entry when checked; the optimized local build uses `index-BOJlmdnz.js`. The build must be redeployed through Hostinger before the performance changes can be considered live.

## Verification

- Production build passed.
- All 29 unit tests passed.
- Complete isolated MySQL/backend integration suite passed.
- Full page suite passed, including desktop/mobile layouts, studio workflow, and newsletter/account/admin interactions.
- Additional browser/network checks verify that public pages do not fetch the Studio chunk, administration fetches it on demand, fingerprinted assets receive immutable caching, HTML is not immutable, and unauthorized private API responses remain uncached.
- Optimized logo inspected visually.

## Priorities remaining

1. **Investigate recurring 503s with Hostinger runtime logs.** Confirm the startup command, current Node version, deployment results, memory/CPU limits, and process restarts. Add an external `/api/health` uptime monitor and alerts. This review confirmed recovery but did not identify the incident's cause.
2. **Run a supervised render worker continuously.** Use an appropriate persistent host/process manager for `npm run worker`, with worker/job failure alerts. Managed web hosting alone does not establish that a separate worker is running. A worker on this Mac stops being available when the machine sleeps or its process ends.
3. **Monitor native audio resources.** Imports, silence analysis, and multi-pass rendering consume CPU and memory. Keep the existing concurrency/storage limits, use a maintained FFmpeg runtime, and measure representative long recordings before increasing concurrency.
4. **Add production telemetry before scaling the database.** Collect request/error rates, response-time percentiles, database wait times, disk usage, render queue age, and worker failures. The observed database size does not justify speculative index or cache changes.
5. **Optimize uploaded media separately when needed.** Large custom logos and resource/product images can bypass the optimized shared assets. Consider generating sized image variants while preserving originals, based on actual live image transfer measurements.
