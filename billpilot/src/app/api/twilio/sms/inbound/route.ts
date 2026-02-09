import { buildReceptionDecision, estimateTokenCount } from "@/lib/reception/ai";
import {
  refreshBookingReminders,
  skipPendingRemindersForBooking,
} from "@/lib/reception/reminders";
import {
  markRescheduleRequestClosed,
  markRescheduleRequestConfirmed,
  markRescheduleRequestHandoff,
  upsertRescheduleRequestOptions,
} from "@/lib/reception/reschedule-requests";
import { generateRescheduleOptions } from "@/lib/reception/scheduling";
import {
  buildSmsTwiml,
  normalizePhoneNumber,
  readTwilioForm,
  xmlResponse,
} from "@/lib/reception/twiml";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

type BookingCommand = "confirm" | "reschedule";

type ConversationState = "open" | "handoff";

type LeadState = "new" | "qualified" | "booked";

interface BusinessRow {
  id: string;
  user_id: string;
  business_name: string;
  timezone: string;
}

interface CustomerRow {
  id: string;
}

interface LeadRow {
  id: string;
}

interface PendingRescheduleOption {
  index: number;
  startIso: string;
  endIso: string;
  label: string;
}

interface PendingRescheduleState {
  bookingId: string;
  options: PendingRescheduleOption[];
  batch: number;
  createdAt: string;
  expiresAt: string;
}

interface ConversationMetadata {
  source?: string;
  pendingReschedule?: PendingRescheduleState;
  [key: string]: unknown;
}

interface ConversationRow {
  id: string;
  lead_id: string | null;
  metadata: ConversationMetadata | null;
}

interface UpcomingBookingRow {
  id: string;
  service_type_id: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rescheduled";
}

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "rescheduled"] as const;

const GENERIC_SMS_REPLY =
  "Thanks for reaching out. Please share your service need and address, and our team will contact you shortly.";

function normalizeCommandInput(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function detectBookingCommand(text: string): BookingCommand | null {
  const normalized = normalizeCommandInput(text);
  if (!normalized) {
    return null;
  }

  const first = normalized.split(" ")[0] ?? "";

  if (
    normalized === "c" ||
    first === "c" ||
    first === "confirm" ||
    normalized.startsWith("confirm ") ||
    normalized === "yes" ||
    normalized === "confirmed" ||
    normalized.startsWith("yes ")
  ) {
    return "confirm";
  }

  if (
    normalized === "r" ||
    first === "r" ||
    first === "reschedule" ||
    normalized.startsWith("reschedule ") ||
    normalized.startsWith("change ") ||
    normalized.startsWith("move ")
  ) {
    return "reschedule";
  }

  return null;
}

function detectRescheduleSelection(text: string): 1 | 2 | 3 | 4 | null {
  const normalized = normalizeCommandInput(text);
  if (!normalized) {
    return null;
  }

  const first = normalized.split(" ")[0] ?? "";
  const asNumber = Number.parseInt(first, 10);
  if (asNumber >= 1 && asNumber <= 4) {
    return asNumber as 1 | 2 | 3 | 4;
  }

  const match = normalized.match(/option\s*(1|2|3|4)/);
  if (match?.[1]) {
    return Number.parseInt(match[1], 10) as 1 | 2 | 3 | 4;
  }

  return null;
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

function readPendingReschedule(metadata: unknown): PendingRescheduleState | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const candidate = (metadata as { pendingReschedule?: unknown }).pendingReschedule;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const bookingId =
    typeof (candidate as { bookingId?: unknown }).bookingId === "string"
      ? ((candidate as { bookingId: string }).bookingId ?? "")
      : "";
  const createdAt =
    typeof (candidate as { createdAt?: unknown }).createdAt === "string"
      ? ((candidate as { createdAt: string }).createdAt ?? "")
      : "";
  const expiresAt =
    typeof (candidate as { expiresAt?: unknown }).expiresAt === "string"
      ? ((candidate as { expiresAt: string }).expiresAt ?? "")
      : "";
  const batch = Number.parseInt(
    String((candidate as { batch?: unknown }).batch ?? "1"),
    10,
  );

  if (!bookingId || !createdAt || !expiresAt) {
    return null;
  }

  const rawOptions = (candidate as { options?: unknown }).options;
  if (!Array.isArray(rawOptions)) {
    return null;
  }

  const options: PendingRescheduleOption[] = [];
  for (const row of rawOptions) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const index = Number.parseInt(String((row as { index?: unknown }).index ?? ""), 10);
    const startIso =
      typeof (row as { startIso?: unknown }).startIso === "string"
        ? ((row as { startIso: string }).startIso ?? "")
        : "";
    const endIso =
      typeof (row as { endIso?: unknown }).endIso === "string"
        ? ((row as { endIso: string }).endIso ?? "")
        : "";
    const label =
      typeof (row as { label?: unknown }).label === "string"
        ? ((row as { label: string }).label ?? "")
        : "";

    if (index >= 1 && index <= 9 && startIso && endIso && label) {
      options.push({
        index,
        startIso,
        endIso,
        label,
      });
    }
  }

  if (options.length === 0) {
    return null;
  }

  return {
    bookingId,
    options,
    batch: Number.isFinite(batch) && batch > 0 ? batch : 1,
    createdAt,
    expiresAt,
  };
}

