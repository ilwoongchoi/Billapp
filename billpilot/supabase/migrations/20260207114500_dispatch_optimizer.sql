create table if not exists public.dispatch_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  origin text,
  destination text,
  distance_miles numeric(10,2) not null check (distance_miles > 0),
  estimated_fuel_gallons numeric(10,3) not null check (estimated_fuel_gallons >= 0),
  estimated_duration_minutes int not null check (estimated_duration_minutes between 5 and 1440),
  revenue_usd numeric(12,2) not null,
  variable_cost_usd numeric(12,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dispatch_routes_user_id
  on public.dispatch_routes(user_id);
create index if not exists idx_dispatch_routes_created_at
  on public.dispatch_routes(created_at desc);

create table if not exists public.dispatch_optimizer_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route_id uuid references public.dispatch_routes(id) on delete set null,
  run_label text,
  fuel_price_per_gallon numeric(8,3) not null check (fuel_price_per_gallon > 0),
  driver_hourly_cost numeric(8,2) not null check (driver_hourly_cost >= 0),
  overhead_usd numeric(12,2) not null default 0,
  margin_target numeric(6,5) not null check (margin_target between 0 and 1),
  fuel_weight numeric(6,5) not null check (fuel_weight between 0 and 1),
  time_weight numeric(6,5) not null check (time_weight between 0 and 1),
  kappa_start numeric(8,6) not null default 0.015625,
  kappa_limit numeric(8,6) not null default 0.03125,
  score numeric(8,5) not null,
  predicted_profit_usd numeric(12,2) not null,
  predicted_margin numeric(8,5) not null,
  drift numeric(8,6) not null,
  residual numeric(8,6) not null,
  residual_budget numeric(8,6) not null,
  phase text not null check (phase in ('flat_line', 'life', 'chaos')),
  basin text not null check (basin in ('stable_a', 'stable_b', 'boundary', 'chaos')),
  decision text not null check (decision in ('SHIP', 'NO-SHIP', 'BOUNDARY-BAND ONLY')),
  frame_valid boolean not null default false,
  falsifiers jsonb not null default '[]'::jsonb,
  pi1 numeric(8,6) not null,
  pi2 numeric(8,6) not null,
  pi3 numeric(8,6) not null,
  threshold_estimate numeric(8,6),
  threshold_ci_low numeric(8,6),
  threshold_ci_high numeric(8,6),
  cv_stability numeric(8,6),
  negative_control_drift numeric(8,6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dispatch_optimizer_runs_user_id
  on public.dispatch_optimizer_runs(user_id);
create index if not exists idx_dispatch_optimizer_runs_created_at
  on public.dispatch_optimizer_runs(created_at desc);
create index if not exists idx_dispatch_optimizer_runs_route_id
  on public.dispatch_optimizer_runs(route_id);

alter table public.dispatch_routes enable row level security;
alter table public.dispatch_optimizer_runs enable row level security;

drop policy if exists "dispatch_routes_select_own" on public.dispatch_routes;
create policy "dispatch_routes_select_own"
  on public.dispatch_routes for select
  using (auth.uid() = user_id);

drop policy if exists "dispatch_routes_insert_own" on public.dispatch_routes;
create policy "dispatch_routes_insert_own"
  on public.dispatch_routes for insert
  with check (auth.uid() = user_id);

drop policy if exists "dispatch_routes_update_own" on public.dispatch_routes;
create policy "dispatch_routes_update_own"
  on public.dispatch_routes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "dispatch_routes_delete_own" on public.dispatch_routes;
create policy "dispatch_routes_delete_own"
  on public.dispatch_routes for delete
  using (auth.uid() = user_id);

drop policy if exists "dispatch_optimizer_runs_select_own" on public.dispatch_optimizer_runs;
create policy "dispatch_optimizer_runs_select_own"
  on public.dispatch_optimizer_runs for select
  using (auth.uid() = user_id);

drop policy if exists "dispatch_optimizer_runs_insert_own" on public.dispatch_optimizer_runs;
create policy "dispatch_optimizer_runs_insert_own"
  on public.dispatch_optimizer_runs for insert
  with check (auth.uid() = user_id);