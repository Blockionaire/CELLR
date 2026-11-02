begin;
-- 20261113000036_push_reminders_repair.sql. Production ran every migration through 0035 except
-- 20261018000013_push_reminders.sql. This file recreates that state inside its transaction (0013 created only the two
-- tables dropped below), shows what broke (the Wine Master Database could not open a wine with a vintage), runs the
-- repair file itself, and checks the result is the same as 0013's: tables, policies, grants and behaviour.
do $$
declare h uuid; p uuid;
begin
  perform test.mk_users(2);
  perform test.as_user(1); h := public.create_household('Reminders 1');
  perform test.su();
  insert into public.producers (id, name, country_code, status, origin)
    values ('bbbbbbbb-0000-0000-0000-0000000000d1', 'Rappel', 'FR', 'canonical', 'verified') returning id into p;
  insert into public.wines (id, producer_id, name, wine_type, status, origin) values
    ('cccccccc-0000-0000-0000-0000000000d1', p, 'Avec Millésime', 'red', 'canonical', 'verified'),
    ('cccccccc-0000-0000-0000-0000000000d2', p, 'Sans Millésime', 'red', 'canonical', 'verified');
  insert into public.wine_vintages (id, wine_id, year) values
    ('dddddddd-0000-0000-0000-0000000000d1', 'cccccccc-0000-0000-0000-0000000000d1', 2015),
    ('dddddddd-0000-0000-0000-0000000000d2', 'cccccccc-0000-0000-0000-0000000000d1', 2019);
  perform test.as_user(1);
  insert into public.bottles (household_id, vintage_id) values (h, 'dddddddd-0000-0000-0000-0000000000d1');
  perform test.su();
end $$;

-- ---- a database without 0013, as production --------------------------------------------------------------------
drop table public.drink_notices;
drop table public.push_subscriptions;

do $$
begin
  perform test.as_service();
  perform test.rec('without 0013, a wine with a vintage cannot be opened: 42P01 on public.drink_notices',
    test.error_of('select public.admin_wine_master_record(''cccccccc-0000-0000-0000-0000000000d1'')')
      like '42P01:%drink_notices%');
  perform test.rec('...while a wine without vintages opens',
    public.admin_wine_master_record('cccccccc-0000-0000-0000-0000000000d2') is not null);
  perform test.rec('...and an unused vintage cannot be removed either',
    test.error_of(format('select public.admin_vintage_delete(%L, %L, %L)', 'dddddddd-0000-0000-0000-0000000000d2',
                         'mistake', test.uid(2))) like '42P01:%drink_notices%');
  perform test.su();
end $$;

-- ---- the repair ----------------------------------------------------------------------------------------------------
\ir ../migrations/20261113000036_push_reminders_repair.sql

do $$
declare j jsonb; r text;
begin
  perform test.as_service();
  j := public.admin_wine_master_record('cccccccc-0000-0000-0000-0000000000d1');
  perform test.rec('after the repair the wine opens; the vintage with a bottle is in use, the other is not',
    (select (v->>'inUse')::boolean from jsonb_array_elements(j->'vintages') v where v->>'year' = '2015')
    and not (select (v->>'inUse')::boolean from jsonb_array_elements(j->'vintages') v where v->>'year' = '2019'));
  r := public.admin_vintage_delete('dddddddd-0000-0000-0000-0000000000d2', 'mistake', test.uid(2));
  perform test.rec('...and the unused vintage can be removed (audited, as before)',
    r = 'ok' and (select count(*) from public.wine_vintages where wine_id = 'cccccccc-0000-0000-0000-0000000000d1') = 1
    and exists (select 1 from public.master_audit a where a.entity_id = 'dddddddd-0000-0000-0000-0000000000d2'
                  and a.action = 'delete_vintage'));
  perform test.su();
  perform test.rec('both tables are back with row level security and 0013''s five policies',
    (select bool_and(relrowsecurity) from pg_class
      where oid in ('public.push_subscriptions'::regclass, 'public.drink_notices'::regclass))
    and (select count(*) from pg_policies where schemaname = 'public'
           and tablename in ('push_subscriptions', 'drink_notices')) = 5);
  perform test.rec('...with 0013''s grants: the service role all, signed-in people only their columns',
    has_table_privilege('service_role', 'public.drink_notices', 'select, insert, update, delete')
    and has_table_privilege('service_role', 'public.push_subscriptions', 'select, insert, update, delete')
    and has_column_privilege('authenticated', 'public.push_subscriptions', 'endpoint', 'insert')
    and not has_column_privilege('authenticated', 'public.push_subscriptions', 'user_id', 'insert')
    and has_column_privilege('authenticated', 'public.drink_notices', 'vintage_id', 'insert')
    and not has_table_privilege('authenticated', 'public.drink_notices', 'update')
    and not has_table_privilege('anon', 'public.drink_notices', 'select'));
  perform test.rec('...and the service role gets nothing beyond the two tables (no sequence grants added)',
    not has_sequence_privilege('service_role', 'public.master_audit_id_seq', 'usage'));

  perform test.as_user(1);
  insert into public.drink_notices (vintage_id, kind) values ('dddddddd-0000-0000-0000-0000000000d1', 'peak');
  perform test.rec('a person records their own reminder and sees it', test.count_of('select 1 from public.drink_notices') = 1);
  perform test.as_user(2);
  perform test.rec('...nobody else sees it', test.cannot_read('select 1 from public.drink_notices'));
  perform test.as_service();
  perform test.rec('a reminder already sent keeps its vintage "in use"',
    (select (v->>'inUse')::boolean
       from jsonb_array_elements(public.admin_wine_master_record('cccccccc-0000-0000-0000-0000000000d1')->'vintages') v
      where v->>'year' = '2015'));
  perform test.su();
end $$;

-- ---- running it again changes nothing -------------------------------------------------------------------------------
\ir ../migrations/20261113000036_push_reminders_repair.sql

do $$
begin
  perform test.rec('the repair is idempotent: same policies, the reminder kept',
    (select count(*) from pg_policies where schemaname = 'public'
       and tablename in ('push_subscriptions', 'drink_notices')) = 5
    and (select count(*) from public.drink_notices) = 1);
end $$;
rollback;
