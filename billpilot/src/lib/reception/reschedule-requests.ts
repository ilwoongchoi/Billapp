import { getServiceSupabaseClient } from "@/lib/supabase";

interface BaseRequestInput {
  userId: string;
  bookingId: string;
  customerId: string | null;
  leadId: string | null;
  conversationId: string | null;
  latestCustomerMessage: string | null;
}

export interface RescheduleOptionSummary {
  index: number;
  startIso: string;
  endIso: string;
  label: string;
}

function minutesFromNowIso(minutes: number): string {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(1, Math.floor(minutes)) : 60;
  return new Date(Date.now() + safeMinutes * 60 * 1000).toISOString();
}

export async function upsertRescheduleRequestOptions(input: BaseRequestInput & {
  batch: number;
  expiresAt: string;
  options: RescheduleOptionSummary[];
}): Promise<void> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase.from("service_reschedule_requests").upsert(
    {
      user_id: input.userId,
      booking_id: input.bookingId,
      customer_id: input.customerId,
      lead_id: input.leadId,
      conversation_id: input.conversationId,
      status: "options_sent",
      requested_at: new Date().toISOString(),
      resolved_at: null,
      sla_due_at: minutesFromNowIso(120),
      escalation_level: 0,
      last_escalated_at: null,
      latest_customer_message: input.latestCustomerMessage,
      option_batch: input.batch,
      selected_option_index: null,
      selected_start: null,
      selected_end: null,
      metadata: {
        expiresAt: input.expiresAt,
        options: input.options,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "booking_id" },
  );
}

export async function markRescheduleRequestConfirmed(input: BaseRequestInput & {
  selectedIndex: number;
  selectedStartIso: string;
  selectedEndIso: string;
}): Promise<void> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase
    .from("service_reschedule_requests")
    .update({
      customer_id: input.customerId,
      lead_id: input.leadId,
      conversation_id: input.conversationId,
      status: "confirmed",
      resolved_at: new Date().toISOString(),
      sla_due_at: null,
      escalation_level: 0,
      last_escalated_at: null,
      latest_customer_message: input.latestCustomerMessage,
      selected_option_index: input.selectedIndex,
      selected_start: input.selectedStartIso,
      selected_end: input.selectedEndIso,
      metadata: {
        resolution: "selected_option",
        selectedIndex: input.selectedIndex,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("booking_id", input.bookingId)
    .eq("user_id", input.userId);
}

export async function markRescheduleRequestHandoff(input: BaseRequestInput & {
  reason: string;
  optionBatch?: number;
}): Promise<void> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase.from("service_reschedule_requests").upsert(
    {
      user_id: input.userId,
      booking_id: input.bookingId,
      customer_id: input.customerId,
      lead_id: input.leadId,
      conversation_id: input.conversationId,
      status: "handoff",
      requested_at: new Date().toISOString(),
      resolved_at: null,
      sla_due_at: minutesFromNowIso(30),
      escalation_level: 0,
      last_escalated_at: null,
      latest_customer_message: input.latestCustomerMessage,
      option_batch: input.optionBatch ?? 0,
      metadata: {
        reason: input.reason,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "booking_id" },
  );
}

export async function markRescheduleRequestClosed(input: {
  userId: string;
  bookingId: string;
  reason: string;
}): Promise<void> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase
    .from("service_reschedule_requests")
    .update({
      status: "closed",
      resolved_at: new Date().toISOString(),
      sla_due_at: null,
      escalation_level: 0,
      last_escalated_at: null,
      metadata: {
        reason: input.reason,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("booking_id", input.bookingId)
    .eq("user_id", input.userId);
}
