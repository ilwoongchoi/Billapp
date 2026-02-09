import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { propertyBelongsToUser } from "@/lib/properties";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const payloadSchema = z.object({
  propertyId: z.string().uuid(),
  months: z.coerce.number().int().min(3).max(24).default(6),
  provider: z.string().trim().min(2).max(120).optional(),
  currency: z.string().trim().length(3).optional(),
  replaceExisting: z.boolean().optional().default(false),
});

interface SeedBillDraft {
  periodStart: string;
  periodEnd: string;
  totalCost: number;
  usageValue: number;
  confidence: number;
  delivery: number;
  supply: number;
  tax: number;
  residual: number;
  createdAt: string;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function seededUnit(seed: number): number {
  const value = Math.sin(seed) * 10000;
  return value - Math.floor(value);
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getMonthWindow(reference: Date, monthsAgo: number): {
  periodStart: string;
  periodEnd: string;
  createdAt: string;
} {
  const monthStart = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - monthsAgo, 1),
  );
  const monthEnd = new Date(
    Date.UTC(
      monthStart.getUTCFullYear(),
      monthStart.getUTCMonth() + 1,
      0,
      12,
      0,
      0,
      0,
    ),
  );

  return {
    periodStart: dateOnly(monthStart),
    periodEnd: dateOnly(monthEnd),
    createdAt: monthEnd.toISOString(),
  };
}

