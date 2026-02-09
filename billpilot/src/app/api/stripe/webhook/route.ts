import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getServiceSupabaseClient } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";

export const runtime = "nodejs";

type EventStatus = "received" | "processed" | "error";

function unixToIso(value: number | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function resolveCurrentPeriodEnd(subscription: Stripe.Subscription): string | null {
  const ends = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => Number.isFinite(value));

  if (ends.length === 0) {
    return null;
  }

  return unixToIso(Math.max(...ends));
}

function resolvePlanFromSubscription(subscription: Stripe.Subscription): string {
  const starterPrice = process.env.STRIPE_STARTER_PRICE_ID;
  const proPrice = process.env.STRIPE_PRO_PRICE_ID;
  const teamPrice = process.env.STRIPE_TEAM_PRICE_ID;
  const priceIds = subscription.items.data
    .map((item) => item.price.id)
    .filter(Boolean);

  if (teamPrice && priceIds.includes(teamPrice)) {
    return "team";
  }
  if (proPrice && priceIds.includes(proPrice)) {
    return "pro";
  }
  if (starterPrice && priceIds.includes(starterPrice)) {
    return "starter";
  }

  return subscription.metadata.plan ?? "pro";
}

async function upsertSubscriptionByUserId(input: {
  userId: string;
  customerId: string | null;
  subscriptionId: string | null;
  status: string;
  plan: string;
  currentPeriodEnd: string | null;
}) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase.from("subscriptions").upsert(
    {
      user_id: input.userId,
      stripe_customer_id: input.customerId,
      stripe_subscription_id: input.subscriptionId,
      status: input.status,
      plan: input.plan,
      current_period_end: input.currentPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

async function updateSubscriptionByCustomerId(input: {
  customerId: string;
  subscriptionId: string;
  status: string;
  plan: string;
  currentPeriodEnd: string | null;
}) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  await supabase
    .from("subscriptions")
    .update({
      stripe_subscription_id: input.subscriptionId,
      status: input.status,
      plan: input.plan,
      current_period_end: input.currentPeriodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_customer_id", input.customerId);
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const stripe = getStripeClient();
  if (!stripe) {
    return;
  }

  const userId = session.metadata?.userId;
  if (!userId) {
    return;
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : null;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;

  let status = "active";
  let plan = "pro";
  let currentPeriodEnd: string | null = null;

  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    status = subscription.status;
    plan = resolvePlanFromSubscription(subscription);
    currentPeriodEnd = resolveCurrentPeriodEnd(subscription);
  }

  await upsertSubscriptionByUserId({
    userId,
    customerId,
    subscriptionId,
    status,
    plan,
    currentPeriodEnd,
  });
}

async function handleSubscriptionLifecycle(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : null;
  if (!customerId) {
    return;
  }

  await updateSubscriptionByCustomerId({
    customerId,
    subscriptionId: subscription.id,
    status: subscription.status,
    plan: resolvePlanFromSubscription(subscription),
    currentPeriodEnd: resolveCurrentPeriodEnd(subscription),
  });
}

function extractEventIdentifiers(event: Stripe.Event): {
  customerId: string | null;
  subscriptionId: string | null;
  userId: string | null;
} {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return {
      customerId: typeof session.customer === "string" ? session.customer : null,
      subscriptionId:
        typeof session.subscription === "string" ? session.subscription : null,
      userId: session.metadata?.userId ?? null,
    };
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    return {
      customerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : null,
      subscriptionId: subscription.id,
      userId: subscription.metadata?.userId ?? null,
    };
  }

  return {
    customerId: null,
    subscriptionId: null,
    userId: null,
  };
}

async function findUserIdByCustomerId(customerId: string): Promise<string | null> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  return (data as { user_id?: string } | null)?.user_id ?? null;
}

async function writeWebhookEvent(input: {
  event: Stripe.Event;
  status: EventStatus;
  userId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  errorMessage?: string | null;
}) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  const payloadObject = input.event.data.object as unknown as Record<
    string,
    unknown
  >;
  const payloadObjectType =
    typeof payloadObject.object === "string" ? payloadObject.object : null;

  await supabase.from("webhook_events").upsert(
    {
      stripe_event_id: input.event.id,
      stripe_event_type: input.event.type,
      stripe_customer_id: input.customerId,
      stripe_subscription_id: input.subscriptionId,
      user_id: input.userId,
      livemode: input.event.livemode,
      status: input.status,
      details: {
        objectType: payloadObjectType,
        created: input.event.created,
      },
      error_message: input.errorMessage ?? null,
      processed_at:
        input.status === "processed" || input.status === "error"
          ? new Date().toISOString()
          : null,
    },
    { onConflict: "stripe_event_id" },
  );
}

export async function POST(request: Request) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      {
        error: "stripe_not_configured",
        message: "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
      },
      { status: 500 },
    );
  }

  try {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return NextResponse.json({ error: "missing_signature" }, { status: 400 });
    }

    const payload = await request.text();
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    const identifiers = extractEventIdentifiers(event);
    const userId =
      identifiers.userId ??
      (identifiers.customerId
        ? await findUserIdByCustomerId(identifiers.customerId)
        : null);

    await writeWebhookEvent({
      event,
      status: "received",
      userId,
      customerId: identifiers.customerId,
      subscriptionId: identifiers.subscriptionId,
    });

    try {
      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          await handleSubscriptionLifecycle(event.data.object as Stripe.Subscription);
          break;
        default:
          break;
      }
    } catch (processingError) {
      const processingMessage =
        processingError instanceof Error
          ? processingError.message
          : "processing_failed";

      await writeWebhookEvent({
        event,
        status: "error",
        userId,
        customerId: identifiers.customerId,
        subscriptionId: identifiers.subscriptionId,
        errorMessage: processingMessage,
      });

      return NextResponse.json(
        { error: "processing_failed", message: processingMessage },
        { status: 500 },
      );
    }

    await writeWebhookEvent({
      event,
      status: "processed",
      userId,
      customerId: identifiers.customerId,
      subscriptionId: identifiers.subscriptionId,
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "webhook_error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
