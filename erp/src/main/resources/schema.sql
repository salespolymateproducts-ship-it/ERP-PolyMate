-- PolyMate ERP : schema (idempotent, รันทุกครั้งที่เริ่มระบบ)
create table if not exists erp_records (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  version    int  not null default 1,
  seq        bigserial,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  primary key (collection, id)
);
create index if not exists idx_erp_records_coll_seq on erp_records (collection, seq desc);

create table if not exists erp_users (
  id            text primary key,
  username      text not null,
  full_name     text not null default '',
  role          text not null,
  email         text not null default '',
  dept          text not null default '',
  status        text not null default 'active' check (status in ('active','suspended')),
  password_hash text,
  legacy_salt   text,
  legacy_hash   text,
  must_change   boolean not null default true,
  failed_logins int not null default 0,
  locked_until  timestamptz,
  last_login    timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_erp_users_username on erp_users (lower(username));

create table if not exists erp_sessions (
  token_hash text primary key,
  user_id    text not null references erp_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  expires_at timestamptz not null,
  ip         text,
  user_agent text
);
create index if not exists idx_erp_sessions_user on erp_sessions (user_id);

create table if not exists erp_counters (
  counter_key text primary key,
  last_value  int not null default 0 check (last_value >= 0)
);

create table if not exists erp_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists erp_audit_logs (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  user_name text,
  role      text,
  action    text not null,
  entity    text,
  entity_id text,
  detail    text
);
create index if not exists idx_erp_audit_at on erp_audit_logs (at desc);

create or replace function erp_audit_immutable() returns trigger as $$
begin
  raise exception 'erp_audit_logs is append-only';
end;
$$ language plpgsql;
drop trigger if exists trg_erp_audit_immutable on erp_audit_logs;
create trigger trg_erp_audit_immutable before update or delete on erp_audit_logs
  for each row execute function erp_audit_immutable();
