-- BillPilot initial schema
create extension if not exists "pgcrypto";

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  address text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  file_url text,
  provider text,
  period_start date,
  period_end date,
  total_cost numeric(12,2),
  usage_value numeric(12,3),
  usage_unit text,
  currency text not null default 'USD',
  confidence numeric(4,3),
  raw_text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.bill_line_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  item_name text not null,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  type text not null,
  severity text not null,
  message text not null,
  est_savings numeric(12,2),
  residual numeric(10,4),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'inactive',
  plan text not null default 'free',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_properties_user_id on public.properties(user_id);
create index if not exists idx_bills_property_id on public.bills(property_id);
create index if not exists idx_bills_period_end on public.bills(period_end desc);
create index if not exists idx_line_items_bill_id on public.bill_line_items(bill_id);
create index if not exists idx_insights_bill_id on public.insights(bill_id);

alter table public.properties enable row level security;
alter table public.bills enable row level security;
alter table public.bill_line_items enable row level security;
alter table public.insights enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "properties_select_own" on public.properties;
create policy "properties_select_own"
  on public.properties for select
  using (auth.uid() = user_id);

drop policy if exists "properties_insert_own" on public.properties;
create policy "properties_insert_own"
  on public.properties for insert
  with check (auth.uid() = user_id);

drop policy if exists "properties_update_own" on public.properties;
create policy "properties_update_own"
  on public.properties for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "properties_delete_own" on public.properties;
create policy "properties_delete_own"
  on public.properties for delete
  using (auth.uid() = user_id);

drop policy if exists "bills_select_own" on public.bills;
create policy "bills_select_own"
  on public.bills for select
  using (
    exists (
      select 1
      from public.properties p
      where p.id = bills.property_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "bills_insert_own" on public.bills;
create policy "bills_insert_own"
  on public.bills for insert
  with check (
    exists (
      select 1
      from public.properties p
      where p.id = bills.property_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "bill_line_items_select_own" on public.bill_line_items;
create policy "bill_line_items_select_own"
  on public.bill_line_items for select
  using (
    exists (
      select 1
      from public.bills b
      join public.properties p on p.id = b.property_id
      where b.id = bill_line_items.bill_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "bill_line_items_insert_own" on public.bill_line_items;
create policy "bill_line_items_insert_own"
  on public.bill_line_items for insert
  with check (
    exists (
      select 1
      from public.bills b
      join public.properties p on p.id = b.property_id
      where b.id = bill_line_items.bill_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "insights_select_own" on public.insights;
create policy "insights_select_own"
  on public.insights for select
  using (
    exists (
      select 1
      from public.bills b
      join public.properties p on p.id = b.property_id
      where b.id = insights.bill_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "insights_insert_own" on public.insights;
create policy "insights_insert_own"
  on public.insights for insert
  with check (
    exists (
      select 1
      from public.bills b
      join public.properties p on p.id = b.property_id
      where b.id = insights.bill_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "subscriptions_insert_own" on public.subscriptions;
create policy "subscriptions_insert_own"
  on public.subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists "subscriptions_update_own" on public.subscriptions;
create policy "subscriptions_update_own"
  on public.subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

