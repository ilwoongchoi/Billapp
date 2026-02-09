import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const statusValues = [
  "pending",
  "options_sent",
  "confirmed",
  "handoff",
  "closed",
] as const;

const querySchema = z.object({
  status: z.enum(["all", ...statusValues]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

interface RequestRow {
  id: string;
  booking_id: string;
  customer_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  status: (typeof statusValues)[number];
  requested_at: string;
  resolved_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  sla_due_at: string | null;
  escalation_level: number;
  last_escalated_at: string | null;
  latest_customer_message: string | null;
  option_batch: number;
  selected_option_index: number | null;
  selected_start: string | null;
  selected_end: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface BookingRow {
  id: string;
  customer_id: string | null;
  service_type_id: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rescheduled";
}

interface CustomerRow {
  id: string;
  full_name: string | null;
  phone_e164: string;
}

interface ServiceTypeRow {
  id: string;
  name: string;
}

function statusCounts(rows: RequestRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
}

function isActionRequiredStatus(status: RequestRow["status"]): boolean {
  return status === "pending" || status === "options_sent" || status === "handoff";
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
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    let reqQuery = supabase
      .from("service_reschedule_requests")
      .select(
        "id, booking_id, customer_id, lead_id, conversation_id, status, requested_at, resolved_at, assigned_to, assigned_at, sla_due_at, escalation_level, last_escalated_at, latest_customer_message, option_batch, selected_option_index, selected_start, selected_end, metadata, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .order("requested_at", { ascending: false })
      .limit(query.limit);

    if (query.status !== "all") {
      reqQuery = reqQuery.eq("status", query.status);
    }

    const { data: requestData, error: requestError } = await reqQuery;

    if (requestError) {
      return NextResponse.json(
        {
          error: "reschedule_requests_failed",
          message: requestError.message,
        },
        { status: 500 },
      );
    }

    const requests = (requestData ?? []) as RequestRow[];
    const bookingIds = Array.from(new Set(requests.map((row) => row.booking_id)));
    const customerIds = Array.from(
      new Set(requests.map((row) => row.customer_id).filter(Boolean)),
    ) as string[];

    const { data: bookingData, error: bookingError } =
      bookingIds.length > 0
        ? await supabase
            .from("service_bookings")
            .select(
              "id, customer_id, service_type_id, scheduled_start, scheduled_end, status",
            )
            .eq("user_id", user.id)
            .in("id", bookingIds)
        : { data: [], error: null };

    if (bookingError) {
      return NextResponse.json(
        {
          error: "reschedule_bookings_failed",
          message: bookingError.message,
        },
        { status: 500 },
      );
    }

    const bookings = (bookingData ?? []) as BookingRow[];
    const bookingMap = new Map<string, BookingRow>();
    for (const booking of bookings) {
      bookingMap.set(booking.id, booking);
    }

    for (const booking of bookings) {
      if (booking.customer_id) {
        customerIds.push(booking.customer_id);
      }
    }

    const uniqueCustomerIds = Array.from(new Set(customerIds));
    const serviceTypeIds = Array.from(
      new Set(bookings.map((booking) => booking.service_type_id).filter(Boolean)),
    ) as string[];

    const [customerResult, serviceTypeResult] = await Promise.all([
      uniqueCustomerIds.length > 0
        ? supabase
            .from("service_customers")
            .select("id, full_name, phone_e164")
            .eq("user_id", user.id)
            .in("id", uniqueCustomerIds)
        : Promise.resolve({ data: [], error: null }),
      serviceTypeIds.length > 0
        ? supabase
            .from("service_types")
            .select("id, name")
            .eq("user_id", user.id)
            .in("id", serviceTypeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (customerResult.error) {
      return NextResponse.json(
        {
          error: "reschedule_customers_failed",
          message: customerResult.error.message,
        },
        { status: 500 },
      );
    }

    if (serviceTypeResult.error) {
      return NextResponse.json(
        {
          error: "reschedule_services_failed",
          message: serviceTypeResult.error.message,
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

    const now = Date.now();
    const enrichedRequests = requests.map((row) => {
      const booking = bookingMap.get(row.booking_id) ?? null;
      const customer = row.customer_id
        ? customerMap.get(row.customer_id) ?? null
        : booking?.customer_id
          ? customerMap.get(booking.customer_id) ?? null
          : null;
      const serviceType = booking?.service_type_id
        ? serviceTypeMap.get(booking.service_type_id) ?? null
        : null;
      const dueMs = row.sla_due_at ? new Date(row.sla_due_at).getTime() : NaN;
      const hasDue = Number.isFinite(dueMs);
      const isOverdue = hasDue && isActionRequiredStatus(row.status) && dueMs < now;
      const overdueMinutes = isOverdue
        ? Math.max(1, Math.floor((now - dueMs) / (60 * 1000)))
        : null;

      return {
        id: row.id,
        bookingId: row.booking_id,
        leadId: row.lead_id,
        conversationId: row.conversation_id,
        status: row.status,
        requestedAt: row.requested_at,
        resolvedAt: row.resolved_at,
        assignedTo: row.assigned_to,
        assignedAt: row.assigned_at,
        slaDueAt: row.sla_due_at,
        escalationLevel: Number.isFinite(row.escalation_level)
          ? row.escalation_level
          : 0,
        lastEscalatedAt: row.last_escalated_at,
        isOverdue,
        overdueMinutes,
        latestCustomerMessage: row.latest_customer_message,
        optionBatch: row.option_batch,
        selectedOptionIndex: row.selected_option_index,
        selectedStart: row.selected_start,
        selectedEnd: row.selected_end,
        metadata: row.metadata ?? {},
        booking: booking
          ? {
              scheduledStart: booking.scheduled_start,
              scheduledEnd: booking.scheduled_end,
              status: booking.status,
            }
          : null,
        customer,
        serviceType,
      };
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      filters: {
        status: query.status,
        limit: query.limit,
      },
      counts: statusCounts(requests),
      actionRequired: requests.filter((row) => isActionRequiredStatus(row.status)).length,
      overdueActionRequired: enrichedRequests.filter((row) => row.isOverdue).length,
      escalatedActionRequired: enrichedRequests.filter(
        (row) =>
          isActionRequiredStatus(row.status as RequestRow["status"]) &&
          row.escalationLevel > 0,
      ).length,
      requests: enrichedRequests,
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
