-- =====================================================================
-- Tiny SQL test framework. Each *.test.sql runs inside BEGIN … ROLLBACK, so tests leave no trace.
-- Output contract (parsed by scripts/db-test.sh):  NOTICE:  PASS <name>   /   NOTICE:  FAIL <name>
-- Works on plain Postgres (shim) and on a real Supabase local stack.
-- =====================================================================
drop schema if exists test cascade;
create schema test;
grant usage on schema test to public;

-- Fixed, readable user ids: test.uid(1) = aaaaaaaa-0000-0000-0000-000000000001
create function test.uid(n int) returns uuid language sql immutable as
  $$ select ('aaaaaaaa-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- Creates auth users (the on_auth_user_created trigger then creates their profiles).
create function test.mk_users(n int) returns void language plpgsql as $$
begin
  for i in 1..n loop
    insert into auth.users (id, email) values (test.uid(i), 'user' || i || '@example.test');
  end loop;
end $$;

create function test.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', test.uid(n)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', test.uid(n), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function test.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;
create function test.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role service_role';
end $$;
create function test.su() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Records a result without touching the caller's role (SECURITY DEFINER).
create function test.rec(n text, ok boolean) returns void language plpgsql security definer as $$
begin
  raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, n;
end $$;

-- True iff `q` raises something that means "refused": privilege (42501, incl. RLS), integrity (class 23),
-- data (class 22), program limit (54, our rate limit), or an explicit raise (P0001).
-- Anything else (syntax error, missing table…) propagates, so a broken test fails loudly instead of "passing".
create function test.denied(q text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception
  when insufficient_privilege or integrity_constraint_violation or data_exception
       or program_limit_exceeded or raise_exception then
    return true;
end $$;

-- SQLSTATE or message of the error `q` raises ('' when it does not raise).
create function test.error_of(q text) returns text language plpgsql as $$
begin
  execute q;
  return '';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;

create function test.count_of(q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') s' into n;
  return n;
end $$;

-- True iff the caller cannot read ANY row of `q`: either refused outright (no SELECT privilege) or RLS filters everything.
create function test.cannot_read(q text) returns boolean language plpgsql as $$
begin
  return test.count_of(q) = 0;
exception when insufficient_privilege then
  return true;
end $$;

-- Rows touched by an INSERT/UPDATE/DELETE (0 means RLS silently filtered everything).
create function test.affected(q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema test to public;
