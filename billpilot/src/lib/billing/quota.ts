import { getServiceSupabaseClient } from "@/lib/supabase";

export const FREE_TIER_ANALYSES_PER_MONTH = 2;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

interface PropertyRow {
  id: string;
  user_id: string;
}

interface SubscriptionRow {
  status: string | null;
  plan: string | null;
}

export interface AnalysisQuota {
  enforced: boolean;
  allowed: boolean;
  remaining: number | null;
  limit: number | null;
  usedThisMonth: number | null;
  periodStart: string | null;
  plan: string | null;
  status: string | null;
  reason?: string;
}

function startOfUtcMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function getCurrentQuotaPeriodStart(): string {
  return startOfUtcMonthIso();
}

function isPaidPlan(subscription: SubscriptionRow | null): boolean {
  if (!subscription) {
    return false;
  }

  const status = (subscription.status ?? "").toLowerCase();
  const plan = (subscription.plan ?? "free").toLowerCase();

  return ACTIVE_SUBSCRIPTION_STATUSES.has(status) && plan !== "free";
}

async function findPropertyOwner(propertyId: string): Promise<PropertyRow | null> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("properties")
    .select("id, user_id")
    .eq("id", propertyId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as PropertyRow;
}

async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data } = await supabase
    .from("subscriptions")
    .select("status, plan")
    .eq("user_id", userId)
    .maybeSingle();

  return (data as SubscriptionRow | null) ?? null;
}

async function listPropertyIdsForUser(userId: string): Promise<string[]> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("properties")
    .select("id")
    .eq("user_id", userId);

  if (error || !data) {
    return [];
  }

  return data.map((row: { id: string }) => row.id);
}

async function countAnalysesThisMonth(
  propertyIds: string[],
  periodStartIso: string,
): Promise<number> {
  const supabase = getServiceSupabaseClient();
  if (!supabase || propertyIds.length === 0) {
    return 0;
  }

  const { count } = await supabase
    .from("bills")
    .select("id", { count: "exact", head: true })
    .in("property_id", propertyIds)
    .gte("created_at", periodStartIso);

  return count ?? 0;
}

export async function getAnalysisQuota(
  propertyId: string,
  expectedUserId?: string,
): Promise<AnalysisQuota> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return {
      enforced: false,
      allowed: true,
      remaining: null,
      limit: null,
      usedThisMonth: null,
      periodStart: null,
      plan: null,
      status: null,
      reason: "supabase_not_configured",
    };
  }

  const property = await findPropertyOwner(propertyId);
  if (!property) {
    return {
      enforced: true,
      allowed: false,
      remaining: 0,
      limit: FREE_TIER_ANALYSES_PER_MONTH,
      usedThisMonth: FREE_TIER_ANALYSES_PER_MONTH,
      periodStart: startOfUtcMonthIso(),
      plan: null,
      status: null,
      reason: "property_not_found",
    };
  }

  if (expectedUserId && property.user_id !== expectedUserId) {
    return {
      enforced: true,
      allowed: false,
      remaining: 0,
      limit: FREE_TIER_ANALYSES_PER_MONTH,
      usedThisMonth: FREE_TIER_ANALYSES_PER_MONTH,
      periodStart: startOfUtcMonthIso(),
      plan: null,
      status: null,
      reason: "property_not_owned",
    };
  }

  const subscription = await getSubscription(property.user_id);
  if (isPaidPlan(subscription)) {
    return {
      enforced: true,
      allowed: true,
      remaining: null,
      limit: null,
      usedThisMonth: null,
      periodStart: startOfUtcMonthIso(),
      plan: subscription?.plan ?? "pro",
      status: subscription?.status ?? "active",
    };
  }

  const periodStart = startOfUtcMonthIso();
  const propertyIds = await listPropertyIdsForUser(property.user_id);
  const usedThisMonth = await countAnalysesThisMonth(propertyIds, periodStart);
  const remaining = Math.max(0, FREE_TIER_ANALYSES_PER_MONTH - usedThisMonth);

  return {
    enforced: true,
    allowed: usedThisMonth < FREE_TIER_ANALYSES_PER_MONTH,
    remaining,
    limit: FREE_TIER_ANALYSES_PER_MONTH,
    usedThisMonth,
    periodStart,
    plan: subscription?.plan ?? "free",
    status: subscription?.status ?? "inactive",
  };
}
