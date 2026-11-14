"""
Generate the enterprise-scale demo dataset (billions of dollars).

Writes 5 CSVs for one billing period (March 2026) to
phase_zero/test_data/enterprise/ by default:

    telemetry_2026-03.csv        Usage Metering
    cost_management_2026-03.csv  Cost Management
    iam_2026-03.csv              Tenant
    billing_2026-03.csv          Billing
    erp_2026-03.csv              ERP

Fixed seed, so every run writes byte-identical files.
All tenant names are fictional.

Design rules (match the server validators and engines):
  - gpu_hours_consumed are whole hours; rates and costs have 2 decimals,
    so every revenue and cost amount is exact to the cent.
  - consumed <= reserved for every region x pool x day  -> Check 1 PASS.
  - 3 tenants are in usage but not in Tenant (IAM)       -> Check 2 FAIL
    (their usage is classified identity_broken).
  - 2 tenants under-billed (computed != billed)          -> Check 3 FAIL-1.
  - 1 tenant posted != billed                            -> Check 3 FAIL-2.

Usage:
    python scripts/generate_enterprise_data.py [output_dir]
"""

from __future__ import annotations

import calendar
import csv
import random
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

SEED = 20260301
YEAR, MONTH = 2026, 3
PERIOD = f"{YEAR}-{MONTH:02d}"

REGIONS = [
    "us-east-1", "us-west-2", "us-central-1",
    "eu-west-1", "eu-north-1", "ap-northeast-1",
]

# GPU type -> (GPUs per pool, base cost per GPU-hour, contracted rate range)
GPU_TYPES = {
    "h100":  (26_000, Decimal("1.45"), (Decimal("2.40"), Decimal("3.20"))),
    "h200":  (24_000, Decimal("1.90"), (Decimal("3.00"), Decimal("4.10"))),
    "b200":  (20_000, Decimal("2.60"), (Decimal("4.20"), Decimal("5.60"))),
    "gb200": (16_000, Decimal("3.40"), (Decimal("5.50"), Decimal("6.90"))),
}

# Regional cost adjustment (power + facility), in cents per GPU-hour.
REGION_COST_ADJ = {
    "us-east-1": 0, "us-west-2": 4, "us-central-1": -3,
    "eu-west-1": 9, "eu-north-1": -6, "ap-northeast-1": 12,
}

TENANT_NAMES = [
    "helix-foundry", "quanta-reasoning", "vectorforge-labs", "lumen-synthetics",
    "orbital-minds", "cedar-ml", "kestrel-intelligence", "parallax-models",
    "tessellate-ai", "brightwater-research", "monolith-learning", "sable-cognition",
    "northpeak-ai", "ember-tensor", "atlas-reasoning-co", "fjord-models",
    "copperleaf-ai", "meridian-agents", "polaris-inference", "graphene-minds",
    "tidewater-labs", "obsidian-ml", "halcyon-models", "zephyr-cognitive",
    "redwood-tensor", "solstice-ai", "ironbark-learning", "nimbus-reasoning",
    "aster-synthetic", "basalt-ai", "cobalt-foundry", "driftwood-ml",
    "evergreen-agents", "falcon-tensor", "granite-models", "harbor-intelligence",
    "indigo-learning", "juniper-ai", "keystone-models", "lattice-cognition",
]

IDENTITY_BROKEN = {"juniper-ai", "keystone-models", "lattice-cognition"}
BELOW_COST = {"cobalt-foundry": Decimal("2.45"), "basalt-ai": Decimal("3.10")}
UNDER_BILLED = {"meridian-agents": Decimal("0.97"), "polaris-inference": Decimal("0.985")}
POSTING_MISMATCH = {"orbital-minds": Decimal("-1250000.00")}


