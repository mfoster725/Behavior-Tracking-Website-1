# Cuts/Adds Improvement Backlog (working doc)

This is a living document, separate from the fixed project instructions. Its job is to
track scoped, individually actionable items for the Cuts/Adds feature — both fixes for
"the suggestions are bad" and enhancements/new capabilities the feature doesn't have yet.
Each item should be small enough to become a single agent prompt later. An entry doesn't
need a bad-suggestion symptom to be valid — a feature request with a clear proposed
behavior is just as legitimate an entry as a bug.

## How an entry becomes a prompt
Don't draft a fix prompt until an entry reaches **Fix scoped**. A prompt built from an
entry should include:
- Which file/function, with the current (verified, not assumed) behavior and line anchor
- The specific defect, described as one term/behavior on one side (Cuts or Adds)
- The desired behavior change — one term at a time
- Explicit "do not touch" list: other terms, the other side, and any relevant items from
  the known-quirks/intentional-design list
- A verification step: how to confirm the fix actually worked (e.g. "recompute score for
  test deck X, confirm curve bonus now factors in commander CMC")

## Entry template
```
### [ID] Short title
- Status: Symptom noted / Needs investigation / Root cause confirmed / Fix scoped / Prompt drafted / Shipped
- Side: Cuts / Adds / Both
- Symptom: what bad or incorrect suggestion behavior was observed (ideally a concrete example deck/card)
- Suspected cause: hypothesis + file/line anchor if known — unverified until checked against actual code
- Confirmed cause: (filled in once investigated)
- Proposed fix: concrete, scoped to one term/formula piece
- Constraints: anything from known quirks / intentional design this fix must respect
- Open questions: anything to resolve with the user before drafting the fix prompt
```

---

## Backlog

### 1. Adds curve calc excludes commander CMC
- Status: **Fix scoped** (per project instructions — do not draft/execute prompt until user says start)
- Side: Adds
- Symptom: Adds curve-gap bonus doesn't reflect the same curve Cuts sees, since Cuts includes
  commander CMC in curve buckets and Adds doesn't (decks.js:6460-6473 vs 6274)
- Confirmed cause: yes, per spec — verify still true at current line numbers before executing
- Proposed fix: include commander CMC bucket in Adds' curve calc, matching Cuts
- Constraints: only touch the curve-bucket construction in `_computeAddContext`; don't touch
  Cuts' curve logic, don't touch other Adds scoring terms
- Open questions: none — ready to become a prompt whenever user says go

### 2. Plan-count token exclusion asymmetry
- Status: Needs investigation
- Side: Both (asymmetry between them)
- Symptom: none observed yet directly — flagged from spec, not from a concrete bad suggestion
- Suspected cause: Cuts' candidate pool excludes tokens; Adds' Plan-count filter doesn't (decks.js:6294 vs 6462)
- Confirmed cause: not yet — need to check whether this is actually causing visible bad
  suggestions before treating it as worth fixing
- Proposed fix: TBD, pending investigation and a decision on which behavior is "correct"
- Constraints: unclear whether this is intentional; do not assume it's a bug
- Open questions: does the user have a deck where token count is high enough that this
  would visibly change Plan-count math? Need a concrete case to justify prioritizing this.

### 3. `_deckSwapsEnabled(deck)` signature mismatch
- Status: Flag only — not currently scheduled as a fix
- Side: Both
- Symptom: none — no bad suggestion traced to this yet
- Suspected cause: function ignores its `deck` arg, toggle is user-wide not per-deck
- Confirmed cause: n/a
- Proposed fix: none planned; just needs to be known before any future planning-mode work
- Constraints: don't touch unless explicitly asked to make planning mode per-deck
- Open questions: none right now

### 4. Adds sends `tribes: []` to server
- Status: **Not a candidate for fixing** — intentional, partner's decision
- Side: Adds
- Symptom: n/a
- Constraints: do not draft a fix prompt for this without discussing with user first
- Open questions: none

### 5. Plan-only-deficit decks never fetch unowned cards
- Status: Needs investigation
- Side: Adds
- Symptom: likely explains "no suggestions" / "same suggestions forever" complaints —
  need a concrete example deck to confirm
- Suspected cause: unowned fetch requires a non-Plan deficit (decks.js:6679)
- Confirmed cause: not yet
- Proposed fix: TBD — possible options are (a) allow unowned fetch on Plan-only deficits too,
  or (b) leave as-is and just message the "no suggestions" state better. Needs a decision, not
  just a fix, once confirmed.
- Open questions: which of the two directions above does the user want, once confirmed?

### 6. Owned/All Cards toggle for Adds
- Status: **Fix scoped** (Owned mode only — "All Cards" mode has an unresolved data-source
  question, see Open questions; prompt drafted phases the work accordingly)
- Side: Adds
- Symptom: n/a — feature request, not a bad-suggestion bug. User wants a toggle on the
  Adds panel between "Owned" (only cards the user owns) and "All Cards" (all cards legal
  for the format and commander, regardless of ownership).
- Suspected cause: n/a
- Confirmed cause: n/a
- Proposed fix: Add a UI toggle for the Adds panel with two modes:
  - **Owned**: candidate pool is the user's owned collection only — no server backfill call
    at all, regardless of deficit state.
  - **All Cards**: candidate pool is every format/commander-legal card in existence,
    independent of ownership. Exact data source TBD (see Open questions).
- Constraints: Adds-only, do not touch Cuts. Do not touch quirk #4 (`tribes: []`,
  intentional, partner's decision — leave that param behavior alone in both modes unless
  separately discussed). Do not touch the `CK_REQUIRED_ENABLERS` hard gate (quirk from
  spec, 15 qty-weighted enablers). Preserve existing top-8/owned-first sort and scoring
  logic within whichever mode is active — this is a candidate-pool change, not a scoring
  change.
- Open questions: Does "All Cards" mode need to reach beyond the local database (i.e.,
  live Scryfall lookups), which would expand the documented "never live Scryfall" rule
  for the Adds backfill endpoint? Unresolved — user flagged this explicitly as unknown.
  Needs investigation into current local DB coverage before "All Cards" mode is built out.

### 7. Incorporate EDHREC rank into Cuts/Adds scoring
- Status: Needs investigation
- Side: Both
- Symptom: n/a — feature request. User wants a card's EDHREC popularity to factor into
  Cuts/Adds scoring, on the theory that overall play rate is a signal of how good a card is.
