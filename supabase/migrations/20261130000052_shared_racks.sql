-- =====================================================================
-- 0052 Shared racks: one physical rack, several households, every bottle its own owner
-- =====================================================================
-- docs/sprints/smart-cellar-3d/ADR-010-shared-racks.md says what these mean and why.
--
-- ADDITIVE ONLY. Nothing that exists is dropped, renamed, rewritten or loosened:
--   * five new tables in `private` (not reachable through the API at all), each with row level security on, no
--     policy and no grant to any API role;
--   * new functions: the only way in. Everything in `public` is SECURITY DEFINER with an empty search_path, takes
--     the person from auth.uid() and from nothing else, and checks that person's ACTIVE membership itself;
--   * two new triggers on public.bottles, both calling one function that does a single index probe and returns for
--     every bottle that is not in a shared rack (which is every bottle that exists when this runs);
--   * one new foreign key INTO public.bottles (from the placements table). No column, constraint, policy, grant or
--     function of bottles, cellar_locations, households or any other existing table changes.
--
-- The model in five lines:
--   A shared rack is its own thing (not a household, not a cellar_locations row) with members per USER.
--   A bottle in it stays an ordinary public.bottles row of its owner's household, with no private place.
--   Where it stands is ONE row of private.shared_rack_placements: unique per whole spot, unique per bottle.
--   Whose it is, who placed it, who acts and which household the record is in are four different columns.
--   Every change writes private.shared_rack_events, which nobody can update or delete.
--
-- Locks. Every write to a rack takes the row lock of that rack first (FOR NO KEY UPDATE) and then reads the caller's
-- own member row FOR SHARE requiring 'active': so all writes to one rack are serial, and a member who is removed
-- either had their change committed before the removal or is refused. The order is always rack, then member rows,
-- then a bottle, then a placement. The two paths that come from the owner's own side (the trigger on bottles, and
-- shared_rack_withdraw_bottle) hold a bottle and delete a placement; they never ask for the rack's lock. What they do
-- take on the rack is the FOR KEY SHARE of the foreign key when their line of history is inserted, and that is
-- exactly what FOR NO KEY UPDATE lets through (FOR UPDATE would not: scripts/db-shared-racks-concurrency.sh found
-- that deadlock, opening a bottle at home against a move in the rack). So a private flow never waits for a rack.
--
-- Rollback (only for a database on which no shared rack was ever used; it drops the history with everything else):
--   drop trigger bottles_shared_rack_update on public.bottles; drop trigger bottles_shared_rack_delete on public.bottles;
--   drop function public.shared_racks(uuid, boolean), public.shared_rack_members(uuid), public.shared_rack_bottles(uuid, uuid),
--     public.shared_rack_events(uuid, bigint, integer, uuid, uuid, uuid, uuid), public.shared_rack_invitations(uuid),
--     public.my_shared_rack_invitations(), public.my_shared_rack_bottles(),
--     public.shared_rack_create(text, public.location_kind, text, text, smallint, smallint, smallint, jsonb),
--     public.shared_rack_rename(uuid, text),
--     public.shared_rack_save_layout(uuid, public.location_kind, text, text, smallint, smallint, smallint, jsonb, bigint),
--     public.shared_rack_set_archived(uuid, boolean), public.shared_rack_invite(uuid, uuid),
--     public.shared_rack_respond_invitation(uuid, boolean), public.shared_rack_cancel_invitation(uuid),
--     public.shared_rack_set_member_role(uuid, uuid, text), public.shared_rack_remove_member(uuid, uuid),
--     public.shared_rack_leave(uuid), public.shared_rack_place(uuid, uuid, smallint, smallint, smallint),
--     public.shared_rack_move(uuid, uuid, smallint, smallint, smallint, smallint, smallint, smallint),
--     public.shared_rack_take_out(uuid, uuid, smallint, smallint, smallint), public.shared_rack_withdraw_bottle(uuid);
--   drop table private.shared_rack_events, private.shared_rack_placements, private.shared_rack_invitations,
--     private.shared_rack_members, private.shared_racks cascade;
--   drop function private.shared_rack_follow_bottle(), ... (the private.shared_rack_* helpers below).
-- The ordinary way back is the feature gate (CELLR_SHARED_RACKS unset): every route is then 404 and the data stays.

-- ---- 1. Tables ---------------------------------------------------------------------------------------------------

-- The rack. The same words for a layout as a place with a template (0043), under the same limits. Always with a
-- template: a shared rack is new, there is no form from before templates. Never deleted: archived.
create table private.shared_racks (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(btrim(name)) between 1 and 60 and name = btrim(name)),
  kind           public.location_kind not null default 'rack',
  template       text not null check (template ~ '^[a-z][a-z0-9_]{0,39}$'),
  slot_semantics text not null check (slot_semantics in ('depth', 'ordinal', 'single')),
  grid_rows      smallint not null check (grid_rows between 1 and 30),
  grid_cols      smallint not null check (grid_cols between 1 and 30),
  cell_capacity  smallint not null default 1 check (cell_capacity between 1 and 16),
  appearance     jsonb,
  -- goes up by one with every change of the row: what a layout save is compared against, inside its transaction
  revision       bigint not null default 1,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz,
  constraint shared_racks_total_capacity
    check (grid_rows::int * grid_cols::int * cell_capacity::int <= 1200),
  constraint shared_racks_single_is_one
    check (slot_semantics <> 'single' or cell_capacity = 1),
  constraint shared_racks_appearance
    check (appearance is null
           or coalesce(jsonb_typeof(appearance) = 'object'
                       and jsonb_typeof(appearance -> 'v') = 'number'
                       and pg_column_size(appearance) < 1024, false))
);
comment on table private.shared_racks is
  'A physical rack shared by people of several households (ADR-010). Reached only through the public.shared_rack_* functions.';

-- Who may use a rack: per USER, never per household. A row stays when someone leaves or is removed (status), so a
-- former member can come back by a new invitation; it goes only with the account itself.
create table private.shared_rack_members (
  rack_id      uuid not null references private.shared_racks,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null check (role in ('owner', 'member')),
  status       text not null default 'active' check (status in ('active', 'left', 'removed')),
  -- the person's name when they joined: read only when the account is gone and nothing else can say who it was
  display_name text check (char_length(display_name) <= 60),
  joined_at    timestamptz not null default now(),
  ended_at     timestamptz,
  ended_by     uuid references auth.users on delete set null,
  invited_by   uuid references auth.users on delete set null,
  primary key (rack_id, user_id),
  constraint shared_rack_members_ended check ((status = 'active') = (ended_at is null))
);
create index shared_rack_members_user_idx on private.shared_rack_members (user_id) where status = 'active';

-- An invitation is to one existing person. 'pending' past expires_at is expired: it can no longer be accepted.
create table private.shared_rack_invitations (
  id              uuid primary key default gen_random_uuid(),
  rack_id         uuid not null references private.shared_racks,
  invited_user_id uuid not null references auth.users on delete cascade,
  invited_by      uuid references auth.users on delete set null,
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '14 days',
  responded_at    timestamptz,
  constraint shared_rack_invitations_responded check ((status = 'pending') = (responded_at is null))
);
create unique index shared_rack_invitations_pending
  on private.shared_rack_invitations (rack_id, invited_user_id) where status = 'pending';
create index shared_rack_invitations_user_idx
  on private.shared_rack_invitations (invited_user_id) where status = 'pending';

