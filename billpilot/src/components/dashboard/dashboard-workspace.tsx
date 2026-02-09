"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { getBrowserSupabaseClient } from "@/lib/supabase-browser";

import { BillParserConsole } from "./bill-parser-console";

interface PropertySummary {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  created_at: string;
  analysesThisMonth: number;
}

interface PropertiesApiResponse {
  user: {
    id: string;
    email: string | null;
  };
  subscription: {
    plan: string | null;
    status: string | null;
    current_period_end: string | null;
  };
  quota: {
    enforced: boolean;
    limit: number | null;
    usedThisMonth: number | null;
    remaining: number | null;
    periodStart: string | null;
  };
  properties: PropertySummary[];
}

interface BillHistoryRow {
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

interface BillHistoryPage {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

interface BillHistoryResponse {
  bills: BillHistoryRow[];
  page: BillHistoryPage;
}

interface StripeStatusResponse {
  diagnostics: {
    stripeSecretConfigured: boolean;
    webhookSecretConfigured: boolean;
    starterPriceConfigured: boolean;
    proPriceConfigured: boolean;
    teamPriceConfigured: boolean;
  };
  subscription: {
    plan: string | null;
    status: string | null;
    current_period_end: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    updated_at: string | null;
  };
  events: Array<{
    id: string;
    stripeEventId: string;
    eventType: string;
    status: string;
    createdAt: string;
    processedAt: string | null;
    errorMessage: string | null;
  }>;
}

interface MonthlyReportSetting {
  id: string | null;
  userId: string;
  enabled: boolean;
  format: "csv" | "pdf";
  timezone: string;
  dayOfMonth: number;
  propertyId: string | null;
  providerFilter: string | null;
  lastSentAt: string | null;
  updatedAt: string | null;
}

interface MonthlyReportLog {
  id: string;
  sent_at: string;
  status: string;
  format: string;
  month_key: string | null;
  row_count: number;
  property_id: string | null;
  provider_filter: string | null;
  error_message: string | null;
}

interface MonthlyReportStatusResponse {
  setting: MonthlyReportSetting;
  properties: Array<{ id: string; name: string }>;
  logs: MonthlyReportLog[];
}

interface HealthStatusResponse {
  status: "ok" | "degraded";
  timestamp: string;
  core: {
    ok: boolean;
    configured: number;
    total: number;
    missing: string[];
  };
  features: {
    billing: {
      enabled: boolean;
      ok: boolean;
      configured: number;
      total: number;
      missing: string[];
    };
    reports: {
      enabled: boolean;
      ok: boolean;
      configured: number;
      total: number;
      missing: string[];
    };
    reception: {
      enabled: boolean;
      ok: boolean;
      configured: number;
      total: number;
      missing: string[];
    };
  };
  runtime: {
    supabase: {
      configured: boolean;
      ok: boolean;
      error: string | null;
      tables: {
        total: number;
        okCount: number;
        failed: Array<{
          table: string;
          ok: boolean;
          error: string | null;
        }>;
      };
    };
  };
  deployment: {
    deployable: boolean;
    blockingIssues: string[];
    warnings: string[];
  };
}

interface AnalyticsSummaryResponse {
  filters: {
    propertyId?: string;
    provider?: string;
    dateFrom?: string;
    dateTo?: string;
    limit: number;
  };
  summary: {
    billCount: number;
    avgCost: number | null;
    avgUsage: number | null;
    avgConfidence: number | null;
    latestCost: number | null;
    previousCost: number | null;
    costChangePercent: number | null;
    insightTotal: number;
    insightHigh: number;
    insightWatch: number;
    parseQuality: "high" | "medium" | "low" | "unknown";
  };
  series: Array<{
    date: string;
    cost: number | null;
    confidence: number | null;
    high: number;
    watch: number;
  }>;
  forecast: {
    method: "linear_regression" | "insufficient_data";
    sampleSize: number;
    nextCost: number | null;
    lowerBound: number | null;
    upperBound: number | null;
    monthlySlope: number | null;
    rmse: number | null;
    confidence: "high" | "medium" | "low" | "none";
  };
}

function readApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const message =
    "message" in payload && typeof payload.message === "string"
      ? payload.message
      : null;
  const error =
    "error" in payload && typeof payload.error === "string"
      ? payload.error
      : null;

