# Platform Plan: "Describe a game, AI builds it, friends play it"

Working name: **Forge** (placeholder). Ad-free. Revenue comes from creators (subscription + credits + asset packs), never from players or ads.

> Status: planning draft. Numbers marked *(assumption)* must be measured in Phase 0 before any pricing is final.
> Store-policy points below are from memory of current Apple/Google rules; verify against the live guidelines before building.

---

## 1. The core decision: where does the AI build happen?

**Server-side builds, delivered to a thin app.** Not "all in the app".

| | AI inside the app | AI on a server, result delivered to app (recommended) |
|---|---|---|
| API keys / cost control | Keys exposed or proxied anyway; no real credit enforcement | Server holds keys, meters every call, enforces credits |
| Quality | Phone can't run playtest bots, balance sims, retries cheaply | Server runs headless playtests + auto-fix loops before delivery |
| Store policy | App downloads/executes AI code = risk | App only downloads *data* for a fixed, reviewed engine |
| Updates | Every engine change needs a store release | Engine upgrades ship in app releases; games update independently |
| Offline play | Same | Same (finished games are cached locally) |

The app is: a **player** (runs games), a **creator UI** (chat + visual editor), a **store/library** (browse, share, asset packs), and **billing**.
The server is: job queue, AI agents, auto-QA, asset storage, accounts, moderation, credits ledger.

## 2. What a "game" actually is (this is the key to low cost + store approval)

**A game is a small data bundle that runs on a pre-built engine, not an app and not a repo.**

```
game bundle (typically 20-300 KB + referenced asset pack IDs)
  game.json       -> genre, rules, entities, waves/levels, economy, UI text
  scripts/*.js    -> optional small sandboxed hooks (tier 2, see below)
  manifest        -> genre engine version, asset packs used, age rating, author
```

Our Bastion TD already works this way: `data.js` (towers/enemies/waves/economy) + `engine.js` (rules) + a headless balance simulator. The platform generalises that.

Three creation tiers, cheapest first:

1. **Spec edits (default).** AI edits `game.json` on a genre engine ("make enemies faster, add an ice tower, 60 waves"). Cheap, safe, deterministic, easy to diff and undo.
2. **Sandboxed script hooks.** AI writes small functions (`onEnemyDeath`, custom tower behavior) in a restricted API: no network, no storage, CPU/time limits, run in a locked-down WebView/worker.
3. **New genre engine.** Built by *us* (humans + AI), reviewed, shipped in the app. Not user-generated code.

Why this matters: Apple's rules restrict downloaded executable code that changes app features, but allow interpreted content inside WebKit/JavaScriptCore for mini-games/UGC if you follow the UGC rules (moderation, reporting, age rating, IAP for digital goods). A fixed engine playing data/sandboxed scripts is the most defensible shape. (Verify guideline sections 2.5.2 and 4.7 and Google Play's UGC + AI-generated-content policies.)

## 3. Genres: start narrow

AI quality and balance depend on engine depth. Start with 2 genre engines, not 20:

1. **Tower defense** (done in this repo). Add: multiple maps/path types, tower/enemy editors, wave editor.
2. **Auto-runner / rhythm platformer** (Geometry Dash-style). Deterministic physics, tile/obstacle level format, built-in level editor; AI can generate levels synced to a song's beats.

Later candidates: arena/survivor, puzzle, idle/clicker. Each = one new engine + one template + one auto-QA bot.

## 4. The differentiator: auto-QA before delivery

Our balance simulator is the moat. Every genre ships with:

