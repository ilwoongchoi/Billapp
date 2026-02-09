-- Reschedule request queue for receptionist handoff + approval workflows.

create table if not exists public.service_reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid not null unique references public.service_bookings(id) on delete cascade,
  customer_id uuid references public.service_customers(id) on delete set null,
  lead_id uuid references public.service_leads(id) on delete set null,
  conversation_id uuid references public.service_conversations(id) on delete set null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  latest_customer_message text,
  option_batch int not null default 0 check (option_batch >= 0),
  selected_option_index int check (selected_option_index is null or selected_option_index between 1 and 9),
  selected_start timestamptz,
  selected_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_service_reschedule_requests_status
    check (status in ('pending', 'options_sent', 'confirmed', 'handoff', 'closed'))
);

create index if not exists idx_service_reschedule_requests_user_status_requested
  on public.service_reschedule_requests(user_id, status, requested_at desc);
create index if not exists idx_service_reschedule_requests_booking
  on public.service_reschedule_requests(booking_id);
create index if not exists idx_service_reschedule_requests_resolved
  on public.service_reschedule_requests(resolved_at desc);

alter table public.service_reschedule_requests enable row level security;

drop policy if exists "service_reschedule_requests_select_own" on public.service_reschedule_requests;
create policy "service_reschedule_requests_select_own"
  on public.service_reschedule_requests for select
  using (auth.uid() = user_id);

drop policy if exists "service_reschedule_requests_insert_own" on public.service_reschedule_requests;
create policy "service_reschedule_requests_insert_own"
  on public.service_reschedule_requests for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_reschedule_requests_update_own" on public.service_reschedule_requests;
create policy "service_reschedule_requests_update_own"
  on public.service_reschedule_requests for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_reschedule_requests_delete_own" on public.service_reschedule_requests;
create policy "service_reschedule_requests_delete_own"
  on public.service_reschedule_requests for delete
  using (auth.uid() = user_id);
