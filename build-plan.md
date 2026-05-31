---
name: build-plan
role: implementation-plan
reads-from: gpu-margin-engineer/gpu-margin-engineer.prompt.md · implementation-analysis.md
session-context: end-to-end build plan — all 8 phases · tools per step · why per step · for Jeremie review and confirmation
created: 2026-03-29
---

# End-to-End Build Plan — GPU Gross Margin Visibility Application

> Derived from: gpu-margin-engineer.prompt.md · implementation-analysis.md · success/failure guarantee framework
> Protocol: Jeremie reviews and confirms each phase before it begins. No phase advances without explicit direction.

---

## How to Use This Plan

Each phase block contains:
- **Why this phase is in this position** — the dependency that makes the order non-negotiable
- **Steps** — the exact build sequence within the phase
- **Tools** — what is used for each step and why that tool
- **Verify** — the condition that must pass before this phase is considered complete
- **Success gate** — what Jeremie confirms before the next phase begins

No phase begins until the previous phase's Verify conditions all pass and Jeremie gives explicit direction to proceed.

---

## Phase 0 — Infrastructure

**Why first:** Six prerequisites exist that are not code. They are database and infrastructure configurations that application code runs against. If any are absent or wrong, failures are silent — wrong aggregations, engine timeouts, sessions never closing. No amount of correct code compensates for a missing index or wrong isolation level. These must be verified before a single line of Python is written.

---

### Step 0.1 — Provision SQL Server

**What:** Stand up SQL Server instance. Confirm connection from the application host.

**Tools:**
- `SQL Server` (+ SSMS for administration) — primary database for all 13 tables, constraints, and triggers. SQL Server is required (not PostgreSQL) because of snapshot isolation semantics and T-SQL migration tooling.
- `Docker + Compose` — run SQL Server in the local environment so the full stack runs in one place. No external dependency during build.

**Why this tool:** Docker Compose ensures the entire environment (FastAPI, Celery, Redis, SQL Server) is co-located. An engineer without Docker would need separate services running in parallel with no single start/stop command.

---

### Step 0.2 — Enable Snapshot Isolation on `raw.telemetry`

**What:** Run `ALTER DATABASE ... SET ALLOW_SNAPSHOT_ISOLATION ON` via Flyway migration or direct T-SQL.

**Tools:**
- `SQL Server` — snapshot isolation is a SQL Server-level database setting, not a table-level setting.
- `Flyway` — migration must be version-controlled. This is not a one-time manual command. It must be reproducible across dev, staging, and production.
- `SSMS` — confirm the setting is active via `sys.databases` query.

**Why this tool:** Snapshot isolation prevents dirty reads when the Allocation Engine and Reconciliation Engine read `raw.telemetry` concurrently. Without it, concurrent reads under READ COMMITTED isolation return wrong aggregations at production volume. The failure is silent — no error, just wrong numbers.

**Verify:** Run a concurrent read test against `raw.telemetry`. Confirm no dirty reads under concurrent write load.

---

### Step 0.3 — Create Composite Index on `raw.iam(tenant_id, billing_period)`

**What:** Run Flyway migration adding the composite index.

**Tools:**
- `Flyway` — versioned T-SQL migration. Must be reproducible.
- `SSMS Execution Plan viewer` — confirm the query against `raw.iam` shows an **index seek**, not a table scan.

**Why this tool:** Without the composite index, the IAM Resolver performs a full-table scan on every Allocation Engine run. At 100K+ IAM rows this becomes linear and pushes AE past `AE_TIMEOUT`. The SSMS execution plan is the only way to confirm the index is being used — not just that it exists.

**Verify:** Run EXPLAIN / execution plan on the IAM Resolver query against `raw.iam`. Confirm index seek.

---

### Step 0.4 — Provision Redis

**What:** Stand up Redis instance via Docker Compose.

**Tools:**
- `Redis` — Celery message broker + ACK contract enforcement. Powers all engine run signals, Dispatch ACK timeout, and the Analysis Dispatcher confirmation receipt.
- `Docker + Compose` — Redis container defined in the same Compose file as SQL Server and FastAPI.

**Why this tool:** Redis is the only mechanism for the Analysis Dispatcher to confirm signal receipt within `DISPATCH_ACK_TIMEOUT`. Without Redis, engines cannot receive run signals and the State Machine cannot confirm dispatch. There is no fallback.

**Verify:** Dispatch a test signal. Confirm receipt and ACK within `DISPATCH_ACK_TIMEOUT`.

---

### Step 0.5 — Configure Celery + Celery Beat

**What:** Configure Celery workers and Celery Beat scheduler via Docker Compose. Define the Beat schedule for the APPROVED Session Closer retry.

**Tools:**
- `Celery + Celery Beat` — async engine execution and scheduled retry. Beat is mandatory, not optional.
- `Docker + Compose` — Celery worker and Beat run as separate containers in the same Compose file.

**Why this tool:** Celery Beat is the only mechanism that closes a session to TERMINAL after APPROVED. After approval, no further UI requests arrive for that session. Only a Beat-triggered scheduled retry can close it. Without Beat, `session_status` is permanently stuck at ACTIVE after approval — a silent security gap that permits re-analysis of approved data.

**Verify:** Trigger a scheduled task in the dev environment. Confirm it fires on the configured interval.

---

### Step 0.6 — Set All 11 Configurable Parameters in Deployment Config

**What:** Populate all 11 parameters in the deployment config file. No hardcoded values anywhere.

**Tools:**
- Deployment config file (`.env` or equivalent) — all 11 parameters must live here, not in code.

**Parameters to set:**
```
INGESTION_BATCH_THRESHOLD    — use default from stabilization-register.md · update from staging P95
AE_TIMEOUT                   — use default · MUST be updated from staging P95 (2× P95 AE completion time)
DISPATCH_ACK_TIMEOUT
DISPATCH_MAX_RETRIES
CLOSER_RETRY_INTERVAL
CLOSER_MAX_RETRIES
ANALYSIS_MAX_RETRIES
MAX_EXPORT_RERUNS
XLSX_GENERATION_TIMEOUT
MAX_HISTORY_SESSIONS
HISTORY_RETENTION_DAYS
```

**Why this tool:** Hardcoded parameters are invisible to operators and cannot be adjusted without a code change. `AE_TIMEOUT` and `INGESTION_BATCH_THRESHOLD` specifically must be derived from staging P95 measurements — not assumed. An `AE_TIMEOUT` set too low terminates legitimate analysis runs and surfaces them as engine failures with no structural cause.

**Verify:** Confirm all 11 parameters present in deployment config. None missing. None hardcoded in application code.

---

**Phase 0 — Complete when:** All 5 Verify conditions pass. Not when infrastructure is "up." Jeremie reviews and authorizes Phase 1.

---

## Phase 1 — Database Schema (Flyway Migrations)

**Why second:** The schema is the structural guarantee. Check constraints enforce enum values at the database level. Immutability triggers prevent `final.allocation_result` from being overwritten after APPROVED. Filtered-unique indexes enforce the closure rule at the storage layer. Application code written before these constraints exist will establish patterns that assume enforcement is in code — where it is not. A silent violation today becomes undetectable without a migration and a full data re-run.

---

### Step 1.1 — Write and Apply Flyway Migrations for 13 Tables

**What:** Write T-SQL migrations for all 13 tables in grain-relationship order.

