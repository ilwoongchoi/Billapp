import { NextResponse } from "next/server";
import { z } from "zod";

import { hashTextInputs, newEventId } from "@/lib/audit-utils";
import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { isDebugRequest } from "@/lib/debug";
import { getAnalysisQuota } from "@/lib/billing/quota";
import { estimateParseConfidence } from "@/lib/parser/confidence";
import { extractTextFromFile } from "@/lib/parser/extractText";
import { buildInsights } from "@/lib/parser/insights";
import { parseBillFields } from "@/lib/parser/parseFields";
import { HistoricalBillSnapshot, Insight } from "@/lib/parser/types";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const historicalBillSchema = z.object({
  totalCost: z.number().positive(),
  usageValue: z.number().nonnegative().nullable(),
  periodEnd: z.string().nullable(),
});

const payloadSchema = z.object({
  rawText: z.string().min(20),
  propertyId: z.string().optional(),
  fileUrl: z.string().min(3).max(500).optional(),
  provider: z.string().min(2).max(120).optional(),
  currency: z.string().length(3).optional(),
  priorBills: z.array(historicalBillSchema).max(24).optional(),
});

interface NormalizedPayload {
  rawText: string;
  propertyId?: string;
  fileUrl?: string;
  provider?: string;
  currency?: string;
  priorBills?: HistoricalBillSnapshot[];
}

interface BillsRow {
  total_cost: number | string | null;
  usage_value: number | string | null;
  period_end: string | null;
}

function toNumberOrNull(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceHistoricalRows(rows: BillsRow[]): HistoricalBillSnapshot[] {
  return rows
    .map((row) => {
      const totalCost = toNumberOrNull(row.total_cost);
      if (totalCost === null || totalCost <= 0) {
        return null;
      }

      return {
        totalCost,
        usageValue: toNumberOrNull(row.usage_value),
        periodEnd: row.period_end,
      };
    })
    .filter((row): row is HistoricalBillSnapshot => row !== null);
}

function normalizePriorBills(value: unknown): HistoricalBillSnapshot[] | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    return z.array(historicalBillSchema).max(24).parse(parsed);
  }

  return z.array(historicalBillSchema).max(24).parse(value);
}

async function normalizeRequestPayload(request: Request): Promise<NormalizedPayload> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const fileCandidate = formData.get("file");
    const rawTextCandidate = formData.get("rawText");

    let rawText = "";

    if (fileCandidate instanceof File) {
      rawText = await extractTextFromFile(fileCandidate);
    } else if (typeof rawTextCandidate === "string") {
      rawText = rawTextCandidate;
    }

    const payload = payloadSchema.parse({
      rawText,
      propertyId:
        typeof formData.get("propertyId") === "string"
          ? String(formData.get("propertyId"))
          : undefined,
      fileUrl:
        typeof formData.get("fileUrl") === "string"
          ? String(formData.get("fileUrl"))
          : undefined,
      provider:
        typeof formData.get("provider") === "string"
          ? String(formData.get("provider"))
          : undefined,
      currency:
        typeof formData.get("currency") === "string"
          ? String(formData.get("currency")).toUpperCase()
          : undefined,
      priorBills: normalizePriorBills(formData.get("priorBills")),
    });

    return payload;
  }

  const jsonBody = await request.json();
  return payloadSchema.parse(jsonBody);
}

async function loadPriorBillsFromDb(
  propertyId: string,
): Promise<HistoricalBillSnapshot[]> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("bills")
    .select("total_cost, usage_value, period_end")
    .eq("property_id", propertyId)
    .order("period_end", { ascending: false })
    .limit(3);

  if (error || !data) {
    return [];
  }

  return coerceHistoricalRows(data as BillsRow[]);
}