- Suspected cause: n/a — this is a proposed enhancement, not a bug.
- Confirmed cause: n/a
- Proposed fix: Add a new additive scoring term, E (EDHREC rank bonus), to the Adds
  formula: Score = (D × M) + C + E + V + T + K. **Weight-ordering decided by user:** E is
  weighted below D, M, and C/L (see entry 11), but above V, T, and K. **Normalization approach decided by
  user:** E is derived from a normalized percentile of `edhrec_rank` within a filtered
  population (not raw rank), per the original proposal below — precomputed and cached
  server-side (matching the existing "never live Scryfall" pattern), not looked up live.
  Data source is Scryfall's `edhrec_rank` field — an integer present directly on the
  normal card object (no bulk-data ingestion needed), confirmed live: starts at 1 and
  increases as popularity decreases, excludes basic lands, nullable for unranked cards.
  Sample confirmed values pulled directly from the Scryfall API (2026-07-10): Three
  Visits = 42, Explosive Vegetation = 1194.
- Constraints: `edhrec_rank` is a single global popularity number — not scoped to color
  identity, archetype, or role. Using it raw risks distorting comparisons (e.g. a great
  mono-color card can look worse next to a broadly-played multicolor staple purely because
  of the size of each card's eligible pool). Normalizing (e.g. percentile within a
  color-identity/role-filtered population) doesn't change relative ordering between two
  candidates that already share a pool, but it is needed to blend rank onto a comparable
  scale with the other additive scoring terms (curve-gap bonus, versatility bonus, etc.).
  **EDHREC per-category endpoints are off the table** — TOS violation; do not use
  `json.edhrec.com` category/theme APIs or scrape edhrec.com category pages. Entry 8
  remains closed on that basis.
  **E vs V interaction — decided (design guardrail, not yet implemented).** Versatility
  (V) rewards role-tag breadth ("this card fills multiple jobs"). E rewards popularity
  within the active role context. These address different questions and should not fight
  each other. All #8 "good enough" mitigations (per-tag percentiles, multi-tag dampening)
  apply **only inside E** — do not copy Cuts' subtractive multi-role discount onto the
  Adds total score, or versatile cards get rewarded by V and penalized globally for the
  same trait. When a candidate fills multiple active deficits, compute E once (do not sum
  per-tag E bonuses) — e.g. use the percentile for the largest active deficit, or the
  best matching role being filled; TBD at implementation time.
  **Worked example — Three Visits vs Growth Spiral under E (design reference, not
  verified scores).** Canonical test case for entries 7, 9, and 10. Scenario: Simic
  (GU) Commander deck with **both Ramp and Card Draw deficits active**; ramp is the
  larger gap. User intent: Three Visits should rank above Growth Spiral when ramp is the
  larger deficit (see entry 10).
  | | Three Visits | Growth Spiral |
  |--|--|--|
  | Mana cost | `{1}{G}` (1 colored pip) | `{G}{U}` (2 colored pips) |
  | Role tags | Ramp (single utility tag) | Ramp + Card Draw |
  | `edhrec_rank` (2026-07-10) | **42** (elite — 42nd most-played in Commander) | TBD
  at implementation — also a staple; likely top few hundred, not top 50 |
  **Step 1 — raw rank → per-tag percentile (precomputed, not live):**
  - Three Visits `ramp_percentile`: rank 42 among all ramp-tagged cards with a rank →
    likely **~97–99th percentile** (exact value depends on ramp pool size and how many
    ramp cards rank above 42; illustrative, not a committed number).
  - Growth Spiral `ramp_percentile`: strong global rank among ramp-tagged cards → likely
    **~92–97th percentile** — high, but below Three Visits.
  - Growth Spiral `card_draw_percentile`: also high, but **not summed into E** when ramp
    is the E context (see Step 2).
  - **Price distortion check:** Three Visits at rank 42 is already elite despite USD
    cost — E does **not** underrate Three Visits in this pair. Price-aware E adjustment
    (decided — see Open questions) matters for expensive cards with middling ranks, not here.
  **Step 2 — E at scoring time (one E per candidate, ramp context):**
  - Active deficits include ramp → E uses **ramp_percentile** (largest deficit = ramp).
  - Three Visits: top-tier ramp percentile, **no multi-tag dampening** (single role).
  - Growth Spiral: slightly lower ramp percentile, **plus multi-tag dampening inside E**
    (Ramp + Card Draw).
  - **E favors Three Visits** — modest additive edge, consistent with user intent.
  - Growth Spiral's draw strength shows up in **D and V only**, not a second E bonus.
  **Step 3 — why Growth Spiral can still win without entries 9/10/11 (weight ordering):**
  - **D** (below E in the problem, above E in weight): Growth Spiral fills ramp **and**
    draw deficits; Three Visits fills ramp only → Growth Spiral gets substantially
    higher D. This is the primary stacking problem (entry 10).
  - **V**: Growth Spiral earns versatility bonus; Three Visits does not → further edge
    to Growth Spiral.
  - **E**: Three Visits edge, but E is **weighted below D, M, and C/L** — tiebreaker
    magnitude, not enough alone to flip the ranking.
  - Illustrative relative magnitudes (not real formula output): D+V advantage to Growth
    Spiral might be ~+4–6 units; E advantage to Three Visits might be ~+1–3 units.
  **Step 4 — entries 9, 10, and 11 close the gap (E alone does not):**
  - **P** (entry 9, pip restrictiveness): `{G}{U}` penalized vs `{1}{G}` → nudge toward
    Three Visits.
  - **D sublinear scaling / V rebalance** (entry 10): stop double-counting two deficits
    on one card — main lever to make Three Visits win when ramp is the larger deficit.
  - **L** (entry 11, CMC efficiency): Cultivate must not beat Three Visits via curve bonus.
  **Verification target (once implemented):** Simic test deck with ramp + draw deficits;
  recompute scores; confirm Three Visits ranks above Growth Spiral; confirm E term alone
  favors Three Visits but does not override uncapped D+V stacking.
