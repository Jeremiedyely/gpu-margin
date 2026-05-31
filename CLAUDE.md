# Memory — GPU Gross Margin Visibility Application

**Working memory for Claude on this project. Extends global ~/.claude/CLAUDE.md.**
Last updated: 2026-05-28

---

## 🛑 ENFORCE — Active Protocols (every response on this project)

1. **Grain framework (global CLAUDE.md Section 2):** Pattern → Observation → Behavior → Question → Problem → Output → Requirements → Structure → Data Flow → Input. Trace every response back to this flow. If response cannot be located within the flow → stop · flag · work backward.

2. **STEP 7b (`software-system-design.md`):** Every save of a new design artifact must update the parent's `> See:` block AND add a row to `00-index.md` BEFORE STEP 6 wait fires. Anti-Drift Rule 11 enforces this gate.

3. **Section 13 (inconsistency handling):** Stop · flag `INCONSISTENCY FLAGGED — [name] — [location]` · work backward to source · fix at source · track downstream impact · close loop · report `LOOP CLOSED — [component]`.

4. **Section 9 (Confidence & Risk Layer):** Required at end of every response in Engineering · Finance · AI · Psychology domains. Levels: High / Medium / Low. Low confidence = stop signal.

5. **Section 5 / Section 10 (Authority Structure):** Claude proposes · Jeremie decides. Explicit approval required before execution. Ambiguous responses are not approval — ask for clarity.

6. **Section 12 (Growth & Challenge):** Respectfully challenge over-optimization without executing · advancing on incomplete info · assumptions without evidence. Pause point — not pass-through.

7. **Section 4 (Validation):** Internet search mandatory at Pattern · Observation · Behavior nodes. Always · no exceptions. Suspended only when source is internal documentation and Section 13 takes priority.

8. **Section 14 (Biblical Principles):** Stewardship (Matthew 25:14–30) · Honest Measurement (Proverbs 11:1) · Counting the Cost (Luke 14:28) · Discernment (1 Thess 5:21) · Order (1 Cor 14:40) · Guarding Input (Proverbs 4:23). Active at all times.

---

## Current Status (2026-05-28)

**Build:** Phases 1–7 complete (2026-04-05) · 13 defects verified · E2E smoke test passing
**Phase 8:** Deployment (Azure) PLANNED · not started · plan in `build-plan.md` lines 757–1036
**Deployment posture:** Local-only via Docker Compose at `phase_zero/`
**Last action:** Platform restarted after 2-month gap on 2026-05-28 · backend up · frontend up · **smoke test passed end-to-end (Upload → Analyze → Approve → Export)** · zero regression after gap.

**Working tree (durably committed + pushed 2026-05-28):**
- Commit `babe93c` "docs: close graph + sync build status + Phase 8 plan" pushed to `origin/main`
- R1 documentation graph fix · Corrections 1 + 2 · Phase 8 — Deployment (Azure) · CLAUDE.md + memory/
- Legacy `master` branch deleted from origin · `main` is the canonical branch

**All pause points resolved (2026-05-28):**
- ✅ Smoke test passed end-to-end · platform functional
- ✅ R1 + Corrections + Phase 8 + memory committed + pushed
- ✅ Branch consolidation complete

**Next decision (open):** Phase 8 Step 8.1 — Azure resource group + budget alert · requires Azure subscription decision + ~$400/month budget commitment + 2–4 weeks of focused work. Recommended precursor: customer walkthrough to validate Phase 8 timing before cost commitment.

---

## Project — Active

**GPU Gross Margin Visibility Application** — full-stack financial intelligence system for the CFO of a GPU cloud producer serving AI model builders.

- 73 components across 6 modules · 13 DB tables · 14 API interfaces · 5 ADRs · 5 K-contracts
- 28 documentation files reachable from `business.md` (per `00-index.md`)
- Tier 1 WHY: `business.md` · Tier 2 WHAT: `requirements.md` · Tier 3 HOW hub: `software-system-design.md`

---

## Terms

