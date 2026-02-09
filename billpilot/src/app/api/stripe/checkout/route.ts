import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { getServiceSupabaseClient } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";

export const runtime = "nodejs";

const payloadSchema = z.object({
  plan: z.enum(["starter", "pro", "team"]).default("starter"),
});

interface SubscriptionLookupRow {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string | null;
  status: string | null;
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

function getPriceIdForPlan(plan: "starter" | "pro" | "team"): string | null {
  if (plan === "starter") {
    return process.env.STRIPE_STARTER_PRICE_ID ?? null;
  }
  if (plan === "team") {
    return process.env.STRIPE_TEAM_PRICE_ID ?? null;
  }
  return process.env.STRIPE_PRO_PRICE_ID ?? null;
}

async function lookupSubscriptionRow(
  userId: string,
): Promise<SubscriptionLookupRow | null> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id, stripe_subscription_id, plan, status")
    .eq("user_id", userId)
    .maybeSingle();

  return (data as SubscriptionLookupRow | null) ?? null;
}

async function upsertSubscriptionRow(input: {
  userId: string;
  stripeCustomerId: string | null;
  plan: "starter" | "pro" | "team";
}) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase.from("subscriptions").upsert(
    {
      user_id: input.userId,
      stripe_customer_id: input.stripeCustomerId,
      plan: input.plan,
      status: "pending_checkout",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);
    const stripe = getStripeClient();
    if (!stripe) {
      return NextResponse.json(
        {
          error: "stripe_not_configured",
          message: "Set STRIPE_SECRET_KEY and price IDs in env.",
        },
        { status: 500 },
      );
    }

    const body = await request.json();
    const { plan } = payloadSchema.parse(body);
    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      return NextResponse.json(
        {
          error: "missing_price_id",
          message:
            plan === "starter"
              ? "Set STRIPE_STARTER_PRICE_ID in env."
              : `Set STRIPE_${plan.toUpperCase()}_PRICE_ID in env.`,
        },
        { status: 500 },
      );
    }

    const baseUrl = resolveBaseUrl(request);
    const existing = await lookupSubscriptionRow(user.id);
    let customerId = existing?.stripe_customer_id ?? null;

    if (!customerId && user.email) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
        },
      });
      customerId = customer.id;
    }

    await upsertSubscriptionRow({
      userId: user.id,
      stripeCustomerId: customerId,
      plan,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId ?? undefined,
      customer_email: customerId ? undefined : user.email ?? undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard?checkout=success`,
      cancel_url: `${baseUrl}/dashboard?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: {
        userId: user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          userId: user.id,
          plan,
        },
      },
    });

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
      plan,
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
