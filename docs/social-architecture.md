# Grimoire Social: Architecture & Scope

**Status:** Draft (planning)
**Owner:** Slush97
**Last updated:** 2026-05-15 (rev 2: applied context7-verified corrections)

A small social layer for Grimoire that lets users publish their portable mod profiles, browse what others have published, and like profiles they enjoy. Publishing is opt-in; the rest of Grimoire stays offline-first.

---

## 1. Goals and non-goals

### In scope (v1)

- Authenticated publishing of portable profiles via Steam OpenID
- Public discovery feed sorted by likes, newness, or hero
- One like per user per profile (Steam Workshop model)
- One-click import of any discovered profile through the existing `ImportProfileDialog` pipeline
- User-owned delete; community report button; admin soft-delete
- Strictly free-tier infrastructure ($0/mo at small scale)

### Explicitly out of scope (v1)

- Comments, replies, threads (triples moderation cost; revisit in v2)
- Following users / activity feeds
- Profile remixes or fork tracking
- Direct messaging
- Hosting mod files (we only store profile recipes; mods continue to resolve through GameBanana)
- Multi-game support (Deadlock-only, mirroring the rest of the app)
- Mobile / web client (Electron desktop only)

### Non-functional goals

- Publishing or browsing must never block offline use of the app
- Preserve current privacy posture: no telemetry, no background calls
- Discoverable content gated behind explicit user navigation to a `Discover` tab
- NSFW handling at parity with current GameBanana flow (`hideNsfwPreviews` setting respected)

---

## 2. System overview

```
+-------------------------+        HTTPS         +-------------------------------+
|   Grimoire (Electron)   |  <----------------> |   grimoire-social (Workers)   |
|                         |                      |                               |
|  Discover tab (React)   |                      |   Hono router                 |
|  Publish action         |                      |   - /auth/steam/*             |
|  Existing import flow   |                      |   - /profiles                 |
|  safeStorage session    |                      |   - /profiles/:id/like        |
+------------+------------+                      |   - /profiles/:id/report      |
             |                                   |                               |
             |                                   |   Bindings:                   |
             | OpenID redirect                   |   - DB     (D1, SQLite)       |
             v                                   |   - SESSIONS (KV)             |
   +---------------------+                       |   - PUBLISH_RL, LIKE_RL (RL)  |
   | steamcommunity.com  |                       |   - REPORTS (DO, opt.)        |
   | OpenID 2.0 provider |                       +---------------+---------------+
   +---------------------+                                       |
                                                                 v
                                                   +---------------------------+
                                                   | Cloudflare D1 (SQLite)    |
                                                   |  users / profiles /       |
                                                   |  likes / reports          |
                                                   +---------------------------+
```

**Process boundaries**

- **Renderer (`Discover.tsx`)**: presentation only. Talks to `window.electronAPI.social.*`.
- **Main process (`electron/main/services/social.ts`)**: owns the session token (keychain via `safeStorage`), wraps fetch calls, applies the same rate-limiter pattern as `gamebanana.ts:67`, never exposes the token to the renderer.
- **Workers edge (`grimoire-social`)**: stateless request handling, validates Steam callbacks, reads/writes D1, enforces rate limits.
- **D1 (per-region replicated SQLite)**: source of truth for users, profiles, likes, reports.

---

## 3. Data model (D1)