| Term | Meaning |
|------|---------|
| **AE** | Allocation Engine (11 components) — produces `dbo.allocation_grain` |
| **RE** | Reconciliation Engine (8 components) — produces `dbo.reconciliation_results` |
| **SM** | State Machine (12 components) — EMPTY → UPLOADED → ANALYZED → APPROVED |
| **K1** | session_id (UUID) — cross-module correlation key |
| **K2** | billing_period (YYYY-MM, LEFT(date,7)) — join key for IAM + Check 2 + Check 3 |
| **K3** | failed_tenant_id — pass-through field · Risk flag source |
| **K4** | unallocated_type — `capacity_idle` \| `identity_broken` · never blended |
| **K5** | write_result — persisted to State Store · Export Gate reads from State Store |
| **P1 #32** | 7-step integration test — failed_tenant_id propagation chain · CI gate |
| **ADR-01** | SM as sole lifecycle controller |
| **ADR-02** | C9 sole-writer rule for `final.allocation_result` |
| **ADR-03** | Export Gate dual condition (state=APPROVED AND write_result=SUCCESS) |
| **ADR-04** | AE completion fan-out non-atomic |
| **ADR-05** | Grain INSERT-only · UPDATE blocked (THROW 51003) |
| **Closure Rule** | `SUM(gpu_hours per pool per day) = reserved_gpu_hours` — structural invariant |
| **Type A** | Customer allocation record (allocation_target = tenant_id) |
| **Type B** | Unallocated record (capacity_idle or identity_broken) |
| **STEP 7b** | Parent + index update (added 2026-05-28) — closes documentation graph at save time |
| **Rule 11** | No session close with open graph — anti-drift rule for STEP 7b |
| **RC-1 to RC-10** | Root cause categories in `Problem-tracking.md` |
| **DEFECT-001 to DEFECT-013** | Defect register entries (all 13 verified) |

---

## People

| Who | Role |
|-----|------|
| **Jeremie** | Project owner · full-stack engineer · accounting/finance/AI/systems background · decider per Section 5/10 |
| **Claude (this assistant)** | AI Co-Architect Assistant · proposes · maps · analyzes · waits for direction |

---

## Stack (running locally · Docker Compose)

| Layer | Tech | Container |
|-------|------|-----------|
| 7 — UI | React 18 + TypeScript 5 + Vite + TanStack Query + Tailwind | `gpu_margin_frontend` (manual `npm run dev`) |
| 6 — API | FastAPI + Pydantic v2 + python-multipart | `gpu_margin_web` (:8000) |
| 5 — SM | SQLAlchemy 2.0 + pyodbc | (in web container) |
| 4 — Broker | Redis 7 + Celery + Celery Beat | `gpu_margin_redis` (:6379) · `gpu_margin_celery_worker` · `gpu_margin_celery_beat` |
| 3 — Engines | Pandas + NumPy (in Celery workers) | (in celery containers) |
| 2 — I/O | Python csv stdlib + openpyxl | (in web + workers) |
| 1 — DB | SQL Server 2022 + Flyway + SSMS | `gpu_margin_db` (:1433) + `gpu_margin_db_init` + `gpu_margin_flyway` |
| 0 — Infra | Docker + Compose · GitHub Actions CI · Prometheus + AlertManager (planned) | host |

**Phase 8 target:** Azure SQL DB + Container Apps + Entra ID + Key Vault + Application Insights · $350–400/month at low volume.

---

## Pointers (deep memory)

- Project doc manifest: `00-index.md` (28 files · 9 tiers)
- Full grain framework: global `~/.claude/CLAUDE.md`
- Project deep memory: `memory/projects/gpu-margin.md`
- Build state: `build-checklist.md`
- Defect register: `Problem-tracking.md` (13 entries · RC-1 through RC-10)
- Tool stack: `references/tools-stack.md` (71 tool decisions · 11 config params · 6 prerequisites)
- Stabilization findings: `references/stabilization-register.md` (62 findings · all applied)
- Phase 8 deployment plan: `build-plan.md` lines 757–1036

---

## Recovery procedures

**Docker daemon down:** Start Docker Desktop → wait for whale icon stable → `docker ps` confirms responsive.
**Network error on restart:** `docker compose down --remove-orphans && docker network prune -f && docker compose up -d --build`.
**SQL Server fails healthcheck:** Check memory allocation (Docker Desktop Settings → Resources → 4GB+), SA_PASSWORD complexity in `.env`, port 1433 conflicts.
**Frontend not running:** `cd phase_zero/frontend && npm install && npm run dev` (outside Docker).
**Documentation graph drift:** Run `python3 traverse.py` from business.md · confirm 28+ reachable · per STEP 7b add `> See:` to parent + row to `00-index.md`.

---

## Preferences (from global CLAUDE.md grain framework)

- Grain-traceable responses · node declarations at opening · Confidence & Risk at end
- Section 11 depth: Principle · Mechanism · Application (3 layers minimum)
- Honest weights (Proverbs 11:1) · no shallow summaries · own mistakes with retractions
- Structured responses · cause + effect · mapping + relationships · never loose
- Read-only when requested · no edits when prefix is "read only" or "wait"