-- THE occupancy of a shared rack: one row per bottle standing in it, and nothing else says where a bottle is.
-- One bottle per whole spot, one spot per bottle: two unique constraints, whatever runs at the same moment.
--   owner_user_id   whose bottle it is IN THE RACK: the member who put it there. Set once, from auth.uid(); the
--                   trigger below lets it change to NULL only (the account was deleted), never to someone else.
--   placed_by       who put it there (the same person today; kept apart because it is a different fact).
--   owner_name, wine   as they read when it was placed: for the history, and for when nothing live can be read.
-- ON DELETE CASCADE from the bottle is a backstop only: the trigger on bottles (section 4) ends the placement and
-- writes the event before the row goes. It makes sure a shared rack can never stand in the way of deleting a bottle.
create table private.shared_rack_placements (
  id            uuid primary key default gen_random_uuid(),
  rack_id       uuid not null references private.shared_racks,
  loc_row       smallint not null check (loc_row >= 1),
  loc_col       smallint not null check (loc_col >= 1),
  loc_index     smallint not null default 1 check (loc_index between 1 and 16),
  bottle_id     uuid not null references public.bottles on delete cascade,
  owner_user_id uuid references auth.users on delete set null,
  owner_name    text check (char_length(owner_name) <= 60),
  wine          jsonb not null check (jsonb_typeof(wine) = 'object' and pg_column_size(wine) < 2048),
  placed_by     uuid references auth.users on delete set null,
  placed_at     timestamptz not null default now(),
  moved_at      timestamptz,
  constraint shared_rack_placements_bottle unique (bottle_id),
  constraint shared_rack_placements_spot unique (rack_id, loc_row, loc_col, loc_index)
);
create index shared_rack_placements_owner_idx on private.shared_rack_placements (owner_user_id);
comment on table private.shared_rack_placements is
  'Where a bottle stands in a shared rack: unique per whole spot (rack, row, col, index) and per bottle. The bottle itself stays a public.bottles row of its owner''s household.';

-- What happened, for good. `seq` is the order and the paging cursor. The names and the wine are SNAPSHOTS: the
-- history reads the same after a bottle is deleted, a member has left and an account is gone.
-- The three references to a person are ON DELETE SET NULL, so the history never blocks deleting an account; that
-- is the one change the append-only trigger lets through (section 2).
-- placement_id and bottle_id are plain ids on purpose: what they point at is deleted in the ordinary course.
create table private.shared_rack_events (
  seq          bigint generated always as identity primary key,
  rack_id      uuid not null references private.shared_racks,
  event_type   text not null check (event_type in (
                 'rack_created', 'rack_renamed', 'rack_layout_changed', 'rack_archived', 'rack_restored',
                 'member_joined', 'member_left', 'member_removed', 'member_role_changed',
                 'bottle_placed', 'bottle_moved', 'bottle_taken_out', 'bottle_withdrawn',
                 'bottle_relocated', 'bottle_opened', 'bottle_gifted', 'bottle_removed')),
  occurred_at  timestamptz not null default clock_timestamp(),
  actor_id     uuid references auth.users on delete set null,
  actor_name   text check (char_length(actor_name) <= 60),
  owner_id     uuid references auth.users on delete set null,
  owner_name   text check (char_length(owner_name) <= 60),
  subject_id   uuid references auth.users on delete set null,
  subject_name text check (char_length(subject_name) <= 60),
  placement_id uuid,
  bottle_id    uuid,
  wine         jsonb check (wine is null or (jsonb_typeof(wine) = 'object' and pg_column_size(wine) < 2048)),
  from_row     smallint, from_col smallint, from_index smallint,
  to_row       smallint, to_col   smallint, to_index   smallint,
  detail       jsonb check (detail is null or (jsonb_typeof(detail) = 'object' and pg_column_size(detail) < 1024)),
  constraint shared_rack_events_from_whole
    check ((from_row is null) = (from_col is null) and (from_row is null) = (from_index is null)),
  constraint shared_rack_events_to_whole
    check ((to_row is null) = (to_col is null) and (to_row is null) = (to_index is null))
);
create index shared_rack_events_rack_idx on private.shared_rack_events (rack_id, seq desc);
create index shared_rack_events_bottle_idx on private.shared_rack_events (rack_id, bottle_id, seq desc)
  where bottle_id is not null;
create index shared_rack_events_placement_idx on private.shared_rack_events (placement_id)
  where placement_id is not null;
comment on table private.shared_rack_events is
  'Append-only history of a shared rack. No role may update or delete; see private.shared_rack_events_append_only().';

alter table private.shared_racks            enable row level security;
alter table private.shared_rack_members     enable row level security;
alter table private.shared_rack_invitations enable row level security;
alter table private.shared_rack_placements  enable row level security;
alter table private.shared_rack_events      enable row level security;
-- No policy and no grant: not the API roles, not the service role. Only the functions below (run as the owner of
-- these tables) read or write them.
revoke all on private.shared_racks, private.shared_rack_members, private.shared_rack_invitations,
  private.shared_rack_placements, private.shared_rack_events from public, anon, authenticated, service_role;

-- ---- 2. Rules the tables keep themselves, whoever writes ---------------------------------------------------------

-- A rack row counts its own changes.
create function private.shared_rack_touch() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end $$;
create trigger shared_racks_touch before update on private.shared_racks
  for each row execute function private.shared_rack_touch();

-- More than one bottle per cell stays off until the switch of 0043 says otherwise (the same switch as for a
-- private place), and a layout never takes a spot away from under a bottle or changes what its index means.
create function private.shared_rack_check_layout() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.cell_capacity > 1
     and (tg_op = 'INSERT' or new.cell_capacity is distinct from old.cell_capacity)
     and not private.depth_placement_enabled() then
    raise exception 'depth_not_enabled' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if (new.grid_rows < old.grid_rows or new.grid_cols < old.grid_cols or new.cell_capacity < old.cell_capacity)
       and exists (select 1 from private.shared_rack_placements p
                    where p.rack_id = new.id
                      and (p.loc_row > new.grid_rows or p.loc_col > new.grid_cols or p.loc_index > new.cell_capacity)) then
      raise exception 'location_in_use' using errcode = '23514';
    end if;
    if new.slot_semantics is distinct from old.slot_semantics and old.cell_capacity > 1
       and exists (select 1 from private.shared_rack_placements p where p.rack_id = new.id) then
      raise exception 'layout_semantics_change' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger shared_racks_layout before insert or update of grid_rows, grid_cols, cell_capacity, slot_semantics
  on private.shared_racks for each row execute function private.shared_rack_check_layout();

-- A placement is on a spot of its rack, stays in its rack, stays the same bottle, and stays its owner's.
-- The rack is read FOR SHARE, as private.check_bottle_location reads a place: a change of layout holds the row
-- lock, so this waits for it and checks against what was committed.
create function private.shared_rack_check_placement() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare r smallint; c smallint; k smallint;
begin
  if tg_op = 'UPDATE' then
    if new.rack_id is distinct from old.rack_id or new.bottle_id is distinct from old.bottle_id then
      raise exception 'shared_rack_placement_immutable' using errcode = '23000';
    end if;
    -- the owner never becomes someone else; it only becomes nobody, when the account is deleted
    if new.owner_user_id is distinct from old.owner_user_id and new.owner_user_id is not null then
      raise exception 'shared_rack_owner_immutable' using errcode = '23000';
    end if;
    if (new.loc_row, new.loc_col, new.loc_index) is not distinct from (old.loc_row, old.loc_col, old.loc_index) then
      return new;
    end if;
  end if;
  select x.grid_rows, x.grid_cols, x.cell_capacity into r, c, k
    from private.shared_racks x where x.id = new.rack_id for share;
  if not found or new.loc_row > r or new.loc_col > c or new.loc_index > k then
    raise exception 'slot_out_of_bounds' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger shared_rack_placements_check before insert or update on private.shared_rack_placements
  for each row execute function private.shared_rack_check_placement();

-- APPEND-ONLY. Nobody holds a privilege on the history, and this refuses UPDATE, DELETE and TRUNCATE for every
-- role there is, the owner of the table included.
-- ONE exception, which proves itself: the foreign keys to auth.users clear actor_id / owner_id / subject_id when an
-- account is deleted (so history never blocks that). An update is let through only when it changes nothing but
-- those columns, only to NULL, and only when the account they named no longer exists.
create function private.shared_rack_events_append_only() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'actor_id' - 'owner_id' - 'subject_id') = (to_jsonb(old) - 'actor_id' - 'owner_id' - 'subject_id')
     and (new.actor_id is not distinct from old.actor_id
          or (new.actor_id is null and not exists (select 1 from auth.users u where u.id = old.actor_id)))
     and (new.owner_id is not distinct from old.owner_id
          or (new.owner_id is null and not exists (select 1 from auth.users u where u.id = old.owner_id)))
     and (new.subject_id is not distinct from old.subject_id
          or (new.subject_id is null and not exists (select 1 from auth.users u where u.id = old.subject_id))) then
    return new;
  end if;
  raise exception 'shared_rack_events_append_only' using errcode = 'P0001';
