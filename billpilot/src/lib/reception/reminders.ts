import { getServiceSupabaseClient } from "@/lib/supabase";
import { isTwilioConfigured, sendTwilioSms } from "@/lib/reception/twilio";

export type ReminderType = "24h" | "2h";

interface ReminderSeedRow {
  user_id: string;
  booking_id: string;
  reminder_type: ReminderType;
  scheduled_for: string;
  status: "pending";
  metadata: Record<string, unknown>;
  updated_at: string;
}

interface BookingRow {
  id: string;
  user_id: string;
  customer_id: string | null;
  service_type_id: string | null;
  scheduled_start: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rescheduled";
}

interface ReminderRow {
  id: string;
  booking_id: string;
  reminder_type: ReminderType;
  scheduled_for: string;
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

interface BusinessRow {
  user_id: string;
  business_name: string;
  timezone: string;
  twilio_phone_number: string | null;
}

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "rescheduled"] as const;
const ACTIVE_BOOKING_STATUS_SET = new Set<string>(ACTIVE_BOOKING_STATUSES);

const REMINDER_RULES: Array<{ type: ReminderType; offsetHours: number }> = [
  { type: "24h", offsetHours: 24 },
  { type: "2h", offsetHours: 2 },
];

interface RefreshBookingRemindersInput {
  userId: string;
  bookingId: string;
  scheduledStartIso: string;
  bookingStatus: BookingRow["status"];
  nowIso?: string;
}

export interface ReminderSweepResult {
  userId: string;
  dryRun: boolean;
  seeded: number;
  due: number;
  sent: number;
  skipped: number;
  errored: number;
  twilioConfigured: boolean;
  notes: string[];
}

function toIso(date: Date): string {
  return date.toISOString();
}

function formatSchedule(iso: string, timezone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone || "UTC",
  }).format(parsed);
}

function buildReminderMessage(input: {
  reminderType: ReminderType;
  customerName: string | null;
  businessName: string;
  serviceName: string | null;
  scheduledStartIso: string;
  timezone: string;
}): string {
  const when = formatSchedule(input.scheduledStartIso, input.timezone);
  const person = input.customerName ?? "there";
  const service = input.serviceName ? ` for ${input.serviceName}` : "";

  if (input.reminderType === "24h") {
    return `Hi ${person}, this is your 24-hour reminder from ${input.businessName}. You are scheduled${service} on ${when}. Reply C to confirm or R to reschedule.`;
  }

  return `Hi ${person}, this is your 2-hour reminder from ${input.businessName}. We are scheduled${service} at ${when}. Reply C to confirm or R to reschedule.`;
}

function toReminderSeeds(input: {
  userId: string;
  booking: BookingRow;
  nowIso: string;
}): ReminderSeedRow[] {
  const scheduledStart = new Date(input.booking.scheduled_start);
  if (Number.isNaN(scheduledStart.getTime())) {
    return [];
  }

  const now = new Date(input.nowIso);

  return REMINDER_RULES.map((rule) => {
    const scheduledFor = new Date(scheduledStart.getTime() - rule.offsetHours * 60 * 60 * 1000);
    return {
      user_id: input.userId,
      booking_id: input.booking.id,
      reminder_type: rule.type,
      scheduled_for: toIso(scheduledFor),
      status: "pending",
      metadata: {
        seededAt: input.nowIso,
        bookingStatus: input.booking.status,
        scheduleLagSeconds: Math.round((now.getTime() - scheduledFor.getTime()) / 1000),
      },
      updated_at: input.nowIso,
    };
  });
}

function buildReminderSeedsForBooking(input: RefreshBookingRemindersInput): ReminderSeedRow[] {
  const nowIso = input.nowIso ?? new Date().toISOString();

  if (!ACTIVE_BOOKING_STATUS_SET.has(input.bookingStatus)) {
    return [];
  }

  const booking: BookingRow = {
    id: input.bookingId,
    user_id: input.userId,
    customer_id: null,
    service_type_id: null,
    scheduled_start: input.scheduledStartIso,
    status: input.bookingStatus,
  };

  return toReminderSeeds({
    userId: input.userId,
    booking,
    nowIso,
  });
}

