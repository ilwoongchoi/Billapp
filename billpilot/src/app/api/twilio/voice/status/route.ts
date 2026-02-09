import { NextResponse } from "next/server";

import { getServiceSupabaseClient } from "@/lib/supabase";
import { normalizePhoneNumber, readTwilioForm } from "@/lib/reception/twiml";

export const runtime = "nodejs";

interface CallOwnershipRow {
  user_id: string;
  lead_id: string | null;
}

function parseDurationSeconds(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export async function POST(request: Request) {
  try {
    const form = await readTwilioForm(request);
    const callSid = form.CallSid?.trim();

    if (!callSid) {
      return NextResponse.json({ error: "missing_call_sid" }, { status: 400 });
    }

    const supabase = getServiceSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "supabase_not_configured" },
        { status: 500 },
      );
    }

    const { data: existing } = await supabase
      .from("service_calls")
      .select("user_id, lead_id")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

    const call = (existing as CallOwnershipRow | null) ?? null;

    const durationSeconds = parseDurationSeconds(form.CallDuration);
    const status = form.CallStatus ?? null;
    const answered = Boolean(durationSeconds && durationSeconds > 0);

    await supabase
      .from("service_calls")
      .update({
        call_status: status,
        duration_seconds: durationSeconds,
        answered,
        from_number: normalizePhoneNumber(form.From),
        to_number: normalizePhoneNumber(form.To),
        recording_url: form.RecordingUrl ?? null,
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("twilio_call_sid", callSid);

    if (call?.user_id) {
      await supabase.from("service_automation_events").insert({
        user_id: call.user_id,
        lead_id: call.lead_id,
        event_type: "voice_status_callback",
        payload: {
          callSid,
          callStatus: status,
          durationSeconds,
          answered,
        },
        success: true,
      });

      if (call.lead_id) {
        await supabase
          .from("service_leads")
          .update({
            last_activity_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", call.lead_id)
          .eq("user_id", call.user_id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json(
      {
        error: "voice_status_failed",
        message,
      },
      { status: 500 },
    );
  }
}
