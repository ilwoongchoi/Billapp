"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { getBrowserSupabaseClient } from "@/lib/supabase-browser";

interface DispatchScorePayload {
  route: {
    label?: string;
    origin?: string;
    destination?: string;
    distanceMiles: number;
    estimatedFuelGallons: number;
    estimatedDurationMinutes: number;
    revenueUsd: number;
    variableCostUsd?: number;
  };
  controls: {
    fuelPricePerGallon: number;
    driverHourlyCost: number;
    overheadUsd?: number;
    marginTarget: number;
    fuelWeight: number;
    timeWeight: number;
  };
}

interface DispatchResult {
  constants: {
    kappaStart: number;
    kappaLimit: number;
  };
  economics: {
    fuelCostUsd: number;
    timeCostUsd: number;
    overheadUsd: number;
    variableCostUsd: number;
    totalCostUsd: number;
    profitUsd: number;
    margin: number;
    profitPerMile: number;
  };
  observables: {
    fuelEfficiencyScore: number;
    timeEfficiencyScore: number;
    profitScore: number;
    blendedScore: number;
  };
  drift: number;
  phase: string;
  basin: string;
  residual: {
    aggregate: number;
    budget: number;
    byFeature: {
      marginTargetError: number;
      driftPenalty: number;
      scorePenalty: number;
    };
  };
  piSpace: {
    pi1: number;
    pi2: number;
    pi3: number;
  };
  decision: string;
  frameValid: boolean;
  thresholdHypothesis: {
    estimate: number;
    ciLow: number;
    ciHigh: number;
    cvStability: number;
    negativeControlDrift: number;
    negativeControlFailsAsExpected: boolean;
  };
  claim: {
    claimId: string;
    system: string;
    residualBudget: number;
    boundaryBand: string;
    status: string;
    falsifiers: Array<{
      id: string;
      statement: string;
      triggered: boolean;
    }>;
  };
}

interface ScoreResponse {
  scoredAt: string;
  result: DispatchResult;
}

interface SavedRunResponse {
  runId: string;
  createdAt: string;
  result: DispatchResult;
}

interface DispatchRunListResponse {
  runs: Array<{
    id: string;
    runLabel: string | null;
    routeId: string | null;
    route: {
      id: string;
      label: string;
      origin: string | null;
      destination: string | null;
      distance_miles: number | string;
      revenue_usd: number | string;
    } | null;
    score: number | null;
    predictedProfitUsd: number | null;
    predictedMargin: number | null;
    drift: number | null;
    residual: number | null;
    phase: string;
    basin: string;
    decision: string;
    frameValid: boolean;
    createdAt: string;
  }>;
}

interface BasinSummaryResponse {
  basinCounts: Record<string, number>;
  decisionCounts: Record<string, number>;
  stats: {
    validFrames: number;
    validRate: number;
    avgDrift: number;
    avgResidual: number;
  };
}

function readApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const message =
    "message" in payload && typeof payload.message === "string"
      ? payload.message
      : null;
  const error =
    "error" in payload && typeof payload.error === "string"
      ? payload.error
      : null;

  return message ?? error ?? fallback;
}