end $$;
create trigger shared_rack_events_no_change before update or delete on private.shared_rack_events
  for each row execute function private.shared_rack_events_append_only();
create trigger shared_rack_events_no_truncate before truncate on private.shared_rack_events
  for each statement execute function private.shared_rack_events_append_only();

-- ---- 3. Helpers (private: no API role can call them) -------------------------------------------------------------

-- What a person is called: their name, else their account name. NULL when they have neither (or are gone).
create function private.shared_rack_person_name(p_user uuid) returns text
  language sql stable security definer set search_path = '' as $$
  select left(coalesce(nullif(btrim(p.display_name), ''), '@' || p.handle), 60)
    from public.profiles p where p.id = p_user
$$;

-- The wine of a bottle as the label reads, and nothing else about the bottle. NULL when it can no longer be read.
create function private.shared_rack_wine(p_bottle uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('producer', left(pr.name, 160), 'name', left(w.name, 160), 'year', v.year,
                            'type', w.wine_type, 'format_ml', b.format_ml)
    from public.bottles b
    join public.wine_vintages v on v.id = b.vintage_id
    join public.wines w on w.id = v.wine_id
    join public.producers pr on pr.id = w.producer_id
   where b.id = p_bottle
$$;

-- The one line of history every change writes. Each name is read NOW; the name handed in is used only when the
-- person can no longer be read (an account that is being deleted, an owner who is gone). A reference is kept only
-- to an account that exists at this moment: while an account is being deleted its household's bottles go too, and
-- the line that says so must not point at the account that is going (it would stop the deletion).
create function private.shared_rack_log(
  p_rack uuid, p_type text, p_actor uuid,
  p_owner uuid default null, p_owner_name text default null,
  p_subject uuid default null, p_subject_name text default null,
  p_placement uuid default null, p_bottle uuid default null, p_wine jsonb default null,
  p_from_row smallint default null, p_from_col smallint default null, p_from_index smallint default null,
  p_to_row smallint default null, p_to_col smallint default null, p_to_index smallint default null,
  p_detail jsonb default null, p_actor_name text default null
) returns void language sql volatile security definer set search_path = '' as $$
  insert into private.shared_rack_events
    (rack_id, event_type, actor_id, actor_name, owner_id, owner_name, subject_id, subject_name,
     placement_id, bottle_id, wine, from_row, from_col, from_index, to_row, to_col, to_index, detail)
  values
    (p_rack, p_type,
     (select u.id from auth.users u where u.id = p_actor),
     coalesce(private.shared_rack_person_name(p_actor), p_actor_name),
     (select u.id from auth.users u where u.id = p_owner),
     coalesce(private.shared_rack_person_name(p_owner), p_owner_name),
     (select u.id from auth.users u where u.id = p_subject),
     coalesce(private.shared_rack_person_name(p_subject), p_subject_name),
     p_placement, p_bottle, p_wine, p_from_row, p_from_col, p_from_index, p_to_row, p_to_col, p_to_index, p_detail)
$$;

-- THE CHECK EVERY WRITE STARTS WITH. Returns the caller's role in this rack ('owner' | 'member'), or NULL when
-- the caller is not an active member of it (or there is no such rack: the two are never told apart).
--   1. a look without a lock, so that someone who is not a member never holds a lock on a rack, even briefly;
--   2. the rack row FOR NO KEY UPDATE: from here on, no other call of these functions changes this rack until this
--      transaction ends (and a line of history written from an owner's own cellar is still let through: see the top);
--   3. the caller's own member row again, FOR SHARE and still 'active': read after the lock, so a removal that
--      committed while this waited is seen (and under REPEATABLE READ is a serialisation failure, never a pass).
create function private.shared_rack_lock(p_rack uuid) returns text
  language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_role text;
begin
  if uid is null or p_rack is null then return null; end if;
  perform 1 from private.shared_rack_members m
    where m.rack_id = p_rack and m.user_id = uid and m.status = 'active';
  if not found then return null; end if;
  perform 1 from private.shared_racks r where r.id = p_rack for no key update;
  if not found then return null; end if;
  select m.role into v_role from private.shared_rack_members m
   where m.rack_id = p_rack and m.user_id = uid and m.status = 'active'
     for share;
  if not found then return null; end if;
  return v_role;
end $$;

-- Whether someone is in a rack NOW.
create function private.shared_rack_is_member(p_rack uuid, p_user uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.shared_rack_members m
                  where m.rack_id = p_rack and m.user_id = p_user and m.status = 'active')
$$;

-- How much one person may write to shared racks: the history is permanent, so it must not be fillable by a loop.
create function private.shared_rack_spend(p_user uuid) returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.consume_rate_limit(p_user, 'shared_rack_write', 1200, interval '1 hour') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
end $$;

-- Invitations sent by someone who is no longer an owner of the rack do not stay open.
create function private.shared_rack_cancel_invitations_by(p_rack uuid, p_user uuid) returns void
  language sql volatile security definer set search_path = '' as $$
  update private.shared_rack_invitations
     set status = 'cancelled', responded_at = now()
   where rack_id = p_rack and invited_by = p_user and status = 'pending'
$$;

-- An account that is deleted takes its membership rows along (the foreign key). This writes what happened, from
-- the name kept on the row, and, when the account was the last owner, ARCHIVES the rack: members who remain keep
-- reading it and can take their bottles out, and nobody is made owner behind their back; a rack nobody is left in
-- is not left looking as if it were in use.
-- Leaving and being removed never delete a row (they change its status), so this runs for a deleted account only.
create function private.shared_rack_member_gone() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'active' then return old; end if;
  perform private.shared_rack_log(old.rack_id, 'member_removed', null,
    p_subject_name => old.display_name, p_detail => jsonb_build_object('reason', 'account_deleted'));
  if old.role = 'owner'
     and not exists (select 1 from private.shared_rack_members m
                      where m.rack_id = old.rack_id and m.user_id <> old.user_id
                        and m.status = 'active' and m.role = 'owner') then
    update private.shared_racks set archived_at = now() where id = old.rack_id and archived_at is null;
    if found then
      perform private.shared_rack_log(old.rack_id, 'rack_archived', null,
        p_detail => jsonb_build_object('reason', 'owner_account_deleted'));
    end if;
  end if;
  return old;
end $$;
create trigger shared_rack_members_gone before delete on private.shared_rack_members
  for each row execute function private.shared_rack_member_gone();

revoke all on function private.shared_rack_touch(), private.shared_rack_check_layout(),
  private.shared_rack_check_placement(), private.shared_rack_events_append_only(),
  private.shared_rack_person_name(uuid), private.shared_rack_wine(uuid),
  private.shared_rack_log(uuid, text, uuid, uuid, text, uuid, text, uuid, uuid, jsonb, smallint, smallint, smallint, smallint, smallint, smallint, jsonb, text),
  private.shared_rack_lock(uuid), private.shared_rack_is_member(uuid, uuid), private.shared_rack_spend(uuid),
  private.shared_rack_cancel_invitations_by(uuid, uuid), private.shared_rack_member_gone()
  from public, anon, authenticated, service_role;

-- ---- 4. The private cellar and the shared rack never disagree ---------------------------------------------------
-- A bottle is either in a private place or in a shared rack, never both, and only a bottle that is in the cellar
-- stands in a rack. So when its household (through the flows that exist: /api/v1/bottles, the Smart Cellar API,
-- PostgREST directly, a household that is deleted) gives it a private place, opens it, gives it away, removes it or
-- deletes it, the shared placement ends IN THAT TRANSACTION and the history says who did it.
--
-- For a bottle that is not in a shared rack this is ONE probe of a unique index and a return: no lock, no write,
-- nothing that can fail. The update trigger does not even fire unless the status or the place changed.
-- For a bottle that IS in a shared rack, the change waits for at most one call of a shared-rack function that is
-- working on that same bottle at that moment (the placement row's lock); it is never refused and never deadlocks.
-- SECURITY DEFINER: the person changing their own bottle holds no privilege on the shared-rack tables.
--
-- WHO DID IT is written into the rack's history only when that person is in the rack. A bottle belongs to a
-- household, and someone of that household who never joined the rack may open it at home: the members of the rack
-- (people of other households) are then told that it happened, and whose bottle it was, NOT who in that household
-- did it. Such a line has no actor and says `"by": "owners_household"`.
create function private.shared_rack_follow_bottle() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare p private.shared_rack_placements; v_type text; v_actor uuid := auth.uid(); v_detail jsonb := '{}';
begin
  if not exists (select 1 from private.shared_rack_placements x where x.bottle_id = old.id) then
    return old;
  end if;
  -- still in the cellar and without a private place: nothing about where it stands changed
  if tg_op = 'UPDATE' and new.status = 'in_cellar' and new.location_id is null then
    return new;
  end if;
  delete from private.shared_rack_placements x where x.bottle_id = old.id returning * into p;
  if not found then return old; end if;       -- ended by someone else while this waited for the row
  if tg_op = 'DELETE' then
    v_type := 'bottle_removed'; v_detail := jsonb_build_object('reason', 'deleted');
  elsif new.status = 'opened' then
    v_type := 'bottle_opened';
  elsif new.status = 'gifted' then
    v_type := 'bottle_gifted';
  elsif new.status = 'removed' then
    v_type := 'bottle_removed'; v_detail := jsonb_build_object('reason', 'removed');
  else
    v_type := 'bottle_relocated';             -- given a place in its household's own cellar: still a bottle
  end if;
  if v_actor is not null and not private.shared_rack_is_member(p.rack_id, v_actor) then
    v_actor := null;
    v_detail := v_detail || jsonb_build_object('by', 'owners_household');
  end if;
  perform private.shared_rack_log(p.rack_id, v_type, v_actor,
    p_owner => p.owner_user_id, p_owner_name => p.owner_name,
    p_placement => p.id, p_bottle => p.bottle_id,
    p_wine => coalesce(private.shared_rack_wine(p.bottle_id), p.wine),
    p_from_row => p.loc_row, p_from_col => p.loc_col, p_from_index => p.loc_index,
    p_detail => nullif(v_detail, '{}'::jsonb));
  return old;
end $$;
revoke all on function private.shared_rack_follow_bottle() from public, anon, authenticated, service_role;

create trigger bottles_shared_rack_update after update on public.bottles
  for each row
  when (old.status is distinct from new.status or old.location_id is distinct from new.location_id)
  execute function private.shared_rack_follow_bottle();
-- BEFORE delete: the history is written while the placement is still there (the cascade would remove it first).
create trigger bottles_shared_rack_delete before delete on public.bottles
  for each row execute function private.shared_rack_follow_bottle();

-- ---- 5. Reading -----------------------------------------------------------------------------------------------------
-- Each of these returns rows only to an ACTIVE member of the rack asked for. Anyone else, and any id that does not
-- exist, gets no rows: the two cannot be told apart.

-- My racks (or one of them, archived or not), with my role and how full each is.
create function public.shared_racks(p_rack uuid default null, p_include_archived boolean default false)
  returns table (id uuid, name text, kind text, template text, slot_semantics text,
                 grid_rows smallint, grid_cols smallint, cell_capacity smallint, appearance jsonb,
                 revision bigint, archived_at timestamptz, created_at timestamptz, updated_at timestamptz,
                 my_role text, member_count int, bottle_count int, my_bottle_count int)
  language sql stable security definer set search_path = '' as $$
  select r.id, r.name, r.kind::text, r.template, r.slot_semantics, r.grid_rows, r.grid_cols, r.cell_capacity,
         r.appearance, r.revision, r.archived_at, r.created_at, r.updated_at, m.role,
         (select count(*)::int from private.shared_rack_members x where x.rack_id = r.id and x.status = 'active'),
         (select count(*)::int from private.shared_rack_placements p where p.rack_id = r.id),
         (select count(*)::int from private.shared_rack_placements p
           where p.rack_id = r.id and p.owner_user_id = auth.uid())
    from private.shared_rack_members m
    join private.shared_racks r on r.id = m.rack_id
   where m.user_id = auth.uid() and m.status = 'active'
     and (p_rack is null or r.id = p_rack)
     and (p_rack is not null or p_include_archived or r.archived_at is null)
   order by r.created_at, r.id
$$;

-- The people of a rack: only those who are in it now.
create function public.shared_rack_members(p_rack uuid)
  returns table (user_id uuid, display_name text, handle text, role text, joined_at timestamptz,
                 bottle_count int, is_me boolean)
  language sql stable security definer set search_path = '' as $$
  select m.user_id, pr.display_name, pr.handle, m.role, m.joined_at,
         (select count(*)::int from private.shared_rack_placements p
           where p.rack_id = m.rack_id and p.owner_user_id = m.user_id),
         m.user_id = auth.uid()
    from private.shared_rack_members m
    join public.profiles pr on pr.id = m.user_id
   where m.rack_id = p_rack and m.status = 'active'
     and exists (select 1 from private.shared_rack_members me
                  where me.rack_id = p_rack and me.user_id = auth.uid() and me.status = 'active')
   order by (m.role = 'owner') desc, m.joined_at, m.user_id
$$;

-- THE PROJECTION: what someone standing at the rack sees of each bottle, and nothing more.
-- From public.bottles only format_ml is read, and its id; from the catalogue the names on the label. Never a
-- price, where or when it was bought, a note, a rating, a photo, the household, a private place, or the ids of the
-- wine and vintage. Only bottles WITH A PLACEMENT IN THIS RACK are joined at all.
-- bottle_id is given only to the bottle's own household; everyone else has the placement id to point at it.
create function public.shared_rack_bottles(p_rack uuid, p_owner uuid default null)
  returns table (placement_id uuid, bottle_id uuid, loc_row smallint, loc_col smallint, loc_index smallint,
                 owner_user_id uuid, owner_name text, owner_is_member boolean, is_mine boolean,
                 placed_by_name text, placed_at timestamptz, moved_at timestamptz,
                 producer text, wine_name text, year smallint, wine_type text, region text, country_code text,
                 format_ml int)
  language sql stable security definer set search_path = '' as $$
  select p.id,
         case when b.household_id = any (private.my_household_ids()) then b.id end,
         p.loc_row, p.loc_col, p.loc_index,
         p.owner_user_id,
         coalesce(private.shared_rack_person_name(p.owner_user_id), p.owner_name),
         exists (select 1 from private.shared_rack_members m
                  where m.rack_id = p.rack_id and m.user_id = p.owner_user_id and m.status = 'active'),
         p.owner_user_id is not distinct from auth.uid(),
         private.shared_rack_person_name(p.placed_by), p.placed_at, p.moved_at,
         prod.name, w.name, v.year, w.wine_type::text, w.region, w.country_code, b.format_ml
    from private.shared_rack_placements p
    join public.bottles b on b.id = p.bottle_id
    join public.wine_vintages v on v.id = b.vintage_id
    join public.wines w on w.id = v.wine_id
    join public.producers prod on prod.id = w.producer_id
   where p.rack_id = p_rack
     and (p_owner is null or p.owner_user_id = p_owner)
     and exists (select 1 from private.shared_rack_members me
                  where me.rack_id = p_rack and me.user_id = auth.uid() and me.status = 'active')
   order by p.loc_row, p.loc_col, p.loc_index
$$;

-- The history of a rack, newest first, a page at a time (`p_before`: the seq of the last row of the page before).
-- `p_placement` follows one bottle through the rack, also across being taken out and put back.
-- bottle_id is given only on the caller's own bottles.
create function public.shared_rack_events(
  p_rack uuid, p_before bigint default null, p_limit int default 50,
  p_owner uuid default null, p_actor uuid default null, p_placement uuid default null, p_bottle uuid default null
) returns table (seq bigint, event_type text, occurred_at timestamptz,
                 actor_id uuid, actor_name text, owner_id uuid, owner_name text, subject_id uuid, subject_name text,
                 placement_id uuid, bottle_id uuid, wine jsonb,
                 from_row smallint, from_col smallint, from_index smallint,
                 to_row smallint, to_col smallint, to_index smallint, detail jsonb)
  language sql stable security definer set search_path = '' as $$
  select e.seq, e.event_type, e.occurred_at, e.actor_id, e.actor_name, e.owner_id, e.owner_name,
         e.subject_id, e.subject_name, e.placement_id,
         case when e.owner_id = auth.uid() then e.bottle_id end,
         e.wine, e.from_row, e.from_col, e.from_index, e.to_row, e.to_col, e.to_index, e.detail
    from private.shared_rack_events e
   where e.rack_id = p_rack
     and exists (select 1 from private.shared_rack_members me
                  where me.rack_id = p_rack and me.user_id = auth.uid() and me.status = 'active')
     and (p_before is null or e.seq < p_before)
     and (p_owner is null or e.owner_id = p_owner)
     and (p_actor is null or e.actor_id = p_actor)
     -- by bottle id only for a bottle of the caller's own (anyone else's bottle is followed by a placement id):
     -- otherwise the count of rows would answer "was this bottle of someone else ever in this rack"
     and (p_bottle is null
          or (e.bottle_id = p_bottle
              and (e.owner_id = auth.uid()
                   or exists (select 1 from public.bottles b
                               where b.id = p_bottle and b.household_id = any (private.my_household_ids())))))
     and (p_placement is null
          or e.bottle_id = (select x.bottle_id from private.shared_rack_events x
                             where x.rack_id = p_rack and x.placement_id = p_placement limit 1))
   order by e.seq desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- The invitations of a rack, for its owners only. `status` says 'expired' for a pending one past its date.
create function public.shared_rack_invitations(p_rack uuid)
  returns table (id uuid, invited_user_id uuid, invited_name text, invited_handle text, invited_by_name text,
                 status text, created_at timestamptz, expires_at timestamptz, responded_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  select i.id, i.invited_user_id, pr.display_name, pr.handle, private.shared_rack_person_name(i.invited_by),
         case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
         i.created_at, i.expires_at, i.responded_at
    from private.shared_rack_invitations i
    join public.profiles pr on pr.id = i.invited_user_id
   where i.rack_id = p_rack
     and exists (select 1 from private.shared_rack_members me
                  where me.rack_id = p_rack and me.user_id = auth.uid()
                    and me.status = 'active' and me.role = 'owner')
   order by i.created_at desc, i.id
   limit 200
$$;

-- The invitations waiting for me: the rack's name and who asked. Nothing else of a rack is shown before I accept.
create function public.my_shared_rack_invitations()
  returns table (id uuid, rack_id uuid, rack_name text, invited_by_name text,
                 created_at timestamptz, expires_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  select i.id, r.id, r.name, private.shared_rack_person_name(i.invited_by), i.created_at, i.expires_at
    from private.shared_rack_invitations i
    join private.shared_racks r on r.id = i.rack_id
   where i.invited_user_id = auth.uid() and i.status = 'pending' and i.expires_at > now()
     and r.archived_at is null
   order by i.created_at desc, i.id
$$;

-- Which bottles of MY households stand in a shared rack. For my own cellar: a bottle without a place there may be
-- standing in a rack. The rack and the spot are named only while I am a member of it; after I left, `has_access` is
-- false and all I can do is withdraw the bottle (or use it in my own cellar).
create function public.my_shared_rack_bottles()
  returns table (bottle_id uuid, placement_id uuid, has_access boolean, rack_id uuid, rack_name text,
                 loc_row smallint, loc_col smallint, loc_index smallint, placed_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  select b.id, p.id, a.yes,
         case when a.yes then r.id end, case when a.yes then r.name end,
         case when a.yes then p.loc_row end, case when a.yes then p.loc_col end,
         case when a.yes then p.loc_index end, p.placed_at
    from public.bottles b
    join private.shared_rack_placements p on p.bottle_id = b.id
    join private.shared_racks r on r.id = p.rack_id
    cross join lateral (
      select exists (select 1 from private.shared_rack_members me
                      where me.rack_id = r.id and me.user_id = auth.uid() and me.status = 'active') as yes) a
   where auth.uid() is not null
     and b.household_id = any (private.my_household_ids())
   order by p.placed_at, p.id
$$;

-- ---- 6. Writing -----------------------------------------------------------------------------------------------------
-- Each answers a small JSON object: {"outcome": "..."} and, where there is one, an id. An outcome that is not the
-- success is a refusal: NOTHING was changed. 'not_found' is the answer to anyone who is not an active member, and
-- to an id that does not exist. Only what is malformed (a name too long, a size past the limits) and a spent
-- budget are errors of the usual kind.

-- A new rack; whoever makes it is its first owner.
create function public.shared_rack_create(
  p_name text, p_kind public.location_kind, p_template text, p_slot_semantics text,
  p_rows smallint, p_cols smallint, p_cell_capacity smallint, p_appearance jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_rack uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.consume_rate_limit(uid, 'shared_rack_create', 10, interval '1 hour') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if (select count(*) from private.shared_rack_members m
        join private.shared_racks r on r.id = m.rack_id
       where m.user_id = uid and m.status = 'active' and r.archived_at is null) >= 20 then
    return jsonb_build_object('outcome', 'too_many');
  end if;
  if p_cell_capacity > 1 and not private.depth_placement_enabled() then
    return jsonb_build_object('outcome', 'depth_not_enabled');
  end if;
  insert into private.shared_racks (name, kind, template, slot_semantics, grid_rows, grid_cols, cell_capacity, appearance, created_by)
  values (btrim(p_name), p_kind, p_template, p_slot_semantics, p_rows, p_cols, p_cell_capacity, p_appearance, uid)
  returning id into v_rack;
  insert into private.shared_rack_members (rack_id, user_id, role, display_name)
  values (v_rack, uid, 'owner', private.shared_rack_person_name(uid));
  perform private.shared_rack_log(v_rack, 'rack_created', uid, p_detail => jsonb_build_object('name', btrim(p_name)));
  return jsonb_build_object('outcome', 'created', 'rack_id', v_rack);
end $$;

create function public.shared_rack_rename(p_rack uuid, p_name text) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); me text; r private.shared_racks;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  perform private.shared_rack_spend(uid);
  me := private.shared_rack_lock(p_rack);
  if me is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if me <> 'owner' then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into r from private.shared_racks x where x.id = p_rack;
  if r.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
  if r.name = btrim(p_name) then return jsonb_build_object('outcome', 'unchanged'); end if;
  update private.shared_racks set name = btrim(p_name) where id = p_rack;
  perform private.shared_rack_log(p_rack, 'rack_renamed', uid,
    p_detail => jsonb_build_object('from', r.name, 'to', btrim(p_name)));
  return jsonb_build_object('outcome', 'renamed');
end $$;

-- The whole layout and look, replaced in one go or not at all. `p_expected_revision` (optional) is the revision the
-- caller's draft started from: compared HERE, behind the rack's lock, so two saves can never both win.
-- The database does not know the catalogue: that the template exists, belongs to the kind and comes in this size
-- and look is checked by the server (packages/domain, StorageConfigSchema) before it calls.
create function public.shared_rack_save_layout(
  p_rack uuid, p_kind public.location_kind, p_template text, p_slot_semantics text,
  p_rows smallint, p_cols smallint, p_cell_capacity smallint, p_appearance jsonb,
  p_expected_revision bigint default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); me text; r private.shared_racks; v_revision bigint;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  perform private.shared_rack_spend(uid);
  me := private.shared_rack_lock(p_rack);
  if me is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if me <> 'owner' then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into r from private.shared_racks x where x.id = p_rack;
  if r.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
  if p_expected_revision is not null and p_expected_revision <> r.revision then
    return jsonb_build_object('outcome', 'stale', 'revision', r.revision);
  end if;
  if p_cell_capacity > 1 and p_cell_capacity is distinct from r.cell_capacity
     and not private.depth_placement_enabled() then
    return jsonb_build_object('outcome', 'depth_not_enabled');
  end if;
  if exists (select 1 from private.shared_rack_placements p
              where p.rack_id = p_rack
                and (p.loc_row > p_rows or p.loc_col > p_cols or p.loc_index > p_cell_capacity)) then
    return jsonb_build_object('outcome', 'in_use');
  end if;
  if p_slot_semantics is distinct from r.slot_semantics and r.cell_capacity > 1
     and exists (select 1 from private.shared_rack_placements p where p.rack_id = p_rack) then
    return jsonb_build_object('outcome', 'semantics_change');
  end if;
  update private.shared_racks
     set kind = p_kind, template = p_template, slot_semantics = p_slot_semantics,
         grid_rows = p_rows, grid_cols = p_cols, cell_capacity = p_cell_capacity, appearance = p_appearance
   where id = p_rack
   returning revision into v_revision;
  perform private.shared_rack_log(p_rack, 'rack_layout_changed', uid,
    p_detail => jsonb_build_object('template', p_template, 'rows', p_rows, 'cols', p_cols, 'cell_capacity', p_cell_capacity));
  return jsonb_build_object('outcome', 'saved', 'revision', v_revision);
end $$;

-- Archived: nothing is placed, moved or changed any more; bottles can still be taken out and people can still
-- leave. Restoring puts it back as it was.
create function public.shared_rack_set_archived(p_rack uuid, p_archived boolean) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); me text; r private.shared_racks;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_archived is null then raise exception 'invalid_arguments' using errcode = '22023'; end if;
  perform private.shared_rack_spend(uid);
  me := private.shared_rack_lock(p_rack);
  if me is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if me <> 'owner' then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into r from private.shared_racks x where x.id = p_rack;
  if (r.archived_at is not null) = p_archived then return jsonb_build_object('outcome', 'unchanged'); end if;
  update private.shared_racks set archived_at = case when p_archived then now() end where id = p_rack;
  if p_archived then
    -- nobody can accept into an archived rack: the open invitations end here
    update private.shared_rack_invitations set status = 'cancelled', responded_at = now()
     where rack_id = p_rack and status = 'pending';
  end if;
  perform private.shared_rack_log(p_rack, case when p_archived then 'rack_archived' else 'rack_restored' end, uid);
  return jsonb_build_object('outcome', case when p_archived then 'archived' else 'restored' end);
end $$;

-- An owner invites one existing person, by id (the id comes from public.find_person: an exact account name or
-- friend code; there is no other lookup, and this is not one: an unknown id is answered and counted like any try).
-- Being friends is NOT required (a friendship in this app shares one's own cellar views; colleagues sharing a rack
-- must not have to). What keeps an invitation from being a way to pester someone: 30 an hour per inviter, a week
-- of quiet after a no (per rack, and per inviter over all racks), at most three open ones from one person to another.
create function public.shared_rack_invite(p_rack uuid, p_user uuid) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); me text; r private.shared_racks; inv private.shared_rack_invitations; v_id uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.consume_rate_limit(uid, 'shared_rack_invite', 30, interval '1 hour') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  me := private.shared_rack_lock(p_rack);
  if me is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if me <> 'owner' then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into r from private.shared_racks x where x.id = p_rack;
  if r.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
  if p_user is null or p_user = uid then return jsonb_build_object('outcome', 'invalid'); end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    return jsonb_build_object('outcome', 'no_such_user');
  end if;
  if exists (select 1 from private.shared_rack_members m
              where m.rack_id = p_rack and m.user_id = p_user and m.status = 'active') then
    return jsonb_build_object('outcome', 'already_member');
  end if;
  select * into inv from private.shared_rack_invitations i
   where i.rack_id = p_rack and i.invited_user_id = p_user and i.status = 'pending'
     for update;
  if found then
    if inv.expires_at > now() then
      return jsonb_build_object('outcome', 'already_invited', 'invitation_id', inv.id);
    end if;
    update private.shared_rack_invitations set status = 'cancelled', responded_at = now() where id = inv.id;
  end if;
  -- Someone who said no is not asked again for a week: not for this rack by anyone, and not by this person for ANY
  -- rack (a new rack with a new name is not a way around a no).
  if exists (select 1 from private.shared_rack_invitations i
              where i.invited_user_id = p_user and i.status = 'declined'
                and (i.rack_id = p_rack or i.invited_by = uid)
                and i.responded_at > now() - interval '7 days') then
    return jsonb_build_object('outcome', 'recently_declined');
  end if;
  -- ...and one person does not fill another's list: at most three open invitations from me to them, over all racks.
  if (select count(*) from private.shared_rack_invitations i
       where i.invited_by = uid and i.invited_user_id = p_user
         and i.status = 'pending' and i.expires_at > now()) >= 3 then
    return jsonb_build_object('outcome', 'person_limit');
  end if;
  if (select count(*) from private.shared_rack_members m where m.rack_id = p_rack and m.status = 'active') >= 12 then
    return jsonb_build_object('outcome', 'full');
  end if;
  if (select count(*) from private.shared_rack_invitations i
       where i.rack_id = p_rack and i.status = 'pending' and i.expires_at > now()) >= 20 then
    return jsonb_build_object('outcome', 'too_many');
  end if;
  insert into private.shared_rack_invitations (rack_id, invited_user_id, invited_by)
  values (p_rack, p_user, uid) returning id into v_id;
  return jsonb_build_object('outcome', 'invited', 'invitation_id', v_id);
end $$;

-- Yes or no to an invitation that was sent to ME. Accepting twice changes nothing the second time; an invitation
-- that was accepted once is spent for good (someone who was removed since does not get back in with it).
create function public.shared_rack_respond_invitation(p_invitation uuid, p_accept boolean) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_rack uuid; inv private.shared_rack_invitations; r private.shared_racks;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_accept is null then raise exception 'invalid_arguments' using errcode = '22023'; end if;
  perform private.shared_rack_spend(uid);
  select i.rack_id into v_rack from private.shared_rack_invitations i
   where i.id = p_invitation and i.invited_user_id = uid;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  -- the rack first, as every write does: two answers to one invitation take turns here
  select * into r from private.shared_racks x where x.id = v_rack for no key update;
  select * into inv from private.shared_rack_invitations i
   where i.id = p_invitation and i.invited_user_id = uid for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if inv.status <> 'pending' then
    return jsonb_build_object('outcome', 'already_' || inv.status, 'rack_id',
                              case when inv.status = 'accepted' then inv.rack_id end);
  end if;
  if not p_accept then
    update private.shared_rack_invitations set status = 'declined', responded_at = now() where id = inv.id;
    return jsonb_build_object('outcome', 'declined');
  end if;
  if inv.expires_at <= now() then return jsonb_build_object('outcome', 'expired'); end if;
  if r.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
  if exists (select 1 from private.shared_rack_members m
              where m.rack_id = v_rack and m.user_id = uid and m.status = 'active') then
    update private.shared_rack_invitations set status = 'accepted', responded_at = now() where id = inv.id;
    return jsonb_build_object('outcome', 'accepted', 'rack_id', v_rack);
  end if;
  if (select count(*) from private.shared_rack_members m where m.rack_id = v_rack and m.status = 'active') >= 12 then
    return jsonb_build_object('outcome', 'full');
  end if;
  -- the same cap as on making a rack: nobody is in more than 20 racks that are in use
  if (select count(*) from private.shared_rack_members m
        join private.shared_racks x on x.id = m.rack_id
       where m.user_id = uid and m.status = 'active' and x.archived_at is null) >= 20 then
    return jsonb_build_object('outcome', 'too_many_racks');
  end if;
  insert into private.shared_rack_members (rack_id, user_id, role, display_name, invited_by)
  values (v_rack, uid, 'member', private.shared_rack_person_name(uid), inv.invited_by)
  on conflict (rack_id, user_id) do update
     set role = 'member', status = 'active', joined_at = now(), ended_at = null, ended_by = null,
         display_name = excluded.display_name, invited_by = excluded.invited_by;
  update private.shared_rack_invitations set status = 'accepted', responded_at = now() where id = inv.id;
  perform private.shared_rack_log(v_rack, 'member_joined', uid, p_subject => uid,
    p_detail => jsonb_build_object('invited_by', private.shared_rack_person_name(inv.invited_by)));
  return jsonb_build_object('outcome', 'accepted', 'rack_id', v_rack);
end $$;

-- An owner takes back an invitation that is still open.
create function public.shared_rack_cancel_invitation(p_invitation uuid) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_rack uuid; me text; inv private.shared_rack_invitations;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  perform private.shared_rack_spend(uid);
  select i.rack_id into v_rack from private.shared_rack_invitations i where i.id = p_invitation;
  -- not a member of that rack (or no such invitation): one and the same answer
  me := private.shared_rack_lock(v_rack);
  if me is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if me <> 'owner' then return jsonb_build_object('outcome', 'forbidden'); end if;
  select * into inv from private.shared_rack_invitations i where i.id = p_invitation for update;
  if inv.status <> 'pending' then return jsonb_build_object('outcome', 'already_' || inv.status); end if;
  update private.shared_rack_invitations set status = 'cancelled', responded_at = now() where id = inv.id;
  return jsonb_build_object('outcome', 'cancelled');
end $$;

-- An owner makes a member an owner, or an owner a member. There is always at least one owner: the last one cannot
-- be made a member (hand the role over first). This is the only way the owner role moves: explicitly.
create function public.shared_rack_set_member_role(p_rack uuid, p_user uuid, p_role text) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); me text; v_old text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('owner', 'member') then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  perform private.shared_rack_spend(uid);
  me := private.shared_rack_lock(p_rack);
  if me is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if me <> 'owner' then return jsonb_build_object('outcome', 'forbidden'); end if;
  select m.role into v_old from private.shared_rack_members m
   where m.rack_id = p_rack and m.user_id = p_user and m.status = 'active' for update;
  if not found then return jsonb_build_object('outcome', 'no_such_member'); end if;
  if v_old = p_role then return jsonb_build_object('outcome', 'unchanged'); end if;
  if p_role = 'member'
     and not exists (select 1 from private.shared_rack_members m
                      where m.rack_id = p_rack and m.user_id <> p_user
                        and m.status = 'active' and m.role = 'owner') then
    return jsonb_build_object('outcome', 'last_owner');
  end if;
  update private.shared_rack_members set role = p_role where rack_id = p_rack and user_id = p_user;
  if p_role = 'member' then perform private.shared_rack_cancel_invitations_by(p_rack, p_user); end if;
  perform private.shared_rack_log(p_rack, 'member_role_changed', uid, p_subject => p_user,
    p_detail => jsonb_build_object('from', v_old, 'to', p_role));
  return jsonb_build_object('outcome', 'changed');
end $$;

-- An owner removes someone else. Their access ends with this transaction. THEIR BOTTLES ARE NOT TOUCHED: they stay
-- theirs, in their own household, and stay where they stand in the rack until someone takes them out.
create function public.shared_rack_remove_member(p_rack uuid, p_user uuid) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); me text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  perform private.shared_rack_spend(uid);
  me := private.shared_rack_lock(p_rack);
  if me is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if me <> 'owner' then return jsonb_build_object('outcome', 'forbidden'); end if;
  if p_user is null or p_user = uid then return jsonb_build_object('outcome', 'invalid'); end if;   -- that is leaving
  update private.shared_rack_members
     set status = 'removed', ended_at = now(), ended_by = uid
   where rack_id = p_rack and user_id = p_user and status = 'active';
  if not found then return jsonb_build_object('outcome', 'no_such_member'); end if;
  perform private.shared_rack_cancel_invitations_by(p_rack, p_user);
  perform private.shared_rack_log(p_rack, 'member_removed', uid, p_subject => p_user);
  return jsonb_build_object('outcome', 'removed');
end $$;

-- I leave. The last owner cannot: they hand the role over first, or archive the rack. Nothing is transferred by
-- leaving, and my bottles stay mine and stay where they stand.
create function public.shared_rack_leave(p_rack uuid) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); me text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  perform private.shared_rack_spend(uid);
  me := private.shared_rack_lock(p_rack);
  if me is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if me = 'owner'
     and not exists (select 1 from private.shared_rack_members m
                      where m.rack_id = p_rack and m.user_id <> uid
                        and m.status = 'active' and m.role = 'owner') then
    return jsonb_build_object('outcome', 'last_owner');
  end if;
  update private.shared_rack_members
     set status = 'left', ended_at = now(), ended_by = uid
   where rack_id = p_rack and user_id = uid and status = 'active';
  perform private.shared_rack_cancel_invitations_by(p_rack, uid);
  perform private.shared_rack_log(p_rack, 'member_left', uid, p_subject => uid);
  return jsonb_build_object('outcome', 'left');
