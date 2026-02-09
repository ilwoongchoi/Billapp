import { Buffer } from "node:buffer";

import PDFDocument from "pdfkit";

import { BillHistoryRow } from "@/lib/bills/history-query";

type PdfDoc = InstanceType<typeof PDFDocument>;

function escapeCsv(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function rowPeriod(row: BillHistoryRow): string {
  const start = row.periodStart ?? "-";
  const end = row.periodEnd ?? "-";
  return `${start} to ${end}`;
}

export function buildCsv(rows: BillHistoryRow[]): string {
  const headers = [
    "bill_id",
    "property_id",
    "property_name",
    "provider",
    "period",
    "total_cost",
    "currency",
    "usage_value",
    "usage_unit",
    "confidence",
    "insight_total",
    "insight_high",
    "insight_watch",
    "sample_insight",
    "created_at",
  ];

  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(
      [
        escapeCsv(row.id),
        escapeCsv(row.propertyId),
        escapeCsv(row.propertyName),
        escapeCsv(row.provider),
        escapeCsv(rowPeriod(row)),
        escapeCsv(row.totalCost),
        escapeCsv(row.currency),
        escapeCsv(row.usageValue),
        escapeCsv(row.usageUnit),
        escapeCsv(row.confidence),
        escapeCsv(row.insightTotal),
        escapeCsv(row.insightHigh),
        escapeCsv(row.insightWatch),
        escapeCsv(row.sampleInsight),
        escapeCsv(row.createdAt),
      ].join(","),
    );
  }

  return lines.join("\n");
}

function writePdfRows(doc: PdfDoc, rows: BillHistoryRow[]) {
  doc.fontSize(10);

  for (const row of rows) {
    const block = [
      `${row.provider ?? "Unknown provider"} (${row.propertyName})`,
      `Period: ${rowPeriod(row)}`,
      `Cost: ${row.totalCost ?? "-"} ${row.currency} | Usage: ${
        row.usageValue ?? "-"
      } ${row.usageUnit ?? ""}`,
      `Confidence: ${
        row.confidence !== null ? `${(row.confidence * 100).toFixed(1)}%` : "-"
      } | Insights: total=${row.insightTotal}, high=${row.insightHigh}, watch=${row.insightWatch}`,
      `Sample insight: ${row.sampleInsight ?? "-"}`,
      `Created: ${row.createdAt}`,
    ].join("\n");

    doc.text(block, { width: 520 });
    doc.moveDown(1);

    if (doc.y > 730) {
      doc.addPage();
    }
  }
}

export async function buildPdf(rows: BillHistoryRow[]): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    info: {
      Title: "BillPilot Export",
      Author: "BillPilot",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

  doc.fontSize(16).text("BillPilot Export", { align: "left" });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`);
  doc.text(`Rows: ${rows.length}`);
  doc.moveDown(1);

  if (rows.length === 0) {
    doc.text("No data available for this export.");
  } else {
    writePdfRows(doc, rows);
  }

  doc.end();

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

