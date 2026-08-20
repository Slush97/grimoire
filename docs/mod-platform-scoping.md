# Scoping: a Grimoire-hosted mod platform

**Status:** Scoping draft (no commitment to build)
**Owner:** Slush97
**Last updated:** 2026-08-20
**Related:** [social-architecture.md](./social-architecture.md), [vpk-modinfo-spec.md](./vpk-modinfo-spec.md), [profile-spec.md](./profile-spec.md), [gamebanana_api_reference.md](./gamebanana_api_reference.md)

Users keep asking for a mod platform that is not GameBanana. This document scopes what that
would actually mean: the product decision hiding inside the request, the stack, the money, the
legal exposure, and the governance load. It ends with a recommendation and kill criteria.

Read section 1 before anything else. The technical work is the easy part of this project and the
cheapest line item. What follows is deliberately blunt about the parts that are not.

---

## 1. What "an alternative to GameBanana" actually means

The request collapses three different products into one phrase. They have wildly different costs.

| Product | What it is | Build cost | Ongoing cost | Legal exposure |
|---|---|---|---|---|
| **A. Index** | Our own metadata mirror + search API. Files still live on GameBanana. | Low | ~$5/mo | Near zero |
| **B. Vault** | We host files, but only Grimoire-native artifacts and the uploader's own work. | Medium | $10 to $40/mo | Moderate |
| **C. Platform** | Open uploads, comments, likes, requests, the full community site. | High | $50 to $150/mo | High and permanent |

Almost everyone asking for "an alternative" is describing symptoms that A or B solve:

- GameBanana is slow, ad-heavy, and its file servers fail (we already ship
  `gamebananaFileServers.ts` with probe-and-failover logic because of exactly this)
- Mods get deleted and their profiles break
- The API is undocumented and returns empty bodies (see the warnings at the top of
  `gamebanana_api_reference.md`)
- 1-click installs only work through GameBanana's flow
- NSFW content is in the browse path by default

Only a minority are asking for C, which is the one that costs a solo maintainer their weekends
forever. The strategic mistake available here is building C because people asked for A.

### 1.1 What we would be competing with

GameBanana is not a website, it is a network of ~1,500 Deadlock submissions and the authors who
already have accounts there. Per our own catalog scan: 728 `Mod` + 717 `Sound` + a long tail,
1,579 submissions total. There is also at least one other manager in this space
(`deadlockmods.app`) and community mirrors like AyakaMods. A new host with zero mods is worth
zero to a player, and a new host with mirrored mods that authors did not consent to is worth
negative reputation. Cold start is the top risk in this document, ahead of every cost line.

---

## 2. Goals and non-goals

### In scope for a v1 worth building

- Our own metadata index + search API for Deadlock content, served from our infra
- A `source` concept in the client so Browse can show more than one origin
- Hosting for artifacts Grimoire itself produces: portable profiles, merged VPKs, Forge builds
- Uploads restricted to content the uploader authored or can prove they own
- Verified installability: every hosted file is parsed and structurally validated before publish
- Permanent identity for every hosted file via the existing vpk-modinfo embed
- An openly documented, versioned, additive-only public API

### Explicitly out of scope for v1

- Bulk mirroring of GameBanana submissions without author consent (see §7.3)
- Adult content of any kind (see §7.2, this is a cost decision as much as a policy one)
- Comments, forums, DMs, activity feeds
- Non-Deadlock games
- Monetization: no ads, no paid tiers, no paywalled mods
- A web-based mod browser competing with GameBanana on SEO (defer to phase 3)
- Archiving mods their authors have deleted (the highest-drama feature in modding; §7.3)

### Non-functional goals

- Grimoire stays offline-first. A dead platform must degrade to "GameBanana only", never to a
  broken client.
- No telemetry. Same posture as the rest of the app.
- The platform must be cheap enough that its death is never a billing decision.
- Anything we publish at `/v1/` we support forever. Installed Electron clients live for years.

---

## 3. What we already own

This is the part that makes the project plausible. A meaningful fraction of the work is done.

