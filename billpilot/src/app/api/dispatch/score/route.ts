import { NextResponse } from "next/server";
import { z } from "zod";

import { hashDispatchInputs, newEventId } from "@/lib/audit-utils";
import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { scoreDispatchRoute } from "@/lib/dispatch/optimizer";

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

const payloadSchema = z.object({
  route: routeSchema,
  controls: controlSchema,
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);
    const payload = payloadSchema.parse(await request.json());

    const result = scoreDispatchRoute(payload.route, payload.controls);
    const eventId = newEventId("dispatch");
    const inputHash = hashDispatchInputs(payload.route, payload.controls);
    const modelVersion = process.env.BILLPILOT_MODEL_VERSION || "billpilot-mvp";

    return NextResponse.json({
      userId: user.id,
      scoredAt: new Date().toISOString(),
      modelVersion,
      eventId,
      inputHash,
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