```sql
-- Steam-authenticated identities. Display name + avatar are cached from Steam
-- at login; we do not refresh on every request.
CREATE TABLE users (
  steam_id        TEXT PRIMARY KEY,        -- 64-bit Steam ID as string
  display_name    TEXT NOT NULL,
  avatar_url      TEXT,
  created_at      INTEGER NOT NULL,        -- unix seconds
  banned_at       INTEGER                  -- soft ban; NULL = active
);

-- Published profiles. The portable profile is stored inline as a gzipped blob
-- (~1 KB); D1 row size limit is comfortable for this.
CREATE TABLE published_profiles (
  id              TEXT PRIMARY KEY,        -- 8-char base32 slug
  owner_steam_id  TEXT NOT NULL REFERENCES users(steam_id),
  title           TEXT NOT NULL,           -- max 80 chars, validated server-side
  description     TEXT,                    -- max 1000 chars
  has_nsfw        INTEGER NOT NULL,        -- derived from blob at publish time
  mod_count       INTEGER NOT NULL,        -- denormalized for list views
  primary_hero    TEXT,                    -- inferred from mod hints, nullable
  profile_blob    BLOB NOT NULL,           -- the gzipped portable profile
  like_count      INTEGER NOT NULL DEFAULT 0,
  is_featured     INTEGER NOT NULL DEFAULT 0,  -- admin-flagged; surfaces in Featured rail
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER                  -- soft delete
);
CREATE INDEX idx_profiles_top  ON published_profiles(like_count DESC, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_profiles_new  ON published_profiles(created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_profiles_hero ON published_profiles(primary_hero, like_count DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_profiles_owner ON published_profiles(owner_steam_id);
CREATE INDEX idx_profiles_featured ON published_profiles(updated_at DESC)
  WHERE is_featured = 1 AND deleted_at IS NULL;

-- One like per (voter, profile). Composite PK enforces it.
CREATE TABLE likes (
  profile_id      TEXT NOT NULL REFERENCES published_profiles(id),
  voter_steam_id  TEXT NOT NULL REFERENCES users(steam_id),
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (profile_id, voter_steam_id)
);

-- Reports queue. Reviewed manually via admin CLI for v1.
CREATE TABLE reports (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id          TEXT NOT NULL,
  reporter_steam_id   TEXT NOT NULL,
  reason              TEXT,                -- short free-text or enum string
  created_at          INTEGER NOT NULL,
  resolved_at         INTEGER,
  resolution          TEXT                 -- 'dismissed' | 'deleted' | 'banned'
);
CREATE INDEX idx_reports_open ON reports(created_at) WHERE resolved_at IS NULL;
```

**Migrations**: managed via `wrangler d1 migrations` (numbered SQL files in `migrations/`). No ad-hoc `wrangler d1 execute` against prod.

**Why blob inline vs. R2**: profiles are ~1 KB gzipped. Storing inline avoids a second round-trip per detail view and stays well under D1's row size budget. R2 only enters the picture if we add user-uploaded preview images later.

**Why denormalized `like_count`**: list views sort by it; recomputing from `COUNT(*)` is a non-starter at scale. Updated atomically inside the same transaction as the like insert/delete.

---

## 4. API surface (v1)

All routes JSON, all responses include `{ error: string }` on failure. Auth via `Authorization: Bearer <session>` issued at login. **All routes are prefixed with `/v1/`.** This is non-negotiable: the client ships in Electron releases that may stay installed for years, so we must never break v1 once published — additive changes only, breaking changes go to `/v2/` alongside.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/auth/steam/begin` | none | Returns Steam OpenID redirect URL |
| `GET` | `/v1/auth/steam/callback` | none | Verifies OpenID assertion, issues session, returns `{ token, user }` |
| `POST` | `/v1/auth/logout` | yes | Invalidates session token |
| `GET` | `/v1/me` | yes | Returns current user + their published profiles |
| `DELETE` | `/v1/me` | yes | Account deletion (see §6.5) |
| `GET` | `/v1/profiles?sort=top\|new\|hero\|featured&hero=&hideNsfw=&page=` | none | Paginated list (20/page) |
| `GET` | `/v1/profiles/:id` | none | Metadata + base64-encoded share code |
| `POST` | `/v1/profiles` | yes | Body: `{ title, description, shareCode }`. Server decodes, validates, stores. **Returns the full created row** (see §8 read-after-write note). |
| `PATCH` | `/v1/profiles/:id` | yes (owner) | Body: `{ title?, description? }`. Edits human-curated fields only; never touches the share blob or derived fields. Returns the full row. See ADR-016. |
| `DELETE` | `/v1/profiles/:id` | yes (owner) | Soft delete |
| `POST` | `/v1/profiles/:id/like` | yes | Idempotent |
| `DELETE` | `/v1/profiles/:id/like` | yes | Idempotent |
| `POST` | `/v1/profiles/:id/report` | yes | Body: `{ reason? }` |

**Validation done server-side at publish**:
- Decode share code with the same parser the client uses (port `parsePortableProfile` to Workers; pure JS, no Node deps)
- Reject if format/version unknown, mod count > 100, blob > 256 KB inflated
- Recompute `has_nsfw`, `mod_count`, `primary_hero` from the blob (don't trust client-supplied values)
- Title/description trimmed, length-capped, stripped of control chars

---

## 5. Identity: Steam OpenID 2.0

Steam still uses OpenID 2.0 (deprecated by Google et al., alive at Steam). No canonical Workers-compatible library exists; verification is hand-rolled in ~80 lines using `fetch`.

**Flow**

1. Client opens an Electron `BrowserWindow` to `GET /auth/steam/begin`. Server returns a 302 to:
   ```
   https://steamcommunity.com/openid/login
     ?openid.ns=http://specs.openid.net/auth/2.0
     &openid.mode=checkid_setup
     &openid.return_to=https://api.grimoire.app/auth/steam/callback
     &openid.realm=https://api.grimoire.app
     &openid.identity=http://specs.openid.net/auth/2.0/identifier_select
     &openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select
   ```
2. User signs in at Steam, gets bounced back to `/auth/steam/callback?openid.*=...`.
3. Worker re-POSTs the exact callback params back to `https://steamcommunity.com/openid/login` with `openid.mode=check_authentication`.
4. Steam responds `is_valid:true` (or `false`). On true, extract the SteamID64 from `openid.claimed_id` (`https://steamcommunity.com/openid/id/<steamid64>`).
5. Fetch profile name + avatar from the Steam Web API (`ISteamUser/GetPlayerSummaries`) using a Steam Web API key. Upsert into `users`.
6. Generate a 256-bit random session token, store `{ token -> steam_id, expires_at }` in KV with 30-day TTL.
7. Return token to the Electron BrowserWindow via a known redirect URL the main process intercepts (e.g. `grimoire://auth/done?token=...`). Main process pulls the token, persists via `safeStorage.encryptStringAsync`, closes the window.

