-- Escalation tracking for overdue reschedule queue requests.

alter table public.service_reschedule_requests
  add column if not exists escalation_level int not null default 0,
  add column if not exists last_escalated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_service_reschedule_requests_escalation_level'
  ) then
    alter table public.service_reschedule_requests
      add constraint chk_service_reschedule_requests_escalation_level
      check (escalation_level between 0 and 5);
  end if;
end;
$$;

create index if not exists idx_service_reschedule_requests_escalation
  on public.service_reschedule_requests(user_id, status, escalation_level, sla_due_at);
