create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  stripe_event_id text not null unique,
  stripe_event_type text not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  livemode boolean not null default false,
  status text not null default 'received',
  details jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_webhook_events_user_id on public.webhook_events(user_id);
create index if not exists idx_webhook_events_created_at on public.webhook_events(created_at desc);
create index if not exists idx_webhook_events_customer_id on public.webhook_events(stripe_customer_id);

alter table public.webhook_events enable row level security;

drop policy if exists "webhook_events_select_own" on public.webhook_events;
create policy "webhook_events_select_own"
  on public.webhook_events for select
  using (auth.uid() = user_id);

