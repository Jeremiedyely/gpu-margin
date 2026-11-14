/**
 * View 1 Renderer — Component 3/14 (Import View).
 *
 * Renders five upload slots + [Analyze] control.
 * Includes View 1 Footer Control Manager logic (Component 2/14).
 *
 * Footer control logic:
 *   EMPTY                              → LOCKED
 *   UPLOADED + analysis_status = IDLE  → ACTIVE
 *   UPLOADED + analysis_status = ANALYZING → ANALYZING (locked + label)
 *   else                               → LOCKED
 *
 * Upload screen (enterprise layout):
 *   - drop zone accepts all 5 CSVs at once, matched to slots by file name
 *   - each slot shows required columns, file name, size, row count,
 *     header check result, and Replace / Remove
 *   - header check runs in the browser before upload (server stays authority)
 *   - issues table lists every problem as File · Row · Column · Problem
 *   - footer shows "N of 5 files ready" and why actions are disabled
 */

import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AnalysisStatus, AnalyzeControl } from "@/types/api";
import { AppHeader } from "./AppHeader";
import { ProgressStepper } from "./ProgressStepper";
import {
  SLOT_DEFS,
  SLOT_KEYS,
  type SlotKey,
  type FileCheck,
  matchSlot,
  checkFileText,
  readFileText,
  formatBytes,
  splitServerError,
} from "@/lib/uploadSlots";

interface View1Props {
  applicationState: "EMPTY" | "UPLOADED";
  analysisStatus: AnalysisStatus;
  sessionId: string | null;
}

const SLOT_LABELS = SLOT_DEFS.map((d) => d.label);

type SlotMap<T> = Record<SlotKey, T>;

function emptySlots<T>(value: T): SlotMap<T> {
  return {
    telemetry: value,
    cost_management: value,
    iam: value,
    billing: value,
    erp: value,
  };
}

interface Issue {
  file: string;
  row: string;
  column: string;
  problem: string;
}

function deriveAnalyzeControl(
  appState: "EMPTY" | "UPLOADED",
  analysisStatus: AnalysisStatus
): AnalyzeControl {
  if (appState === "EMPTY") return "LOCKED";
  if (appState === "UPLOADED" && analysisStatus === "IDLE") return "ACTIVE";
  if (appState === "UPLOADED" && analysisStatus === "ANALYZING")
    return "ANALYZING";
  return "LOCKED";
}

/** Extract a readable message (and error list, if any) from an API error body. */
function readError(body: any, status: number, verb: string): { message: string; list: string[] } {
  const detail = body?.detail;
  if (typeof detail === "string") return { message: detail, list: [detail] };
  if (detail?.errors && Array.isArray(detail.errors)) {
    return { message: detail.errors.join("; "), list: detail.errors.map(String) };
  }
  if (detail) {
    const s = JSON.stringify(detail);
    return { message: s, list: [s] };
  }
  const s = `${verb} failed: ${status}`;
  return { message: s, list: [s] };
}

