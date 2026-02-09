create unique index if not exists uq_subscriptions_stripe_customer_id
  on public.subscriptions(stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists uq_subscriptions_stripe_subscription_id
  on public.subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;

insert into storage.buckets (id, name, public)
values ('bill-files', 'bill-files', false)
on conflict (id) do nothing;

