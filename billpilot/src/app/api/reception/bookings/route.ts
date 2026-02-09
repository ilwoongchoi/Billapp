import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { refreshBookingReminders } from "@/lib/reception/reminders";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const phonePattern = /^\+?[1-9]\d{6,15}$/;

const statusValues = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "rescheduled",
] as const;

const payloadSchema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  customerName: z.string().trim().max(120).nullable().optional(),
  customerPhone: z
    .string()
    .trim()
    .regex(phonePattern, "Expected E.164-ish phone format")
    .nullable()
    .optional(),
  customerEmail: z.string().trim().email().max(160).nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  serviceTypeId: z.string().uuid().nullable().optional(),
  serviceTypeName: z.string().trim().min(2).max(80).nullable().optional(),
  scheduledStart: z.string().min(10),
  scheduledEnd: z.string().min(10).nullable().optional(),
  durationMinutes: z.number().int().min(15).max(720).optional(),
  status: z.enum(statusValues).default("pending"),
  notes: z.string().trim().max(600).nullable().optional(),
});

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

interface BookingRow {
  id: string;
  customer_id: string | null;
  lead_id: string | null;
  service_type_id: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  status: (typeof statusValues)[number];
  notes: string | null;
  created_at: string;
}

interface CustomerRow {
  id: string;
  full_name: string | null;
  phone_e164: string;
  email: string | null;
}