- Open questions:
  - **Precompute — decided.** A periodic job (cadence TBD — e.g. alongside existing
    Scryfall bulk-data ingestion) snapshots rank-within-population into the local DB.
    Percentiles are never computed live/per-suggestion.
  - **Minimum population size — decided.** Hard floor of **8** ranked cards in a
    population. Below 8, no percentile is computed for that population and E falls
    back to a neutral/default value (no bonus, no penalty) for any card scored against
    it. (Floor picked independently from `CK_REQUIRED_ENABLERS` = 15 — not reusing that
    number, a separate constant.)
  - **Multi-tag cards — decided, and resolves entry 8's relevance here.** The precompute
    job stores **one percentile per role tag**, not one blended percentile per card.
    A card tagged both Ramp and Card Draw gets a `ramp_percentile` *and* a
    `card_draw_percentile` stored separately, each computed against that tag's own
    population (subject to the 8-card floor above, independently per tag). At scoring
    time, whichever role deficit is being filled selects which stored percentile is
    used as E for that suggestion. This means E does **not** need entry 8's unsolved
    "primary role" disambiguation — there's no single per-card quality score being
    blended across tags, so the ambiguity that closed entry 8 doesn't apply to E.
    Optional additional dampening inside E for cards with 2+ utility tags remains on
    the table (see entry 10).
  - **EDHREC vs USD price distortion — decided (include in same pass as entries 9/10/11).**
    High-dollar cards are played less than their power level warrants, depressing
    `edhrec_rank`. E should be price-adjusted (e.g. dampen rank penalty proportional
    to USD above a baseline, capped) so expensive staples are not systematically underrated.
    Implementing agent must document chosen formula. Three Visits (rank ~42) must remain
    elite after adjustment.
  - Discrete tiers vs. a smooth curve for converting percentile into E bonus — still open.
  - Whether/how E extends to the Cuts side (this entry's proposed fix above is written
    for Adds; Cuts application is still TBD).
  - **Scoring rebalance with entries 9, 10, and 11** — entries 9 (P), 10 (D/V rebalance),
    and 11 (L) should ship as part of the same design pass before or with E, so terms
    don't fight or double-count. Entry 12 (creature body bonus) may join the same pass
    once spellslinger detection is confirmed in repo.

### 8. Per-role card quality signal (primary vs. secondary tag) — investigated, ruled out
- Status: Investigated — closed, no viable fix identified. **Closed harder as of
  2026-07-11: EDHREC-sourced solutions (including a narrowed "multi-tag tiebreaker
  only" variant) are off the table on legal grounds, not just data-quality/maintenance
  grounds — see Confirmed cause #1 update below.**
- Side: Both
- Symptom: n/a — investigation prompted by entry 7. A card tagged with multiple roles
  (e.g. both Ramp and Card Draw) has a single blended EDHREC popularity number, with no
  way to tell which tag is actually driving that popularity. Example: a card that's
  mediocre at ramp but well-loved for its card draw would look identically "good" in
  both buckets under a naive rank-based scoring approach.
- Suspected cause: n/a
- Confirmed cause: Investigated two candidate data sources, both ruled out:
  1. **EDHREC's per-category pages** (e.g. edhrec.com/top/ramp) — no official API;
     using this would require unofficial/unversioned `json.edhrec.com` endpoints, a
     bigger departure from the existing "local DB, cached from Scryfall" pattern and
     from the "never live Scryfall" design principle already in place for Adds.
     EDHREC's own FAQ also states category definitions aren't rigorously or
     consistently defined across categories.
     **Update 2026-07-11 — ToS violation, not just a design/quality concern:**
     reviewed EDHREC's Terms of Service (edhrec.com/terms, effective 2024-08-06)
     directly. Section 2 ("Access to the Site") grants a personal/noncommercial-use
     license only and explicitly prohibits (a) commercially exploiting the site, (b)
     accessing the site to build a similar/competitive site, and (c) copying,
     reproducing, downloading, or distributing any part of the site except as
     expressly permitted. Section 3's Acceptable Use Policy separately prohibits
     "automated agents or scripts... to generate automated searches, requests, or
     queries to the Site." A periodic scraper/poller building a local DB from
     `json.edhrec.com` or the rendered category pages is exactly this kind of
     prohibited automated querying, and storing the results locally runs into the
     no-copy/no-distribute restriction too. **This is an access-method and
     reproduction problem, not a data-use problem** — narrowing the use case (e.g. to
     a multi-tag tiebreaker only, using only relative order rather than absolute
     rank) does not avoid it, since the violation is in the querying/storage
     mechanism itself, not in how the resulting number is applied downstream. Any
     future EDHREC-sourced local DB for this project is ruled out on this basis, not
     just deprioritized as a maintenance liability.
  2. **Scryfall Oracle Tags bulk file `weight` field** (per card-tag "tagging") —
     confirmed via direct inspection of real bulk data (2026-07-10) that `weight` is
     not a continuous or fine-grained score. It's a small discrete value set (observed:
     `median`, `very_strong`; likely also lower/higher tiers not observed in the sample
     pulled) that is overwhelmingly defaulted to `median` — e.g. 557/557 "ramp"
     taggings were `median`, and 1707/1708 "removal-destroy" taggings were `median`
     with exactly one `very_strong` outlier (Murder). This indicates `weight` functions
     as a rarely-touched manual override rather than a routinely-assigned prominence
     judgment, and cannot reliably distinguish a card's dominant role from an incidental
     one.
- Proposed fix: none — no viable data source currently identified for isolating
  per-role card quality/prominence. EDHREC is excluded as a source outright (ToS);
  Scryfall `weight` is excluded on data-quality grounds. Not being pursued further
  unless a new, ToS-compliant data source is suggested. **Mitigation path (not a
  reopen of #8):** entry 7's contextual E (per-tag percentile, dampened for multi-tag
  cards) + entry 9's castability signal (P) + entry 10's versatility rebalance + entry
  11's CMC efficiency (L) are the approved substitute approach — see those entries
  rather than reopening this one.
- Constraints: Any future proposal must not rely on scraping or polling EDHREC (site
  or `json.edhrec.com`) in any form, including one-off/manual pulls at scale, per ToS
  Sections 2–3.
- Open questions: none currently — closed pending any new, ToS-compliant data source
  suggestion.

### 9. Adds mana pip color restrictiveness (castability)
- Status: Symptom noted
- Side: Adds
- Symptom: predicted bad suggestion — flexible/multi-pip cards ranked too highly vs
  easier-to-cast options at the same CMC. User example: `{G}{U}` Growth Spiral (2 CMC,
  two colored pips) treated as comparably easy to cast as `{1}{G}` Three Visits (2 CMC,
  one colored pip + one generic). Even at equal CMC, `{R}{G}` is far more restrictive
  than `{1}{G}`: the former hard-requires both a red and a green source that turn,
  while the latter requires only green plus mana of any color. Fewer colored pips = more
  castable = genuinely more versatile in a deckbuilding sense (distinct from role-tag
  versatility in entry 10).