end $$;

-- I put a bottle OF MY OWN HOUSEHOLD on a free spot. I am its owner in the rack: there is no argument that says
-- otherwise. A bottle that stood in a private place of mine is taken off it here, in the same transaction (it is
-- one physical act); nothing else about the bottle is written.
create function public.shared_rack_place(
  p_rack uuid, p_bottle uuid, p_row smallint, p_col smallint, p_index smallint
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); me text; r private.shared_racks; b public.bottles;
        p private.shared_rack_placements; v_id uuid; v_wine jsonb;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  perform private.shared_rack_spend(uid);
  me := private.shared_rack_lock(p_rack);
  if me is null then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into r from private.shared_racks x where x.id = p_rack;
  if r.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
  -- the bottle must be one of a household I am in: the same rule as the household's own policies, checked here
  select x.* into b from public.bottles x
   where x.id = p_bottle
     and exists (select 1 from public.household_members hm
                  where hm.household_id = x.household_id and hm.user_id = uid)
     for update;
  if not found then return jsonb_build_object('outcome', 'bottle_not_found'); end if;
  if b.status <> 'in_cellar' then return jsonb_build_object('outcome', 'bottle_unavailable'); end if;
  select * into p from private.shared_rack_placements x where x.bottle_id = b.id;
  if found then
    if p.rack_id = p_rack and (p.loc_row, p.loc_col, p.loc_index) = (p_row, p_col, p_index) then
      return jsonb_build_object('outcome', 'already_there', 'placement_id', p.id);
    end if;
    return jsonb_build_object('outcome', 'already_placed');
  end if;
  if p_row is null or p_col is null or p_index is null or p_row < 1 or p_col < 1 or p_index < 1
     or p_row > r.grid_rows or p_col > r.grid_cols or p_index > r.cell_capacity then
    return jsonb_build_object('outcome', 'out_of_bounds');
  end if;
  if exists (select 1 from private.shared_rack_placements x
              where x.rack_id = p_rack and (x.loc_row, x.loc_col, x.loc_index) = (p_row, p_col, p_index)) then
    return jsonb_build_object('outcome', 'taken');
  end if;
  if b.location_id is not null then
    update public.bottles set location_id = null, loc_row = null, loc_col = null where id = b.id;
  end if;
  v_wine := private.shared_rack_wine(b.id);
  insert into private.shared_rack_placements (rack_id, loc_row, loc_col, loc_index, bottle_id, owner_user_id, owner_name, wine, placed_by)
  values (p_rack, p_row, p_col, p_index, b.id, uid, private.shared_rack_person_name(uid), v_wine, uid)
  returning id into v_id;
  perform private.shared_rack_log(p_rack, 'bottle_placed', uid, p_owner => uid,
    p_placement => v_id, p_bottle => b.id, p_wine => v_wine,
    p_to_row => p_row, p_to_col => p_col, p_to_index => p_index);
  return jsonb_build_object('outcome', 'placed', 'placement_id', v_id);
