import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(10).max(1000).default(250),
});

interface BasinRow {
  basin: string;
  decision: string;
  frame_valid: boolean;
  drift: number | string;
  residual: number | string;
  created_at: string;
}

function toNumber(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

    const url = new URL(request.url);
    const query = querySchema.parse({
      days: url.searchParams.get("days") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - query.days);

    const { data, error } = await supabase
      .from("dispatch_optimizer_runs")
      .select("basin, decision, frame_valid, drift, residual, created_at")
      .eq("user_id", user.id)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(query.limit);

    if (error) {
      return NextResponse.json(
        {
          error: "dispatch_basin_query_failed",
          message: error.message,
        },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as BasinRow[];

    const basinCounts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.basin] = (acc[row.basin] ?? 0) + 1;
      return acc;
    }, {});

    const decisionCounts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.decision] = (acc[row.decision] ?? 0) + 1;
      return acc;
    }, {});

    const validFrames = rows.filter((row) => row.frame_valid).length;
    const avgDrift =
      rows.length > 0
        ? rows.reduce((sum, row) => sum + toNumber(row.drift), 0) / rows.length
        : 0;
    const avgResidual =
      rows.length > 0
        ? rows.reduce((sum, row) => sum + toNumber(row.residual), 0) / rows.length
        : 0;

    return NextResponse.json({
      window: {
        days: query.days,
        since: since.toISOString(),
        limit: query.limit,
        sampleSize: rows.length,
      },
      basinCounts,
      decisionCounts,
      stats: {
        validFrames,
        validRate: rows.length > 0 ? Number((validFrames / rows.length).toFixed(4)) : 0,
        avgDrift: Number(avgDrift.toFixed(6)),
        avgResidual: Number(avgResidual.toFixed(6)),
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
          error: "invalid_query",
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