| Asset | Where | What it buys us |
|---|---|---|
| **vpk-modinfo v1** | `docs/vpk-modinfo-spec.md`, `services/modinfoFormat.ts` | A tool-neutral embedded identity format. Uploads self-describe: title, author, sources, merge lineage, original pre-imprint hash. A hosted file stays identifiable even after re-upload elsewhere. Nobody else in this scene has this. |
| **VPK parser and merger** | `services/vpk.ts`, `services/modMerger.ts`, bundled `vpkmerge` | Server-side structural validation of uploads. We can reject a malformed or suspicious VPK on contents, not on file extension. This is a real safety feature GameBanana does not have. |
| **Catalog mirror + FTS5** | `services/modDatabase.ts`, `services/syncService.ts`, `services/searchService.ts` | The client already knows how to mirror a remote catalog into local SQLite and search it offline. A second source is a source adapter, not a new client. |
| **Install pipeline** | `services/download.ts`, `services/extract.ts`, `services/oneClickInstall.ts`, `services/security.ts` | Downloading, extracting, allowlisting, conflict detection, priority ordering. All source-agnostic once the identity plumbing is generalized. |
| **Hardened browser-to-app bridge** | `services/forgeProtocol.ts`, `services/forgeBridge.ts` | An origin-allowlisted, preflight-forced, size-capped loopback install path already written and unit-tested. A web front-end can drive installs on day one. |
| **Auth + Worker design** | `docs/social-architecture.md` | Steam OpenID verification, KV sessions, D1 schema patterns, rate limiting, account deletion, moderation CLI. Reuse the identity layer wholesale rather than designing it twice. |
| **Moderation surface** | `../grimoire-admin/` | A Cloudflare Access gated dashboard already exists. The report queue has a home. |
| **Domain + site** | `grimoiremods.com`, `../grimoire-site/` | No new domain purchase. A subdomain and an Astro-on-Workers deploy pattern that is already proven. |
| **Profile format** | `docs/profile-spec.md` (`mp1:`) | Self-contained shareable recipes, already portable and already versioned. |

---

## 4. The client-side work is not free (and is the part people forget)

Grimoire currently assumes GameBanana is the world. Measured on this branch: **101 non-test
`.ts`/`.tsx` files reference GameBanana**. Most are incidental (a type import, a URL string), but
the load-bearing subset is real and includes a shipped-database migration.

| File | Change |
|---|---|
| `services/modDatabase.ts` | `mods.id INTEGER PRIMARY KEY` is a GameBanana row id. Becomes a composite `(source, id)`. This is a migration on a database that already exists on every user's disk, plus every FTS5 trigger and index. The single riskiest client change in the project. |
| `services/syncService.ts` | `sync_state` is keyed by section (`Mod`, `Sound`, `Wip`). Becomes keyed by `(source, section)`, with per-source cadence and failure isolation. |
| `services/gamebanana.ts` (1,255 lines) | Splits into a `ModSource` interface plus a GameBanana implementation. The interface is the contract every future source implements. |
| `services/searchService.ts` | Source filter, cross-source dedupe, ranking when the same mod exists in two places. |
| `services/security.ts` | `ALLOWED_DOWNLOAD_DOMAINS` gains our host. Keep it an exact-match allowlist, no suffix matching, same rule as `ALLOWED_FORGE_ORIGINS`. |
| `services/oneClickInstall.ts` | The `grimoire:` payload gains a source discriminator. Must stay backward compatible with every already-published GameBanana 1-click link. |
| `services/metadata.ts`, `services/imprintMods.ts`, `services/vpkIdentity.ts` | Identity records currently carry GameBanana ids. vpk-modinfo already models a source list, so this is mostly plumbing an enum through. |
| `src/types/gamebanana.ts` | A neutral `src/types/modSource.ts` alongside it. Do not rename the GameBanana types; add. |
| Browse / Locker / Profiles UI | Source badges, per-source filters, "this mod is on both" handling. |

Honest estimate: **4 to 6 focused weeks part-time** for the client abstraction alone, before a
single server route exists. The good news is that this work pays for itself even if the platform
is never built: it makes the GameBanana path testable, mockable, and no longer a god-module.

---

## 5. Recommended stack

Cloudflare, matching every other surface we run (`grimoire-site`, `grimoire-admin`, the planned
`grimoire-social`). One account, one CLI, one mental model, one bill.

