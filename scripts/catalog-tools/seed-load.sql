-- Representative LOCAL load for the search benchmark (Sprint 004A). Synthetic and clearly so: "Synthetic Producer
-- 0001"… are not wines. Run on a throwaway database only (scripts/catalog-tools/pilot.sh).
--   * 1 test person in a test household, with 300 own wines and bottles of 100 of them;
--   * 200 other households with 50 own wines each (10,000 wines that must never appear in the test household's search).
\set ON_ERROR_STOP on
insert into auth.users (id, email) values ('bbbbbbbb-0000-0000-0000-000000000001', 'pilot@example.test');
insert into public.households (id, name, created_by)
  values ('cccccccc-0000-0000-0000-000000000001', 'Pilot household', 'bbbbbbbb-0000-0000-0000-000000000001');
insert into public.household_members (household_id, user_id, role)
  values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');
insert into public.households (id, name)
  select ('dddddddd-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'Other ' || i from generate_series(1, 200) i;

-- producers and wines: the test household's own, then the others'
insert into public.producers (name, country_code, status, owner_household_id, origin)
  select 'Synthetic Producer ' || lpad(i::text, 4, '0'), 'FR', 'provisional', 'cccccccc-0000-0000-0000-000000000001', 'user_entered'
    from generate_series(1, 60) i;
insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
  select p.id, 'Synthetic Cuvee ' || lpad(j::text, 2, '0'), (array['red','white','rose','sparkling'])[1 + j % 4]::public.wine_type,
         'FR', 'provisional', p.owner_household_id, 'user_entered'
    from public.producers p, generate_series(1, 5) j
   where p.owner_household_id = 'cccccccc-0000-0000-0000-000000000001';
insert into public.producers (name, country_code, status, owner_household_id, origin)
  select 'Other Producer ' || lpad(i::text, 3, '0'), 'IT', 'provisional', h.id, 'user_entered'
    from public.households h, generate_series(1, 10) i where h.name like 'Other %';
insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
  select p.id, 'Chateau Rosso ' || j, 'red', 'IT', 'provisional', p.owner_household_id, 'user_entered'
    from public.producers p, generate_series(1, 5) j where p.name like 'Other Producer %';

-- bottles: 2 each of 100 of the test household's wines
insert into public.wine_vintages (wine_id, year)
  select w.id, 2019 from public.wines w where w.owner_household_id = 'cccccccc-0000-0000-0000-000000000001';
insert into public.bottles (household_id, vintage_id)
  select 'cccccccc-0000-0000-0000-000000000001', v.id
    from (select v.id from public.wine_vintages v join public.wines w on w.id = v.wine_id
           where w.owner_household_id = 'cccccccc-0000-0000-0000-000000000001' order by v.id limit 100) v,
         generate_series(1, 2);
analyze;
