import { NextResponse } from "next/server";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SubscriptionRow {
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  updated_at: string | null;
}

interface WebhookEventRow {
  id: string;
  stripe_event_id: string;
  stripe_event_type: string;
  status: string;
  created_at: string;
  processed_at: string | null;
  error_message: string | null;
}

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

    const [{ data: subscriptionData }, { data: eventsData }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select(
          "plan, status, current_period_end, stripe_customer_id, stripe_subscription_id, updated_at",
        )
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("webhook_events")
        .select(
          "id, stripe_event_id, stripe_event_type, status, created_at, processed_at, error_message",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

    const subscription = (subscriptionData as SubscriptionRow | null) ?? {
      plan: "free",
      status: "inactive",
      current_period_end: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      updated_at: null,
    };

    const events = ((eventsData as WebhookEventRow[] | null) ?? []).map((event) => ({
      id: event.id,
      stripeEventId: event.stripe_event_id,
      eventType: event.stripe_event_type,
      status: event.status,
      createdAt: event.created_at,
      processedAt: event.processed_at,
      errorMessage: event.error_message,
    }));

    return NextResponse.json({
      diagnostics: {
        stripeSecretConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
        webhookSecretConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        starterPriceConfigured: Boolean(process.env.STRIPE_STARTER_PRICE_ID),
        proPriceConfigured: Boolean(process.env.STRIPE_PRO_PRICE_ID),
        teamPriceConfigured: Boolean(process.env.STRIPE_TEAM_PRICE_ID),
      },
      subscription,
      events,
    });
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
