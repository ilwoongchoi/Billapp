import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import {
  listReminderUsers,
  runReminderSweepForUser,
} from "@/lib/reception/reminders";

export const runtime = "nodejs";

const payloadSchema = z.object({
  userId: z.string().uuid().optional(),
  dryRun: z.boolean().optional(),
  limitUsers: z.number().int().min(1).max(200).optional(),
});

function hasCronAccess(request: Request): boolean {
  const expected = process.env.RECEPTION_REMINDER_CRON_SECRET?.trim();
  if (!expected) {
    return false;
  }

  const provided = request.headers.get("x-cron-secret")?.trim();
  if (!provided) {
    return false;
  }

  return provided === expected;
}

export async function POST(request: Request) {
  try {
    const body = payloadSchema.parse(await request.json().catch(() => ({})));
    const cronAccess = hasCronAccess(request);

    let targetUserIds: string[] = [];
    if (cronAccess) {
      if (body.userId) {
        targetUserIds = [body.userId];
      } else {
        const discovered = await listReminderUsers();
        const limit = body.limitUsers ?? discovered.length;
        targetUserIds = discovered.slice(0, limit);
      }
    } else {
      const user = await requireApiUser(request);
      targetUserIds = [user.id];
    }

    if (targetUserIds.length === 0) {
      return NextResponse.json({
        mode: cronAccess ? "cron" : "user",
        dryRun: Boolean(body.dryRun),
        users: [],
        totals: {
          users: 0,
          seeded: 0,
          due: 0,
          sent: 0,
          skipped: 0,
          errored: 0,
        },
      });
    }

    const results = [];
    for (const userId of targetUserIds) {
      const result = await runReminderSweepForUser({
        userId,
        dryRun: body.dryRun,
      });
      results.push(result);
    }

    const totals = results.reduce(
      (acc, row) => {
        acc.seeded += row.seeded;
        acc.due += row.due;
        acc.sent += row.sent;
        acc.skipped += row.skipped;
        acc.errored += row.errored;
        return acc;
      },
      {
        users: results.length,
        seeded: 0,
        due: 0,
        sent: 0,
        skipped: 0,
        errored: 0,
      },
    );

    return NextResponse.json({
      mode: cronAccess ? "cron" : "user",
      dryRun: Boolean(body.dryRun),
      generatedAt: new Date().toISOString(),
      users: results,
      totals,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
        },
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
