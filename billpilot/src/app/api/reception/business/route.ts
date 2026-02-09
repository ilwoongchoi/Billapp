import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const phonePattern = /^\+?[1-9]\d{6,15}$/;

const updateBusinessSchema = z.object({
  businessName: z.string().min(2).max(120),
  timezone: z.string().min(2).max(60).optional(),
  twilioPhoneNumber: z
    .string()
    .trim()
    .regex(phonePattern, "Expected E.164-ish phone format")
    .optional()
    .or(z.literal(""))
    .or(z.null()),
});

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

    const { data, error } = await supabase
      .from("service_businesses")
      .select("id, business_name, timezone, twilio_phone_number, created_at, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "business_lookup_failed", message: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ business: data ?? null });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
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

    const body = updateBusinessSchema.parse(await request.json());
    const twilioPhoneNumber =
      typeof body.twilioPhoneNumber === "string" && body.twilioPhoneNumber.trim().length > 0
        ? body.twilioPhoneNumber.trim()
        : null;

    const { data, error } = await supabase
      .from("service_businesses")
      .upsert(
        {
          user_id: user.id,
          business_name: body.businessName,
          timezone: body.timezone ?? "UTC",
          twilio_phone_number: twilioPhoneNumber,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("id, business_name, timezone, twilio_phone_number, created_at, updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          error: "business_upsert_failed",
          message: error?.message ?? "Unable to save business profile.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ business: data });
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
