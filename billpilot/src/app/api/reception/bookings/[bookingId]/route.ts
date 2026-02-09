import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import {
  refreshBookingReminders,
  skipPendingRemindersForBooking,
} from "@/lib/reception/reminders";
import { markRescheduleRequestClosed } from "@/lib/reception/reschedule-requests";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const payloadSchema = z.object({
  status: z.enum(["pending", "confirmed", "completed", "cancelled", "rescheduled"]),
  notes: z.string().max(600).optional(),
});

interface BookingRouteContext {
  params: Promise<{
    bookingId: string;
  }>;
}

export async function PATCH(request: Request, context: BookingRouteContext) {
  try {
    const user = await requireApiUser(request);
    const { bookingId } = await context.params;
    const parsedBookingId = z.string().uuid().parse(bookingId);
    const body = payloadSchema.parse(await request.json());

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

    const { data, error } = await supabase
      .from("service_bookings")
      .update({
        status: body.status,
        notes: body.notes ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsedBookingId)
      .eq("user_id", user.id)
      .select("id, status, scheduled_start, scheduled_end, notes, created_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          error: "booking_update_failed",
          message: error.message,
        },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          error: "booking_not_found",
          message: "Booking not found for this user.",
        },
        { status: 404 },
      );
    }

    if (["pending", "confirmed", "rescheduled"].includes(data.status)) {
      await refreshBookingReminders({
        userId: user.id,
        bookingId: data.id,
        scheduledStartIso: data.scheduled_start,
        bookingStatus: data.status,
        nowIso: new Date().toISOString(),
      });
    } else {
      await skipPendingRemindersForBooking({
        userId: user.id,
        bookingId: data.id,
        reason: "booking_status_updated",
      });
    }

    if (["confirmed", "completed", "cancelled"].includes(data.status)) {
      await markRescheduleRequestClosed({
        userId: user.id,
        bookingId: data.id,
        reason: `booking_status_${data.status}`,
      });
    }

    return NextResponse.json({
      booking: {
        id: data.id,
        status: data.status,
        scheduledStart: data.scheduled_start,
        scheduledEnd: data.scheduled_end,
        notes: data.notes,
        createdAt: data.created_at,
      },
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
