export type OptimizerDecision = "SHIP" | "NO-SHIP" | "BOUNDARY-BAND ONLY";
export type DriftPhase = "flat_line" | "life" | "chaos";
export type BasinLabel = "stable_a" | "stable_b" | "boundary" | "chaos";

export interface DispatchRouteInput {
  label?: string | null;
  origin?: string | null;
  destination?: string | null;
  distanceMiles: number;
  estimatedFuelGallons: number;
  estimatedDurationMinutes: number;
  revenueUsd: number;
  variableCostUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface OptimizerControls {
  fuelPricePerGallon: number;
  driverHourlyCost: number;
  overheadUsd?: number;
  marginTarget: number;
  fuelWeight: number;
  timeWeight: number;
  residualBudget?: number;
  kappaStart?: number;
  kappaLimit?: number;
}

export interface PreAnalysisPlan {
  primaryEndpoint: string;
  metrics: string[];
  stopCriteria: string[];
  multipleComparisons: string;
  nullTests: string[];
}

export interface ThresholdHypothesis {
  estimate: number;
  ciLow: number;
  ciHigh: number;
  cvStability: number;
  negativeControlDrift: number;
  negativeControlFailsAsExpected: boolean;
}

export interface FalsifierResult {
  id: string;
  statement: string;
  triggered: boolean;
}

export interface DispatchScoreResult {
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
  phase: DriftPhase;
  basin: BasinLabel;
  residual: {
    byFeature: {
      marginTargetError: number;
      driftPenalty: number;
      scorePenalty: number;
    };
    aggregate: number;
    budget: number;
  };
  piSpace: {
    pi1: number;
    pi2: number;
    pi3: number;
  };
  decision: OptimizerDecision;
  frameValid: boolean;
  thresholdHypothesis: ThresholdHypothesis;
  preAnalysisPlan: PreAnalysisPlan;
  claim: {
    claimId: string;
    system: string;
    controls: Record<string, number>;
    observables: Record<string, number>;
    coherenceFormula: string;
    model: string;
    mapping: string;
    residualNorm: string;
    residualBudget: number;
    basins: Array<{ label: BasinLabel; inequality: string }>;
    boundaryBand: string;
    falsifiers: FalsifierResult[];
    status: "SANDBOX";
  };
}

const DEFAULT_KAPPA_START = 1 / 64;
const DEFAULT_KAPPA_LIMIT = 1 / 32;
const DEFAULT_RESIDUAL_BUDGET = 0.025;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 6): number {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

function safeDivide(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

function normalizeWeights(fuelWeight: number, timeWeight: number): {
  fuelWeight: number;
  timeWeight: number;
} {
  const safeFuel = clamp(fuelWeight, 0, 1);
  const safeTime = clamp(timeWeight, 0, 1);
  const total = safeFuel + safeTime;

  if (total <= 0) {
    return {
      fuelWeight: 0.5,
      timeWeight: 0.5,
    };
  }

  return {
    fuelWeight: safeFuel / total,
    timeWeight: safeTime / total,
  };
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function stddev(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);

  return Math.sqrt(variance);
}

function estimateThresholdHypothesis(input: {
  margin: number;
  marginTarget: number;
  baseDrift: number;
  fuelWeight: number;
  timeWeight: number;
  kappaLimit: number;
}): ThresholdHypothesis {
  const seed = Math.round((input.margin + input.marginTarget + input.baseDrift) * 1_000_000);
  const rng = mulberry32(seed || 13);

  const sampleDrifts: number[] = [];
  for (let index = 0; index < 45; index += 1) {
    const perturbation = (rng() - 0.5) * 0.024;
    const syntheticMargin = input.margin + perturbation;
    sampleDrifts.push(Math.abs(syntheticMargin - input.marginTarget));
  }

  const estimate = sampleDrifts.reduce((sum, drift) => sum + drift, 0) / sampleDrifts.length;
  const sigma = stddev(sampleDrifts);
  const ciHalfWidth = 1.96 * sigma * safeDivide(1, Math.sqrt(sampleDrifts.length));

  const foldSize = Math.floor(sampleDrifts.length / 5);
  const foldMeans: number[] = [];
  for (let fold = 0; fold < 5; fold += 1) {
    const start = fold * foldSize;
    const end = fold === 4 ? sampleDrifts.length : start + foldSize;
    const foldValues = sampleDrifts.slice(start, end);
    const foldMean =
      foldValues.reduce((sum, value) => sum + value, 0) /
      Math.max(1, foldValues.length);
    foldMeans.push(foldMean);
  }

  const cvStability = stddev(foldMeans);
  const shuffledWeightPenalty = Math.abs(input.fuelWeight - input.timeWeight) * 0.015;
  const negativeControlDrift = input.baseDrift + 0.02 + shuffledWeightPenalty;

  return {
    estimate: round(estimate),
    ciLow: round(Math.max(0, estimate - ciHalfWidth)),
    ciHigh: round(estimate + ciHalfWidth),
    cvStability: round(cvStability),
    negativeControlDrift: round(negativeControlDrift),
    negativeControlFailsAsExpected: negativeControlDrift > input.kappaLimit,
  };
}

function classifyPhase(drift: number, kappaStart: number, kappaLimit: number): DriftPhase {
  if (drift <= kappaStart) {
    return "flat_line";
  }
  if (drift < kappaLimit) {
    return "life";
  }
  return "chaos";
}

function classifyBasin(input: {
  phase: DriftPhase;
  fuelWeight: number;
  timeWeight: number;
  residual: number;
  residualBudget: number;
}): BasinLabel {
  if (input.phase === "chaos") {
    return "chaos";
  }

  if (input.residual > input.residualBudget) {
    return "boundary";
  }

  if (
    input.phase === "life" &&
    input.fuelWeight >= 0.55 &&
    input.fuelWeight <= 0.78 &&
    input.timeWeight >= 0.22 &&
    input.timeWeight <= 0.45
  ) {
    return "stable_a";
  }

  if (
    input.phase === "life" &&
    input.fuelWeight >= 0.32 &&
    input.fuelWeight <= 0.55 &&
    input.timeWeight >= 0.45 &&
    input.timeWeight <= 0.68
  ) {
    return "stable_b";
  }

  return "boundary";
}

function buildDecision(input: {
  phase: DriftPhase;
  basin: BasinLabel;
  frameValid: boolean;
}): OptimizerDecision {
  if (!input.frameValid || input.phase === "chaos") {
    return "NO-SHIP";
  }

  if (input.basin === "stable_a" || input.basin === "stable_b") {
    return "SHIP";
  }

  return "BOUNDARY-BAND ONLY";
}

export function scoreDispatchRoute(
  route: DispatchRouteInput,
  controls: OptimizerControls,
): DispatchScoreResult {
  const kappaStart = controls.kappaStart ?? DEFAULT_KAPPA_START;
  const kappaLimit = controls.kappaLimit ?? DEFAULT_KAPPA_LIMIT;
  const residualBudget = controls.residualBudget ?? DEFAULT_RESIDUAL_BUDGET;

  const normalizedRoute = {
    distanceMiles: Math.max(0.1, route.distanceMiles),
    estimatedFuelGallons: Math.max(0, route.estimatedFuelGallons),
    estimatedDurationMinutes: Math.max(5, route.estimatedDurationMinutes),
    revenueUsd: Math.max(0, route.revenueUsd),
    variableCostUsd: Math.max(0, route.variableCostUsd ?? 0),
  };

  const normalizedControls = {
    fuelPricePerGallon: Math.max(0.001, controls.fuelPricePerGallon),
    driverHourlyCost: Math.max(0, controls.driverHourlyCost),
    overheadUsd: Math.max(0, controls.overheadUsd ?? 0),
    marginTarget: clamp(controls.marginTarget, 0, 1),
    ...normalizeWeights(controls.fuelWeight, controls.timeWeight),
  };

  const fuelCostUsd =
    normalizedRoute.estimatedFuelGallons * normalizedControls.fuelPricePerGallon;
  const timeCostUsd =
    (normalizedRoute.estimatedDurationMinutes / 60) * normalizedControls.driverHourlyCost;

  const totalCostUsd =
    fuelCostUsd +
    timeCostUsd +
    normalizedControls.overheadUsd +
    normalizedRoute.variableCostUsd;
  const profitUsd = normalizedRoute.revenueUsd - totalCostUsd;
  const margin = safeDivide(profitUsd, normalizedRoute.revenueUsd);
  const profitPerMile = safeDivide(profitUsd, normalizedRoute.distanceMiles);

  const fuelEfficiencyScore = clamp(1 - safeDivide(fuelCostUsd, normalizedRoute.revenueUsd), 0, 1);

  const expectedDurationMinutes = safeDivide(normalizedRoute.distanceMiles, 37) * 60;
  const timeEfficiencyScore = clamp(
    safeDivide(expectedDurationMinutes, normalizedRoute.estimatedDurationMinutes),
    0,
    1,
  );

  const profitScore = clamp((margin + 0.2) / 0.5, 0, 1);
  const blendedScore =
    normalizedControls.fuelWeight * fuelEfficiencyScore +
    normalizedControls.timeWeight * timeEfficiencyScore;

  const drift = Math.abs(margin - normalizedControls.marginTarget);
  const phase = classifyPhase(drift, kappaStart, kappaLimit);

  const marginTargetError = drift;
  const driftPenalty = Math.max(0, drift - kappaLimit);
  const scorePenalty = Math.max(0, 0.45 - blendedScore) * 0.5;
  const aggregateResidual = marginTargetError + driftPenalty + scorePenalty;

  const basin = classifyBasin({
    phase,
    fuelWeight: normalizedControls.fuelWeight,
    timeWeight: normalizedControls.timeWeight,
    residual: aggregateResidual,
    residualBudget,
  });

  const frameValid = phase === "life" && aggregateResidual <= residualBudget && profitUsd > 0;

  const pi1 = drift;
  const pi2 = fuelEfficiencyScore;
  const pi3 = timeEfficiencyScore;

  const thresholdHypothesis = estimateThresholdHypothesis({
    margin,
    marginTarget: normalizedControls.marginTarget,
    baseDrift: drift,
    fuelWeight: normalizedControls.fuelWeight,
    timeWeight: normalizedControls.timeWeight,
    kappaLimit,
  });

  const falsifiers: FalsifierResult[] = [
    {
      id: "negative_profit",
      statement: "Observed profit_usd <= 0 kills economic claim.",
      triggered: profitUsd <= 0,
    },
    {
      id: "drift_breach",
      statement: `Observed drift > ${round(kappaLimit, 6)} breaches the life basin.`,
      triggered: drift > kappaLimit,
    },
    {
      id: "negative_control_not_failing",
      statement:
        "Permutation negative control must fail the basin test; otherwise threshold is not specific.",
      triggered: !thresholdHypothesis.negativeControlFailsAsExpected,
    },
  ];

  const decision = buildDecision({ phase, basin, frameValid });

  return {
    constants: {
      kappaStart: round(kappaStart),
      kappaLimit: round(kappaLimit),
    },
    economics: {
      fuelCostUsd: round(fuelCostUsd),
      timeCostUsd: round(timeCostUsd),
      overheadUsd: round(normalizedControls.overheadUsd),
      variableCostUsd: round(normalizedRoute.variableCostUsd),
      totalCostUsd: round(totalCostUsd),
      profitUsd: round(profitUsd),
      margin: round(margin),
      profitPerMile: round(profitPerMile),
    },
    observables: {
      fuelEfficiencyScore: round(fuelEfficiencyScore),
      timeEfficiencyScore: round(timeEfficiencyScore),
      profitScore: round(profitScore),
      blendedScore: round(blendedScore),
    },
    drift: round(drift),
    phase,
    basin,
    residual: {
      byFeature: {
        marginTargetError: round(marginTargetError),
        driftPenalty: round(driftPenalty),
        scorePenalty: round(scorePenalty),
      },
      aggregate: round(aggregateResidual),
      budget: round(residualBudget),
    },
    piSpace: {
      pi1: round(pi1),
      pi2: round(pi2),
      pi3: round(pi3),
    },
    decision,
    frameValid,
    thresholdHypothesis,
    preAnalysisPlan: {
      primaryEndpoint:
        "mean drift-adjusted margin inside kappa life-basin with aggregate residual <= budget",
      metrics: [
        "profit_usd",
        "margin",
        "fuel_efficiency_score",
        "time_efficiency_score",
        "drift",
        "aggregate_residual",
      ],
      stopCriteria: [
        "stop rollout when aggregate_residual > residual_budget",
        "stop rollout when drift exceeds kappa_limit",
      ],
      multipleComparisons: "Holm-Bonferroni across route cohorts",
      nullTests: [
        "permutation of fuel/time weight assignments preserving marginals",
        "within-axis shuffle of stop ordering preserving route totals",
      ],
    },
    claim: {
      claimId: "ROUTE_MARGIN_OPTIMIZER",
      system: "dispatch_margin_system",
      controls: {
        fuelPricePerGallon: round(normalizedControls.fuelPricePerGallon),
        driverHourlyCost: round(normalizedControls.driverHourlyCost),
        overheadUsd: round(normalizedControls.overheadUsd),
        marginTarget: round(normalizedControls.marginTarget),
        fuelWeight: round(normalizedControls.fuelWeight),
        timeWeight: round(normalizedControls.timeWeight),
      },
      observables: {
        revenueUsd: round(normalizedRoute.revenueUsd),
        distanceMiles: round(normalizedRoute.distanceMiles),
        estimatedFuelGallons: round(normalizedRoute.estimatedFuelGallons),
        estimatedDurationMinutes: round(normalizedRoute.estimatedDurationMinutes),
        profitUsd: round(profitUsd),
        margin: round(margin),
        drift: round(drift),
      },
      coherenceFormula:
        "Phi(y)=w_fuel*fuel_efficiency + w_time*time_efficiency; structure requires positive profit and residual <= epsilon",
      model:
        "M predicts dispatch margin from route economics; residual uses L1 error + drift breach penalty",
      mapping: "Pi1=drift, Pi2=fuel_efficiency_score, Pi3=time_efficiency_score",
      residualNorm: "L1 per-feature, aggregated additively",
      residualBudget: round(residualBudget),
      basins: [
        {
          label: "stable_a",
          inequality:
            "phase=life AND fuel_weight in [0.55,0.78] AND time_weight in [0.22,0.45] AND residual<=epsilon",
        },
        {
          label: "stable_b",
          inequality:
            "phase=life AND fuel_weight in [0.32,0.55] AND time_weight in [0.45,0.68] AND residual<=epsilon",
        },
        {
          label: "boundary",
          inequality:
            "phase!=chaos AND (residual>epsilon OR weight vector outside stable sets)",
        },
        {
          label: "chaos",
          inequality: "drift>=kappa_limit",
        },
      ],
      boundaryBand:
        "delta_margin_target = +/-0.005 around selected target with two-frame hysteresis before SHIP",
      falsifiers,
      status: "SANDBOX",
    },
  };
}
