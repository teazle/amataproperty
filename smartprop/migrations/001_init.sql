create extension if not exists pgcrypto;

create table if not exists agents(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  agency text,
  cea_reg_no text,
  source text check (source in ('propertyguru','edgeprop')) not null,
  source_url text,
  last_seen_at timestamptz default now(),
  unique(source, phone)
);

create table if not exists listings(
  id uuid primary key default gen_random_uuid(),
  portal text check (portal in ('propertyguru','edgeprop')) not null,
  url text not null unique,
  title text,
  price int,
  district text,
  property_type text,
  agent_id uuid references agents(id) on delete set null,
  posted_at timestamptz,
  scraped_at timestamptz default now()
);

create table if not exists news(
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text not null unique,
  published_at timestamptz,
  district_tags text[] default '{}',
  scraped_at timestamptz default now()
);

create table if not exists outreach(
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete cascade,
  listing_id uuid references listings(id) on delete set null,
  channel text check (channel in ('whatsapp')) not null,
  template_name text,
  status text check (status in ('queued','sent','delivered','replied','failed','opted_out','signed')) default 'queued',
  wa_conversation_id text,
  payload jsonb,
  created_at timestamptz default now()
);

create table if not exists cobroke_agreements(
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id),
  listing_url text,
  buyer_requirements text,
  commission_split text,
  pdf_url text,
  signed_at timestamptz
);

create or replace function pg_try_advisory_lock(key bigint) returns boolean language sql as $$ select pg_try_advisory_lock(key); $$;
create or replace function pg_advisory_unlock(key bigint) returns boolean language sql as $$ select pg_advisory_unlock(key); $$;

create index if not exists idx_listings_district on listings(district);
create index if not exists idx_listings_price on listings(price);
create index if not exists idx_agents_phone on agents(phone);
