"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const SAMPLE_RAW_TEXT = `Provider: North Utility
Billing Period: 01/01/2026 - 01/31/2026
Total Amount Due: $182.44
Usage: 648 kWh
Delivery: 42.12
Tax: 11.21`;

interface QuotaResult {
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

interface ParseInsight {
  type: string;
  severity: string;
  message: string;
  estSavings: number | null;
  residual: number | null;
}

interface ParseResponse {
  parseConfidence: number;
  decision: "SHIP" | "NO-SHIP" | "BOUNDARY-BAND ONLY";
  requiresManualReview: boolean;
  priorBillsUsed: number;
  bill: {
    provider: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    totalCost: number | null;
    usageValue: number | null;
    usageUnit: string | null;
    currency: string;
    lineItems: Array<{ itemName: string; amount: number }>;
  };
  framework: {
    residual: {
      cost: number | null;
      usage: number | null;
    };
  };
  quota: QuotaResult;
  insights: ParseInsight[];
  persistedBillId: string | null;
  persistenceError: string | null;
}

interface UploadResponse {
  bucket: string;
  filePath: string;
  storageRef: string;
  signedUrl: string | null;
  fileName: string;
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

interface BillParserConsoleProps {
  authToken?: string | null;
  initialPropertyId?: string;
  onQuotaBlocked?: () => void;
  onParsedSuccess?: () => void;
}

export function BillParserConsole({
  authToken = null,
  initialPropertyId = "",
  onQuotaBlocked,
  onParsedSuccess,
}: BillParserConsoleProps) {
  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [provider, setProvider] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [rawText, setRawText] = useState(SAMPLE_RAW_TEXT);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingParse, setLoadingParse] = useState(false);
  const [loadingUpload, setLoadingUpload] = useState(false);

  useEffect(() => {
    setPropertyId(initialPropertyId);
  }, [initialPropertyId]);

  const authHeaders = useMemo(() => {
    if (!authToken) {
      return undefined;
    }
    return { Authorization: `Bearer ${authToken}` };
  }, [authToken]);

  const quotaText = useMemo(() => {
    if (!parseResult?.quota.enforced) {
      return "Quota not enforced in this environment.";
    }
    if (parseResult.quota.limit === null) {
      return "Paid plan detected: unlimited analyses.";
    }
    return `Plan: ${parseResult.quota.plan ?? "free"} | Used: ${
      parseResult.quota.usedThisMonth ?? 0
    }/${parseResult.quota.limit} | Remaining: ${parseResult.quota.remaining ?? 0}`;
  }, [parseResult]);

  const handleUploadOnly = async () => {
    if (!selectedFile) {
      setErrorMessage("Pick a file first to test /api/bills/upload.");
      return;
    }
    if (propertyId.trim() && !authToken) {
      setErrorMessage("Sign in first to upload files for a saved property.");
      return;
    }

    setErrorMessage(null);
    setLoadingUpload(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (propertyId.trim()) {
        formData.append("propertyId", propertyId.trim());
      }

      const response = await fetch("/api/bills/upload", {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });
      const payload = (await response.json()) as UploadResponse & {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "Upload failed.");
      }

      setUploadResult(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      setErrorMessage(message);
    } finally {
      setLoadingUpload(false);
    }
  };

  const handleParse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setParseResult(null);

    const hasRawText = rawText.trim().length >= 20;
    const hasFile = Boolean(selectedFile);
    if (!hasRawText && !hasFile) {
      setErrorMessage("Provide bill text (>=20 chars) or upload a file.");
      return;
    }
    if (propertyId.trim() && !authToken) {
      setErrorMessage("Sign in first to analyze and persist property bills.");
      return;
    }

    setLoadingParse(true);

    try {
      const formData = new FormData();
      if (hasFile && selectedFile) {
        formData.append("file", selectedFile);
      } else {
        formData.append("rawText", rawText.trim());
      }

      if (propertyId.trim()) {
        formData.append("propertyId", propertyId.trim());
      }
      if (provider.trim()) {
        formData.append("provider", provider.trim());
      }
      if (currency.trim()) {
        formData.append("currency", currency.trim().toUpperCase());
      }
      if (uploadResult?.storageRef) {
        formData.append("fileUrl", uploadResult.storageRef);
      }

      const response = await fetch("/api/bills/parse", {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });

      const payload = (await response.json()) as ParseResponse & {
        error?: string;
        message?: string;
        quota?: QuotaResult;
      };

      if (!response.ok) {
        if (response.status === 402) {
          const limit = payload.quota?.limit ?? 2;
          onQuotaBlocked?.();
          throw new Error(
            `Free-tier limit reached (${limit}/month). Upgrade to keep parsing.`,
          );
        }
        throw new Error(payload.message ?? payload.error ?? "Parse failed.");
      }

      setParseResult(payload);
      onParsedSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Parse failed.";
      setErrorMessage(message);
    } finally {
      setLoadingParse(false);
    }
  };

  return (
    <div className="space-y-6">
      <form
        className="space-y-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm"
        onSubmit={handleParse}
      >
        <div>
          <h2 className="text-xl font-semibold">Bill parser console</h2>
          <p className="text-sm text-zinc-600">
            Upload a file or paste raw bill text, then run parse + insight engine.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Property ID (for quota + persistence)</span>
            <input
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              placeholder="uuid"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Provider override</span>
            <input
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              placeholder="North Utility"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Currency</span>
            <input
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              placeholder="USD"
            />
          </label>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Bill file</span>
          <input
            type="file"
            accept=".pdf,.txt,.csv"
            onChange={(event) =>
              setSelectedFile(event.target.files?.[0] ?? null)
            }
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Raw text</span>
          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            rows={8}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={loadingParse}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loadingParse ? "Parsing..." : "Parse + Analyze"}
          </button>
          <button
            type="button"
            disabled={loadingUpload}
            onClick={handleUploadOnly}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {loadingUpload ? "Uploading..." : "Upload only"}
          </button>
        </div>
      </form>

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {uploadResult && (
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          <h3 className="mb-2 text-lg font-semibold">Upload result</h3>
          <p className="text-sm text-zinc-700">
            Stored as <span className="font-mono">{uploadResult.storageRef}</span>
          </p>
          {uploadResult.signedUrl && (
            <a
              href={uploadResult.signedUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-blue-600 underline"
            >
              Open signed URL
            </a>
          )}
        </div>
      )}

      {parseResult && (
        <div className="space-y-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold">
              Decision: {parseResult.decision}
            </span>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold">
              Confidence: {(parseResult.parseConfidence * 100).toFixed(1)}%
            </span>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold">
              Manual review: {parseResult.requiresManualReview ? "yes" : "no"}
            </span>
          </div>

          <p className="text-sm text-zinc-700">{quotaText}</p>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 p-3">
              <p className="text-xs uppercase text-zinc-500">Provider</p>
              <p className="font-semibold">{parseResult.bill.provider ?? "-"}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 p-3">
              <p className="text-xs uppercase text-zinc-500">Total cost</p>
              <p className="font-semibold">
                {asCurrency(parseResult.bill.totalCost, parseResult.bill.currency)}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200 p-3">
              <p className="text-xs uppercase text-zinc-500">Usage</p>
              <p className="font-semibold">
                {parseResult.bill.usageValue ?? "-"} {parseResult.bill.usageUnit ?? ""}
              </p>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold">Insights</h4>
            <ul className="space-y-2">
              {parseResult.insights.map((insight, index) => (
                <li key={`${insight.type}-${index}`} className="rounded-lg border border-zinc-200 p-3">
                  <p className="text-sm font-medium">
                    [{insight.severity}] {insight.message}
                  </p>
                  <p className="text-xs text-zinc-600">
                    est_savings={asCurrency(insight.estSavings, parseResult.bill.currency)}{" "}
                    residual={insight.residual ?? "-"}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-zinc-600">
            Residual(cost)={parseResult.framework.residual.cost ?? "-"} | Residual(usage)=
            {parseResult.framework.residual.usage ?? "-"} | prior bills used=
            {parseResult.priorBillsUsed}
          </p>
          <p className="text-xs text-zinc-600">
            persistedBillId={parseResult.persistedBillId ?? "none"}{" "}
            {parseResult.persistenceError
              ? `(persistence error: ${parseResult.persistenceError})`
              : ""}
          </p>
        </div>
      )}
    </div>
  );
}
