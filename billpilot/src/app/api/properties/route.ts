import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import {
  FREE_TIER_ANALYSES_PER_MONTH,
  getCurrentQuotaPeriodStart,
} from "@/lib/billing/quota";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const createPropertySchema = z.object({
  name: z.string().min(2).max(100),
  address: z.string().max(200).optional(),
  timezone: z.string().min(2).max(60).optional(),
});

interface PropertyRow {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  created_at: string;
}

interface SubscriptionRow {
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
}

async function ensureSubscriptionRow(userId: string): Promise<void> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      plan: "free",
      status: "inactive",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
}

async function listUsageCounts(
  propertyIds: string[],
  periodStartIso: string,
): Promise<Record<string, number>> {
  const supabase = getServiceSupabaseClient();
  if (!supabase || propertyIds.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from("bills")
    .select("property_id")
    .in("property_id", propertyIds)
    .gte("created_at", periodStartIso);

  if (error || !data) {
    return {};
  }

  return data.reduce<Record<string, number>>((acc, row: { property_id: string }) => {
    acc[row.property_id] = (acc[row.property_id] ?? 0) + 1;
    return acc;
  }, {});
}

export async function GET(request: Request) {
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

    await ensureSubscriptionRow(user.id);

    const [{ data: propertiesData, error: propertiesError }, { data: subscriptionData }] =
      await Promise.all([
        supabase
          .from("properties")
          .select("id, name, address, timezone, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("subscriptions")
          .select("plan, status, current_period_end")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

    if (propertiesError) {
      return NextResponse.json(
        { error: "property_list_failed", message: propertiesError.message },
        { status: 500 },
      );
    }

    const properties = (propertiesData ?? []) as PropertyRow[];
    const periodStart = getCurrentQuotaPeriodStart();
    const counts = await listUsageCounts(
      properties.map((row) => row.id),
      periodStart,
    );

    const usageThisMonth = Object.values(counts).reduce(
      (sum, value) => sum + value,
      0,
    );
    const subscription = (subscriptionData as SubscriptionRow | null) ?? {
      plan: "free",
      status: "inactive",
      current_period_end: null,
    };
    const isPaid =
      (subscription.plan ?? "free") !== "free" &&
      new Set(["active", "trialing"]).has(
        (subscription.status ?? "inactive").toLowerCase(),
      );

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
      },
      subscription,
      quota: {
        enforced: true,
        limit: isPaid ? null : FREE_TIER_ANALYSES_PER_MONTH,
        usedThisMonth: isPaid ? null : usageThisMonth,
        remaining: isPaid
          ? null
          : Math.max(0, FREE_TIER_ANALYSES_PER_MONTH - usageThisMonth),
        periodStart,
      },
      properties: properties.map((property) => ({
        ...property,
        analysesThisMonth: counts[property.id] ?? 0,
      })),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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

    const json = await request.json();
    const input = createPropertySchema.parse(json);

    await ensureSubscriptionRow(user.id);

    const { data, error } = await supabase
      .from("properties")
      .insert({
        user_id: user.id,
        name: input.name,
        address: input.address ?? null,
        timezone: input.timezone ?? "UTC",
      })
      .select("id, name, address, timezone, created_at")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "property_create_failed", message: error?.message ?? "failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      property: data,
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

