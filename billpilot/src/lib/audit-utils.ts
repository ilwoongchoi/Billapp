import "server-only";

import { randomUUID } from "node:crypto";

export function newEventId(prefix = "evt") {
  return `${prefix}-${randomUUID()}`;
}

export function fnv1aHex(input: string) {
  // Non-crypto deterministic hash (audit correlation only; not a secret).
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function hashDispatchInputs(route: unknown, controls: unknown) {
  const r = route && typeof route === "object" ? (route as Record<string, unknown>) : {};
  const c = controls && typeof controls === "object" ? (controls as Record<string, unknown>) : {};

  const payload = [
    String(r.label ?? ""),
    String(r.distanceMiles ?? ""),
    String(r.estimatedFuelGallons ?? ""),
    String(r.estimatedDurationMinutes ?? ""),
    String(r.revenueUsd ?? ""),
    String(r.variableCostUsd ?? ""),
    String(c.fuelPricePerGallon ?? ""),
    String(c.driverHourlyCost ?? ""),
    String(c.overheadUsd ?? ""),
    String(c.marginTarget ?? ""),
    String(c.fuelWeight ?? ""),
    String(c.timeWeight ?? ""),
    String(c.kappaStart ?? ""),
    String(c.kappaLimit ?? ""),
    String(c.residualBudget ?? ""),
  ].join("|");

  return fnv1aHex(payload);
}

export function hashTextInputs(parts: Array<string | null | undefined>) {
  return fnv1aHex(
    parts
      .map((part) => (part ?? "").trim())
      .join("|")
      .slice(0, 20_000),
  );
}

