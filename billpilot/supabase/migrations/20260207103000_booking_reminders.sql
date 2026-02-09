-- Booking reminder scheduler storage for AI Receptionist.

create table if not exists public.service_booking_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid not null references public.service_bookings(id) on delete cascade,
  reminder_type text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending',
  sent_at timestamptz,
  twilio_message_sid text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_service_booking_reminders_booking_type unique (booking_id, reminder_type),
  constraint chk_service_booking_reminders_type check (reminder_type in ('24h', '2h')),
  constraint chk_service_booking_reminders_status check (status in ('pending', 'sent', 'skipped', 'error'))
);

create index if not exists idx_service_booking_reminders_user_due
  on public.service_booking_reminders(user_id, status, scheduled_for asc);
create index if not exists idx_service_booking_reminders_booking
  on public.service_booking_reminders(booking_id);
create index if not exists idx_service_booking_reminders_status
  on public.service_booking_reminders(status, scheduled_for asc);

alter table public.service_booking_reminders enable row level security;

drop policy if exists "service_booking_reminders_select_own" on public.service_booking_reminders;
create policy "service_booking_reminders_select_own"
  on public.service_booking_reminders for select
  using (auth.uid() = user_id);

drop policy if exists "service_booking_reminders_insert_own" on public.service_booking_reminders;
create policy "service_booking_reminders_insert_own"
  on public.service_booking_reminders for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_booking_reminders_update_own" on public.service_booking_reminders;
create policy "service_booking_reminders_update_own"
  on public.service_booking_reminders for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_booking_reminders_delete_own" on public.service_booking_reminders;
create policy "service_booking_reminders_delete_own"
  on public.service_booking_reminders for delete
  using (auth.uid() = user_id);