```
                     Electron client                     Web front (Astro on Workers)
                   (ModSource adapter)                    browse + author dashboard
                            |                                        |
                            +--------------------+-------------------+
                                                 |
                                          HTTPS  |  /v1/*
                                                 v
                          +----------------------------------------------+
                          |        grimoire-vault (Worker, Hono)         |
                          |  /v1/index  /v1/mods  /v1/upload  /v1/report |
                          +---+----------+-----------+----------+--------+
                              |          |           |          |
                              v          v           v          v
                        +---------+ +---------+ +---------+ +-----------+
                        |   D1    | |   KV    | |  Queue  | |    R2     |
                        | metadata| |sessions | | scan +  | | quarantine|
                        | reports | | cache   | | thumbs  | | + public  |
                        +---------+ +---------+ +----+----+ +-----------+
                                                     |
                                                     v
                                        +--------------------------+
                                        | scan worker / container  |
                                        | VPK parse (vpkmerge),    |
                                        | ClamAV, hash + dedupe    |
                                        +--------------------------+
```

**Choices and why**

- **R2 for files.** Zero egress fees is the entire economic argument for this project. See §6.
- **Two buckets, `quarantine` and `public`.** Uploads land in quarantine, only a passing scan
  promotes them. The public bucket is the only one behind a custom domain.
- **Direct-to-R2 uploads** via presigned URLs or multipart, so mod bytes never traverse a Worker
  request body. Avoids Worker body size limits and keeps CPU billing near zero.
- **D1 for metadata.** Portable SQLite, same as the client cache, and `wrangler d1 export` is a
  real exit path. Its free-tier limits are a hard cliff rather than a throttle, which is why §6
  recommends Workers Paid from day one.
- **Queues for the post-upload pipeline**: structural VPK parse, malware scan, thumbnail
  derivation, index rebuild. Keeps the upload response fast and makes each stage retryable.
- **Static index snapshots in R2** rather than paginated API calls for catalog sync. Publish a
  gzipped NDJSON snapshot plus a delta since timestamp `T`, ETag'd and edge-cached. Ten thousand
  clients syncing daily becomes ~300k cheap cached requests per month instead of millions of D1
  reads. This one decision is the difference between a $5 bill and a $200 bill.
- **Turnstile** on web upload and report forms. Free.
- **Thumbnails generated once at upload** into R2, not transformed per request. We already have
  the sharp pipeline pattern in `grimoire-site/scripts/gen-assets.mjs` and `vpkmerge` can decode
  Source 2 textures directly.
- **Steam OpenID for identity**, exactly as specced in `social-architecture.md` §5. Deadlock
  players have Steam accounts, bans stick to a real identity, and it costs nothing.

**Alternatives considered**

| Option | Verdict |
|---|---|
| VPS (Hetzner) + Postgres + MinIO | Cheapest raw compute, but you own patching, backups, uptime, and a global latency problem. A solo maintainer's ops budget is the scarcest resource here. No. |
| AWS S3 + CloudFront | Egress pricing makes a viral week a four-figure invoice. Actively dangerous for a donation-funded hobby project. No. |
| Backblaze B2 + Cloudflare (Bandwidth Alliance) | Genuinely viable and slightly cheaper on storage. Rejected only because it splits the stack across two vendors for a saving of a few dollars a month. Keep as plan B if R2 pricing ever moves. |
| Bunny.net storage + CDN | Cheap and good. Same one-vendor argument against. |
| GitHub Releases as a file host | Free and tempting, but it is a terms-of-service violation waiting to happen for third-party UGC, and there is no takedown tooling. No. |

---

## 6. Cost model

Prices verified 2026-08-20 (sources at the end of this section). Treat them as accurate to within
a revision, not forever.

### 6.1 Unit prices that matter

| Resource | Price | Free allowance |
|---|---|---|
| R2 storage (Standard) | $0.015 / GB-month | 10 GB-month |
| R2 Class A ops (writes, lists) | $4.50 / million | 1M / month |
| R2 Class B ops (reads) | $0.36 / million | 10M / month |
| **R2 egress** | **$0.00** | unlimited |
| Workers Paid | $5 / month | includes 10M requests + 30M CPU-ms |
| Workers requests over included | ~$0.30 / million | |
| D1 rows read | ~$0.001 / million | 25B / month on paid |
| D1 rows written | ~$1.00 / million | 50M / month on paid |
| DMCA agent designation | $6, renew every 3 years | |
| Domain | already owned | |

### 6.2 Storage math

Blended average Deadlock payload: skins and HUDs run 10 to 80 MB, sound mods 1 to 10 MB. Use
**25 MB** as a working average and revise once we have real uploads.

