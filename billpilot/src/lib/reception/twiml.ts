export type TwilioFormPayload = Record<string, string>;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function normalizePhoneNumber(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim();
}

export async function readTwilioForm(request: Request): Promise<TwilioFormPayload> {
  const formData = await request.formData();
  const payload: TwilioFormPayload = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      payload[key] = value;
    }
  }

  return payload;
}

export function buildSmsTwiml(message: string): string {
  const safeMessage = escapeXml(message);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safeMessage}</Message></Response>`;
}

export function buildVoiceTwiml(input: {
  spokenMessage: string;
  smsMessage?: string;
}): string {
  const spokenMessage = escapeXml(input.spokenMessage);
  const smsPart = input.smsMessage
    ? `<Message>${escapeXml(input.smsMessage)}</Message>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${spokenMessage}</Say>${smsPart}<Hangup/></Response>`;
}

export function xmlResponse(twiml: string): Response {
  return new Response(twiml, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
