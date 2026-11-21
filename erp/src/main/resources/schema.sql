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

-- ==========================================================================
-- การเงิน (ขั้น 1A): บัญชีเงินสด/ธนาคาร · สมุดเงิน (append-only) · รับ/จ่ายเงินอื่น ๆ · โอนระหว่างบัญชี
-- ==========================================================================
create table if not exists fin_accounts (
  id              text primary key,
  code            text not null,
  name            text not null,
  type            text not null check (type in ('cash','bank','cheque')),
  bank_name       text not null default '',
  account_no      text not null default '',
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  opening_date    date not null,
  active          boolean not null default true,
  note            text not null default '',
  created_by      text,
  created_at      timestamptz not null default now()
);
create unique index if not exists uq_fin_accounts_code on fin_accounts (lower(code));

create table if not exists fin_txns (
  id            text primary key,
  kind          text not null check (kind in ('other_in','other_out','transfer')),
  txn_date      date not null,
  account_id    text not null references fin_accounts(id),
  to_account_id text references fin_accounts(id),
  amount        numeric(14,2) not null check (amount > 0),
  category      text not null default '',
  counterparty  text not null default '',
  ref_no        text not null default '',
  note          text not null default '',
  status        text not null check (status in ('pending','confirmed','rejected','void')),
  created_by    text not null,
  created_by_id text not null,
  created_at    timestamptz not null default now(),
  approved_by   text,
  approved_by_id text,
  approved_at   timestamptz,
  self_approved boolean not null default false,
  reject_reason text,
  void_reason   text,
  voided_by     text,
  voided_at     timestamptz,
  void_date     date,
  check ((kind = 'transfer' and to_account_id is not null and to_account_id <> account_id) or (kind <> 'transfer' and to_account_id is null))
);
create index if not exists idx_fin_txns_status on fin_txns (status, txn_date desc);

create table if not exists fin_movements (
  id           bigserial primary key,
  account_id   text not null references fin_accounts(id),
  mv_date      date not null,
  direction    text not null check (direction in ('in','out')),
  amount       numeric(14,2) not null check (amount > 0),
  source_type  text not null,
  source_id    text not null,
  description  text not null default '',
  reversal_of  bigint references fin_movements(id),
  created_by   text,
  created_at   timestamptz not null default now(),
  cleared      boolean not null default false,   -- กระทบยอดกับ Statement แล้ว (เตรียมไว้สำหรับขั้น 1C)
  cleared_at   timestamptz,
  statement_ref text
);
create index if not exists idx_fin_mv_account on fin_movements (account_id, mv_date, id);

create or replace function fin_movements_guard() returns trigger as $$
begin
  if tg_op = 'DELETE' then raise exception 'fin_movements is append-only'; end if;
  if (new.account_id, new.mv_date, new.direction, new.amount, new.source_type, new.source_id, new.description, new.reversal_of, new.created_by, new.created_at)
     is distinct from
     (old.account_id, old.mv_date, old.direction, old.amount, old.source_type, old.source_id, old.description, old.reversal_of, old.created_by, old.created_at) then
    raise exception 'fin_movements is immutable (only cleared/statement fields may change)';
  end if;
  return new;
end;
$$ language plpgsql;
drop trigger if exists trg_fin_movements_guard on fin_movements;
create trigger trg_fin_movements_guard before update or delete on fin_movements
  for each row execute function fin_movements_guard();

-- ==========================================================================
-- การเงิน (ขั้น A2): รับเงินลูกค้า (RV) · จัดสรรเข้าใบกำกับภาษี · ภาษีถูกหัก ณ ที่จ่าย · ค่าธรรมเนียมธนาคาร · เงินรอคืนลูกค้า
--   received + bank_fee = Σ alloc.amount + excess   (alloc.amount = ส่วนที่ตัดใบกำกับ ไม่รวมภาษีถูกหัก)
--   ใบกำกับถูกตัด = Σ (alloc.amount + alloc.wht) เทียบกับยอดรวม (total) ของใบกำกับ
-- ==========================================================================
create table if not exists fin_receipts (
  id            text primary key,
  rcv_date      date not null,
  customer_id   text not null,
  customer_name text not null default '',
  account_id    text not null references fin_accounts(id),
  received      numeric(14,2) not null check (received >= 0),
  bank_fee      numeric(14,2) not null default 0 check (bank_fee >= 0),
  wht           numeric(14,2) not null default 0 check (wht >= 0),
  excess        numeric(14,2) not null default 0 check (excess >= 0),
  ref_no        text not null default '',
  note          text not null default '',
  wht_cert_no   text,
  wht_cert_date date,
  wht_cert_amount numeric(14,2),
  status        text not null check (status in ('pending','confirmed','rejected','void')),
  created_by    text not null,
  created_by_id text not null,
  created_at    timestamptz not null default now(),
  approved_by   text,
  approved_by_id text,
  approved_at   timestamptz,
  self_approved boolean not null default false,
  reject_reason text,
  void_reason   text,
  voided_by     text,
  voided_at     timestamptz,
  void_date     date,
  check (received + bank_fee + wht > 0)
);
create index if not exists idx_fin_receipts_cust on fin_receipts (customer_id, rcv_date desc);
create index if not exists idx_fin_receipts_status on fin_receipts (status, rcv_date desc);

create table if not exists fin_receipt_allocs (
  id         bigserial primary key,
  receipt_id text not null references fin_receipts(id),
  invoice_id text not null,
  amount     numeric(14,2) not null check (amount >= 0),
  wht        numeric(14,2) not null default 0 check (wht >= 0),
  check (amount + wht > 0)
);
create index if not exists idx_fin_allocs_inv on fin_receipt_allocs (invoice_id);
create index if not exists idx_fin_allocs_rcpt on fin_receipt_allocs (receipt_id);