- Suspected cause: Adds scoring has no term that distinguishes generic-heavy mana costs
  from multi-colored-pip costs. CMC is factored into curve-gap bonus (C) but pip
  restrictiveness is not. Verify in `_scoreAddCandidate` / mana-cost parsing at current
  line numbers.
- Confirmed cause: not yet — need to verify Adds scoring ignores colored-pip count.
- Proposed fix: add a new subtractive term or sub-factor (working name **P**, pip
  restrictiveness penalty) to Adds scoring, OR fold into an existing term if cleaner.
  Derive from the card's mana cost: penalize colored mana symbols in the cost (W/U/B/R/G
  pips); generic `{1}`/`{2}`/etc. do not add restrictiveness. **`{C}` (colorless) —
  TBD** whether it counts as restrictive (see Open questions).
  **User intent:** Growth Spiral should take a meaningful ding vs Three Visits partly
  because of its two colored pips. Exact formula/weight TBD — must sit below D, M, C/L,
  and E in influence but be strong enough to matter in same-CMC comparisons.
  **Coordinate with entry 11** in the same design pass (see entry 11 weight order).
- Constraints: Adds-only unless user later asks for Cuts symmetry. Do not conflate with
  color-identity legality (already a candidate-pool filter). Distinct from role-tag
  versatility (V) — this is mana-cost castability, not role breadth. Scryfall mana-cost
  data is already local. Do not touch CK hard gate, tribes, or candidate-pool logic.
- Open questions:
  - Separate term P vs adjustment inside C (curve) — which is cleaner?
  - Should hybrid/phyrexian/variable costs get special handling?
  - How does P interact with commander's color identity (e.g. `{G}{U}` in Simic is
    on-color but still stricter than `{1}{G}` for early-game casting)? **User framing
    (decided):** penalize colored pips regardless of on-color status.
  - Numeric weight/cap — needs calibration alongside entries 10 and 11 rebalance.

### 10. Versatility overweight — flexible cards beat dedicated staples (Growth Spiral vs Three Visits)
- Status: Symptom noted
- Side: Adds
- Symptom: predicted bad suggestion — when a deck has both Ramp and Card Draw deficits,
  Growth Spiral likely outscores Three Visits because it fills two deficits (D), earns
  versatility bonus (V), and has strong EDHREC rank (E, once entry 7 ships) — even
  though Three Visits is among the best ramp cards in the format and should rank above
  Growth Spiral when ramp is the larger active deficit. User position: **versatility
  is valuable but is NOT everything**; dedicated S-tier role cards should beat flexible
  mid-tier dual-role cards when the **largest deficit** favors single-role excellence.
- Suspected cause: compound stacking — D scales with deficits filled (double-counts
  multi-role candidates when multiple deficits are active), V adds a separate breadth
  bonus, and E may not sufficiently favor dedicated ramp excellence. No pip restrictiveness
  term (entry 9). No CMC efficiency term (entry 11). Possible EDHREC price suppression
  for expensive staples (entry 7) may further skew some comparisons, though Three Visits'
  rank (42) is already elite. Verify actual V formula and D multi-deficit scaling in
  `_scoreAddCandidate`.
- Confirmed cause: not yet — need to verify current V weight and whether D multiplies or
  sums per deficit.
- Proposed fix: **Primary lever decided — sublinear D scaling (Option A).** Rebalance
  across existing terms, not deleting V:
  - **D sublinear scaling (PRIMARY):** when a candidate matches multiple active deficits,
    sort matched deficit magnitudes descending; apply weights `1.0, ~0.40, ~0.20` for
    1st/2nd/3rd deficit credit. Single-deficit candidates unchanged.
  - **V dampening (tertiary):** keep V positive; dampen inside V for 2+ utility tags
    (~50% contribution from 2nd tag onward, or similar). **Do not** add Cuts-style
    subtractive multi-role discount to Adds total score.
  - **Combine with entry 9** (P pip penalty), **entry 11** (L CMC efficiency), and
    **entry 7** (E contextualized per role, price-aware, dampened for multi-tag inside E).
  - **Acceptance bar (decided):** Three Visits must rank **above** Growth Spiral when
    **ramp is the larger deficit** — not merely >50% of mixed-deficit cases.