**Session storage on the client**

- Prefer Electron's **async** safeStorage API (`isAsyncEncryptionAvailable()`, async encrypt/decrypt). Non-blocking, supports key rotation, and on Linux supports the **Portal Secret D-Bus interface** for sandboxed installs (Flatpak, Snap) — better behavior than the sync API in those environments. Sync API still works; async is preferred for new code.
- Gate on `safeStorage.isAsyncEncryptionAvailable()` after `app.ready` (on Linux specifically, availability is only knowable after the ready event)
- **Linux gotcha (verified):** *"Linux supports various secret stores like `kwallet` and `gnome-libsecret`, but if no store is available, items are encrypted via a hardcoded plaintext password."* Detect this and either (a) refuse to persist the token and require sign-in each launch, or (b) persist with an explicit warning toast. Recommend (a) for v1.

**Session storage on the server**

- KV namespace `SESSIONS`, key = token, value = `{ steam_id, exp }`, TTL = 30 days
- Logout = delete the KV entry
- KV's eventual consistency is fine here: a logged-out user racing one more authed request before propagation is acceptable

**Steam Web API key**: stored as a Worker secret (`wrangler secret put STEAM_API_KEY`). Free, unlimited for our usage, tied to your domain.

---

## 6. Rate limiting and abuse prevention

Cloudflare ships a first-party Rate Limiting API binding (`env.MY_RL.limit({ key })`) — preferred over hand-rolled KV solutions. **Caveat**: the `simple` config only supports periods of 10 or 60 seconds.

| Action | Limit | Mechanism | Reasoning |
|---|---|---|---|
| Like | 30/min per user | `LIKE_RL` (RL API, period=60, limit=30) | Stops mash-clicking; no consistency requirement |
| Report | 5/day per user | Counter row in D1, checked transactionally | RL API can't express daily windows |
| Publish | 1/10 min per user | Durable Object per Steam ID storing `last_publish_ts` | RL API can't express 10-min windows; KV would race across colos |
| Auth begin | 10/min per IP | `AUTH_RL` (RL API, period=60, limit=10) | Cheap CSRF/scrape defense |

**New-account throttle**: accounts <24h old get publish limit reduced to 1/hour and like limit to 10/min. Mitigates throwaway-account brigading. Implemented as a branch in the publish handler reading `users.created_at`.

**Why not all-KV**: KV is eventually consistent across colos (~60s). A user could race two publishes through different POPs. Durable Objects give strongly-consistent state per key.

**Why not all-DO**: DO has its own pricing and a per-object cost model. For high-frequency low-stakes throttles (likes), the RL API is cheaper and good enough.

---

## 7. Moderation

Solo-dev moderation discipline: **structural friction over manual review**.

**Built-in friction**
- Steam-only login (no anonymous accounts; bans are sticky)
- Publish rate limit is a soft throttle on spam
- Title/description sanitized; no markdown, no links in v1
- NSFW hidden by default; user opt-in via existing setting
- All published content is the user's own profile (i.e. their *taste*); we're not hosting arbitrary uploads