**Build order:**
```
ANCHORS first:    raw.ingestion_log
FEEDS second:     raw.telemetry · raw.cost_management · raw.iam · raw.billing · raw.erp
IS the grain:     allocation_grain · final.allocation_result
CHECKS:           reconciliation_results
CONTROLS:         state_store · state_history
CACHES:           kpi_cache · identity_broken_tenants
```

**Tools:**
- `Flyway` — versioned, numbered T-SQL migrations. Each table is its own migration file. `flyway validate` before every apply. `flyway migrate --dry-run` before production deploy.
- `SQL Server` — target database.
- `SSMS` — verify table structure, column types, and default values after each migration.

**Why this tool:** Flyway makes the schema reproducible and auditable. Any environment (dev, staging, production) can be rebuilt from scratch by replaying migrations in order. A hand-applied schema is unreproducible and unverifiable.

---

### Step 1.2 — Apply and Verify All 28 Indexes

**What:** Add all 28 indexes via Flyway migration. Run execution plan queries to confirm index seeks on the primary query patterns.

**Tools:**
- `Flyway` — indexes in the same migration as their parent table, or in a separate migration if added after initial table creation.
- `SSMS Execution Plan viewer` — confirm index seeks on the IAM Resolver query, Telemetry Aggregator query, and allocation_grain read patterns.

**Why this tool:** An index that exists but is not being used (query optimizer chooses a scan) is invisible as a bug. The execution plan is the only way to confirm the optimizer is using the index.

---

### Step 1.3 — Apply and Verify All 51 Check Constraints + 6 Filtered-Unique Indexes

**What:** Apply all 51 check constraints and 6 filtered-unique indexes via Flyway migration. Test each constraint directly via T-SQL insert attempts.

**Tools:**
- `Flyway` — constraints in migration files.
- `SQL Server` — direct T-SQL INSERT statements to confirm each constraint fires on violation.

**Why this tool:** Check constraints must be tested at the database layer before application code runs. Application code that is written before constraints are verified will assume the enforcement is elsewhere. The test: write a T-SQL INSERT that violates the constraint. Confirm SQL Server rejects it.

---

### Step 1.4 — Apply and Verify 4 Immutability Triggers on `final.allocation_result`

**What:** Apply triggers that prevent UPDATE and DELETE on `final.allocation_result`. Test that they fire.

**Tools:**
- `SQL Server` — trigger definition in T-SQL.
- `Flyway` — trigger in a migration file, not applied manually.

**Why this tool:** The immutability of approved records is enforced at the database level — not in application code. Once the CFO approves, the number is locked. A trigger that prevents UPDATE/DELETE cannot be bypassed by application code even if a bug exists. Test: attempt a direct T-SQL UPDATE on `final.allocation_result`. Confirm SQL Server raises the trigger error.

---

**Phase 1 — Complete when:** All constraints, indexes, and triggers verified via direct SQL tests. No application code has run against the schema yet. Jeremie reviews migrations and authorizes Phase 2.

---

## Phase 2 — Ingestion Module (19 Components)

**Why third:** `session_id` is the K1 cross-module correlation key generated exactly once — at the Ingestion Orchestrator. Every downstream component in all 6 modules uses it. Nothing in the system — no engine, no check, no export — can execute without a valid `session_id` anchored to a complete ingestion run. The atomic gate (all five files validated, parsed, written atomically or nothing advances) is the first structural control point in the entire system.

---

### Step 2.1 — Build 5 File Validators (Layer 1)

**What:** One validator per source file type: Telemetry, Cost Management, IAM, Billing, ERP.

**Tools:**
- `Python 3.11+` — validation logic.
- `Pydantic v2` — define input schemas with strict types, enum values, and format constraints. Pydantic raises structured errors with field names on violation — not generic exceptions.
- `pytest` — unit test each validator: valid input passes, each invalid condition (wrong date format, missing field, malformed tenant_id) raises a named error identifying the field.

