# RFC: Jev (TypeSafe System One) as an advisory issuer classifier for routing

- **Status:** Proposed — decision needed (do not merge until approved)
- **Date:** 2026-10-04
- **Related:** #32, PR #33 (broad coverage), `docs/MODEL_COVERAGE.md`
- **Decision owner:** human (valuation-model policy)

## Summary

Add **Jev** (TypeSafe AI's "System One" decision model) as an *advisory*
classifier that helps route issuers to the right model archetype. It only
answers constrained classification questions — it never produces numbers and
never bypasses the source-readiness gates. The deterministic rule-based
classifier stays the default and the fallback.

## Problem

The broad-coverage work (PR #33) closed most *data* gates. The remaining
coverage misses are increasingly **classification** problems, not mapping
problems:

- **Misroutes from brittle token matching.** AMAT ("Semiconductor Equipment &
  Materials") was routed to the integrated-energy model because the industry
  string contains "materials". Fixed by reordering rules — but the class of bug
  remains (any token collision in sector/industry/SIC text).
- **Unclassified issuers.** UNH (`Healthcare Plans`, SIC 6324) matches no
  archetype token and lands in `unclassified_operating`, which has no
  production route.
- **Subtype detection by substring.** V/MA are "credit services" so they enter
  the financial-institution branch and end at "subtype unsupported by the
  commercial-bank model" even though they are operating-like companies.
- **Specialist dispatch is hard-coded to issuers.** Energy/pharma routes map
  XOM/PFE specifically; every other issuer in those sectors needs a judgment
  call between the specialist model, the trading-multiple fallback, or a
  fail-closed block.

The gates themselves are fine — they are data-driven and fail closed. The
weak link is the **classification/routing decision** in front of them.

## What Jev is

- TypeSafe AI's "System One" / decision model: zero-shot classifier that
  answers constrained questions ("nouls"), not a generative LLM.
- Pricing: input from **$0.042 / MTok**, output free; reported ~200× faster and
  ~400× cheaper than comparable small LLMs on classification tasks.
- Integrations: `langchain_typesafe` (`TypeSafeClassifier`, `Noul`), `llm -m jev`.
- Because it only answers the questions asked, it **cannot invent a valuation
  number** — the failure mode of using a generative model in this position.

Cost for this use case: ~50–200 tokens per issuer, i.e. fractions of a cent
per ticker; cached by profile digest, effectively free on rebuilds.

## Proposed design (advisory only)

### Placement

A new module, e.g. `backend/app/services/valuation/issuer_classifier.py`,
consulted by `classify_company` at exactly three decision points:

1. `company_type` / branch selection (operating vs bank vs insurer vs REIT vs
   utility vs other-financial).
2. `_operating_archetype` (the existing 12 labels).
3. Specialist-applicability hint (e.g. "this integrated-energy issuer reports
   production/reserve schedules" → specialist route candidate; "does not" →
   multiple-route fallback).

### Inputs (v1)

Profile fields already in the payload: ticker, name, sector, industry, SIC,
`sic_description`. No financials, no filing text in v1 — public
classification facts only.

### Questions (illustrative)

- `company_type`: operating / bank / insurer / reit / utility / other_financial
- `operating_archetype`: one of the existing labels
- collision probes: "semiconductor equipment/materials" vs "oil & gas/mining
  materials"; "payment network" vs "bank"; "managed care" vs "life insurer"
- specialist probe: "does this issuer present production/reserve schedules?" /
  "does this issuer present product-level patent schedules?" (used only to
  prefer specialist vs multiple fallback, never to skip readiness)

### Arbitration policy

| Situation | Behavior |
| --- | --- |
| Rules confident (specific SIC/token match) | Rules win; Jev runs in **shadow** and is logged for evaluation |
| Rules ambiguous (unclassified, token collision, conflicting tokens) | Jev label accepted only if score ≥ threshold; otherwise rules behavior stands |
| Jev unavailable / timeout / low score | Rules behavior stands (fail closed) |

Jev **never** touches readiness keys, bridge facts, peer selection, or values.
A wrong label can only change which route is *attempted*; every route still
fails closed on missing sources.

### Audit and configuration

- Eligibility payload gains `classification_source` (`rules` | `rules+jev`) and
  a compact evidence record (model id/version, input digest, label, score).
- Env: `DCF_ISSUER_CLASSIFIER=off|shadow|advisory` (default `off` until the
  evaluation gate passes), API key, 1s timeout, per-day cost cap.
- Cache: `(profile digest, model version) → labels`; shadow mode also caches.

### Evaluation gate (before any advisory use)

- Fixture: the 43-ticker coverage sweep with expected archetypes/subtypes
  (the live tests already encode several).
- Metrics: per-class precision/recall; misroute rate on collision cases
  (AMAT-class); unclassified rate (UNH-class); zero regressions on the
  confidently-classified set.
- Rollout: shadow mode for N builds → advisory-with-logging → (optionally)
  auto-apply at high confidence, as a separate decision.

## Research: alternative approaches to dynamic issuer-classification edge cases

Beyond the Jev proposal, the following approaches were reviewed for fixing
classification/routing edge cases (misroutes, unclassified issuers, subtype
collisions). Sources are linked inline.

### 1. Structural XBRL fingerprint (uses data we already fetch)

Classify by **which us-gaap concepts the filing actually presents**, not by
sector/industry strings. Banks present deposits and interest income; insurers
present premiums and unpaid-loss reserves; REITs present real-estate and
depreciation structures; E&P issuers present production/reserve schedules;
payment networks present settlement/receivable patterns; etc. Peer-reviewed
work shows industry sectors are predictable from financial-statement and XBRL
data ([Bank of Spain working paper](https://www.bde.es/f/webbe/SES/Secciones/Publicaciones/PublicacionesSeriadas/NotasEstadisticas/24/nest18.pdf),
[AAAI "Linking Industry Sectors and Financial Statements"](https://ojs.aaai.org/index.php/AAAI/article/view/33806/35961),
[Fundamental Analysis of Detailed Financial Data](https://www.stern.nyu.edu/sites/default/files/assets/documents/ChenChoDouLev2021WP.pdf)).

- **Pros:** zero new vendors; deterministic and auditable; every signal is a
  filed fact with an accession; naturally dynamic (new filings → new
  fingerprints); directly addresses the AMAT-class collision (a semiconductor
  equipment issuer has none of the production/reserve concepts an energy
  archetype requires).
- **Cons:** weak for multi-segment conglomerates; sparse tag sets can leave
  gaps; needs a curated concept→archetype map.
- **Fit:** strongest immediate complement to the rules. Could be implemented in
  `classify_company` without any external dependency, using the canonical
  payload already built.

### 2. Text-based network industry classification (Hoberg–Phillips TNIC)

Classify from the 10-K product-description text via pairwise cosine similarity
and clustering; the classifications update annually and track product-market
change better than SIC
([TNIC data](https://hobergphillips.tuck.dartmouth.edu/tnic_basedata.html),
[NBER paper](https://www.nber.org/system/files/working_papers/w15991/w15991.pdf)).

- **Pros:** excellent for **peer-universe quality** (which peers are actually
  comparable), robust to stale SIC labels; public research methodology.
- **Cons:** heavier infrastructure (10-K text corpus, vocabulary, clustering);
  outputs a network, not a crisp route label; the public dataset lags live
  filings.
- **Fit:** a longer-term investment for peer selection; overkill for v1 routing.

### 3. Fine-tuned few-shot local classifier (SetFit / FastFit)

Sentence-transformer backbone + logistic head trained from 8–16 examples per
label; outperformed GPT-3 on the RAFT benchmark while ~1600× smaller; runs on
CPU and exports to ONNX
([Hugging Face](https://huggingface.co/blog/setfit),
[paper summary](https://medium.com/data-science/sentence-transformer-fine-tuning-setfit-outperforms-gpt-3-on-few-shot-text-classification-while-d9a3788f0b4e)).

- **Pros:** local, cheap, deterministic at inference, no data egress; can be
  trained from the existing sweep fixture plus accumulated confirmations.
- **Cons:** needs a maintained labeled set; less capable zero-shot for brand-new
  archetypes; one more artifact to version.
- **Fit:** a strong phase-3 once the confirmation flow has produced enough
  labels; overlaps with Jev's role, so pick one as the long-term path.

### 4. Decision-model API (Jev / System One)

The base proposal above. Zero-shot, constrained output, fractions of a cent.

- **Pros/cons:** see earlier sections. Best treated as the interim advisory
  layer, not the permanent dependency.

### 5. Confidence-thresholded abstention + human-in-the-loop

Two thresholds instead of one cutoff: auto-accept high-confidence labels,
auto-reject very low confidence, and route the middle band to human review;
active learning spends labeling budget on uncertain cases
([AWS HITL](https://aws.amazon.com/what-is/human-in-the-loop/),
[dual-threshold framework](https://arxiv.org/html/2601.05974v3),
[HITL survey](https://link.springer.com/article/10.1007/s10462-022-10246-w)).

- **Pros:** maps directly onto the existing analyst-confirmation workflow;
  no forced label for genuinely ambiguous issuers; every decision is logged.
- **Cons:** needs a confidence signal (from rules margin, fingerprint match
  score, or Jev score) and a review surface.
- **Fit:** should accompany any classifier — including the current rules-only
  version. A cheap first step: expose `classification_confidence` and turn
  "unclassified" into a "confirm archetype" input instead of a hard block.

### 6. Taxonomy crosswalks and ensembles (SIC → NAICS/GICS/ICB)

Enrich the existing SIC/text signals with crosswalked industry codes and take
an ensemble vote.

- **Pros:** cheap; broad coverage; smooths single-source errors.
- **Cons:** SIC is exactly the stale, collision-prone source that caused the
  AMAT misroute; crosswalks inherit its errors. Useful only as one vote among
  several.

### 7. Error-driven rule mining + collision regression suite

Mine sweep outcomes and collision logs to propose new rule tokens/aliases, and
add a regression test that fails whenever a known issuer's industry string
collides with a wrong archetype token (the AMAT case).

- **Pros:** immediate, local, no vendor; directly prevents regressions.
- **Cons:** manual review of suggestions; does not solve genuinely new
  collisions.
- **Fit:** do this regardless of the Jev decision.

### Comparison

| Approach | Cost | Deterministic / auditable | New data needed | Failure mode | Effort |
| --- | --- | --- | --- | --- | --- |
| Rules + collision suite (today) | ~0 | Yes | None | New token collisions | Low |
| XBRL structural fingerprint | ~0 | Yes (filed facts) | Concept→archetype map | Multi-segment issuers | Low–Med |
| Jev advisory (this RFC) | <$0.01/issuer | Audit-logged; vendor black box | API access | Vendor outage/score noise | Med |
| SetFit local classifier | ~0 marginal | Yes (local model) | Labeled set (8–16/class) | New archetypes | Med |
| TNIC-style text peers | Low marginal | Reproducible | 10-K text corpus + clustering | Dataset lag | High |
| SIC/NAICS/GICS crosswalk ensemble | ~0 | Yes | Crosswalk tables | Inherits SIC staleness | Low |
| Dual-threshold abstention + HITL | ~0 | Yes | Confidence signal | Review burden if mis-tuned | Low–Med |

### Recommended layered plan (regardless of the Jev decision)

1. **Now:** XBRL structural fingerprint as *evidence* + collision regression
   suite; expose classification confidence.
2. **Next:** Jev advisory in shadow mode for ambiguous cases (this RFC).
3. **Then:** dual-threshold routing of the middle-confidence band into the
   existing analyst-confirmation flow.
4. **Later:** choose one long-term local path (SetFit trained on accumulated
   labels, or keep Jev) and consider TNIC-style similarity for peer universes.

## Non-goals

- No valuation inputs, forecasts, or numbers from the model.
- No bypassing of source-readiness gates, analyst confirmations, or fail-closed
  defaults.
- No replacement of the deterministic classifier — it remains the default and
  the fallback.
- No peer-universe changes in this RFC.

## Risks and mitigations

- **Third-party dependency/latency** → 1s timeout, rules fallback, cache.
- **Data egress** → only public profile fields in v1; financials never sent.
- **Black-box labels** → shadow-mode evaluation, thresholds, audit record.
- **Over-trust** → gates unchanged; a mislabel cannot admit unconfirmed data.

## Alternatives considered

1. **More rules/aliases** (current approach): keeps breaking on new industry
   strings; unbounded maintenance.
2. **Full generative LLM**: expensive, non-deterministic, and can hallucinate —
   wrong tool for a constrained routing decision.
3. **Embedding similarity to archetype descriptions**: no new vendor, but needs
   tuning and lacks a crisp decision output.
4. **Human-maintained issuer→route table**: accurate but does not scale to the
   long tail the coverage effort targets.

## Decision requested

1. Approve Jev as an **advisory** classifier layer (with shadow-mode evaluation
   before any routing effect)? Yes / no.
2. Default mode after evaluation: `shadow` only, `advisory` (log + apply on
   ambiguous cases), or auto-apply above a confidence threshold?
3. Integration: `langchain_typesafe` dependency vs a minimal HTTP client to the
   TypeSafe API? (Exact model id/version to pin.)
4. Data policy: acceptable to send public profile fields (ticker/name/sector/
   industry/SIC description) to the TypeSafe API?
5. Scope: classification only, or also gap-triage suggestions (e.g. "the
   missing line is probably tagged X") — the latter would be a separate RFC.
6. Approve the layered plan: XBRL structural fingerprint + collision regression
   suite now, Jev shadow next, dual-threshold abstention into the existing
   confirmation flow, then one long-term local path?
7. Long-term preference: keep the Jev dependency (cheap, zero-shot) or train a
   local SetFit-style classifier once the confirmation flow has produced
   enough labeled examples?
