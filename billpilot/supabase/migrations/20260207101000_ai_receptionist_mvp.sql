-- AI Receptionist MVP schema for local-service businesses.

create table if not exists public.service_businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  business_name text not null,
  timezone text not null default 'UTC',
  twilio_phone_number text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text,
  phone_e164 text not null,
  email text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_service_customers_user_phone unique (user_id, phone_e164)
);

create table if not exists public.service_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  default_duration_minutes int not null default 60 check (default_duration_minutes > 0),
  base_price numeric(12,2) check (base_price is null or base_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_service_types_user_name unique (user_id, name)
);

create table if not exists public.service_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid references public.service_customers(id) on delete set null,
  source text not null default 'phone',
  status text not null default 'new',
  summary text,
  estimated_value numeric(12,2) check (estimated_value is null or estimated_value >= 0),
  first_contact_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  twilio_call_sid text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_service_leads_status check (status in ('new', 'qualified', 'booked', 'lost')),
  constraint chk_service_leads_source check (source in ('phone', 'sms', 'web', 'manual'))
);

create table if not exists public.service_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid references public.service_customers(id) on delete set null,
  lead_id uuid references public.service_leads(id) on delete set null,
  channel text not null default 'sms',
  state text not null default 'open',
  last_message_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_service_conversations_channel check (channel in ('sms', 'voice')),
  constraint chk_service_conversations_state check (state in ('open', 'closed', 'handoff'))
);

create table if not exists public.service_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.service_conversations(id) on delete cascade,
  direction text not null,
  sender_type text not null,
  body text not null,
  ai_confidence numeric(4,3) check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  twilio_message_sid text unique,
  created_at timestamptz not null default now(),
  constraint chk_service_messages_direction check (direction in ('inbound', 'outbound')),
  constraint chk_service_messages_sender_type check (sender_type in ('customer', 'ai', 'staff', 'system'))
);

create table if not exists public.service_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid references public.service_customers(id) on delete set null,
  lead_id uuid references public.service_leads(id) on delete set null,
  twilio_call_sid text not null unique,
  from_number text,
  to_number text,
  call_status text,
  answered boolean not null default false,
  duration_seconds int check (duration_seconds is null or duration_seconds >= 0),
  recording_url text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid references public.service_customers(id) on delete set null,
  lead_id uuid references public.service_leads(id) on delete set null,
  service_type_id uuid references public.service_types(id) on delete set null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz,
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_service_bookings_status
    check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'rescheduled')),
  constraint chk_service_bookings_range
    check (scheduled_end is null or scheduled_end >= scheduled_start)
);

create table if not exists public.service_automation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.service_leads(id) on delete set null,
  conversation_id uuid references public.service_conversations(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  success boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.service_ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.service_conversations(id) on delete set null,
  lead_id uuid references public.service_leads(id) on delete set null,
  model text not null,
  input_tokens int check (input_tokens is null or input_tokens >= 0),
  output_tokens int check (output_tokens is null or output_tokens >= 0),
  latency_ms int check (latency_ms is null or latency_ms >= 0),
  estimated_cost numeric(12,6) check (estimated_cost is null or estimated_cost >= 0),
  outcome text not null default 'completed',
  drift_score numeric(10,6),
  created_at timestamptz not null default now(),
  constraint chk_service_ai_runs_outcome check (outcome in ('completed', 'fallback', 'handoff', 'failed'))
);

create index if not exists idx_service_businesses_user_id
  on public.service_businesses(user_id);

create index if not exists idx_service_customers_user_id
  on public.service_customers(user_id);
create index if not exists idx_service_customers_phone
  on public.service_customers(phone_e164);

create index if not exists idx_service_types_user_id
  on public.service_types(user_id);

create index if not exists idx_service_leads_user_status_activity
  on public.service_leads(user_id, status, last_activity_at desc);
create index if not exists idx_service_leads_customer_id
  on public.service_leads(customer_id);

create index if not exists idx_service_conversations_user_customer_state
  on public.service_conversations(user_id, customer_id, state, last_message_at desc);

create index if not exists idx_service_messages_conversation_created
  on public.service_messages(conversation_id, created_at desc);

create index if not exists idx_service_calls_user_created
  on public.service_calls(user_id, created_at desc);

create index if not exists idx_service_bookings_user_start
  on public.service_bookings(user_id, scheduled_start desc);
create index if not exists idx_service_bookings_status
  on public.service_bookings(status);

create index if not exists idx_service_automation_events_user_created
  on public.service_automation_events(user_id, created_at desc);

create index if not exists idx_service_ai_runs_user_created
  on public.service_ai_runs(user_id, created_at desc);
create index if not exists idx_service_ai_runs_outcome
  on public.service_ai_runs(outcome);

alter table public.service_businesses enable row level security;
alter table public.service_customers enable row level security;
alter table public.service_types enable row level security;
alter table public.service_leads enable row level security;
alter table public.service_conversations enable row level security;
alter table public.service_messages enable row level security;
alter table public.service_calls enable row level security;
alter table public.service_bookings enable row level security;
alter table public.service_automation_events enable row level security;
alter table public.service_ai_runs enable row level security;

-- service_businesses

drop policy if exists "service_businesses_select_own" on public.service_businesses;
create policy "service_businesses_select_own"
  on public.service_businesses for select
  using (auth.uid() = user_id);

drop policy if exists "service_businesses_insert_own" on public.service_businesses;
create policy "service_businesses_insert_own"
  on public.service_businesses for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_businesses_update_own" on public.service_businesses;
