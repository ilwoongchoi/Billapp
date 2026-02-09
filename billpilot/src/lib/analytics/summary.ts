import { BillHistoryRow } from "@/lib/bills/history-query";

export interface AnalyticsPoint {
  date: string;
  cost: number | null;
  confidence: number | null;
  high: number;
  watch: number;
}

export interface AnalyticsSummary {
  billCount: number;
  avgCost: number | null;
  avgUsage: number | null;
  avgConfidence: number | null;
  latestCost: number | null;
  previousCost: number | null;
  costChangePercent: number | null;
  insightTotal: number;
  insightHigh: number;
  insightWatch: number;
  parseQuality: "high" | "medium" | "low" | "unknown";
}

export interface AnalyticsForecast {
  method: "linear_regression" | "insufficient_data";
  sampleSize: number;
  nextCost: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  monthlySlope: number | null;
  rmse: number | null;
  confidence: "high" | "medium" | "low" | "none";
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveParseQuality(avgConfidence: number | null): AnalyticsSummary["parseQuality"] {
  if (avgConfidence === null) {
    return "unknown";
  }
  if (avgConfidence >= 0.9) {
    return "high";
  }
  if (avgConfidence >= 0.75) {
    return "medium";
  }
  return "low";
}

function shortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function round(value: number | null, digits = 2): number | null {
  if (value === null) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildCostForecast(rows: BillHistoryRow[]): AnalyticsForecast {
  const points = rows
    .slice(0, 24)
    .reverse()
    .map((row) => row.totalCost)
    .filter((value): value is number => value !== null);

  if (points.length < 3) {
    return {
      method: "insufficient_data",
      sampleSize: points.length,
      nextCost: null,
      lowerBound: null,
      upperBound: null,
      monthlySlope: null,
      rmse: null,
      confidence: "none",
    };
  }

  const n = points.length;
  const xMean = (n - 1) / 2;
  const yMean = average(points) ?? 0;

  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    const x = index - xMean;
    const y = points[index] - yMean;
    numerator += x * y;
    denominator += x * x;
  }

  const slope = denominator > 0 ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;
  const nextCost = intercept + slope * n;

  const residualSquares = points.reduce((sum, value, index) => {
    const predicted = intercept + slope * index;
    const residual = value - predicted;
    return sum + residual * residual;
  }, 0);

  const rmse = Math.sqrt(residualSquares / n);
  const avgCost = average(points) ?? 0;
  const normalizedError = avgCost > 0 ? rmse / avgCost : 1;

  let confidence: AnalyticsForecast["confidence"] = "low";
  if (n >= 12 && normalizedError <= 0.12) {
    confidence = "high";
  } else if (n >= 6 && normalizedError <= 0.25) {
    confidence = "medium";
  }

  return {
    method: "linear_regression",
    sampleSize: n,
    nextCost: round(nextCost, 2),
    lowerBound: round(Math.max(0, nextCost - 1.96 * rmse), 2),
    upperBound: round(nextCost + 1.96 * rmse, 2),
    monthlySlope: round(slope, 2),
    rmse: round(rmse, 2),
    confidence,
  };
}

export function buildAnalyticsSummary(rows: BillHistoryRow[]): {
  summary: AnalyticsSummary;
  series: AnalyticsPoint[];
  forecast: AnalyticsForecast;
} {
  const costs = rows
    .map((row) => row.totalCost)
    .filter((value): value is number => value !== null);
  const usageValues = rows
    .map((row) => row.usageValue)
    .filter((value): value is number => value !== null);
  const confidences = rows
    .map((row) => row.confidence)
    .filter((value): value is number => value !== null);

  const latestCost = rows[0]?.totalCost ?? null;
  const previousCost = rows[1]?.totalCost ?? null;
  const costChangePercent =
    latestCost !== null && previousCost !== null && previousCost > 0
      ? ((latestCost - previousCost) / previousCost) * 100
      : null;

  const insightTotal = rows.reduce((sum, row) => sum + row.insightTotal, 0);
  const insightHigh = rows.reduce((sum, row) => sum + row.insightHigh, 0);
  const insightWatch = rows.reduce((sum, row) => sum + row.insightWatch, 0);

  const avgConfidence = average(confidences);

  const summary: AnalyticsSummary = {
    billCount: rows.length,
    avgCost: round(average(costs), 2),
    avgUsage: round(average(usageValues), 2),
    avgConfidence: round(avgConfidence, 4),
    latestCost,
    previousCost,
    costChangePercent: round(costChangePercent, 2),
    insightTotal,
    insightHigh,
    insightWatch,
    parseQuality: resolveParseQuality(avgConfidence),
  };

  const series = rows
    .slice(0, 24)
    .reverse()
    .map((row) => ({
      date: shortDate(row.periodEnd ?? row.createdAt),
      cost: row.totalCost,
      confidence: row.confidence,
      high: row.insightHigh,
      watch: row.insightWatch,
    }));

  const forecast = buildCostForecast(rows);

  return { summary, series, forecast };
}