end $$;

-- Any member moves any bottle to a free spot of the same rack (reorganising a physical rack), only while it still
-- stands on the whole spot the caller SAW it on. A repeat of a move that already happened answers 'already_there'.
-- Whose bottle it is does not change, and the bottle's own record is not touched.
create function public.shared_rack_move(
  p_rack uuid, p_placement uuid,
  p_from_row smallint, p_from_col smallint, p_from_index smallint,
  p_to_row smallint, p_to_col smallint, p_to_index smallint
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); me text; r private.shared_racks; p private.shared_rack_placements;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  perform private.shared_rack_spend(uid);
  me := private.shared_rack_lock(p_rack);
  if me is null then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into r from private.shared_racks x where x.id = p_rack;
  if r.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
  select * into p from private.shared_rack_placements x where x.id = p_placement and x.rack_id = p_rack for update;
  if not found then
    return jsonb_build_object('outcome', case when exists (
      select 1 from private.shared_rack_events e where e.rack_id = p_rack and e.placement_id = p_placement)
      then 'gone' else 'not_found' end);
  end if;
  if (p.loc_row, p.loc_col, p.loc_index) is not distinct from (p_to_row, p_to_col, p_to_index) then
    return jsonb_build_object('outcome', 'already_there');
  end if;
  if (p.loc_row, p.loc_col, p.loc_index) is distinct from (p_from_row, p_from_col, p_from_index) then
    return jsonb_build_object('outcome', 'stale', 'row', p.loc_row, 'col', p.loc_col, 'index', p.loc_index);
  end if;
  if p_to_row is null or p_to_col is null or p_to_index is null or p_to_row < 1 or p_to_col < 1 or p_to_index < 1
     or p_to_row > r.grid_rows or p_to_col > r.grid_cols or p_to_index > r.cell_capacity then
    return jsonb_build_object('outcome', 'out_of_bounds');
  end if;
  if exists (select 1 from private.shared_rack_placements x
              where x.rack_id = p_rack and (x.loc_row, x.loc_col, x.loc_index) = (p_to_row, p_to_col, p_to_index)) then
    return jsonb_build_object('outcome', 'taken');
  end if;
  update private.shared_rack_placements
     set loc_row = p_to_row, loc_col = p_to_col, loc_index = p_to_index, moved_at = now()
   where id = p.id;
  perform private.shared_rack_log(p_rack, 'bottle_moved', uid,
    p_owner => p.owner_user_id, p_owner_name => p.owner_name,
    p_placement => p.id, p_bottle => p.bottle_id, p_wine => coalesce(private.shared_rack_wine(p.bottle_id), p.wine),
    p_from_row => p.loc_row, p_from_col => p.loc_col, p_from_index => p.loc_index,
    p_to_row => p_to_row, p_to_col => p_to_col, p_to_index => p_to_index);
  return jsonb_build_object('outcome', 'moved');
