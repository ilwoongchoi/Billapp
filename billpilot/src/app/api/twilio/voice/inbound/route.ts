import { getServiceSupabaseClient } from "@/lib/supabase";
import {
  buildVoiceTwiml,
  normalizePhoneNumber,
  readTwilioForm,
  xmlResponse,
} from "@/lib/reception/twiml";

export const runtime = "nodejs";

interface BusinessRow {
  id: string;
  user_id: string;
  business_name: string;
}

interface CustomerRow {
  id: string;
}

interface LeadRow {
  id: string;
}

const GENERIC_VOICE_MESSAGE =
  "Thanks for calling. We are helping another customer right now. Please watch for our text reply in a few seconds.";

export async function POST(request: Request) {
  try {
    const form = await readTwilioForm(request);
    const callSid = form.CallSid?.trim();
    const fromNumber = normalizePhoneNumber(form.From);
    const toNumber = normalizePhoneNumber(form.To);

    if (!callSid || !fromNumber || !toNumber) {
      return xmlResponse(buildVoiceTwiml({ spokenMessage: GENERIC_VOICE_MESSAGE }));
    }

    const supabase = getServiceSupabaseClient();
    if (!supabase) {
      return xmlResponse(buildVoiceTwiml({ spokenMessage: GENERIC_VOICE_MESSAGE }));
    }

    const { data: businessData } = await supabase
      .from("service_businesses")
      .select("id, user_id, business_name")
      .eq("twilio_phone_number", toNumber)
      .maybeSingle();

    const business = (businessData as BusinessRow | null) ?? null;
    if (!business) {
      return xmlResponse(buildVoiceTwiml({ spokenMessage: GENERIC_VOICE_MESSAGE }));
    }

    const { data: customerData } = await supabase
      .from("service_customers")
      .upsert(
        {
          user_id: business.user_id,
          phone_e164: fromNumber,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,phone_e164" },
      )
      .select("id")
      .single();

    const customer = (customerData as CustomerRow | null) ?? null;

    const { data: leadData } = await supabase
      .from("service_leads")
      .upsert(
        {
          user_id: business.user_id,
          customer_id: customer?.id ?? null,
          source: "phone",
          status: "new",
          twilio_call_sid: callSid,
          summary: "Inbound phone lead",
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "twilio_call_sid" },
      )
      .select("id")
      .single();

    const lead = (leadData as LeadRow | null) ?? null;

    const { data: conversationData } = await supabase
      .from("service_conversations")
      .insert({
        user_id: business.user_id,
        customer_id: customer?.id ?? null,
        lead_id: lead?.id ?? null,
        channel: "voice",
        state: "open",
        metadata: {
          callSid,
          source: "voice_inbound",
        },
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    const conversationId =
      (conversationData as { id?: string } | null)?.id ?? null;

    await supabase.from("service_calls").upsert(
      {
        user_id: business.user_id,
        customer_id: customer?.id ?? null,
        lead_id: lead?.id ?? null,
        twilio_call_sid: callSid,
        from_number: fromNumber,
        to_number: toNumber,
        call_status: form.CallStatus ?? "ringing",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "twilio_call_sid" },
    );

    const smsMessage = `Thanks for calling ${business.business_name}. Reply with your service need + address and we can quote or book your job quickly.`;

    if (conversationId) {
      await supabase.from("service_messages").insert({
        user_id: business.user_id,
        conversation_id: conversationId,
        direction: "outbound",
        sender_type: "system",
        body: smsMessage,
      });

      await supabase.from("service_automation_events").insert({
        user_id: business.user_id,
        lead_id: lead?.id ?? null,
        conversation_id: conversationId,
        event_type: "voice_inbound_auto_sms",
        payload: {
          callSid,
          fromNumber,
          toNumber,
        },
        success: true,
      });
    }

    return xmlResponse(
      buildVoiceTwiml({
        spokenMessage: `Thanks for calling ${business.business_name}. We just sent you a text so we can help right away.`,
        smsMessage,
      }),
    );
  } catch {
    return xmlResponse(buildVoiceTwiml({ spokenMessage: GENERIC_VOICE_MESSAGE }));
  }
}
