import { NextResponse } from "next/server";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getMonthlyReportSetting } from "@/lib/reports/settings";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

interface PropertyRow {
  id: string;
  name: string;
}

interface LogRow {
  id: string;
  sent_at: string;
  status: string;
  format: string;
  month_key: string | null;
  row_count: number;
  property_id: string | null;
  provider_filter: string | null;
  error_message: string | null;
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(request);
    const supabase = getServiceSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        {
          error: "supabase_not_configured",
          message:
            "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.",
        },
        { status: 500 },
      );
    }

    const [setting, propertiesResult, logsResult] = await Promise.all([
      getMonthlyReportSetting(user.id),
      supabase
        .from("properties")
        .select("id, name")
        .eq("user_id", user.id)
        .order("name", { ascending: true }),
      supabase
        .from("report_delivery_logs")
        .select(
          "id, sent_at, status, format, month_key, row_count, property_id, provider_filter, error_message",
        )
        .eq("user_id", user.id)
        .order("sent_at", { ascending: false })
        .limit(15),
    ]);

    return NextResponse.json({
      setting,
      properties: (propertiesResult.data as PropertyRow[] | null) ?? [],
      logs: (logsResult.data as LogRow[] | null) ?? [],
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