end $$;

-- "I took this bottle out of the rack", by any member, about any bottle, only while it still stands where the
-- caller saw it. The placement ends and the history names the taker and the owner.
-- IT IS NOT "CONSUMED": the bottle's own record (status, household, everything private) is not touched at all. It
-- shows in its owner's cellar without a place, and what became of it is for the owner to say, in their own cellar.
-- Works in an archived rack too: bottles must always be able to come out.
create function public.shared_rack_take_out(
  p_rack uuid, p_placement uuid, p_from_row smallint, p_from_col smallint, p_from_index smallint
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); me text; p private.shared_rack_placements;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  perform private.shared_rack_spend(uid);
  me := private.shared_rack_lock(p_rack);
  if me is null then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into p from private.shared_rack_placements x where x.id = p_placement and x.rack_id = p_rack for update;
  if not found then
    return jsonb_build_object('outcome', case when exists (
      select 1 from private.shared_rack_events e where e.rack_id = p_rack and e.placement_id = p_placement)
      then 'gone' else 'not_found' end);
  end if;
  if (p.loc_row, p.loc_col, p.loc_index) is distinct from (p_from_row, p_from_col, p_from_index) then
    return jsonb_build_object('outcome', 'stale', 'row', p.loc_row, 'col', p.loc_col, 'index', p.loc_index);
  end if;
  delete from private.shared_rack_placements where id = p.id;
  perform private.shared_rack_log(p_rack, 'bottle_taken_out', uid,
    p_owner => p.owner_user_id, p_owner_name => p.owner_name,
    p_placement => p.id, p_bottle => p.bottle_id, p_wine => coalesce(private.shared_rack_wine(p.bottle_id), p.wine),
    p_from_row => p.loc_row, p_from_col => p.loc_col, p_from_index => p.loc_index);
  return jsonb_build_object('outcome', 'taken_out');
