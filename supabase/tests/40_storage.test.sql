begin;
do $$
declare h1 uuid; h2 uuid; code text; n bigint;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One'); code := public.create_invite(h1);
  perform test.as_user(2); h2 := public.create_household('Two');

  -- ---- buckets ------------------------------------------------------------------------------------
  perform test.rec('all four buckets exist', (select count(*) from storage.buckets where id in ('bottle-images', 'tasting-images', 'user-avatars', 'wine-labels')) = 4);
  perform test.rec('every bucket is private', (select count(*) from storage.buckets where id in ('bottle-images', 'tasting-images', 'user-avatars', 'wine-labels') and public) = 0);
  perform test.rec('every bucket has a size limit and MIME allow-list',
    (select count(*) from storage.buckets where id in ('bottle-images', 'tasting-images', 'user-avatars', 'wine-labels')
        and file_size_limit between 1 and 10485760 and allowed_mime_types is not null) = 4);
  perform test.rec('the photo bucket takes only JPEG up to 4 MB: what the app server itself produces',
    (select count(*) from storage.buckets where id = 'bottle-images'
        and allowed_mime_types = array['image/jpeg'] and file_size_limit = 4194304) = 1);
  perform test.rec('HEIC / SVG / HTML are not accepted anywhere',
    (select count(*) from storage.buckets where allowed_mime_types && array['image/heic', 'image/heif', 'image/svg+xml', 'text/html']) = 0);

  -- ---- household-scoped buckets ------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a member can upload into their household folder',
    test.affected(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'bottle-images', h1 || '/img1/original.jpg', test.uid(1))) = 1);
  perform test.rec('...and read it back', test.count_of('select 1 from storage.objects where bucket_id = ''bottle-images''') = 1);
  perform test.rec('...and use the tasting bucket the same way',
    test.affected(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'tasting-images', h1 || '/t1.jpg', test.uid(1))) = 1);
  perform test.rec('cannot upload into another household''s folder',
    test.denied(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'bottle-images', h2 || '/img1/original.jpg', test.uid(1))));
  perform test.rec('a non-uuid first path segment is refused cleanly (no cast error)',
    test.error_of(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'bottle-images', 'not-a-uuid/x.jpg', test.uid(1))) like '42501:%');
  perform test.rec('a file at the bucket root (no folder) is refused',
    test.denied(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'bottle-images', 'loose.jpg', test.uid(1))));
  perform test.rec('cannot write to the canonical label bucket',
    test.denied(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'wine-labels', 'x.jpg', test.uid(1))));

  perform test.as_user(2);
  perform test.rec('another household cannot read the files', test.count_of('select 1 from storage.objects where bucket_id in (''bottle-images'', ''tasting-images'')') = 0);
  perform test.rec('another household cannot overwrite the files (0 rows)',
    test.affected(format('update storage.objects set name = %L where name = %L', h2 || '/stolen.jpg', h1 || '/img1/original.jpg')) = 0);
  perform test.rec('another household cannot move a file into its own folder to steal it (0 rows)',
    test.affected(format('update storage.objects set name = %L where bucket_id = %L', h2 || '/x.jpg', 'bottle-images')) = 0);
  perform test.rec('another household cannot delete the files (0 rows)', test.affected('delete from storage.objects where bucket_id = ''bottle-images''') = 0);

  -- ---- joining a household grants (and leaving revokes) access to its files ------------------------
  perform test.as_user(3);
  perform test.rec('a non-member cannot read before joining', test.count_of('select 1 from storage.objects where bucket_id = ''bottle-images''') = 0);
  perform public.join_household(code);
  perform test.rec('a new member can read the household''s files', test.count_of('select 1 from storage.objects where bucket_id = ''bottle-images''') = 1);
  perform test.rec('a member can delete a household file', test.affected(format('delete from storage.objects where name = %L', h1 || '/img1/original.jpg')) = 1);
  n := test.affected(format('delete from public.household_members where household_id = %L and user_id = %L', h1, test.uid(3)));
  perform test.rec('leaving the household revokes access to its files', test.count_of('select 1 from storage.objects where bucket_id = ''tasting-images''') = 0);

  -- ---- avatars -----------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a user can write their own avatar',
    test.affected(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'user-avatars', test.uid(1) || '/avatar.webp', test.uid(1))) = 1);
  perform test.rec('a user cannot write someone else''s avatar folder',
    test.denied(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'user-avatars', test.uid(2) || '/avatar.webp', test.uid(1))));
  perform test.as_user(2);
  perform test.rec('strangers cannot see an avatar', test.count_of('select 1 from storage.objects where bucket_id = ''user-avatars''') = 0);
  perform test.as_user(1);
  perform test.rec('...and a bare filename in the avatar bucket is refused', test.denied(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'user-avatars', 'avatar.webp', test.uid(1))));
  -- share a household: user 2 joins household 1
  code := public.create_invite(h1);
  perform test.as_user(2); perform public.join_household(code);
  perform test.rec('people who share a household can see each other''s avatars', test.count_of('select 1 from storage.objects where bucket_id = ''user-avatars''') = 1);
  perform test.rec('...but cannot modify them (0 rows)', test.affected('update storage.objects set name = name where bucket_id = ''user-avatars''') = 0);

  -- ---- canonical label bucket -------------------------------------------------------------------
  perform test.as_service();
  insert into storage.objects (bucket_id, name) values ('wine-labels', 'canon/lafite-2015.jpg');
  perform test.as_user(1);
  perform test.rec('signed-in users can read canonical label art', test.count_of('select 1 from storage.objects where bucket_id = ''wine-labels''') = 1);
  perform test.as_anon();
  perform test.rec('anon cannot read any storage object', test.cannot_read('select 1 from storage.objects'));
end $$;
rollback;