async function persistParseResult(params: {
  propertyId: string;
  fileUrl?: string;
  confidence: number;
  parsedBill: ReturnType<typeof parseBillFields>;
  insights: Insight[];
}): Promise<{ billId: string | null; persistenceError: string | null }> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return { billId: null, persistenceError: null };
  }

  const { parsedBill, propertyId, fileUrl, confidence, insights } = params;
  const { data: insertedBill, error: billError } = await supabase
    .from("bills")
    .insert({
      property_id: propertyId,
      file_url: fileUrl ?? null,
      provider: parsedBill.provider,
      period_start: parsedBill.periodStart,
      period_end: parsedBill.periodEnd,
      total_cost: parsedBill.totalCost,
      usage_value: parsedBill.usageValue,
      usage_unit: parsedBill.usageUnit,
      currency: parsedBill.currency,
      confidence,
      raw_text: parsedBill.rawText,
    })
    .select("id")
    .single();

  if (billError || !insertedBill?.id) {
    return { billId: null, persistenceError: billError?.message ?? "insert_failed" };
  }

  const billId = insertedBill.id as string;

  if (parsedBill.lineItems.length > 0) {
    await supabase.from("bill_line_items").insert(
      parsedBill.lineItems.map((line) => ({
        bill_id: billId,
        item_name: line.itemName,
        amount: line.amount,
      })),
    );
  }

  if (insights.length > 0) {
    await supabase.from("insights").insert(
      insights.map((insight) => ({
        bill_id: billId,
        type: insight.type,
        severity: insight.severity,
        message: insight.message,
        est_savings: insight.estSavings,
        residual: insight.residual,
        metadata: insight.metadata ?? {},
      })),
    );
  }

  return { billId, persistenceError: null };
}

export async function POST(request: Request) {
  try {
    const payload = await normalizeRequestPayload(request);
    const eventId = newEventId("parse");
    const modelVersion = process.env.BILLPILOT_MODEL_VERSION || "billpilot-mvp";
    const inputHash = hashTextInputs([
      payload.propertyId ?? null,
      payload.fileUrl ?? null,
      payload.provider ?? null,
      payload.currency ?? null,
      payload.rawText,
    ]);
    const apiUser = payload.propertyId ? await requireApiUser(request) : null;
    const quota = payload.propertyId
      ? await getAnalysisQuota(payload.propertyId, apiUser?.id)
      : {
          enforced: false,
          allowed: true,
          remaining: null,
          limit: null,
          usedThisMonth: null,
          periodStart: null,
          plan: null,
          status: null,
          reason: "property_not_provided",
        };

    if (quota.reason === "property_not_owned") {
      return NextResponse.json(
        {
          error: "forbidden_property",
          message: "This property does not belong to the authenticated user.",
        },
        { status: 403 },
      );
    }

    if (quota.reason === "property_not_found") {
      return NextResponse.json(
        {
          error: "property_not_found",
          message: "propertyId does not exist.",
        },
        { status: 404 },
      );
    }

    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: "free_tier_limit_reached",
          message:
            "Free plan allows 2 analyses per month. Upgrade to continue.",
          quota,
        },
        { status: 402 },
      );
    }

    const parsedBill = parseBillFields(payload.rawText, {
      providerOverride: payload.provider,
      currencyOverride: payload.currency,
    });
    const confidence = estimateParseConfidence(parsedBill);
    const priorBills =
      payload.priorBills ??
      (payload.propertyId
        ? await loadPriorBillsFromDb(payload.propertyId)
        : []);
    const insightOutput = buildInsights({
      bill: parsedBill,
      priorBills,
      parseConfidence: confidence,
    });

    let persistedBillId: string | null = null;
    let persistenceError: string | null = null;
    let responseQuota = quota;

    if (payload.propertyId) {
      const persistence = await persistParseResult({
        propertyId: payload.propertyId,
        fileUrl: payload.fileUrl,
        confidence,
        parsedBill,
        insights: insightOutput.insights,
      });
      persistedBillId = persistence.billId;
      persistenceError = persistence.persistenceError;

      if (
        persistedBillId &&
        quota.enforced &&
        quota.limit !== null &&
        quota.usedThisMonth !== null
      ) {
        const usedThisMonth = quota.usedThisMonth + 1;
        responseQuota = {
          ...quota,
          usedThisMonth,
          remaining: Math.max(0, quota.limit - usedThisMonth),
        };
      }
    }

    const debug = isDebugRequest(request)
      ? {
          eventId,
          inputHash,
          residuals: insightOutput.insights
            .filter((insight) => typeof insight.residual === "number")
            .map((insight) => insight.residual),
          expectedCost: insightOutput.expectedCost,
          expectedUsage: insightOutput.expectedUsage,
          decision: insightOutput.decision,
        }
      : undefined;

    return NextResponse.json({
      modelVersion,
      eventId,
      inputHash,
      bill: parsedBill,
      parseConfidence: confidence,
      requiresManualReview: confidence < 0.8,
      priorBillsUsed: priorBills.length,
      expectedCost: insightOutput.expectedCost,
      expectedUsage: insightOutput.expectedUsage,
      framework: insightOutput.framework,
      decision: insightOutput.decision,
      insights: insightOutput.insights,
      quota: responseQuota,
      persistedBillId,
      persistenceError,
      debug,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "invalid_request",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