function buildSeedBills(input: {
  propertyId: string;
  months: number;
}): SeedBillDraft[] {
  const now = new Date();
  const seedBase = Array.from(input.propertyId).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );

  const rows: SeedBillDraft[] = [];
  for (let index = 0; index < input.months; index += 1) {
    const monthsAgo = input.months - index;
    const month = getMonthWindow(now, monthsAgo);

    const trend = index * 4.75;
    const noise = (seededUnit(seedBase + index * 17) - 0.5) * 22;
    const totalCost = round(148 + trend + noise, 2);
    const usageNoise = (seededUnit(seedBase + index * 31) - 0.5) * 120;
    const usageValue = round(560 + index * 11 + usageNoise, 3);
    const delivery = round(totalCost * (0.23 + seededUnit(seedBase + index * 43) * 0.07), 2);
    const tax = round(totalCost * (0.058 + seededUnit(seedBase + index * 59) * 0.03), 2);
    const supply = round(totalCost - delivery - tax, 2);
    const confidence = round(0.9 + seededUnit(seedBase + index * 71) * 0.09, 3);
    const residual = round(0.008 + seededUnit(seedBase + index * 97) * 0.025, 4);

    rows.push({
      periodStart: month.periodStart,
      periodEnd: month.periodEnd,
      totalCost: Math.max(80, totalCost),
      usageValue: Math.max(120, usageValue),
      confidence: Math.min(0.995, Math.max(0.8, confidence)),
      delivery: Math.max(0, delivery),
      supply: Math.max(0, supply),
      tax: Math.max(0, tax),
      residual,
      createdAt: month.createdAt,
    });
  }

  return rows;
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);
    const supabase = getServiceSupabaseClient();

    if (!supabase) {
      return NextResponse.json(
        {
          error: "supabase_not_configured",
          message:
            "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.",
        },
        { status: 500 },
      );
    }

    const payload = payloadSchema.parse(await request.json());
    const ownsProperty = await propertyBelongsToUser(payload.propertyId, user.id);

    if (!ownsProperty) {
      return NextResponse.json(
        {
          error: "forbidden_property",
          message: "This property does not belong to the authenticated user.",
        },
        { status: 403 },
      );
    }

    const { count: existingCount, error: existingCountError } = await supabase
      .from("bills")
      .select("id", { count: "exact", head: true })
      .eq("property_id", payload.propertyId);

    if (existingCountError) {
      return NextResponse.json(
        {
          error: "existing_count_failed",
          message: existingCountError.message,
        },
        { status: 500 },
      );
    }

    if ((existingCount ?? 0) > 0 && !payload.replaceExisting) {
      return NextResponse.json(
        {
          error: "existing_data_found",
          message:
            "This property already has bill history. Re-run with replaceExisting=true to overwrite.",
          existingCount: existingCount ?? 0,
        },
        { status: 409 },
      );
    }

    if ((existingCount ?? 0) > 0 && payload.replaceExisting) {
      const { error: deleteError } = await supabase
        .from("bills")
        .delete()
        .eq("property_id", payload.propertyId);

      if (deleteError) {
        return NextResponse.json(
          {
            error: "delete_existing_failed",
            message: deleteError.message,
          },
          { status: 500 },
        );
      }
    }

    const currency = (payload.currency ?? "USD").toUpperCase();
    const provider = payload.provider ?? "North Utility";
    const seeds = buildSeedBills({
      propertyId: payload.propertyId,
      months: payload.months,
    });

    const { data: insertedBills, error: insertBillsError } = await supabase
      .from("bills")
      .insert(
        seeds.map((seed) => ({
          property_id: payload.propertyId,
          provider,
          period_start: seed.periodStart,
          period_end: seed.periodEnd,
          total_cost: seed.totalCost,
          usage_value: seed.usageValue,
          usage_unit: "kWh",
          currency,
          confidence: seed.confidence,
          raw_text: [
            `Provider: ${provider}`,
            `Billing Period: ${seed.periodStart} - ${seed.periodEnd}`,
            `Total Amount Due: $${seed.totalCost.toFixed(2)}`,
            `Usage: ${seed.usageValue.toFixed(3)} kWh`,
          ].join("\n"),
          created_at: seed.createdAt,
        })),
      )
      .select("id, period_start");

    if (insertBillsError || !insertedBills) {
      return NextResponse.json(
        {
          error: "insert_bills_failed",
          message: insertBillsError?.message ?? "Failed to seed bills.",
        },
        { status: 500 },
      );
    }

    const seedByStart = new Map(seeds.map((seed) => [seed.periodStart, seed]));
    const billLineItems: Array<{
      bill_id: string;
      item_name: string;
      amount: number;
    }> = [];
    const insights: Array<{
      bill_id: string;
      type: string;
      severity: "low" | "watch" | "high";
      message: string;
      est_savings: number | null;
      residual: number;
      metadata: Record<string, unknown>;
    }> = [];

    for (const row of insertedBills as Array<{ id: string; period_start: string | null }>) {
      const seed = row.period_start ? seedByStart.get(row.period_start) : undefined;
      if (!seed) {
        continue;
      }

      billLineItems.push(
        {
          bill_id: row.id,
          item_name: "Supply",
          amount: seed.supply,
        },
        {
          bill_id: row.id,
          item_name: "Delivery",
          amount: seed.delivery,
        },
        {
          bill_id: row.id,
          item_name: "Taxes & fees",
          amount: seed.tax,
        },
      );

      insights.push({
        bill_id: row.id,
        type: "trend_signal",
        severity: "watch",
        message:
          "Seed data: monitor month-over-month trend and compare against your baseline.",
        est_savings: round(seed.totalCost * 0.07, 2),
        residual: seed.residual,
        metadata: {
          source: "demo_seed",
          periodStart: seed.periodStart,
          periodEnd: seed.periodEnd,
        },
      });

      if (seed.residual > 1 / 32) {
        insights.push({
          bill_id: row.id,
          type: "vector_breach",
          severity: "high",
          message:
            "Seed data breach marker: residual crossed limit (drift > 1/32).",
          est_savings: round(seed.totalCost * 0.11, 2),
          residual: seed.residual,
          metadata: {
            source: "demo_seed",
            threshold: 1 / 32,
          },
        });
      }
    }

    if (billLineItems.length > 0) {
      const { error: lineItemError } = await supabase
        .from("bill_line_items")
        .insert(billLineItems);
      if (lineItemError) {
        return NextResponse.json(
          {
            error: "insert_line_items_failed",
            message: lineItemError.message,
          },
          { status: 500 },
        );
      }
    }

    if (insights.length > 0) {
      const { error: insightError } = await supabase.from("insights").insert(insights);
      if (insightError) {
        return NextResponse.json(
          {
            error: "insert_insights_failed",
            message: insightError.message,
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      seeded: true,
      propertyId: payload.propertyId,
      provider,
      currency,
      months: payload.months,
      replacedExisting: payload.replaceExisting,
      deletedBeforeSeed: payload.replaceExisting ? existingCount ?? 0 : 0,
      insertedBills: insertedBills.length,
      insertedLineItems: billLineItems.length,
      insertedInsights: insights.length,
      periodRange: {
        from: seeds[0]?.periodStart ?? null,
        to: seeds[seeds.length - 1]?.periodEnd ?? null,
      },
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
