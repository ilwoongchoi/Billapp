import { getServiceSupabaseClient } from "@/lib/supabase";

import { MonthlyReportFormat } from "./monthly";

export interface MonthlyReportSetting {
  id: string | null;
  userId: string;
  enabled: boolean;
  format: MonthlyReportFormat;
  timezone: string;
  dayOfMonth: number;
  propertyId: string | null;
  providerFilter: string | null;
  lastSentAt: string | null;
  updatedAt: string | null;
}

interface SettingsDbRow {
  id: string;
  user_id: string;
  enabled: boolean;
  format: string;
  timezone: string;
  day_of_month: number;
  property_id: string | null;
  provider_filter: string | null;
  last_sent_at: string | null;
  updated_at: string | null;
}

function normalizeFormat(value: string | null | undefined): MonthlyReportFormat {
  return value === "csv" ? "csv" : "pdf";
}

function rowToSetting(row: SettingsDbRow): MonthlyReportSetting {
  return {
    id: row.id,
    userId: row.user_id,
    enabled: row.enabled,
    format: normalizeFormat(row.format),
    timezone: row.timezone,
    dayOfMonth: row.day_of_month,
    propertyId: row.property_id,
    providerFilter: row.provider_filter,
    lastSentAt: row.last_sent_at,
    updatedAt: row.updated_at,
  };
}

export function defaultMonthlyReportSetting(userId: string): MonthlyReportSetting {
  return {
    id: null,
    userId,
    enabled: false,
    format: "pdf",
    timezone: "UTC",
    dayOfMonth: 1,
    propertyId: null,
    providerFilter: null,
    lastSentAt: null,
    updatedAt: null,
  };
}

export async function getMonthlyReportSetting(
  userId: string,
): Promise<MonthlyReportSetting> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return defaultMonthlyReportSetting(userId);
  }

  const { data } = await supabase
    .from("monthly_report_settings")
    .select(
      "id, user_id, enabled, format, timezone, day_of_month, property_id, provider_filter, last_sent_at, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    return defaultMonthlyReportSetting(userId);
  }

  return rowToSetting(data as SettingsDbRow);
}

export async function upsertMonthlyReportSetting(input: {
  userId: string;
  enabled: boolean;
  format: MonthlyReportFormat;
  timezone: string;
  dayOfMonth: number;
  propertyId: string | null;
  providerFilter: string | null;
}): Promise<MonthlyReportSetting> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return {
      ...defaultMonthlyReportSetting(input.userId),
      ...input,
    };
  }

  const { data, error } = await supabase
    .from("monthly_report_settings")
    .upsert(
      {
        user_id: input.userId,
        enabled: input.enabled,
        format: input.format,
        timezone: input.timezone,
        day_of_month: input.dayOfMonth,
        property_id: input.propertyId,
        provider_filter: input.providerFilter,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select(
      "id, user_id, enabled, format, timezone, day_of_month, property_id, provider_filter, last_sent_at, updated_at",
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save monthly report settings.");
  }

  return rowToSetting(data as SettingsDbRow);
}

export async function listDueMonthlyReportSettings(
  utcDayOfMonth: number,
): Promise<MonthlyReportSetting[]> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("monthly_report_settings")
    .select(
      "id, user_id, enabled, format, timezone, day_of_month, property_id, provider_filter, last_sent_at, updated_at",
    )
    .eq("enabled", true)
    .eq("day_of_month", utcDayOfMonth);

  if (error || !data) {
    return [];
  }

  return (data as SettingsDbRow[]).map(rowToSetting);
}

export async function updateMonthlyReportLastSent(
  userId: string,
  sentAtIso: string,
) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase
    .from("monthly_report_settings")
    .update({
      last_sent_at: sentAtIso,
      updated_at: sentAtIso,
    })
    .eq("user_id", userId);
}

export async function logReportDelivery(input: {
  userId: string;
  settingId: string | null;
  status: "sent" | "error";
  format: MonthlyReportFormat;
  monthKey: string;
  rowCount: number;
  providerFilter: string | null;
  propertyId: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase.from("report_delivery_logs").insert({
    user_id: input.userId,
    setting_id: input.settingId,
    status: input.status,
    format: input.format,
    month_key: input.monthKey,
    row_count: input.rowCount,
    provider_filter: input.providerFilter,
    property_id: input.propertyId,
    error_message: input.errorMessage ?? null,
    metadata: input.metadata ?? {},
  });
}

