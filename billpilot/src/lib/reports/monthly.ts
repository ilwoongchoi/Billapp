import { Buffer } from "node:buffer";

import { Resend } from "resend";

import { BillHistoryRow, getBillHistoryForUser } from "@/lib/bills/history-query";
import { buildCsv, buildPdf } from "@/lib/reports/export-builders";

export type MonthlyReportFormat = "csv" | "pdf";

export interface MonthlyReportRange {
  monthKey: string;
  label: string;
  dateFrom: string;
  dateTo: string;
}

export interface MonthlyReportBuildResult {
  range: MonthlyReportRange;
  rows: BillHistoryRow[];
  filename: string;
  mimeType: string;
  attachment: Buffer;
}

const MONTH_KEY_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function monthLabelFromDate(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function getPreviousMonthRange(now = new Date()): MonthlyReportRange {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  const monthKey = `${start.getUTCFullYear()}-${String(
    start.getUTCMonth() + 1,
  ).padStart(2, "0")}`;

  return {
    monthKey,
    label: monthLabelFromDate(start),
    dateFrom: toIsoDate(start),
    dateTo: toIsoDate(end),
  };
}

export function parseMonthRange(monthKey: string): MonthlyReportRange {
  if (!MONTH_KEY_REGEX.test(monthKey)) {
    throw new Error("month must be in YYYY-MM format.");
  }

  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  return {
    monthKey,
    label: monthLabelFromDate(start),
    dateFrom: toIsoDate(start),
    dateTo: toIsoDate(end),
  };
}

function resolveFilename(input: {
  propertyId?: string | null;
  monthKey: string;
  format: MonthlyReportFormat;
}): string {
  const scope = input.propertyId ? input.propertyId.slice(0, 10) : "all";
  return `billpilot-monthly-${scope}-${input.monthKey}.${input.format}`;
}

export async function buildMonthlyReport(input: {
  userId: string;
  format: MonthlyReportFormat;
  range: MonthlyReportRange;
  propertyId?: string | null;
  providerFilter?: string | null;
  limit?: number;
}): Promise<MonthlyReportBuildResult> {
  const rows = await getBillHistoryForUser({
    userId: input.userId,
    propertyId: input.propertyId ?? undefined,
    provider: input.providerFilter ?? undefined,
    dateFrom: input.range.dateFrom,
    dateTo: input.range.dateTo,
    limit: input.limit ?? 500,
  });

  if (input.format === "csv") {
    return {
      range: input.range,
      rows,
      filename: resolveFilename({
        propertyId: input.propertyId,
        monthKey: input.range.monthKey,
        format: "csv",
      }),
      mimeType: "text/csv; charset=utf-8",
      attachment: Buffer.from(buildCsv(rows), "utf8"),
    };
  }

  return {
    range: input.range,
    rows,
    filename: resolveFilename({
      propertyId: input.propertyId,
      monthKey: input.range.monthKey,
      format: "pdf",
    }),
    mimeType: "application/pdf",
    attachment: await buildPdf(rows),
  };
}

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set.");
  }

  return new Resend(apiKey);
}

function getFromEmail(): string {
  const from = process.env.REPORTS_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error("Set REPORTS_FROM_EMAIL (or RESEND_FROM_EMAIL) in env.");
  }
  return from;
}

export async function sendMonthlyReportEmail(input: {
  to: string;
  report: MonthlyReportBuildResult;
  propertyName?: string | null;
  providerFilter?: string | null;
}) {
  const resend = getResendClient();
  const from = getFromEmail();

  const propertyLine = input.propertyName
    ? `<p><strong>Property:</strong> ${input.propertyName}</p>`
    : "";
  const providerLine = input.providerFilter
    ? `<p><strong>Provider filter:</strong> ${input.providerFilter}</p>`
    : "";

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>BillPilot Monthly Report</h2>
      <p><strong>Period:</strong> ${input.report.range.label} (${input.report.range.dateFrom} to ${input.report.range.dateTo})</p>
      ${propertyLine}
      ${providerLine}
      <p><strong>Rows included:</strong> ${input.report.rows.length}</p>
      <p>Your report is attached as ${input.report.filename}.</p>
    </div>
  `;

  return await resend.emails.send({
    from,
    to: [input.to],
    subject: `BillPilot Monthly Report - ${input.report.range.label}`,
    html,
    attachments: [
      {
        filename: input.report.filename,
        content: input.report.attachment.toString("base64"),
      },
    ],
  });
}

