import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiUser } from "@/lib/auth";
import {
  listRescheduleEscalationUsers,
  runRescheduleEscalationSweepForUser,
} from "@/lib/reception/reschedule-escalation";

export const runtime = "nodejs";

const payloadSchema = z.object({
  userId: z.string().uuid().optional(),
  dryRun: z.boolean().optional(),
  limitUsers: z.number().int().min(1).max(200).optional(),
  maxRows: z.number().int().min(1).max(500).optional(),
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
        const discovered = await listRescheduleEscalationUsers();
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
          checked: 0,
          overdue: 0,
          escalated: 0,
          autoHandoff: 0,
          errors: 0,
        },
      });
    }

    const users = [];
    for (const userId of targetUserIds) {
      const result = await runRescheduleEscalationSweepForUser({
        userId,
        dryRun: body.dryRun,
        maxRows: body.maxRows,
      });
      users.push(result);
    }

    const totals = users.reduce(
      (acc, row) => {
        acc.checked += row.checked;
        acc.overdue += row.overdue;
        acc.escalated += row.escalated;
        acc.autoHandoff += row.autoHandoff;
        acc.errors += row.errors;
        acc.maxLevelReached = Math.max(acc.maxLevelReached, row.maxLevelReached);
        return acc;
      },
      {
        users: users.length,
        checked: 0,
        overdue: 0,
        escalated: 0,
        autoHandoff: 0,
        errors: 0,
        maxLevelReached: 0,
      },
    );

    return NextResponse.json({
      mode: cronAccess ? "cron" : "user",
      dryRun: Boolean(body.dryRun),
      generatedAt: new Date().toISOString(),
      users,
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
