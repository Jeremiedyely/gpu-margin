# GPU Gross Margin Visibility Application — Deep Memory

**Codename:** GPU Margin · GPU Gross Margin Visibility Application
**Status:** Phases 1–7 complete (2026-04-05) · Phase 8 (Azure deployment) planned · Local-only currently
**Repo:** `C:\Users\jerem\wbp\softtware-system-design\`
**Code root:** `phase_zero/`
**Doc root:** `softtware-system-design/` (28 .md files anchored at `business.md`)

---

## The 1-paragraph what

For the CFO of a GPU cloud producer (CoreWeave-class) serving AI model builders. Five upstream CSV files (Telemetry · Cost Management · IAM · Billing · ERP) ingest into a closed-grain web application that computes gross margin at `Region × GPU Pool × Day × Allocation Target` granularity, runs three system boundary reconciliations (Capacity vs Usage · Usage vs Tenant Mapping · Computed vs Billed vs Posted), and produces a CFO-approvable margin number with three export formats (CSV · Excel · Power BI) only after server-confirmed atomic approval. Idle capacity (`capacity_idle`) and identity failures (`identity_broken`) are first-class grain records — never blended into COGS as a remainder.

## Build history

| Phase | Components | Status | Date |
|-------|------------|--------|------|
| 0 — Infrastructure | Docker + Compose · SQL Server · Redis · Celery + Beat · 11 config params · 6 deployment prereqs | Complete | 2026-04-01 |
| 1 — Database Schema | 13 tables · 28 indexes · 51 CHECK constraints · 4 immutability triggers (THROW 51000–51003) · 6 filtered-unique indexes · 196 test assertions across 15 TEST_V*.sql | Complete | 2026-04-01 |
| 2 — Ingestion | 19 components (5 validators · 5 parsers · 5 writers · Orchestrator · Commit · Log Writer · State Emitter) · 186 assertions | Complete | 2026-04-03 |
| 3 — Allocation Engine | 11 components (Run Receiver · Telemetry Aggregator · Billing Period Deriver · Cost Rate Reader · IAM Resolver · Type A Builder · IB Builder · Closure Rule Enforcer · Cost & Revenue Calculator · Grain Writer · Completion Emitter) · 98 assertions | Complete | 2026-04-03 |
| 4 — Reconciliation Engine | 8 components (Run Receiver · Check 1 · Check 2 · AE Completion Listener · Check 3 · Result Aggregator · Result Writer · Completion Emitter) · 75 assertions | Complete | 2026-04-04 |
| 5 — State Machine | 12 components · 121 tests · 133 assertions · P1 #26 atomic write enforced | Complete | 2026-04-04 |
| P1 #32 | 7-step failed_tenant_id propagation chain integration test · 28 assertions | PASSED | 2026-04-04 |
| 6 — UI Screen | 14 components · 111 tests · 168+ assertions · 4-tier GM% bar (red/orange/yellow/green) | Complete | 2026-04-05 |
| 7 — Export Module | 9 components · 58 tests · 85+ assertions · EXPORT_COLUMN_ORDER shared constant · 6-check Output Verifier | Complete | 2026-04-05 |
| E2E Smoke Test | 12 steps · ~40 assertions · full CSV → Export pipeline proven | Passing | 2026-04-05 |
| 8 — Deployment (Azure) | 13 steps · Azure SQL DB + Container Apps + Entra ID + Key Vault + App Insights · 2–4 weeks · ~$400/month | Planned | — |

## Defects (all 13 verified)

| ID | Layer | RC | Title |
|----|-------|----|----|
| 001 | 5 — API | RC-2 | ImportError emit_ingestion_signal (dead import) |
| 002 | 5 — API | RC-8 | python-multipart missing for FastAPI UploadFile |
| 003 | 1 — Data | RC-6 | 34 state_machine tests fail in full suite (engine accumulation) |
| 004 | 6 — UI | RC-5 | White screen on null application_state in Screen Router |
| 005 | 4 — SM + 5 — API | RC-5 + RC-7 | EMPTY → UPLOADED transition rejected — no state_store row yet |
| 006 | 5 — API | RC-1 | Analyze endpoint connection auto-commit boundary violation |
| 007 | 6 — UI + 4 — SM | RC-4 + RC-9 | session_id lost on page reload + [object Object] error display |
| 008 | 3 — Pipeline | RC-2 + RC-3 | tasks.py wiring mismatches (.payload vs .records) + missing derive_billing_periods step |
| 009 | 0 — Infra | RC-6 | Flyway exits 1 — no CREATE DATABASE step (db_init container fix) |
| 010 | 2 — Aggregator | RC-7 | Customer Aggregator wrote IBT twice on duplicate analysis |
| 011 | 6 — UI | RC-5 | APPROVED state reached but Export buttons not visible |
| 012 | 5 — API | RC-3 | Export buttons clickable but /api/export returned 404 |
| 013 | 6 — UI + 4 — SM | RC-5 | After APPROVED + export, no New Session control |

## 10 Root Cause categories (from Problem-tracking.md)

| RC | Name |
|----|------|
| RC-1 | Transaction Boundary Violation |
| RC-2 | Wiring Mismatch (Attribute / Argument Name) |
| RC-3 | Missing Pipeline Step |
| RC-4 | State Assumption Violation |
| RC-5 | Implicit State Machine Gap |
| RC-6 | Cross-Module Resource Contamination |
| RC-7 | Silent Error Swallowing |
| RC-8 | Infrastructure Configuration Drift |
| RC-9 | Serialization / Type Boundary Crossing |
| RC-10 | Coupling Contract Violation |

## 5 Archetypes

1. The Silent Swallow
2. The Phantom State
3. The First-Time Failure
4. The Suite Poisoner
5. The Name Game

## Stack (running locally)

10 Docker Compose services + Vite frontend:
- `gpu_margin_db` (SQL Server 2022)
- `gpu_margin_db_init` (one-shot · creates database per DEFECT-009)
- `gpu_margin_flyway` (one-shot · V1–V16 migrations)
- `gpu_margin_redis` (broker + ACK with AOF)
- `gpu_margin_web` (FastAPI on :8000)
- `gpu_margin_celery_worker` (engine tasks)
- `gpu_margin_celery_beat` (scheduled retries · MUST be singleton)
- `gpu_margin_frontend` — not in compose · runs via `npm run dev` on :5173

## Code on disk

**233 code files** total:
- 172 Python (.py) — 87 app/ + 84 tests/ + 1 root
- 29 TypeScript (.ts/.tsx) — 20 .tsx + 9 .ts
- 32 SQL — 16 Flyway migrations + 1 init + 15 constraint tests

## Cross-module coupling contracts (5 K-contracts)

| Contract | Coupled Components | Risk if Violated |
|----------|-------------------|------------------|
| K1 — session_id (UUID) | All 6 modules · all 13 tables | Cross-session contamination |
| K2 — billing_period = LEFT(date,7) | AE Billing Period Deriver · AE IAM Resolver · RE Check 2 · RE Check 3 | Silent identity_broken population mismatch |
| K3 — failed_tenant_id | IB Builder → Calculator → Grain → IBT SET → Risk flag | Risk flag silently under-fires |
| K4 — unallocated_type (enum) | Type B Builders · CHK constraint · Output Verifier · UI pills | BI tools fail to categorize idle records |
| K5 — write_result (in State Store) | SM C9 (sole writer) · Export Gate Enforcer | Export pipeline permanently blocked after restart |

## 5 ADRs

| ADR | Decision |
|-----|----------|
| 01 | SM as sole lifecycle controller (no module advances state directly) |
| 02 | C9 sole-writer rule for `final.allocation_result` (THROW 51000 enforces) |
| 03 | Export Gate requires BOTH conditions (state=APPROVED AND write_result=SUCCESS) |
| 04 | AE completion fan-out is not atomic (each recipient deduplicates independently) |
| 05 | Grain is INSERT-only · UPDATE blocked (THROW 51003) · DELETE for Ingestion Commit session replacement only |

## 14 API interfaces (4 categories)

- CAT 1 — Lifecycle Control: 2 interfaces (Ingestion → SM · UI → SM)
- CAT 2 — Engine Orchestration: 4 interfaces (SM ↔ AE · SM ↔ RE · AE fan-out)
- CAT 3 — Data Production: 7 interfaces (UI → Ingestion · 5 AE/RE writes · SM C9 write · Export read)
- CAT 4 — Gate Enforcement: 1 interface (Export → SM Export Gate)

## 11 Configurable parameters (in `.env` · destined for Key Vault in Phase 8)

INGESTION_BATCH_THRESHOLD · AE_TIMEOUT · DISPATCH_ACK_TIMEOUT · DISPATCH_MAX_RETRIES · CLOSER_RETRY_INTERVAL · CLOSER_MAX_RETRIES · ANALYSIS_MAX_RETRIES · MAX_EXPORT_RERUNS · XLSX_GENERATION_TIMEOUT · MAX_HISTORY_SESSIONS · HISTORY_RETENTION_DAYS

## 6 Deployment prerequisites

1. Snapshot isolation on `raw.telemetry` (P1 #17)
2. Composite index on `raw.iam(tenant_id, billing_period)` (P1 #8)
3. 5 dedicated write connections per Raw Table Writer (P2 #2)
4. All 11 config parameters in deployment config (no hardcoding)
5. P1 #32 integration test passing in CI before deployment
6. RE timeout validated vs AE P95 + Check 3 P95 at peak volume

## Stabilization register (62 findings · 0 open · system stabilized)

19 P1 production blockers + 30 P2 reliability risks + 2 P3 improvements + 11 L1 Run 4 follow-ups — all applied via incremental L1×4 and L2×1 rounds in 2026-03-27.

## 5 Systemic patterns (from stabilization)

1. Summary Table Divergence — component fix + summary table row are one atomic change
2. Undeclared Consumers — every field written needs a declared consumer at write site
3. Two-Sided Boundary Mismatch — producer fix without consumer update = silent type violation
4. Prose-Only Enforcement — constraints in prose are not implementation contracts
5. Missing Scheduled Mechanisms — retry on "next request" fails in terminal states

## Documentation graph (28 files across 9 tiers)

| Tier | Files |
|------|-------|
| 0 — Public Entry | README.md |
| 1 — WHY | business.md |
| 2 — WHAT | requirements.md |
| 3 — HOW Orchestration | software-system-design.md (the hub) · references/tool-call-spec.md |
| 4 — HOW Modules | 6 module-design files |
| 5 — HOW Data + API | 7 files (architecture-diagram · database-architect · db-schema-design · solution-data-architecture-database · software-architect-api · solution-software-architect-api · full-surface-api) |
| 6 — BUILD | implementation-analysis · build-plan · build-protocol · build-checklist |
| 7 — Agents + Diagnostics | gpu-margin-engineer.prompt · cowork.prompt · Problem-tracking |
| 8 — References | stabilization-register · tools-stack |
| Manifest | 00-index.md |

STEP 7b protocol added 2026-05-28: every new save updates parent's `> See:` block + 00-index.md row before STEP 6 wait fires. Anti-Drift Rule 11 enforces.

## Phase 8 — Azure deployment plan (13 steps in build-plan.md lines 757–1036)

1. Resource group + budget alert
2. Azure Key Vault + migrate 11 parameters
3. Azure SQL Database + apply Flyway migrations
4. Azure Cache for Redis
5. Azure Container Registry + push image
6. Azure Container Apps + 3 services (web · worker · beat singleton)
7. Microsoft Entra ID + JWT validation (CFO role)
8. Domain + TLS
9. Application Insights + 4 alert rules
10. GitHub Actions deploy job (with smoke-test rollback)
11. SQL backup (PITR + LTR 7-year)
12. Security review + penetration test
13. Production runbook (`operations/production-runbook.md`)

Hard gates: 13. Auth checkpoint pending.
Estimated effort: 2–4 weeks. Estimated cost at low volume: $350–400/month.

## Sample test data

`phase_zero/test_data/` contains 5 CSVs with 7 tenants × 3 regions × 4 dates (per DEFECT-013 commit) — sufficient for E2E smoke test verification of all 4-tier GM% colors + identity_broken Risk flag + Closure Rule.
