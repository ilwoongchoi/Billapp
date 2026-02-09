"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { getBrowserSupabaseClient } from "@/lib/supabase-browser";

interface CustomerSummary {
  id: string;
  full_name: string | null;
  phone_e164: string;
  email: string | null;
}

interface ServiceTypeSummary {
  id: string;
  name: string;
  default_duration_minutes: number;
}

interface BusinessProfile {
  id: string;
  business_name: string;
  timezone: string;
  twilio_phone_number: string | null;
  updated_at: string;
}

interface ReceptionLead {
  id: string;
  status: "new" | "qualified" | "booked" | "lost";
  source: "phone" | "sms" | "web" | "manual";
  summary: string | null;
  estimatedValue: number | null;
  firstContactAt: string;
  lastActivityAt: string;
  createdAt: string;
  customer: CustomerSummary | null;
}

interface ReceptionBooking {
  id: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rescheduled";
  scheduledStart: string;
  scheduledEnd: string | null;
  notes: string | null;
  createdAt: string;
  customer: CustomerSummary | null;
  serviceType: ServiceTypeSummary | null;
}

interface ReceptionOverviewResponse {
  generatedAt: string;
  business: BusinessProfile | null;
  kpis: {
    leadsToday: number;
    leadsNew: number;
    leadsQualified: number;
    leadsBooked: number;
    leadsLost: number;
    openConversations: number;
    handoffConversations: number;
    aiRuns24h: number;
    handoffRate24h: number | null;
    avgDrift24h: number | null;
    driftBand: "stable_target" | "boundary_band" | "vector_breach" | "no_signal";
    upcomingBookings7d: number;
  };
  driftThresholds: {
    stableTarget: number;
    breachLimit: number;
  };
  directory: {
    customers: CustomerSummary[];
    serviceTypes: ServiceTypeSummary[];
  };
  leads: ReceptionLead[];
  bookings: ReceptionBooking[];
}

type LeadStatus = ReceptionLead["status"];
type BookingStatus = ReceptionBooking["status"];

interface ReminderStatusResponse {
  generatedAt: string;
  duePending: number;
  counts: {
    pending: number;
    sent: number;
    skipped: number;
    error: number;
  };
  reminders: Array<{
    id: string;
    bookingId: string;
    reminderType: "24h" | "2h";
    scheduledFor: string;
    status: "pending" | "sent" | "skipped" | "error";
    sentAt: string | null;
    errorMessage: string | null;
    createdAt: string;
    booking: {
      scheduledStart: string;
      status: BookingStatus;
    } | null;
    customer: CustomerSummary | null;
    serviceType: ServiceTypeSummary | null;
  }>;
}

interface RescheduleRequestSummary {
  id: string;
  bookingId: string;
  leadId: string | null;
  conversationId: string | null;
  status: "pending" | "options_sent" | "confirmed" | "handoff" | "closed";
  requestedAt: string;
  resolvedAt: string | null;
  assignedTo: string | null;
  assignedAt: string | null;
  slaDueAt: string | null;
  escalationLevel: number;
  lastEscalatedAt: string | null;
  isOverdue: boolean;
  overdueMinutes: number | null;
  latestCustomerMessage: string | null;
  optionBatch: number;
  selectedOptionIndex: number | null;
  selectedStart: string | null;
  selectedEnd: string | null;
  metadata: Record<string, unknown>;
  booking: {
    scheduledStart: string;
    scheduledEnd: string | null;
    status: BookingStatus;
  } | null;
  customer: CustomerSummary | null;
  serviceType: ServiceTypeSummary | null;
}

interface RescheduleQueueResponse {
  generatedAt: string;
  filters: {
    status: "all" | "pending" | "options_sent" | "confirmed" | "handoff" | "closed";
    limit: number;
  };
  counts: Record<string, number>;
  actionRequired: number;
  overdueActionRequired: number;
  escalatedActionRequired: number;
  requests: RescheduleRequestSummary[];
}

type RescheduleRequestStatus = RescheduleRequestSummary["status"];
type RescheduleQueueFilter = RescheduleQueueResponse["filters"]["status"];
type ReschedulePatchStatus = "handoff" | "closed" | "options_sent";

interface ReschedulePatchPayload {
  status?: ReschedulePatchStatus;
  note?: string | null;
  assignee?: string | null;
  slaDueAt?: string | null;
}

const RESCHEDULE_FILTER_OPTIONS: Array<{
  value: RescheduleQueueFilter;
  label: string;
}> = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "options_sent", label: "Options sent" },
  { value: "handoff", label: "Handoff" },
  { value: "confirmed", label: "Confirmed" },
  { value: "closed", label: "Closed" },
];

function readApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const error =
    "error" in payload && typeof payload.error === "string" ? payload.error : null;
  const message =
    "message" in payload && typeof payload.message === "string"
      ? payload.message
      : null;

  return message ?? error ?? fallback;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatShortText(value: string | null | undefined, maxLength = 80): string {
  if (!value) {
    return "-";
  }

  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  if (maxLength <= 3) {
    return trimmed.slice(0, maxLength);
  }

  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function formatOverdueLabel(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) {
    return "Overdue";
  }

  if (minutes < 60) {
    return `${minutes}m overdue`;
  }

  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) {
    return `${hours}h overdue`;
  }
  return `${hours}h ${rem}m overdue`;
}

function parseDatetimeLocalToIso(value: string): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function renderRescheduleStatusLabel(status: RescheduleRequestStatus): string {
  switch (status) {
    case "options_sent":
      return "options sent";
    default:
      return status;
  }
}

function rescheduleStatusTone(status: RescheduleRequestStatus): string {
  switch (status) {
    case "pending":
      return "border-amber-300 bg-amber-50 text-amber-700";
    case "options_sent":
      return "border-sky-300 bg-sky-50 text-sky-700";
    case "handoff":
      return "border-orange-300 bg-orange-50 text-orange-700";
    case "confirmed":
      return "border-emerald-300 bg-emerald-50 text-emerald-700";
    case "closed":
      return "border-zinc-300 bg-zinc-100 text-zinc-700";
    default:
      return "border-zinc-300 bg-white text-zinc-700";
  }
}

function renderDriftBandLabel(
  value: ReceptionOverviewResponse["kpis"]["driftBand"],
): string {
  switch (value) {
    case "stable_target":
      return "Stable target";
    case "boundary_band":
      return "Boundary band";
    case "vector_breach":
      return "Vector breach";
    default:
      return "No signal";
  }
}

function toDateTimeLocalValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toDateTimeLocalFromIso(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return toDateTimeLocalValue(parsed);
}

function getDefaultBookingStartLocal(): string {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  return toDateTimeLocalValue(next);
}

function buildCustomerLabel(customer: CustomerSummary): string {
  return `${customer.full_name ?? "Unknown"} (${customer.phone_e164})`;
}

export function ReceptionWorkspace() {
  const [emailInput, setEmailInput] = useState("");
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSending, setAuthSending] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [overview, setOverview] = useState<ReceptionOverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [reminderStatus, setReminderStatus] = useState<ReminderStatusResponse | null>(
    null,
  );
  const [reminderStatusLoading, setReminderStatusLoading] = useState(false);
  const [reminderRunLoading, setReminderRunLoading] = useState(false);
  const [rescheduleQueue, setRescheduleQueue] = useState<RescheduleQueueResponse | null>(
    null,
  );
  const [rescheduleQueueLoading, setRescheduleQueueLoading] = useState(false);
  const [rescheduleActionLoading, setRescheduleActionLoading] = useState<string | null>(
    null,
  );
  const [rescheduleBulkLoading, setRescheduleBulkLoading] = useState(false);
  const [rescheduleEscalationLoading, setRescheduleEscalationLoading] = useState(false);
  const [rescheduleStatusFilter, setRescheduleStatusFilter] =
    useState<RescheduleQueueFilter>("all");
  const [rescheduleSelectedIds, setRescheduleSelectedIds] = useState<string[]>([]);
  const [rescheduleStaffNoteDrafts, setRescheduleStaffNoteDrafts] = useState<
    Record<string, string>
  >({});
  const [rescheduleAssigneeDrafts, setRescheduleAssigneeDrafts] = useState<
    Record<string, string>
  >({});
  const [rescheduleSlaDrafts, setRescheduleSlaDrafts] = useState<
    Record<string, string>
  >({});
  const [rescheduleBulkNote, setRescheduleBulkNote] = useState("");

  const [businessName, setBusinessName] = useState("");
  const [businessTimezone, setBusinessTimezone] = useState("UTC");
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState("");
  const [businessSaving, setBusinessSaving] = useState(false);

  const [leadStatusDrafts, setLeadStatusDrafts] = useState<Record<string, LeadStatus>>({});
  const [bookingStatusDrafts, setBookingStatusDrafts] = useState<
    Record<string, BookingStatus>
  >({});
  const [bookingCustomerId, setBookingCustomerId] = useState("");
  const [bookingCustomerName, setBookingCustomerName] = useState("");
  const [bookingCustomerPhone, setBookingCustomerPhone] = useState("");
  const [bookingCustomerEmail, setBookingCustomerEmail] = useState("");
  const [bookingServiceTypeId, setBookingServiceTypeId] = useState("");
  const [bookingServiceTypeName, setBookingServiceTypeName] = useState("");
  const [bookingStartLocal, setBookingStartLocal] = useState(
    getDefaultBookingStartLocal,
  );
  const [bookingDurationMinutes, setBookingDurationMinutes] = useState("120");
  const [bookingStatus, setBookingStatus] = useState<BookingStatus>("pending");
  const [bookingNotes, setBookingNotes] = useState("");
  const [bookingCreating, setBookingCreating] = useState(false);

  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [updatingBookingId, setUpdatingBookingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    try {
      const supabase = getBrowserSupabaseClient();

      const applySession = async () => {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) {
          return;
        }

        if (error) {
          setAuthError(error.message);
          setAuthLoading(false);
          return;
        }

        setAuthToken(data.session?.access_token ?? null);
        setUserEmail(data.session?.user.email ?? null);
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
        setUserEmail(session?.user.email ?? null);
      });

      return () => {
        cancelled = true;
        subscription.unsubscribe();
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Supabase client failed to initialize.";
      setAuthError(message);
      setAuthLoading(false);
      return () => {
        cancelled = true;
      };
    }
  }, []);

  const loadOverview = useCallback(async () => {
    if (!authToken) {
      setOverview(null);
      return;
    }

    setOverviewLoading(true);
    try {
      const response = await fetch("/api/reception/overview", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      const payload = (await response.json()) as
        | ReceptionOverviewResponse
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to load receptionist overview."));
      }

      const data = payload as ReceptionOverviewResponse;
      setOverview(data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load receptionist overview.";
      setStatusMessage(message);
    } finally {
      setOverviewLoading(false);
    }
  }, [authToken]);

  const loadReminderStatus = useCallback(async () => {
    if (!authToken) {
      setReminderStatus(null);
      return;
    }

    setReminderStatusLoading(true);
    try {
      const response = await fetch("/api/reception/reminders/status?limit=30", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      const payload = (await response.json()) as
        | ReminderStatusResponse
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to load reminder status."));
      }

      setReminderStatus(payload as ReminderStatusResponse);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load reminder status.";
      setStatusMessage(message);
    } finally {
      setReminderStatusLoading(false);
    }
  }, [authToken]);

  const loadRescheduleQueue = useCallback(async () => {
    if (!authToken) {
      setRescheduleQueue(null);
      return;
    }

    setRescheduleQueueLoading(true);
    try {
      const query = new URLSearchParams({
        status: rescheduleStatusFilter,
        limit: "40",
      });
      const response = await fetch(
        `/api/reception/reschedule-requests?${query.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      const payload = (await response.json()) as
        | RescheduleQueueResponse
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to load reschedule queue."));
      }

      setRescheduleQueue(payload as RescheduleQueueResponse);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load reschedule queue.";
      setStatusMessage(message);
    } finally {
      setRescheduleQueueLoading(false);
    }
  }, [authToken, rescheduleStatusFilter]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadReminderStatus();
  }, [loadReminderStatus]);

  useEffect(() => {
    void loadRescheduleQueue();
  }, [loadRescheduleQueue]);

  useEffect(() => {
    const business = overview?.business;

    if (!business) {
      return;
    }

    setBusinessName(business.business_name);
    setBusinessTimezone(business.timezone);
    setTwilioPhoneNumber(business.twilio_phone_number ?? "");
  }, [overview?.business]);

  useEffect(() => {
    setLeadStatusDrafts(() => {
      const next: Record<string, LeadStatus> = {};
      for (const lead of overview?.leads ?? []) {
        next[lead.id] = lead.status;
      }
      return next;
    });
  }, [overview?.leads]);

  useEffect(() => {
    setBookingStatusDrafts(() => {
      const next: Record<string, BookingStatus> = {};
      for (const booking of overview?.bookings ?? []) {
        next[booking.id] = booking.status;
      }
      return next;
    });
  }, [overview?.bookings]);

  const selectedDriftColor = useMemo(() => {
    switch (overview?.kpis.driftBand) {
      case "stable_target":
        return "text-emerald-700 bg-emerald-50 border-emerald-200";
      case "boundary_band":
        return "text-amber-700 bg-amber-50 border-amber-200";
      case "vector_breach":
        return "text-rose-700 bg-rose-50 border-rose-200";
      default:
        return "text-zinc-700 bg-zinc-50 border-zinc-200";
    }
  }, [overview?.kpis.driftBand]);

  const customerDirectory = useMemo(
    () => overview?.directory.customers ?? [],
    [overview?.directory.customers],
  );
  const serviceTypeDirectory = useMemo(
    () => overview?.directory.serviceTypes ?? [],
    [overview?.directory.serviceTypes],
  );

  const customerDirectoryById = useMemo(() => {
    const map = new Map<string, CustomerSummary>();
    for (const customer of customerDirectory) {
      map.set(customer.id, customer);
    }
    return map;
  }, [customerDirectory]);

  const rescheduleRequests = useMemo(
    () => rescheduleQueue?.requests ?? [],
    [rescheduleQueue?.requests],
  );
  const rescheduleSelectedSet = useMemo(
    () => new Set(rescheduleSelectedIds),
    [rescheduleSelectedIds],
  );
  const allVisibleRescheduleSelected =
    rescheduleRequests.length > 0 &&
    rescheduleRequests.every((request) => rescheduleSelectedSet.has(request.id));

  useEffect(() => {
    const visibleIds = new Set(rescheduleRequests.map((request) => request.id));
    setRescheduleSelectedIds((current) =>
      current.filter((requestId) => visibleIds.has(requestId)),
    );

    setRescheduleStaffNoteDrafts((current) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [requestId, note] of Object.entries(current)) {
        if (visibleIds.has(requestId)) {
          next[requestId] = note;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });

    setRescheduleAssigneeDrafts((current) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const request of rescheduleRequests) {
        if (Object.prototype.hasOwnProperty.call(current, request.id)) {
          next[request.id] = current[request.id];
        } else {
          changed = true;
          next[request.id] = request.assignedTo ?? "";
        }
      }

      if (!changed && Object.keys(current).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : current;
    });

    setRescheduleSlaDrafts((current) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const request of rescheduleRequests) {
        if (Object.prototype.hasOwnProperty.call(current, request.id)) {
          next[request.id] = current[request.id];
        } else {
          changed = true;
          next[request.id] = toDateTimeLocalFromIso(request.slaDueAt);
        }
      }

      if (!changed && Object.keys(current).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : current;
    });
  }, [rescheduleRequests]);

  const handleSendMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage(null);

    const email = emailInput.trim();
    if (!email) {
      setStatusMessage("Enter an email address first.");
      return;
    }

    setAuthSending(true);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/dashboard/reception`
              : undefined,
        },
      });

      if (error) {
        throw error;
      }

      setStatusMessage("Magic link sent. Check your inbox.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send magic link.";
      setStatusMessage(message);
    } finally {
      setAuthSending(false);
    }
  };

  const handleSignOut = async () => {
    setStatusMessage(null);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
      setStatusMessage("Signed out.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sign out.";
      setStatusMessage(message);
    }
  };

  const saveBusinessProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    setBusinessSaving(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/reception/business", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          businessName: businessName.trim(),
          timezone: businessTimezone.trim() || "UTC",
          twilioPhoneNumber: twilioPhoneNumber.trim() || null,
        }),
      });

      const payload = (await response.json()) as
        | { business: BusinessProfile }
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to save business profile."));
      }

      const updated = (payload as { business: BusinessProfile }).business;

      setOverview((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          business: updated,
        };
      });

      setStatusMessage("Business profile saved.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save business profile.";
      setStatusMessage(message);
    } finally {
      setBusinessSaving(false);
    }
  };

  const handleCustomerSelection = (customerId: string) => {
    setBookingCustomerId(customerId);
    if (!customerId) {
      return;
    }

    const customer = customerDirectoryById.get(customerId);
    if (!customer) {
      return;
    }

    setBookingCustomerName(customer.full_name ?? "");
    setBookingCustomerPhone(customer.phone_e164);
    setBookingCustomerEmail(customer.email ?? "");
  };

  const createBooking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    const startDate = new Date(bookingStartLocal);
    if (Number.isNaN(startDate.getTime())) {
      setStatusMessage("Please provide a valid booking start date/time.");
      return;
    }

    const parsedDuration = Number.parseInt(bookingDurationMinutes, 10);
    if (!Number.isFinite(parsedDuration) || parsedDuration < 15 || parsedDuration > 720) {
      setStatusMessage("Duration must be between 15 and 720 minutes.");
      return;
    }

    setBookingCreating(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/reception/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          customerId: bookingCustomerId || null,
          customerName: bookingCustomerName.trim() || null,
          customerPhone: bookingCustomerPhone.trim() || null,
          customerEmail: bookingCustomerEmail.trim() || null,
          serviceTypeId: bookingServiceTypeId || null,
          serviceTypeName: bookingServiceTypeName.trim() || null,
          scheduledStart: startDate.toISOString(),
          durationMinutes: parsedDuration,
          status: bookingStatus,
          notes: bookingNotes.trim() || null,
        }),
      });

      const payload = (await response.json()) as
        | { booking: { id: string } }
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to create booking."));
      }

      setBookingNotes("");
      setBookingServiceTypeName("");
      setBookingStartLocal(getDefaultBookingStartLocal());
      setBookingStatus("pending");
      setStatusMessage("Booking created.");
      await loadOverview();
      await loadReminderStatus();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create booking.";
      setStatusMessage(message);
    } finally {
      setBookingCreating(false);
    }
  };

  const runReminderSweepNow = async (dryRun = false) => {
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    setReminderRunLoading(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/reception/reminders/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          dryRun,
        }),
      });

      const payload = (await response.json()) as
        | {
            totals: {
              seeded: number;
              due: number;
              sent: number;
              skipped: number;
              errored: number;
            };
          }
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to run reminder sweep."));
      }

      const totals = (payload as { totals: { seeded: number; due: number; sent: number; skipped: number; errored: number } }).totals;
      setStatusMessage(
        `${dryRun ? "Dry run" : "Reminder sweep"} complete: seeded=${totals.seeded}, due=${totals.due}, sent=${totals.sent}, skipped=${totals.skipped}, errored=${totals.errored}.`,
      );
      await loadReminderStatus();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to run reminder sweep.";
      setStatusMessage(message);
    } finally {
      setReminderRunLoading(false);
    }
  };

  const patchRescheduleRequest = useCallback(
    async (requestId: string, input: ReschedulePatchPayload) => {
      if (!authToken) {
        throw new Error("Sign in first.");
      }

      const payloadBody: Record<string, string | null> = {};

      if (input.status !== undefined) {
        payloadBody.status = input.status;
      }

      if (input.note !== undefined) {
        payloadBody.note = input.note?.trim() ?? "";
      }

      if (input.assignee !== undefined) {
        payloadBody.assignee = input.assignee?.trim() ?? null;
      }

      if (input.slaDueAt !== undefined) {
        payloadBody.slaDueAt = input.slaDueAt;
      }

      const response = await fetch(`/api/reception/reschedule-requests/${requestId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payloadBody),
      });

      const payload = (await response.json()) as
        | { request: { id: string; status: string } }
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to update reschedule request."));
      }

      return (payload as { request: { status: string } }).request.status;
    },
    [authToken],
  );

  const updateRescheduleRequestStatus = async (
    requestId: string,
    status: ReschedulePatchStatus,
    note?: string | null,
  ) => {
    setRescheduleActionLoading(requestId);
    setStatusMessage(null);
    try {
      const updatedStatus = await patchRescheduleRequest(requestId, {
        status,
        note,
      });
      setRescheduleSelectedIds((current) => current.filter((id) => id !== requestId));
      if (note !== undefined) {
        setRescheduleStaffNoteDrafts((current) => ({
          ...current,
          [requestId]: note ?? "",
        }));
      }
      setStatusMessage(`Reschedule request updated: ${updatedStatus}.`);
      await loadRescheduleQueue();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update reschedule request.";
      setStatusMessage(message);
    } finally {
      setRescheduleActionLoading(null);
    }
  };

  const saveRescheduleOwnership = async (requestId: string) => {
    const assigneeDraft = rescheduleAssigneeDrafts[requestId] ?? "";
    const slaDraft = rescheduleSlaDrafts[requestId] ?? "";
    const parsedSla = slaDraft ? parseDatetimeLocalToIso(slaDraft) : null;

    if (slaDraft && !parsedSla) {
      setStatusMessage("Invalid SLA date/time format.");
      return;
    }

    setRescheduleActionLoading(requestId);
    setStatusMessage(null);
    try {
      await patchRescheduleRequest(requestId, {
        assignee: assigneeDraft.trim() || null,
        slaDueAt: parsedSla,
      });
      setStatusMessage("Ownership/SLA updated.");
      await loadRescheduleQueue();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update ownership/SLA.";
      setStatusMessage(message);
    } finally {
      setRescheduleActionLoading(null);
    }
  };

  const toggleRescheduleSelection = (requestId: string) => {
    setRescheduleSelectedIds((current) =>
      current.includes(requestId)
        ? current.filter((id) => id !== requestId)
        : [...current, requestId],
    );
  };

  const toggleSelectAllVisibleReschedules = () => {
    if (allVisibleRescheduleSelected) {
      setRescheduleSelectedIds([]);
      return;
    }
    setRescheduleSelectedIds(rescheduleRequests.map((request) => request.id));
  };

  const runBulkRescheduleStatusUpdate = async (status: ReschedulePatchStatus) => {
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    const targets = Array.from(new Set(rescheduleSelectedIds));
    if (targets.length === 0) {
      setStatusMessage("Select at least one reschedule request.");
      return;
    }

    setRescheduleBulkLoading(true);
    setStatusMessage(null);

    const normalizedBulkNote = rescheduleBulkNote.trim() || undefined;
    let success = 0;
    let failed = 0;

    try {
      for (const requestId of targets) {
        try {
          await patchRescheduleRequest(requestId, {
            status,
            note: normalizedBulkNote,
          });
          success += 1;
        } catch {
          failed += 1;
        }
      }

      setRescheduleSelectedIds([]);
      setStatusMessage(
        `Bulk update complete (${status}): success=${success}, failed=${failed}.`,
      );
      await loadRescheduleQueue();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to run bulk status update.";
      setStatusMessage(message);
    } finally {
      setRescheduleBulkLoading(false);
    }
  };

  const runRescheduleEscalationSweep = async (dryRun = false) => {
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    setRescheduleEscalationLoading(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/reception/reschedule-requests/escalate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          dryRun,
          maxRows: 150,
        }),
      });

      const payload = (await response.json()) as
        | {
            totals: {
              checked: number;
              overdue: number;
              escalated: number;
              autoHandoff: number;
              errors: number;
              maxLevelReached: number;
            };
          }
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to run escalation sweep."));
      }

      const totals = (
        payload as {
          totals: {
            checked: number;
            overdue: number;
            escalated: number;
            autoHandoff: number;
            errors: number;
            maxLevelReached: number;
          };
        }
      ).totals;

      setStatusMessage(
        `${dryRun ? "Escalation dry run" : "Escalation sweep"} complete: checked=${totals.checked}, overdue=${totals.overdue}, escalated=${totals.escalated}, autoHandoff=${totals.autoHandoff}, errors=${totals.errors}, maxLevel=${totals.maxLevelReached}.`,
      );
      await loadRescheduleQueue();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to run escalation sweep.";
      setStatusMessage(message);
    } finally {
      setRescheduleEscalationLoading(false);
    }
  };

  const updateLeadStatus = async (leadId: string) => {
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    const nextStatus = leadStatusDrafts[leadId];
    if (!nextStatus) {
      return;
    }

    setUpdatingLeadId(leadId);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/reception/leads/${leadId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          status: nextStatus,
        }),
      });

      const payload = (await response.json()) as
        | { lead: Pick<ReceptionLead, "id" | "status" | "lastActivityAt"> }
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to update lead status."));
      }

      const updated = (payload as { lead: { id: string; status: LeadStatus; lastActivityAt: string } })
        .lead;

      setOverview((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          leads: current.leads.map((lead) =>
            lead.id === updated.id
              ? {
                  ...lead,
                  status: updated.status,
                  lastActivityAt: updated.lastActivityAt,
                }
              : lead,
          ),
        };
      });

      setStatusMessage("Lead status updated.");
      void loadOverview();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update lead status.";
      setStatusMessage(message);
    } finally {
      setUpdatingLeadId(null);
    }
  };

  const updateBookingStatus = async (bookingId: string) => {
    if (!authToken) {
      setStatusMessage("Sign in first.");
      return;
    }

    const nextStatus = bookingStatusDrafts[bookingId];
    if (!nextStatus) {
      return;
    }

    setUpdatingBookingId(bookingId);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/reception/bookings/${bookingId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          status: nextStatus,
        }),
      });

      const payload = (await response.json()) as
        | { booking: Pick<ReceptionBooking, "id" | "status"> }
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to update booking status."));
      }

      const updated = (payload as { booking: { id: string; status: BookingStatus } }).booking;

      setOverview((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          bookings: current.bookings.map((booking) =>
            booking.id === updated.id
              ? {
                  ...booking,
                  status: updated.status,
                }
              : booking,
          ),
        };
      });

      setStatusMessage("Booking status updated.");
      void loadOverview();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update booking status.";
      setStatusMessage(message);
    } finally {
      setUpdatingBookingId(null);
    }
  };

  if (authLoading) {
    return <p className="text-sm text-zinc-600">Loading authentication...</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Authentication</h2>
            <p className="text-sm text-zinc-600">
              Sign in with Supabase magic link to manage your receptionist workspace.
            </p>
          </div>
          {userEmail && (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold"
            >
              Sign out
            </button>
          )}
        </div>

        {authError && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {authError}
          </p>
        )}

        {authToken ? (
          <p className="mt-3 text-sm text-zinc-700">Signed in as {userEmail ?? "unknown"}</p>
        ) : (
          <form onSubmit={handleSendMagicLink} className="mt-3 flex flex-wrap gap-2">
            <input
              type="email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              required
              placeholder="you@example.com"
              className="min-w-[240px] flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={authSending}
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              {authSending ? "Sending..." : "Send magic link"}
            </button>
          </form>
        )}

        {statusMessage && (
          <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            {statusMessage}
          </p>
        )}
      </section>

      {authToken && (
        <>
          <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Business profile</h2>
                <p className="text-sm text-zinc-600">
                  Save the business identity used by Twilio webhook workflows.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadOverview()}
                disabled={overviewLoading}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {overviewLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <form onSubmit={saveBusinessProfile} className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Business name</span>
                <input
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  required
                  placeholder="North Clean Co"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Timezone</span>
                <input
                  value={businessTimezone}
                  onChange={(event) => setBusinessTimezone(event.target.value)}
                  placeholder="America/New_York"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Twilio phone number</span>
                <input
                  value={twilioPhoneNumber}
                  onChange={(event) => setTwilioPhoneNumber(event.target.value)}
                  placeholder="+15551234567"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>

              <div className="md:col-span-3 flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={businessSaving}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {businessSaving ? "Saving..." : "Save business profile"}
                </button>
                <p className="text-xs text-zinc-600 self-center">
                  Last synced: {formatDate(overview?.business?.updated_at)}
                </p>
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold">Reception KPIs</h2>
            <p className="text-sm text-zinc-600">Snapshot from the latest receptionist events.</p>

            <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
              <div className="rounded-lg border border-zinc-200 p-3">Leads today: {overview?.kpis.leadsToday ?? 0}</div>
              <div className="rounded-lg border border-zinc-200 p-3">Open leads: {(overview?.kpis.leadsNew ?? 0) + (overview?.kpis.leadsQualified ?? 0)}</div>
              <div className="rounded-lg border border-zinc-200 p-3">Booked leads: {overview?.kpis.leadsBooked ?? 0}</div>
              <div className="rounded-lg border border-zinc-200 p-3">Bookings next 7 days: {overview?.kpis.upcomingBookings7d ?? 0}</div>
              <div className="rounded-lg border border-zinc-200 p-3">Open conversations: {overview?.kpis.openConversations ?? 0}</div>
              <div className="rounded-lg border border-zinc-200 p-3">Handoff conversations: {overview?.kpis.handoffConversations ?? 0}</div>
              <div className="rounded-lg border border-zinc-200 p-3">AI runs (24h): {overview?.kpis.aiRuns24h ?? 0}</div>
              <div className="rounded-lg border border-zinc-200 p-3">Handoff rate (24h): {formatPercent(overview?.kpis.handoffRate24h)}</div>
            </div>

            <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${selectedDriftColor}`}>
              Drift band: {renderDriftBandLabel(overview?.kpis.driftBand ?? "no_signal")}
              <span className="ml-2 text-xs">
                avg drift 24h: {overview?.kpis.avgDrift24h ?? "-"} | stable target ~ {overview?.driftThresholds.stableTarget ?? "-"} | breach {'>'} {overview?.driftThresholds.breachLimit ?? "-"}
              </span>
            </div>
          </section>

          <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Reminder scheduler</h2>
                <p className="text-sm text-zinc-600">
                  Run booking reminder sweeps and inspect latest reminder outcomes.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void runReminderSweepNow(true)}
                  disabled={reminderRunLoading}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {reminderRunLoading ? "Running..." : "Dry run"}
                </button>
                <button
                  type="button"
                  onClick={() => void runReminderSweepNow(false)}
                  disabled={reminderRunLoading}
                  className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {reminderRunLoading ? "Running..." : "Run now"}
                </button>
                <button
                  type="button"
                  onClick={() => void loadReminderStatus()}
                  disabled={reminderStatusLoading}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {reminderStatusLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-2 text-sm md:grid-cols-5">
              <div className="rounded-lg border border-zinc-200 p-3">
                Due pending: {reminderStatus?.duePending ?? 0}
              </div>
              <div className="rounded-lg border border-zinc-200 p-3">
                Sent (sample): {reminderStatus?.counts.sent ?? 0}
              </div>
              <div className="rounded-lg border border-zinc-200 p-3">
                Pending (sample): {reminderStatus?.counts.pending ?? 0}
              </div>
              <div className="rounded-lg border border-zinc-200 p-3">
                Skipped (sample): {reminderStatus?.counts.skipped ?? 0}
              </div>
              <div className="rounded-lg border border-zinc-200 p-3">
                Errors (sample): {reminderStatus?.counts.error ?? 0}
              </div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-left">
                    <th className="px-2 py-2 font-semibold">Type</th>
                    <th className="px-2 py-2 font-semibold">Scheduled for</th>
                    <th className="px-2 py-2 font-semibold">Customer</th>
                    <th className="px-2 py-2 font-semibold">Service</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {(reminderStatus?.reminders ?? []).length === 0 ? (
                    <tr>
                      <td className="px-2 py-3 text-zinc-500" colSpan={6}>
                        No reminders logged yet.
                      </td>
                    </tr>
                  ) : (
                    reminderStatus?.reminders.map((reminder) => (
                      <tr key={reminder.id} className="border-b border-zinc-100">
                        <td className="px-2 py-2">{reminder.reminderType}</td>
                        <td className="px-2 py-2">{formatDate(reminder.scheduledFor)}</td>
                        <td className="px-2 py-2">
                          <div>{reminder.customer?.full_name ?? "Unknown"}</div>
                          <div className="text-zinc-500">
                            {reminder.customer?.phone_e164 ?? "-"}
                          </div>
                        </td>
                        <td className="px-2 py-2">{reminder.serviceType?.name ?? "-"}</td>
                        <td className="px-2 py-2">{reminder.status}</td>
                        <td className="px-2 py-2 text-rose-600">
                          {reminder.errorMessage ?? "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Reschedule queue</h2>
                <p className="text-sm text-zinc-600">
                  Review manual follow-ups from SMS reschedule flows.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runRescheduleEscalationSweep(true)}
                  disabled={rescheduleEscalationLoading}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  {rescheduleEscalationLoading ? "Running..." : "Escalation dry run"}
                </button>
                <button
                  type="button"
                  onClick={() => void runRescheduleEscalationSweep(false)}
                  disabled={rescheduleEscalationLoading}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  {rescheduleEscalationLoading ? "Running..." : "Run escalation"}
                </button>
                <label className="text-xs text-zinc-600">
                  <span className="mr-1">Filter</span>
                  <select
                    value={rescheduleStatusFilter}
                    onChange={(event) =>
                      setRescheduleStatusFilter(
                        event.target.value as RescheduleQueueFilter,
                      )
                    }
                    className="rounded border border-zinc-300 px-2 py-1"
                  >
                    {RESCHEDULE_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void loadRescheduleQueue()}
                  disabled={rescheduleQueueLoading}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {rescheduleQueueLoading ? "Refreshing..." : "Refresh queue"}
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-2 text-sm md:grid-cols-8">
              <div className="rounded-lg border border-zinc-200 p-3">
                Action required: {rescheduleQueue?.actionRequired ?? 0}
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-700">
                Overdue: {rescheduleQueue?.overdueActionRequired ?? 0}
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-700">
                Escalated: {rescheduleQueue?.escalatedActionRequired ?? 0}
              </div>
              <div className="rounded-lg border border-zinc-200 p-3">
                Pending: {rescheduleQueue?.counts.pending ?? 0}
              </div>
              <div className="rounded-lg border border-zinc-200 p-3">
                Options sent: {rescheduleQueue?.counts.options_sent ?? 0}
              </div>
              <div className="rounded-lg border border-zinc-200 p-3">
                Handoff: {rescheduleQueue?.counts.handoff ?? 0}
              </div>
              <div className="rounded-lg border border-zinc-200 p-3">
                Confirmed: {rescheduleQueue?.counts.confirmed ?? 0}
              </div>
              <div className="rounded-lg border border-zinc-200 p-3">
                Closed: {rescheduleQueue?.counts.closed ?? 0}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-3 text-xs">
              <button
                type="button"
                onClick={toggleSelectAllVisibleReschedules}
                disabled={rescheduleRequests.length === 0}
                className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
              >
                {allVisibleRescheduleSelected
                  ? "Clear visible selection"
                  : "Select visible"}
              </button>
              <span className="text-zinc-600">
                Selected: {rescheduleSelectedIds.length}
              </span>
              <input
                value={rescheduleBulkNote}
                onChange={(event) => setRescheduleBulkNote(event.target.value)}
                placeholder="Bulk staff note (optional)"
                className="min-w-[200px] rounded border border-zinc-300 px-2 py-1"
              />
              <button
                type="button"
                onClick={() => void runBulkRescheduleStatusUpdate("options_sent")}
                disabled={rescheduleBulkLoading || rescheduleSelectedIds.length === 0}
                className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
              >
                {rescheduleBulkLoading ? "Running..." : "Bulk options sent"}
              </button>
              <button
                type="button"
                onClick={() => void runBulkRescheduleStatusUpdate("handoff")}
                disabled={rescheduleBulkLoading || rescheduleSelectedIds.length === 0}
                className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
              >
                {rescheduleBulkLoading ? "Running..." : "Bulk handoff"}
              </button>
              <button
                type="button"
                onClick={() => void runBulkRescheduleStatusUpdate("closed")}
                disabled={rescheduleBulkLoading || rescheduleSelectedIds.length === 0}
                className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
              >
                {rescheduleBulkLoading ? "Running..." : "Bulk close"}
              </button>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-left">
                    <th className="px-2 py-2 font-semibold">
                      <input
                        type="checkbox"
                        checked={allVisibleRescheduleSelected}
                        onChange={toggleSelectAllVisibleReschedules}
                        disabled={rescheduleRequests.length === 0}
                      />
                    </th>
                    <th className="px-2 py-2 font-semibold">Requested</th>
                    <th className="px-2 py-2 font-semibold">Customer</th>
                    <th className="px-2 py-2 font-semibold">Booking</th>
                    <th className="px-2 py-2 font-semibold">Service</th>
                    <th className="px-2 py-2 font-semibold">Latest message</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Owner / SLA</th>
                    <th className="px-2 py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rescheduleRequests.length === 0 ? (
                    <tr>
                      <td className="px-2 py-3 text-zinc-500" colSpan={9}>
                        No reschedule requests yet.
                      </td>
                    </tr>
                  ) : (
                    rescheduleRequests.map((request) => {
                      const isSelected = rescheduleSelectedSet.has(request.id);
                      const isRowBusy =
                        rescheduleActionLoading === request.id || rescheduleBulkLoading;
                      const draftNote = rescheduleStaffNoteDrafts[request.id] ?? "";
                      const draftAssignee = rescheduleAssigneeDrafts[request.id] ?? "";
                      const draftSla = rescheduleSlaDrafts[request.id] ?? "";
                      const overdueLabel = formatOverdueLabel(request.overdueMinutes);
                      return (
                        <tr key={request.id} className="border-b border-zinc-100 align-top">
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRescheduleSelection(request.id)}
                              disabled={rescheduleBulkLoading}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div>{formatDate(request.requestedAt)}</div>
                            <div className="text-zinc-500">batch {request.optionBatch}</div>
                          </td>
                          <td className="px-2 py-2">
                            <div>{request.customer?.full_name ?? "Unknown"}</div>
                            <div className="text-zinc-500">
                              {request.customer?.phone_e164 ?? "-"}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div>{formatDate(request.booking?.scheduledStart ?? null)}</div>
                            <div className="text-zinc-500">
                              {request.booking?.status ?? "booking missing"}
                            </div>
                            {request.selectedStart && (
                              <div className="text-emerald-700">
                                Selected: {formatDate(request.selectedStart)}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2">{request.serviceType?.name ?? "-"}</td>
                          <td className="max-w-xs px-2 py-2 text-zinc-700">
                            {formatShortText(request.latestCustomerMessage)}
                          </td>
                          <td className="px-2 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${rescheduleStatusTone(request.status)}`}
                            >
                              {renderRescheduleStatusLabel(request.status)}
                            </span>
                            {request.isOverdue && (
                              <div className="mt-1 text-[11px] font-semibold text-rose-700">
                                {overdueLabel}
                              </div>
                            )}
                            {request.escalationLevel > 0 && (
                              <div className="mt-1 text-[11px] font-semibold text-amber-700">
                                L{request.escalationLevel} escalation
                              </div>
                            )}
                            {!request.isOverdue && request.slaDueAt && (
                              <div className="mt-1 text-[11px] text-zinc-500">
                                due {formatDate(request.slaDueAt)}
                              </div>
                            )}
                            {request.lastEscalatedAt && (
                              <div className="mt-1 text-[11px] text-zinc-500">
                                escalated {formatDate(request.lastEscalatedAt)}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex min-w-[220px] flex-col gap-1">
                              <input
                                value={draftAssignee}
                                onChange={(event) =>
                                  setRescheduleAssigneeDrafts((current) => ({
                                    ...current,
                                    [request.id]: event.target.value,
                                  }))
                                }
                                placeholder="Assignee"
                                className="rounded border border-zinc-300 px-2 py-1"
                                disabled={isRowBusy}
                              />
                              <div className="flex gap-1">
                                <input
                                  type="datetime-local"
                                  value={draftSla}
                                  onChange={(event) =>
                                    setRescheduleSlaDrafts((current) => ({
                                      ...current,
                                      [request.id]: event.target.value,
                                    }))
                                  }
                                  className="flex-1 rounded border border-zinc-300 px-2 py-1"
                                  disabled={isRowBusy}
                                />
                                <button
                                  type="button"
                                  onClick={() => void saveRescheduleOwnership(request.id)}
                                  disabled={isRowBusy}
                                  className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
                                >
                                  Save
                                </button>
                              </div>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRescheduleSlaDrafts((current) => ({
                                      ...current,
                                      [request.id]: toDateTimeLocalValue(
                                        new Date(Date.now() + 30 * 60 * 1000),
                                      ),
                                    }))
                                  }
                                  disabled={isRowBusy}
                                  className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
                                >
                                  +30m
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRescheduleSlaDrafts((current) => ({
                                      ...current,
                                      [request.id]: toDateTimeLocalValue(
                                        new Date(Date.now() + 60 * 60 * 1000),
                                      ),
                                    }))
                                  }
                                  disabled={isRowBusy}
                                  className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
                                >
                                  +1h
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRescheduleSlaDrafts((current) => ({
                                      ...current,
                                      [request.id]: "",
                                    }))
                                  }
                                  disabled={isRowBusy}
                                  className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
                                >
                                  Clear
                                </button>
                              </div>
                              {request.assignedAt && (
                                <div className="text-[11px] text-zinc-500">
                                  updated {formatDate(request.assignedAt)}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-col gap-1">
                              <input
                                value={draftNote}
                                onChange={(event) =>
                                  setRescheduleStaffNoteDrafts((current) => ({
                                    ...current,
                                    [request.id]: event.target.value,
                                  }))
                                }
                                placeholder="Staff note (optional)"
                                className="rounded border border-zinc-300 px-2 py-1"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  void updateRescheduleRequestStatus(
                                    request.id,
                                    "options_sent",
                                    draftNote,
                                  )
                                }
                                disabled={
                                  isRowBusy ||
                                  request.status === "options_sent" ||
                                  request.status === "confirmed" ||
                                  request.status === "closed"
                                }
                                className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
                              >
                                Mark options sent
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void updateRescheduleRequestStatus(
                                    request.id,
                                    "handoff",
                                    draftNote,
                                  )
                                }
                                disabled={
                                  isRowBusy ||
                                  request.status === "handoff" ||
                                  request.status === "confirmed" ||
                                  request.status === "closed"
                                }
                                className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
                              >
                                Mark handoff
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void updateRescheduleRequestStatus(
                                    request.id,
                                    "closed",
                                    draftNote,
                                  )
                                }
                                disabled={isRowBusy || request.status === "closed"}
                                className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
                              >
                                {rescheduleActionLoading === request.id
                                  ? "Saving..."
                                  : "Close request"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Lead pipeline</h2>
                <p className="text-sm text-zinc-600">Track inbound leads and quickly move stages.</p>
              </div>
              <button
                type="button"
                onClick={() => void loadOverview()}
                disabled={overviewLoading}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {overviewLoading ? "Refreshing..." : "Refresh leads"}
              </button>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-left">
                    <th className="px-2 py-2 font-semibold">Customer</th>
                    <th className="px-2 py-2 font-semibold">Source</th>
                    <th className="px-2 py-2 font-semibold">Summary</th>
                    <th className="px-2 py-2 font-semibold">Value</th>
                    <th className="px-2 py-2 font-semibold">Last activity</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(overview?.leads ?? []).length === 0 ? (
                    <tr>
                      <td className="px-2 py-3 text-zinc-500" colSpan={7}>
                        No leads yet. Trigger Twilio inbound voice/SMS to populate this list.
                      </td>
                    </tr>
                  ) : (
                    overview?.leads.map((lead) => (
                      <tr key={lead.id} className="border-b border-zinc-100">
                        <td className="px-2 py-2">
                          <div>{lead.customer?.full_name ?? "Unknown"}</div>
                          <div className="text-zinc-500">{lead.customer?.phone_e164 ?? "-"}</div>
                        </td>
                        <td className="px-2 py-2 uppercase">{lead.source}</td>
                        <td className="px-2 py-2 max-w-xs">{lead.summary ?? "-"}</td>
                        <td className="px-2 py-2">{formatCurrency(lead.estimatedValue)}</td>
                        <td className="px-2 py-2">{formatDate(lead.lastActivityAt)}</td>
                        <td className="px-2 py-2">
                          <select
                            value={leadStatusDrafts[lead.id] ?? lead.status}
                            onChange={(event) =>
                              setLeadStatusDrafts((current) => ({
                                ...current,
                                [lead.id]: event.target.value as LeadStatus,
                              }))
                            }
                            className="rounded border border-zinc-300 px-2 py-1"
                          >
                            <option value="new">new</option>
                            <option value="qualified">qualified</option>
                            <option value="booked">booked</option>
                            <option value="lost">lost</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => void updateLeadStatus(lead.id)}
                            disabled={updatingLeadId === lead.id}
                            className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
                          >
                            {updatingLeadId === lead.id ? "Saving..." : "Save"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold">Create booking</h2>
            <p className="text-sm text-zinc-600">
              Manually add jobs from phone calls, texts, or direct requests.
            </p>

            <form onSubmit={createBooking} className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Existing customer</span>
                <select
                  value={bookingCustomerId}
                  onChange={(event) => handleCustomerSelection(event.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                >
                  <option value="">Create or use typed customer below</option>
                  {customerDirectory.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {buildCustomerLabel(customer)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Customer name</span>
                <input
                  value={bookingCustomerName}
                  onChange={(event) => setBookingCustomerName(event.target.value)}
                  placeholder="Jane Smith"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Customer phone</span>
                <input
                  value={bookingCustomerPhone}
                  onChange={(event) => setBookingCustomerPhone(event.target.value)}
                  placeholder="+15551234567"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>

              <label className="space-y-1 text-sm">
                <span className="font-medium">Customer email</span>
                <input
                  value={bookingCustomerEmail}
                  onChange={(event) => setBookingCustomerEmail(event.target.value)}
                  placeholder="jane@example.com"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Service type</span>
                <select
                  value={bookingServiceTypeId}
                  onChange={(event) => setBookingServiceTypeId(event.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                >
                  <option value="">Use custom name below</option>
                  {serviceTypeDirectory.map((serviceType) => (
                    <option key={serviceType.id} value={serviceType.id}>
                      {serviceType.name} ({serviceType.default_duration_minutes}m)
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Custom service name</span>
                <input
                  value={bookingServiceTypeName}
                  onChange={(event) => setBookingServiceTypeName(event.target.value)}
                  placeholder="Deep clean"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>

              <label className="space-y-1 text-sm">
                <span className="font-medium">Start date/time</span>
                <input
                  type="datetime-local"
                  value={bookingStartLocal}
                  onChange={(event) => setBookingStartLocal(event.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                  required
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Duration (minutes)</span>
                <input
                  type="number"
                  min={15}
                  max={720}
                  value={bookingDurationMinutes}
                  onChange={(event) => setBookingDurationMinutes(event.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Status</span>
                <select
                  value={bookingStatus}
                  onChange={(event) => setBookingStatus(event.target.value as BookingStatus)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                >
                  <option value="pending">pending</option>
                  <option value="confirmed">confirmed</option>
                  <option value="rescheduled">rescheduled</option>
                  <option value="completed">completed</option>
                  <option value="cancelled">cancelled</option>
                </select>
              </label>

              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-medium">Notes</span>
                <textarea
                  value={bookingNotes}
                  onChange={(event) => setBookingNotes(event.target.value)}
                  placeholder="Gate code, parking details, priority notes..."
                  className="min-h-20 w-full rounded-lg border border-zinc-300 px-3 py-2"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={bookingCreating}
                  className="w-full rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {bookingCreating ? "Creating..." : "Create booking"}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Upcoming bookings</h2>
                <p className="text-sm text-zinc-600">Near-term schedule and status controls.</p>
              </div>
              <button
                type="button"
                onClick={() => void loadOverview()}
                disabled={overviewLoading}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {overviewLoading ? "Refreshing..." : "Refresh bookings"}
              </button>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-left">
                    <th className="px-2 py-2 font-semibold">Start</th>
                    <th className="px-2 py-2 font-semibold">Customer</th>
                    <th className="px-2 py-2 font-semibold">Service</th>
                    <th className="px-2 py-2 font-semibold">Notes</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(overview?.bookings ?? []).length === 0 ? (
                    <tr>
                      <td className="px-2 py-3 text-zinc-500" colSpan={6}>
                        No upcoming bookings yet.
                      </td>
                    </tr>
                  ) : (
                    overview?.bookings.map((booking) => (
                      <tr key={booking.id} className="border-b border-zinc-100">
                        <td className="px-2 py-2">{formatDate(booking.scheduledStart)}</td>
                        <td className="px-2 py-2">
                          <div>{booking.customer?.full_name ?? "Unknown"}</div>
                          <div className="text-zinc-500">{booking.customer?.phone_e164 ?? "-"}</div>
                        </td>
                        <td className="px-2 py-2">{booking.serviceType?.name ?? "-"}</td>
                        <td className="px-2 py-2 max-w-xs">{booking.notes ?? "-"}</td>
                        <td className="px-2 py-2">
                          <select
                            value={bookingStatusDrafts[booking.id] ?? booking.status}
                            onChange={(event) =>
                              setBookingStatusDrafts((current) => ({
                                ...current,
                                [booking.id]: event.target.value as BookingStatus,
                              }))
                            }
                            className="rounded border border-zinc-300 px-2 py-1"
                          >
                            <option value="pending">pending</option>
                            <option value="confirmed">confirmed</option>
                            <option value="rescheduled">rescheduled</option>
                            <option value="completed">completed</option>
                            <option value="cancelled">cancelled</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => void updateBookingStatus(booking.id)}
                            disabled={updatingBookingId === booking.id}
                            className="rounded border border-zinc-300 px-2 py-1 font-semibold disabled:opacity-50"
                          >
                            {updatingBookingId === booking.id ? "Saving..." : "Save"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {statusMessage && (
        <section className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {statusMessage}
        </section>
      )}
    </div>
  );
}

