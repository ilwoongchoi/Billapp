import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { scoreDispatchRoute } from "@/lib/dispatch/optimizer";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const routeSchema = z.object({
  label: z.string().trim().min(2).max(120).optional(),
  origin: z.string().trim().max(120).optional(),
  destination: z.string().trim().max(120).optional(),
  distanceMiles: z.number().positive(),
  estimatedFuelGallons: z.number().nonnegative(),
  estimatedDurationMinutes: z.number().int().min(5).max(1440),
  revenueUsd: z.number().positive(),
  variableCostUsd: z.number().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const controlSchema = z.object({
  fuelPricePerGallon: z.number().positive(),
  driverHourlyCost: z.number().nonnegative(),
  overheadUsd: z.number().nonnegative().optional(),
  marginTarget: z.number().min(0).max(1),
  fuelWeight: z.number().min(0).max(1),
  timeWeight: z.number().min(0).max(1),
  residualBudget: z.number().min(0.0001).max(0.5).optional(),
  kappaStart: z.number().min(0).max(1).optional(),
  kappaLimit: z.number().min(0).max(1).optional(),
});

const postSchema = z.object({
  runLabel: z.string().trim().max(120).optional(),
  route: routeSchema,
  controls: controlSchema,
  saveRoute: z.boolean().default(true),
});

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

interface RouteRow {
  id: string;
  label: string;
  origin: string | null;
  destination: string | null;
  distance_miles: number | string;
  revenue_usd: number | string;
}

interface RunRow {
  id: string;
  route_id: string | null;
  run_label: string | null;
  score: number | string;
  predicted_profit_usd: number | string;
  predicted_margin: number | string;
  drift: number | string;
  residual: number | string;
  residual_budget: number | string;
  phase: string;
  basin: string;
  decision: string;
  frame_valid: boolean;
  pi1: number | string;
  pi2: number | string;
  pi3: number | string;
  threshold_estimate: number | string | null;
  threshold_ci_low: number | string | null;
  threshold_ci_high: number | string | null;
  cv_stability: number | string | null;
  negative_control_drift: number | string | null;
  created_at: string;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const { data: runData, error: runError, count } = await supabase
      .from("dispatch_optimizer_runs")
      .select(
        "id, route_id, run_label, score, predicted_profit_usd, predicted_margin, drift, residual, residual_budget, phase, basin, decision, frame_valid, pi1, pi2, pi3, threshold_estimate, threshold_ci_low, threshold_ci_high, cv_stability, negative_control_drift, created_at",
        { count: "exact" },
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);

    if (runError) {
      return NextResponse.json(
        {
          error: "dispatch_run_list_failed",
          message: runError.message,
        },
        { status: 500 },
      );
    }

    const runs = (runData ?? []) as RunRow[];
    const routeIds = Array.from(
      new Set(runs.map((row) => row.route_id).filter(Boolean)),
    ) as string[];

    let routeMap = new Map<string, RouteRow>();
    if (routeIds.length > 0) {
      const { data: routeData } = await supabase
        .from("dispatch_routes")
        .select("id, label, origin, destination, distance_miles, revenue_usd")
        .eq("user_id", user.id)
        .in("id", routeIds);

      routeMap = new Map((routeData as RouteRow[] | null)?.map((row) => [row.id, row]));
    }

    return NextResponse.json({
      page: {
        limit: query.limit,
        offset: query.offset,
        total: count ?? runs.length,
        hasMore: query.offset + runs.length < (count ?? runs.length),
      },
      runs: runs.map((run) => ({
        id: run.id,
        runLabel: run.run_label,
        routeId: run.route_id,
        route: run.route_id ? routeMap.get(run.route_id) ?? null : null,
        score: toNumber(run.score),
        predictedProfitUsd: toNumber(run.predicted_profit_usd),
        predictedMargin: toNumber(run.predicted_margin),
        drift: toNumber(run.drift),
        residual: toNumber(run.residual),
        residualBudget: toNumber(run.residual_budget),
        phase: run.phase,
        basin: run.basin,
        decision: run.decision,
        frameValid: run.frame_valid,
        piSpace: {
          pi1: toNumber(run.pi1),
          pi2: toNumber(run.pi2),
          pi3: toNumber(run.pi3),
        },
        thresholdHypothesis: {
          estimate: toNumber(run.threshold_estimate),
          ciLow: toNumber(run.threshold_ci_low),
          ciHigh: toNumber(run.threshold_ci_high),
          cvStability: toNumber(run.cv_stability),
          negativeControlDrift: toNumber(run.negative_control_drift),
        },
        createdAt: run.created_at,
      })),
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

    const payload = postSchema.parse(await request.json());
    const result = scoreDispatchRoute(payload.route, payload.controls);

    let routeId: string | null = null;

    if (payload.saveRoute) {
      const { data: routeData, error: routeError } = await supabase
        .from("dispatch_routes")
        .insert({
          user_id: user.id,
          label:
            payload.route.label ??
            payload.runLabel ??
            `${payload.route.origin ?? "Route"} -> ${payload.route.destination ?? "Dispatch"}`,
          origin: payload.route.origin ?? null,
          destination: payload.route.destination ?? null,
          distance_miles: payload.route.distanceMiles,
          estimated_fuel_gallons: payload.route.estimatedFuelGallons,
          estimated_duration_minutes: payload.route.estimatedDurationMinutes,
          revenue_usd: payload.route.revenueUsd,
          variable_cost_usd: payload.route.variableCostUsd ?? 0,
          metadata: payload.route.metadata ?? {},
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (routeError || !routeData) {
        return NextResponse.json(
          {
            error: "dispatch_route_create_failed",
            message: routeError?.message ?? "Unable to create route row.",
          },
          { status: 500 },
        );
      }

      routeId = (routeData as { id: string }).id;
    }

    const { data: runData, error: runError } = await supabase
      .from("dispatch_optimizer_runs")
      .insert({
        user_id: user.id,
        route_id: routeId,
        run_label: payload.runLabel ?? payload.route.label ?? null,
        fuel_price_per_gallon: payload.controls.fuelPricePerGallon,
        driver_hourly_cost: payload.controls.driverHourlyCost,
        overhead_usd: payload.controls.overheadUsd ?? 0,
        margin_target: payload.controls.marginTarget,
        fuel_weight: payload.controls.fuelWeight,
        time_weight: payload.controls.timeWeight,
        kappa_start: result.constants.kappaStart,
        kappa_limit: result.constants.kappaLimit,
        score: result.observables.blendedScore,
        predicted_profit_usd: result.economics.profitUsd,
        predicted_margin: result.economics.margin,
        drift: result.drift,
        residual: result.residual.aggregate,
        residual_budget: result.residual.budget,
        phase: result.phase,
        basin: result.basin,
        decision: result.decision,
        frame_valid: result.frameValid,
        falsifiers: result.claim.falsifiers,
        pi1: result.piSpace.pi1,
        pi2: result.piSpace.pi2,
        pi3: result.piSpace.pi3,
        threshold_estimate: result.thresholdHypothesis.estimate,
        threshold_ci_low: result.thresholdHypothesis.ciLow,
        threshold_ci_high: result.thresholdHypothesis.ciHigh,
        cv_stability: result.thresholdHypothesis.cvStability,
        negative_control_drift: result.thresholdHypothesis.negativeControlDrift,
        metadata: {
          route: payload.route,
          controls: payload.controls,
          preAnalysisPlan: result.preAnalysisPlan,
          claim: result.claim,
        },
      })
      .select("id, created_at")
      .single();

    if (runError || !runData) {
      return NextResponse.json(
        {
          error: "dispatch_run_create_failed",
          message: runError?.message ?? "Unable to persist dispatch run.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      runId: (runData as { id: string }).id,
      createdAt: (runData as { created_at: string }).created_at,
      routeId,
      route: payload.route,
      controls: payload.controls,
      result,
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
