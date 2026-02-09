import { NextResponse } from "next/server";
import { z } from "zod";

import { newEventId } from "@/lib/audit-utils";
import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const schema = z.object({
  message: z.string().trim().min(4).max(2000),
  eventId: z.string().trim().min(6).optional(),
  inputHash: z.string().trim().min(6).optional(),
  source: z.string().trim().min(2).max(120).default("parse_console"),
  context: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);
    const payload = schema.parse(await request.json());
    const supabase = getServiceSupabaseClient();

    if (!supabase) {
      return NextResponse.json(
        { error: "service_unavailable", message: "Supabase not configured" },
        { status: 503 },
      );
    }

    const verificationId = payload.eventId ?? newEventId("issue");
    const verificationChecksum = payload.inputHash ?? null;

    const { error } = await supabase.from("issue_reports").insert({
      user_id: user.id,
      verification_id: verificationId,
      verification_checksum: verificationChecksum,
      source: payload.source,
      message: payload.message,
      context: payload.context ?? {},
    });

    if (error) {
      return NextResponse.json(
        { error: "issue_log_failed", message: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      status: "ok",
      verificationId,
      verificationChecksum,
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
