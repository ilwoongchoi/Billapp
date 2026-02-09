import { NextResponse } from "next/server";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getServiceSupabaseClient } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";

export const runtime = "nodejs";

interface SubscriptionRow {
  stripe_customer_id: string | null;
}

function resolveBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) {
    return explicit;
  }

  const origin = request.headers.get("origin");
  if (origin) {
    return origin;
  }

  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    return `${proto}://${host}`;
  }

  return "http://localhost:3000";
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);
    const stripe = getStripeClient();
    const supabase = getServiceSupabaseClient();

    if (!stripe || !supabase) {
      return NextResponse.json(
        {
          error: "billing_not_configured",
          message:
            "Set Stripe + Supabase server env vars before opening the billing portal.",
        },
        { status: 500 },
      );
    }

    const { data } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const row = (data as SubscriptionRow | null) ?? null;
    if (!row?.stripe_customer_id) {
      return NextResponse.json(
        {
          error: "no_customer",
          message: "No Stripe customer found. Start checkout first.",
        },
        { status: 400 },
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${resolveBaseUrl(request)}/dashboard`,
    });

    return NextResponse.json({ url: session.url });
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

