---
role: documentation-manifest
created: 2026-05-28
revised: 2026-05-28 — added Tier 0 README · Tier 6 build-checklist · Tier 7 Problem-tracking
purpose: declares the complete documentation hierarchy for the GPU Gross Margin Visibility Application
read-order: README.md → business.md → requirements.md → software-system-design.md → module designs → references
update-trigger: software-system-design.md STEP 7b — fires on every save action · enforced by Anti-Drift Rule 11
---

# Documentation Index — GPU Gross Margin Visibility Application

> See: README.md — public-facing project entry · architecture overview · run instructions
> See: business.md — Tier 1 WHY · problem statement
> See: requirements.md — Tier 2 WHAT
> See: software-system-design.md — Tier 3 HOW (orchestration)

This file is the discovery entry point for the documentation graph. Every markdown file in the project is listed below with its tier, role, and current status. Updated on every STEP 7 save per `software-system-design.md` STEP 7b. Anti-Drift Rule 11 gates the wait state until this index is current.

---

## Tier 0 — PUBLIC ENTRY (Project README)

| File | Role | Status |
|------|------|--------|
| README.md | Public-facing project README · architecture diagram · run instructions · tech stack | Active |

---

## Tier 1 — WHY (Problem · Market · Purpose)

| File | Role | Status |
|------|------|--------|
| business.md | Problem definition · CFO impact · market validation · application purpose | Active |

---

## Tier 2 — WHAT (Specification)

| File | Role | Status |
|------|------|--------|
| requirements.md | Grain · computation contract · state machine · UI outputs · machine-readable specification | Active |

---

## Tier 3 — HOW (Orchestration)

| File | Role | Status |
|------|------|--------|
| software-system-design.md | Interaction protocol · governing principles · anti-drift rules · STEP 0–7b · application context | Active |
| references/tool-call-spec.md | AskUserQuestion + TodoWrite full JSON schemas · execution flow · PATH A/B task lists | Active |

---

## Tier 4 — HOW (Module Designs · 6 modules · 73 components total)

| File | Module | Components | Status |
|------|--------|------------|--------|
| ingestion-module-design.md | Ingestion | 19 | Active |
| allocation-engine-design.md | Allocation Engine | 11 | Active |
| reconciliation-engine-design.md | Reconciliation Engine | 8 | Active |
| state-machine-design.md | State Machine | 12 | Active |
| ui-screen-design.md | UI Screen | 14 | Active |
| export-module-design.md | Export | 9 | Active |

---

## Tier 5 — HOW (Data + API Architecture)

| File | Role | Status |
|------|------|--------|
| architecture-diagram.md | Mermaid flowchart · 9 subsystems · cross-module contract annotations | Active |
| database-architect.md | Grain-first design sequence · row anatomy · mapping behaviors · behavioral laws | Active |
| db-schema-design.md | 13 tables · 28 indexes · 51 CHECK constraints · 4 immutability triggers · session_id FK chain | Active |
| solution-data-architecture-database.md | Schema diagnostic agent · 8 schema laws · 5 diagnostic modes · Mermaid-to-schema check | Active |
| software-architect-api.md | API contract design partner · 4 contract types · per-interface request/response/error/guarantees | Active |
| solution-software-architect-api.md | Solution-layer API architect · 7 phases · ADR register · 4 interface categories | Active |
| full-surface-api.md | 14 interfaces fully specified · 5 ADRs · 11 constraints · K1–K5 contracts | Active |

---

## Tier 6 — BUILD (Implementation Governance · Active)

| File | Role | Status |
|------|------|--------|
| implementation-analysis.md | 8-phase priority order · tool stack per phase · collaboration model · 5 recommendations | Active |
| build-plan.md | End-to-end build plan · per-step tools/why/verify · 7-step integration test as Pre-Phase 6 CI gate · **Phase 8 — Deployment (Azure) added 2026-05-28** | Active |
| build-protocol.md | Step-by-step execution protocol · 6-phase loop (Read → Provide → Wait → Review → Approval → Record) | Active |
| build-checklist.md | Active build tracker · **Phases 0–7 + P1 #32 + E2E smoke test all complete** (last update 2026-04-05) · 196 test assertions at Phase 1 + ~600 total across all phases | Active · Build Complete |

---

## Tier 7 — AGENTS + DIAGNOSTICS (Operational Resources)

