import { NextResponse } from "next/server";
import { z } from "zod";

import { hashTextInputs, newEventId } from "@/lib/audit-utils";
import { ApiAuthError, requireApiUser } from "@/lib/auth";
import {
  BillHistoryQueryError,
  getBillHistoryForUser,
} from "@/lib/bills/history-query";
import { buildCsv, buildPdf } from "@/lib/reports/export-builders";
import { isDebugRequest } from "@/lib/debug";

export const runtime = "nodejs";

const querySchema = z.object({
  propertyId: z.string().uuid().optional(),
  provider: z.string().max(120).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  format: z.enum(["csv", "pdf"]).default("csv"),
  limit: z.coerce.number().int().min(1).max(500).default(250),
});

function toIsoDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(request);
    const url = new URL(request.url);
    const query = querySchema.parse({
      propertyId: url.searchParams.get("propertyId") ?? undefined,
      provider: url.searchParams.get("provider") ?? undefined,
      dateFrom: url.searchParams.get("dateFrom") ?? undefined,
      dateTo: url.searchParams.get("dateTo") ?? undefined,
      format: url.searchParams.get("format") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const rows = await getBillHistoryForUser({
      userId: user.id,
      propertyId: query.propertyId,
      provider: query.provider,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      limit: query.limit,
    });

    const verificationId = newEventId("export");
    const verificationChecksum = hashTextInputs(rows.map((row) => row.id));

    const scope = query.propertyId
      ? safeFilenamePart(query.propertyId)
      : "all-properties";
    const stamp = toIsoDateString();

    if (query.format === "csv") {
      const csv = buildCsv(rows, { verificationId, verificationChecksum });
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="billpilot-${scope}-${stamp}.csv"`,
          "Cache-Control": "no-store",
          "X-Billpilot-Verification": `${verificationId}:${verificationChecksum}`,
          ...(isDebugRequest(request)
            ? { "X-Billpilot-Debug": JSON.stringify({ verificationId, verificationChecksum }) }
            : {}),
        },
      });
    }

    const pdf = await buildPdf(rows, { verificationId, verificationChecksum });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="billpilot-${scope}-${stamp}.pdf"`,
        "Cache-Control": "no-store",
        "X-Billpilot-Verification": `${verificationId}:${verificationChecksum}`,
        ...(isDebugRequest(request)
          ? { "X-Billpilot-Debug": JSON.stringify({ verificationId, verificationChecksum }) }
          : {}),
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

