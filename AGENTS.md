# Instructions for agents

## Project shape

- This is a dependency-free static browser application. The runtime files are `index.html`, `style.css`, and `app.js`; do not introduce a framework or build step for small changes.
- Keep user-facing text in French and preserve the existing responsive, dark interface.
- `README.txt` is the project guide. Update it when behavior, storage, setup, or known limitations change.

## Data and synchronization invariants

- IndexedDB is the application database. AniList is the only synchronization API; do not reintroduce Jikan without explicit user request.
- Anime records and personal records are separate stores. `mal_id` is the shared identity; never replace it with AniList's own ID or send personal data (watched, favorite, watchlist) to either API.
- A season membership is one record per `(year, season, mal_id)`. Do not key all anime in a season by year and season alone.
- Download and validate every page before replacing that season's local membership. API failure must leave the existing local season and personal records intact.
- Preserve JSON export/import compatibility and increment `DB_VERSION` with a deliberate migration when the IndexedDB schema changes.
- Mark the provider supplying data and scores; AniList and MyAnimeList scores are not interchangeable.
- Validate AniList's returned season and season year before assigning fallback results to a season. Historical query mismatches must not be stored under the requested season.
- Bulk synchronization must be sequential, show progress, allow cancellation, continue after an individual season fails, and preserve that season's prior local membership on failure.
- Preserve the season view's default priority groups (favorite, watched, watchlist) with descending score inside each group; keep alternate sorting and previous/next season navigation working.
- Respect AniList pagination and rate limits. Bulk synchronization must retry transient failures and pace requests. Do not add an unaffiliated proxy or scrape MyAnimeList HTML to work around API outages.

## Validation

- There is no package manager or automated test suite configured.
- After editing JavaScript, run `node --check app.js`.
- When changing UI controls, verify their IDs match the selectors and event handlers in `app.js`.
- For synchronization changes, check both successful pagination and the failure path: old local data must remain usable when remote requests fail.