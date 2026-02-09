-- Hardening: enforce report domain constraints for safer writes/reads.

alter table public.monthly_report_settings
  drop constraint if exists chk_monthly_report_settings_format;
alter table public.monthly_report_settings
  add constraint chk_monthly_report_settings_format
  check (format in ('csv', 'pdf'));

alter table public.report_delivery_logs
  drop constraint if exists chk_report_delivery_logs_format;
alter table public.report_delivery_logs
  add constraint chk_report_delivery_logs_format
  check (format in ('csv', 'pdf'));

alter table public.report_delivery_logs
  drop constraint if exists chk_report_delivery_logs_status;
alter table public.report_delivery_logs
  add constraint chk_report_delivery_logs_status
  check (status in ('sent', 'error'));

create index if not exists idx_report_delivery_logs_user_month
  on public.report_delivery_logs(user_id, month_key, sent_at desc);
