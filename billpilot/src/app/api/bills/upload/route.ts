import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { propertyBelongsToUser } from "@/lib/properties";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const DEFAULT_BUCKET = "bill-files";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 140);
}

function buildFilePath(propertyId: string | undefined, originalName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = sanitizeFilename(originalName);
  const scope = propertyId ?? "unassigned";
  return `${scope}/${stamp}-${randomUUID()}-${safeName}`;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "invalid_content_type", message: "Use multipart/form-data." },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const fileCandidate = formData.get("file");
    const propertyId =
      typeof formData.get("propertyId") === "string"
        ? String(formData.get("propertyId"))
        : undefined;
    const apiUser = propertyId ? await requireApiUser(request) : null;

    if (!(fileCandidate instanceof File)) {
      return NextResponse.json(
        { error: "file_required", message: "Attach a bill file under `file`." },
        { status: 400 },
      );
    }

    if (
      propertyId &&
      (!apiUser || !(await propertyBelongsToUser(propertyId, apiUser.id)))
    ) {
      return NextResponse.json(
        {
          error: "forbidden_property",
          message: "propertyId is missing, invalid, or not owned by this user.",
        },
        { status: 403 },
      );
    }

    const supabase = getServiceSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        {
          error: "supabase_not_configured",
          message:
            "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable uploads.",
        },
        { status: 500 },
      );
    }

    const bucket = process.env.SUPABASE_BILLS_BUCKET ?? DEFAULT_BUCKET;
    const filePath = buildFilePath(propertyId, fileCandidate.name);
    const contentTypeValue =
      fileCandidate.type || "application/octet-stream";
    const fileBuffer = Buffer.from(await fileCandidate.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, fileBuffer, {
        contentType: contentTypeValue,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        {
          error: "upload_failed",
          message: uploadError.message,
          bucket,
        },
        { status: 500 },
      );
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, 60 * 60 * 12);

    return NextResponse.json({
      bucket,
      filePath,
      storageRef: `${bucket}/${filePath}`,
      fileName: fileCandidate.name,
      size: fileCandidate.size,
      contentType: contentTypeValue,
      signedUrl: signedError ? null : signedData?.signedUrl ?? null,
      signedUrlError: signedError?.message ?? null,
      propertyId: propertyId ?? null,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
