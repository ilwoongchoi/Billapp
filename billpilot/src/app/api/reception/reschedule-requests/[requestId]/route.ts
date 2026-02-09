import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const statusUpdateValues = ["handoff", "closed", "options_sent"] as const;

const payloadSchema = z.object({
  status: z.enum(statusUpdateValues).optional(),
  note: z.string().trim().max(400).optional(),
  assignee: z.string().trim().max(120).nullable().optional(),
  slaDueAt: z.string().datetime({ offset: true }).nullable().optional(),
}).refine(
  (value) =>
    value.status !== undefined ||
    value.note !== undefined ||
    value.assignee !== undefined ||
    value.slaDueAt !== undefined,
  {
    message: "Provide at least one field to update.",
    path: ["status"],
  },
);

interface RouteContext {
  params: Promise<{
    requestId: string;
  }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { requestId } = await context.params;
    const parsedRequestId = z.string().uuid().parse(requestId);
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

    const nowIso = new Date().toISOString();

    const { data: existingData, error: existingError } = await supabase
      .from("service_reschedule_requests")
      .select(
        "id, status, resolved_at, assigned_to, assigned_at, sla_due_at, escalation_level, last_escalated_at, metadata",
      )
      .eq("id", parsedRequestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        {
          error: "reschedule_request_lookup_failed",
          message: existingError.message,
        },
        { status: 500 },
      );
    }

    if (!existingData) {
      return NextResponse.json(
        {
          error: "reschedule_request_not_found",
          message: "Reschedule request not found for this user.",
        },
        { status: 404 },
      );
    }

    const currentMetadata =
      ((existingData as { metadata?: Record<string, unknown> | null }).metadata ?? {}) || {};

    const metadata = {
      ...currentMetadata,
      ...(body.note !== undefined ? { staffNote: body.note || null } : {}),
      staffUpdatedAt: nowIso,
    };

    const updatePayload: Record<string, unknown> = {
      metadata,
      updated_at: nowIso,
    };

    if (body.status !== undefined) {
      updatePayload.status = body.status;
      updatePayload.resolved_at = body.status === "closed" ? nowIso : null;

      if (body.status === "closed" && body.slaDueAt === undefined) {
        updatePayload.sla_due_at = null;
        updatePayload.escalation_level = 0;
        updatePayload.last_escalated_at = null;
      }

      if (body.slaDueAt === undefined) {
        if (body.status === "handoff") {
          updatePayload.sla_due_at = new Date(
            Date.now() + 30 * 60 * 1000,
          ).toISOString();
        } else if (body.status === "options_sent") {
          updatePayload.sla_due_at = new Date(
            Date.now() + 120 * 60 * 1000,
          ).toISOString();
        }
      }
    }

    if (body.assignee !== undefined) {
      const trimmed = body.assignee?.trim() ?? "";
      updatePayload.assigned_to = trimmed || null;
      updatePayload.assigned_at = trimmed ? nowIso : null;
    }

    if (body.slaDueAt !== undefined) {
      updatePayload.sla_due_at = body.slaDueAt;
    }

    const { data, error } = await supabase
      .from("service_reschedule_requests")
      .update(updatePayload)
      .eq("id", parsedRequestId)
      .eq("user_id", user.id)
      .select(
        "id, booking_id, status, requested_at, resolved_at, assigned_to, assigned_at, sla_due_at, escalation_level, last_escalated_at, latest_customer_message, option_batch, selected_option_index, selected_start, selected_end, metadata, updated_at",
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          error: "reschedule_request_update_failed",
          message: error.message,
        },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          error: "reschedule_request_not_found",
          message: "Reschedule request not found for this user.",
        },
        { status: 404 },
      );
    }

    await supabase.from("service_automation_events").insert({
      user_id: user.id,
      lead_id: null,
      event_type: "reschedule_request_status_updated",
      payload: {
        requestId: parsedRequestId,
        status: body.status ?? null,
        note: body.note ?? null,
        assignee: body.assignee ?? null,
        slaDueAt: body.slaDueAt ?? null,
      },
      success: true,
    });

    return NextResponse.json({
      request: {
        id: data.id,
        bookingId: data.booking_id,
        status: data.status,
        requestedAt: data.requested_at,
        resolvedAt: data.resolved_at,
        assignedTo: data.assigned_to,
        assignedAt: data.assigned_at,
        slaDueAt: data.sla_due_at,
        escalationLevel: data.escalation_level ?? 0,
        lastEscalatedAt: data.last_escalated_at,
        latestCustomerMessage: data.latest_customer_message,
        optionBatch: data.option_batch,
        selectedOptionIndex: data.selected_option_index,
        selectedStart: data.selected_start,
        selectedEnd: data.selected_end,
        metadata: data.metadata ?? {},
        updatedAt: data.updated_at,
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
