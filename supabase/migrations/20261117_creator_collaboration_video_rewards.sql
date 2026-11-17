-- JerseyAtlas CRM: integrate WhatsApp leads, collaboration records, video statistics and reward tiers.
-- Run once in Supabase SQL Editor while signed in as the project owner/admin.

begin;

alter table public.creators
  add column if not exists whatsapp_phone text,
  add column if not exists email text,
  add column if not exists promo_code text,
  add column if not exists original_contact_person text,
  add column if not exists legacy_usernames text[] not null default '{}';

create table if not exists public.creator_collaborations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  platform text not null,
  account_url text,
  promo_code text,
  ip_country text,
  followers bigint,
  contact_info text,
  published_count integer,
  collaboration_start_date date,
  collaboration_start_raw text,
  collaboration_type text,
  agreed_posts text,
  agreed_post_count integer,
  agreed_amount numeric(12,2),
  settlement_status text,
  sample_product text,
  shipping_address text,
  notes text,
  source_sheet text,
  source_row integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creator_videos (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  collaboration_id uuid references public.creator_collaborations(id) on delete set null,
  platform text not null,
  creator_profile_url text,
  video_url text,
  posted_at date,
  period_type text,
  period_start date,
  period_end date,
  play_count bigint,
  currency text,
  reward_amount numeric(12,2),
  settlement_status text,
  notes text,
  source_sheet text,
  source_row integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists creator_videos_team_video_url_uidx
  on public.creator_videos(team_id, video_url)
  where video_url is not null and video_url <> '';

create index if not exists creator_collaborations_team_creator_idx
  on public.creator_collaborations(team_id, creator_id);

create index if not exists creator_videos_team_creator_idx
  on public.creator_videos(team_id, creator_id);

create table if not exists public.creator_reward_tiers (
  team_id uuid not null references public.teams(id) on delete cascade,
  currency text not null check (currency in ('USD','BRL','GBP','CNY')),
  min_views bigint not null check (min_views >= 0),
  reward_amount numeric(12,2),
  updated_at timestamptz not null default now(),
  primary key (team_id, currency, min_views)
);

alter table public.creator_collaborations enable row level security;
alter table public.creator_videos enable row level security;
alter table public.creator_reward_tiers enable row level security;

drop policy if exists creator_collaborations_admin_all on public.creator_collaborations;
create policy creator_collaborations_admin_all on public.creator_collaborations
  for all to authenticated
  using (private.is_active_member() and private.current_role() = 'admin')
  with check (private.is_active_member() and private.current_role() = 'admin');

drop policy if exists creator_videos_admin_all on public.creator_videos;
create policy creator_videos_admin_all on public.creator_videos
  for all to authenticated
  using (private.is_active_member() and private.current_role() = 'admin')
  with check (private.is_active_member() and private.current_role() = 'admin');

drop policy if exists creator_reward_tiers_admin_all on public.creator_reward_tiers;
create policy creator_reward_tiers_admin_all on public.creator_reward_tiers
  for all to authenticated
  using (private.is_active_member() and private.current_role() = 'admin')
  with check (private.is_active_member() and private.current_role() = 'admin');

grant select, insert, update, delete on public.creator_collaborations to authenticated;
grant select, insert, update, delete on public.creator_videos to authenticated;
grant select, insert, update, delete on public.creator_reward_tiers to authenticated;

create or replace function public.calculate_creator_video_fields()
returns trigger
language plpgsql
as $$
begin
  if new.period_type = '7天' and new.period_start is not null then
    new.period_end := new.period_start + 6;
  else
    new.period_end := null;
  end if;

  if new.play_count is null or new.currency is null then
    new.reward_amount := null;
  else
    select t.reward_amount
      into new.reward_amount
      from public.creator_reward_tiers t
     where t.team_id = new.team_id
       and t.currency = new.currency
       and t.min_views <= new.play_count
     order by t.min_views desc
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists creator_videos_calculate_fields on public.creator_videos;
create trigger creator_videos_calculate_fields
before insert or update of team_id, period_type, period_start, play_count, currency
on public.creator_videos
for each row execute function public.calculate_creator_video_fields();

create or replace function public.refresh_creator_video_rewards()
returns trigger
language plpgsql
as $$
declare
  v_team_id uuid;
  v_currency text;
begin
  if tg_op = 'DELETE' then
    v_team_id := old.team_id;
    v_currency := old.currency;
  else
    v_team_id := new.team_id;
    v_currency := new.currency;
  end if;

  update public.creator_videos v
     set reward_amount = (
       select t.reward_amount
         from public.creator_reward_tiers t
        where t.team_id = v.team_id
          and t.currency = v.currency
          and v.play_count is not null
          and t.min_views <= v.play_count
        order by t.min_views desc
        limit 1
     )
   where v.team_id = v_team_id and v.currency = v_currency;

  return null;
end;
$$;

drop trigger if exists creator_reward_tiers_refresh_videos on public.creator_reward_tiers;
create trigger creator_reward_tiers_refresh_videos
after insert or update or delete on public.creator_reward_tiers
for each row execute function public.refresh_creator_video_rewards();

commit;
