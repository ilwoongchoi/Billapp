import { NextResponse } from "next/server";

import {
  buildMonthlyReport,
  getPreviousMonthRange,
  sendMonthlyReportEmail,
} from "@/lib/reports/monthly";
import {
  listDueMonthlyReportSettings,
  logReportDelivery,
  updateMonthlyReportLastSent,
} from "@/lib/reports/settings";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

function hasSentThisUtcMonth(lastSentAt: string | null, now: Date): boolean {
  if (!lastSentAt) {
    return false;
  }
  const sent = new Date(lastSentAt);
  if (Number.isNaN(sent.getTime())) {
    return false;
  }

  return (
    sent.getUTCFullYear() === now.getUTCFullYear() &&
    sent.getUTCMonth() === now.getUTCMonth()
  );
}

async function getUserEmail(userId: string): Promise<string | null> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data } = await supabase.auth.admin.getUserById(userId);
  return data.user?.email ?? null;
}

async function getPropertyName(userId: string, propertyId: string | null): Promise<string | null> {
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
  const url = new URL(request.url);
  const providedSecret =
    request.headers.get("x-cron-secret") ?? url.searchParams.get("secret");
  const expectedSecret =
    process.env.MONTHLY_REPORT_CRON_SECRET ?? process.env.CRON_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      {
        error: "cron_secret_missing",
        message: "Set MONTHLY_REPORT_CRON_SECRET (or CRON_SECRET) in env.",
      },
      { status: 500 },
    );
  }

  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const day = now.getUTCDate();
  const dueSettings = await listDueMonthlyReportSettings(day);
  const monthRange = getPreviousMonthRange(now);

  const result = {
    processed: dueSettings.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    month: monthRange.monthKey,
    details: [] as Array<{ userId: string; status: string; message: string }>,
  };

  for (const setting of dueSettings) {
    if (hasSentThisUtcMonth(setting.lastSentAt, now)) {
      result.skipped += 1;
      result.details.push({
        userId: setting.userId,
        status: "skipped",
        message: "Already sent this month.",
      });
      continue;
    }

    const email = await getUserEmail(setting.userId);
    if (!email) {
      result.failed += 1;
      await logReportDelivery({
        userId: setting.userId,
        settingId: setting.id,
        status: "error",
        format: setting.format,
        monthKey: monthRange.monthKey,
        rowCount: 0,
        providerFilter: setting.providerFilter,
        propertyId: setting.propertyId,
        errorMessage: "Missing user email.",
      });
      result.details.push({
        userId: setting.userId,
        status: "error",
        message: "Missing user email.",
      });
      continue;
    }

    try {
      const report = await buildMonthlyReport({
        userId: setting.userId,
        format: setting.format,
        range: monthRange,
        propertyId: setting.propertyId,
        providerFilter: setting.providerFilter,
        limit: 800,
      });
      const propertyName = await getPropertyName(setting.userId, setting.propertyId);

      const emailResult = await sendMonthlyReportEmail({
        to: email,
        report,
        propertyName,
        providerFilter: setting.providerFilter,
      });

      const sentAt = new Date().toISOString();
      await updateMonthlyReportLastSent(setting.userId, sentAt);
      await logReportDelivery({
        userId: setting.userId,
        settingId: setting.id,
        status: "sent",
        format: setting.format,
        monthKey: monthRange.monthKey,
        rowCount: report.rows.length,
        providerFilter: setting.providerFilter,
        propertyId: setting.propertyId,
        metadata: {
          resendId: (emailResult.data as { id?: string } | null)?.id ?? null,
          rangeLabel: monthRange.label,
        },
      });

      result.sent += 1;
      result.details.push({
        userId: setting.userId,
        status: "sent",
        message: `Sent ${report.rows.length} rows.`,
      });
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : "unknown_error";

      await logReportDelivery({
        userId: setting.userId,
        settingId: setting.id,
        status: "error",
        format: setting.format,
        monthKey: monthRange.monthKey,
        rowCount: 0,
        providerFilter: setting.providerFilter,
        propertyId: setting.propertyId,
        errorMessage: message,
      });

      result.details.push({
        userId: setting.userId,
        status: "error",
        message,
      });
    }
  }

  return NextResponse.json(result);
}

