import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const querySchema = z.object({
  leadLimit: z.coerce.number().int().min(5).max(200).default(40),
  bookingLimit: z.coerce.number().int().min(5).max(200).default(30),
});

interface BusinessRow {
  id: string;
  business_name: string;
  timezone: string;
  twilio_phone_number: string | null;
  updated_at: string;
}

interface LeadRow {
  id: string;
  customer_id: string | null;
  status: "new" | "qualified" | "booked" | "lost";
  source: "phone" | "sms" | "web" | "manual";
  summary: string | null;
  estimated_value: number | null;
  first_contact_at: string;
  last_activity_at: string;
  created_at: string;
}

interface LeadStatusRow {
  status: "new" | "qualified" | "booked" | "lost";
  first_contact_at: string;
}

interface CustomerRow {
  id: string;
  full_name: string | null;
  phone_e164: string;
  email: string | null;
}

interface ConversationStateRow {
  state: "open" | "closed" | "handoff";
}

interface AIRunRow {
  outcome: "completed" | "fallback" | "handoff" | "failed";
  drift_score: number | null;
}

interface BookingRow {
  id: string;
  customer_id: string | null;
  lead_id: string | null;
  service_type_id: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rescheduled";
  notes: string | null;
  created_at: string;
}

interface ServiceTypeRow {
  id: string;
  name: string;
  default_duration_minutes: number;
}

function readError(error: { message?: string } | null | undefined, fallback: string): string {
  return error?.message ?? fallback;
}

function getUtcDayStartIso(reference: Date): string {
  return new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()),
  ).toISOString();
}