function buildOptionsReply(options: PendingRescheduleOption[]): string {
  const lines = options.map((option) => `${option.index}) ${option.label}`);
  return `Got it - here are available times:\n${lines.join("\n")}\nReply 1, 2, or 3 to choose a slot. Reply 4 for more times.`;
}

async function getUpcomingBooking(input: {
  userId: string;
  customerId: string;
  timezone: string;
}): Promise<{
  booking: UpcomingBookingRow | null;
  serviceName: string | null;
  durationMinutes: number;
  whenLabel: string | null;
}> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return {
      booking: null,
      serviceName: null,
      durationMinutes: 120,
      whenLabel: null,
    };
  }

  const startFloorIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: bookingData } = await supabase
    .from("service_bookings")
    .select("id, service_type_id, scheduled_start, scheduled_end, status")
    .eq("user_id", input.userId)
    .eq("customer_id", input.customerId)
    .in("status", [...ACTIVE_BOOKING_STATUSES])
    .gte("scheduled_start", startFloorIso)
    .order("scheduled_start", { ascending: true })
    .limit(1)
    .maybeSingle();

  const booking = (bookingData as UpcomingBookingRow | null) ?? null;
  if (!booking) {
    return {
      booking: null,
      serviceName: null,
      durationMinutes: 120,
      whenLabel: null,
    };
  }

  let serviceName: string | null = null;
  let defaultDurationMinutes = 120;

  if (booking.service_type_id) {
    const { data: serviceTypeData } = await supabase
      .from("service_types")
      .select("name, default_duration_minutes")
      .eq("id", booking.service_type_id)
      .eq("user_id", input.userId)
      .maybeSingle();

    serviceName =
      ((serviceTypeData as { name?: string } | null)?.name ?? null) || null;
    defaultDurationMinutes =
      (serviceTypeData as { default_duration_minutes?: number } | null)
        ?.default_duration_minutes ?? 120;
  }

  let durationMinutes = defaultDurationMinutes;
  const start = new Date(booking.scheduled_start);
  const end = booking.scheduled_end ? new Date(booking.scheduled_end) : null;
  if (
    start &&
    end &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    end > start
  ) {
    const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
    durationMinutes = Math.min(720, Math.max(15, diffMinutes));
  }

  return {
    booking,
    serviceName,
    durationMinutes,
    whenLabel: formatSchedule(booking.scheduled_start, input.timezone),
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const form = await readTwilioForm(request);
    const messageSid = form.MessageSid?.trim() ?? null;
    const fromNumber = normalizePhoneNumber(form.From);
    const toNumber = normalizePhoneNumber(form.To);
    const body = form.Body?.trim() ?? "";

    if (!fromNumber || !toNumber || !body) {
      return xmlResponse(buildSmsTwiml(GENERIC_SMS_REPLY));
    }

    const supabase = getServiceSupabaseClient();
    if (!supabase) {
      return xmlResponse(buildSmsTwiml(GENERIC_SMS_REPLY));
    }

    const { data: businessData } = await supabase
      .from("service_businesses")
      .select("id, user_id, business_name, timezone")
      .eq("twilio_phone_number", toNumber)
      .maybeSingle();

    const business = (businessData as BusinessRow | null) ?? null;
    if (!business) {
      return xmlResponse(buildSmsTwiml(GENERIC_SMS_REPLY));
    }

    const nowIso = new Date().toISOString();

    const { data: customerData } = await supabase
      .from("service_customers")
      .upsert(
        {
          user_id: business.user_id,
          phone_e164: fromNumber,
          updated_at: nowIso,
        },
        { onConflict: "user_id,phone_e164" },
      )
      .select("id")
      .single();

    const customer = (customerData as CustomerRow | null) ?? null;
    if (!customer) {
      return xmlResponse(buildSmsTwiml(GENERIC_SMS_REPLY));
    }

    const { data: openConversationData } = await supabase
      .from("service_conversations")
      .select("id, lead_id, metadata")
      .eq("user_id", business.user_id)
      .eq("customer_id", customer.id)
      .eq("channel", "sms")
      .in("state", ["open", "handoff"])
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let conversation = (openConversationData as ConversationRow | null) ?? null;
    let leadId = conversation?.lead_id ?? null;

    if (!conversation) {
      const { data: leadData } = await supabase
        .from("service_leads")
        .insert({
          user_id: business.user_id,
          customer_id: customer.id,
          source: "sms",
          status: "new",
          summary: "Inbound SMS lead",
          first_contact_at: nowIso,
          last_activity_at: nowIso,
          updated_at: nowIso,
        })
        .select("id")
        .single();

      const lead = (leadData as LeadRow | null) ?? null;
      leadId = lead?.id ?? null;

      const { data: newConversationData } = await supabase
        .from("service_conversations")
        .insert({
          user_id: business.user_id,
          customer_id: customer.id,
          lead_id: leadId,
          channel: "sms",
          state: "open",
          metadata: {
            source: "sms_inbound",
          },
          last_message_at: nowIso,
          updated_at: nowIso,
        })
        .select("id, lead_id, metadata")
        .single();

      conversation = (newConversationData as ConversationRow | null) ?? null;
      leadId = conversation?.lead_id ?? leadId;
    }

    if (!conversation) {
      return xmlResponse(buildSmsTwiml(GENERIC_SMS_REPLY));
    }

    await supabase.from("service_messages").upsert(
      {
        user_id: business.user_id,
        conversation_id: conversation.id,
        direction: "inbound",
        sender_type: "customer",
        body,
        twilio_message_sid: messageSid,
      },
      messageSid ? { onConflict: "twilio_message_sid" } : undefined,
    );

    const conversationMetadata: ConversationMetadata = {
      ...(conversation.metadata ?? {}),
    };

    const selection = detectRescheduleSelection(body);
    const pendingReschedule = readPendingReschedule(conversationMetadata);

    if (selection !== null && pendingReschedule) {
      const expiry = new Date(pendingReschedule.expiresAt);
      const now = new Date();

      if (Number.isNaN(expiry.getTime()) || expiry <= now) {
        delete conversationMetadata.pendingReschedule;

        const expiredReply =
          "Those options expired. Reply R to request a fresh set of reschedule times.";

        await supabase.from("service_messages").insert({
          user_id: business.user_id,
          conversation_id: conversation.id,
          direction: "outbound",
          sender_type: "system",
          body: expiredReply,
        });

        await supabase
          .from("service_conversations")
          .update({
            metadata: conversationMetadata,
            state: "open",
            last_message_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", conversation.id)
          .eq("user_id", business.user_id);

        await markRescheduleRequestHandoff({
          userId: business.user_id,
          bookingId: pendingReschedule.bookingId,
          customerId: customer.id,
          leadId,
          conversationId: conversation.id,
          latestCustomerMessage: body,
          reason: "options_expired",
          optionBatch: pendingReschedule.batch,
        });

        await supabase.from("service_ai_runs").insert({
          user_id: business.user_id,
          conversation_id: conversation.id,
          lead_id: leadId,
          model: "booking-reschedule-selector-v1",
          input_tokens: estimateTokenCount(body),
          output_tokens: estimateTokenCount(expiredReply),
          latency_ms: Date.now() - startedAt,
          estimated_cost: 0,
          outcome: "fallback",
          drift_score: 0.027,
        });

        return xmlResponse(buildSmsTwiml(expiredReply));
      }

      if (selection === 4) {
        const { data: bookingForMoreOptions } = await supabase
          .from("service_bookings")
          .select("id, scheduled_start, scheduled_end, status")
          .eq("id", pendingReschedule.bookingId)
          .eq("user_id", business.user_id)
          .eq("customer_id", customer.id)
          .maybeSingle();

        if (!bookingForMoreOptions) {
          delete conversationMetadata.pendingReschedule;
          const missingReply =
            "We couldn't find that booking now. Reply R to request fresh options.";

          await supabase.from("service_messages").insert({
            user_id: business.user_id,
            conversation_id: conversation.id,
            direction: "outbound",
            sender_type: "system",
            body: missingReply,
          });

          await supabase
            .from("service_conversations")
            .update({
              metadata: conversationMetadata,
              state: "open",
              last_message_at: nowIso,
              updated_at: nowIso,
            })
            .eq("id", conversation.id)
            .eq("user_id", business.user_id);

          await supabase.from("service_ai_runs").insert({
            user_id: business.user_id,
            conversation_id: conversation.id,
            lead_id: leadId,
            model: "booking-reschedule-selector-v2",
            input_tokens: estimateTokenCount(body),
            output_tokens: estimateTokenCount(missingReply),
            latency_ms: Date.now() - startedAt,
            estimated_cost: 0,
            outcome: "fallback",
            drift_score: 0.028,
          });

          return xmlResponse(buildSmsTwiml(missingReply));
        }

        const startDate = new Date(bookingForMoreOptions.scheduled_start);
        const endDate = bookingForMoreOptions.scheduled_end
          ? new Date(bookingForMoreOptions.scheduled_end)
          : null;
        const durationMinutes =
          startDate &&
          endDate &&
          !Number.isNaN(startDate.getTime()) &&
          !Number.isNaN(endDate.getTime()) &&
          endDate > startDate
            ? Math.max(15, Math.round((endDate.getTime() - startDate.getTime()) / 60000))
            : 120;

        const lastOption = pendingReschedule.options[pendingReschedule.options.length - 1];
        const baseStartDate = lastOption?.startIso
          ? new Date(new Date(lastOption.startIso).getTime() + 30 * 60 * 1000)
          : new Date(Date.now() + 2 * 60 * 60 * 1000);

        const moreOptionsRaw = await generateRescheduleOptions({
          userId: business.user_id,
          excludeBookingId: pendingReschedule.bookingId,
          durationMinutes,
          timezone: business.timezone,
          count: 3,
          startFromIso: baseStartDate.toISOString(),
        });
        const moreOptions = moreOptionsRaw.map((option, idx) => ({
          ...option,
          index: idx + 1,
        }));

        if (moreOptions.length === 0) {
          delete conversationMetadata.pendingReschedule;

          const handoffReply =
            "No additional automatic slots are available right now. A team member will text you with manual options shortly.";

          await supabase.from("service_messages").insert({
            user_id: business.user_id,
            conversation_id: conversation.id,
            direction: "outbound",
            sender_type: "system",
            body: handoffReply,
          });

          await supabase
            .from("service_conversations")
            .update({
              metadata: conversationMetadata,
              state: "handoff",
              last_message_at: nowIso,
              updated_at: nowIso,
            })
            .eq("id", conversation.id)
            .eq("user_id", business.user_id);

          if (leadId) {
            await supabase
              .from("service_leads")
              .update({
                status: "qualified",
                last_activity_at: nowIso,
                updated_at: nowIso,
              })
              .eq("id", leadId)
              .eq("user_id", business.user_id);
          }

          await markRescheduleRequestHandoff({
            userId: business.user_id,
            bookingId: pendingReschedule.bookingId,
            customerId: customer.id,
            leadId,
            conversationId: conversation.id,
            latestCustomerMessage: body,
            reason: "no_more_slots",
            optionBatch: pendingReschedule.batch,
          });

          await supabase.from("service_ai_runs").insert({
            user_id: business.user_id,
            conversation_id: conversation.id,
            lead_id: leadId,
            model: "booking-reschedule-selector-v2",
            input_tokens: estimateTokenCount(body),
            output_tokens: estimateTokenCount(handoffReply),
            latency_ms: Date.now() - startedAt,
            estimated_cost: 0,
            outcome: "handoff",
            drift_score: 0.019,
          });

          await supabase.from("service_automation_events").insert({
            user_id: business.user_id,
            lead_id: leadId,
            conversation_id: conversation.id,
            event_type: "sms_reschedule_more_options_unavailable",
            payload: {
              messageSid,
              fromNumber,
              toNumber,
              bookingId: pendingReschedule.bookingId,
            },
            success: true,
          });

          return xmlResponse(buildSmsTwiml(handoffReply));
        }

        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const nextBatch = pendingReschedule.batch + 1;
        conversationMetadata.pendingReschedule = {
          bookingId: pendingReschedule.bookingId,
          options: moreOptions,
          batch: nextBatch,
          createdAt: nowIso,
          expiresAt,
        };

        await upsertRescheduleRequestOptions({
          userId: business.user_id,
          bookingId: pendingReschedule.bookingId,
          customerId: customer.id,
          leadId,
          conversationId: conversation.id,
          latestCustomerMessage: body,
          batch: nextBatch,
          expiresAt,
          options: moreOptions,
        });

        const moreOptionsReply = buildOptionsReply(moreOptions);

        await supabase.from("service_messages").insert({
          user_id: business.user_id,
          conversation_id: conversation.id,
          direction: "outbound",
          sender_type: "ai",
          body: moreOptionsReply,
          ai_confidence: 0.9,
        });

        await supabase
          .from("service_conversations")
          .update({
            metadata: conversationMetadata,
            state: "open",
            last_message_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", conversation.id)
          .eq("user_id", business.user_id);

        await supabase.from("service_ai_runs").insert({
          user_id: business.user_id,
          conversation_id: conversation.id,
          lead_id: leadId,
          model: "booking-reschedule-selector-v2",
          input_tokens: estimateTokenCount(body),
          output_tokens: estimateTokenCount(moreOptionsReply),
          latency_ms: Date.now() - startedAt,
          estimated_cost: 0,
          outcome: "completed",
          drift_score: 0.012,
        });

        await supabase.from("service_automation_events").insert({
          user_id: business.user_id,
          lead_id: leadId,
          conversation_id: conversation.id,
          event_type: "sms_reschedule_more_options_sent",
          payload: {
            messageSid,
            fromNumber,
            toNumber,
            bookingId: pendingReschedule.bookingId,
            optionCount: moreOptions.length,
            batch: nextBatch,
            expiresAt,
          },
          success: true,
        });

        return xmlResponse(buildSmsTwiml(moreOptionsReply));
      }

      const selectedOption = pendingReschedule.options.find(
        (option) => option.index === selection,
      );

      if (!selectedOption) {
        const retryReply =
          "Please reply with 1, 2, or 3 to pick a slot, or 4 to get more times.";

        await supabase.from("service_messages").insert({
          user_id: business.user_id,
          conversation_id: conversation.id,
          direction: "outbound",
          sender_type: "system",
          body: retryReply,
        });

        await supabase
          .from("service_conversations")
          .update({
            state: "open",
            last_message_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", conversation.id)
          .eq("user_id", business.user_id);

        await supabase.from("service_ai_runs").insert({
          user_id: business.user_id,
          conversation_id: conversation.id,
          lead_id: leadId,
          model: "booking-reschedule-selector-v2",
          input_tokens: estimateTokenCount(body),
          output_tokens: estimateTokenCount(retryReply),
          latency_ms: Date.now() - startedAt,
          estimated_cost: 0,
          outcome: "fallback",
          drift_score: 0.024,
        });

        return xmlResponse(buildSmsTwiml(retryReply));
      }

      const { data: bookingData } = await supabase
        .from("service_bookings")
        .select("id, status")
        .eq("id", pendingReschedule.bookingId)
        .eq("user_id", business.user_id)
        .eq("customer_id", customer.id)
        .maybeSingle();

      if (!bookingData) {
        delete conversationMetadata.pendingReschedule;

        const missingReply =
          "We couldn't locate that booking anymore. Reply R to request new options.";

        await supabase.from("service_messages").insert({
          user_id: business.user_id,
          conversation_id: conversation.id,
          direction: "outbound",
          sender_type: "system",
          body: missingReply,
        });

        await supabase
          .from("service_conversations")
          .update({
            metadata: conversationMetadata,
            state: "open",
            last_message_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", conversation.id)
          .eq("user_id", business.user_id);

        await supabase.from("service_ai_runs").insert({
          user_id: business.user_id,
          conversation_id: conversation.id,
          lead_id: leadId,
          model: "booking-reschedule-selector-v2",
          input_tokens: estimateTokenCount(body),
          output_tokens: estimateTokenCount(missingReply),
          latency_ms: Date.now() - startedAt,
          estimated_cost: 0,
          outcome: "fallback",
          drift_score: 0.03,
        });

        return xmlResponse(buildSmsTwiml(missingReply));
      }

      await supabase
        .from("service_bookings")
        .update({
          scheduled_start: selectedOption.startIso,
          scheduled_end: selectedOption.endIso,
          status: "confirmed",
          updated_at: nowIso,
        })
        .eq("id", pendingReschedule.bookingId)
        .eq("user_id", business.user_id)
        .eq("customer_id", customer.id);

      await skipPendingRemindersForBooking({
        userId: business.user_id,
        bookingId: pendingReschedule.bookingId,
        reason: "reschedule_option_selected",
      });

      await refreshBookingReminders({
        userId: business.user_id,
        bookingId: pendingReschedule.bookingId,
        scheduledStartIso: selectedOption.startIso,
        bookingStatus: "confirmed",
        nowIso,
      });

      await markRescheduleRequestConfirmed({
        userId: business.user_id,
        bookingId: pendingReschedule.bookingId,
        customerId: customer.id,
        leadId,
        conversationId: conversation.id,
        latestCustomerMessage: body,
        selectedIndex: selection,
        selectedStartIso: selectedOption.startIso,
        selectedEndIso: selectedOption.endIso,
      });

      delete conversationMetadata.pendingReschedule;

      const selectedReply = `Perfect - your booking is now confirmed for ${selectedOption.label}.`;

      await supabase.from("service_messages").insert({
        user_id: business.user_id,
        conversation_id: conversation.id,
        direction: "outbound",
        sender_type: "system",
        body: selectedReply,
      });

      await supabase
        .from("service_conversations")
        .update({
          metadata: conversationMetadata,
          state: "open",
          last_message_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", conversation.id)
        .eq("user_id", business.user_id);

      if (leadId) {
        await supabase
          .from("service_leads")
          .update({
            status: "booked",
            last_activity_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", leadId)
          .eq("user_id", business.user_id);
      }

      await supabase.from("service_ai_runs").insert({
        user_id: business.user_id,
        conversation_id: conversation.id,
        lead_id: leadId,
        model: "booking-reschedule-selector-v2",
        input_tokens: estimateTokenCount(body),
        output_tokens: estimateTokenCount(selectedReply),
        latency_ms: Date.now() - startedAt,
        estimated_cost: 0,
        outcome: "completed",
        drift_score: 0.011,
      });

      await supabase.from("service_automation_events").insert({
        user_id: business.user_id,
        lead_id: leadId,
        conversation_id: conversation.id,
        event_type: "sms_reschedule_option_selected",
        payload: {
          messageSid,
          fromNumber,
          toNumber,
          bookingId: pendingReschedule.bookingId,
          selectedIndex: selection,
          scheduledStart: selectedOption.startIso,
          scheduledEnd: selectedOption.endIso,
        },
        success: true,
      });

      return xmlResponse(buildSmsTwiml(selectedReply));
    }

    if (selection === 4 && !pendingReschedule) {
      const moreTimesReply =
        "There is no active reschedule option set right now. Reply R to request new available times.";

      await supabase.from("service_messages").insert({
        user_id: business.user_id,
        conversation_id: conversation.id,
        direction: "outbound",
        sender_type: "system",
        body: moreTimesReply,
      });

      await supabase.from("service_ai_runs").insert({
        user_id: business.user_id,
        conversation_id: conversation.id,
        lead_id: leadId,
        model: "booking-reschedule-selector-v2",
        input_tokens: estimateTokenCount(body),
        output_tokens: estimateTokenCount(moreTimesReply),
        latency_ms: Date.now() - startedAt,
        estimated_cost: 0,
        outcome: "fallback",
        drift_score: 0.026,
      });

      return xmlResponse(buildSmsTwiml(moreTimesReply));
    }

    const command = detectBookingCommand(body);

    if (command) {
      const upcoming = await getUpcomingBooking({
        userId: business.user_id,
        customerId: customer.id,
        timezone: business.timezone,
      });

      let reply = "";
      let conversationState: ConversationState = "open";
      let leadStatus: LeadState = "new";
      let outcome: "completed" | "handoff" | "fallback" = "completed";
      let eventType = "sms_booking_command_handled";
      let eventPayload: Record<string, unknown> = {
        messageSid,
        fromNumber,
        toNumber,
        command,
      };

      if (!upcoming.booking) {
        reply =
          "Thanks for the update. We couldn't find an upcoming booking on this number. Please reply with your address and preferred date/time and we will help.";
        outcome = "fallback";
        eventType = "sms_booking_command_no_match";
      } else if (command === "confirm") {
        const booking = upcoming.booking;
        const wasConfirmed = booking.status === "confirmed";

        await supabase
          .from("service_bookings")
          .update({
            status: "confirmed",
            updated_at: nowIso,
          })
          .eq("id", booking.id)
          .eq("user_id", business.user_id);

        await refreshBookingReminders({
          userId: business.user_id,
          bookingId: booking.id,
          scheduledStartIso: booking.scheduled_start,
          bookingStatus: "confirmed",
          nowIso,
        });

        await markRescheduleRequestClosed({
          userId: business.user_id,
          bookingId: booking.id,
          reason: "customer_confirmed_via_sms",
        });

        delete conversationMetadata.pendingReschedule;

        const serviceLabel = upcoming.serviceName ? ` for ${upcoming.serviceName}` : "";
        const whenLabel = upcoming.whenLabel ?? booking.scheduled_start;

        reply = wasConfirmed
          ? `You're all set - your booking${serviceLabel} is already confirmed for ${whenLabel}.`
          : `Confirmed. Your booking${serviceLabel} is set for ${whenLabel}. Reply R anytime if you need to reschedule.`;

        leadStatus = "booked";
        conversationState = "open";
        outcome = "completed";
        eventType = "sms_booking_confirmed";
        eventPayload = {
          ...eventPayload,
          bookingId: booking.id,
          previousStatus: booking.status,
          newStatus: "confirmed",
        };
      } else {
        const booking = upcoming.booking;

        const options = await generateRescheduleOptions({
          userId: business.user_id,
          excludeBookingId: booking.id,
          durationMinutes: upcoming.durationMinutes,
          timezone: business.timezone,
          count: 3,
          startFromIso: nowIso,
        });

        await supabase
          .from("service_bookings")
          .update({
            status: "rescheduled",
            updated_at: nowIso,
          })
          .eq("id", booking.id)
          .eq("user_id", business.user_id);

        await skipPendingRemindersForBooking({
          userId: business.user_id,
          bookingId: booking.id,
          reason: "reschedule_requested",
        });

        if (options.length > 0) {
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
          const initialBatch = 1;
          conversationMetadata.pendingReschedule = {
            bookingId: booking.id,
            options,
            batch: initialBatch,
            createdAt: nowIso,
            expiresAt,
          };

          await upsertRescheduleRequestOptions({
            userId: business.user_id,
            bookingId: booking.id,
            customerId: customer.id,
            leadId,
            conversationId: conversation.id,
            latestCustomerMessage: body,
            batch: initialBatch,
            expiresAt,
            options,
          });

          reply = buildOptionsReply(options);
          conversationState = "open";
          leadStatus = "qualified";
          outcome = "completed";
          eventType = "sms_booking_reschedule_options_sent";
          eventPayload = {
            ...eventPayload,
            bookingId: booking.id,
            previousStatus: booking.status,
            newStatus: "rescheduled",
            optionCount: options.length,
            expiresAt,
          };
        } else {
          delete conversationMetadata.pendingReschedule;
          reply =
            "Got it - we received your reschedule request. A team member will text you shortly with new time options.";
          conversationState = "handoff";
          leadStatus = "qualified";
          outcome = "handoff";
          eventType = "sms_booking_reschedule_requested";
          eventPayload = {
            ...eventPayload,
            bookingId: booking.id,
            previousStatus: booking.status,
            newStatus: "rescheduled",
            optionCount: 0,
          };

          await markRescheduleRequestHandoff({
            userId: business.user_id,
            bookingId: booking.id,
            customerId: customer.id,
            leadId,
            conversationId: conversation.id,
            latestCustomerMessage: body,
            reason: "auto_options_unavailable",
            optionBatch: 0,
          });
        }
      }

      await supabase.from("service_messages").insert({
        user_id: business.user_id,
        conversation_id: conversation.id,
        direction: "outbound",
        sender_type: outcome === "handoff" ? "system" : "ai",
        body: reply,
        ai_confidence: outcome === "completed" ? 0.9 : 0.7,
      });

      await supabase.from("service_ai_runs").insert({
        user_id: business.user_id,
        conversation_id: conversation.id,
        lead_id: leadId,
        model: "booking-command-router-v2",
        input_tokens: estimateTokenCount(body),
        output_tokens: estimateTokenCount(reply),
        latency_ms: Date.now() - startedAt,
        estimated_cost: 0,
        outcome,
        drift_score:
          outcome === "handoff" ? 0.02 : outcome === "fallback" ? 0.028 : 0.011,
      });

      await supabase
        .from("service_conversations")
        .update({
          metadata: conversationMetadata,
          state: conversationState,
          last_message_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", conversation.id)
        .eq("user_id", business.user_id);

      if (leadId) {
        await supabase
          .from("service_leads")
          .update({
            status: leadStatus,
            last_activity_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", leadId)
          .eq("user_id", business.user_id);
      }

      await supabase.from("service_automation_events").insert({
        user_id: business.user_id,
        lead_id: leadId,
        conversation_id: conversation.id,
        event_type: eventType,
        payload: eventPayload,
        success: true,
      });

      return xmlResponse(buildSmsTwiml(reply));
    }

    const decision = buildReceptionDecision({
      businessName: business.business_name,
      customerMessage: body,
    });

    await supabase.from("service_messages").insert({
      user_id: business.user_id,
      conversation_id: conversation.id,
      direction: "outbound",
      sender_type: decision.outcome === "handoff" ? "system" : "ai",
      body: decision.reply,
      ai_confidence: decision.confidence,
    });

    await supabase.from("service_ai_runs").insert({
      user_id: business.user_id,
      conversation_id: conversation.id,
      lead_id: leadId,
      model: "heuristic-router-v1",
      input_tokens: estimateTokenCount(body),
      output_tokens: estimateTokenCount(decision.reply),
      latency_ms: Date.now() - startedAt,
      estimated_cost: 0,
      outcome: decision.outcome,
      drift_score: decision.driftScore,
    });

    await supabase
      .from("service_conversations")
      .update({
        state: decision.outcome === "handoff" ? "handoff" : "open",
        last_message_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", conversation.id)
      .eq("user_id", business.user_id);

    if (leadId) {
      await supabase
        .from("service_leads")
        .update({
          status: decision.outcome === "handoff" ? "qualified" : "new",
          last_activity_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", leadId)
        .eq("user_id", business.user_id);
    }

    await supabase.from("service_automation_events").insert({
      user_id: business.user_id,
      lead_id: leadId,
      conversation_id: conversation.id,
      event_type: "sms_inbound_auto_reply",
      payload: {
        messageSid,
        fromNumber,
        toNumber,
        outcome: decision.outcome,
      },
      success: true,
    });

    return xmlResponse(buildSmsTwiml(decision.reply));
  } catch {
    return xmlResponse(buildSmsTwiml(GENERIC_SMS_REPLY));
  }
}
