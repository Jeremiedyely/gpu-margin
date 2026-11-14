/**
 * Upload slot definitions + client-side header pre-check.
 *
 * REQUIRED_COLUMNS mirror app/ingestion/validators/*.py (REQUIRED_COLUMNS).
 * The server stays the authority: this check only surfaces problems
 * before upload. Header names are compared stripped + lower-cased,
 * exactly as the server validators do.
 */

export const SLOT_DEFS = [
  {
    key: "telemetry",
    label: "Telemetry & Metering",
    description: "GPU hours consumed per tenant, region, pool and day",
    fileName: "telemetry.csv",
    columns: ["tenant_id", "region", "gpu_pool_id", "date", "gpu_hours_consumed"],
  },
  {
    key: "cost_management",
    label: "Cost Management / FinOps",
    description: "Reserved capacity and cost per GPU-hour",
    fileName: "cost_management.csv",
    columns: ["region", "gpu_pool_id", "date", "reserved_gpu_hours", "cost_per_gpu_hour"],
  },
  {
    key: "iam",
    label: "IAM / Tenant Management",
    description: "Tenants and contracted rate per billing period",
    fileName: "iam.csv",
    columns: ["tenant_id", "billing_period", "contracted_rate"],
  },
  {
    key: "billing",
    label: "Billing System",
    description: "Amount invoiced per tenant",
    fileName: "billing.csv",
    columns: ["tenant_id", "billing_period", "billable_amount"],
  },
  {
    key: "erp",
    label: "ERP / General Ledger",
    description: "Amount posted to the general ledger per tenant",
    fileName: "erp.csv",
    columns: ["tenant_id", "billing_period", "amount_posted"],
  },
] as const;

export type SlotKey = (typeof SLOT_DEFS)[number]["key"];

export const SLOT_KEYS: SlotKey[] = SLOT_DEFS.map((d) => d.key);

/** Result of reading one file in the browser. */
export interface FileCheck {
  status: "ok" | "missing" | "unreadable";
  header: string[];
  missing: string[];
  rows: number;
}

/**
 * Match a dropped file to a slot by its name.
 * "telemetry.csv", "Telemetry_2026-03.csv" → telemetry;
 * "cost-management.csv", "cost management.csv" → cost_management.
 * Returns null when no slot key appears in the name.
 */
export function matchSlot(fileName: string): SlotKey | null {
  const norm = fileName.toLowerCase().replace(/[\s-]+/g, "_");
  // Longest keys first so "cost_management" wins over shorter overlaps.
  const keys = [...SLOT_KEYS].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (norm.includes(key)) return key;
  }
  return null;
}

/** First line of a CSV → column names (BOM, quotes and spaces stripped, lower-cased). */
export function parseHeader(text: string): string[] {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.trim() === "") return [];
  return firstLine
    .split(",")
    .map((h) => h.trim().replace(/^"(.*)"$/, "$1").trim().toLowerCase())
    .filter((h) => h !== "");
}

/** Number of non-empty lines after the header. */
export function countDataRows(text: string): number {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  return Math.max(0, lines.slice(1).filter((l) => l.trim() !== "").length);
}

/** Required columns not present in the header, in required order. */
export function missingColumns(header: string[], required: readonly string[]): string[] {
  const have = new Set(header);
  return required.filter((c) => !have.has(c));
}

/** Check one file's text against its slot's required columns. */
export function checkFileText(text: string, required: readonly string[]): FileCheck {
  const header = parseHeader(text);
  if (header.length === 0) {
    return { status: "unreadable", header, missing: [...required], rows: 0 };
  }
  const missing = missingColumns(header, required);
  return {
    status: missing.length ? "missing" : "ok",
    header,
    missing,
    rows: countDataRows(text),
  };
}

/** Read a File as text (File.text when available, else FileReader). */
export function readFileText(file: File): Promise<string> {
  if (typeof (file as any).text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** 1333 → "1.3 KB", 585 → "585 B". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Split the server's error strings ("iam: validation failed — Missing column: x")
 * into a file + problem pair for the issues table.
 */
export function splitServerError(message: string): { file: string; problem: string } {
  const m = message.match(/^([a-z_]+):\s*(.*)$/);
  if (m && (SLOT_KEYS as string[]).includes(m[1])) {
    const def = SLOT_DEFS.find((d) => d.key === m[1])!;
    return { file: def.fileName, problem: m[2] };
  }
  return { file: "—", problem: message };
}
