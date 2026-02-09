"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getBrowserSupabaseClient } from "@/lib/supabase-browser";

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

interface PropertySummary {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  created_at: string;
  analysesThisMonth: number;
}

interface PropertiesApiResponse {
  properties: PropertySummary[];
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

function shortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

export function PropertyDetailWorkspace({ propertyId }: { propertyId: string }) {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [historyRows, setHistoryRows] = useState<BillHistoryRow[]>([]);
  const [property, setProperty] = useState<PropertySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<"csv" | "pdf" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const buildFilterQuery = useCallback((filters?: {
    provider?: string;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const params = new URLSearchParams({
      propertyId,
      limit: "120",
    });
    const provider = filters?.provider ?? "";
    const from = filters?.dateFrom ?? "";
    const to = filters?.dateTo ?? "";

    if (provider.trim()) {
      params.set("provider", provider.trim());
    }
    if (from) {
      params.set("dateFrom", from);
    }
    if (to) {
      params.set("dateTo", to);
    }
    return params.toString();
  }, [propertyId]);

  useEffect(() => {
    let cancelled = false;
    const supabase = getBrowserSupabaseClient();

    const applySession = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }
      setAuthToken(data.session?.access_token ?? null);
      setAuthLoading(false);
    };

    void applySession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) {
        return;
      }
      setAuthToken(session?.access_token ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const loadData = useCallback(async (filters?: {
    provider?: string;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const [historyResponse, propertiesResponse] = await Promise.all([
        fetch(
          `/api/bills/history?${buildFilterQuery(filters)}`,
          {
            headers: { Authorization: `Bearer ${authToken}` },
          },
        ),
        fetch("/api/properties", {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      const historyPayload = (await historyResponse.json()) as
        | { bills: BillHistoryRow[] }
        | { error?: string; message?: string };
      const propertiesPayload = (await propertiesResponse.json()) as
        | PropertiesApiResponse
        | { error?: string; message?: string };

      if (!historyResponse.ok) {
        throw new Error(readApiError(historyPayload, "Failed to load bill history."));
      }
      if (!propertiesResponse.ok) {
        throw new Error(readApiError(propertiesPayload, "Failed to load property."));
      }

      const rows = (historyPayload as { bills: BillHistoryRow[] }).bills;
      setHistoryRows(rows);

      const matched = (propertiesPayload as PropertiesApiResponse).properties.find(
        (row) => row.id === propertyId,
      );
      setProperty(matched ?? null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load property analytics.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }, [authToken, buildFilterQuery, propertyId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const downloadExport = async (format: "csv" | "pdf") => {
    if (!authToken) {
      setErrorMessage("Sign in to export data.");
      return;
    }

    setDownloading(format);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/bills/export?${(() => {
          const params = new URLSearchParams(
            buildFilterQuery({
              provider: providerFilter,
              dateFrom,
              dateTo,
            }),
          );
          params.set("format", format);
          params.set("limit", "500");
          return params.toString();
        })()}`,
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      );

      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: string;
          message?: string;
        };
        throw new Error(readApiError(payload, `Failed to export ${format}.`));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `billpilot-${propertyId}-${stamp}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Failed to export ${format}.`;
      setErrorMessage(message);
    } finally {
      setDownloading(null);
    }
  };

  const stats = useMemo(() => {
    if (historyRows.length === 0) {
      return {
        latestCost: null as number | null,
        avgCost: null as number | null,
        avgConfidence: null as number | null,
        highAlerts: 0,
      };
    }

    const latestCost = historyRows[0]?.totalCost ?? null;
    const costs = historyRows
      .map((row) => row.totalCost)
      .filter((value): value is number => value !== null);
    const confidences = historyRows
      .map((row) => row.confidence)
      .filter((value): value is number => value !== null);

    const avgCost =
      costs.length > 0
        ? costs.reduce((sum, value) => sum + value, 0) / costs.length
        : null;
    const avgConfidence =
      confidences.length > 0
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : null;
    const highAlerts = historyRows.reduce(
      (sum, row) => sum + row.insightHigh,
      0,
    );

    return { latestCost, avgCost, avgConfidence, highAlerts };
  }, [historyRows]);

  const costSeries = useMemo(() => {
    return [...historyRows]
      .reverse()
      .map((row) => ({
        date: shortDate(row.periodEnd ?? row.createdAt),
        cost: row.totalCost,
        confidence:
          row.confidence !== null
            ? Number((row.confidence * 100).toFixed(1))
            : null,
      }));
  }, [historyRows]);

  const insightSeries = useMemo(() => {
    return [...historyRows]
      .slice(0, 20)
      .reverse()
      .map((row) => ({
        date: shortDate(row.periodEnd ?? row.createdAt),
        high: row.insightHigh,
        watch: row.insightWatch,
      }));
  }, [historyRows]);

  const providerOptions = useMemo(() => {
    return Array.from(
      new Set(historyRows.map((row) => row.provider).filter(Boolean)),
    ) as string[];
  }, [historyRows]);

  if (authLoading) {
    return <p className="text-sm text-zinc-600">Loading authentication...</p>;
  }

  if (!authToken) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <p className="text-sm text-zinc-700">
          You need to sign in first from the dashboard.
        </p>
        <Link href="/dashboard" className="mt-3 inline-block text-sm text-blue-600 underline">
          Go to dashboard sign-in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">
            {property?.name ?? "Property analytics"}
          </h2>
          <p className="text-sm text-zinc-600">
            Property ID: <span className="font-mono">{propertyId}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void loadData({
                provider: providerFilter,
                dateFrom,
                dateTo,
              })
            }
            disabled={loading}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh data"}
          </button>
          <button
            type="button"
            onClick={() => void downloadExport("csv")}
            disabled={downloading !== null}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {downloading === "csv" ? "Exporting..." : "Export CSV"}
          </button>
          <button
            type="button"
            onClick={() => void downloadExport("pdf")}
            disabled={downloading !== null}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {downloading === "pdf" ? "Exporting..." : "Export PDF"}
          </button>
          <Link
            href="/dashboard"
            className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white"
          >
            Back to dashboard
          </Link>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold">Filters</h3>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Provider</span>
            <input
              list="provider-options"
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              placeholder="All providers"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
            <datalist id="provider-options">
              {providerOptions.map((provider) => (
                <option key={provider} value={provider} />
              ))}
            </datalist>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Date from (period end)</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Date to (period end)</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() =>
                void loadData({
                  provider: providerFilter,
                  dateFrom,
                  dateTo,
                })
              }
              disabled={loading}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                setProviderFilter("");
                setDateFrom("");
                setDateTo("");
                void loadData();
              }}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
            >
              Reset
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase text-zinc-500">Latest cost</p>
          <p className="text-xl font-semibold">
            {asCurrency(stats.latestCost, historyRows[0]?.currency ?? "USD")}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase text-zinc-500">Average cost</p>
          <p className="text-xl font-semibold">
            {asCurrency(stats.avgCost, historyRows[0]?.currency ?? "USD")}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase text-zinc-500">Average confidence</p>
          <p className="text-xl font-semibold">
            {stats.avgConfidence !== null
              ? `${(stats.avgConfidence * 100).toFixed(1)}%`
              : "-"}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase text-zinc-500">High alerts</p>
          <p className="text-xl font-semibold">{stats.highAlerts}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold">Cost trend</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={costSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="cost" stroke="#111827" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold">High/Watch insights</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={insightSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="watch" stackId="a" fill="#f59e0b" />
                <Bar dataKey="high" stackId="a" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold">Recent bill rows</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left">
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Cost</th>
                <th className="px-2 py-2 font-semibold">Usage</th>
                <th className="px-2 py-2 font-semibold">Confidence</th>
                <th className="px-2 py-2 font-semibold">Insights</th>
                <th className="px-2 py-2 font-semibold">Sample insight</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-zinc-500" colSpan={6}>
                    No persisted rows yet for this property.
                  </td>
                </tr>
              ) : (
                historyRows.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100">
                    <td className="px-2 py-2">{shortDate(row.periodEnd ?? row.createdAt)}</td>
                    <td className="px-2 py-2">{asCurrency(row.totalCost, row.currency)}</td>
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
                    <td className="px-2 py-2">{row.sampleInsight ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
