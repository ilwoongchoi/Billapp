import { NextResponse } from "next/server";
import { z } from "zod";

import { buildAnalyticsSummary } from "@/lib/analytics/summary";
import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { BillHistoryQueryError, getBillHistoryForUser } from "@/lib/bills/history-query";

export const runtime = "nodejs";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  propertyId: z.string().uuid().optional(),
  provider: z.string().max(120).optional(),
  dateFrom: z.string().regex(datePattern, "Expected YYYY-MM-DD").optional(),
  dateTo: z.string().regex(datePattern, "Expected YYYY-MM-DD").optional(),
  limit: z.coerce.number().int().min(1).max(500).default(120),
});

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(request);
    const url = new URL(request.url);
    const filters = querySchema.parse({
      propertyId: url.searchParams.get("propertyId") ?? undefined,
      provider: url.searchParams.get("provider") ?? undefined,
      dateFrom: url.searchParams.get("dateFrom") ?? undefined,
      dateTo: url.searchParams.get("dateTo") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const rows = await getBillHistoryForUser({
      userId: user.id,
      propertyId: filters.propertyId,
      provider: filters.provider,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      limit: filters.limit,
    });

    const { summary, series, forecast } = buildAnalyticsSummary(rows);
    return NextResponse.json({
      filters,
      summary,
      series,
      forecast,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (error instanceof BillHistoryQueryError) {
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
