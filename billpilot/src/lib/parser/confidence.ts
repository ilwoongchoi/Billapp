import { ParsedBill } from "./types";

export function estimateParseConfidence(parsed: ParsedBill): number {
  let score = 0;

  if (parsed.totalCost !== null) {
    score += 0.3;
  }
  if (parsed.periodStart && parsed.periodEnd) {
    score += 0.2;
  }
  if (parsed.usageValue !== null && parsed.usageUnit) {
    score += 0.2;
  }
  if (parsed.provider) {
    score += 0.1;
  }
  if (parsed.lineItems.length > 0) {
    score += 0.2;
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