export async function refreshBookingReminders(
  input: RefreshBookingRemindersInput,
): Promise<{ ok: boolean; upserted: number; error?: string }> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return {
      ok: false,
      upserted: 0,
      error: "supabase_not_configured",
    };
  }

  const seeds = buildReminderSeedsForBooking(input);
  if (seeds.length === 0) {
    return {
      ok: true,
      upserted: 0,
    };
  }

  const { error } = await supabase.from("service_booking_reminders").upsert(seeds, {
    onConflict: "booking_id,reminder_type",
  });

  if (error) {
    return {
      ok: false,
      upserted: 0,
      error: error.message,
    };
  }

  return {
    ok: true,
    upserted: seeds.length,
  };
}

export async function skipPendingRemindersForBooking(input: {
  userId: string;
  bookingId: string;
  reason: string;
}): Promise<void> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase
    .from("service_booking_reminders")
    .update({
      status: "skipped",
      error_message: input.reason,
      metadata: {
        reason: input.reason,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", input.userId)
    .eq("booking_id", input.bookingId)
    .eq("status", "pending");
}

async function updateReminderStatus(input: {
  reminderId: string;
  status: "sent" | "skipped" | "error";
  sentAt?: string | null;
  twilioMessageSid?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase
    .from("service_booking_reminders")
    .update({
      status: input.status,
      sent_at: input.sentAt ?? null,
      twilio_message_sid: input.twilioMessageSid ?? null,
      error_message: input.errorMessage ?? null,
      metadata: input.metadata ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.reminderId);
}

export async function listReminderUsers(): Promise<string[]> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("service_businesses")
    .select("user_id")
    .not("twilio_phone_number", "is", null);

  if (error || !data) {
    return [];
  }

  const set = new Set<string>();
  for (const row of data as Array<{ user_id: string }>) {
    if (row.user_id) {
      set.add(row.user_id);
    }
  }

  return Array.from(set);
}

export async function runReminderSweepForUser(input: {
  userId: string;
  dryRun?: boolean;
}): Promise<ReminderSweepResult> {
  const dryRun = Boolean(input.dryRun);
  const supabase = getServiceSupabaseClient();

  if (!supabase) {
    return {
      userId: input.userId,
      dryRun,
      seeded: 0,
      due: 0,
      sent: 0,
      skipped: 0,
      errored: 0,
      twilioConfigured: false,
      notes: ["supabase_not_configured"],
    };
  }

  const now = new Date();
  const nowIso = toIso(now);
  const horizonStartIso = toIso(new Date(now.getTime() - 6 * 60 * 60 * 1000));
  const horizonEndIso = toIso(new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000));

  const [businessResult, bookingResult] = await Promise.all([
    supabase
      .from("service_businesses")
      .select("user_id, business_name, timezone, twilio_phone_number")
      .eq("user_id", input.userId)
      .maybeSingle(),
    supabase
      .from("service_bookings")
      .select("id, user_id, customer_id, service_type_id, scheduled_start, status")
      .eq("user_id", input.userId)
      .in("status", [...ACTIVE_BOOKING_STATUSES])
      .gte("scheduled_start", horizonStartIso)
      .lte("scheduled_start", horizonEndIso),
  ]);

  const notes: string[] = [];
  const business = (businessResult.data as BusinessRow | null) ?? null;

  if (businessResult.error) {
    notes.push(`business_lookup_failed:${businessResult.error.message}`);
  }

  if (bookingResult.error) {
    notes.push(`booking_lookup_failed:${bookingResult.error.message}`);
  }

  const bookings = (bookingResult.data ?? []) as BookingRow[];
  const seeds = bookings.flatMap((booking) =>
    toReminderSeeds({
      userId: input.userId,
      booking,
      nowIso,
    }),
  );

  if (!dryRun && seeds.length > 0) {
    const { error } = await supabase
      .from("service_booking_reminders")
      .upsert(seeds, {
        onConflict: "booking_id,reminder_type",
        ignoreDuplicates: true,
      });

    if (error) {
      notes.push(`reminder_seed_failed:${error.message}`);
    }
  }

  const { data: dueData, error: dueError } = await supabase
    .from("service_booking_reminders")
    .select("id, booking_id, reminder_type, scheduled_for")
    .eq("user_id", input.userId)
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(150);

  if (dueError) {
    notes.push(`reminder_due_failed:${dueError.message}`);
  }

  const dueReminders = (dueData ?? []) as ReminderRow[];
  if (dueReminders.length === 0) {
    return {
      userId: input.userId,
      dryRun,
      seeded: seeds.length,
      due: 0,
      sent: 0,
      skipped: 0,
      errored: 0,
      twilioConfigured: isTwilioConfigured(),
      notes,
    };
  }

  const dueBookingIds = Array.from(new Set(dueReminders.map((row) => row.booking_id)));
  const { data: dueBookingData, error: dueBookingError } = await supabase
    .from("service_bookings")
    .select("id, user_id, customer_id, service_type_id, scheduled_start, status")
    .eq("user_id", input.userId)
    .in("id", dueBookingIds);

  if (dueBookingError) {
    notes.push(`due_booking_lookup_failed:${dueBookingError.message}`);
  }

  const bookingMap = new Map<string, BookingRow>();
  for (const booking of (dueBookingData ?? []) as BookingRow[]) {
    bookingMap.set(booking.id, booking);
  }

  const customerIds = Array.from(
    new Set(
      ((dueBookingData ?? []) as BookingRow[])
        .map((booking) => booking.customer_id)
        .filter(Boolean),
    ),
  ) as string[];

  const serviceTypeIds = Array.from(
    new Set(
      ((dueBookingData ?? []) as BookingRow[])
        .map((booking) => booking.service_type_id)
        .filter(Boolean),
    ),
  ) as string[];

  const [customerResult, serviceTypeResult] = await Promise.all([
    customerIds.length > 0
      ? supabase
          .from("service_customers")
          .select("id, full_name, phone_e164")
          .eq("user_id", input.userId)
          .in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
    serviceTypeIds.length > 0
      ? supabase
          .from("service_types")
          .select("id, name")
          .eq("user_id", input.userId)
          .in("id", serviceTypeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (customerResult.error) {
    notes.push(`reminder_customer_lookup_failed:${customerResult.error.message}`);
  }

  if (serviceTypeResult.error) {
    notes.push(`reminder_service_type_lookup_failed:${serviceTypeResult.error.message}`);
  }

  const customerMap = new Map<string, CustomerRow>();
  for (const row of (customerResult.data ?? []) as CustomerRow[]) {
    customerMap.set(row.id, row);
  }

  const serviceTypeMap = new Map<string, ServiceTypeRow>();
  for (const row of (serviceTypeResult.data ?? []) as ServiceTypeRow[]) {
    serviceTypeMap.set(row.id, row);
  }

  const twilioConfigured = isTwilioConfigured();

  let sent = 0;
  let skipped = 0;
  let errored = 0;

  for (const reminder of dueReminders) {
    const booking = bookingMap.get(reminder.booking_id);

    if (!booking) {
      skipped += 1;
      if (!dryRun) {
        await updateReminderStatus({
          reminderId: reminder.id,
          status: "skipped",
          errorMessage: "booking_not_found",
          metadata: {
            reason: "booking_not_found",
          },
        });
      }
      continue;
    }

    const startDate = new Date(booking.scheduled_start);
    if (Number.isNaN(startDate.getTime())) {
      skipped += 1;
      if (!dryRun) {
        await updateReminderStatus({
          reminderId: reminder.id,
          status: "skipped",
          errorMessage: "invalid_booking_start",
          metadata: {
            reason: "invalid_booking_start",
          },
        });
      }
      continue;
    }

    if (!ACTIVE_BOOKING_STATUS_SET.has(booking.status)) {
      skipped += 1;
      if (!dryRun) {
        await updateReminderStatus({
          reminderId: reminder.id,
          status: "skipped",
          errorMessage: "booking_inactive",
          metadata: {
            reason: "booking_inactive",
            bookingStatus: booking.status,
          },
        });
      }
      continue;
    }

    if (startDate <= now) {
      skipped += 1;
      if (!dryRun) {
        await updateReminderStatus({
          reminderId: reminder.id,
          status: "skipped",
          errorMessage: "booking_already_started",
          metadata: {
            reason: "booking_already_started",
          },
        });
      }
      continue;
    }

    const customer = booking.customer_id ? customerMap.get(booking.customer_id) ?? null : null;
    if (!customer?.phone_e164) {
      skipped += 1;
      if (!dryRun) {
        await updateReminderStatus({
          reminderId: reminder.id,
          status: "skipped",
          errorMessage: "missing_customer_phone",
          metadata: {
            reason: "missing_customer_phone",
          },
        });
      }
      continue;
    }

    if (!business) {
      skipped += 1;
      if (!dryRun) {
        await updateReminderStatus({
          reminderId: reminder.id,
          status: "skipped",
          errorMessage: "business_not_configured",
          metadata: {
            reason: "business_not_configured",
          },
        });
      }
      continue;
    }

    if (!twilioConfigured) {
      skipped += 1;
      if (!dryRun) {
        await updateReminderStatus({
          reminderId: reminder.id,
          status: "skipped",
          errorMessage: "twilio_not_configured",
          metadata: {
            reason: "twilio_not_configured",
          },
        });
      }
      continue;
    }

    const serviceType = booking.service_type_id
      ? serviceTypeMap.get(booking.service_type_id) ?? null
      : null;

    const message = buildReminderMessage({
      reminderType: reminder.reminder_type,
      customerName: customer.full_name,
      businessName: business.business_name,
      serviceName: serviceType?.name ?? null,
      scheduledStartIso: booking.scheduled_start,
      timezone: business.timezone,
    });

    if (dryRun) {
      sent += 1;
      continue;
    }

    const smsResult = await sendTwilioSms({
      to: customer.phone_e164,
      from: business.twilio_phone_number,
      body: message,
    });

    if (smsResult.ok) {
      sent += 1;

      await updateReminderStatus({
        reminderId: reminder.id,
        status: "sent",
        sentAt: new Date().toISOString(),
        twilioMessageSid: smsResult.messageSid,
        metadata: {
          reminderType: reminder.reminder_type,
          customerId: customer.id,
          bookingId: booking.id,
          twilioStatus: smsResult.status,
        },
      });

      await supabase.from("service_automation_events").insert({
        user_id: input.userId,
        lead_id: null,
        event_type: "booking_reminder_sent",
        payload: {
          reminderId: reminder.id,
          reminderType: reminder.reminder_type,
          bookingId: booking.id,
          customerId: customer.id,
          twilioMessageSid: smsResult.messageSid,
        },
        success: true,
      });

      continue;
    }

    errored += 1;

    await updateReminderStatus({
      reminderId: reminder.id,
      status: "error",
      errorMessage: smsResult.error,
      metadata: {
        reason: "twilio_send_failed",
        reminderType: reminder.reminder_type,
        bookingId: booking.id,
        customerId: customer.id,
      },
    });

    await supabase.from("service_automation_events").insert({
      user_id: input.userId,
      lead_id: null,
      event_type: "booking_reminder_error",
      payload: {
        reminderId: reminder.id,
        reminderType: reminder.reminder_type,
        bookingId: booking.id,
        customerId: customer.id,
        error: smsResult.error,
      },
      success: false,
      error_message: smsResult.error,
    });
  }

  return {
    userId: input.userId,
    dryRun,
    seeded: seeds.length,
    due: dueReminders.length,
    sent,
    skipped,
    errored,
    twilioConfigured,
    notes,
  };
}