create policy "service_businesses_update_own"
  on public.service_businesses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_businesses_delete_own" on public.service_businesses;
create policy "service_businesses_delete_own"
  on public.service_businesses for delete
  using (auth.uid() = user_id);

-- service_customers

drop policy if exists "service_customers_select_own" on public.service_customers;
create policy "service_customers_select_own"
  on public.service_customers for select
  using (auth.uid() = user_id);

drop policy if exists "service_customers_insert_own" on public.service_customers;
create policy "service_customers_insert_own"
  on public.service_customers for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_customers_update_own" on public.service_customers;
create policy "service_customers_update_own"
  on public.service_customers for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_customers_delete_own" on public.service_customers;
create policy "service_customers_delete_own"
  on public.service_customers for delete
  using (auth.uid() = user_id);

-- service_types

drop policy if exists "service_types_select_own" on public.service_types;
create policy "service_types_select_own"
  on public.service_types for select
  using (auth.uid() = user_id);

drop policy if exists "service_types_insert_own" on public.service_types;
create policy "service_types_insert_own"
  on public.service_types for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_types_update_own" on public.service_types;
create policy "service_types_update_own"
  on public.service_types for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_types_delete_own" on public.service_types;
create policy "service_types_delete_own"
  on public.service_types for delete
  using (auth.uid() = user_id);

-- service_leads

drop policy if exists "service_leads_select_own" on public.service_leads;
create policy "service_leads_select_own"
  on public.service_leads for select
  using (auth.uid() = user_id);

drop policy if exists "service_leads_insert_own" on public.service_leads;
create policy "service_leads_insert_own"
  on public.service_leads for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_leads_update_own" on public.service_leads;
create policy "service_leads_update_own"
  on public.service_leads for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_leads_delete_own" on public.service_leads;
create policy "service_leads_delete_own"
  on public.service_leads for delete
  using (auth.uid() = user_id);

-- service_conversations

drop policy if exists "service_conversations_select_own" on public.service_conversations;
create policy "service_conversations_select_own"
  on public.service_conversations for select
  using (auth.uid() = user_id);

drop policy if exists "service_conversations_insert_own" on public.service_conversations;
create policy "service_conversations_insert_own"
  on public.service_conversations for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_conversations_update_own" on public.service_conversations;
create policy "service_conversations_update_own"
  on public.service_conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_conversations_delete_own" on public.service_conversations;
create policy "service_conversations_delete_own"
  on public.service_conversations for delete
  using (auth.uid() = user_id);

-- service_messages

drop policy if exists "service_messages_select_own" on public.service_messages;
create policy "service_messages_select_own"
  on public.service_messages for select
  using (auth.uid() = user_id);

drop policy if exists "service_messages_insert_own" on public.service_messages;
create policy "service_messages_insert_own"
  on public.service_messages for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_messages_update_own" on public.service_messages;
create policy "service_messages_update_own"
  on public.service_messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_messages_delete_own" on public.service_messages;
create policy "service_messages_delete_own"
  on public.service_messages for delete
  using (auth.uid() = user_id);

-- service_calls

drop policy if exists "service_calls_select_own" on public.service_calls;
create policy "service_calls_select_own"
  on public.service_calls for select
  using (auth.uid() = user_id);

drop policy if exists "service_calls_insert_own" on public.service_calls;
create policy "service_calls_insert_own"
  on public.service_calls for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_calls_update_own" on public.service_calls;
create policy "service_calls_update_own"
  on public.service_calls for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_calls_delete_own" on public.service_calls;
create policy "service_calls_delete_own"
  on public.service_calls for delete
  using (auth.uid() = user_id);

-- service_bookings

drop policy if exists "service_bookings_select_own" on public.service_bookings;
create policy "service_bookings_select_own"
  on public.service_bookings for select
  using (auth.uid() = user_id);

drop policy if exists "service_bookings_insert_own" on public.service_bookings;
create policy "service_bookings_insert_own"
  on public.service_bookings for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_bookings_update_own" on public.service_bookings;
create policy "service_bookings_update_own"
  on public.service_bookings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_bookings_delete_own" on public.service_bookings;
create policy "service_bookings_delete_own"
  on public.service_bookings for delete
  using (auth.uid() = user_id);

-- service_automation_events

drop policy if exists "service_automation_events_select_own" on public.service_automation_events;
create policy "service_automation_events_select_own"
  on public.service_automation_events for select
  using (auth.uid() = user_id);

drop policy if exists "service_automation_events_insert_own" on public.service_automation_events;
create policy "service_automation_events_insert_own"
  on public.service_automation_events for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_automation_events_update_own" on public.service_automation_events;
create policy "service_automation_events_update_own"
  on public.service_automation_events for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_automation_events_delete_own" on public.service_automation_events;
create policy "service_automation_events_delete_own"
  on public.service_automation_events for delete
  using (auth.uid() = user_id);

-- service_ai_runs

drop policy if exists "service_ai_runs_select_own" on public.service_ai_runs;
create policy "service_ai_runs_select_own"
  on public.service_ai_runs for select
  using (auth.uid() = user_id);

drop policy if exists "service_ai_runs_insert_own" on public.service_ai_runs;
create policy "service_ai_runs_insert_own"
  on public.service_ai_runs for insert
  with check (auth.uid() = user_id);

drop policy if exists "service_ai_runs_update_own" on public.service_ai_runs;
create policy "service_ai_runs_update_own"
  on public.service_ai_runs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "service_ai_runs_delete_own" on public.service_ai_runs;
create policy "service_ai_runs_delete_own"
  on public.service_ai_runs for delete
  using (auth.uid() = user_id);
