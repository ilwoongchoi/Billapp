export interface TwilioSmsInput {
  to: string;
  body: string;
  from?: string | null;
}

export interface TwilioSmsResult {
  ok: boolean;
  messageSid: string | null;
  status: string | null;
  error: string | null;
}

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  defaultFrom: string | null;
}

function readTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (!accountSid || !authToken) {
    return null;
  }

  return {
    accountSid,
    authToken,
    defaultFrom: process.env.TWILIO_PHONE_NUMBER?.trim() ?? null,
  };
}

function trimOrNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function sendTwilioSms(input: TwilioSmsInput): Promise<TwilioSmsResult> {
  const config = readTwilioConfig();
  if (!config) {
    return {
      ok: false,
      messageSid: null,
      status: null,
      error: "twilio_not_configured",
    };
  }

  const to = trimOrNull(input.to);
  const from = trimOrNull(input.from) ?? config.defaultFrom;
  const body = input.body?.trim();

  if (!to || !from || !body) {
    return {
      ok: false,
      messageSid: null,
      status: null,
      error: "invalid_sms_payload",
    };
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const payload = new URLSearchParams({
    To: to,
    From: from,
    Body: body,
  });

  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload,
    });

    const raw = await response.text();
    let parsed: Record<string, unknown> | null = null;

    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const message =
        (parsed?.message as string | undefined) ??
        (parsed?.error_message as string | undefined) ??
        (raw || `twilio_http_${response.status}`);

      return {
        ok: false,
        messageSid: null,
        status: null,
        error: message,
      };
    }

    return {
      ok: true,
      messageSid: (parsed?.sid as string | undefined) ?? null,
      status: (parsed?.status as string | undefined) ?? null,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      messageSid: null,
      status: null,
      error: error instanceof Error ? error.message : "twilio_request_failed",
    };
  }
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim(),
  );
}
