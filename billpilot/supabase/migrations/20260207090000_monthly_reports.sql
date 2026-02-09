create table if not exists public.monthly_report_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  format text not null default 'pdf',
  timezone text not null default 'UTC',
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  property_id uuid references public.properties(id) on delete set null,
  provider_filter text,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_monthly_report_settings_user_id
  on public.monthly_report_settings(user_id);
create index if not exists idx_monthly_report_settings_property_id
  on public.monthly_report_settings(property_id);

create table if not exists public.report_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  setting_id uuid references public.monthly_report_settings(id) on delete set null,
  sent_at timestamptz not null default now(),
  status text not null default 'sent',
  format text not null default 'pdf',
  month_key text,
  row_count int not null default 0,
  provider_filter text,
  property_id uuid references public.properties(id) on delete set null,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_report_delivery_logs_user_id
  on public.report_delivery_logs(user_id);
create index if not exists idx_report_delivery_logs_sent_at
  on public.report_delivery_logs(sent_at desc);

alter table public.monthly_report_settings enable row level security;
alter table public.report_delivery_logs enable row level security;

drop policy if exists "monthly_report_settings_select_own" on public.monthly_report_settings;
create policy "monthly_report_settings_select_own"
  on public.monthly_report_settings for select
  using (auth.uid() = user_id);

drop policy if exists "monthly_report_settings_insert_own" on public.monthly_report_settings;
create policy "monthly_report_settings_insert_own"
  on public.monthly_report_settings for insert
  with check (auth.uid() = user_id);

drop policy if exists "monthly_report_settings_update_own" on public.monthly_report_settings;
create policy "monthly_report_settings_update_own"
  on public.monthly_report_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "report_delivery_logs_select_own" on public.report_delivery_logs;
create policy "report_delivery_logs_select_own"
  on public.report_delivery_logs for select
  using (auth.uid() = user_id);