**Why this tool:** Pydantic v2 validates at the type and constraint level before any parsing occurs. The Telemetry File Validator must enforce `tenant_id` format via regex (P1 #7). A malformed `tenant_id` that passes validation silently classifies as `identity_broken` in the Allocation Engine — not because the customer is missing from IAM, but because the ID was never valid. The CFO receives a false identity failure signal with no traceable root cause.

---

### Step 2.2 — Build 5 File Parsers (Layer 2)

**What:** One parser per source file type. Parse validated input into typed Pydantic models.

**Tools:**
- `Python csv stdlib` — ingestion parsing. No pandas at this layer — pandas is for grain computation, not raw file parsing.
- `Pydantic v2` — typed output models for each parsed record.
- `pytest` — test each parser with sample CSVs from `references/`.

**Why this tool:** Python csv stdlib is the correct tool for row-by-row parsing of structured CSVs. Pandas introduces unnecessary overhead at ingestion and its type inference can silently coerce values (e.g., `tenant_id` strings to integers). Pydantic models enforce the type contract between the parser and the writer.

---

### Step 2.3 — Build 5 Raw Table Writers (Layer 3)

**What:** One writer per raw table. Each writer uses a dedicated write connection.

**Tools:**
- `SQLAlchemy + pyodbc` — DB interactions. Dedicated write connection per writer. Atomic writes at the Ingestion Commit layer (Step 2.5), not at the individual writer level.
- `pytest` — test each writer: confirm the correct rows are written with the correct `session_id`.

**Why this tool:** A dedicated write connection per writer prevents connection contention during the atomic commit. SQLAlchemy manages the transaction boundary. pyodbc is the SQL Server driver.

---

### Step 2.4 — Build Ingestion Orchestrator (Layer 4)

**What:** Generate `session_id` (UUID). Register the session. Coordinate validators → parsers → writers.

**Tools:**
- `Python 3.11+` (`uuid` stdlib) — `session_id` generation.
- `FastAPI` — API endpoint receiving the 5 file upload request.
- `Pydantic v2` — session registration model.
- `pytest` — test that exactly one `session_id` is generated per upload request and propagated to all 5 writers.

**Why this tool:** FastAPI handles the multipart file upload. The Orchestrator is not a data processor — it is a coordinator. Its job is to generate the key and ensure every downstream layer receives it unchanged.

---

### Step 2.5 — Build Ingestion Commit (Layer 4b)

**What:** All-or-nothing promote of the 5 raw table writes in one DB transaction. ROLLBACK if any writer fails.

**Tools:**
- `SQLAlchemy` — DB transaction context manager wrapping all 5 writes.
- `SQL Server` — transaction ROLLBACK on failure.
- `pytest` — test: introduce a failure on writer 3. Confirm writers 1 and 2 are rolled back. Confirm nothing is written.

**Why this tool:** This is the first atomic gate in the system. SQLAlchemy's transaction context ensures ROLLBACK propagates to all 5 writers if any one fails. A manual rollback loop is not safe — it can leave partial data if the loop itself fails.

---

### Step 2.6 — Build Ingestion Log Writer (Layer 5) and State Transition Emitter (Layer 6)

**What:** Write one row to `raw.ingestion_log` confirming the committed session. Emit EMPTY → UPLOADED state transition to the State Machine.

**Tools:**
- `SQLAlchemy` — ingestion_log write.
- `FastAPI` — trigger the state transition endpoint.
- `pytest` — test: confirm `raw.ingestion_log` has exactly one entry per session. Confirm state transitions to UPLOADED.

**Why this tool:** The ingestion log is the audit record of the session. The State Transition Emitter is the signal that unlocks the Analyze button in the UI. Both must be part of the same committed session.

---

**Phase 2 — Verify:**
- Upload 5 valid CSVs → all 5 raw tables populated with matching `session_id` · `raw.ingestion_log` has one entry · state = UPLOADED
- Upload with 1 invalid file → nothing written · state stays EMPTY · named error identifies which validator failed and which field
- Jeremie reviews and authorizes Phase 3.

---

## Phase 3 — Allocation Engine (11 Components)

**Why fourth:** The grain cannot exist until session-tagged data exists in the raw tables. The Allocation Engine is the only producer of `allocation_grain`. Every downstream consumer — all 4 UI aggregators, all 3 reconciliation checks, all 3 export generators — reads from this table. A wrong record here propagates to every surface with no recovery path.

---

### Step 3.1 — Build Run Receiver (Component 0)

**What:** Receive and validate `run_signal`. Extract `session_id`. Reject invalid signals with a named error.

**Tools:**
- `FastAPI` — signal endpoint.
- `Pydantic v2` — typed `run_signal` model.
- `pytest` — test valid signal accepted, invalid signal rejected with named error.

---

### Step 3.2 — Build Telemetry Aggregator (Component 1) + Billing Period Deriver (Component 2) + Cost Rate Reader (Component 3, parallel)

**What:**
- Telemetry Aggregator: GROUP BY `Region × GPU Pool × Day` on `raw.telemetry` under snapshot isolation.
- Billing Period Deriver: derive `billing_period` using the **shared constant** `LEFT(date, 7)`.
- Cost Rate Reader: parallel track — reads `raw.cost_management`, runs simultaneously with Components 1 and 2.

**Tools:**
- `SQLAlchemy + pyodbc` — snapshot isolation reads on `raw.telemetry`. Must set `TRANSACTION ISOLATION LEVEL SNAPSHOT` explicitly on the read connection.
- `Pandas + NumPy` — aggregation across grain dimensions.
- `Python constant module` — `billing_period` derivation defined once, imported by all 4 coupled components. **Never copy this logic.**
- `pytest` — test aggregation output matches expected grain structure from `references/` sample CSVs.

**Why shared constant:** Contract 1. If `Billing Period Deriver` and `Check 2 Executor` (RE) derive `billing_period` independently, they will agree today and diverge after any future change. The divergence produces silent wrong verdicts — Check 2 and IAM Resolver disagree on which tenants are `identity_broken`.

---

### Step 3.3 — Build IAM Resolver (Component 4)

**What:** LEFT JOIN `raw.telemetry` against `raw.iam` on `tenant_id + billing_period`. Unmatched tenants produce `identity_broken` records.

**Tools:**
- `SQLAlchemy` — LEFT JOIN query using the composite index on `raw.iam(tenant_id, billing_period)`.
- `Python constant module` — import the shared `billing_period` constant.
- `pytest` — test: a tenant_id present in telemetry but absent from IAM produces an `identity_broken` row with `failed_tenant_id` populated.

---

### Step 3.4 — Build Type A Record Builder (Component 5), Identity Broken Record Builder (Component 6), Closure Rule Enforcer (Component 7)

**What:**
- Type A: build allocation_grain rows for matched tenants.
- Identity Broken: build `identity_broken` rows. `failed_tenant_id` = original `tenant_id`. Must not be evaluated or modified.
- Closure Rule Enforcer: force `capacity_idle` row when `reserved_gpu_hours - SUM(usage_gpu_hours) > 0`. This row is never optional.

**Tools:**
- `Python 3.11+` + `Pandas` — record construction and closure rule calculation.
- `pytest` — test: closure rule holds for all pools and days. `identity_broken` rows carry `failed_tenant_id` = original `tenant_id`. `capacity_idle` rows have `failed_tenant_id = NULL`.

**Why:** The closure rule is the structural invariant of the entire system. `SUM(gpu_hours per pool per day) = reserved_gpu_hours`. If the Closure Rule Enforcer does not force the `capacity_idle` row, idle capacity disappears from the grain and the system produces an accounting gap invisible to the CFO.

---

### Step 3.5 — Build Cost & Revenue Calculator (Component 8)

**What:** Compute `gross_margin` for all record types. Type B (unallocated) gross_margin is always negative, never zero. Pass `failed_tenant_id` unchanged — do not evaluate, do not modify.

**Tools:**
- `Pandas + NumPy` — computation.
- `pytest` — test: all Type B gross_margin values are negative. `failed_tenant_id` pass-through verified (P2 #14).

**Why:** If `failed_tenant_id` is dropped or nullified here, the Customer Data Aggregator cannot build the `identity_broken` SET. The Risk flag in Zone 2R never fires. The CFO approves without the identity integrity signal.

---

### Step 3.6 — Build Allocation Grain Writer (Component 9)

**What:** Write all grain rows to `allocation_grain` in a single DB transaction. ROLLBACK on failure — never DELETE.

**Tools:**
- `SQLAlchemy` — DB transaction context manager. One transaction. All rows or none.
- `SQL Server` — transaction ROLLBACK on write failure.
- `pytest` — test: simulate a write failure mid-batch. Confirm ALL rows are rolled back. Confirm no partial rows remain in `allocation_grain`.

**Why DB transaction ROLLBACK:** A DELETE-based rollback that fails mid-loop leaves partial rows. Check 3 reads those partial rows and produces spurious FAIL-1 verdicts for missing tenants. No system error is raised. The wrong verdict reaches the CFO (P1 #12).

---

### Step 3.7 — Build Completion Emitter (Component 10)

**What:** Emit a completion signal to both the State Machine (Engine Completion Collector) and the Reconciliation Engine (AE Completion Listener). Signal includes `session_id` and success/fail status.

**Tools:**
- `Celery` — async signal dispatch via Redis.
- `Redis` — message broker.
- `pytest` — test: confirm signal received by both consumers within `DISPATCH_ACK_TIMEOUT`.

**Why:** Contract 3 (Completion Emitter ACK). Both consumers must receive the signal. If the Reconciliation Engine does not receive it, Check 3 cannot gate correctly. If the State Machine does not receive it, it cannot advance to ANALYZED.

---

**Phase 3 — Verify:**
- `SUM(gpu_hours per pool per day) = reserved_gpu_hours` for all pools and days (closure rule)
- `identity_broken` rows carry `failed_tenant_id` = original `tenant_id`
- `capacity_idle` rows have `failed_tenant_id = NULL`
- All Type B gross_margin values are negative, never zero
- Jeremie reviews and authorizes Phase 4.

---

## Phase 4 — Reconciliation Engine (8 Components)

**Why fifth:** Checks 1 and 2 can run in parallel with the AE at runtime, but in implementation they depend on the grain structure being correct to write meaningful tests against Check 3. Build and validate Phase 3 first. Use the real `allocation_grain` output as the test input for Check 3.

---

### Step 4.1 — Build Run Receiver (Component 0) + Check 1 Executor (Component 1) + Check 2 Executor (Component 2)

**What:**
- Run Receiver: same pattern as AE — receive `run_signal`, extract `session_id`.
- Check 1 (Capacity vs Usage): read `raw.telemetry` under snapshot isolation. Compare reserved vs used.
- Check 2 (Usage vs Tenant Mapping): read `raw.iam`. Identify tenants in telemetry with no IAM match. Use the **shared `billing_period` constant** — same import as AE.

**Tools:**
- `FastAPI + Pydantic v2` — signal endpoint.
- `SQLAlchemy + pyodbc` — snapshot isolation reads on `raw.telemetry`.
- `Python constant module` — import shared `billing_period` constant (Contract 1).
- `pytest` — test each check independently with known input.

**Why shared constant:** Check 2 and IAM Resolver must agree on which tenants are `identity_broken`. If `billing_period` is derived differently, they produce different sets. The verdicts are wrong and silent.

---

### Step 4.2 — Build AE Completion Listener (Component 3)

**What:** Wait for the AE Completion signal. ACK within `ACK_TIMEOUT`. Gate Check 3 on AE SUCCESS.

**Tools:**
- `Celery` — consume the AE Completion signal from the Redis queue.
- `pytest` — test: simulate AE SUCCESS signal → Check 3 gates open. Simulate AE FAIL signal → Check 3 blocked.

---

### Step 4.3 — Build Check 3 Executor (Component 4)

**What:** Computed vs Billed vs Posted — gated on AE SUCCESS. Filter: `WHERE allocation_target ≠ 'unallocated'` (Contract Boundary P1 #18). Use shared `billing_period` constant.

**Tools:**
- `SQLAlchemy` — query `allocation_grain` with the CONTRACT BOUNDARY filter.
- `Python constant module` — import shared `billing_period` constant.
- `pytest` — **critical test:** run with the filter applied → confirm PASS. **Remove the filter** → confirm spurious FAIL-1 verdicts appear for idle and identity_broken rows. **Restore the filter** → confirm PASS. This test validates the most dangerous prose-only constraint in the design.

**Why this test:** The `WHERE allocation_target ≠ 'unallocated'` filter is the boundary condition that prevents Check 3 from flagging idle and identity_broken rows as billing discrepancies. It is not enforced by the schema — it is enforced by the query. Testing its removal is the only way to confirm it is load-bearing.

---

### Step 4.4 — Build Result Aggregator (Component 5), Result Writer (Component 6), Completion Emitter (Component 7)

**What:**
- Result Aggregator: wait for all three checks. Track `t_ae_complete`. Apply dynamic timeout.
- Result Writer: write 3 rows to `reconciliation_results` atomically — all or none.
- Completion Emitter: signal the State Machine that RE is complete.

**Tools:**
- `SQLAlchemy` — atomic 3-row write.
- `Celery` — completion signal to State Machine.
- `pytest` — test: confirm all 3 rows written together. Simulate a single check failure → confirm the other results are not partially written.

---

**Phase 4 — Verify:**
- Check 3 `WHERE allocation_target ≠ 'unallocated'` CONTRACT BOUNDARY present
- Remove filter → spurious FAIL-1 appears · restore → PASS confirmed
- Check 2 uses the same `billing_period` derivation as IAM Resolver — tested explicitly
- Jeremie reviews and authorizes Phase 5.

---

## Phase 5 — State Machine (12 Components)

**Why sixth:** The State Machine controls when every engine runs, when the CFO can approve, and when export is unlocked. All server-side gates live here. It depends on both engines being complete and stable — which requires Phases 3 and 4 to be fully verified.

---

### Step 5.1 — Build State Store (Component 1) + state_history writes (foundation)

**What:** Implement the `state_store` schema and writes. Every state change writes a record to `state_history`.

**Tools:**
- `SQLAlchemy` — state_store and state_history writes.
- `pytest` — test: every transition writes one state_history row. Confirm schema fields match spec exactly.

---

### Step 5.2 — Build Transition Request Receiver (Component 2)

**What:** Receive transition requests from all sources (Ingestion, UI Analyze, Approval Dialog). Enforce idempotency — return `ALREADY_COMPLETE` if transition is already in the target state (P3 #28).

**Tools:**
- `FastAPI + Pydantic v2` — typed `transition_request` endpoint.
- `pytest` — test: duplicate transition → `ALREADY_COMPLETE` returned. State unchanged.

---

### Step 5.3 — Build Transition Validator (Component 3)

**What:** Apply the three-rule valid transition table. Return `VALID` or `INVALID` with reason.

**Valid transitions:**
```
EMPTY    + "EMPTY→UPLOADED"    + source=INGESTION       → VALID
UPLOADED + "UPLOADED→ANALYZED" + source=UI_ANALYZE       → VALID
ANALYZED + "ANALYZED→APPROVED" + source=APPROVAL_DIALOG  → VALID
APPROVED + any transition                                  → INVALID (terminal)
ANY other combination                                      → INVALID
```

**Tools:**
- `Python 3.11+` — rule table implementation.
- `pytest` — test every valid and invalid combination from the table. Test that APPROVED state rejects all transitions.

**Why:** Without validation, illegal transitions (EMPTY → APPROVED) can reach the Approved Result Writer directly. The Transition Validator is the gate that makes all other state transitions safe.

---

### Step 5.4 — Build Executors: EMPTY→UPLOADED (Component 4), Analysis Dispatcher (Component 5), Engine Completion Collector (Component 6), UPLOADED→ANALYZED (Component 7), ANALYZED→APPROVED (Component 8)

**What:**
- EMPTY→UPLOADED: fired by Ingestion after commit.
- Analysis Dispatcher: send `run_signal` to both engines. Enforce ACK contract — confirm receipt within `DISPATCH_ACK_TIMEOUT`.
- Engine Completion Collector: wait for both AE and RE signals. Handle 4 arrival scenarios. Track `retry_count`.
- UPLOADED→ANALYZED: advance state after both engines signal SUCCESS.
- ANALYZED→APPROVED: advance state after CFO approval.

**Tools:**
- `Celery` — async `run_signal` dispatch and ACK enforcement.
- `Redis` — message broker for all signals.
- `SQLAlchemy` — state_store writes.
- `pytest` — test each executor in isolation. Test all 4 Engine Completion Collector arrival scenarios.

---

### Step 5.5 — Build Approved Result Writer (Component 9)

**What:** Write `application_state = APPROVED` **and** `write_result = SUCCESS/FAIL` in **one atomic transaction**. This is the single most critical implementation detail in Phase 5.

**Tools:**
- `SQLAlchemy` — one transaction context wrapping both writes. No separation.
- `SQL Server` — transaction ROLLBACK if either write fails.
- `pytest` — **crash simulation test:** restart the process immediately after writing `application_state = APPROVED` but before writing `write_result`. Confirm `write_result = NULL` in the database. Confirm Export Gate returns `GATE_BLOCKED_WRITE_NULL`.

**Why one transaction:** If split into two transactions and the process crashes between them, the system reaches `application_state = APPROVED` with `write_result = NULL`. The Export Gate Enforcer catches this — but only if its NULL check fires before the `≠ SUCCESS` check (P1 #27). The real fix is preventing the window from existing (P1 #26).

---

### Step 5.6 — Build Invalid Transition Rejection Handler (Component 10)

**What:** Named failure path for INVALID_TRANSITION (from Transition Validator) and ENGINE_FAILURE (from Engine Completion Collector). Surface the rejection to the UI with type and message. Do not modify State Store.

**Tools:**
- `FastAPI` — rejection response endpoint.
- `pytest` — test: INVALID_TRANSITION → rejection_type = INVALID_TRANSITION, state unchanged. ENGINE_FAILURE → rejection_type = ENGINE_FAILURE, state remains UPLOADED, Analyze button returns to ACTIVE.

---

### Step 5.7 — Build Export Gate Enforcer (Component 11) and APPROVED Session Closer (Component 12)

**What:**
- Export Gate Enforcer: dual-condition gate — `application_state = APPROVED` **AND** `write_result = SUCCESS`. NULL check must come **before** `≠ SUCCESS` check (P1 #27).
- APPROVED Session Closer: Celery Beat scheduled retry that sets `session_status = TERMINAL` after APPROVED.

**Tools:**
- `SQLAlchemy` — read `state_store` for gate evaluation.
- `Celery Beat` — scheduled retry for Session Closer. Requires Beat configured in Phase 0.
- `pytest` — test gate: `APPROVED + SUCCESS` → OPEN. `APPROVED + NULL` → `GATE_BLOCKED_WRITE_NULL`. `APPROVED + FAIL` → `GATE_BLOCKED_WRITE_FAIL`. `NOT APPROVED` → GATE_BLOCKED_STATE.

---

**Phase 5 — Verify:**
- Crash simulation: kill process after `application_state = APPROVED`, before `write_result`. Confirm Export Gate returns `GATE_BLOCKED_WRITE_NULL` — not OPEN.
- Jeremie reviews and authorizes the 7-Step Integration Test (P1 #32).

---

## Pre-Phase 6 Gate — 7-Step Integration Test (P1 #32)

**This test must pass before Phase 6 begins. It is a CI gate — not a dev test.**

**What:** Verify the `failed_tenant_id` propagation chain across 5 components and 2 modules end to end.

```
Step 1: Ingest 5 source files — include one tenant_id with no IAM match
Step 2: Run Allocation Engine — confirm identity_broken row written for that tenant
Step 3: Confirm failed_tenant_id = original tenant_id in allocation_grain
Step 4: Confirm Cost & Revenue Calculator passes failed_tenant_id unchanged
Step 5: Run Reconciliation Engine — confirm Check 2 FAIL for that tenant
Step 6: Confirm Customer Data Aggregator includes tenant in identity_broken SET
Step 7: Confirm Zone 2R Risk flag = FLAG for that customer in UI render
```

**Tools:**
- `pytest` — integration test suite spanning AE, RE, and UI data aggregators.
- `GitHub Actions` — CI gate. This test must be in the pipeline before Phase 6 is authorized.

**If any step fails:** identify which component dropped `failed_tenant_id`. Fix. Re-run. Confirm PASS before proceeding.

**Why this gate:** If the test is deferred until after Phase 6 is built, a failure requires reworking components already integrated into a larger render surface. The test is designed to run in isolation precisely because it is cheaper to fix a `failed_tenant_id` drop before the UI render chain is in place.

---

## Phase 6 — UI Screen (14 Components)

**Why seventh:** The UI is a surface. It reads from what the engines and State Machine have already produced. Building the UI before the data layer is complete produces components that cannot be validated against real data. Every button state, every KPI value, and every Zone 2 table depends on server-confirmed `application_state` and live `allocation_grain`.

---

### Step 6.1 — Build Screen Router (Component 1)

**What:** Select the active view based on `application_state`. EMPTY/UPLOADED → View 1. ANALYZED/APPROVED → View 2.

**Tools:**
- `React + TypeScript` — typed enum for `application_state`. No string comparisons.
- `TanStack Query` — fetch `application_state` from server on every render. Never from local state.
- `Vitest` — test: each application_state value routes to the correct view.

---

### Step 6.2 — Build View 1 Footer Control Manager (Component 2) and View 1 Renderer (Component 3)

**What:**
- Footer Control Manager: upload slots, Analyze button gate. Button states from server, not local state (server-state render invariant).
- View 1 Renderer: file upload slots, session reset.

**Tools:**
- `React + TypeScript` + `TanStack Query` — server-state render invariant. Every button state reflects the server's current `application_state` on every render.
- `Vitest` — test: Analyze button is ACTIVE only when state = UPLOADED. LOCKED at all other states.
- `Tailwind CSS` — layout.

**Why TanStack Query:** The server-state render invariant is the enforcement mechanism for all state-gated UI controls. Local state can become stale. TanStack Query refetches on every render and after every mutation. A button that reads from local state can show ACTIVE when the server is APPROVED — enabling a re-upload that should be blocked.

---

### Step 6.3 — Build 4 Data Aggregators (Components 4, 5, 6, 10)

**What:**
- KPI Data Aggregator (Component 4): pre-computed at ANALYZED time (P2 #30). Reads `allocation_grain` → aggregated KPI values.
- Customer Data Aggregator (Component 5): pre-builds `identity_broken` SET at ANALYZED time (P2 #31). Reads `failed_tenant_id` from `allocation_grain`.
- Region Data Aggregator (Component 6): regional gross margin aggregation.
- Reconciliation Result Reader (Component 10): reads `reconciliation_results`.

**Tools:**
- `SQLAlchemy` — reads from `allocation_grain`, `reconciliation_results`.
- `Pandas` — KPI pre-computation and aggregation.
- `pytest` — test each aggregator against the sample CSVs in `references/`.

---

### Step 6.4 — Build Zone Renderers (Components 7, 8, 9, 11)

**What:**
- Zone 1 KPI Renderer (Component 7): render pre-computed KPI cards.
- Zone 2L Region Renderer (Component 8): HOLDING / AT RISK with subtype pills.
- Zone 2R Customer Renderer (Component 9): **4-tier GM% bar** — red (negative) / orange (0–15%) / yellow (15–25%) / green (25%+). Risk flag for identity_broken tenants.
- Zone 3 Reconciliation Renderer (Component 11): PASS/FAIL only. No drill-down.

**Tools:**
- `React + TypeScript` — typed props for all zone data.
- `Tailwind CSS` — 4-tier GM% color system. Red must visually distinguish negative margin from low positive margin.
- `Vitest` — test: negative margin renders red. 15% margin renders orange. Risk flag fires for identity_broken tenants.

**Why the color validation matters:** The 4-tier bar is a CFO decision signal. If negative margin (losing money) renders the same color as low positive margin, the approval decision is made on wrong visual information.

---

### Step 6.5 — Build Analysis View Container (Component 12), View 2 Footer Control Manager (Component 13), Approve Confirmation Dialog (Component 14)

**What:**
- Analysis View Container: holds Zones 1–3 and the View 2 footer.
- View 2 Footer Control Manager: Approve button gated on `application_state = ANALYZED`. Server-state render invariant.
- Approve Confirmation Dialog: confirmation message includes `session_id` (P3 #35). Sends `ANALYZED→APPROVED` transition request on confirm.

**Tools:**
- `React + TypeScript` + `TanStack Query` — Approve button from server state.
- `Vitest` — test: Approve button ACTIVE only when state = ANALYZED. Confirmation dialog shows correct `session_id`.

---

**Phase 6 — Verify:**
- `identity_broken` tenant → Risk flag fires in Zone 2R
- Negative margin → red bar · not orange
- Approve button locked when state ≠ ANALYZED
- Jeremie reviews and authorizes Phase 7.

---

## Phase 7 — Export Module (9 Components)

**Why last:** Export reads from `final.allocation_result` — the immutable approved table. It cannot be tested meaningfully until the State Machine has been through a full ANALYZED → APPROVED transition and `final.allocation_result` has been written. The Output Verifier is the final quality gate before the CFO receives the file.

---

### Step 7.1 — Build APPROVED State Gate (Component 1) and Export Source Reader (Component 2)

**What:**
- APPROVED State Gate: query Export Gate Enforcer server-side. Dual condition: `state = APPROVED AND write_result = SUCCESS`. No file read proceeds without this gate returning OPEN.
- Export Source Reader: read ALL rows from `final.allocation_result` for the approved session. No other table. No join with other sessions.

**Tools:**
- `SQLAlchemy` — gate query and `final.allocation_result` read.
- `pytest` — test: gate returns OPEN only when both conditions met. Attempt export from ANALYZED state → gate blocks.

---

### Step 7.2 — Build Session Metadata Appender (Component 3) and Format Router (Component 4)

**What:**
- Metadata Appender: resolve `source_files` from `raw.ingestion_log` for the session. Append `session_id` and `source_files` as the last two columns.
- Format Router: dispatch to exactly one generator per request (CSV, Excel, or Power BI). Never two simultaneously.

**Tools:**
- `SQLAlchemy` — read `raw.ingestion_log`.
- `Python 3.11+` — routing logic.
- `pytest` — test: confirm `session_id` and `source_files` appear as last two columns in all output formats.

---

### Step 7.3 — Build 3 Generators (Components 5, 6, 7)

**What:**
- CSV Generator (Component 5): write CSV using `EXPORT_COLUMN_ORDER` **shared constant**.
- Excel Generator (Component 6): generate .xlsx using openpyxl + xlsx skill. Apply `XLSX_GENERATION_TIMEOUT`. Use **same shared constant**.
- Power BI Generator (Component 7): write pipe-delimited file. `source_files` pipe-delimited. Use **same shared constant**.

**Tools:**
- `Python csv stdlib` — CSV generation.
- `openpyxl` — Excel generation via xlsx skill.
- `Python constant module` — `EXPORT_COLUMN_ORDER` defined once, imported by all 4 coupled components (3 generators + Output Verifier Check 3). **Never copy the column list.**

**Why shared constant:** Contract 5. A column added to `final.allocation_result` that is added to only one generator creates silent schema divergence in BI tools. No error is raised. One format is correct; others are wrong.

---

### Step 7.4 — Build Output Verifier (Component 8) and File Delivery Handler (Component 9)

**What:**
- Output Verifier: 6 checks — file existence · row count matches source · grain columns present · subtypes correct · file is readable · metadata format matches.
- File Delivery Handler: return `computer://` link for the generated file. Atomic filepath handoff.

**Tools:**
- `Python 3.11+` — 6 verification checks.
- `Python constant module` — Output Verifier Check 3 imports `EXPORT_COLUMN_ORDER` from the same shared constant.
- `pytest` — test each of the 6 Output Verifier checks individually. Confirm a missing column fails check 3.

---

**Phase 7 — Verify:**
- All three formats read from `final.allocation_result` only
- `session_id` and `source_files` present as last two columns in all formats
- Output Verifier 6 checks pass for all three generated files
- Export gate blocks request from ANALYZED state — only APPROVED passes
- Jeremie reviews. System is complete.

---

## Phase 8 — Deployment (Azure)

**Why this is last:** All Phases 0–7 produce a structurally complete, locally-tested application. Going live is not a continuation of the build — it is a separate engineering discipline focused on infrastructure provisioning, secrets management, identity, observability, and operational readiness. Doing it before the application is structurally complete wastes work on a moving target. Doing it after is the correct order.

**Cloud target:** Microsoft Azure. Rationale: SQL Server 2022 → Azure SQL Database is the lowest-friction managed migration (T-SQL compatibility preserved · snapshot isolation native · same Flyway migrations). Azure Container Apps runs Docker images natively without Kubernetes overhead. Microsoft Entra ID is purpose-built for the CFO/finance user persona.

**Mode change:** Prior phases ran locally with `docker compose up`. Phase 8 provisions cloud resources that incur cost. Every step has a teardown command at the bottom — use it if any verification fails so cost does not accumulate during diagnosis.

---

### Step 8.1 — Resource group + budget alert

**What:** Create resource group `rg-gpu-margin-prod` in East US 2 (or closest region). Set monthly budget at $400 with email alert at 80%.

**Tools:**
- `Azure CLI` (`az`) — login + provisioning
- Azure Portal — budget alert configuration

**Why this tool:** All subsequent steps script against `az`. Provisioning via portal alone is not reproducible across staging and production.

**Verify 8.1** `[ ]` `az group show -n rg-gpu-margin-prod` returns the group · budget alert email confirmed

---

### Step 8.2 — Azure Key Vault + migrate the 11 parameters

**What:** Create `kv-gpu-margin-prod`. For each of the 11 configurable parameters (from `references/stabilization-register.md`), set a secret in the vault. Add the production SA_PASSWORD as a 12th secret. Update `app/config.py` to read from Key Vault via `azure-keyvault-secrets` SDK when `ENV=production`.

**Parameters to migrate:**
INGESTION_BATCH_THRESHOLD · AE_TIMEOUT · DISPATCH_ACK_TIMEOUT · DISPATCH_MAX_RETRIES · CLOSER_RETRY_INTERVAL · CLOSER_MAX_RETRIES · ANALYSIS_MAX_RETRIES · MAX_EXPORT_RERUNS · XLSX_GENERATION_TIMEOUT · MAX_HISTORY_SESSIONS · HISTORY_RETENTION_DAYS

**Tools:**
- `Azure Key Vault` — managed secrets store
- `Azure CLI` — `az keyvault secret set`
- `azure-keyvault-secrets` Python SDK — application-side read

**Why this tool:** `.env` files cannot be committed and cannot be rotated. Key Vault provides versioned secrets with RBAC and audit logs. The application reads at boot; rotation requires container restart, not redeploy.

**Verify 8.2** `[ ]` `az keyvault secret list --vault-name kv-gpu-margin-prod` returns 12 secrets · staging boot reads all 12 via SDK

---

### Step 8.3 — Azure SQL Database + apply Flyway migrations

**What:** Create `sql-gpu-margin-prod` server. Create `gpu_margin` database (General Purpose 2 vCore tier sufficient at low volume). Configure firewall to allow Container Apps subnet only. Run V1–V16 Flyway migrations against it.

**Tools:**
- `Azure SQL Database` — managed SQL Server (T-SQL compatible · snapshot isolation native)
- `Flyway` — same migrations as Phase 1 · no application code changes
- `Azure CLI` — `az sql server create` + `az sql db create`
- `SSMS` — connect over a temporary public endpoint to verify schema

**Why this tool:** Azure SQL Database is T-SQL compatible with SQL Server 2022 (already verified in Phase 1). Snapshot isolation (P1 #17) is available natively. Composite index on raw.iam (P1 #8) is the same DDL. No application code changes required to migrate.

**Verify 8.3** `[ ]` `az sql db show` returns the database · Flyway log shows V1–V16 applied · SSMS confirms 13 tables present

---

### Step 8.4 — Azure Cache for Redis

**What:** Create `redis-gpu-margin-prod` (Basic tier C0 at low volume; Standard for zone redundancy at higher volume). Enable AOF persistence. Capture the connection string into Key Vault as `REDIS_CONNECTION_STRING`.

**Tools:**
- `Azure Cache for Redis` — managed Redis with AOF (per `tools-stack.md` Layer 5 requirement)
- `Azure CLI` — `az redis create`
- `Azure Key Vault` — connection string storage

**Why this tool:** Celery broker + ACK contract enforcement require a Redis instance reachable by all worker containers. AOF persistence ensures Celery Beat scheduled retries (CLOSER_RETRY_INTERVAL) survive cache restarts — without AOF, a Redis restart drops the scheduled APPROVED Session Closer retry queue and sessions could remain non-TERMINAL indefinitely.

**Verify 8.4** `[ ]` `az redis show` returns Running · `redis-cli -h <host> -p 6380 --tls ping` returns PONG

---

### Step 8.5 — Azure Container Registry + push image

**What:** Create `acrgpumarginprod` (Basic tier sufficient at single region; Premium for geo-replication). Push the `gpu_margin_app` image. Tag with git SHA for traceability.

**Tools:**
- `Azure Container Registry` (ACR) — image registry
- `Docker` — same `Dockerfile` from `phase_zero/`
- `GitHub Actions` deploy job — automates build + push (Step 8.10)

**Why this tool:** ACR is the natural registry for Container Apps. Image tags by git SHA prevent `latest`-tag drift between deployments. A revert to a prior SHA is one `az containerapp update` command away.

**Verify 8.5** `[ ]` `az acr repository show-tags -n acrgpumarginprod --repository gpu_margin_app` shows the pushed SHA tag

---

### Step 8.6 — Azure Container Apps environment + deploy services

**What:** Create Container Apps environment `cae-gpu-margin-prod` in a VNet. Deploy 3 container apps:
- `web` (FastAPI + uvicorn) · 1 replica min · 5 max · scale on HTTP request count
- `celery_worker` (Allocation + Reconciliation engines) · 2 replica min · 10 max · scale on Redis queue length
- `celery_beat` (scheduled tasks) · **1 replica fixed (not autoscaled)** — Beat must be singleton

Wire each app to read secrets from Key Vault, connect to Azure SQL DB via Managed Identity, connect to Azure Cache for Redis via private endpoint.

**Tools:**
- `Azure Container Apps` (ACA) — serverless container runtime
- `Managed Identity` — passwordless DB connection (no SA_PASSWORD in env at runtime)
- `Azure CLI` — `az containerapp create` per service
- `Azure Monitor` — autoscale metric source

**Why this tool:** Container Apps runs Docker images without Kubernetes overhead. Managed Identity replaces the SA_PASSWORD path with Entra ID authentication to SQL DB — the password in Key Vault becomes the fallback, not the primary. **Celery Beat as a singleton fixed replica is critical:** multiple Beat instances would fire the APPROVED Session Closer retry multiple times per session, producing duplicate TERMINAL writes (Phase 5 specifically guards against this via P3 #28 idempotency, but a singleton Beat avoids the issue at infrastructure level).

**Verify 8.6** `[ ]` `az containerapp list` shows 3 apps Running · `curl https://web-gpu-margin-prod.azurecontainerapps.io/health` returns the health JSON · backend logs show DB connection via Managed Identity

---

### Step 8.7 — Microsoft Entra ID + JWT validation

**What:** Register `gpu-margin-app` in Entra ID. Create app role `CFO`. Issue Entra ID tokens to authorized CFO users. Add `azure-identity` + `python-jose` to FastAPI dependency chain. Every endpoint except `/health` requires a valid JWT with `CFO` role.

**Tools:**
- `Microsoft Entra ID` (formerly Azure AD) — enterprise identity provider
- `python-jose` — JWT validation in FastAPI
- `azure-identity` — token acquisition for service-to-service calls
- FastAPI dependency injection — `Depends(verify_cfo_token)` on every route except `/health`

**Why this tool:** The application stores GPU billing data — financial-grade. Open API endpoints are not acceptable for go-live. Entra ID is the natural choice for the CFO persona (most finance users are already in their company's Entra tenant). Role-based access (`CFO` role) prevents unauthorized users from triggering Analyze or Approve. JWT validation is stateless — no auth-session DB lookups in the hot path.

**Verify 8.7** `[ ]` Unauthenticated `/api/upload` returns 401 · valid CFO token returns 200 · valid token missing CFO role returns 403

---

### Step 8.8 — Domain + TLS

**What:** Acquire domain (e.g., `gpu-margin.example.com`). Add Container Apps custom domain. Issue managed TLS certificate. Update Entra ID app registration redirect URI to the custom domain.

**Tools:**
- `Azure DNS` (or Cloudflare in front) — DNS authority
- Container Apps managed certificates — free TLS via Let's Encrypt · auto-renews
- `nslookup` / `dig` — DNS propagation tools

**Why this tool:** TLS is non-negotiable for an authenticated application handling financial data. Managed certificates auto-renew — no operator action required at certificate expiry. Cloudflare in front adds DDoS protection at minimal cost.

**Verify 8.8** `[ ]` `curl https://gpu-margin.example.com/health` returns 200 with valid TLS · SSL Labs scan returns A or A+

---

### Step 8.9 — Application Insights + alert rules

**What:** Provision Application Insights workspace. Add instrumentation to FastAPI and Celery via `opencensus-ext-azure` auto-instrumentation. Configure 4 alert rules.

**Alert rules:**
- AE_TIMEOUT breach → P1 alert
- CLOSER_MAX_RETRIES exhausted → CRITICAL alert (per `tools-stack.md`)
- Export Gate BLOCKED_WRITE_NULL → CRITICAL (signals P1 #26 crash window detected)
- MAX_EXPORT_RERUNS exhausted → P2 alert

**Tools:**
- `Application Insights` — Azure-native APM
- `opencensus-ext-azure` — Python SDK for automatic trace + metric collection
- `Azure Monitor` — alert rule engine + action groups
- Email + SMS action groups for CRITICAL alerts

**Why this tool:** `tools-stack.md` Layer 5 specifies Prometheus + AlertManager as observability — Application Insights is the Azure-native equivalent and integrates with Container Apps without sidecars. The 4 alert rules match what was documented as "required alert channels."

**Verify 8.9** `[ ]` Live Metrics shows traces from production traffic within 60 seconds · forced AE_TIMEOUT scenario in staging fires the P1 alert

---

### Step 8.10 — GitHub Actions deploy job

**What:** Extend the existing CI workflow (per commit `8522615`) with a `deploy` job that runs on push to `main` after CI gates pass:
1. Build image from current SHA
2. Push to ACR with tag `<sha>` and `latest`
3. Update Container Apps revision via `az containerapp update`
4. Run E2E smoke test against the new revision URL
5. If smoke test passes → promote to production · if fails → automatic rollback to prior revision

**Tools:**
- `GitHub Actions` — existing workflow
- `azure/docker-login` action — ACR authentication
- `azure/login` action — Azure CLI authentication via federated credentials (OIDC)
- `azure/container-apps-deploy-action` — revision management

**Why this tool:** Manual deployment is error-prone. The CI workflow already runs the full regression suite — extending it with a deploy job means every successful CI run produces a deployable artifact. Automatic rollback on smoke test failure prevents a bad deploy from reaching CFO users. OIDC federated credentials remove the need to store Azure secrets in GitHub.

**Verify 8.10** `[ ]` Trivial commit to main → CI passes → deploy job runs → smoke test passes → new revision active · revision history shows the new revision

---

### Step 8.11 — SQL backup + retention policy

**What:** Enable Point-in-Time Restore (PITR) on Azure SQL Database — 7 days minimum, 35 days recommended. Enable Long-Term Retention (LTR) for monthly backups held for 7 years. Confirm `final.allocation_result` is included in LTR (it is — LTR is full-database).

**Tools:**
- Azure SQL Database PITR — automatic, no action required beyond enabling
- Azure SQL Database LTR policy — `az sql db ltr-policy set`
- Compliance evidence: backup retention proves the immutability invariant of `final.allocation_result` survives infrastructure loss

**Why this tool:** Immutability inside the application (THROW 51000 prevents UPDATE/DELETE) does not protect against infrastructure loss. LTR with 7-year retention matches typical financial audit requirements (SOX retention is 7 years).

**Verify 8.11** `[ ]` `az sql db ltr-policy show` returns the configured policy · restore an LTR backup to a staging database and verify schema + approved rows recover correctly

---

### Step 8.12 — Security review + penetration test

**What:** Engage a third-party security firm for a focused penetration test BEFORE any external user is granted access. Scope: authentication bypass · SQL injection via the 5 ingestion CSVs · JWT replay · Container Apps escape · SQL DB privilege escalation. Remediate every High and Critical finding. Document acceptances for Medium findings.

**Tools:**
- Third-party penetration test firm
- `Microsoft Defender for Cloud` — continuous posture assessment
- `bandit` (Python) + `npm audit` (frontend) — automated code-level scans in CI

**Why this tool:** The application handles CFO-grade financial data. Self-attestation is not sufficient. A penetration test is the structural control that distinguishes "we think it's secure" from "an adversary actively tried and could not break it." Defender for Cloud catches drift between tests.

**Verify 8.12** `[ ]` Pentest report received · zero High/Critical open · all Medium findings have a documented acceptance signed by Jeremie · Defender Secure Score ≥ 80%

---

### Step 8.13 — Production runbook

**What:** Create `operations/production-runbook.md` (new Tier 6 BUILD artifact · per `00-index.md` STEP 7b). Cover:
- Deployment procedure (manual override of automatic deploy)
- Rollback procedure (revert Container Apps revision)
- Incident response for each of the 4 Application Insights alerts
- Disaster recovery procedure (LTR restore + Container Apps redeploy)
- On-call rotation handoff
- Cost monitoring procedure
- CFO user onboarding (Entra ID role assignment)

**Tools:**
- Markdown editor
- `00-index.md` → STEP 7b update required after this file is created
- `software-system-design.md` → add `> See:` block per STEP 7b

**Why this tool:** A runbook is the difference between an outage that lasts 15 minutes and one that lasts 8 hours. Operational knowledge cannot live in one person's head if the application is going to serve real users.

**Verify 8.13** `[ ]` Runbook reviewed and signed off by Jeremie · drill at least one documented procedure (manual rollback) and confirm correct outcome

---

### Phase 8 — Hard Gates

| # | Gate | Verify |
|---|------|--------|
| 8.1 | Resource group + budget alert active | `az group show` + budget email received |
| 8.2 | All 12 secrets in Key Vault | `az keyvault secret list` returns 12 |
| 8.3 | SQL DB has 13 tables + V1–V16 applied | Flyway log + SSMS query |
| 8.4 | Redis responding to PING | `redis-cli ping` returns PONG |
| 8.5 | Image in ACR tagged by git SHA | `az acr repository show-tags` |
| 8.6 | 3 Container Apps Running + healthy | `/health` returns 200 over HTTPS |
| 8.7 | Auth enforced on every protected route | 401 without token · 200 with CFO role · 403 without role |
| 8.8 | Custom domain + valid TLS | SSL Labs A or A+ |
| 8.9 | Application Insights showing traffic | Live Metrics + AE_TIMEOUT alert test fired |
| 8.10 | GitHub Actions deploys automatically | Trivial commit → new revision active |
| 8.11 | PITR + LTR enabled | `az sql db ltr-policy show` |
| 8.12 | Penetration test passed | Report on file · 0 High/Critical open |
| 8.13 | Production runbook complete + drilled | Reviewed + manual-rollback drill passes |

> **⛔ JEREMIE AUTHORIZATION REQUIRED** — All 13 gates pass before the first CFO user is granted access.

`[ ]` **Jeremie authorizes production go-live**

---

### Phase 8 — Effort + cost estimate

**Effort (single experienced engineer):** 2–4 weeks for the 13 steps. Steps 8.6 (Container Apps + Managed Identity) and 8.7 (Entra ID + JWT) are the longest individual steps at 3–5 days each.

**Cloud cost at low volume (per month):**
- Azure SQL Database General Purpose 2 vCore: ~$300
- Azure Cache for Redis Basic C0: ~$15
- Azure Container Apps (Consumption, low traffic): ~$30
- Azure Container Registry Basic: ~$5
- Azure Key Vault Standard: ~$1
- Application Insights (first 5 GB free): $0–50
- Azure DNS: ~$1
- **Total: $350–400/month at low volume.** Scales with concurrent CFO users and analysis frequency.

**Teardown procedure (if any verification fails):**
```
az group delete -n rg-gpu-margin-prod --yes --no-wait
```
This removes every resource provisioned in Steps 8.1–8.11 in a single command. Run this immediately if cost is accumulating during diagnosis.


## CI/CD — GitHub Actions Gates

These gates must be active before any phase is deployed beyond the local environment:

```
Gate 1: P1 #32 (7-step integration test) — must pass on every push
Gate 2: All 11 config parameters present in deployment config — fail build if any missing or hardcoded
Gate 3: Flyway dry-run — migrations applied cleanly against a clean DB before every deploy
```

**Tools:**
- `GitHub Actions` — pipeline definition.
- `pytest` — P1 #32 in the CI test suite.
- `Flyway` — dry-run validation step in the pipeline.

---

## Build Order — Summary

```
PHASE 0   Infrastructure        Verify: 5 conditions (isolation · index · Beat · Redis · config)
PHASE 1   Database Schema       Verify: SQL constraint tests before any application code
PHASE 2   Ingestion Module      Verify: atomic commit · session_id · state UPLOADED
PHASE 3   Allocation Engine     Verify: closure rule · identity_broken · Type B margin
PHASE 4   Reconciliation Engine Verify: Check 3 filter test · billing_period coupling
PHASE 5   State Machine         Verify: crash simulation → GATE_BLOCKED_WRITE_NULL
          ↓
          7-Step Integration Test (P1 #32) — MUST PASS before Phase 6
          ↓
PHASE 6   UI Screen             Verify: Risk flag · red margin · Approve gate
PHASE 7   Export Module         Verify: 3 formats · column order · gate blocks non-APPROVED
          ↓
          System is complete locally (Phases 1–7 complete · 2026-04-05)
          ↓
PHASE 8   Deployment (Azure)    Verify: 13 hard gates · pentest passes · runbook drilled
          Target: Azure SQL DB + Container Apps + Entra ID + Key Vault + App Insights
          Estimated: 2–4 weeks · $350–400/month at low volume
```

**Each phase has one clear output. Each output has a defined test. No phase advances without Jeremie's direction. The grain is the anchor at every step.**

---

*Created: 2026-03-29*
*Derived from: gpu-margin-engineer.prompt.md · implementation-analysis.md · success/failure guarantee framework*
*Awaiting: Jeremie review and confirmation before Phase 0 begins*
