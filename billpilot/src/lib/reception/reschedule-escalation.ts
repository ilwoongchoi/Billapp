import { getServiceSupabaseClient } from "@/lib/supabase";

type RescheduleStatus = "pending" | "options_sent" | "handoff" | "confirmed" | "closed";

interface EscalationRow {
  id: string;
  booking_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  status: RescheduleStatus;
  sla_due_at: string | null;
  escalation_level: number;
  metadata: Record<string, unknown> | null;
}

export interface RescheduleEscalationSweepResult {
  userId: string;
  dryRun: boolean;
  checked: number;
  overdue: number;
  escalated: number;
  autoHandoff: number;
  errors: number;
  maxLevelReached: number;
  notes: string[];
}

const ACTION_REQUIRED_STATUSES: ReadonlyArray<RescheduleStatus> = [
  "pending",
  "options_sent",
  "handoff",
];

function computeEscalationLevel(overdueMinutes: number): number {
  if (overdueMinutes >= 180) {
    return 3;
  }
  if (overdueMinutes >= 60) {
    return 2;
  }
  if (overdueMinutes >= 15) {
    return 1;
  }
  return 0;
}

function normalizeEscalationLevel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(5, Math.floor(value)));
}

function isoMinutesFromNow(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(1, Math.floor(minutes)) : 30;
  return new Date(Date.now() + safe * 60 * 1000).toISOString();
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function listRescheduleEscalationUsers(): Promise<string[]> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("service_reschedule_requests")
    .select("user_id")
    .in("status", ACTION_REQUIRED_STATUSES as string[])
    .limit(1000);

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

export async function runRescheduleEscalationSweepForUser(input: {
  userId: string;
  dryRun?: boolean;
  maxRows?: number;
}): Promise<RescheduleEscalationSweepResult> {
  const dryRun = Boolean(input.dryRun);
  const maxRows = Math.min(500, Math.max(1, input.maxRows ?? 150));
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return {
      userId: input.userId,
      dryRun,
      checked: 0,
      overdue: 0,
      escalated: 0,
      autoHandoff: 0,
      errors: 0,
      maxLevelReached: 0,
      notes: ["supabase_not_configured"],
    };
  }

  const notes: string[] = [];
  const { data, error } = await supabase
    .from("service_reschedule_requests")
    .select(
      "id, booking_id, lead_id, conversation_id, status, sla_due_at, escalation_level, metadata",
    )
    .eq("user_id", input.userId)
    .in("status", ACTION_REQUIRED_STATUSES as string[])
    .not("sla_due_at", "is", null)
    .lte("sla_due_at", nowIso)
    .order("sla_due_at", { ascending: true })
    .limit(maxRows);

  if (error) {
    return {
      userId: input.userId,
      dryRun,
      checked: 0,
      overdue: 0,
      escalated: 0,
      autoHandoff: 0,
      errors: 1,
      maxLevelReached: 0,
      notes: [`query_failed:${error.message}`],
    };
  }

  const rows = (data ?? []) as EscalationRow[];

  let overdue = 0;
  let escalated = 0;
  let autoHandoff = 0;
  let errors = 0;
  let maxLevelReached = 0;

  for (const row of rows) {
    const dueMs = row.sla_due_at ? new Date(row.sla_due_at).getTime() : Number.NaN;
    if (!Number.isFinite(dueMs)) {
      continue;
    }

    const overdueMinutes = Math.max(1, Math.floor((nowMs - dueMs) / (60 * 1000)));
    overdue += 1;

    const currentLevel = normalizeEscalationLevel(row.escalation_level);
    const targetLevel = computeEscalationLevel(overdueMinutes);
    if (targetLevel <= currentLevel) {
      maxLevelReached = Math.max(maxLevelReached, currentLevel);
      continue;
    }

    maxLevelReached = Math.max(maxLevelReached, targetLevel);
    escalated += 1;

    const shouldAutoHandoff =
      targetLevel >= 2 && (row.status === "pending" || row.status === "options_sent");
    if (shouldAutoHandoff) {
      autoHandoff += 1;
    }

    if (dryRun) {
      continue;
    }

    const existingMetadata = isObjectRecord(row.metadata) ? row.metadata : {};
    const existingEscalationMeta = isObjectRecord(existingMetadata.escalation)
      ? (existingMetadata.escalation as Record<string, unknown>)
      : {};

    const mergedMetadata: Record<string, unknown> = {
      ...existingMetadata,
      escalation: {
        ...existingEscalationMeta,
        level: targetLevel,
        escalatedAt: nowIso,
        overdueMinutes,
        previousLevel: currentLevel,
        previousStatus: row.status,
      },
    };

    const updatePayload: Record<string, unknown> = {
      escalation_level: targetLevel,
      last_escalated_at: nowIso,
      metadata: mergedMetadata,
      updated_at: nowIso,
    };

    if (shouldAutoHandoff) {
      updatePayload.status = "handoff";
      updatePayload.sla_due_at = isoMinutesFromNow(30);
      (
        mergedMetadata.escalation as Record<string, unknown>
      ).autoHandoff = true;
    }

    const { error: updateError } = await supabase
      .from("service_reschedule_requests")
      .update(updatePayload)
      .eq("id", row.id)
      .eq("user_id", input.userId);

    if (updateError) {
      errors += 1;
      notes.push(`update_failed:${row.id}:${updateError.message}`);
      continue;
    }

    const { error: eventError } = await supabase
      .from("service_automation_events")
      .insert({
        user_id: input.userId,
        lead_id: row.lead_id,
        conversation_id: row.conversation_id,
        event_type: `reschedule_request_escalated_l${targetLevel}`,
        payload: {
          requestId: row.id,
          bookingId: row.booking_id,
          previousStatus: row.status,
          currentStatus: shouldAutoHandoff ? "handoff" : row.status,
          previousLevel: currentLevel,
          level: targetLevel,
          overdueMinutes,
          autoHandoff: shouldAutoHandoff,
        },
        success: true,
      });

    if (eventError) {
      errors += 1;
      notes.push(`event_failed:${row.id}:${eventError.message}`);
    }
  }

  return {
    userId: input.userId,
    dryRun,
    checked: rows.length,
    overdue,
    escalated,
    autoHandoff,
    errors,
    maxLevelReached,
    notes,
  };
}