end $$;

-- The owner's side: "my bottle is no longer in that rack". Allowed to the members of the BOTTLE'S HOUSEHOLD,
-- whether or not they are (still) a member of the rack: so leaving a rack, or being removed from it, never leaves
-- someone unable to get their own bottle's record back. It says nothing about the rack and needs no access to it.
-- As with the trigger on bottles: who did it is named in the rack's history only when they are in the rack.
create function public.shared_rack_withdraw_bottle(p_bottle uuid) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p private.shared_rack_placements; v_known boolean;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  perform private.shared_rack_spend(uid);
  if not exists (select 1 from public.bottles b
                  join public.household_members hm on hm.household_id = b.household_id and hm.user_id = uid
                 where b.id = p_bottle) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  delete from private.shared_rack_placements x where x.bottle_id = p_bottle returning * into p;
  if not found then return jsonb_build_object('outcome', 'not_placed'); end if;
  v_known := private.shared_rack_is_member(p.rack_id, uid);
  perform private.shared_rack_log(p.rack_id, 'bottle_withdrawn', case when v_known then uid end,
    p_owner => p.owner_user_id, p_owner_name => p.owner_name,
    p_placement => p.id, p_bottle => p.bottle_id, p_wine => coalesce(private.shared_rack_wine(p.bottle_id), p.wine),
    p_from_row => p.loc_row, p_from_col => p.loc_col, p_from_index => p.loc_index,
    p_detail => case when v_known then null else jsonb_build_object('by', 'owners_household') end);
  return jsonb_build_object('outcome', 'withdrawn');
