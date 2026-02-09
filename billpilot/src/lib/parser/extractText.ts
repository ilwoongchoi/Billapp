import { Buffer } from "node:buffer";

import { PDFParse } from "pdf-parse";

function normalizeExtractedText(rawText: string): string {
  return rawText
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isPdf(file: File): boolean {
  return (
    file.type.toLowerCase().includes("pdf") ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

export async function extractTextFromFile(file: File): Promise<string> {
  if (isPdf(file)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: buffer });
    const data = await parser.getText();
    await parser.destroy();
    return normalizeExtractedText(data.text ?? "");
  }

  const text = await file.text();
  return normalizeExtractedText(text);
}
