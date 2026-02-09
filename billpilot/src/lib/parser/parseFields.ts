import { ParsedBill, ParsedBillLineItem } from "./types";

const LINE_ITEM_RULES: Array<{ label: string; patterns: string[] }> = [
  { label: "delivery", patterns: ["delivery", "distribution"] },
  { label: "supply", patterns: ["supply", "generation"] },
  { label: "tax", patterns: ["tax", "vat"] },
  { label: "fees", patterns: ["fee", "service charge"] },
  { label: "surcharge", patterns: ["surcharge", "adjustment"] },
];

interface ParseOverrides {
  providerOverride?: string;
  currencyOverride?: string;
}

function normalizeText(rawText: string): string {
  return rawText
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,]/g, "").trim();
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseDateToken(token: string): string | null {
  const trimmed = token.trim().replace(/\.$/, "");
  if (!trimmed) {
    return null;
  }

  const mdYMatch = trimmed.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/,
  );
  if (mdYMatch) {
    const month = Number(mdYMatch[1]);
    const day = Number(mdYMatch[2]);
    let year = Number(mdYMatch[3]);
    if (year < 100) {
      year += year >= 70 ? 1900 : 2000;
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date.toISOString().slice(0, 10);
    }
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return null;
}

function extractProvider(text: string): string | null {
  const labeled = text.match(/(?:provider|utility)\s*[:\-]\s*([^\n]+)/i);
  if (labeled?.[1]) {
    return labeled[1].trim().slice(0, 120);
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  const firstCandidate = lines.find((line) =>
    /(energy|electric|utility|power|gas)/i.test(line),
  );
  return firstCandidate ? firstCandidate.slice(0, 120) : null;
}

function extractPeriod(text: string): {
  periodStart: string | null;
  periodEnd: string | null;
} {
  const periodPatterns = [
    /(?:billing|service)\s*period[^:\n]*[:\s]+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})\s*(?:-|–|to|through)\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i,
    /(?:billing|service)\s*period[^:\n]*[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*(?:-|–|to|through)\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*(?:-|–|to|through)\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i,
  ];

  for (const pattern of periodPatterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const periodStart = parseDateToken(match[1]);
    const periodEnd = parseDateToken(match[2]);
    if (periodStart || periodEnd) {
      return { periodStart, periodEnd };
    }
  }

  return { periodStart: null, periodEnd: null };
}

function extractTotalCost(text: string): number | null {
  const totalPatterns = [
    /(?:total\s*(?:amount\s*)?(?:due|bill|charges?)|amount\s*due|current\s*charges?)\s*[:\s$]*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
    /(?:balance\s*due)\s*[:\s$]*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
  ];

  for (const pattern of totalPatterns) {
    const match = text.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const amount = parseAmount(match[1]);
    if (amount !== null) {
      return amount;
    }
  }

  return null;
}

function extractUsage(text: string): {
  usageValue: number | null;
  usageUnit: string | null;
} {
  const usagePatterns = [
    /(?:total\s*usage|usage)\s*[:\s]*([0-9][0-9,]*(?:\.\d+)?)\s*(kwh|mwh|therms?|ccf|m3)\b/i,
    /([0-9][0-9,]*(?:\.\d+)?)\s*(kwh|mwh|therms?|ccf|m3)\b/i,
  ];

  for (const pattern of usagePatterns) {
    const match = text.match(pattern);
    if (!match?.[1] || !match?.[2]) {
      continue;
    }

    const value = parseAmount(match[1]);
    if (value === null) {
      continue;
    }

    return {
      usageValue: value,
      usageUnit: match[2].toLowerCase(),
    };
  }

  return { usageValue: null, usageUnit: null };
}

function extractLineItems(text: string): ParsedBillLineItem[] {
  const lineItems = new Map<string, number>();

  for (const rule of LINE_ITEM_RULES) {
    for (const patternText of rule.patterns) {
      const pattern = new RegExp(
        `${patternText}\\s*[:\\-$ ]*([0-9][0-9,]*(?:\\.\\d{1,2})?)`,
        "i",
      );
      const match = text.match(pattern);
      if (!match?.[1]) {
        continue;
      }

      const amount = parseAmount(match[1]);
      if (amount === null) {
        continue;
      }
      lineItems.set(rule.label, amount);
      break;
    }
  }

  return Array.from(lineItems, ([itemName, amount]) => ({ itemName, amount }));
}

export function parseBillFields(
  rawText: string,
  overrides: ParseOverrides = {},
): ParsedBill {
  const text = normalizeText(rawText);
  const provider = overrides.providerOverride ?? extractProvider(text);
  const { periodStart, periodEnd } = extractPeriod(text);
  const totalCost = extractTotalCost(text);
  const { usageValue, usageUnit } = extractUsage(text);
  const lineItems = extractLineItems(text);
  const currency = (overrides.currencyOverride ?? "USD").toUpperCase();

  return {
    provider,
    periodStart,
    periodEnd,
    totalCost,
    usageValue,
    usageUnit,
    currency,
    lineItems,
    rawText: text,
  };
}

