/**
 * Upload slot helpers — Tests (US-01 → US-09)
 *
 * Client-side header pre-check must mirror the server validators:
 * headers compared stripped + lower-cased; required column lists match
 * app/ingestion/validators/*.py REQUIRED_COLUMNS.
 */

import { describe, it, expect } from "vitest";
import {
  SLOT_DEFS,
  matchSlot,
  parseHeader,
  countDataRows,
  checkFileText,
  formatBytes,
  splitServerError,
} from "../lib/uploadSlots";

describe("matchSlot", () => {
  it("US-01 matches the canonical file names", () => {
    expect(matchSlot("telemetry.csv")).toBe("telemetry");
    expect(matchSlot("cost_management.csv")).toBe("cost_management");
    expect(matchSlot("iam.csv")).toBe("iam");
    expect(matchSlot("billing.csv")).toBe("billing");
    expect(matchSlot("erp.csv")).toBe("erp");
  });

  it("US-02 tolerates case, dashes, spaces and suffixes", () => {
    expect(matchSlot("Telemetry_2026-03.csv")).toBe("telemetry");
    expect(matchSlot("Cost-Management March.csv")).toBe("cost_management");
    expect(matchSlot("cost management.csv")).toBe("cost_management");
  });

  it("US-03 returns null for unrelated names", () => {
    expect(matchSlot("report.csv")).toBeNull();
  });
});

describe("header check", () => {
  it("US-04 parses header with BOM, quotes, spaces and mixed case", () => {
    expect(parseHeader('﻿"Tenant_ID", Billing_Period ,contracted_rate\r\nt1,2026-03,4.0')).toEqual([
      "tenant_id",
      "billing_period",
      "contracted_rate",
    ]);
  });

  it("US-05 counts non-empty data rows", () => {
    expect(countDataRows("a,b\n1,2\n3,4\n\n")).toBe(2);
    expect(countDataRows("a,b")).toBe(0);
  });

  it("US-06 ok when all required columns present", () => {
    const iam = SLOT_DEFS.find((d) => d.key === "iam")!;
    const r = checkFileText("tenant_id,billing_period,contracted_rate\nt1,2026-03,4.0\n", iam.columns);
    expect(r.status).toBe("ok");
    expect(r.rows).toBe(1);
    expect(r.missing).toEqual([]);
  });

  it("US-07 names the missing column", () => {
    const iam = SLOT_DEFS.find((d) => d.key === "iam")!;
    const r = checkFileText("tenant_id,billing_period,rate\nt1,2026-03,4.0\n", iam.columns);
    expect(r.status).toBe("missing");
    expect(r.missing).toEqual(["contracted_rate"]);
  });

  it("US-08 empty file is unreadable", () => {
    const erp = SLOT_DEFS.find((d) => d.key === "erp")!;
    expect(checkFileText("", erp.columns).status).toBe("unreadable");
  });
});

describe("formatting", () => {
  it("US-09 formats sizes and splits server errors", () => {
    expect(formatBytes(585)).toBe("585 B");
    expect(formatBytes(1333)).toBe("1.3 KB");
    expect(splitServerError("iam: validation failed — Missing column: contracted_rate")).toEqual({
      file: "iam.csv",
      problem: "validation failed — Missing column: contracted_rate",
    });
    expect(splitServerError("Network down")).toEqual({ file: "—", problem: "Network down" });
  });
});