- Constraints: Versatility should remain a positive signal on Adds (unlike Cuts' penalty)
  — flexible cards that *legitimately* solve two problems should still rank well when
  both deficits are severe and comparable. Goal is to stop flexibility from
  **systematically** beating dedicated best-in-slot cards when the largest gap is
  role-specific excellence. All rebalance scoped to Adds. Coordinate with entries 7, 9,
  and 11 so terms don't double-penalize or double-reward the same property.
  **Canonical test case:** see entry 7 worked example (Three Visits vs Growth Spiral).
  That example confirms E percentiles **favor** Three Visits (rank 42 → elite ramp
  percentile; Growth Spiral dampened as multi-tag) but **cannot** overcome D+V stacking
  alone — entry 10's D sublinear rebalance is the primary fix; entry 9 P and entry 11 L
  are secondary.
- Open questions:
  - Exact sublinear weights and V dampening constants — calibrate on canonical test case
    in repo with logged term breakdown.
  - Price-aware E (entry 7) ships in same pass — **decided yes.**

### 11. CMC efficiency — ignore curve bonus (C), reward lower CMC (L) for interaction roles
- Status: **Needs investigation** — algorithm design decided; **project role-tag IDs must
  be mapped in repo** before prompt can be drafted (this project uses different tag names/IDs
  than Scryfall `otag:` slugs; do not assume 1:1 mapping from the reference list below).
- Side: Adds
- Symptom: predicted bad suggestion — curve-gap bonus (C) treats higher-CMC spells as
  more valuable when they fill a higher curve slot, even when lower-CMC spells are strictly
  better in the same role. User examples:
  - **Three Visits vs Cultivate:** both ramp; Cultivate (3 CMC) must not outrank Three
    Visits (2 CMC) because C rewards filling the 3-drop slot.
  - Same pattern expected for cheap removal, protection, combat tricks, and pump — efficiency
    matters more than curve-filling for these roles.
- Suspected cause: Adds scoring applies curve-gap bonus (C) uniformly to all role-tagged
  candidates. CMC only affects C (and indirectly sorting), with no inverse "cheaper is
  better" signal for roles where mana efficiency dominates. Verify in `_scoreAddCandidate`
  and curve-bucket logic at current line numbers.
- Confirmed cause: not yet in repo — confirmed at spec level that documented formula has
  no L term and no role-specific C suppression.
- Proposed fix: add new additive term **L** (CMC efficiency bonus) and **suppress C** for
  candidates in efficiency-mode roles. Coordinate with entries 7, 9, 10, and 12 in the
  same design pass.
  **Weight order (decided):** `D, M` > `C or L` > `E` > `B` > `P` > `V` > `T, K` (B = entry 12
  creature body bonus).
  **Behavior:**
  - If candidate has ≥1 **efficiency-mode project role tag** (see tag lists below) AND is
    **not a land**: set **`C = 0`**, compute **`L = K_L × max(0, CMC_REF − CMC)`** with
    starting constants `CMC_REF = 4`, `K_L` tuned in repo.
  - Otherwise: existing C unchanged, **`L = 0`**.
  - Lands are excluded from L even if tagged ramp (avoids breaking `land-ramp` / land-based
    acceleration).
  **Implementation prerequisite — project tag mapping (REPO REQUIRED):**
  The implementing agent must locate the project's internal role-tag constants/enums (the
  ~36 utility tags used in `_scoreAddCandidate`, deficit counting, and `/api/cards/by-roles`)
  and build `EFFICIENCY_MODE_PROJECT_TAGS` from the semantic categories below. The Scryfall
  `otag:` slugs in this entry are **reference only** — map each category to whatever IDs,
  display names, or parent/child tag relationships the codebase actually uses. Document the
  final mapping in a comment or constant block.
  ---
  **Tier 1 — efficiency mode (required; user-confirmed roles):**
  | Semantic role | Scryfall `otag:` reference slugs (map to project tags in repo) |
  |---------------|----------------------------------------------------------------|
  | **Ramp** | `ramp` |
  | **Removal** | `removal`, `spot-removal`, and all `removal-*` subtags: `removal-artifact`, `removal-aura`, `removal-battle`, `removal-bounce`, `removal-burn`, `removal-creature`, `removal-destroy`, `removal-enchantment`, `removal-equipment`, `removal-exile`, `removal-fight`, `removal-land`, `removal-noncreature`, `removal-nonenchantment`, `removal-nonland`, `removal-permanent`, `removal-planeswalker`, `removal-sacrifice`, `removal-spacecraft`, `removal-token`, `removal-toughness`, `removal-tuck`, `removal-vehicle` |
  | **Protection** | `protection`, `damage-prevention`, `damage-prevention-creature`, `damage-prevention-permanent`, `damage-prevention-planeswalker`, `damage-prevention-player`, `damage-prevention-self`, `damage-prevention-you`, `gives-protection`, `gains-protection`, `gives-hexproof`, `gains-hexproof` |
  | **Combat trick** | `combat-trick` |
  | **Pump** | `giant-growth`, `giant-growth-with-set-mechanic` *(Scryfall has no top-level `pump` slug)* |
  **Tier 2 — efficiency mode (recommended v1 unless repo already uses a narrower role set):**
  | Semantic role | Scryfall `otag:` reference slugs |
  |---------------|----------------------------------|
  | **Counterspell** | `counterspell` + all `counterspell-*` subtags |
  | **Direct damage / burn removal** | `burn`, `burn-any`, `burn-creature`, `burn-planeswalker`, `burn-player`, `burn-player-each` |
  | **Bounce / unsummon** | `bounce`, `bounce-self` *(also `removal-bounce` in Tier 1)* |
  | **Combat fog** | `fog`, `fog-selective`, `pseudo-fog` |
  | **Silence / hard no** | `silence`, `prevent-cast` |
  | **Hand disruption** | `hand-disruption`, `discard` |
  **Tier 3 — discuss before including (efficiency matters but curve/CMC is messier):**
  | Semantic role | Scryfall `otag:` reference slugs | Caveat |
  |---------------|----------------------------------|--------|
  | **Tutor** | `tutor` | Cheap tutors dominate; some 4–5 CMC tutors still staples |
  | **Recursion / reanimation** | `recursion`, `reanimate` | Cheap often king; haymakers break pattern |
  | **Cantrip draw** | `cantrip`, `pure-draw`, `impulsive-draw` | Not same as spot-interaction efficiency |
  | **Fight/bite tricks** | `fight`, `one-sided-fight`, `bite` | Overlap with combat-trick |
  **Explicit exclusions — keep normal curve bonus (C); do NOT apply L / do NOT zero C:**
  | Semantic role | Scryfall `otag:` reference slugs | Why |
  |---------------|----------------------------------|-----|
  | **Board wipe** | `sweeper`, `sweeper-one-sided`, `sweeper-graveyard`, `board-reset`, `multi-removal` | Wipes belong at 4–6 CMC |
  | **Draw engines** | `draw-engine`, `repeatable-draw`, `repeatable-card-advantage` | Rhystic Study at 3 beats cantrips in role quality |
  | **Card Draw (general)** | `card-advantage`, `draw` | Mix of cantrips and engines |
  | **Land-based ramp** | `land-ramp`, `multi-land-ramp`, `bounceland` | Lands use different CMC economics |
  | **Plan / untagged** | *(no utility tag)* | Filler and haymakers — curve still matters |
  | **Anthems / finishers** | `anthem`, `group-slug` | Mid–high CMC payoffs |
  ---
  **Updated Adds formula (when entries 7/9/10/11/12 ship together):**
  `Score = (D × M) + C_eff + L + E + B − P + V + T + K`
  where `C_eff = 0` when L applies, else existing C. See entry 12 for B.
  **Verification targets:**
  1. Ramp deficit active: **Three Visits ranks above Cultivate** (L drives this; Cultivate
     must not win via C).
  2. Ramp deficit > draw deficit: **Three Visits ranks above Growth Spiral** (primarily
     entry 10 D sublinear; L/P/E must not break this).
  3. Board-wipe deficit only: sweeper candidates still receive normal C (L not applied).
  4. Log term breakdown: D, M, C, L, E, P, V, T, K for TV vs Cultivate and TV vs GS.
- Constraints: Adds-only. Do not change Cuts curve logic. Do not use Scryfall `otag:` slugs
  directly unless the codebase already keys off them — map to project tags first. Do not
  apply L to lands. Coordinate constants with entries 9 (P) and 10 (D/V). Entry 12 (creature
  body bonus) interacts with ramp comparisons — calibrate L and B together on STE vs
  Rampant Growth and Wood Elves vs Rampant Growth. Do not touch CK gate, tribes, candidate pool.
- Open questions:
  - **Project tag mapping** — blocked on repo access; implementing agent must produce
    `EFFICIENCY_MODE_PROJECT_TAGS` constant with documented mapping from semantic tiers above.
  - Include Tier 2 tags in v1 or ship Tier 1 only first?
  - `K_L` and `CMC_REF` calibration vs entry 10/12 constants.
  - Tier 3 tags — include in v1?

