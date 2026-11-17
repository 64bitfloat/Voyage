-- =====================================================================
-- Voyage 初期スキーマ
--   Supabase ダッシュボード > SQL Editor に貼り付けて実行する。
--
-- セキュリティ方針（認証なしURL共有のため）:
--   - すべてのテーブルで RLS を有効化し、anon/authenticated 向けのポリシーは作らない
--     （= ブラウザから anon key で直接テーブルを読み書きできない。全件一覧の漏洩を防ぐ）
--   - 読み書きは Next.js のサーバー側 API（service role key）経由のみ
--   - リアルタイム同期は Realtime Broadcast（チャンネル名 = trip UUID）で
--     「更新があった」通知だけを流し、各クライアントはAPIから再取得する
--
-- ID 方針: 全エンティティの id は UUID で、クライアントが生成して渡す
--   （楽観的更新時にIDが確定し、エクスポートのたびに再生成されない）
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 旅行
-- ---------------------------------------------------------------------
create table if not exists public.trips (
  id            uuid primary key default gen_random_uuid(),
  title         text not null default '',
  start_date    date,
  end_date      date,
  notes         text not null default '',
  -- 4桁の合言葉（任意）。平文では保存しない（段階3で実装: scrypt ハッシュ）
  passcode_hash text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint trips_date_range check (start_date is null or end_date is null or start_date <= end_date)
);

-- ---------------------------------------------------------------------
-- 参加者（full_name は Notion 参加者DBの氏名と一致させる本名）
-- ---------------------------------------------------------------------
create table if not exists public.participants (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  full_name  text not null default '',
  nickname   text not null default '',
  role       text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists participants_trip_idx on public.participants(trip_id);

-- ---------------------------------------------------------------------
-- 日程（day_index 0 = 出発前、1.. = Day N）
-- ---------------------------------------------------------------------
create table if not exists public.days (
  trip_id         uuid not null references public.trips(id) on delete cascade,
  day_index       integer not null check (day_index >= 0),
  label           text not null,
  date            date,
  departure_point text,
  departure_lat   double precision check (departure_lat between -90 and 90),
  departure_lng   double precision check (departure_lng between -180 and 180),
  departure_time  time,
  primary key (trip_id, day_index)
);

-- ---------------------------------------------------------------------
-- スポット（目的地）
-- ---------------------------------------------------------------------
create table if not exists public.spots (
  id          uuid primary key,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  day_index   integer not null,
  sort_order  integer not null default 0,
  name        text not null default '',
  category    text not null default 'sightseeing'
              check (category in ('meal','sightseeing','onsen','lodging','transport','shopping','other')),
  status      text not null default 'undecided'
              check (status in ('decided','candidate','undecided')),
  is_main     boolean not null default false,
  address     text,
  lat         double precision check (lat between -90 and 90),
  lng         double precision check (lng between -180 and 180),
  place_url   text,
  stay_minutes integer not null default 60 check (stay_minutes >= 0),
  reservation_time timestamptz,
  is_fixed    boolean not null default false,
  memo        text not null default '',
  -- 前のスポット（その日の最初なら出発地点）からの移動
  transport_mode             text check (transport_mode in ('car','walk','train','manual')),
  transport_duration_minutes integer check (transport_duration_minutes >= 0),
  transport_distance_m       integer check (transport_distance_m >= 0),
  transport_note             text not null default '',
  -- 宿泊スポットのみ
  check_in    timestamptz,
  check_out   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (trip_id, day_index) references public.days(trip_id, day_index) on delete cascade
);
create index if not exists spots_trip_day_idx on public.spots(trip_id, day_index, sort_order);

-- ---------------------------------------------------------------------
-- 写真（spot_id か day_index の少なくとも一方に必ず紐付ける）
-- ---------------------------------------------------------------------
create table if not exists public.photos (
  id         uuid primary key,
  trip_id    uuid not null references public.trips(id) on delete cascade,
  spot_id    uuid references public.spots(id) on delete cascade,
  day_index  integer,
  storage_path text not null,
  caption    text not null default '',
  photographer_nickname text not null default '',
  taken_at   timestamptz,
  created_at timestamptz not null default now(),
  constraint photos_must_be_linked check (spot_id is not null or day_index is not null)
);
create index if not exists photos_trip_idx on public.photos(trip_id);

-- ---------------------------------------------------------------------
-- 費用（総額・支払者）＋ 個人別内訳（1件の入力フォームで同時に保存する）
-- ---------------------------------------------------------------------
create table if not exists public.costs (
  id          uuid primary key,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  title       text not null default '',
  category    text not null default 'other'
              check (category in ('lodging','transport','food','ticket','shopping','other')),
  total_paid_amount_jpy integer not null default 0,   -- 実際に支払った総額（整数円）
  payer_participant_id  uuid references public.participants(id) on delete set null,
  related_spot_id       uuid references public.spots(id) on delete set null,
  related_day_index     integer,
  is_settled  boolean not null default false,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists costs_trip_idx on public.costs(trip_id);

create table if not exists public.cost_breakdowns (
  id          uuid primary key default gen_random_uuid(),
  cost_id     uuid not null references public.costs(id) on delete cascade,
  consumer_participant_id uuid references public.participants(id) on delete set null,
  amount_jpy  integer not null default 0,
  note        text not null default '',
  sort_order  integer not null default 0
);
create index if not exists cost_breakdowns_cost_idx on public.cost_breakdowns(cost_id);

-- ---------------------------------------------------------------------
-- 持ち物
-- ---------------------------------------------------------------------
create table if not exists public.belongings (
  id          uuid primary key,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  name        text not null default '',
  is_needed   boolean not null default true,
  is_prepared boolean not null default false,
  assignee_participant_id uuid references public.participants(id) on delete set null,
  note        text not null default '',
  sort_order  integer not null default 0
);
create index if not exists belongings_trip_idx on public.belongings(trip_id);

-- ---------------------------------------------------------------------
-- 料理 ＋ 材料
-- ---------------------------------------------------------------------
create table if not exists public.dishes (
  id          uuid primary key,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  name        text not null default '',
  status      text not null default 'candidate' check (status in ('decided','candidate')),
  related_day_index integer,
  sort_order  integer not null default 0
);
create index if not exists dishes_trip_idx on public.dishes(trip_id);

create table if not exists public.dish_ingredients (
  id          uuid primary key default gen_random_uuid(),
  dish_id     uuid not null references public.dishes(id) on delete cascade,
  name        text not null default '',
  quantity    numeric check (quantity >= 0),
  unit        text not null default '',
  ingredient_name text not null default '',
  sort_order  integer not null default 0
);
create index if not exists dish_ingredients_dish_idx on public.dish_ingredients(dish_id);

-- ---------------------------------------------------------------------
-- updated_at 自動更新
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trips_touch on public.trips;
create trigger trips_touch before update on public.trips
  for each row execute function public.touch_updated_at();
drop trigger if exists spots_touch on public.spots;
create trigger spots_touch before update on public.spots
  for each row execute function public.touch_updated_at();
drop trigger if exists costs_touch on public.costs;
create trigger costs_touch before update on public.costs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- RLS: 有効化のみ（ポリシーなし = anon からは一切アクセス不可）
-- ---------------------------------------------------------------------
alter table public.trips            enable row level security;
alter table public.participants     enable row level security;
alter table public.days             enable row level security;
alter table public.spots            enable row level security;
alter table public.photos           enable row level security;
alter table public.costs            enable row level security;
alter table public.cost_breakdowns  enable row level security;
alter table public.belongings       enable row level security;
alter table public.dishes           enable row level security;
alter table public.dish_ingredients enable row level security;