interface ServiceTypeRow {
  id: string;
  name: string;
  default_duration_minutes: number;
  base_price: number | null;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function readError(error: { message?: string } | null | undefined, fallback: string): string {
  return error?.message ?? fallback;
}

async function resolveOwnedEntityId(input: {
  table: "service_customers" | "service_leads" | "service_types";
  id: string;
  userId: string;
}): Promise<boolean> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return false;
  }

  const { data, error } = await supabase
    .from(input.table)
    .select("id")
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .maybeSingle();

  return !error && Boolean(data);
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
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const defaultFrom = new Date();
    defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 1);

    const defaultTo = new Date();
    defaultTo.setUTCDate(defaultTo.getUTCDate() + 30);

    const fromDate = parseIsoDate(query.from) ?? defaultFrom;
    const toDate = parseIsoDate(query.to) ?? defaultTo;

    if (toDate < fromDate) {
      return NextResponse.json(
        {
          error: "invalid_range",
          message: "`to` must be greater than or equal to `from`.",
        },
        { status: 400 },
      );
    }

    const { data: bookingData, error: bookingError } = await supabase
      .from("service_bookings")
      .select(
        "id, customer_id, lead_id, service_type_id, scheduled_start, scheduled_end, status, notes, created_at",
      )
      .eq("user_id", user.id)
      .gte("scheduled_start", fromDate.toISOString())
      .lte("scheduled_start", toDate.toISOString())
      .order("scheduled_start", { ascending: true })
      .limit(query.limit);

    if (bookingError) {
      return NextResponse.json(
        {
          error: "booking_list_failed",
          message: readError(bookingError, "Failed to load bookings."),
        },
        { status: 500 },
      );
    }

    const bookings = (bookingData ?? []) as BookingRow[];
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
            .select("id, full_name, phone_e164, email")
            .eq("user_id", user.id)
            .in("id", customerIds)
        : Promise.resolve({ data: [], error: null }),
      serviceTypeIds.length > 0
        ? supabase
            .from("service_types")
            .select("id, name, default_duration_minutes, base_price")
            .eq("user_id", user.id)
            .in("id", serviceTypeIds)
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

    return NextResponse.json({
      range: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        limit: query.limit,
      },
      bookings: bookings.map((booking) => ({
        id: booking.id,
        leadId: booking.lead_id,
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

export async function POST(request: Request) {
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

    const body = payloadSchema.parse(await request.json());

    const startDate = parseIsoDate(body.scheduledStart);
    if (!startDate) {
      return NextResponse.json(
        {
          error: "invalid_start_datetime",
          message: "scheduledStart must be a valid datetime string.",
        },
        { status: 400 },
      );
    }

    const endDateFromPayload = parseIsoDate(body.scheduledEnd ?? null);
    const computedEndDate =
      endDateFromPayload ??
      (body.durationMinutes
        ? new Date(startDate.getTime() + body.durationMinutes * 60 * 1000)
        : null);

    if (computedEndDate && computedEndDate < startDate) {
      return NextResponse.json(
        {
          error: "invalid_end_datetime",
          message: "scheduledEnd must be greater than or equal to scheduledStart.",
        },
        { status: 400 },
      );
    }

    let customerId = body.customerId ?? null;
    const leadId = body.leadId ?? null;
    let serviceTypeId = body.serviceTypeId ?? null;

    if (customerId) {
      const customerOwned = await resolveOwnedEntityId({
        table: "service_customers",
        id: customerId,
        userId: user.id,
      });
      if (!customerOwned) {
        return NextResponse.json(
          {
            error: "invalid_customer",
            message: "Selected customer does not belong to this user.",
          },
          { status: 403 },
        );
      }
    } else if (body.customerPhone) {
      const { data: customerData, error: customerError } = await supabase
        .from("service_customers")
        .upsert(
          {
            user_id: user.id,
            full_name: body.customerName ?? null,
            phone_e164: body.customerPhone,
            email: body.customerEmail ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,phone_e164" },
        )
        .select("id")
        .single();

      if (customerError || !customerData) {
        return NextResponse.json(
          {
            error: "customer_upsert_failed",
            message: readError(customerError, "Unable to create customer record."),
          },
          { status: 500 },
        );
      }

      customerId = (customerData as { id: string }).id;
    }

    if (leadId) {
      const leadOwned = await resolveOwnedEntityId({
        table: "service_leads",
        id: leadId,
        userId: user.id,
      });
      if (!leadOwned) {
        return NextResponse.json(
          {
            error: "invalid_lead",
            message: "Selected lead does not belong to this user.",
          },
          { status: 403 },
        );
      }
    }

    if (serviceTypeId) {
      const serviceTypeOwned = await resolveOwnedEntityId({
        table: "service_types",
        id: serviceTypeId,
        userId: user.id,
      });
      if (!serviceTypeOwned) {
        return NextResponse.json(
          {
            error: "invalid_service_type",
            message: "Selected service type does not belong to this user.",
          },
          { status: 403 },
        );
      }
    } else if (body.serviceTypeName) {
      const { data: serviceTypeData, error: serviceTypeError } = await supabase
        .from("service_types")
        .upsert(
          {
            user_id: user.id,
            name: body.serviceTypeName,
            default_duration_minutes: body.durationMinutes ?? 60,
            active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,name" },
        )
        .select("id")
        .single();

      if (serviceTypeError || !serviceTypeData) {
        return NextResponse.json(
          {
            error: "service_type_upsert_failed",
            message: readError(
              serviceTypeError,
              "Unable to resolve service type for this booking.",
            ),
          },
          { status: 500 },
        );
      }

      serviceTypeId = (serviceTypeData as { id: string }).id;
    }

    const { data: bookingData, error: bookingError } = await supabase
      .from("service_bookings")
      .insert({
        user_id: user.id,
        customer_id: customerId,
        lead_id: leadId,
        service_type_id: serviceTypeId,
        scheduled_start: startDate.toISOString(),
        scheduled_end: computedEndDate?.toISOString() ?? null,
        status: body.status,
        notes: body.notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .select(
        "id, customer_id, lead_id, service_type_id, scheduled_start, scheduled_end, status, notes, created_at",
      )
      .single();

    if (bookingError || !bookingData) {
      return NextResponse.json(
        {
          error: "booking_create_failed",
          message: readError(bookingError, "Unable to create booking."),
        },
        { status: 500 },
      );
    }

    if (leadId) {
      await supabase
        .from("service_leads")
        .update({
          status: body.status === "cancelled" ? "qualified" : "booked",
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .eq("user_id", user.id);
    }

    await supabase.from("service_automation_events").insert({
      user_id: user.id,
      lead_id: leadId,
      event_type: "manual_booking_created",
      payload: {
        bookingId: (bookingData as BookingRow).id,
        status: body.status,
        customerId,
        serviceTypeId,
      },
      success: true,
    });

    await refreshBookingReminders({
      userId: user.id,
      bookingId: (bookingData as BookingRow).id,
      scheduledStartIso: (bookingData as BookingRow).scheduled_start,
      bookingStatus: (bookingData as BookingRow).status,
      nowIso: new Date().toISOString(),
    });

    const customerPromise = customerId
      ? supabase
          .from("service_customers")
          .select("id, full_name, phone_e164, email")
          .eq("user_id", user.id)
          .eq("id", customerId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null });

    const serviceTypePromise = serviceTypeId
      ? supabase
          .from("service_types")
          .select("id, name, default_duration_minutes, base_price")
          .eq("user_id", user.id)
          .eq("id", serviceTypeId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null });

    const [customerResult, serviceTypeResult] = await Promise.all([
      customerPromise,
      serviceTypePromise,
    ]);

    return NextResponse.json({
      booking: {
        id: (bookingData as BookingRow).id,
        leadId: (bookingData as BookingRow).lead_id,
        status: (bookingData as BookingRow).status,
        scheduledStart: (bookingData as BookingRow).scheduled_start,
        scheduledEnd: (bookingData as BookingRow).scheduled_end,
        notes: (bookingData as BookingRow).notes,
        createdAt: (bookingData as BookingRow).created_at,
        customer: (customerResult.data as CustomerRow | null) ?? null,
        serviceType: (serviceTypeResult.data as ServiceTypeRow | null) ?? null,
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