### 12. Creature body bonus — creatures beat non-creature spells (non-spellslinger)
- Status: Symptom noted
- Side: Adds
- Symptom: predicted bad suggestion — for ramp (and likely other efficiency roles), non-creature
  spells with higher EDHREC popularity outrank strictly better creature versions. User examples:
  - **Sakura-Tribe Elder vs Rampant Growth:** STE is significantly better; Rampant Growth has
    higher EDHREC score but should not win in a typical creature-based Commander deck.
  - **Wood Elves vs Rampant Growth:** Wood Elves (3 CMC creature, ETB ramp) is probably better
    than Rampant Growth (2 CMC sorcery) — "Three Visits on a creature" — even though entry 11's
    L term favors lower CMC on spells.
- Suspected cause: Adds scoring values the spell effect but not the **creature body** (blocking,
  chump blocking, sacrifice/fodder synergy, attack pressure, death triggers). E (entry 7) may
  further favor popular sorceries like Rampant Growth over creatures. No archetype-aware
  creature premium exists. Verify card-type handling in `_scoreAddCandidate`.
- Confirmed cause: not yet — need repo to confirm no creature-type bonus and to locate
  spellslinger/archetype detection.
- Proposed fix: add new additive term **B** (body bonus), gated by deck archetype.
  **Working design (for repo agent to implement and calibrate):**
  - **Gate:** apply B only when `!deckIsSpellslinger(deck)`.
  - **Candidate:** candidate is a **Creature** (card type line / category in local DB) AND
    matches an **active deficit** via at least one utility role tag.
  - **v1 scope (user examples):** full B weight when filling **Ramp** deficit; optional
    extension to Removal/Protection on-a-stick creatures in v2.
  - **Formula sketch:**
    `B = K_B` base for qualifying creatures, with `K_B_RAMP` ≥ `K_B` when largest active
    deficit is Ramp (or when candidate has Ramp tag and ramp deficit is active).
  - **Weight order:** B sits **below D, M, C/L, and E** but **above P** —
    must be large enough to flip STE over Rampant Growth when E favors the sorcery, and
    large enough that Wood Elves beats Rampant Growth despite L giving the 2-CMC sorcery a
    1-point CMC edge (3 vs 2 at `CMC_REF=4`: L_WE=1, L_RG=2; B must overcome +1 L + E edge).
  - **Spellslinger detection (REPO REQUIRED):** use existing archetype detection/override if
    present (e.g. Spellslinger archetype flag). Fallback heuristic TBD in repo: e.g. instant+
    sorcery density above threshold, or "spells matter" theme — implementing agent must
    document chosen signal. When spellslinger: **B = 0** (instants/sorceries preferred).
  - **Interaction with entry 11:** creatures in efficiency-mode roles still get L (lower CMC
    still helps) but also get B when not spellslinger. Do not zero L for creatures. Consider
    whether ramp creatures with ETB ramp (Wood Elves) need a separate **effective-ramp-CMC**
    for L (optional enhancement) — e.g. treat ETB-search-for-forest as CMC 2 for L purposes
    — only if B alone cannot flip WE vs RG in calibration.
  **Verification targets:**
  1. Non-spellslinger green ramp deck: **Sakura-Tribe Elder ranks above Rampant Growth**.
  2. Same deck: **Wood Elves ranks above Rampant Growth**.
  3. Spellslinger deck (once detection confirmed): Rampant Growth can rank above STE — B = 0.
  4. Log term breakdown including B for STE vs RG and WE vs RG.
- Constraints: Adds-only. B is additive only — no penalty on non-creatures. Do not apply B to
  lands, tokens, or non-creature types. Coordinate calibration with entries 7 (E may favor RG),
  11 (L favors RG CMC). Do not touch CK gate, tribes, candidate pool. Spellslinger detection
  must respect existing archetype override UX if present.
- Open questions:
  - Exact spellslinger signal in repo — archetype enum name, slider, or heuristic?
  - Extend B beyond Ramp in v1 (removal creatures, protection creatures)?
  - `K_B` vs `K_B_RAMP` numeric values — calibrate on STE/RG and WE/RG with logged terms.
  - ETB-ramp effective-CMC adjustment inside L — needed or does B alone suffice?

### Coordinated scoring pass — entries 7 + 9 + 10 + 11 + 12
- Status: **Prompt drafted** (2026-07-12) — ship as **one agent task**, not five separate PRs.
  Entries 7, 9, 10, 11, 12 remain individually tracked above; this entry is the integration
  record and holds the ready-to-copy agent prompt.
- Side: Adds (+ server precompute for E)
- Symptom: n/a — coordinated enhancement pass addressing multi-role stacking, pip
  restrictiveness, CMC/curve mismatch for efficiency roles, EDHREC popularity, and creature
  vs spell bias.
- Confirmed cause: spec-level only; repo agent must verify D/V/C formulas and tag IDs before
  editing.
- Proposed fix: see **Agent prompt** block below. Final formula:
  `Score = (D × M) + C_eff + L + E + B − P + V + T + K`
  Weight order: `D, M` > `C or L` > `E` > `B` > `P` > `V` > `T, K`.
- Constraints: Adds-only scoring. Do not touch Cuts, candidate pool, `tribes: []`, CK gate.
  Entry 11 tag mapping must use **project role-tag IDs**, not Scryfall `otag:` slugs directly.
  Entry 1 (commander CMC in Adds curve) is a separate task unless user explicitly bundles it.
- Open questions: Tier 2 efficiency tags in v1 (entry 11) — default **include** unless repo
  tag set is much narrower. Spellslinger detection signal — repo must document.

---

## Agent prompt: Coordinated Adds scoring rebalance (entries 7/9/10/11/12)

Copy everything in this fenced block to an agent with repo access:

