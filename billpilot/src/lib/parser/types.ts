export interface ParsedBillLineItem {
  itemName: string;
  amount: number;
}

export interface ParsedBill {
  provider: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalCost: number | null;
  usageValue: number | null;
  usageUnit: string | null;
  currency: string;
  lineItems: ParsedBillLineItem[];
  rawText: string;
}

export interface HistoricalBillSnapshot {
  totalCost: number;
  usageValue: number | null;
  periodEnd: string | null;
}

export type InsightSeverity = "info" | "watch" | "high";

export type InsightType =
  | "cost_anomaly"
  | "usage_anomaly"
  | "line_item_spike"
  | "saving_action";

export interface Insight {
  type: InsightType;
  severity: InsightSeverity;
  message: string;
  estSavings: number | null;
  residual: number | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface FrameworkReadout {
  system: string;
  controls: string[];
  observables: {
    totalCost: number | null;
    usageValue: number | null;
    usageUnit: string | null;
    periodStart: string | null;
    periodEnd: string | null;
  };
  residual: {
    cost: number | null;
    usage: number | null;
  };
  thresholds: {
    normal: number;
    watch: number;
    anomaly: number;
  };
}

