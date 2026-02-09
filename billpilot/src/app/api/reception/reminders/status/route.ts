import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(5).max(200).default(40),
});

interface ReminderRow {
  id: string;
  booking_id: string;
  reminder_type: "24h" | "2h";
  scheduled_for: string;
  status: "pending" | "sent" | "skipped" | "error";
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
}

interface BookingRow {
  id: string;
  customer_id: string | null;
  service_type_id: string | null;
  scheduled_start: string;
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
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const nowIso = new Date().toISOString();

    const [recentResult, pendingCountResult] = await Promise.all([
      supabase
        .from("service_booking_reminders")
        .select(
          "id, booking_id, reminder_type, scheduled_for, status, sent_at, error_message, created_at",
        )
        .eq("user_id", user.id)
        .order("scheduled_for", { ascending: false })
        .limit(query.limit),
      supabase
        .from("service_booking_reminders")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "pending")
        .lte("scheduled_for", nowIso),
    ]);

    if (recentResult.error) {
      return NextResponse.json(
        {
          error: "reminder_list_failed",
          message: recentResult.error.message,
        },
        { status: 500 },
      );
    }

    if (pendingCountResult.error) {
      return NextResponse.json(
        {
          error: "reminder_stats_failed",
          message: pendingCountResult.error.message,
        },
        { status: 500 },
      );
    }

    const reminders = (recentResult.data ?? []) as ReminderRow[];
    const bookingIds = Array.from(new Set(reminders.map((row) => row.booking_id)));

    const { data: bookingData, error: bookingError } =
      bookingIds.length > 0
        ? await supabase
            .from("service_bookings")
            .select("id, customer_id, service_type_id, scheduled_start, status")
            .eq("user_id", user.id)
            .in("id", bookingIds)
        : { data: [], error: null };

    if (bookingError) {
      return NextResponse.json(
        {
          error: "reminder_booking_lookup_failed",
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

    const customerIds = Array.from(
      new Set(bookings.map((booking) => booking.customer_id).filter(Boolean)),
    ) as string[];
    const serviceTypeIds = Array.from(
      new Set(bookings.map((booking) => booking.service_type_id).filter(Boolean)),
    ) as string[];

    const [customerResult, serviceTypeResult] = await Promise.all([
      customerIds.length > 0
        ? supabase
            .from("service_customers")
            .select("id, full_name, phone_e164")
            .eq("user_id", user.id)
            .in("id", customerIds)
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
          error: "reminder_customer_lookup_failed",
          message: customerResult.error.message,
        },
        { status: 500 },
      );
    }

    if (serviceTypeResult.error) {
      return NextResponse.json(
        {
          error: "reminder_service_type_lookup_failed",
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

    const counts = reminders.reduce(
      (acc, reminder) => {
        acc[reminder.status] += 1;
        return acc;
      },
      {
        pending: 0,
        sent: 0,
        skipped: 0,
        error: 0,
      },
    );

    return NextResponse.json({
      generatedAt: nowIso,
      duePending: pendingCountResult.count ?? 0,
      counts,
      reminders: reminders.map((reminder) => {
        const booking = bookingMap.get(reminder.booking_id) ?? null;
        const customer = booking?.customer_id
          ? customerMap.get(booking.customer_id) ?? null
          : null;
        const serviceType = booking?.service_type_id
          ? serviceTypeMap.get(booking.service_type_id) ?? null
          : null;

        return {
          id: reminder.id,
          bookingId: reminder.booking_id,
          reminderType: reminder.reminder_type,
          scheduledFor: reminder.scheduled_for,
          status: reminder.status,
          sentAt: reminder.sent_at,
          errorMessage: reminder.error_message,
          createdAt: reminder.created_at,
          booking: booking
            ? {
                scheduledStart: booking.scheduled_start,
                status: booking.status,
              }
            : null,
          customer,
          serviceType,
        };
      }),
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