create or replace function fin_allocs_guard() returns trigger as $$
begin
  raise exception 'fin_receipt_allocs is append-only';
end;
$$ language plpgsql;
drop trigger if exists trg_fin_allocs_guard on fin_receipt_allocs;
create trigger trg_fin_allocs_guard before update or delete on fin_receipt_allocs
  for each row execute function fin_allocs_guard();

-- ==========================================================================
-- การเงิน (ขั้น A3): ใบสำคัญจ่าย (PV) · จ่ายเงินตามค่าใช้จ่าย · หัก ณ ที่จ่าย (WT) ณ วันจ่ายจริง
--   สถานะ: pending (รออนุมัติ) → approved → paid (เงินออกสมุดเงิน) · rejected · void (กลับรายการหลังจ่าย)
--   net = Σ(base + vat − wht) ของค่าใช้จ่ายที่ผูก · ผู้รับเงินคนเดียวต่อหนึ่งใบสำคัญจ่าย
-- ==========================================================================
create table if not exists fin_pay_vouchers (
  id            text primary key,
  pv_date       date not null,
  payee         text not null,
  gross         numeric(14,2) not null check (gross > 0),
  wht           numeric(14,2) not null default 0 check (wht >= 0),
  net           numeric(14,2) not null check (net >= 0),
  note          text not null default '',
  status        text not null check (status in ('pending','approved','paid','rejected','void')),
  account_id    text references fin_accounts(id),
  pay_date      date,
  ref_no        text not null default '',
  wht_cert_no   text,
  wht_cert_date date,
  created_by    text not null,
  created_by_id text not null,
  created_at    timestamptz not null default now(),
  approved_by   text,
  approved_by_id text,
  approved_at   timestamptz,
  self_approved boolean not null default false,
  paid_by       text,
  paid_at       timestamptz,
  reject_reason text,
  void_reason   text,
  voided_by     text,
  voided_at     timestamptz,
  void_date     date
);
create index if not exists idx_fin_pv_status on fin_pay_vouchers (status, pv_date desc);

create table if not exists fin_pay_items (
  id         bigserial primary key,
  voucher_id text not null references fin_pay_vouchers(id),
  expense_id text not null,
  base       numeric(14,2) not null check (base > 0),
  vat        numeric(14,2) not null default 0 check (vat >= 0),
  wht        numeric(14,2) not null default 0 check (wht >= 0)
);
create index if not exists idx_fin_pay_items_exp on fin_pay_items (expense_id);
create index if not exists idx_fin_pay_items_pv on fin_pay_items (voucher_id);

create or replace function fin_pay_items_guard() returns trigger as $$
begin
  raise exception 'fin_pay_items is append-only';
end;
$$ language plpgsql;
drop trigger if exists trg_fin_pay_items_guard on fin_pay_items;
create trigger trg_fin_pay_items_guard before update or delete on fin_pay_items
  for each row execute function fin_pay_items_guard();

-- ==========================================================================
-- การเงิน (ขั้น A4): ผูกใบรับเงิน (RV) กับใบเสร็จรับเงิน (RC) ที่ออกให้ลูกค้าไว้ก่อน (พนักงานพกไปเก็บเงิน)
--   สถานะเก็บเงินของใบเสร็จคำนวณจากใบรับเงินที่ผูกอยู่ (pending/confirmed) ไม่เก็บซ้ำในใบเสร็จ
-- ==========================================================================
create table if not exists fin_receipt_rcs (
  id         bigserial primary key,
  receipt_id text not null references fin_receipts(id),
  rc_id      text not null
);
create index if not exists idx_fin_receipt_rcs_rc on fin_receipt_rcs (rc_id);
create index if not exists idx_fin_receipt_rcs_rv on fin_receipt_rcs (receipt_id);

create or replace function fin_receipt_rcs_guard() returns trigger as $$
begin
  raise exception 'fin_receipt_rcs is append-only';
end;
$$ language plpgsql;
drop trigger if exists trg_fin_receipt_rcs_guard on fin_receipt_rcs;
create trigger trg_fin_receipt_rcs_guard before update or delete on fin_receipt_rcs
  for each row execute function fin_receipt_rcs_guard();

-- ใบสั่งผลิตที่เสร็จแล้วแต่ยังไม่มีวันเวลาที่เสร็จ (ข้อมูลก่อนเพิ่มฟิลด์ doneAt): ใช้เวลาแก้ไขล่าสุดแทน (ทำซ้ำได้ ไม่เปลี่ยนเวอร์ชันของเรคอร์ด)
update erp_records
   set data = data || jsonb_build_object('doneAt', to_char(updated_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS'))
 where collection = 'workOrders' and data->>'status' = 'done' and coalesce(data->>'doneAt', '') = '';

-- ลายเซ็นอิเล็กทรอนิกส์ระดับ 2: ภาพลายเซ็นของผู้ใช้แต่ละคน (เจ้าของเท่านั้นที่ตั้ง/ลบ · ดึงไปใช้ได้เฉพาะตอนเปิดเอกสารที่ผู้นั้นอนุมัติ/จ่ายแล้ว ผ่าน /signatures/for/...)
create table if not exists erp_user_signatures (
  user_id      text primary key references erp_users(id) on delete cascade,
  content_type text not null check (content_type in ('image/png', 'image/jpeg')),
  image        bytea not null,
  updated_at   timestamptz not null default now()
);
alter table fin_pay_vouchers add column if not exists paid_by_id text;
