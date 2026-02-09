import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const payloadSchema = z.object({
  status: z.enum(["new", "qualified", "booked", "lost"]),
  summary: z.string().max(400).optional(),
  estimatedValue: z.number().min(0).max(1_000_000).nullable().optional(),
});

interface LeadRouteContext {
  params: Promise<{
    leadId: string;
  }>;
}

export async function PATCH(request: Request, context: LeadRouteContext) {
  try {
    const user = await requireApiUser(request);
    const { leadId } = await context.params;
    const parsedLeadId = z.string().uuid().parse(leadId);
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
      .from("service_leads")
      .update({
        status: body.status,
        summary: body.summary ?? undefined,
        estimated_value:
          body.estimatedValue === undefined ? undefined : body.estimatedValue,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsedLeadId)
      .eq("user_id", user.id)
      .select(
        "id, status, source, summary, estimated_value, first_contact_at, last_activity_at, created_at",
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          error: "lead_update_failed",
          message: error.message,
        },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          error: "lead_not_found",
          message: "Lead not found for this user.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      lead: {
        id: data.id,
        status: data.status,
        source: data.source,
        summary: data.summary,
        estimatedValue: data.estimated_value,
        firstContactAt: data.first_contact_at,
        lastActivityAt: data.last_activity_at,
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
