-- A PUBLIC source of 100,000 synthetic records, for the load test of people's search (staging only; staging-pilot.sh
-- mode perf16). Every record is invented here by CELLR from fixed word lists: no real dataset content. The source is
-- registered, made public with rights written as "CELLR's own synthetic test data" (the database's own rules apply:
-- public needs verified commercial rights), imported in 100 batches of 1000 through the normal import functions
-- (each its own transaction, with fresh statistics along the way), and switched off again by the calling script after
-- the measurement. Idempotent: a second run imports nothing. Refuses unless the database says it is staging.
\set ON_ERROR_STOP 1
select private.catalog_environment() = 'staging' as is_staging \gset
\if :is_staging
\else
  \echo 'perf-synthetic.sql runs on a staging database only'
  \quit
\endif

select public.catalog_provider_register('{"id": "perf_synth", "name": "CELLR synthetic load set"}');
select public.admin_catalog_provider_rights('perf_synth', jsonb_build_object(
  'license', 'CC0-1.0', 'attribution', 'CELLR synthetic test records (not real data)',
  'may_store', true, 'may_display', true, 'commercial_use', true, 'rights_status', 'verified',
  'rights_evidence', 'Synthetic records invented by CELLR for its own load test (scripts/catalog-tools/perf-synthetic.sql)',
  'rights_verified_at', now(), 'rights_verified_by', 'perf-synthetic.sql', 'search_scope', 'public'),
  'load test of people''s search over a public source (staging)', 'perf-synthetic.sql');

select (select count(*) from public.catalog_external_records
         where provider_id = 'perf_synth' and status = 'active') >= 100000 as done \gset
\if :done
  \echo 'synthetic source already holds 100000 records'
  \quit
\endif

-- one invented record, deterministic in i
create function pg_temp.synth(i int) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'external_id', 'S' || i,
    'producer', (array['Domaine','Château','Bodega','Tenuta','Weingut','Quinta','Cantina','Clos','Maison','Viña'])[1 + (i % 10)]
                || ' ' || (array['Arnaud','Belmonte','Corvina','Delacroix','Esteban','Fontaine','Gallardo','Hartmann',
                                 'Isola','Jourdain','Keller','Lombardi','Marchetti','Navarro','Olivier','Pereira',
                                 'Quintero','Rossetti','Santoro','Thibault','Ugarte','Valette','Weber','Xavier','Yanez',
                                 'Zanetti','Aubert','Bellini','Carrasco','Duval','Esposito','Ferreira','Gauthier',
                                 'Herrera','Ibanez','Jacquet','Kunz','Laurent','Moreau','Neri'])[1 + ((i / 10) % 40)]
                || ' ' || (1 + ((i / 400) % 25)),
    'name', (array['Réserve','Grand Cru','Vieilles Vignes','Rosso','Blanc de Blancs','Crianza','Riserva','Spätlese',
                   'Cuvée Prestige','Tinto','Bianco','Brut Nature','Premier Cru','Gran Reserva','Selección','Classico',
                   'Superiore','Kabinett','Rosé','Les Terrasses'])[1 + ((i / 3) % 20)] || ' ' || (1 + (i % 97)),
    'wine_type', (array['red','white','rose','sparkling','dessert','fortified'])[1 + ((i / 11) % 6)],
    'country_code', (array['FR','IT','ES','DE','PT','AT','AR','CL','US','ZA','AU','NZ'])[1 + ((i / 13) % 12)],
    'region', 'Synthetic Region ' || (1 + (i % 50)),
    'vintages', jsonb_build_array(2015 + (i % 8), 2016 + (i % 8)))
$$;

select public.catalog_import_run_start('perf_synth', 'synthetic-1', null, null, 'CELLR synthetic load set', now()) as run \gset
-- each batch must import without an invalid record: an exception stops the script (ON_ERROR_STOP)
create function pg_temp.must_be_valid(j jsonb) returns void language plpgsql as $$
begin
  if (j->>'invalid')::int <> 0 then raise exception 'synthetic batch had % invalid records', j->>'invalid'; end if;
end $$;
select format('select pg_temp.must_be_valid(public.catalog_external_import(%L, %L, (select jsonb_agg(pg_temp.synth(i)) from generate_series(%s, %s) i), true))',
              'perf_synth', :'run', b * 1000 + 1, b * 1000 + 1000)
       || case when b in (1, 5, 20, 50) then '; analyze public.catalog_external_records, private.catalog_search_entries' else '' end
  from generate_series(0, 99) b \gexec
select public.catalog_import_run_finish(:'run', true, '{}');
analyze public.catalog_external_records, private.catalog_search_entries;
\echo 'synthetic source imported'
