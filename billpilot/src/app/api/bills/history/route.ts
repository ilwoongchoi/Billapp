import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import {
  BillHistoryQueryError,
  getBillHistoryCountForUser,
  getBillHistoryForUser,
} from "@/lib/bills/history-query";

export const runtime = "nodejs";

const querySchema = z.object({
  propertyId: z.string().uuid().optional(),
  provider: z.string().max(120).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(request);
    const url = new URL(request.url);
    const query = querySchema.parse({
      propertyId: url.searchParams.get("propertyId") ?? undefined,
      provider: url.searchParams.get("provider") ?? undefined,
      dateFrom: url.searchParams.get("dateFrom") ?? undefined,
      dateTo: url.searchParams.get("dateTo") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const [bills, total] = await Promise.all([
      getBillHistoryForUser({
        userId: user.id,
        propertyId: query.propertyId,
        provider: query.provider,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        limit: query.limit,
        offset: query.offset,
      }),
      getBillHistoryCountForUser({
        userId: user.id,
        propertyId: query.propertyId,
        provider: query.provider,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      }),
    ]);

    const hasMore = query.offset + bills.length < total;

    return NextResponse.json({
      bills,
      page: {
        limit: query.limit,
        offset: query.offset,
        total,
        hasMore,
      },
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
