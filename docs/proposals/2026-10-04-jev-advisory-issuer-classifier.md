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