| Scenario | Files | With ~3 versions each | R2 storage cost |
|---|---|---|---|
| Grimoire-native artifacts only (phase 2) | ~500 | ~40 GB | **$0.60 / mo** |
| Full catalog equivalent (~1,500 mods) | 1,500 | ~110 GB | **$1.65 / mo** |
| 4x growth, generous retention | 6,000 | ~450 GB | **$6.75 / mo** |
| Pathological (everything, all history, 2 TB) | | 2,000 GB | **$30 / mo** |

Storage is not the problem. Storage is never the problem.

### 6.3 Egress math (the number that decides the vendor)

Assume 15 mod downloads per active user per month at 25 MB.

| Users | Monthly egress | On R2 | On S3 (~$0.09/GB) | On Bunny (~$0.01/GB) |
|---|---|---|---|---|
| 1,000 | 375 GB | **$0** | ~$34 | ~$4 |
| 10,000 | 3.75 TB | **$0** | ~$330 | ~$37 |
| 50,000 | 18.75 TB | **$0** | ~$1,690 | ~$190 |
| One viral week | 10 TB in 7 days | **$0** | ~$900 | ~$100 |

This is why the recommendation is R2 and not a debate.

### 6.4 Request and database math

Downloads are one Class B op each. 150k downloads per month is 0.15M ops against a 10M free
allowance. Thumbnails are the higher-volume path (roughly 20 per browse page), which is why they
are served through the Cache API from a custom domain: edge hits do not bill.

Catalog sync is the only path that could get expensive, and only if it is designed as paginated
API calls. With the index-snapshot approach in §5 it is a handful of cached GETs per client per
day. D1 then only serves detail views, uploads, and moderation, which is thousands of rows a day,
not millions.

### 6.5 Predicted monthly totals

| Phase | Users | Compute | Storage | Extras | **Total** |
|---|---|---|---|---|---|
| **1: Index only** | any | $5 | ~$0 | $0 | **~$5 / mo** |
| **2: Vault, launch** | ≤1k | $5 | ~$1 | ~$5 scan host | **~$11 / mo** |
| **3: Open uploads, growing** | ~10k | $5 | ~$7 | ~$10 | **~$22 / mo** |
| **3: Popular** | ~50k | ~$10 | ~$30 | ~$20 | **~$60 / mo** |
| **Pathological viral month** | spike | ~$25 | ~$40 | ~$30 | **~$95 / mo** |

Recommendation: **go to Workers Paid ($5/mo) on day one.** Cloudflare's free tier D1 limits are a
hard stop that returns errors rather than throttling, so the failure mode of staying free is that
the platform breaks precisely on the day it gets popular.

### 6.6 One-time and annual costs

| Item | Cost | Notes |
|---|---|---|
| DMCA designated agent registration | $6, every 3 years | Non-optional if we host files. See §7.1. |
| Domain | $0 | Subdomain of `grimoiremods.com`. |
| `abuse@` / `dmca@` mailbox | $0 | Cloudflare Email Routing. |
| Terms of service, DMCA policy, privacy policy | $0 self-drafted | Budget $500 to $2,000 if we want counsel to read them once the thing has traction. |
| Legal entity (LLC or similar) | $50 to $500 + ~$100/yr agent | Deferrable, but see §7.5: right now a takedown notice or a lawsuit lands on a person, not a company. |
| Malware scan host | $0 to $15 / mo | Small VM running ClamAV, or Cloudflare Containers. |

### 6.7 The cost that is not on any invoice

**Moderation labor.** This is the real budget line and it does not scale down.

| Phase | Realistic load |
|---|---|
| Index only | ~0 (we host nothing) |
| Vault, own-work uploads only | 15 to 30 min/day |
| Open uploads at 10k users | 1 to 2 h/day, every day, including the days you are sick or on holiday |
| Open uploads with adult content permitted | Do not. See §7.2. |

At an honest $30/hour of your own time, phase 3 moderation is a $900 to $1,800 per month cost
against a $22 infrastructure bill. Every governance decision below is really an argument about
how to keep that number small.

