-- Performance indexes for history/filter queries
create extension if not exists pg_trgm;

create index if not exists idx_bills_property_created_at
  on public.bills(property_id, created_at desc);

create index if not exists idx_bills_provider_trgm
  on public.bills using gin (provider gin_trgm_ops);