function asCurrency(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function toNumberInput(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function DispatchWorkspace() {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [routeLabel, setRouteLabel] = useState("Downtown Core Route");
  const [origin, setOrigin] = useState("Depot A");
  const [destination, setDestination] = useState("Zone 4");
  const [distanceMiles, setDistanceMiles] = useState("72");
  const [fuelGallons, setFuelGallons] = useState("18");
  const [durationMinutes, setDurationMinutes] = useState("210");
  const [revenueUsd, setRevenueUsd] = useState("960");
  const [variableCostUsd, setVariableCostUsd] = useState("75");

  const [fuelPricePerGallon, setFuelPricePerGallon] = useState("4.25");
  const [driverHourlyCost, setDriverHourlyCost] = useState("38");
  const [overheadUsd, setOverheadUsd] = useState("45");
  const [marginTargetPct, setMarginTargetPct] = useState("14");
  const [fuelWeight, setFuelWeight] = useState("0.62");
  const [timeWeight, setTimeWeight] = useState("0.38");

  const [scoreLoading, setScoreLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);

  const [latestScoreAt, setLatestScoreAt] = useState<string | null>(null);
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [runs, setRuns] = useState<DispatchRunListResponse["runs"]>([]);
  const [basinSummary, setBasinSummary] = useState<BasinSummaryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    const supabase = getBrowserSupabaseClient();

    const applySession = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }

      setAuthToken(data.session?.access_token ?? null);
      setAuthLoading(false);
    };

    void applySession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) {
        return;
      }
      setAuthToken(session?.access_token ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const payload = useMemo<DispatchScorePayload>(() => {
    return {
      route: {
        label: routeLabel.trim() || undefined,
        origin: origin.trim() || undefined,
        destination: destination.trim() || undefined,
        distanceMiles: toNumberInput(distanceMiles, 0),
        estimatedFuelGallons: toNumberInput(fuelGallons, 0),
        estimatedDurationMinutes: Math.round(toNumberInput(durationMinutes, 0)),
        revenueUsd: toNumberInput(revenueUsd, 0),
        variableCostUsd: toNumberInput(variableCostUsd, 0),
      },
      controls: {
        fuelPricePerGallon: toNumberInput(fuelPricePerGallon, 0),
        driverHourlyCost: toNumberInput(driverHourlyCost, 0),
        overheadUsd: toNumberInput(overheadUsd, 0),
        marginTarget: toNumberInput(marginTargetPct, 0) / 100,
        fuelWeight: toNumberInput(fuelWeight, 0),
        timeWeight: toNumberInput(timeWeight, 0),
      },
    };
  }, [
    distanceMiles,
    driverHourlyCost,
    durationMinutes,
    fuelGallons,
    fuelPricePerGallon,
    fuelWeight,
    marginTargetPct,
    origin,
    overheadUsd,
    revenueUsd,
    routeLabel,
    destination,
    timeWeight,
    variableCostUsd,
  ]);

  const loadRuns = useCallback(async () => {
    if (!authToken) {
      setRuns([]);
      return;
    }

    const response = await fetch("/api/dispatch/runs?limit=20", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const body = (await response.json()) as
      | DispatchRunListResponse
      | { error?: string; message?: string };

    if (!response.ok) {
      throw new Error(readApiError(body, "Failed to load runs."));
    }

    setRuns((body as DispatchRunListResponse).runs);
  }, [authToken]);

  const loadBasinSummary = useCallback(async () => {
    if (!authToken) {
      setBasinSummary(null);
      return;
    }

    const response = await fetch("/api/dispatch/basins?days=30&limit=250", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const body = (await response.json()) as
      | BasinSummaryResponse
      | { error?: string; message?: string };

    if (!response.ok) {
      throw new Error(readApiError(body, "Failed to load basin summary."));
    }

    setBasinSummary(body as BasinSummaryResponse);
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      return;
    }

    let cancelled = false;

    const prime = async () => {
      try {
        await Promise.all([loadRuns(), loadBasinSummary()]);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Failed to load optimizer data.";
        setStatusMessage(message);
      }
    };

    void prime();

    return () => {
      cancelled = true;
    };
  }, [authToken, loadBasinSummary, loadRuns]);

  const handleScoreRoute = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!authToken) {
      setStatusMessage("Sign in from /dashboard before using optimizer.");
      return;
    }

    setScoreLoading(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/dispatch/score", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as ScoreResponse | { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(readApiError(body, "Failed to score route."));
      }

      const scored = body as ScoreResponse;
      setResult(scored.result);
      setLatestScoreAt(scored.scoredAt);
      setLatestRunId(null);
      setStatusMessage("Route scored. Review residuals/falsifiers before dispatch.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to score route.";
      setStatusMessage(message);
    } finally {
      setScoreLoading(false);
    }
  };

  const handleScoreAndSave = async () => {
    if (!authToken) {
      setStatusMessage("Sign in from /dashboard before saving runs.");
      return;
    }

    setSaveLoading(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/dispatch/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          runLabel: routeLabel,
          route: payload.route,
          controls: payload.controls,
          saveRoute: true,
        }),
      });

      const body = (await response.json()) as
        | SavedRunResponse
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(body, "Failed to save run."));
      }

      const saved = body as SavedRunResponse;
      setResult(saved.result);
      setLatestRunId(saved.runId);
      setLatestScoreAt(saved.createdAt);
      await Promise.all([loadRuns(), loadBasinSummary()]);
      setStatusMessage("Run scored and saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save run.";
      setStatusMessage(message);
    } finally {
      setSaveLoading(false);
    }
  };

  const refreshAll = async () => {
    if (!authToken) {
      return;
    }

    setRefreshLoading(true);
    setStatusMessage(null);

    try {
      await Promise.all([loadRuns(), loadBasinSummary()]);
      setStatusMessage("Dispatch optimizer data refreshed.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to refresh optimizer data.";
      setStatusMessage(message);
    } finally {
      setRefreshLoading(false);
    }
  };

  if (authLoading) {
    return <p className="text-sm text-zinc-600">Loading authentication...</p>;
  }

  if (!authToken) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <p className="text-sm text-zinc-700">
          You need to sign in from the dashboard to run dispatch scoring.
        </p>
        <Link href="/dashboard" className="mt-3 inline-block text-sm text-blue-600 underline">
          Go to dashboard sign-in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">Route + Margin Optimizer</h2>
            <p className="text-sm text-zinc-600">
              Dispatch scoring with κ-band drift control (1/64 to 1/32) and residual budgets.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={refreshLoading}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {refreshLoading ? "Refreshing..." : "Refresh runs"}
          </button>
        </div>

        <form onSubmit={handleScoreRoute} className="mt-4 grid gap-4">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Run label</span>
              <input
                value={routeLabel}
                onChange={(event) => setRouteLabel(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Origin</span>
              <input
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Destination</span>
              <input
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Distance (mi)</span>
              <input
                type="number"
                min={1}
                step="0.1"
                value={distanceMiles}
                onChange={(event) => setDistanceMiles(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Fuel (gal)</span>
              <input
                type="number"
                min={0}
                step="0.1"
                value={fuelGallons}
                onChange={(event) => setFuelGallons(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Duration (min)</span>
              <input
                type="number"
                min={5}
                step="1"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Revenue (USD)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={revenueUsd}
                onChange={(event) => setRevenueUsd(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Variable cost (USD)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={variableCostUsd}
                onChange={(event) => setVariableCostUsd(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-6">
            <label className="space-y-1 text-sm md:col-span-1">
              <span className="font-medium">Fuel $/gal</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={fuelPricePerGallon}
                onChange={(event) => setFuelPricePerGallon(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span className="font-medium">Driver $/hr</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={driverHourlyCost}
                onChange={(event) => setDriverHourlyCost(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span className="font-medium">Overhead (USD)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={overheadUsd}
                onChange={(event) => setOverheadUsd(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span className="font-medium">Margin target %</span>
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={marginTargetPct}
                onChange={(event) => setMarginTargetPct(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span className="font-medium">Fuel weight</span>
              <input
                type="number"
                min={0}
                max={1}
                step="0.01"
                value={fuelWeight}
                onChange={(event) => setFuelWeight(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span className="font-medium">Time weight</span>
              <input
                type="number"
                min={0}
                max={1}
                step="0.01"
                value={timeWeight}
                onChange={(event) => setTimeWeight(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={scoreLoading}
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {scoreLoading ? "Scoring..." : "Score route"}
            </button>
            <button
              type="button"
              disabled={saveLoading}
              onClick={() => void handleScoreAndSave()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {saveLoading ? "Saving..." : "Score + save run"}
            </button>
          </div>
        </form>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase text-zinc-500">Sample size</p>
          <p className="text-xl font-semibold">{runs.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase text-zinc-500">Valid frame rate</p>
          <p className="text-xl font-semibold">
            {basinSummary ? `${(basinSummary.stats.validRate * 100).toFixed(1)}%` : "-"}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase text-zinc-500">Avg drift</p>
          <p className="text-xl font-semibold">
            {basinSummary ? basinSummary.stats.avgDrift.toFixed(4) : "-"}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase text-zinc-500">Avg residual</p>
          <p className="text-xl font-semibold">
            {basinSummary ? basinSummary.stats.avgResidual.toFixed(4) : "-"}
          </p>
        </div>
      </section>

      {result && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Latest BBR claim readout</h3>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold">
              Decision: {result.decision}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-600">
            Last score: {formatDate(latestScoreAt)} {latestRunId ? `| runId=${latestRunId}` : ""}
          </p>

          <div className="mt-3 grid gap-3 md:grid-cols-4 text-sm">
            <div className="rounded-lg border border-zinc-200 p-3">
              Profit: {asCurrency(result.economics.profitUsd)}
            </div>
            <div className="rounded-lg border border-zinc-200 p-3">
              Margin: {(result.economics.margin * 100).toFixed(2)}%
            </div>
            <div className="rounded-lg border border-zinc-200 p-3">
              Drift: {result.drift.toFixed(5)} ({result.phase})
            </div>
            <div className="rounded-lg border border-zinc-200 p-3">
              Residual: {result.residual.aggregate.toFixed(5)} / {result.residual.budget.toFixed(5)}
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3 text-xs">
            <div className="rounded-lg border border-zinc-200 p-3">
              <p className="font-semibold">Π-space</p>
              <p>Π1={result.piSpace.pi1.toFixed(5)}</p>
              <p>Π2={result.piSpace.pi2.toFixed(5)}</p>
              <p>Π3={result.piSpace.pi3.toFixed(5)}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3">
              <p className="font-semibold">Threshold test</p>
              <p>
                estimate={result.thresholdHypothesis.estimate.toFixed(5)} CI=[
                {result.thresholdHypothesis.ciLow.toFixed(5)},
                {result.thresholdHypothesis.ciHigh.toFixed(5)}]
              </p>
              <p>cv stability={result.thresholdHypothesis.cvStability.toFixed(5)}</p>
              <p>
                negative control drift={result.thresholdHypothesis.negativeControlDrift.toFixed(5)}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3">
              <p className="font-semibold">Residual features</p>
              <p>margin_target_error={result.residual.byFeature.marginTargetError.toFixed(5)}</p>
              <p>drift_penalty={result.residual.byFeature.driftPenalty.toFixed(5)}</p>
              <p>score_penalty={result.residual.byFeature.scorePenalty.toFixed(5)}</p>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-zinc-200 p-3 text-xs">
            <p className="font-semibold">Falsifiers</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {result.claim.falsifiers.map((falsifier) => (
                <li key={falsifier.id} className={falsifier.triggered ? "text-red-600" : "text-zinc-700"}>
                  [{falsifier.triggered ? "TRIGGERED" : "clear"}] {falsifier.statement}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h3 className="text-lg font-semibold">Recent dispatch runs</h3>
        <p className="text-xs text-zinc-600">
          Basin summary: {Object.entries(basinSummary?.basinCounts ?? {})
            .map(([key, value]) => `${key}=${value}`)
            .join(" | ") || "No runs yet."}
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left">
                <th className="px-2 py-2 font-semibold">Created</th>
                <th className="px-2 py-2 font-semibold">Label</th>
                <th className="px-2 py-2 font-semibold">Profit</th>
                <th className="px-2 py-2 font-semibold">Margin</th>
                <th className="px-2 py-2 font-semibold">Drift</th>
                <th className="px-2 py-2 font-semibold">Residual</th>
                <th className="px-2 py-2 font-semibold">Basin</th>
                <th className="px-2 py-2 font-semibold">Decision</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-zinc-500" colSpan={8}>
                    No dispatch runs yet. Score + save one to build basin telemetry.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.id} className="border-b border-zinc-100">
                    <td className="px-2 py-2">{formatDate(run.createdAt)}</td>
                    <td className="px-2 py-2">{run.runLabel ?? run.route?.label ?? "-"}</td>
                    <td className="px-2 py-2">{asCurrency(run.predictedProfitUsd)}</td>
                    <td className="px-2 py-2">
                      {typeof run.predictedMargin === "number"
                        ? `${(run.predictedMargin * 100).toFixed(2)}%`
                        : "-"}
                    </td>
                    <td className="px-2 py-2">{run.drift?.toFixed(5) ?? "-"}</td>
                    <td className="px-2 py-2">{run.residual?.toFixed(5) ?? "-"}</td>
                    <td className="px-2 py-2">{run.basin}</td>
                    <td className="px-2 py-2">{run.decision}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {statusMessage && (
        <section className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {statusMessage}
        </section>
      )}
    </div>
  );
}