- **Validator**: schema checks, reachable-win check, no soft-locks (e.g. TD path can't be blocked).
- **Bot playtests**: headless bots play the generated game; report win-rate, difficulty curve, dominant strategies, impossible levels.
- **Auto-fix loop**: AI reads the report and adjusts numbers, capped at N attempts (budgeted).
- **Creator-visible report**: "Normal difficulty: bot clears 38/40 waves. Storm tower is 40% stronger than average. [Auto-balance]".

This turns "AI slop" into "AI games that are actually playable", and it's what the creator pays credits for.

## 5. Architecture and hosting (cheap by design)

Games are tiny static files, so hosting is nearly free. **AI tokens are the real cost.**

| Piece | Choice | Why |
|---|---|---|
| Game/asset files | Cloudflare R2 + CDN (no egress fees) | Static bundles, cache-forever by content hash |
| API / auth / ledger | Cloudflare Workers + D1, or Supabase | Generous free tiers, scales per use |
| AI job runner | Queue + stateless workers calling model API; headless Node for playtests | Pay only when jobs run; our sim already runs in Node in <1 s |
| App shell | Web stack (Canvas games) wrapped with Capacitor, or React Native + WebView | One codebase for iOS/Android; games are web anyway |
| Purchases | RevenueCat over StoreKit/Play Billing | Handles receipts, subscriptions, restore, entitlements |
| Sharing | Deep links `forge.app/g/<id>` open in app, web player fallback | Friends can try before installing |

Rough fixed costs at launch *(assumption)*: Apple $99/yr, Google $25 once, domain, and near-zero hosting until real traffic. Everything else is variable and tied to credit spend.

Player-side cost per play is ~a 100 KB download, so **players are cheap to serve for free**. That is what makes "no ads, free to play" viable.

## 6. Credits and pricing

### 6.1 The markup problem (important)
A flat 30% markup on tokens **loses money after store fees**:

- Apple/Google take **30%** of in-app purchases (**15%** under small-business / first-$1M and subscription year-2 programs).
- Cost-plus-30% price = 1.30x cost. After a 30% store cut you keep 0.91x cost, a loss before hosting, moderation, failed/retried jobs, payment support.
- Even at 15% store fee you keep 1.105x cost: ~10% gross margin, before everything else.

**Recommendation:** think margin, not markup. Target ~**2.5x-3.5x token cost** *(assumption)* so that after store fees (15-30%), retries/failed jobs (~10-20%), hosting, moderation, and support you still have healthy margin. Creators don't see tokens at all, they see **credits per action**:

- `1 credit` = fixed dollar value (e.g. ~$0.01), never tied to a specific model.
- Show a **quote before running**: "New tower defense game ~ 120 credits. Balance pass ~ 25 credits. Edit ~ 3-10 credits."
- Hard per-job budget cap; if exceeded the job stops and keeps partial work. Failed jobs below a threshold are refunded (we eat that cost, plan for it).
- Prices per action are re-tuned as model prices change; users never see churn.

### 6.2 Plans *(all numbers placeholders)*
| Plan | Price/mo | Monthly credits | Notes |
|---|---|---|---|
| Free | $0 | ~30 one-time on signup + small weekly trickle | Enough to build and share one small edit-able game; play everything free |
| Builder | ~$6.99 | ~700 | Entry tier |
| Pro | ~$14.99 | ~1,700 (~15% bonus) | Priority queue, higher job caps, private games |
| Studio | ~$29.99 | ~3,800 (~25% bonus) | Team sharing, bigger games, early genres |
| Top-ups | $2.99-$49.99 | one-time packs, small volume discount | Credits bought never expire; subscription credits expire after ~1 month rollover cap |

Rules that protect margin: subscription credits roll over max 1 month; spend order = expiring first; per-day job limits stop abuse; free-tier needs verified account (anti-farm).

### 6.3 Asset packs
- Sold as **non-consumable IAP** (one-time), themed: fantasy, sci-fi, cartoon, pixel, neon-rhythm, etc.: sprites, tiles, UI, SFX, music, enemy/tower/obstacle sets.
- **Big win for AI:** a pack ships with a machine-readable catalog (names, sizes, tags, anchor points, animation frames). The agent *picks and places* assets instead of generating art, which is cheaper, more consistent, and avoids copyright issues.
- Licensing: pack owner = creator. Games that use a pack embed the right to *play* with it, so **players never need to buy packs**, only creators who build with them. Remixing a friend's game with a pack you don't own is blocked or prompts purchase.
- Start with 2-3 packs we make ourselves (original art or properly licensed, no Blizzard/Warcraft or other IP). Later: third-party artists with revenue share.
- Include a free **starter pack** so Free users can build immediately.

## 7. No-ads principle, how it stays true
- Zero ad SDKs, ever; also minimal analytics (first-party, privacy-friendly).
- Players free, no energy timers, no pay-to-win. Money only from creation tools.
- Say it in the store listing: that's a feature.
- Risk to manage: without ads, every cost must be covered by creators. Hence the strict credit economics above and cheap player serving.

## 8. Creator experience (the Geometry Dash feel)
1. **Describe**: "A tower defense where enemies are stealing cookies, cartoon theme."
2. **Pick genre + asset pack** (AI suggests).
3. **Quote**, then build (60-120 s). Preview playable on phone immediately.
4. **Iterate**: chat ("harder boss at wave 10"), or tap-edit visually (move towers, edit numbers, paint level). Versions with undo/branch.
5. **Auto-balance** button runs bot playtest + fix.
6. **Publish** to profile; share link; friends play instantly.
7. **Remix** friends' games (credit to original author, optional).

Visual/manual editing is deliberately free of credits: it's how it stays fun and keeps costs down.

## 9. Community and safety (not optional on app stores)
- Required by Apple/Google for UGC: in-app **report**, **block**, content filtering, takedown process, age rating, published contact.
- AI moderation on prompts and generated text/art references; human review queue for reports; rate limits.
- Sandbox everything: game code can't read other games' data, the app's storage, or the network. Strict CSP, resource limits, kill switches per game/engine version.
- Prompt-injection/abuse: games are untrusted inputs; agents never get shell/network access to our infrastructure.
- Kids: decide early (13+ only recommended; COPPA/GDPR-K burden is large).
- IP: block prompts reproducing trademarked games/characters (Warcraft, Mario, etc.).
- Discovery without ads: charts by plays/likes/completion, featured picks, creator follows. No pay-to-promote.

## 10. Roadmap

**Phase 0: Prove the loop (4-6 weeks, web only)**
- Turn Bastion TD into genre template v1 with a formal `game.json` schema + validator.
- Prompt-to-game pipeline: user prompt -> spec -> validate -> bot playtest -> auto-fix -> publish static bundle.
- Measure real token cost per action; set the credit table from data.
- Test with ~20 people. Success: >60% of first attempts are playable without manual fixing; avg cost/game known.

**Phase 1: Iteration + visual editor**
- Version history, chat edits, tap-to-edit tower/wave/economy, auto-balance, share links + web player.

**Phase 2: Mobile apps + billing**
- Capacitor/React Native shells, accounts, credits ledger, RevenueCat, subscription + top-ups, moderation/report flows, store submissions (TestFlight/Play closed testing first).

**Phase 3: Second genre + community**
- Runner/rhythm engine + level editor; profiles, follows, charts, remix, comments (moderated).

**Phase 4: Asset marketplace**
- 3-5 first-party packs, then third-party artist submissions with revenue share; creator earnings program (maybe later).

## 11. Biggest risks and open questions
1. **Unit economics:** token cost per game is unmeasured; 30% markup doesn't survive store fees (see 6.1). Mitigate with model routing (cheap model for edits, strong for new), prompt caching, spec-diff edits, hard caps.
2. **Quality ceiling:** AI games get repetitive; value comes from engine depth + great templates + auto-QA. Don't launch with 10 shallow genres.
3. **Store review:** UGC + AI + subscription + IAP is a heavy review category. Build moderation first; keep the "fixed engine + data" architecture.
4. **Cold start:** an empty community is dead. Seed with first-party games, invite creators, challenge weeks.
5. **Creator retention:** subscription churn when they finish their game. Fix with remix culture, seasonal themes/packs, new genres.
6. **Platform dependence:** model-provider price changes/outages; abstract the provider and keep prompts portable.
7. **Legal:** terms for UGC and AI output ownership, DMCA process, privacy policy, tax/VAT on credits (stores handle most of it).

## 12. Decisions needed from you
1. Confirm shape: games = data bundles on fixed genre engines (not code/apps).
2. Which second genre first: runner/rhythm or something else?
3. Free tier generosity vs runway.
4. Kids policy (13+?).
5. Budget/timeline and whether you're building solo or with help.
6. Platform name and brand.

Suggested next step: **Phase 0 in this repo.** Extract the schema from `src/data.js`, add the validator + bot loop as the first "agent pipeline", and measure token cost on 10 generated variants.
