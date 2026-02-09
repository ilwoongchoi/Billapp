-- Operational controls for reschedule queue triage (assignment + SLA tracking).

alter table public.service_reschedule_requests
  add column if not exists assigned_to text,
  add column if not exists assigned_at timestamptz,
  add column if not exists sla_due_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_service_reschedule_requests_assigned_to'
  ) then
    alter table public.service_reschedule_requests
      add constraint chk_service_reschedule_requests_assigned_to
      check (
        assigned_to is null
        or char_length(btrim(assigned_to)) between 2 and 120
      );
  end if;
end;
$$;

create index if not exists idx_service_reschedule_requests_user_sla_due
  on public.service_reschedule_requests(user_id, sla_due_at)
  where status in ('pending', 'options_sent', 'handoff');

create index if not exists idx_service_reschedule_requests_user_assigned_to
  on public.service_reschedule_requests(user_id, assigned_to);