function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits));
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

    const url = new URL(request.url);
    const query = querySchema.parse({
      leadLimit: url.searchParams.get("leadLimit") ?? undefined,
      bookingLimit: url.searchParams.get("bookingLimit") ?? undefined,
    });

    const now = new Date();
    const nowIso = now.toISOString();
    const dayAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const next7DaysIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const dayStartIso = getUtcDayStartIso(now);

    const [
      businessResult,
      leadsResult,
      leadStatusResult,
      conversationResult,
      aiRunsResult,
      bookingsResult,
      upcomingCountResult,
      customerDirectoryResult,
      serviceTypeDirectoryResult,
    ] = await Promise.all([
      supabase
        .from("service_businesses")
        .select("id, business_name, timezone, twilio_phone_number, updated_at")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("service_leads")
        .select(
          "id, customer_id, status, source, summary, estimated_value, first_contact_at, last_activity_at, created_at",
        )
        .eq("user_id", user.id)
        .order("last_activity_at", { ascending: false })
        .limit(query.leadLimit),
      supabase
        .from("service_leads")
        .select("status, first_contact_at")
        .eq("user_id", user.id),
      supabase
        .from("service_conversations")
        .select("state")
        .eq("user_id", user.id)
        .in("state", ["open", "handoff"]),
      supabase
        .from("service_ai_runs")
        .select("outcome, drift_score")
        .eq("user_id", user.id)
        .gte("created_at", dayAgoIso),
      supabase
        .from("service_bookings")
        .select(
          "id, customer_id, lead_id, service_type_id, scheduled_start, scheduled_end, status, notes, created_at",
        )
        .eq("user_id", user.id)
        .gte("scheduled_start", nowIso)
        .order("scheduled_start", { ascending: true })
        .limit(query.bookingLimit),
      supabase
        .from("service_bookings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("status", ["pending", "confirmed", "rescheduled"])
        .gte("scheduled_start", nowIso)
        .lt("scheduled_start", next7DaysIso),
      supabase
        .from("service_customers")
        .select("id, full_name, phone_e164, email")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(120),
      supabase
        .from("service_types")
        .select("id, name, default_duration_minutes")
        .eq("user_id", user.id)
        .eq("active", true)
        .order("name", { ascending: true })
        .limit(80),
    ]);

    if (businessResult.error) {
      return NextResponse.json(
        {
          error: "business_lookup_failed",
          message: readError(businessResult.error, "Failed to load business profile."),
        },
        { status: 500 },
      );
    }

    if (leadsResult.error) {
      return NextResponse.json(
        {
          error: "lead_list_failed",
          message: readError(leadsResult.error, "Failed to load leads."),
        },
        { status: 500 },
      );
    }

    if (leadStatusResult.error) {
      return NextResponse.json(
        {
          error: "lead_stats_failed",
          message: readError(leadStatusResult.error, "Failed to load lead stats."),
        },
        { status: 500 },
      );
    }

    if (conversationResult.error) {
      return NextResponse.json(
        {
          error: "conversation_stats_failed",
          message: readError(conversationResult.error, "Failed to load conversations."),
        },
        { status: 500 },
      );
    }

    if (aiRunsResult.error) {
      return NextResponse.json(
        {
          error: "ai_run_stats_failed",
          message: readError(aiRunsResult.error, "Failed to load AI run stats."),
        },
        { status: 500 },
      );
    }

    if (bookingsResult.error) {
      return NextResponse.json(
        {
          error: "booking_list_failed",
          message: readError(bookingsResult.error, "Failed to load bookings."),
        },
        { status: 500 },
      );
    }

    if (upcomingCountResult.error) {
      return NextResponse.json(
        {
          error: "booking_stats_failed",
          message: readError(upcomingCountResult.error, "Failed to load booking stats."),
        },
        { status: 500 },
      );
    }

    if (customerDirectoryResult.error) {
      return NextResponse.json(
        {
          error: "customer_directory_failed",
          message: readError(
            customerDirectoryResult.error,
            "Failed to load customer directory.",
          ),
        },
        { status: 500 },
      );
    }

    if (serviceTypeDirectoryResult.error) {
      return NextResponse.json(
        {
          error: "service_type_directory_failed",
          message: readError(
            serviceTypeDirectoryResult.error,
            "Failed to load service type directory.",
          ),
        },
        { status: 500 },
      );
    }

    const business = (businessResult.data as BusinessRow | null) ?? null;
    const leads = (leadsResult.data ?? []) as LeadRow[];
    const allLeadStatuses = (leadStatusResult.data ?? []) as LeadStatusRow[];
    const conversations = (conversationResult.data ?? []) as ConversationStateRow[];
    const aiRuns = (aiRunsResult.data ?? []) as AIRunRow[];
    const bookings = (bookingsResult.data ?? []) as BookingRow[];
    const customerDirectory = (customerDirectoryResult.data ?? []) as CustomerRow[];
    const serviceTypeDirectory = (serviceTypeDirectoryResult.data ?? []) as ServiceTypeRow[];

    const customerIds = new Set<string>();
    for (const lead of leads) {
      if (lead.customer_id) {
        customerIds.add(lead.customer_id);
      }
    }
    for (const booking of bookings) {
      if (booking.customer_id) {
        customerIds.add(booking.customer_id);
      }
    }

    const serviceTypeIds = new Set<string>();
    for (const booking of bookings) {
      if (booking.service_type_id) {
        serviceTypeIds.add(booking.service_type_id);
      }
    }

    const [customerResult, serviceTypeResult] = await Promise.all([
      customerIds.size > 0
        ? supabase
            .from("service_customers")
            .select("id, full_name, phone_e164, email")
            .in("id", Array.from(customerIds))
            .eq("user_id", user.id)
        : Promise.resolve({ data: [], error: null }),
      serviceTypeIds.size > 0
        ? supabase
            .from("service_types")
            .select("id, name, default_duration_minutes")
            .in("id", Array.from(serviceTypeIds))
            .eq("user_id", user.id)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (customerResult.error) {
      return NextResponse.json(
        {
          error: "customer_lookup_failed",
          message: readError(customerResult.error, "Failed to load customers."),
        },
        { status: 500 },
      );
    }

    if (serviceTypeResult.error) {
      return NextResponse.json(
        {
          error: "service_type_lookup_failed",
          message: readError(serviceTypeResult.error, "Failed to load service types."),
        },
        { status: 500 },
      );
    }

    const customerMap = new Map<string, CustomerRow>();
    for (const row of (customerResult.data ?? []) as CustomerRow[]) {
      customerMap.set(row.id, row);
    }

    const serviceTypeMap = new Map<string, ServiceTypeRow>();
    for (const row of (serviceTypeResult.data ?? []) as ServiceTypeRow[]) {
      serviceTypeMap.set(row.id, row);
    }

    const leadStatusCounts = {
      new: 0,
      qualified: 0,
      booked: 0,
      lost: 0,
      today: 0,
    };

    for (const row of allLeadStatuses) {
      if (row.status in leadStatusCounts) {
        leadStatusCounts[row.status as "new" | "qualified" | "booked" | "lost"] += 1;
      }
      if (row.first_contact_at >= dayStartIso) {
        leadStatusCounts.today += 1;
      }
    }

    const openConversations = conversations.filter(
      (row) => row.state === "open",
    ).length;
    const handoffConversations = conversations.filter(
      (row) => row.state === "handoff",
    ).length;

    const driftScores = aiRuns
      .map((row) => row.drift_score)
      .filter((value): value is number => typeof value === "number");

    const avgDrift =
      driftScores.length > 0
        ? roundTo(
            driftScores.reduce((total, value) => total + value, 0) / driftScores.length,
            6,
          )
        : null;

    const handoffRuns = aiRuns.filter((row) => row.outcome === "handoff").length;

    const handoffRate =
      aiRuns.length > 0 ? roundTo(handoffRuns / aiRuns.length, 4) : null;

    const stableThreshold = roundTo(1 / 64, 6);
    const breachThreshold = roundTo(1 / 32, 6);

    let driftBand: "stable_target" | "boundary_band" | "vector_breach" | "no_signal" =
      "no_signal";

    if (avgDrift !== null) {
      if (avgDrift <= stableThreshold) {
        driftBand = "stable_target";
      } else if (avgDrift <= breachThreshold) {
        driftBand = "boundary_band";
      } else {
        driftBand = "vector_breach";
      }
    }

    return NextResponse.json({
      generatedAt: nowIso,
      business,
      kpis: {
        leadsToday: leadStatusCounts.today,
        leadsNew: leadStatusCounts.new,
        leadsQualified: leadStatusCounts.qualified,
        leadsBooked: leadStatusCounts.booked,
        leadsLost: leadStatusCounts.lost,
        openConversations,
        handoffConversations,
        aiRuns24h: aiRuns.length,
        handoffRate24h: handoffRate,
        avgDrift24h: avgDrift,
        driftBand,
        upcomingBookings7d: upcomingCountResult.count ?? 0,
      },
      driftThresholds: {
        stableTarget: stableThreshold,
        breachLimit: breachThreshold,
      },
      directory: {
        customers: customerDirectory,
        serviceTypes: serviceTypeDirectory,
      },
      leads: leads.map((lead) => ({
        id: lead.id,
        status: lead.status,
        source: lead.source,
        summary: lead.summary,
        estimatedValue: lead.estimated_value,
        firstContactAt: lead.first_contact_at,
        lastActivityAt: lead.last_activity_at,
        createdAt: lead.created_at,
        customer: lead.customer_id ? customerMap.get(lead.customer_id) ?? null : null,
      })),
      bookings: bookings.map((booking) => ({
        id: booking.id,
        status: booking.status,
        scheduledStart: booking.scheduled_start,
        scheduledEnd: booking.scheduled_end,
        notes: booking.notes,
        createdAt: booking.created_at,
        customer: booking.customer_id
          ? customerMap.get(booking.customer_id) ?? null
          : null,
        serviceType: booking.service_type_id
          ? serviceTypeMap.get(booking.service_type_id) ?? null
          : null,
      })),
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
