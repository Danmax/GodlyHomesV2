# Mobile review — November 11, 2026

The configured Hostinger database migration runner completed successfully. A separate read confirmed `014_newsletter_studio.sql` in `schema_migrations` and the final `subscribers.resubscribe_pending` column. The migration was already recorded as applied; no additional SQL migration was needed.

## Findings and fixes

- Long unbroken titles overflowed populated podcast, channel, store, checkout, and studio views. Authored content now wraps and grid/flex children can shrink to their available width.
- Form controls inherited 13px label text. Phone fields and resource search now use 16px text to avoid iOS focus zoom.
- Compact buttons were difficult touch targets. Phone buttons now have a minimum 44px height, with 44px icon button widths.
- Studio workflow tabs and segment controls needed room on small phones. Tabs wrap, segment actions move below their name, and editing fields stack.
- The studio's multirow sticky header consumed editing space on phones. It now scrolls with the page at widths up to 600px.
- Public mobile navigation now scrolls within the available viewport so every link remains reachable on short landscape screens.

## Coverage and results

`npm run build` and all 26 unit tests passed. `npm run test:pages` passed, including existing account, user management, and newsletter compose/member interactions.

The expanded browser audit uses populated API fixtures and long unbroken titles at **320, 390, 768, 1024, and 1440px**. It checks viewport overflow, content extending beyond the viewport, phone field text size, and phone button height across:

- Homepage, About, Reflexions, retired Reflexion links, store listing, product details, checkout confirmation, channel directory, channel, series, author, episode, missing product, account login, and studio login.
- Every Website Admin section: users, newsletters, episodes, About, homepage, podcast branding, Reflexions, store items, Stripe catalog, discounts, orders, site settings, Reflexions page, store page, and email signup.
- New Reflexion and store item editors; expanded order details; recording, arranging, and publishing screens; channel settings and new series editor.
- A **667 × 320px** landscape screen where the final mobile navigation link is scrolled into view and followed.

Screenshots are generated under ignored `test-results/` for local inspection.

## Verification limits

The isolated MySQL integration run passed account email, user permissions, newsletter confirmation, newsletter studio, website content, media recovery, rendering, and publication checks. It then stopped at `test/commerce-integration.js:129`, where an orders response did not contain `items`. The full integration suite did not pass; this review does not establish the cause of that commerce failure.

Browser checks use desktop Chrome with resized viewports and API fixtures. Physical iPhone/Android testing, Safari focus/keyboard behavior, real payments, and live content on the deployed release remain outside this verification. The source changes are pushed to GitHub; the push alone does not verify a completed Hostinger deployment.
