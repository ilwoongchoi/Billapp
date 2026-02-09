import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceSupabaseClient } from "@/lib/supabase";

// Ensure this endpoint always runs with Node.js runtime (process.env available)
// and is never statically cached across deployments.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CORE_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

const FEATURE_KEYS = {
  // Billing can run as a single-plan setup (Starter only). Pro/Team price IDs are optional.
  billing: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_STARTER_PRICE_ID"],
  reports: ["RESEND_API_KEY", "REPORTS_FROM_EMAIL", "MONTHLY_REPORT_CRON_SECRET"],
  reception: [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "RECEPTION_REMINDER_CRON_SECRET",
  ],
} as const;

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function checkEnv(keys: readonly string[]) {
  const missing = keys.filter((key) => !hasValue(process.env[key]));
  return {
    total: keys.length,
    configured: keys.length - missing.length,
    missing,
    ok: missing.length === 0,
  };
}

const RUNTIME_TABLES = [
  "properties",
  "bills",
  "bill_line_items",
  "insights",
  "subscriptions",
  "webhook_events",
  "monthly_report_settings",
  "report_delivery_logs",
  "service_businesses",
  "service_customers",
  "service_types",
  "service_leads",
  "service_conversations",
  "service_messages",
  "service_calls",
  "service_bookings",
  "service_automation_events",
  "service_ai_runs",
  "service_booking_reminders",
  "service_reschedule_requests",
  "dispatch_routes",
  "dispatch_optimizer_runs",
] as const;

async function checkTable(
  supabase: SupabaseClient,
  table: string,
): Promise<{ table: string; ok: boolean; error: string | null }> {
  const { error } = await supabase.from(table).select("id", { head: true }).limit(1);
  return {
    table,
    ok: !error,
    error: error?.message ?? null,
  };
}

async function checkSupabaseRuntime() {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return {
      configured: false,
      ok: false,
      error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      tables: {
        total: RUNTIME_TABLES.length,
        okCount: 0,
        failed: RUNTIME_TABLES.map((table) => ({
          table,
          ok: false,
          error: "supabase_not_configured",
        })),
      },
    };
  }

  const tableChecks = await Promise.all(
    RUNTIME_TABLES.map((table) => checkTable(supabase, table)),
  );
  const failed = tableChecks.filter((check) => !check.ok);

  if (failed.length > 0) {
    return {
      configured: true,
      ok: false,
      error: `One or more required tables are not queryable (${failed.length}/${RUNTIME_TABLES.length} failed).`,
      tables: {
        total: RUNTIME_TABLES.length,
        okCount: RUNTIME_TABLES.length - failed.length,
        failed,
      },
    };
  }

  return {
    configured: true,
    ok: true,
    error: null as string | null,
    tables: {
      total: RUNTIME_TABLES.length,
      okCount: RUNTIME_TABLES.length,
      failed: [] as Array<{ table: string; ok: boolean; error: string | null }>,
    },
  };
}

function buildDeploymentSummary(input: {
  core: ReturnType<typeof checkEnv>;
  billing: ReturnType<typeof checkEnv>;
  billingEnabled: boolean;
  reports: ReturnType<typeof checkEnv>;
  reportsEnabled: boolean;
  reception: ReturnType<typeof checkEnv>;
  receptionEnabled: boolean;
  supabaseRuntime: Awaited<ReturnType<typeof checkSupabaseRuntime>>;
}) {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  if (!input.core.ok) {
    for (const key of input.core.missing) {
      blockingIssues.push(`Missing core env key: ${key}`);
    }
  }

  if (!input.supabaseRuntime.ok) {
    if (input.supabaseRuntime.error) {
      blockingIssues.push(`Supabase runtime: ${input.supabaseRuntime.error}`);
    }
    for (const failed of input.supabaseRuntime.tables.failed) {
      blockingIssues.push(
        `Supabase table check failed (${failed.table}): ${failed.error ?? "unknown_error"}`,
      );
    }
  }

  if (input.billingEnabled && !input.billing.ok) {
    warnings.push(`Billing env incomplete: missing ${input.billing.missing.join(", ")}`);
  }
  if (input.reportsEnabled && !input.reports.ok) {
    warnings.push(`Reports env incomplete: missing ${input.reports.missing.join(", ")}`);
  }
  if (input.receptionEnabled && !input.reception.ok) {
    warnings.push(`Reception env incomplete: missing ${input.reception.missing.join(", ")}`);
  }

  return {
    deployable: blockingIssues.length === 0,
    blockingIssues,
    warnings,
  };
}

export async function GET() {
  const core = checkEnv(CORE_KEYS);

  const billingAnyConfigured = FEATURE_KEYS.billing.some((key) =>
    hasValue(process.env[key]),
  );
  const reportsAnyConfigured = FEATURE_KEYS.reports.some((key) =>
    hasValue(process.env[key]),
  );
  const receptionAnyConfigured = FEATURE_KEYS.reception.some((key) =>
    hasValue(process.env[key]),
  );

  const billing = checkEnv(FEATURE_KEYS.billing);
  const reports = checkEnv(FEATURE_KEYS.reports);
  const reception = checkEnv(FEATURE_KEYS.reception);
  const supabaseRuntime = await checkSupabaseRuntime();
  const deployment = buildDeploymentSummary({
    core,
    billing,
    billingEnabled: billingAnyConfigured,
    reports,
    reportsEnabled: reportsAnyConfigured,
    reception,
    receptionEnabled: receptionAnyConfigured,
    supabaseRuntime,
  });

  const status =
    core.ok && (!supabaseRuntime.configured || supabaseRuntime.ok)
      ? "ok"
      : "degraded";

  const payload = {
    status,
    timestamp: new Date().toISOString(),
    core,
    features: {
      billing: {
        enabled: billingAnyConfigured,
        ...billing,
      },
      reports: {
        enabled: reportsAnyConfigured,
        ...reports,
      },
      reception: {
        enabled: receptionAnyConfigured,
        ...reception,
      },
    },
    runtime: {
      supabase: supabaseRuntime,
    },
    deployment,
  };

  return NextResponse.json(payload, { status: status === "ok" ? 200 : 503 });
}
