begin;
-- Sprint U: the admin portal's reads. The bottle-photo workflow stage is derived from the review status and the
-- wine's artwork; the master list filters, sorts and pages in the database with a stable order; the work queue counts
-- what is waiting. All of it for the service role only.
create function test.u_photo(u uuid, w uuid, canon uuid, st text, path text) returns uuid
  language plpgsql security definer as $$
declare sid uuid;
begin
  insert into public.bottle_photo_submissions
    (user_id, source_wine_id, canonical_wine_id, producer_text, wine_text, wine_type, photo_path, width, height,
     consent_granted_at, status, reviewed_at, reviewed_by)
  select u, w, canon, p.name, x.name, x.wine_type, u || '/' || path, 1200, 1600, now(), st,
         case when st <> 'pending' then now() end, case when st <> 'pending' then u end
    from public.wines x join public.producers p on p.id = x.producer_id where x.id = w
  returning id into sid;
  return sid;
end $$;
grant execute on function test.u_photo(uuid, uuid, uuid, text, text) to public;
create function test.u_stage(sid uuid) returns text language sql security definer as $$
  select private.bottle_photo_stage(s) from public.bottle_photo_submissions s where s.id = sid
$$;
grant execute on function test.u_stage(uuid) to public;
create function test.u_ids(j jsonb) returns uuid[] language sql immutable as $$
  select coalesce(array_agg((r->>'id')::uuid order by o), '{}') from jsonb_array_elements(j->'rows') with ordinality as t(r, o)
$$;
grant execute on function test.u_ids(jsonb) to public;

do $$
declare h1 uuid; p1 uuid; p2 uuid; ph uuid; ca uuid; cb uuid; cc uuid; hw uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid;
        s5 uuid; art uuid; j jsonb; a uuid[]; b uuid[]; all_ids uuid[];
