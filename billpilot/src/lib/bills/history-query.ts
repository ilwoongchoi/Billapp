import { getServiceSupabaseClient } from "@/lib/supabase";

export class BillHistoryQueryError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface BillHistoryRow {
  id: string;
  propertyId: string;
  propertyName: string;
  provider: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalCost: number | null;
  usageValue: number | null;
  usageUnit: string | null;
  currency: string;
  confidence: number | null;
  createdAt: string;
  insightTotal: number;
  insightHigh: number;
  insightWatch: number;
  sampleInsight: string | null;
}

interface PropertyRow {
  id: string;
  name: string;
}

interface BillRow {
  id: string;
  property_id: string;
  provider: string | null;
  period_start: string | null;
  period_end: string | null;
  total_cost: number | string | null;
  usage_value: number | string | null;
  usage_unit: string | null;
  currency: string | null;
  confidence: number | string | null;
  created_at: string;
}

interface InsightRow {
  bill_id: string;
  severity: string | null;
  message: string | null;
}

interface HistoryFilterInput {
  userId: string;
  propertyId?: string;
  provider?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface BillFilterOps<T> {
  ilike(column: string, pattern: string): T;
  gte(column: string, value: string): T;
  lte(column: string, value: string): T;
}

function toNumberOrNull(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolvePropertyScope(
  input: HistoryFilterInput,
): Promise<{ propertyIds: string[]; propertyMap: Map<string, string> }> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    throw new BillHistoryQueryError(
      500,
      "supabase_not_configured",
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.",
    );
  }

  if (input.propertyId) {
    const { data, error } = await supabase
      .from("properties")
      .select("id, name")
      .eq("user_id", input.userId)
      .eq("id", input.propertyId)
      .maybeSingle();

    if (error) {
      throw new BillHistoryQueryError(
        500,
        "property_lookup_failed",
        error.message,
      );
    }

    if (!data) {
      throw new BillHistoryQueryError(
        403,
        "forbidden_property",
        "This property does not belong to the authenticated user.",
      );
    }

    const row = data as PropertyRow;
    return {
      propertyIds: [row.id],
      propertyMap: new Map([[row.id, row.name]]),
    };
  }

  const { data: propertiesData, error: propertiesError } = await supabase
    .from("properties")
    .select("id, name")
    .eq("user_id", input.userId);

  if (propertiesError || !propertiesData) {
    throw new BillHistoryQueryError(
      500,
      "property_lookup_failed",
      propertiesError?.message ?? "Unable to lookup user properties.",
    );
  }

  const properties = propertiesData as PropertyRow[];
  return {
    propertyIds: properties.map((row) => row.id),
    propertyMap: new Map(properties.map((row) => [row.id, row.name])),
  };
}

function applyCommonBillFilters<T extends BillFilterOps<T>>(
  query: T,
  input: HistoryFilterInput,
): T {
  let next = query;
  if (input.provider && input.provider.trim()) {
    next = next.ilike("provider", `%${input.provider.trim()}%`) as T;
  }
  if (input.dateFrom) {
    next = next.gte("period_end", input.dateFrom) as T;
  }
  if (input.dateTo) {
    next = next.lte("period_end", input.dateTo) as T;
  }
  return next;
}

export async function getBillHistoryForUser(input: {
  userId: string;
  propertyId?: string;
  provider?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset?: number;
}): Promise<BillHistoryRow[]> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    throw new BillHistoryQueryError(
      500,
      "supabase_not_configured",
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.",
    );
  }

  const { propertyIds, propertyMap } = await resolvePropertyScope(input);

  if (propertyIds.length === 0) {
    return [];
  }

  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(1, input.limit);

  let billQuery = supabase
    .from("bills")
    .select(
      "id, property_id, provider, period_start, period_end, total_cost, usage_value, usage_unit, currency, confidence, created_at",
    )
    .in("property_id", propertyIds);

  billQuery = applyCommonBillFilters(billQuery, input);

  const { data: billsData, error: billsError } = await billQuery
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (billsError || !billsData) {
    throw new BillHistoryQueryError(
      500,
      "bills_lookup_failed",
      billsError?.message ?? "Unable to load bills.",
    );
  }

  const bills = billsData as BillRow[];
  const billIds = bills.map((row) => row.id);

  let insightRows: InsightRow[] = [];
  if (billIds.length > 0) {
    const { data: insightsData, error: insightsError } = await supabase
      .from("insights")
      .select("bill_id, severity, message")
      .in("bill_id", billIds);

    if (insightsError) {
      throw new BillHistoryQueryError(
        500,
        "insights_lookup_failed",
        insightsError.message,
      );
    }

    insightRows = (insightsData as InsightRow[] | null) ?? [];
  }

  const insightMap = new Map<
    string,
    { total: number; high: number; watch: number; sampleMessage: string | null }
  >();

  for (const insight of insightRows) {
    const current = insightMap.get(insight.bill_id) ?? {
      total: 0,
      high: 0,
      watch: 0,
      sampleMessage: null,
    };
    current.total += 1;
    if (insight.severity === "high") {
      current.high += 1;
    } else if (insight.severity === "watch") {
      current.watch += 1;
    }
    if (!current.sampleMessage && insight.message) {
      current.sampleMessage = insight.message;
    }
    insightMap.set(insight.bill_id, current);
  }

  return bills.map((bill) => {
    const counters = insightMap.get(bill.id) ?? {
      total: 0,
      high: 0,
      watch: 0,
      sampleMessage: null,
    };

    return {
      id: bill.id,
      propertyId: bill.property_id,
      propertyName: propertyMap.get(bill.property_id) ?? "Unknown property",
      provider: bill.provider,
      periodStart: bill.period_start,
      periodEnd: bill.period_end,
      totalCost: toNumberOrNull(bill.total_cost),
      usageValue: toNumberOrNull(bill.usage_value),
      usageUnit: bill.usage_unit,
      currency: bill.currency ?? "USD",
      confidence: toNumberOrNull(bill.confidence),
      createdAt: bill.created_at,
      insightTotal: counters.total,
      insightHigh: counters.high,
      insightWatch: counters.watch,
      sampleInsight: counters.sampleMessage,
    };
  });
}

export async function getBillHistoryCountForUser(
  input: HistoryFilterInput,
): Promise<number> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    throw new BillHistoryQueryError(
      500,
      "supabase_not_configured",
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.",
    );
  }

  const { propertyIds } = await resolvePropertyScope(input);
  if (propertyIds.length === 0) {
    return 0;
  }

  let query = supabase
    .from("bills")
    .select("id", { count: "exact", head: true })
    .in("property_id", propertyIds);

  query = applyCommonBillFilters(query, input);

  const { count, error } = await query;
  if (error) {
    throw new BillHistoryQueryError(500, "bills_count_failed", error.message);
  }

  return count ?? 0;
}
