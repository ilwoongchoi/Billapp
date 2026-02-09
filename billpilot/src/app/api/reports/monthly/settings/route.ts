import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import { propertyBelongsToUser } from "@/lib/properties";
import {
  getMonthlyReportSetting,
  upsertMonthlyReportSetting,
} from "@/lib/reports/settings";
import { getServiceSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const payloadSchema = z.object({
  enabled: z.boolean(),
  format: z.enum(["csv", "pdf"]),
  timezone: z.string().min(2).max(60),
  dayOfMonth: z.number().int().min(1).max(28),
  propertyId: z.string().uuid().nullable().optional(),
  providerFilter: z.string().max(120).nullable().optional(),
});

interface PropertyRow {
  id: string;
  name: string;
}

async function listProperties(userId: string): Promise<PropertyRow[]> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data } = await supabase
    .from("properties")
    .select("id, name")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  return (data as PropertyRow[] | null) ?? [];
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(request);
    const [setting, properties] = await Promise.all([
      getMonthlyReportSetting(user.id),
      listProperties(user.id),
    ]);

    return NextResponse.json({
      setting,
      properties,
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

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);
    const input = payloadSchema.parse(await request.json());
    const propertyId = input.propertyId ?? null;

    if (propertyId) {
      const owned = await propertyBelongsToUser(propertyId, user.id);
      if (!owned) {
        return NextResponse.json(
          {
            error: "forbidden_property",
            message: "Selected property does not belong to this user.",
          },
          { status: 403 },
        );
      }
    }

    const setting = await upsertMonthlyReportSetting({
      userId: user.id,
      enabled: input.enabled,
      format: input.format,
      timezone: input.timezone,
      dayOfMonth: input.dayOfMonth,
      propertyId,
      providerFilter: input.providerFilter ?? null,
    });

    return NextResponse.json({ setting });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "invalid_request",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