begin
  perform test.mk_users(2);
  perform test.as_user(1); h1 := public.create_household('Portal 1');

  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Aalto Portal', 'FR', 'canonical', 'verified')
    returning id into p1;
  insert into public.producers (name, country_code, status, origin) values ('Zenith Portal', 'IT', 'canonical', 'verified')
    returning id into p2;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (p1, 'Alpha', 'red', 'FR', 'canonical', 'verified') returning id into ca;
  insert into public.wines (producer_id, name, wine_type, status, origin)
    values (p2, 'Beta', 'white', 'canonical', 'verified') returning id into cb;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (p1, 'Gamma', 'white', 'ES', 'canonical', 'verified') returning id into cc;
  insert into public.wine_vintages (wine_id, year) values (ca, 2015), (ca, 2016), (ca, 2017), (cb, 2020);

  perform test.as_user(1);
  insert into public.producers (name, country_code, owner_household_id) values ('Maison Portal', 'FR', h1)
    returning id into ph;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (ph, 'Delta', 'rose', h1)
    returning id into hw;

  -- ---- only the server reaches these reads ----------------------------------------------------------------------
  perform test.rec('a signed-in person cannot read the photo queue, the master search, the facets or the work queue',
    test.denied('select public.admin_bottle_photo_queue(null, null, null, 10, 0)')
    and test.denied('select public.admin_wine_master_search(''all'', null, null, null, null, null, null, ''name'', false, 10, 0)')
    and test.denied('select public.admin_wine_master_facets()')
    and test.denied('select public.admin_work_queue()'));
  perform test.as_anon();
  perform test.rec('...nor can anyone signed out', test.denied('select public.admin_work_queue()')
    and test.denied('select public.admin_bottle_photo_queue(null, null, null, 10, 0)'));

  -- ---- the workflow stage --------------------------------------------------------------------------------------
  perform test.su();
  s1 := test.u_photo(test.uid(1), ca, ca, 'pending', 'a.jpg');
  s2 := test.u_photo(test.uid(1), cb, cb, 'approved', 'b.jpg');
  s3 := test.u_photo(test.uid(1), hw, null, 'approved', 'c.jpg');
  s4 := test.u_photo(test.uid(1), cc, cc, 'rejected', 'd.jpg');
  s5 := test.u_photo(test.uid(2), cc, cc, 'used', 'e.jpg');
  perform test.rec('stages follow the review status: pending, rejected, used = published',
    test.u_stage(s1) = 'pending' and test.u_stage(s4) = 'rejected' and test.u_stage(s5) = 'published');
  perform test.rec('...an approved photo of a wine without artwork needs artwork',
    test.u_stage(s2) = 'artwork_needed' and test.u_stage(s3) = 'artwork_needed');
  perform test.as_service();
  art := public.admin_add_bottle_art(cb, cb || '/x.png', 'image/png', 400, 1200, null, test.uid(2));
  perform test.rec('...an uploaded, unpublished picture makes it a draft', test.u_stage(s2) = 'draft');
  j := public.admin_work_queue();
  perform test.rec('the work queue counts what is waiting',
    (j->>'photosPending')::int = 1 and (j->>'artworkNeeded')::int = 1 and (j->>'photosWithDraft')::int = 1
    and (j->>'artDrafts')::int = 1);
  perform public.admin_publish_bottle_art(art, array[s2], test.uid(2));
  perform test.rec('...and one catalogue wine fewer is without artwork once published',
    (j->>'catalogueWithoutArt')::int - (public.admin_work_queue()->>'catalogueWithoutArt')::int = 1
    and (public.admin_work_queue()->>'artDrafts')::int = 0);
  perform test.rec('...publishing uses the contribution: published', test.u_stage(s2) = 'published'
    and (select status from public.bottle_photo_submissions where id = s2) = 'used');
  perform test.rec('a household wine''s approved photo is untouched by a catalogue wine''s picture',
    test.u_stage(s3) = 'artwork_needed');

  -- ---- the photo queue ---------------------------------------------------------------------------------------------
  j := public.admin_bottle_photo_queue(null, 'artwork_needed', null, 50, 0);
  perform test.rec('the queue filters by stage, with counts per stage and per status',
    (j->>'total')::int = 1 and (j->'rows'->0->>'id')::uuid = s3 and j->'rows'->0->>'stage' = 'artwork_needed'
    and (j->'stages'->>'published')::int = 2 and (j->'stages'->>'pending')::int = 1
    and (j->'counts'->>'used')::int = 2);
  j := public.admin_bottle_photo_queue('pending', null, null, 50, 0);
  perform test.rec('...the old review-status filter still works', (j->>'total')::int = 1
    and (j->'rows'->0->>'id')::uuid = s1);
  j := public.admin_bottle_photo_queue('all', 'all', 'zenith', 50, 0);
  perform test.rec('...searches the wine as it was sent', (j->>'total')::int = 1 and (j->'rows'->0->>'id')::uuid = s2);
  j := public.admin_bottle_photo_queue(null, null, null, 2, 2);
  perform test.rec('...and pages with a total', (j->>'total')::int = 5 and jsonb_array_length(j->'rows') = 2);

  -- ---- the master search ---------------------------------------------------------------------------------------
  j := public.admin_wine_master_search('all', null, 'portal', 'white', null, null, null, 'name', false, 50, 0);
  perform test.rec('filters by wine type', (j->>'total')::int = 2 and test.u_ids(j) = array[cc, cb]);
  j := public.admin_wine_master_search('all', null, 'portal', null, 'it', null, null, 'name', false, 50, 0);
  perform test.rec('...by country, the producer''s when the wine has none', (j->>'total')::int = 1
    and test.u_ids(j) = array[cb]);
  j := public.admin_wine_master_search('all', null, null, null, null, h1, null, 'name', false, 50, 0);
  perform test.rec('...by household, with its name', (j->>'total')::int = 1 and test.u_ids(j) = array[hw]
    and j->>'household' = 'Portal 1');
  j := public.admin_wine_master_search('all', null, 'portal', null, null, null, 'many', 'name', false, 50, 0);
  perform test.rec('...by vintage count', (j->>'total')::int = 1 and test.u_ids(j) = array[ca]);
  j := public.admin_wine_master_search('all', null, 'portal', null, null, null, 'none', 'name', false, 50, 0);
  perform test.rec('...or wines without vintages', (j->>'total')::int = 2 and test.u_ids(j) = array[cc, hw]);
  j := public.admin_wine_master_search('all', array['approved'], 'portal', null, null, null, null, 'name', false, 50, 0);
  perform test.rec('...by approved photos', test.u_ids(j) = array[hw]
    and (j->'rows'->0->>'approved')::int = 1);
  perform test.as_service();
  perform public.admin_add_bottle_art(hw, hw || '/y.png', 'image/png', 400, 1200, null, test.uid(2));
  j := public.admin_wine_master_search('all', array['draft'], 'portal', null, null, null, null, 'name', false, 50, 0);
  perform test.rec('...and by an unpublished draft', test.u_ids(j) = array[hw]
    and (j->'rows'->0->>'draft')::boolean and test.u_stage(s3) = 'draft');

  j := public.admin_wine_master_search('all', null, 'portal', null, null, null, null, 'name', false, 50, 0);
  all_ids := test.u_ids(j);
  perform test.rec('sorted by name: producer, then wine', all_ids = array[ca, cc, hw, cb]);
  j := public.admin_wine_master_search('all', null, 'portal', null, null, null, null, 'name', true, 50, 0);
  perform test.rec('...descending reverses it', test.u_ids(j) = array[cb, hw, cc, ca]);
  j := public.admin_wine_master_search('all', null, 'portal', null, null, null, null, 'vintages', true, 50, 0);
  perform test.rec('...by vintage count, ties in the fixed order', test.u_ids(j) = array[ca, cb, cc, hw]);
  j := public.admin_wine_master_search('all', null, 'portal', null, null, null, null, 'pending', true, 50, 0);
  perform test.rec('...by pending photos', (test.u_ids(j))[1] = ca);
  j := public.admin_wine_master_search('all', null, 'portal', null, null, null, null, 'country', false, 50, 0);
  perform test.rec('...by country', test.u_ids(j) = array[cc, ca, hw, cb]);
  j := public.admin_wine_master_search('all', null, 'portal', null, null, null, null, 'type', false, 50, 0);
  perform test.rec('...by type', test.u_ids(j) = array[ca, hw, cc, cb]);
  a := test.u_ids(public.admin_wine_master_search('all', null, 'portal', null, null, null, null, 'country', true, 2, 0));
  b := test.u_ids(public.admin_wine_master_search('all', null, 'portal', null, null, null, null, 'country', true, 2, 2));
  perform test.rec('pages never overlap and cover every wine', cardinality(a) = 2 and cardinality(b) = 2
    and not (a && b) and (select array_agg(x order by x) from unnest(a || b) x)
      = (select array_agg(x order by x) from unnest(all_ids) x));

  j := public.admin_wine_master_search('all', array['bogus'], $q$'); drop table public.wines; --$q$, 'beer', 'XX', null,
                                       'lots', 'price', null, 50, 0);
  perform test.rec('typed values stay values: unknown filters, sorts and quotes are harmless',
    (j->>'total')::int = 0 and (select count(*) from public.wines) > 0);
  j := public.admin_wine_master_search('all', array['bogus'], 'portal', null, null, null, 'lots', 'price', null, 50, 0);
  perform test.rec('...an unknown flag, vintage filter or sort falls back to the plain list',
    test.u_ids(j) = all_ids);

  j := public.admin_wine_master_facets();
  perform test.rec('the country filter lists the countries present',
    (select array_agg(c->>'code' order by c->>'code') from jsonb_array_elements(j->'countries') c)
      @> array['ES', 'FR', 'IT']);
end $$;
rollback;
