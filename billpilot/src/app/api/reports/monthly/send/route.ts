import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { propertyBelongsToUser } from "@/lib/properties";
import {
  buildMonthlyReport,
  getPreviousMonthRange,
  parseMonthRange,
  sendMonthlyReportEmail,
} from "@/lib/reports/monthly";
import {
  getMonthlyReportSetting,
  logReportDelivery,
  updateMonthlyReportLastSent,
} from "@/lib/reports/settings";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const payloadSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  format: z.enum(["csv", "pdf"]).optional(),
  propertyId: z.string().uuid().nullable().optional(),
  providerFilter: z.string().max(120).nullable().optional(),
});

async function getPropertyName(
  userId: string,
  propertyId: string | null,
): Promise<string | null> {
  if (!propertyId) {
    return null;
  }

  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data } = await supabase
    .from("properties")
    .select("name")
    .eq("id", propertyId)
    .eq("user_id", userId)
    .maybeSingle();

  return (data as { name?: string } | null)?.name ?? null;
}

export async function POST(request: Request) {
  let logContext:
    | {
        userId: string;
        settingId: string | null;
        format: "csv" | "pdf";
        monthKey: string;
        propertyId: string | null;
        providerFilter: string | null;
      }
    | undefined;

  try {
    const user = await requireApiUser(request);
    if (!user.email) {
      return NextResponse.json(
        {
          error: "missing_email",
          message: "Authenticated user has no email. Cannot send report.",
        },
        { status: 400 },
      );
    }

    const body = payloadSchema.parse(await request.json());
    const setting = await getMonthlyReportSetting(user.id);
    const format = body.format ?? setting.format;
    const propertyId = body.propertyId ?? setting.propertyId;
    const providerFilter = body.providerFilter ?? setting.providerFilter;

    if (propertyId) {
      const owned = await propertyBelongsToUser(propertyId, user.id);
      if (!owned) {
        return NextResponse.json(
          {
            error: "forbidden_property",
            message: "Selected property does not belong to this user.",
          },
          { status: 403 },
        );
      }
    }

    const range = body.month
      ? parseMonthRange(body.month)
      : getPreviousMonthRange();

    const report = await buildMonthlyReport({
      userId: user.id,
      format,
      range,
      propertyId,
      providerFilter,
      limit: 600,
    });
    const propertyName = await getPropertyName(user.id, propertyId);

    logContext = {
      userId: user.id,
      settingId: setting.id,
      format,
      monthKey: range.monthKey,
      propertyId,
      providerFilter,
    };

    const emailResult = await sendMonthlyReportEmail({
      to: user.email,
      report,
      propertyName,
      providerFilter,
    });

    const sentAt = new Date().toISOString();
    await updateMonthlyReportLastSent(user.id, sentAt);
    await logReportDelivery({
      userId: user.id,
      settingId: setting.id,
      status: "sent",
      format,
      monthKey: range.monthKey,
      rowCount: report.rows.length,
      providerFilter,
      propertyId,
      metadata: {
        resendId: (emailResult.data as { id?: string } | null)?.id ?? null,
        rangeLabel: range.label,
      },
    });

    return NextResponse.json({
      sent: true,
      month: range.monthKey,
      rows: report.rows.length,
      format,
      propertyId,
      providerFilter,
      resend: emailResult.data ?? null,
    });
  } catch (error) {
    if (logContext) {
      await logReportDelivery({
        userId: logContext.userId,
        settingId: logContext.settingId,
        status: "error",
        format: logContext.format,
        monthKey: logContext.monthKey,
        rowCount: 0,
        providerFilter: logContext.providerFilter,
        propertyId: logContext.propertyId,
        errorMessage: error instanceof Error ? error.message : "unknown_error",
      });
    }

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

