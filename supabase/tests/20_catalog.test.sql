begin;
do $$
declare h1 uuid; h2 uuid; canon_p uuid; canon_w uuid; canon_v uuid; p1 uuid; w1 uuid; v1 uuid; n bigint;
begin
  perform test.mk_users(2);
  perform test.as_user(1); h1 := public.create_household('One');
  perform test.as_user(2); h2 := public.create_household('Two');

  -- ---- normalisation (single source of truth, in SQL) -------------------------------------------
  perform test.rec('normalize: accents, case, punctuation',     private.normalize_text('Marqués de Riscal – Reserva') = 'marques de riscal reserva');
  perform test.rec('normalize: hyphens and dots',               private.normalize_text('Château Lafite-Rothschild') = 'chateau lafite rothschild');
  perform test.rec('normalize: non-latin names survive',        private.normalize_text('Мерло') = 'мерло');
  perform test.rec('normalize: null / blank are empty',         private.normalize_text(null) = '' and private.normalize_text('  ') = '');
  -- The app recognises "the same wine" with a TypeScript twin of this function (packages/domain
  -- normalizeText); the same cases are asserted in packages/domain/src/cellar.test.ts.
  perform test.rec('normalize (twin cases): the TypeScript and SQL versions agree',
    private.normalize_text('Château Léoville-Las Cases') = 'chateau leoville las cases'
    and private.normalize_text('Müller-Thurgau') = 'muller thurgau'
    and private.normalize_text('  Gewürztraminer  ') = 'gewurztraminer'
    and private.normalize_text('Weißburgunder') = 'weissburgunder'
    and private.normalize_text('Cuvée Ærø') = 'cuvee aero'
    and private.normalize_text('Pétrus 2015!') = 'petrus 2015');

  -- ---- seeded reference data -------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('grapes are seeded and readable', test.count_of('select 1 from public.grapes') >= 150);
  perform test.rec('synonyms are aliases, not duplicate grapes',
    (select 'Shiraz' = any (aliases) from public.grapes where name = 'Syrah')
    and test.count_of($q$select 1 from public.grapes where name like 'Shiraz%'$q$) = 0);
  perform test.rec('clients cannot write grapes', test.denied($q$insert into public.grapes (name, color) values ('Fake', 'red')$q$));

  -- ---- canonical rows: service role only ------------------------------------------------------
  perform test.rec('a user cannot create a canonical producer',
    test.denied(format('insert into public.producers (name, status) values (%L, %L)', 'Fake', 'canonical')));
  perform test.as_service();
  insert into public.producers (name, country_code, status, origin) values ('Marqués de Riscal', 'ES', 'canonical', 'verified') returning id into canon_p;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (canon_p, 'Reserva', 'red', 'ES', 'Rioja', 'canonical', 'verified') returning id into canon_w;
  insert into public.wine_vintages (wine_id, year) values (canon_w, 2020) returning id into canon_v;
  insert into public.wine_sources (wine_id, source_name, license) values (canon_w, 'manual', 'own');
  perform test.rec('normalized_name is filled by the database', (select normalized_name from public.producers where id = canon_p) = 'marques de riscal');
  perform test.rec('canonical wines are unique per producer+name+type',
    test.denied(format('insert into public.wines (producer_id, name, wine_type, status) values (%L, %L, %L, %L)', canon_p, 'RESERVA', 'red', 'canonical')));

  perform test.as_user(2);
  perform test.rec('everyone signed in can read canonical producers/wines/vintages/sources',
    test.count_of(format('select 1 from public.producers where id = %L', canon_p)) = 1
    and test.count_of(format('select 1 from public.wines where id = %L', canon_w)) = 1
    and test.count_of(format('select 1 from public.wine_vintages where id = %L', canon_v)) = 1
    and test.count_of(format('select 1 from public.wine_sources where wine_id = %L', canon_w)) = 1);
  perform test.rec('a user cannot edit a canonical wine (0 rows / denied)',
    test.affected(format('update public.wines set name = %L where id = %L', 'hacked', canon_w)) = 0);
  perform test.rec('a user cannot edit a canonical producer (0 rows)',
    test.affected(format('update public.producers set name = %L where id = %L', 'hacked', canon_p)) = 0);
  perform test.rec('a user cannot add a vintage to a canonical wine',
    test.denied(format('insert into public.wine_vintages (wine_id, year) values (%L, 1999)', canon_w)));
  perform test.rec('a user cannot delete a canonical wine (no privilege)',
    test.denied(format('delete from public.wines where id = %L', canon_w)));

  -- ---- provisional rows: private to the creating household ---------------------------------------
  perform test.as_user(1);
  insert into public.producers (name, country_code, owner_household_id, origin, status)
    values ('Bodega Nueva', 'ES', h1, 'label_ocr', 'provisional') returning id into p1;
  insert into public.wines (producer_id, name, wine_type, owner_household_id, origin, status, region)
    values (p1, 'Crianza', 'red', h1, 'label_ocr', 'provisional', 'Rioja') returning id into w1;
  insert into public.wine_vintages (wine_id, year, abv) values (w1, 2021, 13.5) returning id into v1;
  perform test.rec('creator can read their provisional wine', test.count_of(format('select 1 from public.wines where id = %L', w1)) = 1);
  perform test.rec('created_by is stamped from the session', (select created_by from public.wines where id = w1) = test.uid(1));
  perform test.rec('provisional wines have a normalized_name', (select normalized_name from public.wines where id = w1) = 'crianza');
  perform test.rec('creator can rename it', test.affected(format('update public.wines set name = %L where id = %L', 'Crianza Reserva', w1)) = 1);
  perform test.rec('renaming refreshes normalized_name', (select normalized_name from public.wines where id = w1) = 'crianza reserva');
  perform test.rec('creator can attach grapes',
    test.affected(format('insert into public.wine_grapes (wine_id, grape_id) select %L, id from public.grapes where name = %L', w1, 'Tempranillo')) = 1);
  perform test.rec('creator can add an alias', test.affected(format('insert into public.wine_aliases (wine_id, alias) values (%L, %L)', w1, 'Crianza 2021')) = 1);
  perform test.rec('duplicate provisional wine in the same household is rejected',
    test.denied(format('insert into public.wines (producer_id, name, wine_type, owner_household_id, origin, status) values (%L, %L, %L, %L, %L, %L)', p1, 'crianza reserva', 'red', h1, 'user_entered', 'provisional')));
  n := test.affected(format('insert into public.wine_vintages (wine_id, year) values (%L, NULL)', w1));
  perform test.rec('a non-vintage row can be added', n = 1);
  perform test.rec('...but only one per wine', test.denied(format('insert into public.wine_vintages (wine_id, year) values (%L, NULL)', w1)));
  perform test.rec('a vintage year is range-checked', test.denied(format('insert into public.wine_vintages (wine_id, year) values (%L, 1650)', w1)));

  perform test.rec('a user cannot claim origin = verified',
    test.denied(format('insert into public.wines (producer_id, name, wine_type, owner_household_id, origin, status) values (%L, %L, %L, %L, %L, %L)', p1, 'Other', 'red', h1, 'verified', 'provisional')));
  perform test.rec('a user cannot create a wine owned by a household they are not in',
    test.denied(format('insert into public.wines (producer_id, name, wine_type, owner_household_id, origin, status) values (%L, %L, %L, %L, %L, %L)', p1, 'Other', 'red', h2, 'user_entered', 'provisional')));
  perform test.rec('a user cannot promote a provisional wine (status is not writable)',
    test.denied(format('update public.wines set status = %L, owner_household_id = NULL where id = %L', 'canonical', w1)));
  perform test.rec('a user cannot re-parent a wine (producer_id is not writable)',
    test.denied(format('update public.wines set producer_id = %L where id = %L', canon_p, w1)));
  perform test.su();
  perform test.rec('the status/owner invariant holds even without RLS (superuser)',
    test.denied(format('update public.wines set status = %L where id = %L', 'canonical', w1)));
  perform test.as_user(1);

  perform test.as_user(2);
  perform test.rec('another household cannot see the provisional producer', test.count_of(format('select 1 from public.producers where id = %L', p1)) = 0);
  perform test.rec('another household cannot see the provisional wine',     test.count_of(format('select 1 from public.wines where id = %L', w1)) = 0);
  perform test.rec('...nor its vintages, aliases, grapes',
    test.count_of(format('select 1 from public.wine_vintages where wine_id = %L', w1)) = 0
    and test.count_of(format('select 1 from public.wine_aliases where wine_id = %L', w1)) = 0
    and test.count_of(format('select 1 from public.wine_grapes where wine_id = %L', w1)) = 0);
  perform test.rec('another household cannot add vintages to it', test.denied(format('insert into public.wine_vintages (wine_id, year) values (%L, 2000)', w1)));
  perform test.rec('another household cannot hang a wine under a producer it cannot see',
    test.denied(format('insert into public.wines (producer_id, name, wine_type, owner_household_id, origin, status) values (%L, %L, %L, %L, %L, %L)', p1, 'X', 'red', h2, 'user_entered', 'provisional')));
  perform test.rec('another household cannot rename it (0 rows)', test.affected(format('update public.wines set name = %L where id = %L', 'x', w1)) = 0);

  perform test.as_anon();
  perform test.rec('anon sees no wines', test.denied('select count(*) from public.wines'));
end $$;
rollback;
