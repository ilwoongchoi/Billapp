-- Verification fingerprints on bills + issue reports table
alter table public.bills add column if not exists verification_id text;
alter table public.bills add column if not exists verification_checksum text;
alter table public.bills add column if not exists residual_cost numeric(10,4);
alter table public.bills add column if not exists residual_usage numeric(10,4);
alter table public.bills add column if not exists residual_budget numeric(10,4);

create table if not exists public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  verification_id text,
  verification_checksum text,
  source text not null default 'unknown',
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_issue_reports_created_at on public.issue_reports(created_at desc);
create index if not exists idx_issue_reports_verification_id on public.issue_reports(verification_id);

alter table public.issue_reports enable row level security;