```
# Adds scoring rebalance — entries 7, 9, 10, 11, 12 (single coordinated pass)

## Context
Update **Suggested Adds only**. Verify line anchors before editing (may have drifted):
- `_scoreAddCandidate` (~decks.js:6489)
- `_computeAddContext` (~decks.js:6274)
- `_renderAddSuggestions` (~decks.js:6623)

Current score (approx): `(D × M) + C + V + T + K` — no E, P, L, or B terms; D likely
sums full credit per matched deficit; C applies uniformly.

## Goal
Implement coordinated scoring changes so ALL verification cases pass (see bottom).

## Step 0 — Repo discovery (do this first, document in PR)
1. Read `_scoreAddCandidate` — confirm current D, M, C, V, T, K math and constants.
2. Locate project **role-tag IDs/names** (~36 utility tags). Build constants from semantic
   lists in backlog entry 11 — do NOT assume Scryfall `otag:` slugs match project IDs.
3. Locate **archetype detection** for spellslinger (or equivalent). Document function used
   for entry 12 B-term gating.
4. Confirm `edhrec_rank` and USD price available on card objects in local DB.
5. Log term breakdown helper for verification (debug flag or unit test).

## Term changes

### D — sublinear multi-deficit scaling (entry 10, PRIMARY)
When candidate matches multiple active deficits:
- Collect matched deficit magnitudes; sort descending.
- `D = Σ deficit_i × weight_i` where weights = `[1.0, 0.40, 0.20]` for 1st/2nd/3rd+.
- Single-deficit candidates: unchanged (weight 1.0 only).

### L + C_eff — CMC efficiency for interaction roles (entry 11)
Build `EFFICIENCY_MODE_PROJECT_TAGS` from backlog entry 11 Tier 1 + Tier 2 semantic
categories mapped to project tag IDs. Exclude lands from L.

If candidate has ≥1 efficiency-mode tag AND is not a land:
- `C_eff = 0`
- `L = K_L × max(0, CMC_REF − CMC)` with `CMC_REF = 4`, `K_L` tuned
Else:
- `C_eff = C` (existing curve-gap bonus)
- `L = 0`

Do NOT apply L / do not zero C for: Board Wipe, Card Draw (general), draw engines,
Plan/untagged, land-ramp categories — see entry 11 exclusion table.

### E — price-aware EDHREC percentile (entry 7)
Precompute server-side (never live per suggestion):
- Per role tag, store percentile from `edhrec_rank` within that tag's ranked population.
- Min population 8; below → E = 0 (neutral).
- **Price-aware:** adjust rank/percentile so expensive staples aren't systematically
  underrated (document formula; Three Visits rank ~42 must stay elite).

At scoring: **one E per candidate** using percentile for **largest active deficit's role**.
Multi-tag dampening inside E only (optional). Do NOT sum E per tag.
Do NOT use EDHREC category APIs or scrape edhrec.com.

### B — creature body bonus (entry 12)
If `!deckIsSpellslinger(deck)` AND candidate is Creature AND fills active deficit:
- `B = K_B_RAMP` when ramp deficit active and candidate has Ramp tag
- else `B = K_B` for other qualifying creatures (v1: ramp-focused; extend later)
Else `B = 0`.

Must flip: Sakura-Tribe Elder > Rampant Growth; Wood Elves > Rampant Growth even though
L favors RG by 1 point (CMC 2 vs 3). Calibrate K_B_RAMP accordingly.

### P — colored pip restrictiveness (entry 9)
`P = K_P × colored_pip_count` (W/U/B/R/G only; generic does not count).
Subtract from total. Penalize regardless of on-color status.

### V — dampen multi-tag versatility (entry 10, tertiary)
Keep V positive. Dampen for 2+ utility tags (~50% on 2nd+ tag contribution).
Do NOT add Cuts-style subtractive multi-role discount on total score.

## Final formula
`Score = (D × M) + C_eff + L + E + B − P + V + T + K`

## Weight order (calibration guide)
`D, M` > `C or L` > `E` > `B` > `P` > `V` > `T, K`

## Do NOT touch
- Cuts / `_suggestCardsToCut`
- Adds candidate pool / owned vs backfill (entry 6)
- `tribes: []` on backfill (intentional)
- `CK_REQUIRED_ENABLERS` (15)
- Entry 1 commander CMC curve fix (unless user says bundle)

## Verification (all required)
| # | Case | Expected winner |
|---|------|-----------------|
| 1 | Simic, ramp deficit > draw deficit | Three Visits > Growth Spiral |
| 2 | Ramp deficit active | Three Visits > Cultivate |
| 3 | Non-spellslinger green ramp deck | Sakura-Tribe Elder > Rampant Growth |
| 4 | Same deck | Wood Elves > Rampant Growth |
| 5 | Board-wipe deficit only | Sweepers still get C (L not applied) |
| 6 | Spellslinger deck (if detectable) | B = 0; RG may beat STE |
| 7 | Term isolation | E favors TV over GS in ramp context but cannot alone flip #1 |

Log D, M, C_eff, L, E, B, P, V, T, K for each verification pair.

## Deliverables
- Code + named constants (`D_SUBLINEAR_WEIGHTS`, `K_L`, `CMC_REF`, `K_P`, `K_B`, `K_B_RAMP`, E params)
- `EFFICIENCY_MODE_PROJECT_TAGS` with mapping comment
- Formula comment block in `_scoreAddCandidate`
- Precompute job/migration for E percentiles if not present
- Test or debug output for all 7 verification cases
```

---

