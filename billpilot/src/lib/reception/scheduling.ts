import { getServiceSupabaseClient } from "@/lib/supabase";

interface BookingIntervalRow {
  id: string;
  scheduled_start: string;
  scheduled_end: string | null;
}

export interface RescheduleOption {
  index: number;
  startIso: string;
  endIso: string;
  label: string;
}

interface GenerateRescheduleOptionsInput {
  userId: string;
  durationMinutes: number;
  timezone: string;
  excludeBookingId?: string | null;
  count?: number;
  startFromIso?: string;
  horizonDays?: number;
}

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "rescheduled"] as const;

function ceilToNextHalfHour(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setSeconds(0, 0);
  const minutes = copy.getMinutes();
  if (minutes === 0 || minutes === 30) {
    return copy;
  }

  if (minutes < 30) {
    copy.setMinutes(30, 0, 0);
    return copy;
  }

  copy.setHours(copy.getHours() + 1, 0, 0, 0);
  return copy;
}

function safeParseIso(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTimeParts(date: Date, timezone: string): {
  weekday: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).formatToParts(date);

  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number.parseInt(
    parts.find((part) => part.type === "hour")?.value ?? "0",
    10,
  );
  const minute = Number.parseInt(
    parts.find((part) => part.type === "minute")?.value ?? "0",
    10,
  );

  return {
    weekday,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

function isWithinWorkingWindow(input: {
  start: Date;
  end: Date;
  timezone: string;
}): boolean {
  const startParts = getTimeParts(input.start, input.timezone);
  const endParts = getTimeParts(input.end, input.timezone);

  const disallowedDays = new Set(["Sun"]);
  if (disallowedDays.has(startParts.weekday)) {
    return false;
  }

  if (startParts.hour < 8 || startParts.hour > 18) {
    return false;
  }

  if (endParts.hour > 20 || (endParts.hour === 20 && endParts.minute > 0)) {
    return false;
  }

  return true;
}

function intervalsOverlap(input: {
  startA: Date;
  endA: Date;
  startB: Date;
  endB: Date;
}): boolean {
  return input.startA < input.endB && input.endA > input.startB;
}

function formatOptionLabel(startIso: string, timezone: string): string {
  const parsed = safeParseIso(startIso);
  if (!parsed) {
    return startIso;
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(parsed);
}

function normalizeDurationMinutes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 120;
  }

  return Math.min(720, Math.max(15, Math.round(value)));
}

export async function generateRescheduleOptions(
  input: GenerateRescheduleOptionsInput,
): Promise<RescheduleOption[]> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return [];
  }

  const count = Math.min(10, Math.max(1, input.count ?? 3));
  const durationMinutes = normalizeDurationMinutes(input.durationMinutes);
  const horizonDays = Math.min(45, Math.max(3, input.horizonDays ?? 21));

  const now = new Date();
  const nowPlusLeadTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const floor = safeParseIso(input.startFromIso) ?? nowPlusLeadTime;
  const searchStart = floor > nowPlusLeadTime ? floor : nowPlusLeadTime;
  const searchEnd = new Date(searchStart.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  let bookingQuery = supabase
    .from("service_bookings")
    .select("id, scheduled_start, scheduled_end")
    .eq("user_id", input.userId)
    .in("status", [...ACTIVE_BOOKING_STATUSES])
    .gte("scheduled_start", new Date(searchStart.getTime() - 24 * 60 * 60 * 1000).toISOString())
    .lte("scheduled_start", searchEnd.toISOString());

  if (input.excludeBookingId) {
    bookingQuery = bookingQuery.neq("id", input.excludeBookingId);
  }

  const { data } = await bookingQuery;
  const intervals = ((data ?? []) as BookingIntervalRow[])
    .map((row) => {
      const start = safeParseIso(row.scheduled_start);
      if (!start) {
        return null;
      }

      const explicitEnd = safeParseIso(row.scheduled_end);
      const end =
        explicitEnd && explicitEnd > start
          ? explicitEnd
          : new Date(start.getTime() + 120 * 60 * 1000);

      return {
        start,
        end,
      };
    })
    .filter((value): value is { start: Date; end: Date } => Boolean(value));

  const options: RescheduleOption[] = [];
  let candidate = ceilToNextHalfHour(searchStart);
  let guard = 0;

  while (options.length < count && candidate < searchEnd && guard < 1500) {
    const candidateEnd = new Date(candidate.getTime() + durationMinutes * 60 * 1000);

    if (isWithinWorkingWindow({ start: candidate, end: candidateEnd, timezone: input.timezone })) {
      const hasConflict = intervals.some((interval) =>
        intervalsOverlap({
          startA: candidate,
          endA: candidateEnd,
          startB: interval.start,
          endB: interval.end,
        }),
      );

      if (!hasConflict) {
        options.push({
          index: options.length + 1,
          startIso: candidate.toISOString(),
          endIso: candidateEnd.toISOString(),
          label: formatOptionLabel(candidate.toISOString(), input.timezone),
        });
      }
    }

    candidate = new Date(candidate.getTime() + 30 * 60 * 1000);
    guard += 1;
  }

  return options;
}