  return message ?? error ?? fallback;
}

function formatPlan(plan: string | null): string {
  return plan ?? "free";
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function asCurrency(value: number | null, currency = "USD"): string {
  if (value === null) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function DashboardWorkspace() {
  const searchParams = useSearchParams();

  const [emailInput, setEmailInput] = useState("");
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSending, setAuthSending] = useState(false);

  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [propertyTimezone, setPropertyTimezone] = useState("UTC");
  const [propertiesLoading, setPropertiesLoading] = useState(false);

  const [subscription, setSubscription] = useState<PropertiesApiResponse["subscription"] | null>(
    null,
  );
  const [quota, setQuota] = useState<PropertiesApiResponse["quota"] | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [stripeStatus, setStripeStatus] = useState<StripeStatusResponse | null>(null);
  const [stripeStatusLoading, setStripeStatusLoading] = useState(false);
  const [reportStatus, setReportStatus] = useState<MonthlyReportStatusResponse | null>(
    null,
  );
  const [reportStatusLoading, setReportStatusLoading] = useState(false);
  const [reportSaving, setReportSaving] = useState(false);
  const [reportSending, setReportSending] = useState(false);
  const [reportEnabled, setReportEnabled] = useState(false);
  const [reportFormat, setReportFormat] = useState<"csv" | "pdf">("pdf");
  const [reportDayOfMonth, setReportDayOfMonth] = useState("1");
  const [reportTimezone, setReportTimezone] = useState("UTC");
  const [reportPropertyId, setReportPropertyId] = useState("");
  const [reportProviderFilter, setReportProviderFilter] = useState("");
  const [reportMonth, setReportMonth] = useState("");
  const [historyRows, setHistoryRows] = useState<BillHistoryRow[]>([]);
  const [historyPage, setHistoryPage] = useState<BillHistoryPage>({
    limit: 25,
    offset: 0,
    total: 0,
    hasMore: false,
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [seedDemoLoading, setSeedDemoLoading] = useState(false);
  const [workspaceRefreshLoading, setWorkspaceRefreshLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<HealthStatusResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummaryResponse | null>(
    null,
  );
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const adminEmail = "iwchoikr@gmail.com";
  const isAdminRoute =
    typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
  const isAdminUser =
    Boolean(userEmail) && userEmail?.toLowerCase() === adminEmail.toLowerCase();
  const showAdminPanels = isAdminRoute && isAdminUser;

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success") {
      setCheckoutNotice(
        "Payment completed. It may take a few seconds for your plan to update. Refresh the page if needed.",
      );
    } else if (checkout === "cancel") {
      setCheckoutNotice("Checkout was canceled. Your plan has not changed.");
    } else {
      setCheckoutNotice(null);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    try {
      const supabase = getBrowserSupabaseClient();

      const applySession = async () => {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) {
          return;
        }
        if (error) {
          setAuthError(error.message);
          setAuthLoading(false);
          return;
        }

        setAuthToken(data.session?.access_token ?? null);
        setUserEmail(data.session?.user.email ?? null);
        setAuthLoading(false);
      };

      void applySession();

      const {
        data: { subscription: authSubscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) {
          return;
        }
        setAuthToken(session?.access_token ?? null);
        setUserEmail(session?.user.email ?? null);
      });

      return () => {
        cancelled = true;
        authSubscription.unsubscribe();
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Supabase client failed to initialize.";
      setAuthError(message);
      setAuthLoading(false);
      return () => {
        cancelled = true;
      };
    }
  }, []);

  const loadProperties = useCallback(async () => {
    if (!authToken) {
      setProperties([]);
      setSelectedPropertyId("");
      setSubscription(null);
      setQuota(null);
      return;
    }

    setPropertiesLoading(true);

    try {
      const response = await fetch("/api/properties", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      const payload = (await response.json()) as
        | PropertiesApiResponse
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to load properties."));
      }

      const data = payload as PropertiesApiResponse;
      setProperties(data.properties);
      setSubscription(data.subscription);
      setQuota(data.quota);
      setSelectedPropertyId((current) => {
        if (current && data.properties.some((row) => row.id === current)) {
          return current;
        }
        return data.properties[0]?.id ?? "";
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load properties.";
      setStatusMessage(message);
    } finally {
      setPropertiesLoading(false);
    }
  }, [authToken]);

  const loadStripeStatus = useCallback(async () => {
    if (!authToken) {
      setStripeStatus(null);
      return;
    }

    setStripeStatusLoading(true);
    try {
      const response = await fetch("/api/stripe/status", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      const payload = (await response.json()) as
        | StripeStatusResponse
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to load Stripe diagnostics."));
      }

      setStripeStatus(payload as StripeStatusResponse);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load Stripe diagnostics.";
      setStatusMessage(message);
    } finally {
      setStripeStatusLoading(false);
    }
  }, [authToken]);

  const loadReportStatus = useCallback(async () => {
    if (!authToken) {
      setReportStatus(null);
      return;
    }

    setReportStatusLoading(true);
    try {
      const response = await fetch("/api/reports/monthly/status", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      const payload = (await response.json()) as
        | MonthlyReportStatusResponse
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to load report settings."));
      }

      const data = payload as MonthlyReportStatusResponse;
      setReportStatus(data);
      setReportEnabled(data.setting.enabled);
      setReportFormat(data.setting.format);
      setReportDayOfMonth(String(data.setting.dayOfMonth));
      setReportTimezone(data.setting.timezone);
      setReportPropertyId(data.setting.propertyId ?? "");
      setReportProviderFilter(data.setting.providerFilter ?? "");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load report settings.";
      setStatusMessage(message);
    } finally {
      setReportStatusLoading(false);
    }
  }, [authToken]);

  const loadHealthStatus = useCallback(async () => {
    setHealthLoading(true);
    try {
      const response = await fetch("/api/health");
      const payload = (await response.json()) as
        | HealthStatusResponse
        | { error?: string; message?: string };

      if (!response.ok && !("status" in payload)) {
        throw new Error(readApiError(payload, "Failed to load health status."));
      }

      setHealthStatus(payload as HealthStatusResponse);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load health status.";
      setStatusMessage(message);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const loadAnalyticsSummary = useCallback(async () => {
    if (!authToken) {
      setAnalyticsSummary(null);
      return;
    }

    setAnalyticsLoading(true);
    try {
      const query = new URLSearchParams({ limit: "120" });
      if (selectedPropertyId) {
        query.set("propertyId", selectedPropertyId);
      }

      const response = await fetch(`/api/analytics/summary?${query.toString()}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      const payload = (await response.json()) as
        | AnalyticsSummaryResponse
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to load analytics summary."));
      }

      setAnalyticsSummary(payload as AnalyticsSummaryResponse);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load analytics summary.";
      setStatusMessage(message);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [authToken, selectedPropertyId]);

  const loadBillHistory = useCallback(async () => {
    if (!authToken || !selectedPropertyId) {
      setHistoryRows([]);
      setHistoryPage((current) => ({
        ...current,
        total: 0,
        hasMore: false,
      }));
      return;
    }

    setHistoryLoading(true);
    try {
      const response = await fetch(
        `/api/bills/history?propertyId=${encodeURIComponent(selectedPropertyId)}&limit=${historyPage.limit}&offset=${historyPage.offset}`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );
      const payload = (await response.json()) as
        | BillHistoryResponse
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to load bill history."));
      }

      const parsed = payload as BillHistoryResponse;
      setHistoryRows(parsed.bills);
      setHistoryPage(parsed.page);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load bill history.";
      setStatusMessage(message);
    } finally {
      setHistoryLoading(false);
    }
  }, [authToken, historyPage.limit, historyPage.offset, selectedPropertyId]);

  useEffect(() => {
    void loadProperties();
  }, [loadProperties]);

  useEffect(() => {
    void loadStripeStatus();
  }, [loadStripeStatus]);

  useEffect(() => {
    void loadReportStatus();
  }, [loadReportStatus]);

  useEffect(() => {
    void loadHealthStatus();
  }, [loadHealthStatus]);

  useEffect(() => {
    setHistoryPage((current) => ({ ...current, offset: 0 }));
  }, [selectedPropertyId]);

  useEffect(() => {
    void loadAnalyticsSummary();
  }, [loadAnalyticsSummary]);

  useEffect(() => {
    void loadBillHistory();
  }, [loadBillHistory]);

  const refreshWorkspace = async () => {
    setWorkspaceRefreshLoading(true);
    setStatusMessage(null);
    try {
      await Promise.allSettled([
        loadHealthStatus(),
        loadProperties(),
        loadStripeStatus(),
        loadReportStatus(),
        loadAnalyticsSummary(),
        loadBillHistory(),
      ]);
      setStatusMessage("Workspace refreshed.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to refresh workspace.";
      setStatusMessage(message);
    } finally {
      setWorkspaceRefreshLoading(false);
    }
  };

  const handleSendMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage(null);

    const email = emailInput.trim();
    if (!email) {
      setStatusMessage("Enter an email address first.");
      return;
    }

    setAuthSending(true);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/dashboard`
              : undefined,
        },
      });
      if (error) {
        throw error;
      }
      setStatusMessage("Magic link sent. Check your email to sign in.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send sign-in email.";
      setStatusMessage(message);
    } finally {
      setAuthSending(false);
    }
  };

  const handleSignOut = async () => {
    setStatusMessage(null);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
      setStatusMessage("Signed out.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sign out.";
      setStatusMessage(message);
    }
  };

  const handleCreateProperty = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    setStatusMessage(null);
    setPropertiesLoading(true);
    try {
      const response = await fetch("/api/properties", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          name: propertyName.trim(),
          address: propertyAddress.trim() || undefined,
          timezone: propertyTimezone.trim() || "UTC",
        }),
      });
      const payload = (await response.json()) as
        | { property: PropertySummary }
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to create property."));
      }

      const created = (payload as { property: PropertySummary }).property;
      setProperties((current) => [...current, { ...created, analysesThisMonth: 0 }]);
      setSelectedPropertyId(created.id);
      setPropertyName("");
      setPropertyAddress("");
      setStatusMessage("Property created.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create property.";
      setStatusMessage(message);
    } finally {
      setPropertiesLoading(false);
    }
  };

  const startCheckout = async (plan: "starter" | "pro" | "team") => {
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    setBillingLoading(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ plan }),
      });

      const payload = (await response.json()) as {
        url?: string | null;
        error?: string;
        message?: string;
      };
      if (!response.ok || !payload.url) {
        throw new Error(readApiError(payload, "Checkout creation failed."));
      }

      window.location.href = payload.url;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Checkout creation failed.";
      setStatusMessage(message);
    } finally {
      setBillingLoading(false);
    }
  };

  const openBillingPortal = async () => {
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    setBillingLoading(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      const payload = (await response.json()) as {
        url?: string | null;
        error?: string;
        message?: string;
      };
      if (!response.ok || !payload.url) {
        throw new Error(readApiError(payload, "Unable to open billing portal."));
      }
      window.location.href = payload.url;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to open billing portal.";
      setStatusMessage(message);
    } finally {
      setBillingLoading(false);
    }
  };

  const saveReportSettings = async () => {
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    setReportSaving(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/reports/monthly/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          enabled: reportEnabled,
          format: reportFormat,
          timezone: reportTimezone.trim() || "UTC",
          dayOfMonth: Math.min(28, Math.max(1, Number(reportDayOfMonth) || 1)),
          propertyId: reportPropertyId || null,
          providerFilter: reportProviderFilter.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        setting?: MonthlyReportSetting;
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to save report settings."));
      }

      setStatusMessage("Monthly report settings saved.");
      await loadReportStatus();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save report settings.";
      setStatusMessage(message);
    } finally {
      setReportSaving(false);
    }
  };

  const sendMonthlyReportNow = async () => {
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    setReportSending(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/reports/monthly/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          month: reportMonth.trim() || undefined,
          format: reportFormat,
          propertyId: reportPropertyId || null,
          providerFilter: reportProviderFilter.trim() || null,
        }),
      });

      const payload = (await response.json()) as {
        sent?: boolean;
        month?: string;
        rows?: number;
        error?: string;
        message?: string;
      };

      if (!response.ok || !payload.sent) {
        throw new Error(readApiError(payload, "Failed to send monthly report."));
      }

      setStatusMessage(
        `Monthly report sent (${payload.month}) with ${payload.rows ?? 0} rows.`,
      );
      await loadReportStatus();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send monthly report.";
      setStatusMessage(message);
    } finally {
      setReportSending(false);
    }
  };

  const seedDemoBills = async (replaceExisting: boolean) => {
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }
    if (!selectedPropertyId) {
      setStatusMessage("Create/select a property first.");
      return;
    }

    setSeedDemoLoading(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/bills/demo-seed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          propertyId: selectedPropertyId,
          months: 6,
          replaceExisting,
        }),
      });

      const payload = (await response.json()) as {
        insertedBills?: number;
        insertedInsights?: number;
        insertedLineItems?: number;
        existingCount?: number;
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to seed demo bill data."));
      }

      setStatusMessage(
        `Demo seed complete: bills=${payload.insertedBills ?? 0}, lineItems=${payload.insertedLineItems ?? 0}, insights=${payload.insertedInsights ?? 0}.`,
      );
      setHistoryPage((current) => ({
        ...current,
        offset: 0,
      }));
      await loadProperties();
      await loadBillHistory();
      await loadAnalyticsSummary();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to seed demo bill data.";
      setStatusMessage(message);
    } finally {
      setSeedDemoLoading(false);
    }
  };

  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === selectedPropertyId) ?? null,
    [properties, selectedPropertyId],
  );
  const hasActiveProperty = Boolean(selectedPropertyId);
  const hasBillHistory = historyPage.total > 0;
  const reportsConfigured =
    Boolean(reportStatus?.setting.id) ||
    reportStatus?.setting.enabled === true ||
    (reportStatus?.logs.length ?? 0) > 0;
  const deployableNow = healthStatus?.deployment.deployable ?? false;
  const launchChecklist = [
    {
      id: "auth",
      label: "Sign in",
      done: Boolean(authToken),
      hint: authToken
        ? `Signed in as ${userEmail ?? "unknown"}`
        : "Use magic-link sign-in above.",
    },
    {
      id: "property",
      label: "Create/select property",
      done: hasActiveProperty,
      hint: hasActiveProperty
        ? `Active: ${selectedProperty?.name ?? selectedPropertyId}`
        : "Create at least one property to persist analyses.",
    },
    {
      id: "bills",
      label: "Add bill data",
      done: hasBillHistory,
      hint: hasBillHistory
        ? `${historyPage.total} persisted bill(s)`
        : "Upload/parse a bill or use Seed demo data.",
    },
    {
      id: "reports",
      label: "Configure monthly reports",
      done: reportsConfigured,
      hint: reportsConfigured
        ? "Monthly report settings/logs detected."
        : "Save monthly report settings below.",
    },
    {
      id: "deploy",
      label: "Deployment readiness",
      done: deployableNow,
      hint: deployableNow
        ? "Core runtime checks are passing."
        : "Fix blockers in System health.",
    },
  ] as const;
  const subscriptionView = stripeStatus?.subscription ?? subscription;
  const analyticsForecast = analyticsSummary?.forecast ?? null;
  const displayCurrency = historyRows[0]?.currency ?? "USD";
  const forecastRangeLabel =
    analyticsForecast &&
    analyticsForecast.lowerBound !== null &&
    analyticsForecast.upperBound !== null
      ? `${asCurrency(analyticsForecast.lowerBound, displayCurrency)} - ${asCurrency(
          analyticsForecast.upperBound,
          displayCurrency,
        )}`
      : "-";
  const forecastTrendLabel =
    analyticsForecast?.monthlySlope !== null &&
    analyticsForecast?.monthlySlope !== undefined
      ? `${analyticsForecast.monthlySlope >= 0 ? "+" : ""}${asCurrency(
          analyticsForecast.monthlySlope,
          displayCurrency,
        )}`
      : "-";
  const historyPageStart = historyPage.total === 0 ? 0 : historyPage.offset + 1;
  const historyPageEnd =
    historyPage.total === 0
      ? 0
      : Math.min(historyPage.offset + historyRows.length, historyPage.total);

  if (isAdminRoute && !authLoading && authToken && !isAdminUser) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
        <div className="font-semibold">Admin access denied</div>
        <div className="mt-1">
          Sign in with <span className="font-mono">{adminEmail}</span> to access the
          admin console.
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {checkoutNotice && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {checkoutNotice}
        </section>
      )}

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Authentication</h2>
        <p className="text-sm text-zinc-600">
          Sign in with Supabase magic link to unlock property storage and billing.
        </p>

        {authLoading ? (
          <p className="mt-3 text-sm text-zinc-600">Checking session...</p>
        ) : authToken ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm">
              Signed in as {userEmail ?? "unknown"}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
            >
              Sign out
            </button>
          </div>
        ) : (
          <form onSubmit={handleSendMagicLink} className="mt-3 flex flex-wrap gap-2">
            <input
              type="email"
              required
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="you@example.com"
              className="min-w-[240px] flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={authSending}
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              {authSending ? "Sending..." : "Send magic link"}
            </button>
          </form>
        )}

        {authError && (
          <p className="mt-3 text-sm text-red-700">Auth error: {authError}</p>
        )}

        {statusMessage && (
          <p className="mt-3 text-sm text-blue-700">{statusMessage}</p>
        )}
      </section>

      {!showAdminPanels ? (
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Quick start</h2>
          <p className="text-sm text-zinc-600">
            Follow the steps below to upload your first bill and see results.
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-700">
            <li>Sign in with your email using the magic link above.</li>
            <li>Create or select a property.</li>
            <li>Upload a bill or paste bill text to analyze.</li>
          </ol>
        </section>
      ) : (
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Workspaces</h2>
          <p className="text-sm text-zinc-600">
            Jump between utility billing and AI receptionist operations.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/dashboard"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold"
            >
              Billing workspace
            </Link>
            <Link
              href="/dashboard/reception"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold"
            >
              Reception workspace
            </Link>
            <Link
              href="/dashboard/dispatch"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold"
            >
              Dispatch optimizer
            </Link>
            <Link
              href="/api/health"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold"
            >
              Open health JSON
            </Link>
          </div>
        </section>
      )}

      {showAdminPanels ? (
      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Launch checklist</h2>
            <p className="text-sm text-zinc-600">
              Minimal flow: sign in, then add a property, then upload bill data, then configure reports.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshWorkspace()}
            disabled={workspaceRefreshLoading}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {workspaceRefreshLoading ? "Refreshing..." : "Refresh checklist"}
          </button>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {launchChecklist.map((step) => (
            <div key={step.id} className="rounded-lg border border-zinc-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{step.label}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    step.done
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-900"
                  }`}
                >
                  {step.done ? "done" : "pending"}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-600">{step.hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void seedDemoBills(false)}
            disabled={seedDemoLoading || !authToken || !selectedPropertyId}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {seedDemoLoading ? "Seeding..." : "Seed demo bills"}
          </button>
          <Link
            href="#monthly-report-automation"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold"
          >
            Open monthly report setup
          </Link>
          <Link
            href="/api/health"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold"
          >
            Review deployment blockers
          </Link>
        </div>
      </section>
      ) : null}

      {showAdminPanels ? (
      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">System health</h2>
        <p className="text-sm text-zinc-600">
          Minimal deployment readiness for env + runtime connectivity.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-zinc-100 px-3 py-1">
            Overall: {healthStatus?.status ?? "unknown"}
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1">
            Deploy now: {healthStatus?.deployment.deployable ? "yes" : "no"}
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1">
            Core env: {healthStatus?.core.ok ? "ok" : "missing"}
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1">
            Supabase runtime:{" "}
            {healthStatus?.runtime.supabase.configured
              ? healthStatus.runtime.supabase.ok
                ? "ok"
                : "error"
              : "not configured"}
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1">
            DB tables:{" "}
            {healthStatus?.runtime.supabase.configured
              ? `${healthStatus.runtime.supabase.tables.okCount}/${healthStatus.runtime.supabase.tables.total}`
              : "0/0"}
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1">
            Billing env:{" "}
            {healthStatus?.features.billing.enabled
              ? healthStatus.features.billing.ok
                ? "ok"
                : "partial"
              : "optional"}
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1">
            Reports env:{" "}
            {healthStatus?.features.reports.enabled
              ? healthStatus.features.reports.ok
                ? "ok"
                : "partial"
              : "optional"}
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1">
            Reception env:{" "}
            {healthStatus?.features.reception.enabled
              ? healthStatus.features.reception.ok
                ? "ok"
                : "partial"
              : "optional"}
          </span>
        </div>

        {healthStatus?.runtime.supabase.error && (
          <p className="mt-3 text-sm text-red-700">
            Supabase runtime error: {healthStatus.runtime.supabase.error}
          </p>
        )}

        {healthStatus &&
          healthStatus.runtime.supabase.tables.failed.length > 0 && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <p className="font-semibold">Failed runtime tables</p>
              <ul className="mt-1 list-inside list-disc space-y-1">
                {healthStatus.runtime.supabase.tables.failed.map((failed) => (
                  <li key={failed.table}>
                    {failed.table}: {failed.error ?? "unknown_error"}
                  </li>
                ))}
              </ul>
            </div>
          )}

        {healthStatus?.deployment.blockingIssues.length ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="font-semibold">Deployment blockers</p>
            <ul className="mt-1 list-inside list-disc space-y-1">
              {healthStatus.deployment.blockingIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {healthStatus?.deployment.warnings.length ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">Deployment warnings</p>
            <ul className="mt-1 list-inside list-disc space-y-1">
              {healthStatus.deployment.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {healthStatus && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {healthStatus.core.missing.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">Missing core keys</p>
                <ul className="mt-1 list-inside list-disc space-y-1">
                  {healthStatus.core.missing.map((key) => (
                    <li key={key} className="font-mono">
                      {key}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {healthStatus.features.billing.enabled &&
              healthStatus.features.billing.missing.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">Missing billing keys</p>
                  <ul className="mt-1 list-inside list-disc space-y-1">
                    {healthStatus.features.billing.missing.map((key) => (
                      <li key={key} className="font-mono">
                        {key}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {healthStatus.features.reports.enabled &&
              healthStatus.features.reports.missing.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">Missing reports keys</p>
                  <ul className="mt-1 list-inside list-disc space-y-1">
                    {healthStatus.features.reports.missing.map((key) => (
                      <li key={key} className="font-mono">
                        {key}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {healthStatus.features.reception.enabled &&
              healthStatus.features.reception.missing.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">Missing reception keys</p>
                  <ul className="mt-1 list-inside list-disc space-y-1">
                    {healthStatus.features.reception.missing.map((key) => (
                      <li key={key} className="font-mono">
                        {key}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={healthLoading}
            onClick={() => void loadHealthStatus()}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {healthLoading ? "Refreshing..." : "Refresh health"}
          </button>
          <Link
            href="/api/health"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold"
          >
            Open health JSON
          </Link>
        </div>
      </section>
      ) : null}

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Billing</h2>
        <p className="text-sm text-zinc-600">
          Free tier: 2 analyses/month. Upgrade for unlimited analyses.
        </p>
        {showAdminPanels ? (
          <p className="mt-2 text-xs text-zinc-600">
            Route + Margin Optimizer add-on: $149-$599/mo depending on dispatch volume.
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-zinc-100 px-3 py-1">
            Plan: {formatPlan(subscriptionView?.plan ?? null)}
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1">
            Status: {subscriptionView?.status ?? "inactive"}
          </span>
          {quota?.limit !== null && (
            <span className="rounded-full bg-zinc-100 px-3 py-1">
              Usage: {quota?.usedThisMonth ?? 0}/{quota?.limit}
            </span>
          )}
          {subscriptionView?.current_period_end && (
            <span className="rounded-full bg-zinc-100 px-3 py-1">
              Renews: {formatDate(subscriptionView.current_period_end)}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={billingLoading}
            onClick={() => startCheckout("starter")}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Upgrade (£9/mo)
          </button>
          <button
            type="button"
            disabled={billingLoading}
            onClick={openBillingPortal}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Manage billing
          </button>
          {showAdminPanels ? (
            <button
              type="button"
              disabled={stripeStatusLoading}
              onClick={() => void loadStripeStatus()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {stripeStatusLoading ? "Refreshing..." : "Refresh diagnostics"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Performance snapshot</h2>
            <p className="text-sm text-zinc-600">
              Lightweight summary for the active property selection.
            </p>
          </div>
          <button
            type="button"
            disabled={analyticsLoading}
            onClick={() => void loadAnalyticsSummary()}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {analyticsLoading ? "Refreshing..." : "Refresh snapshot"}
          </button>
        </div>

        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 p-3">
            Bills: {analyticsSummary?.summary.billCount ?? 0}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            Avg cost:{" "}
            {asCurrency(
              analyticsSummary?.summary.avgCost ?? null,
              displayCurrency,
            )}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            Latest cost:{" "}
            {asCurrency(
              analyticsSummary?.summary.latestCost ?? null,
              displayCurrency,
            )}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            Cost change:{" "}
            {analyticsSummary?.summary.costChangePercent !== null &&
            analyticsSummary?.summary.costChangePercent !== undefined
              ? `${analyticsSummary.summary.costChangePercent}%`
              : "-"}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            Avg confidence:{" "}
            {analyticsSummary?.summary.avgConfidence !== null &&
            analyticsSummary?.summary.avgConfidence !== undefined
              ? `${(analyticsSummary.summary.avgConfidence * 100).toFixed(1)}%`
              : "-"}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            Parse quality: {analyticsSummary?.summary.parseQuality ?? "unknown"}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            Next bill forecast:{" "}
            {asCurrency(analyticsForecast?.nextCost ?? null, displayCurrency)}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            Forecast range: {forecastRangeLabel}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            Trend (cost/bill): {forecastTrendLabel}
          </div>
        </div>

        <p className="mt-3 text-xs text-zinc-600">
          Insights total/high/watch: {analyticsSummary?.summary.insightTotal ?? 0}/
          {analyticsSummary?.summary.insightHigh ?? 0}/
          {analyticsSummary?.summary.insightWatch ?? 0}
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          Forecast confidence: {analyticsForecast?.confidence ?? "none"} | sample=
          {analyticsForecast?.sampleSize ?? 0} bills | method=
          {analyticsForecast?.method ?? "insufficient_data"} | rmse=
          {analyticsForecast?.rmse ?? "-"}
        </p>
      </section>

      <section
        id="monthly-report-automation"
        className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm"
      >
        <h2 className="text-xl font-semibold">Monthly report automation</h2>
        <p className="text-sm text-zinc-600">
          Configure a monthly CSV/PDF email report and send one on demand.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-6">
          <label className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={reportEnabled}
              onChange={(event) => setReportEnabled(event.target.checked)}
            />
            <span>Enable monthly auto-send</span>
          </label>
          <label className="space-y-1 text-sm md:col-span-1">
            <span className="font-medium">Format</span>
            <select
              value={reportFormat}
              onChange={(event) => setReportFormat(event.target.value as "csv" | "pdf")}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            >
              <option value="pdf">PDF</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label className="space-y-1 text-sm md:col-span-1">
            <span className="font-medium">Day (UTC)</span>
            <input
              type="number"
              min={1}
              max={28}
              value={reportDayOfMonth}
              onChange={(event) => setReportDayOfMonth(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium">Timezone label</span>
            <input
              value={reportTimezone}
              onChange={(event) => setReportTimezone(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Property scope</span>
            <select
              value={reportPropertyId}
              onChange={(event) => setReportPropertyId(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            >
              <option value="">All properties</option>
              {reportStatus?.properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Provider filter</span>
            <input
              value={reportProviderFilter}
              onChange={(event) => setReportProviderFilter(event.target.value)}
              placeholder="Optional provider substring"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Send month (YYYY-MM)</span>
            <input
              value={reportMonth}
              onChange={(event) => setReportMonth(event.target.value)}
              placeholder="Blank = previous month"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={reportSaving}
            onClick={() => void saveReportSettings()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {reportSaving ? "Saving..." : "Save report settings"}
          </button>
          <button
            type="button"
            disabled={reportSending}
            onClick={() => void sendMonthlyReportNow()}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {reportSending ? "Sending..." : "Send monthly report now"}
          </button>
          <button
            type="button"
            disabled={reportStatusLoading}
            onClick={() => void loadReportStatus()}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {reportStatusLoading ? "Refreshing..." : "Refresh report status"}
          </button>
        </div>

        <p className="mt-3 text-xs text-zinc-600">
          Last sent: {formatDate(reportStatus?.setting.lastSentAt)} | Cron route:
          <span className="font-mono"> POST /api/reports/monthly/run</span> with{" "}
          <span className="font-mono">x-cron-secret</span>.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left">
                <th className="px-2 py-2 font-semibold">Sent at</th>
                <th className="px-2 py-2 font-semibold">Month</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Format</th>
                <th className="px-2 py-2 font-semibold">Rows</th>
                <th className="px-2 py-2 font-semibold">Error</th>
              </tr>
            </thead>
            <tbody>
              {(reportStatus?.logs ?? []).length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-zinc-500" colSpan={6}>
                    No monthly report logs yet.
                  </td>
                </tr>
              ) : (
                reportStatus?.logs.map((log) => (
                  <tr key={log.id} className="border-b border-zinc-100">
                    <td className="px-2 py-2">{formatDate(log.sent_at)}</td>
                    <td className="px-2 py-2">{log.month_key ?? "-"}</td>
                    <td className="px-2 py-2">{log.status}</td>
                    <td className="px-2 py-2">{log.format}</td>
                    <td className="px-2 py-2">{log.row_count}</td>
                    <td className="px-2 py-2 text-red-600">{log.error_message ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showAdminPanels ? (
      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Webhook diagnostics</h2>
        <p className="text-sm text-zinc-600">
          Check Stripe configuration and the latest webhook processing events.
        </p>

        <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
          <div className="rounded-lg border border-zinc-200 p-2">
            STRIPE_SECRET_KEY:{" "}
            {stripeStatus?.diagnostics.stripeSecretConfigured ? "ok" : "missing"}
          </div>
          <div className="rounded-lg border border-zinc-200 p-2">
            STRIPE_WEBHOOK_SECRET:{" "}
            {stripeStatus?.diagnostics.webhookSecretConfigured ? "ok" : "missing"}
          </div>
          <div className="rounded-lg border border-zinc-200 p-2">
            PRO price: {stripeStatus?.diagnostics.proPriceConfigured ? "ok" : "missing"}
          </div>
          <div className="rounded-lg border border-zinc-200 p-2">
            TEAM price: {stripeStatus?.diagnostics.teamPriceConfigured ? "ok" : "missing"}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left">
                <th className="px-2 py-2 font-semibold">Event type</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Created</th>
                <th className="px-2 py-2 font-semibold">Processed</th>
                <th className="px-2 py-2 font-semibold">Error</th>
              </tr>
            </thead>
            <tbody>
              {(stripeStatus?.events ?? []).length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-zinc-500" colSpan={5}>
                    No webhook events recorded yet.
                  </td>
                </tr>
              ) : (
                stripeStatus?.events.map((event) => (
                  <tr key={event.id} className="border-b border-zinc-100">
                    <td className="px-2 py-2 font-mono">{event.eventType}</td>
                    <td className="px-2 py-2">{event.status}</td>
                    <td className="px-2 py-2">{formatDate(event.createdAt)}</td>
                    <td className="px-2 py-2">{formatDate(event.processedAt)}</td>
                    <td className="px-2 py-2 text-red-600">
                      {event.errorMessage ?? "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Properties</h2>
        <p className="text-sm text-zinc-600">
          Select a property for persisted analyses and monthly quota tracking.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Active property</span>
            <select
              value={selectedPropertyId}
              onChange={(event) => setSelectedPropertyId(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              disabled={propertiesLoading || properties.length === 0}
            >
              {properties.length === 0 ? (
                <option value="">No properties yet</option>
              ) : (
                properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name} ({property.analysesThisMonth} this month)
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="rounded-lg border border-zinc-200 p-3 text-xs text-zinc-600">
            <p className="font-semibold text-zinc-800">Selected property details</p>
            {selectedProperty ? (
              <>
                <ul className="mt-1 space-y-1">
                  <li>ID: {selectedProperty.id}</li>
                  <li>Address: {selectedProperty.address ?? "-"}</li>
                  <li>Timezone: {selectedProperty.timezone}</li>
                </ul>
                <Link
                  href={`/dashboard/property/${selectedProperty.id}`}
                  className="mt-2 inline-block text-blue-600 underline"
                >
                  Open property analytics
                </Link>
              </>
            ) : (
              <p className="mt-1">No active property selected.</p>
            )}
          </div>
        </div>

        <form onSubmit={handleCreateProperty} className="mt-4 grid gap-3 md:grid-cols-4">
          <input
            value={propertyName}
            onChange={(event) => setPropertyName(event.target.value)}
            required
            placeholder="Property name"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
          <input
            value={propertyAddress}
            onChange={(event) => setPropertyAddress(event.target.value)}
            placeholder="Address (optional)"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
          <input
            value={propertyTimezone}
            onChange={(event) => setPropertyTimezone(event.target.value)}
            placeholder="Timezone"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={propertiesLoading}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {propertiesLoading ? "Saving..." : "Create property"}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Bill history</h2>
            <p className="text-sm text-zinc-600">
              Recent persisted analyses for the active property.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs">
              {historyPageStart}-{historyPageEnd} / {historyPage.total}
            </span>
            <button
              type="button"
              disabled={seedDemoLoading || !selectedPropertyId}
              onClick={() => void seedDemoBills(false)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {seedDemoLoading ? "Seeding..." : "Seed demo data"}
            </button>
            <button
              type="button"
              disabled={seedDemoLoading || !selectedPropertyId}
              onClick={() => void seedDemoBills(true)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {seedDemoLoading ? "Seeding..." : "Replace with demo"}
            </button>
            <button
              type="button"
              disabled={historyLoading || historyPage.offset === 0 || !selectedPropertyId}
              onClick={() =>
                setHistoryPage((current) => ({
                  ...current,
                  offset: Math.max(0, current.offset - current.limit),
                }))
              }
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={
                historyLoading ||
                !historyPage.hasMore ||
                historyRows.length === 0 ||
                !selectedPropertyId
              }
              onClick={() =>
                setHistoryPage((current) => ({
                  ...current,
                  offset: current.offset + current.limit,
                }))
              }
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Next
            </button>
            <button
              type="button"
              disabled={historyLoading || !selectedPropertyId}
              onClick={() => void loadBillHistory()}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {historyLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left">
                <th className="px-2 py-2 font-semibold">Created</th>
                <th className="px-2 py-2 font-semibold">Provider</th>
                <th className="px-2 py-2 font-semibold">Period</th>
                <th className="px-2 py-2 font-semibold">Cost</th>
                <th className="px-2 py-2 font-semibold">Usage</th>
                <th className="px-2 py-2 font-semibold">Confidence</th>
                <th className="px-2 py-2 font-semibold">Insights</th>
              </tr>
            </thead>
            <tbody>
              {!selectedPropertyId ? (
                <tr>
                  <td className="px-2 py-3 text-zinc-500" colSpan={7}>
                    Select a property to view bill history.
                  </td>
                </tr>
              ) : historyRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-zinc-500" colSpan={7}>
                    No bills stored yet for this property.
                  </td>
                </tr>
              ) : (
                historyRows.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100">
                    <td className="px-2 py-2">{formatDate(row.createdAt)}</td>
                    <td className="px-2 py-2">{row.provider ?? "-"}</td>
                    <td className="px-2 py-2">
                      {row.periodStart ?? "-"} to {row.periodEnd ?? "-"}
                    </td>
                    <td className="px-2 py-2">
                      {asCurrency(row.totalCost, row.currency)}
                    </td>
                    <td className="px-2 py-2">
                      {row.usageValue ?? "-"} {row.usageUnit ?? ""}
                    </td>
                    <td className="px-2 py-2">
                      {row.confidence !== null
                        ? `${(row.confidence * 100).toFixed(1)}%`
                        : "-"}
                    </td>
                    <td className="px-2 py-2">
                      total={row.insightTotal} high={row.insightHigh} watch={row.insightWatch}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {statusMessage && (
        <section className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {statusMessage}
        </section>
      )}

      <BillParserConsole
        authToken={authToken}
        initialPropertyId={selectedPropertyId}
        onQuotaBlocked={() =>
          setStatusMessage(
            "Free tier limit reached. Use the billing buttons above to upgrade.",
          )
        }
        onParsedSuccess={() => {
          void loadProperties();
          void loadBillHistory();
          void loadAnalyticsSummary();
        }}
      />
    </div>
  );
}