## Intake: new symptoms go here first
Use this section to drop in raw observations ("deck X got suggested to cut Y, which was
obviously wrong because Z") before they're triaged into a numbered entry above.

-

---

## Project context: Suggested Cuts / Suggested Adds feature

**Purpose of this project:** making this feature better, in two ways — fixing suggestions
that are bad or flat-out incorrect, and building enhancements/new capabilities it doesn't
have yet (e.g. new scoring signals, new UI controls). Treat descriptions below as the
current (possibly buggy, possibly incomplete) behavior, not the desired end state — don't
assume something is correct or complete just because it's documented here.

This project stays scoped to Suggested Cuts / Suggested Adds only, not the wider
deck-builder app. This doc is for the user only, not a shared team reference.

## Domain model
- Cards are tagged with ~36 role tags (Ramp, Card Draw, Removal, Board Wipe, Tutor,
  Counterspell, Protection, Recursion, etc.), sourced from Scryfall's community tagging
  project, cached server-side, user-overridable per card and per deck.
- Baseline "ideal recipe" for a 100-card Commander deck: Ramp 10, Card Draw 10,
  Removal 10, Board Wipe 3, Tutor 2, Counterspell 3, Protection 3, Recursion 3,
  Plan 30 ("Plan" = no utility tag).
- Recipe is adjusted by: (1) detected/overridden **archetype**, (2) the **Aggro↔Control
  slider** (one slider, drives both Cuts and Adds thresholds), (3) an **ideal mana curve**
  (format + land ratio + ramp + commander CMC → Gaussian-blended target curve).

## Cuts (decks.js:6254 `_suggestCardsToCut`)
- Only shown when deck qty > 100. Candidates = deck cards minus commander/tokens/lands.
- Score = max role surplus (over threshold) + CMC factor + "competes with commander"
  CMC penalty + roleless-card bonus − multi-role discount + cheap-price bonus + curve
  bloat penalty − tribal shield − commander-theme shield + dead-payoff gate penalty.
- Top 5 shown. **No hard conditional-keyword gate** — dead payoffs only soft-penalized.

## Adds (decks.js:6623 `_renderAddSuggestions`, async)
- Shown whenever deck has cards. Candidate pool: owned collection first (need color
  identity fit, not already in deck, a free/unallocated copy); if <8 owned qualify and
  a real (non-Plan) deficit exists, backfill from server `/api/cards/by-roles` (unowned,
  local DB only, never live Scryfall, `tribes` sent empty on purpose).
- Score = role deficits filled × dead-payoff multiplier (0.3–1.0) + curve-gap bonus +
  versatility bonus + tribal bonus + commander-theme bonus. Roleless filler capped at +3.
- **Hard gate**: conditional-keyword mechanics (Prowess, Delirium, Threshold, etc.)
  need ≥15 qty-weighted enablers in the deck or the candidate is silently dropped —
  no matter its score, no "N hidden" note (unlike the EDHREC recs panel).
- Top 8 shown (`_ADD_SUGGESTION_COUNT`), owned-first.

## Known quirks/inconsistencies

Status key: **CONFIRMED BUG (fix)** = user has directed a fix. **FLAG ONLY** = don't touch
without explicit instruction, just make sure it's on the radar. **INTENTIONAL, DO NOT TOUCH**
= deliberate design choice by user's partner, leave alone unless discussed.

1. **FLAG ONLY, likely unintentional but unconfirmed.** Plan-count token exclusion differs:
   Cuts' candidate pool already excludes tokens (tokens aren't "cuttable" cards), so tokens
   fall out of its Plan-count math as a side effect. Adds' Plan-count reuses a
   non-land/non-commander filter that doesn't also exclude tokens. This was never explicitly
   documented as intentional anywhere in the spec — it's an assumption/inference about *why*
   the asymmetry exists, not a confirmed reason. Verify in actual code before treating as
   settled either way.
2. **CONFIRMED BUG — fix directed by user.** Curve bucket commander-inclusion differs: Cuts
   includes the commander in curve calc; Adds excludes it. **Adds should be changed to also
   include the commander's CMC in the curve calculation, matching Cuts.** Do not implement
   until user explicitly asks to start this work — this instruction records the *intended
   fix*, not a standing task to execute unprompted.
3. **FLAG ONLY — important for future work.** `_deckSwapsEnabled(deck)` is called with a
   `deck` arg in both renderers but the function takes no parameters (toggle is user-wide,
   not per-deck). Harmless today, but any code touching Adds/Cuts planning-mode behavior
   needs to know this before assuming per-deck toggle state exists — it doesn't.
4. **INTENTIONAL, DO NOT TOUCH — user's partner's decision.** Adds always sends `tribes: []`
   to the server by design (comment: tribal matching used to be weighted too heavily and
   over-tuned suggestions). The server endpoint supports tribal matching for other callers,
   but this caller opts out on purpose. Keep flagged as deliberate; don't "fix" without
   discussing with user first.
5. **FLAG ONLY, informational.** A deck deficient *only* in Plan cards never triggers the
   unowned-card fetch — likely explains "no suggestions" or "same suggestions forever" on
   decks that are well-stocked on roles but short on actual gameplay/theme cards.

## Key file/line anchors (may drift — verify against current code before citing)
- decks.js:6254 `_suggestCardsToCut`, decks.js:6489 `_scoreAddCandidate`,
  decks.js:6190 `_computeBaseThresholds`, decks.js:6216 `_computeCutThresholds`,
  decks.js:7126 `_computeIdealManaCurveContext`, decks.js:11149 `CK_REQUIRED_ENABLERS` (15).

## How to use this
- Treat this as ground truth for how scoring currently works — don't re-derive from
  first principles or guess at intent for the quirks above.
- If asked to change scoring behavior, name which side (Cuts vs Adds) and which term
  in the formula is being changed, since the two panels share some state but diverge
  in several scoring terms (see table above).
- This project covers both bug fixes and enhancements/new features for Cuts/Adds. A
  backlog entry doesn't need an observed bad suggestion to be valid — a feature request
  with a clear proposed behavior (see entries 6 and 7 for examples) is tracked the same
  way, through the same Status pipeline, and held to the same bar before a prompt is
  drafted (Fix scoped or later).

---

**Working backlog doc (Cuts/Adds Improvement Backlog)**

There is a separate working document (uploaded to Project knowledge) that tracks debugging findings and enhancement/feature requests, turning both into scoped agent prompts. It is distinct from these instructions: this doc is fixed ground truth, the backlog doc is a living list of in-progress issues and in-progress improvements.

*Adding to the doc:*
- When the user says "add X to the doc" or drops something in the doc's Intake section, read the current uploaded version of the backlog doc first, then edit it.
- New raw symptoms should be **triaged**, not just appended: convert them into a numbered backlog entry using the doc's existing Entry template (Status / Side / Symptom / Suspected cause / Confirmed cause / Proposed fix / Constraints / Open questions), filled in as far as can be determined, with genuinely unknown fields marked TBD rather than guessed.
- Always return the **full updated document**, not a diff or a snippet — the user re-uploads the whole file to replace the stale copy in Project knowledge.
- Don't advance an entry's Status past what's actually been confirmed (e.g. don't mark something "Root cause confirmed" just because it sounds plausible).
- Respect this doc's own constraints fields and the known-quirks list from the main project instructions — don't let a triage pass quietly reverse something flagged as intentional or flag-only.

*Drafting a prompt from an entry (only on explicit request — e.g. "give me a prompt for entry 3," "turn this into a prompt for the agent"):*
- Only draft a ready-to-use prompt for entries at **Fix scoped** or later. If an entry isn't there yet, say so and offer to help investigate/scope it instead of drafting a premature prompt.
- Follow the doc's "How an entry becomes a prompt" template: verified current behavior + file/function, the defect scoped to one term on one side, the desired change, an explicit do-not-touch list (pulled from that entry's Constraints and the project's known-quirks list), and a verification step.
- Write it for an autonomous coding agent with no memory of this conversation — fully self-contained, no "as we discussed" references.
- Present it in a clearly delimited block so it's easy to copy out.
- Keep it tight — scoped to the one entry, not a recap of the whole project.