**Sources:** [R2 pricing](https://developers.cloudflare.com/r2/pricing/) (verified via
[summary](https://egresscost.com/cloudflare/)),
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[US Copyright Office DMCA directory FAQ](https://www.copyright.gov/dmca-directory/faq.html).

---

## 7. Governance

Hosting other people's files is a legal and social commitment, not a feature. This section is the
one to argue with before writing any code.

### 7.1 Legal posture: DMCA safe harbor

The moment we host a user-uploaded file we need the § 512(c) safe harbor, and it is conditional.
The checklist:

1. **Register a designated agent** with the US Copyright Office. $6 per designation, renewed
   every 3 years. Without a registered agent we simply do not have the defense.
2. **Publish the agent's contact** on the site and in the terms.
3. **Notice-and-takedown**: a real form and address, acted on expeditiously. Target: one business
   day.
4. **Counter-notice flow**: uploaders can dispute. Restore in 10 to 14 business days absent a
   court filing.
5. **A repeat-infringer policy that is actually enforced**, with strikes recorded in the database.
   Courts have stripped safe harbor from platforms that had the policy on paper and ignored it.
6. **No red-flag knowledge**: if the mod's own title says it contains ripped assets from another
   game, "nobody filed a notice" will not save us.
7. **No direct financial benefit from infringing activity we control.** This is a concrete reason
   to keep the platform donation-funded and ad-free, and never to run ads against mod pages.

### 7.2 The adult content decision

**Recommendation: v1 hosts no sexual content, at all, as a hard rule.**

This is a cost decision. The UK Online Safety Act's highly effective age assurance duties have
been enforceable against services displaying pornographic content since July 2025, with real
penalties landing in 2026 (Reddit fined £14.47m, MediaLab/Imgur £247,590 for missing age checks).
Several US states have parallel age-verification statutes. Complying means an age-assurance
vendor, an identity data flow to secure, and a regulator relationship, all for a category of
content that is a rounding error in Deadlock modding and a magnet for takedown notices.

Practical rules:
- Sexual content: rejected at upload, no appeal path, remove on discovery.
- Gore, suggestive, and shock content: allowed but flagged, hidden by default, surfaced only
  behind the existing `hideNsfwPreviews` opt-in so client behavior stays consistent.
- Reviewed at upload by the same queue as everything else.

Note the asymmetry this creates: GameBanana will still carry mods we refuse. That is fine and
should be stated plainly rather than hidden. "We are not the everything host" is a coherent
identity.

### 7.3 Author consent: the community landmine

The fastest way to make enemies of every Deadlock mod author at once is to mirror their work
without asking. Rules:

- **No bulk mirroring of GameBanana files.** Metadata indexing is defensible (it is public API
  data, and we already do it client-side). Copying the binaries is not.
- **Claim flow for authors**: an author proves they control a GameBanana profile by placing a
  short token in their profile or submission description, then may mirror their own submissions
  to us with one click. Consent is explicit, revocable, and logged.
- **Deleted-mod archiving is deferred past v1.** The community wants it badly and it is the
  single most reputationally dangerous feature in modding: an author who deletes their work
  usually meant it. If it is ever built, it needs an author opt-out honored permanently, and a
  policy written before the first file is retained rather than after the first angry thread.
- **Takedown by the author is unconditional and immediate.** Their file, their call, no debate,
  no "but people depend on it".

### 7.4 Content policy (the actual rules)

Allowed: Deadlock mods authored by the uploader; work they can demonstrate rights to; Grimoire
profiles; Forge and merge outputs the uploader assembled from mods they may redistribute.

Banned:
- Assets extracted from other commercial games. This is the highest-volume source of legitimate
  DMCA notices in every modding scene and it is cheaply enforceable at review time.
- Sexual content (§7.2).
- Malware, obfuscated payloads, anything that is not a structurally valid VPK or an archive whose
  contents we can enumerate.
- Paid or paywalled mods, resale, or links to gated downloads.
- Reuploads of another author's work without documented permission.
- Content targeting real people, harassment, hate content.

On Valve specifically: Deadlock mods are derivative works built from Valve's assets. Valve
tolerates modding but grants no redistribution license, and GameBanana carries exactly the same
exposure. Our mitigation is posture rather than paperwork: remove on request, never monetize the
content, keep the takedown path one email long, and do not pretend to a license we do not have.

### 7.5 Regulatory obligations beyond the DMCA

- **EU DSA**: as a hosting service we owe a published point of contact, a notice-and-action
  mechanism, and a statement of reasons for every removal. Micro and small enterprises are exempt
  from several of the heavier online-platform duties, but not from these. In engineering terms
  this is a `moderation_actions` append-only table with a reason string, which we want anyway as
  an audit log. Build it on day one and the compliance surface is nearly free.
- **UK OSA**: a UGC service with UK users needs terms, a reporting mechanism, and a written risk
  assessment, with duties scaling by size and risk. The §7.2 ban is what keeps us in the light
  tier.
- **GDPR / UK GDPR**: we hold Steam IDs and, incidentally, IP addresses in logs. That needs a
  privacy policy, a retention limit on logs, and a working account-deletion path. The deletion
  design in `social-architecture.md` §6.5 already covers this and should be reused verbatim.

### 7.6 Moderation operations

Structural friction first, human review as the fallback. Same discipline as the social doc.

**Automated gates at upload** (each one is cheaper than a human):
- Size cap (reuse the 512 MB envelope from `forgeProtocol.ts`)
- Structural VPK parse via `vpkmerge`: real directory, sane entry count, no absurd paths
- Archive contents enumerated and filtered; reject anything with executables inside
- ClamAV pass in the queue consumer
- sha256 against a deny-list of previously removed content, so a removed file cannot be re-uploaded
- Duplicate detection against the vpk-modinfo canonical identity, which survives re-packing

**Trust tiers**, so the queue only sees people who have not earned trust yet:

| Tier | Gained by | Rights |
|---|---|---|
| New | signup | 2 uploads/day, every upload human-reviewed before publish |
| Established | 5 clean uploads + 14 days | auto-publish, spot-checked |
| Verified author | GameBanana profile claim | badge, priority in search, higher limits |
| Moderator | invitation | queue actions, no DB or infra access |
| Admin | it is your project | everything |

**Tooling**: the queue lives in `grimoire-admin` (already Cloudflare Access gated). Every action
writes to `moderation_actions` with actor, target, reason, and timestamp. That table is
simultaneously the audit log, the DSA statement-of-reasons store, and the transparency report
source.

**Service targets**: malware reports acted on immediately, DMCA within one business day, all
other reports within 72 hours. Publish these and then meet them.

**Volunteers**: two or three moderators from the Discord, scoped permissions only, cannot
moderate content they are involved in, decisions reviewable by an admin. Do not recruit
moderators before there is a queue for them to work, and do not run open uploads without them.

**Appeals**: one named path (a Discord ticket or the abuse mailbox), handled by someone other
than the moderator who acted, where numbers allow.

**Transparency**: a quarterly post with uploads, removals broken out by reason, and DMCA notice
counts. It is a `SELECT ... GROUP BY` against the actions table and it buys more community trust
than any feature on the roadmap.

### 7.7 Project governance

- **Bus factor is 1.** The domain, the Cloudflare account, the R2 keys, and the DMCA designation
  all sit with one person. Document a break-glass: credentials sealed with one trusted second
  party, and a written statement of who inherits the domain.
- **Wind-down policy, written before launch**: if the project stops, we publish a final index
  dump, give authors 90 days to retrieve their files, and announce the date. Say this out loud in
  the terms. Every modder has been burned by a host that vanished overnight, and being the host
  that promises not to is a differentiator that costs nothing.
- **Funding**: donations only, published openly once the bill exceeds about $50/month. Never gate
  mods behind payment; that would also weaken the §512 posture (§7.1 item 7).
- **Policy changes** announced 14 days ahead. Content policy is a promise to authors, not a
  config value.
- **Interoperability as strategy**: publish the index API and the vpk-modinfo spec openly, and let
  competing managers consume them. A second manager reading our index is free distribution and
  the strongest possible answer to "this is just a walled garden".

---

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Cold start: nobody uploads** | **High** | **Fatal** | Do not launch open uploads first. Phase 2 hosts artifacts Grimoire already generates, so the shelf is never empty. Seed with your own work and invited authors. |
| Author backlash over mirroring | High if we mirror | Severe (reputation) | §7.3 consent rules, no bulk copying, unconditional author takedown |
| Moderation burnout | High at phase 3 | Fatal (slow death) | Trust tiers, automated gates, volunteer mods before open uploads, kill criteria in §9 |
| DMCA notice against hosted content | Certain eventually | Manageable | Registered agent, one-day SLA, banned-category rules in §7.4 |
| Valve objects to hosting their assets | Low | Severe | Immediate compliance posture, no monetization, no license claims |
| Malware uploaded and installed by users | Medium | Severe (trust, and it is our client doing the installing) | Structural parse + ClamAV + quarantine bucket + hash deny-list |
| Age-assurance regulation lands on us | Low given §7.2 | Severe | Hard ban on sexual content, documented risk assessment |
| Client DB migration corrupts user catalogs | Medium | High | `(source, id)` migration behind a version gate, backup-and-rebuild fallback, ship it in a release of its own |
| Cost spike during a viral moment | Low | Low | R2 zero egress caps the blast radius; Workers Paid avoids the D1 free-tier cliff |
| Solo maintainer stops | Medium over years | Severe | Break-glass credentials, written wind-down policy, exportable D1 + R2 |
| Splitting the ecosystem for no gain | Medium | Medium | Stay complementary to GameBanana, not a replacement; open API; index-first phasing |

---

## 9. Phased plan, with gates

Effort figures are part-time weeks for one experienced developer, and they assume the client
refactor is done by the same person doing the server.

**Phase 0: decide and prepare (~2 weeks)**
1. Choose the name and subdomain, write the terms, content policy, and privacy policy
2. Register the DMCA designated agent ($6)
3. Write the `ModSource` interface and the `(source, id)` migration plan
4. Gate: if the policies in §7 feel like too much to commit to, stop here. That is a legitimate
   and cheap answer.

**Phase 1: index only (~4 to 6 weeks)**
1. `grimoire-vault` Worker with Hono, D1 schema, `/v1/index` snapshots in R2
2. Client `ModSource` abstraction + database migration + source badges in Browse
3. Our own search, our own uptime, files still resolving to GameBanana
4. Cost: ~$5/mo. Legal exposure: near zero. We host no files.
5. Gate: does the client abstraction ship clean and does search feel better than the status quo?

**Phase 2: vault for our own artifacts (~6 to 8 weeks)**
1. Steam auth (port from the social design), upload flow direct to R2, quarantine bucket
2. Queue pipeline: VPK parse, ClamAV, thumbnails, index rebuild
3. Publishing restricted to profiles, Forge builds, and the uploader's own mods
4. Moderation queue in `grimoire-admin`, `moderation_actions` table, report button, DMCA form
5. Cost: ~$11/mo. Exposure: real but bounded by the "your own work only" rule.
6. Gate: 30 days of live uploads with a moderation load under 30 min/day.

**Phase 3: open the doors (open-ended, only if phase 2 earns it)**
1. GameBanana profile claim flow, verified-author badges, trust tiers
2. Public web browse (and only now, SEO)
3. Volunteer moderators onboarded before uploads open, not after
4. Comments and likes last, if ever. They triple moderation cost, which is the expensive line.

**Kill criteria, agreed in advance:** if phase 3 sees fewer than 50 uploads or fewer than 5 active
authors in its first 60 days, freeze uploads, keep the index and the vault, and stop. Deciding
this now is much easier than deciding it while looking at an empty page you spent four months on.

---

## 10. Recommendation

Build phase 1. Commit to phase 2 only after it ships. Treat phase 3 as a separate decision made
with real data, not as the plan.

The reasoning:

- The infrastructure cost of even the ambitious version is roughly one takeaway meal a month.
  Cost is not what should decide this.
- The client-side source abstraction is worth doing on its own merits and is the majority of the
  near-term engineering work.
- We should not try to out-GameBanana GameBanana. They have the network; we have a mod manager
  that parses VPKs, embeds permanent identity, detects conflicts, and merges files. The
  defensible product is "every file here is verified installable, permanently identifiable, ad
  free, and gone the moment its author says so", not "the same mods with our logo".
- The two things that kill projects like this are the empty shelf and the moderation treadmill.
  Phasing index-then-own-work-then-open is specifically designed so the shelf is never empty and
  the treadmill never starts before there is someone to share it.

## 11. Open questions

1. Name and subdomain. `vault.grimoiremods.com`? Something else? It should not sound like a
   GameBanana clone.
2. Does phase 1's metadata index still get built if we later decide against hosting files? (The
   answer should be yes; it is useful alone.)
3. Should `grimoire-vault` and `grimoire-social` be one Worker or two? They share identity, D1,
   and moderation tooling. One service with two route groups is probably right, and the social
   doc's separate-repo recommendation may deserve revisiting.
4. Do we accept archives (zip/7z/rar) at all, or VPK only? VPK-only is dramatically safer and
   slightly worse for authors used to bundling readmes.
5. Who is moderator number two, and are they willing before we open uploads rather than after?
6. Is there an appetite for an entity to hold this, or do we stay a person with a domain?