**Reactive tools**
- Report button on every profile (logged in only)
- Admin CLI (`grimoire-social-admin`) over the same Worker via a long-lived admin token:
  - `list-reports` (open queue)
  - `delete-profile <id> --reason=`
  - `ban-user <steam_id> --reason=` (sets `banned_at`, soft-deletes their profiles)
- Banned users can still log in but every write returns 403

**Out of scope for v1**
- Automated content scanning / classifiers
- Community moderators / trust levels
- Appeals workflow (manual via Discord for now)

**Liability framing**: we host metadata + references to GameBanana submissions, not files. Add a one-paragraph TOS at first login: "publishing requires content that complies with GameBanana's TOS; you grant us the right to host the metadata; we may remove anything." Don't overlawyer; this is a small community tool.

### 6.5. Account deletion

`DELETE /v1/me` is a non-negotiable feature, not a nice-to-have. Behavior:

1. Hard-delete the row from `users` (Steam ID is then unrecognized; a re-login creates a fresh user)
2. Hard-delete all of the user's `likes` rows (vote counts on other profiles re-derive correctly via the trigger or an explicit `UPDATE published_profiles SET like_count = like_count - 1 WHERE id IN (...)`)
3. Soft-delete all of their `published_profiles` (sets `deleted_at`, hides from listings; preserves the row so other users' import history stays consistent)
4. Soft-delete their `reports` (sets `resolved_at` with `resolution = 'reporter_deleted'` so the moderation queue doesn't show stale entries)
5. Invalidate all sessions for the Steam ID in KV
6. Return 204; client clears local session and redirects to logged-out state

The asymmetry (hard-delete user, soft-delete profiles) is deliberate: the user's identity is gone, but the published artifacts remain referentially intact for the people who already imported them.

---

## 8. Electron client integration

**New files**

- `electron/main/services/social.ts` — fetch wrapper, rate limiter (mirror `gamebanana.ts:67`), session lifecycle
- `electron/main/services/socialAuth.ts` — opens BrowserWindow for Steam, intercepts redirect, persists token via `safeStorage`
- `electron/main/ipc/social.ts` — IPC handlers (`social:login`, `social:logout`, `social:listProfiles`, `social:publish`, `social:like`, `social:unlike`, `social:report`, `social:me`)
- `electron/preload/index.ts` — expose `window.electronAPI.social.*`
- `src/pages/Discover.tsx` — list/detail UI
- `src/components/social/ProfileCard.tsx` — list item
- `src/components/social/PublishDialog.tsx` — title + description form, picks an existing local profile to publish
- `src/stores/socialStore.ts` — Zustand store for current user + cached lists

**Touched files**

- `src/components/Sidebar.tsx` — add Discover entry between Browse and Profiles
- `src/pages/Profiles.tsx` — add a "Publish" button per profile row (gated on logged-in state)
- `src/components/profiles/ImportProfileDialog.tsx` — allow opening from a Discover detail with the share code prefilled
- `src/types/electron.d.ts` — types for new IPC

**Reuse existing**

- Portable profile parser/builder (already in `electron/main/services/profiles/`)
- `ImportProfileDialog` for the import action — no new download flow
- Rate limiter pattern from `gamebanana.ts`
- `ModThumbnail` for hint thumbnails on profile cards

**No renderer ever sees the session token.** Renderer asks IPC to do an authed action; main process attaches the bearer. Same pattern as our existing API key handling for `deadlock-api`.

### 8.1. Shared types between client and Worker

Two TypeScript codebases sharing a wire format will silently drift. Avoid:

- Define request/response shapes once in a `shared/` folder (or a small `@grimoire/social-types` package)
- Worker validates inbound bodies with **Zod**; export the Zod schemas
- Client `electron/main/services/social.ts` imports the same Zod schemas to type IPC payloads and for runtime validation of responses (defense in depth)
- Bonus: derived TS types from `z.infer<...>` flow into both sides

If a monorepo is overkill, copy-paste with a header comment naming the source of truth, and add a CI check that diffs the two files. But shared package is the right answer.

### 8.2. Read-after-write consistency

D1 is regionally replicated; reads from a non-primary region after a write may not see the write for a brief window. After a user publishes, their next list-fetch could miss their own profile and look broken.

Mitigation:

- `POST /v1/profiles` returns the **full created row** (not just `{ id }`). Client prepends it to its in-memory list immediately
- Don't trigger a refetch of the list right after publishing — trust the optimistic insert
- Refetch on the next natural navigation to Discover

Same pattern applies to like/unlike: server returns the new `like_count`; client updates local state directly rather than refetching.

---

## 9. Cost model

**Free-tier ceilings (Cloudflare, current)**

| Resource | Free limit | Our v1 expected | Headroom |
|---|---|---|---|
| Workers requests | 100K/day | ~10K/day at 1K MAU | 10x |
| Workers CPU | 10ms/req | < 5ms typical | comfortable |
| D1 rows read | 5M/day | ~50K/day at 1K MAU | 100x |
| D1 rows written | 100K/day | ~5K/day at 1K MAU | 20x |
| D1 storage | 5 GB | ~50 MB at 10K profiles | 100x |
| KV reads | 100K/day | ~30K/day at 1K MAU | 3x |
| KV writes | 1K/day | <100/day | 10x |
| Workers Paid (next step) | $5/mo, 10M req/month included; ~$0.30/M after¹ | — | upgrade trigger |

¹ Verify exact pricing at upgrade time; Cloudflare adjusts these.

**Likely first-bottleneck:** D1 writes during a viral moment (single popular profile + brigade of likes). If `like_count` updates start approaching 100K writes/day, move the counter to KV with periodic D1 reconciliation, or upgrade to Workers Paid (50M D1 writes/month included).

**Critical failure mode (verified from Cloudflare D1 docs):** *"Exceeding daily read/write limits on the Free plan will prevent D1 queries from running, returning errors to your client."* This is a **hard cliff, not throttling**. A viral moment doesn't degrade gracefully — publish/like will 5xx until the daily counter resets. Mitigation:

- Alert (manually for now: a daily admin check) at 70K writes/day = 70% of ceiling
- Pre-emptively upgrade to Workers Paid before the doc gets shared in any high-traffic channel
- Show a graceful "Service is busy, try again later" toast on 5xx publish/like rather than a generic error

**Recurring costs**

| Item | Cost | Notes |
|---|---|---|
| Cloudflare Workers + D1 + KV | $0 | Until ~10K MAU |
| Domain (`grimoire.app` or similar) | ~$12/yr | Optional; can use `*.workers.dev` initially |
| Steam Web API key | $0 | Free with a domain attestation |
| Total | **$0-12/yr** | Until upgrade trigger |

---

## 10. Risks and tradeoffs

**Architectural risks**

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Steam OpenID 2.0 deprecated by Steam | Low | High (auth gone) | Abstract `IdentityProvider` interface from day one; Discord OAuth as plan B |
| **D1 write ceiling hit (hard cliff, not throttle)** | Medium | **High (publish/like 5xx until daily reset)** | Alert at 70K writes/day; pre-emptively upgrade to Workers Paid before any high-traffic share; graceful client error toast |
| Cold-start empty Discover feed | High at launch | High (kills engagement loop) | Pre-seed 10-20 hand-built featured profiles; "Be the first to publish" CTA; promote on Discord at launch |
| Linux clients with no libsecret | Medium | Low (re-login each launch) | Detect via async API, surface warning, don't persist token |
| User publishes profile referencing NSFW or copyrighted GB mod | High | Low (we're metadata only) | NSFW flag respected; reports + delete; TOS at signup |
| Spam/brigade from throwaway Steam accounts | Medium | Medium (feed pollution) | New-account throttle; like rate limit; Steam account age filter on top sort |
| Solo-dev moderation backlog | High | Medium (community trust) | Structural friction first; admin CLI; v1 has no comments |
| Cloudflare changes free-tier limits | Low | Medium (cost) | Already well under limits; budget headroom is 10-100x |
| Read-after-write consistency confusion | Medium | Low (UX glitch) | Publish/like return updated row; client uses optimistic update, no refetch |
| Wire-format drift between client and Worker | High over time | Medium (broken installed clients) | Shared Zod schemas package; v1 prefix locked forever |
| GameBanana mod deletion breaks published profiles | Medium ongoing | Low (handled by import flow) | Phase 1.5: weekly revalidation cron; "X of N mods available" badge |

**Tradeoffs we're accepting**

- **Steam-only login** locks out players who don't want Steam tied to publishing. Acceptable: Grimoire is for Deadlock players, who already have Steam.
- **Like-only voting** loses the expressiveness of up/down. Acceptable: less brigading, simpler aggregation, easier to add downvotes later than to remove them.
- **No comments in v1** removes a primary engagement loop. Acceptable: comments triple moderation cost; ship the publish/discover loop first.
- **D1 as source of truth** ties us to Cloudflare. Acceptable: schema is portable SQLite; export path is `wrangler d1 export` if we ever need to move.
- **Hand-rolled OpenID verifier** vs library. Acceptable: ~80 lines, runs on Workers, no Node-only deps.
- **Inline blob storage** vs separate object store. Acceptable at 1 KB profiles; revisit if we add preview images.

**Privacy posture changes**

The app shifts from "zero telemetry" to "explicit social opt-in." Discover tab fetches public listings on visit (analogous to Browse fetching from GameBanana). No background sync; no implicit tracking. Document this in the existing privacy section of README.

---

## 11. Open questions

1. **Domain name?** `grimoire.app` taken? Otherwise `grimoiremods.com` or stick with `grimoire-social.<your>.workers.dev` for v1.
2. **Admin identity?** Hardcoded Steam ID in Worker secrets, or a separate admin token? Recommend the latter — one fewer hot path in the auth code.
3. **Profile editing post-publish?** v1 says no — to edit, delete and re-publish. Easier UX, easier moderation. Confirm acceptable.
4. **Search?** D1 supports FTS5 but it's a real schema change. Defer until profile count makes browse-only painful (~500+).
5. **Hero inference**: where's the canonical hero list? `lockerUtils.ts` has `inferHeroFromTitle` — can we reuse it server-side? (Pure function over strings — yes, but needs porting; goes in the shared types package.)
6. **Soft-delete vs. hard-delete UX**: should owner-deleted profiles still be visible to people who already imported them via direct link? Recommend: 404 the public route, but the share code itself remains importable forever (it's self-contained data).
7. **Like-history preservation on account deletion?** §6.5 says hard-delete the user's likes. Alternative: anonymize (set `voter_steam_id = '__deleted__'`) to preserve historical counts perfectly. Tradeoff: GDPR-clean vs. count stability. Recommend hard-delete for simplicity; like counts re-derive correctly.
8. **Monorepo vs. separate repo for `grimoire-social`?** Separate repo keeps deployment surfaces clean and lets the Worker have its own release cadence. Monorepo simplifies shared types. Recommend separate repo + npm-published shared types package.

---

## 12. Phased roadmap

**Phase 1: MVP (target ~3-4 weeks part-time)**
1. Repo `grimoire-social` with Hono + D1 + Wrangler; shared types package
2. Migrations 0001 (schema above, including `is_featured`)
3. Steam OpenID verifier + `/v1/auth/*` + KV sessions
4. `/v1/profiles` CRUD + validation (port `parsePortableProfile`)
5. `DELETE /v1/me` account deletion path
6. Likes + reports
7. Rate limit bindings + Durable Object for publish window
8. Admin CLI (Node script hitting the API with admin token), including `feature-profile` and `unfeature-profile` commands
9. Electron: `social.ts` service + IPC + preload + Discover tab + Publish dialog
10. Sidebar entry, NSFW gating, login flow with **async** safeStorage
11. TOS modal at first login; account-deletion path in Settings
12. **Pre-seed: hand-build 10-20 featured profiles** before launch so Discover isn't empty on day one
13. Wrangler deploy to `*.workers.dev`; soft-launch to a Discord channel for feedback

**Phase 1.5: Polish (1-2 weeks after launch)**
- Analytics dashboard (admin-only): publishes/day, likes/day, MAU, top reports
- Better empty/error states; offline detection; "service busy" toast on D1 ceiling 5xx
- "Mods I'm missing" hint in profile cards (resolve against local install state)
- Owner-only stats: views per profile
- **GameBanana revalidation cron**: weekly job marks profiles with deleted/archived mods; surfaces "11/12 mods available" badge on cards

**Phase 2: Growth (open-ended)**
- Comments (with the moderation cost we postponed)
- Search (D1 FTS5 or a separate index)
- Follows + activity feed
- Profile collections / curated featured lists
- Discord OAuth as alt identity
- Per-mod aggregated stats (most-published, most-liked)

---

## 13. Glossary

- **Portable profile** — the existing `mp1:...` share code format defined in `docs/profile-spec.md`. Self-contained; references mods by GameBanana ID.
- **Published profile** — a portable profile uploaded to grimoire-social with title + description + owner + likes.
- **Share code** — the base64url(gzip(json)) string with `mp1:` prefix.
- **D1** — Cloudflare's managed SQLite, replicated globally per region.
- **DO** — Durable Object. Cloudflare primitive for strongly-consistent per-key state.
- **RL API** — Cloudflare's first-party Rate Limiting binding.
