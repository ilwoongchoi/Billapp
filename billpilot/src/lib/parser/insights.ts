import {
  FrameworkReadout,
  HistoricalBillSnapshot,
  Insight,
  ParsedBill,
} from "./types";

type Decision = "SHIP" | "NO-SHIP" | "BOUNDARY-BAND ONLY";

export interface InsightEngineOutput {
  insights: Insight[];
  framework: FrameworkReadout;
  expectedCost: number | null;
  expectedUsage: number | null;
  decision: Decision;
}

interface BuildInsightArgs {
  bill: ParsedBill;
  priorBills: HistoricalBillSnapshot[];
  parseConfidence: number;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function pickSavings(totalCost: number | null, ratio: number): number | null {
  if (totalCost === null) {
    return null;
  }
  return Number((totalCost * ratio).toFixed(2));
}

export function buildInsights({
  bill,
  priorBills,
  parseConfidence,
}: BuildInsightArgs): InsightEngineOutput {
  const insights: Insight[] = [];

  const priorCosts = priorBills
    .map((row) => row.totalCost)
    .filter((value) => Number.isFinite(value) && value > 0);
  const priorUsage = priorBills
    .map((row) => row.usageValue)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const expectedCost = average(priorCosts);
  const expectedUsage = average(priorUsage);

  const costResidual =
    expectedCost !== null && bill.totalCost !== null
      ? Math.abs(bill.totalCost - expectedCost) / expectedCost
      : null;
  const usageResidual =
    expectedUsage !== null && bill.usageValue !== null
      ? Math.abs(bill.usageValue - expectedUsage) / expectedUsage
      : null;

  if (costResidual !== null) {
    const severity =
      costResidual >= 0.25 ? "high" : costResidual >= 0.1 ? "watch" : "info";
    const direction =
      bill.totalCost !== null && expectedCost !== null && bill.totalCost >= expectedCost
        ? "higher"
        : "lower";

    insights.push({
      type: "cost_anomaly",
      severity,
      message: `Cost is ${percentage(costResidual)} ${direction} than your 3-bill average.`,
      estSavings: pickSavings(bill.totalCost, 0.08),
      residual: Number(costResidual.toFixed(4)),
      metadata: {
        expectedCost: Number(expectedCost?.toFixed(2) ?? 0),
      },
    });
  }

  if (usageResidual !== null) {
    const severity =
      usageResidual >= 0.35 ? "high" : usageResidual >= 0.2 ? "watch" : "info";
    insights.push({
      type: "usage_anomaly",
      severity,
      message: `Usage shifted ${percentage(usageResidual)} from baseline.`,
      estSavings: pickSavings(bill.totalCost, 0.05),
      residual: Number(usageResidual.toFixed(4)),
      metadata: {
        expectedUsage: Number(expectedUsage?.toFixed(2) ?? 0),
      },
    });
  }

  if (bill.totalCost !== null && bill.lineItems.length > 0) {
    const surchargeTotal = bill.lineItems
      .filter((row) => /(tax|fee|delivery|surcharge)/i.test(row.itemName))
      .reduce((sum, row) => sum + row.amount, 0);
    const surchargeRatio =
      bill.totalCost > 0 ? surchargeTotal / bill.totalCost : null;

    if (surchargeRatio !== null && surchargeRatio >= 0.2) {
      insights.push({
        type: "line_item_spike",
        severity: surchargeRatio >= 0.3 ? "high" : "watch",
        message: `Taxes/fees are ${percentage(surchargeRatio)} of total bill.`,
        estSavings: pickSavings(bill.totalCost, 0.04),
        residual: Number(surchargeRatio.toFixed(4)),
      });
    }
  }

  insights.push(
    {
      type: "saving_action",
      severity: "info",
      message:
        "Shift heavy appliance usage to off-peak windows where possible.",
      estSavings: pickSavings(bill.totalCost, 0.07),
      residual: null,
    },
    {
      type: "saving_action",
      severity: "info",
      message: "Set HVAC 1-2°F closer to ambient when away from home.",
      estSavings: pickSavings(bill.totalCost, 0.06),
      residual: null,
    },
    {
      type: "saving_action",
      severity: "info",
      message: "Review tariff plan eligibility based on current usage profile.",
      estSavings: pickSavings(bill.totalCost, 0.05),
      residual: null,
    },
  );

  const framework: FrameworkReadout = {
    system: "utility_bill_profile",
    controls: [
      "thermostat_setpoint",
      "time_of_use_shift",
      "appliance_schedule",
      "tariff_plan",
    ],
    observables: {
      totalCost: bill.totalCost,
      usageValue: bill.usageValue,
      usageUnit: bill.usageUnit,
      periodStart: bill.periodStart,
      periodEnd: bill.periodEnd,
    },
    residual: {
      cost: costResidual !== null ? Number(costResidual.toFixed(4)) : null,
      usage: usageResidual !== null ? Number(usageResidual.toFixed(4)) : null,
    },
    thresholds: {
      normal: 0.1,
      watch: 0.25,
      anomaly: 0.35,
    },
  };

  const decision: Decision =
    parseConfidence < 0.8
      ? "NO-SHIP"
      : costResidual !== null && costResidual > 0.25
        ? "BOUNDARY-BAND ONLY"
        : "SHIP";

  return { insights, framework, expectedCost, expectedUsage, decision };
}