end $$;

-- ---- 7. Who may call what -------------------------------------------------------------------------------------------
-- Signed-in people only: not anon, and not the service role either (it has no person to act as: every function
-- here would refuse it anyway).
revoke all on function
  public.shared_racks(uuid, boolean), public.shared_rack_members(uuid), public.shared_rack_bottles(uuid, uuid),
  public.shared_rack_events(uuid, bigint, int, uuid, uuid, uuid, uuid), public.shared_rack_invitations(uuid),
  public.my_shared_rack_invitations(), public.my_shared_rack_bottles(),
  public.shared_rack_create(text, public.location_kind, text, text, smallint, smallint, smallint, jsonb),
  public.shared_rack_rename(uuid, text),
  public.shared_rack_save_layout(uuid, public.location_kind, text, text, smallint, smallint, smallint, jsonb, bigint),
  public.shared_rack_set_archived(uuid, boolean), public.shared_rack_invite(uuid, uuid),
  public.shared_rack_respond_invitation(uuid, boolean), public.shared_rack_cancel_invitation(uuid),
  public.shared_rack_set_member_role(uuid, uuid, text), public.shared_rack_remove_member(uuid, uuid),
  public.shared_rack_leave(uuid), public.shared_rack_place(uuid, uuid, smallint, smallint, smallint),
  public.shared_rack_move(uuid, uuid, smallint, smallint, smallint, smallint, smallint, smallint),
  public.shared_rack_take_out(uuid, uuid, smallint, smallint, smallint), public.shared_rack_withdraw_bottle(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.shared_racks(uuid, boolean), public.shared_rack_members(uuid), public.shared_rack_bottles(uuid, uuid),
  public.shared_rack_events(uuid, bigint, int, uuid, uuid, uuid, uuid), public.shared_rack_invitations(uuid),
  public.my_shared_rack_invitations(), public.my_shared_rack_bottles(),
  public.shared_rack_create(text, public.location_kind, text, text, smallint, smallint, smallint, jsonb),
  public.shared_rack_rename(uuid, text),
  public.shared_rack_save_layout(uuid, public.location_kind, text, text, smallint, smallint, smallint, jsonb, bigint),
  public.shared_rack_set_archived(uuid, boolean), public.shared_rack_invite(uuid, uuid),
  public.shared_rack_respond_invitation(uuid, boolean), public.shared_rack_cancel_invitation(uuid),
  public.shared_rack_set_member_role(uuid, uuid, text), public.shared_rack_remove_member(uuid, uuid),
  public.shared_rack_leave(uuid), public.shared_rack_place(uuid, uuid, smallint, smallint, smallint),
  public.shared_rack_move(uuid, uuid, smallint, smallint, smallint, smallint, smallint, smallint),
  public.shared_rack_take_out(uuid, uuid, smallint, smallint, smallint), public.shared_rack_withdraw_bottle(uuid)
  to authenticated;