| File | Role | Status |
|------|------|--------|
| gpu-margin-engineer.prompt.md | Senior full-stack engineer · phase discipline · 5 coupling contracts · 6 critical failure modes | Active |
| cowork.prompt.md | MD diagnostic agent · 8 Cowork laws · 4 diagnostic modes · severity labels | Active |
| Problem-tracking.md | Diagnostic + debugging framework · 10 root causes · 5 archetypes · **13 registered defects (all verified)** | Active · In Use |

---

## Tier 8 — REFERENCES

| File | Role | Status |
|------|------|--------|
| references/stabilization-register.md | 62 findings applied · 0 open · L2 Production Stabilization · P1/P2/P3 finding IDs | Active |
| references/tools-stack.md | 71 diagnostic-informed tool decisions · 11 configurable parameters · 6 deployment prerequisites | Active |

---

## Total Inventory

| Tier | Count |
|------|-------|
| Tier 0 — Public Entry | 1 |
| Tier 1 — WHY | 1 |
| Tier 2 — WHAT | 1 |
| Tier 3 — HOW (Orchestration) | 2 |
| Tier 4 — HOW (Modules) | 6 |
| Tier 5 — HOW (Data + API) | 7 |
| Tier 6 — BUILD | 4 |
| Tier 7 — Agents + Diagnostics | 3 |
| Tier 8 — References | 2 |
| **Total** | **27** |

(00-index.md itself is the 28th file. It is not listed in any tier because it IS the manifest.)

---

## Current Build Status (from build-checklist.md + git log)

| Phase | Status | Date |
|-------|--------|------|
| Phase 0 — Infrastructure | Complete | 2026-04-01 |
| Phase 1 — Database Schema (16 Flyway migrations · 196 test assertions) | Complete | 2026-04-01 |
| Phase 2 — Ingestion Module (19 components · 186 assertions) | Complete | 2026-04-03 |
| Phase 3 — Allocation Engine (11 components · 98 assertions) | Complete | 2026-04-03 |
| Phase 4 — Reconciliation Engine (8 components · 75 assertions) | Complete | 2026-04-04 |
| Phase 5 — State Machine (12 components · 121 tests · 133 assertions) | Complete | 2026-04-04 |
| Pre-Phase 6 Gate — P1 #32 (7-step integration test · 28 assertions) | Passed | 2026-04-04 |
| Phase 6 — UI Screen (14 components · 111 tests · 168+ assertions) | Complete | 2026-04-05 |
| Phase 7 — Export Module (9 components · 58 tests · 85+ assertions) | Complete | 2026-04-05 |
| E2E Smoke Test (12 steps · ~40 assertions · full CSV→Export chain) | Passing | 2026-04-05 |
| CI/CD Gates (3 gates: P1 #32, config params, Flyway dry-run) | Workflow added · gates not all wired | — |
| **Phase 8 — Deployment (Azure)** (13 steps · Azure SQL + Container Apps + Entra ID + Key Vault + App Insights) | **Planned · not started** | — |

Defects tracked in `Problem-tracking.md` — **DEFECT-001 through DEFECT-013, all verified.**
Five additional defects (DEFECT-009 through DEFECT-013) fixed in commit ba2023d (2026-04-05).

**System status: All 73 components implemented and tested. End-to-end pipeline (CSV upload → 2 engines → State Machine → UI → CFO approval → 3-format export) verified by E2E smoke test. Local-only — no production deployment yet. Phase 8 deployment plan added to `build-plan.md` (target: Azure).**

## Future Tier 6 artifacts (placeholders — created when Phase 8 Step 8.13 fires)

| File | Role | Status |
|------|------|--------|
| operations/production-runbook.md | Deployment · rollback · incident response · DR · on-call · cost monitoring · CFO onboarding (Tier 6) | Planned · Phase 8 Step 8.13 |

---

## Update Protocol

Per `software-system-design.md` STEP 7b: every new design artifact saved by a STEP 7 action must be added as a row in the appropriate tier table above before STEP 6 wait fires. Anti-Drift Rule 11 enforces this gate. No session closes with an open graph.

When a new file is added:

1. Identify its tier from its frontmatter role.
2. Add one row to that tier's table with `File · Role · Status` populated.
3. Increment the Total Inventory count for that tier.
4. Update Tier 4 component count if the new file is a module design that changes the 73-component total.
5. Add a `> See:` link to the new file from `software-system-design.md` (the HOW-layer hub).

When a file is deprecated:

1. Change `Status` from `Active` to `Deprecated` — do not delete the row (audit trail).
2. Note the deprecation date in the row comment.

This protocol is the structural enforcement of the Order principle (1 Corinthians 14:40) at the documentation layer.