export function View1Renderer({
  applicationState,
  analysisStatus,
  sessionId: serverSessionId,
}: View1Props) {
  const queryClient = useQueryClient();
  const analyzeControl = deriveAnalyzeControl(applicationState, analysisStatus);
  const isFilled = applicationState === "UPLOADED";
  const isAnalyzing = analyzeControl === "ANALYZING";

  const [files, setFiles] = useState<SlotMap<File | null>>(emptySlots(null));
  const [checks, setChecks] = useState<SlotMap<FileCheck | null>>(emptySlots(null));
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const sessionId = serverSessionId ?? localSessionId;
  const fileInputRefs = useRef<Partial<Record<SlotKey, HTMLInputElement | null>>>({});
  const bulkInputRef = useRef<HTMLInputElement | null>(null);

  // ── File handling ─────────────────────────────────────────────

  const assignFile = (slot: SlotKey, file: File | null) => {
    setFiles((prev) => ({ ...prev, [slot]: file }));
    setChecks((prev) => ({ ...prev, [slot]: null }));
    setUploadError(null);
    setServerErrors([]);
    if (!file) return;
    const required = SLOT_DEFS.find((d) => d.key === slot)!.columns;
    readFileText(file)
      .then((text) => {
        const result = checkFileText(text, required);
        setChecks((prev) => ({ ...prev, [slot]: result }));
      })
      .catch(() => {
        setChecks((prev) => ({
          ...prev,
          [slot]: { status: "unreadable", header: [], missing: [...required], rows: 0 },
        }));
      });
  };

  const assignMany = (list: FileList | File[]) => {
    const notMatched: string[] = [];
    for (const file of Array.from(list)) {
      const slot = matchSlot(file.name);
      if (slot) assignFile(slot, file);
      else notMatched.push(file.name);
    }
    setUnmatched(notMatched);
  };

  const clearAll = () => {
    setFiles(emptySlots(null));
    setChecks(emptySlots(null));
    setUnmatched([]);
    setUploadError(null);
    setServerErrors([]);
  };

  // ── Derived state ─────────────────────────────────────────────

  const slotReady = (key: SlotKey) => files[key] !== null && checks[key]?.status === "ok";
  const readyCount = isFilled ? 5 : SLOT_KEYS.filter(slotReady).length;
  const allFilesSelected = SLOT_KEYS.every(slotReady);
  const checking = SLOT_KEYS.some((k) => files[k] !== null && checks[k] === null);

  const issues: Issue[] = [];
  if (!isFilled) {
    for (const def of SLOT_DEFS) {
      const c = checks[def.key];
      const f = files[def.key];
      if (!f || !c) continue;
      if (c.status === "unreadable") {
        issues.push({ file: f.name, row: "Header", column: "—", problem: "File is empty or has no header row." });
      }
      if (c.status === "missing") {
        for (const col of c.missing) {
          issues.push({
            file: f.name,
            row: "Header",
            column: col,
            problem: `Required column not found. Found: ${c.header.join(", ") || "none"}.`,
          });
        }
      }
    }
    for (const name of unmatched) {
      issues.push({ file: name, row: "—", column: "—", problem: "File name doesn't match a slot. Use Choose file on the right slot." });
    }
    for (const msg of serverErrors) {
      const { file, problem } = splitServerError(msg);
      issues.push({ file, row: "—", column: "—", problem });
    }
  }

  const missingCount = SLOT_KEYS.filter((k) => files[k] === null).length;
  let reason: string;
  if (isFilled) {
    reason = analyzeControl === "ACTIVE" ? "Files received and stored unchanged. Run the analysis when ready." : "Files received.";
  } else if (checking) {
    reason = "Checking file headers…";
  } else if (issues.length > 0) {
    reason = "Fix the flagged files before upload.";
  } else if (missingCount > 0) {
    reason = `Add ${missingCount} more file${missingCount === 1 ? "" : "s"} to continue.`;
  } else {
    reason = "All files passed the header check.";
  }

  // ── API calls ─────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!allFilesSelected) return;
    setUploading(true);
    setUploadError(null);
    setServerErrors([]);

    try {
      const formData = new FormData();
      for (const key of SLOT_KEYS) {
        formData.append(key, files[key]!);
      }

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const { message, list } = readError(body, res.status, "Upload");
        setServerErrors(list);
        throw new Error(message);
      }

      const data = await res.json();
      setLocalSessionId(data.session_id);
      queryClient.invalidateQueries({ queryKey: ["appState"] });
    } catch (err: any) {
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = async () => {
    if (analyzeControl !== "ACTIVE") return;

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(readError(body, res.status, "Analyze").message);
      }

      queryClient.invalidateQueries({ queryKey: ["appState"] });
    } catch (err: any) {
      setUploadError(err.message || "Analysis dispatch failed");
    }
  };

  const currentStep = isAnalyzing ? 2 : isFilled ? 2 : 1;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader sessionId={isFilled ? sessionId : undefined} />

      <div className="max-w-6xl mx-auto px-6 md:px-10 py-7">
        <ProgressStepper currentStep={currentStep as 1 | 2} />

        {/* Analyzing state */}
        {isAnalyzing ? (
          <div className="bg-white rounded-2xl shadow-md border border-slate-100 max-w-xl mx-auto overflow-hidden">
            <div className="p-10 text-center">
              <div className="gpu-spinner mx-auto mb-5" />
              <div className="text-lg font-semibold text-slate-800 mb-1">
                Analysis in Progress
              </div>
              <div className="text-sm text-slate-500 mb-6">
                Running Allocation Engine &amp; Reconciliation Engine
              </div>
              <div className="mb-6">
                <span className="gpu-pulse-dot" />
                <span className="gpu-pulse-dot" />
                <span className="gpu-pulse-dot" />
              </div>
              <button
                className="px-6 py-2.5 rounded-xl font-semibold text-white text-sm bg-slate-300 cursor-not-allowed"
                disabled
                data-testid="analyze-button"
                data-control={analyzeControl}
              >
                Analysis in progress...
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-1">
                {isFilled ? "Files received" : "Upload source files"}
              </h2>
              <p className="text-sm text-slate-600">
                Five system extracts for one billing period. Each file is checked before upload;
                source data is stored as received and never modified.
              </p>
            </div>

            <div className="flex flex-wrap gap-6 items-start">
              {/* Main card */}
              <section
                aria-label="Source files"
                className="flex-[999_1_560px] min-w-0 bg-white rounded-xl border border-slate-200 overflow-hidden"
              >
                {/* Drop zone */}
                {!isFilled && (
                  <div
                    className={`m-6 rounded-xl border-2 border-dashed p-7 text-center transition-colors ${
                      dragOver ? "border-blue-500 bg-blue-100/60" : "border-blue-300 bg-blue-50"
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      assignMany(e.dataTransfer.files);
                    }}
                    data-testid="drop-zone"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24" strokeWidth="1.6" stroke="#2563eb" className="mx-auto mb-2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                    </svg>
                    <div className="text-base font-semibold text-slate-900">
                      Drag all 5 CSV files here, or{" "}
                      <button
                        type="button"
                        className="text-blue-700 underline hover:text-blue-900"
                        onClick={() => bulkInputRef.current?.click()}
                      >
                        browse
                      </button>
                    </div>
                    <div className="text-sm text-slate-600 mt-1">
                      Files are matched to slots by name — {SLOT_DEFS.map((d) => d.fileName).join(", ")}
                    </div>
                    <input
                      ref={bulkInputRef}
                      type="file"
                      accept=".csv"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) assignMany(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>
                )}

                {/* File slots */}
                <div className={isFilled ? "" : "border-t border-slate-200"}>
                  {SLOT_DEFS.map((def, i) => {
                    const file = files[def.key];
                    const check = checks[def.key];
                    const ok = file !== null && check?.status === "ok";
                    const bad = file !== null && (check?.status === "missing" || check?.status === "unreadable");
                    return (
                      <div
                        key={def.key}
                        className={`flex flex-wrap items-center gap-4 px-6 py-4 border-b last:border-b-0 ${
                          bad ? "bg-red-50/60 border-red-200 shadow-[inset_3px_0_0_#dc2626]" : "border-slate-100"
                        }`}
                        data-testid={`upload-slot-${i + 1}`}
                      >
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-semibold shrink-0 ${
                            bad ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {i + 1}
                        </span>

                        <div className="flex-[1_1_280px] min-w-0">
                          <div className="text-[15px] font-semibold text-slate-900">{def.label}</div>
                          <div className="text-sm text-slate-600 mt-0.5 mb-2">{def.description}</div>
                          {bad && check?.status === "missing" ? (
                            <div className="text-sm text-red-800">
                              Missing column{check.missing.length > 1 ? "s" : ""}{" "}
                              <span className="font-mono">{check.missing.join(", ")}</span>
                            </div>
                          ) : bad ? (
                            <div className="text-sm text-red-800">File is empty or has no header row.</div>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {def.columns.map((c) => (
                                <span key={c} className="font-mono text-[11.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                  {c}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <input
                          type="file"
                          accept=".csv"
                          className="hidden"
                          ref={(el) => {
                            fileInputRefs.current[def.key] = el;
                          }}
                          onChange={(e) => {
                            assignFile(def.key, e.target.files?.[0] || null);
                            e.target.value = "";
                          }}
                        />

                        {isFilled ? (
                          <div className="flex items-center gap-3">
                            {file && <span className="text-sm font-mono text-slate-700">{file.name}</span>}
                            <span
                              className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
                              data-testid={`slot-check-${i + 1}`}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                              Uploaded
                            </span>
                          </div>
                        ) : file ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="text-right">
                              <div className="text-sm font-mono text-slate-800">{file.name}</div>
                              <div className="text-xs text-slate-600">
                                {formatBytes(file.size)}
                                {check && check.status !== "unreadable" ? ` · ${check.rows} rows` : ""}
                              </div>
                            </div>
                            {!check && (
                              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-50 text-slate-600 border border-slate-200">Checking…</span>
                            )}
                            {ok && (
                              <span
                                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
                                data-testid={`slot-check-${i + 1}`}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                                Columns OK
                              </span>
                            )}
                            {bad && (
                              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
                                {check?.status === "missing" ? "Missing column" : "Can't read"}
                              </span>
                            )}
                            <button
                              type="button"
                              className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              onClick={() => fileInputRefs.current[def.key]?.click()}
                              aria-label={`Replace ${def.label} file`}
                            >
                              Replace
                            </button>
                            <button
                              type="button"
                              className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              onClick={() => assignFile(def.key, null)}
                              aria-label={`Remove ${def.label} file`}
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
                              Waiting for file
                            </span>
                            <button
                              type="button"
                              className="px-3.5 py-2 text-sm font-semibold rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                              onClick={() => fileInputRefs.current[def.key]?.click()}
                              aria-label={`Choose ${def.label} file`}
                            >
                              Choose file
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Issues table */}
                {issues.length > 0 && (
                  <div className="border-t border-slate-200" role="alert">
                    <h3 className="px-6 py-3 text-sm font-semibold text-red-800 bg-red-50 border-b border-red-200">
                      Issues ({issues.length})
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm" data-testid="issues-table">
                        <thead>
                          <tr className="bg-slate-50 text-left text-slate-600">
                            <th scope="col" className="px-6 py-2 text-xs font-semibold uppercase tracking-wide">File</th>
                            <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase tracking-wide">Row</th>
                            <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase tracking-wide">Column</th>
                            <th scope="col" className="px-6 py-2 text-xs font-semibold uppercase tracking-wide">Problem</th>
                          </tr>
                        </thead>
                        <tbody>
                          {issues.map((it, n) => (
                            <tr key={n} className="border-t border-slate-100">
                              <td className="px-6 py-2.5 font-mono text-[13px]">{it.file}</td>
                              <td className="px-4 py-2.5">{it.row}</td>
                              <td className="px-4 py-2.5 font-mono text-[13px]">{it.column}</td>
                              <td className="px-6 py-2.5 text-slate-700">{it.problem}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Error message (non-validation errors, e.g. network) */}
                {uploadError && serverErrors.length === 0 && (
                  <div className="mx-6 my-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm" role="alert">
                    {uploadError}
                  </div>
                )}

                {/* Footer */}
                <div
                  className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 bg-slate-50 border-t border-slate-200"
                  data-testid="view1-footer"
                >
                  <div className="flex-[1_1_260px] min-w-0">
                    <div className="text-sm font-semibold text-slate-900 mb-2">
                      {readyCount} of 5 files {isFilled ? "uploaded" : "ready"}
                    </div>
                    <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all ${isFilled ? "bg-emerald-500" : "bg-blue-600"}`}
                        style={{ width: `${readyCount * 20}%` }}
                      />
                    </div>
                    <div className="text-sm text-slate-600 mt-2" data-testid="footer-reason">{reason}</div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {!isFilled && (
                      <>
                        <button
                          type="button"
                          className="px-4 py-2.5 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={clearAll}
                          disabled={uploading || SLOT_KEYS.every((k) => files[k] === null)}
                        >
                          Clear all
                        </button>
                        <button
                          type="button"
                          className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                            allFilesSelected && !uploading
                              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                              : "bg-slate-300 text-slate-700 cursor-not-allowed"
                          }`}
                          disabled={!allFilesSelected || uploading}
                          onClick={handleUpload}
                        >
                          {uploading ? "Uploading..." : "Upload 5 files"}
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                        analyzeControl === "ACTIVE"
                          ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                          : "bg-slate-300 text-slate-700 cursor-not-allowed"
                      }`}
                      disabled={analyzeControl !== "ACTIVE"}
                      onClick={handleAnalyze}
                      data-testid="analyze-button"
                      data-control={analyzeControl}
                    >
                      Run Analysis
                    </button>
                  </div>
                </div>
              </section>

              {/* Side panel */}
              <aside className="flex-[1_1_300px] min-w-0 flex flex-col gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-[15px] font-semibold text-slate-900 mb-3">Before you upload</h3>
                  <ul className="list-disc pl-5 text-sm text-slate-700 leading-relaxed">
                    <li>All five files cover the same billing period (YYYY-MM).</li>
                    <li>CSV with a header row; column names must match.</li>
                    <li>Files are stored as received — never edited or overwritten.</li>
                  </ul>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-[15px] font-semibold text-slate-900 mb-3">What happens next</h3>
                  <ol className="list-decimal pl-5 text-sm text-slate-700 leading-relaxed">
                    <li>Validate each file — columns, types, blanks</li>
                    <li>Allocate GPU cost and revenue per tenant</li>
                    <li>Reconcile capacity, tenants, billed vs posted</li>
                    <li>Review, approve, export</li>
                  </ol>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-[15px] font-semibold text-slate-900 mb-3">Templates</h3>
                  <div className="flex flex-col gap-2 text-sm">
                    {SLOT_DEFS.map((d) => (
                      <a key={d.key} href={`/templates/${d.fileName}`} download className="text-blue-700 hover:text-blue-900 underline">
                        {d.fileName}
                      </a>
                    ))}
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Export for testing
export { deriveAnalyzeControl, SLOT_LABELS };