def _money(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"))


def main(out_dir: Path) -> None:
    rng = random.Random(SEED)
    days = calendar.monthrange(YEAR, MONTH)[1]
    dates = [date(YEAR, MONTH, d).isoformat() for d in range(1, days + 1)]
    gpu_order = list(GPU_TYPES)

    # Assign each tenant one GPU type and 3-6 regions.
    tenants: dict[str, dict] = {}
    for i, name in enumerate(TENANT_NAMES):
        gpu = gpu_order[i % len(gpu_order)]
        lo, hi = GPU_TYPES[gpu][2]
        cents = rng.randint(int(lo * 100), int(hi * 100))
        rate = BELOW_COST.get(name, Decimal(cents) / 100)
        regions = rng.sample(REGIONS, rng.randint(3, 6))
        weight = rng.uniform(0.5, 3.0)
        if name in IDENTITY_BROKEN:
            weight = rng.uniform(0.15, 0.3)
        tenants[name] = {"gpu": gpu, "rate": rate, "regions": regions, "weight": weight}

    # Below-cost tenants must sit on a pool whose cost exceeds their rate.
    tenants["cobalt-foundry"]["gpu"] = "b200"
    tenants["basalt-ai"]["gpu"] = "gb200"

    telemetry_rows = []
    cost_rows = []
    revenue = {t: Decimal("0") for t in tenants}

    for region in REGIONS:
        for gpu, (gpus, base_cost, _) in GPU_TYPES.items():
            pool = f"{gpu}-pool"
            cost = base_cost + Decimal(REGION_COST_ADJ[region]) / 100
            on_pool = [t for t, v in tenants.items()
                       if v["gpu"] == gpu and region in v["regions"]]
            total_w = sum(tenants[t]["weight"] for t in on_pool)
            for d in dates:
                reserved = gpus * 24
                cost_rows.append([region, pool, d, f"{reserved}.00", f"{cost:.2f}"])
                if not on_pool:
                    continue
                util = rng.uniform(0.78, 0.96)
                budget = int(reserved * util)
                used = 0
                for t in on_pool:
                    share = tenants[t]["weight"] / total_w
                    hours = int(budget * share * rng.uniform(0.97, 1.0))
                    if hours <= 0:
                        continue
                    used += hours
                    telemetry_rows.append([t, region, pool, d, f"{hours}.00"])
                    revenue[t] += Decimal(hours) * tenants[t]["rate"]
                assert used <= reserved, (region, pool, d)

    billed_tenants = [t for t in TENANT_NAMES if t not in IDENTITY_BROKEN]
    iam_rows, billing_rows, erp_rows = [], [], []
    for t in billed_tenants:
        computed = _money(revenue[t])
        billed = _money(computed * UNDER_BILLED[t]) if t in UNDER_BILLED else computed
        posted = billed + POSTING_MISMATCH.get(t, Decimal("0"))
        iam_rows.append([t, PERIOD, f"{tenants[t]['rate']:.2f}"])
        billing_rows.append([t, PERIOD, f"{billed:.2f}"])
        erp_rows.append([t, PERIOD, f"{posted:.2f}"])

    out_dir.mkdir(parents=True, exist_ok=True)
    files = {
        f"telemetry_{PERIOD}.csv": (
            ["tenant_id", "region", "gpu_pool_id", "date", "gpu_hours_consumed"], telemetry_rows),
        f"cost_management_{PERIOD}.csv": (
            ["region", "gpu_pool_id", "date", "reserved_gpu_hours", "cost_per_gpu_hour"], cost_rows),
        f"iam_{PERIOD}.csv": (["tenant_id", "billing_period", "contracted_rate"], iam_rows),
        f"billing_{PERIOD}.csv": (["tenant_id", "billing_period", "billable_amount"], billing_rows),
        f"erp_{PERIOD}.csv": (["tenant_id", "billing_period", "amount_posted"], erp_rows),
    }
    for fname, (header, rows) in files.items():
        with open(out_dir / fname, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(header)
            w.writerows(rows)
        print(f"{fname}: {len(rows)} rows")

    total_rev = sum(revenue.values())
    print(f"computed revenue (all tenants): ${total_rev:,.2f}")


if __name__ == "__main__":
    default = Path(__file__).resolve().parent.parent / "test_data" / "enterprise"
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else default)
