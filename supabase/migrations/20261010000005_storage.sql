-- =====================================================================
-- 0005 storage: private buckets, household-scoped access by path
-- =====================================================================
-- Every bucket is PRIVATE; the app hands out short-lived signed URLs. Object paths start with the
-- owning scope: `{household_id}/…` (bottle & tasting images) or `{user_id}/…` (avatars), and the
-- policies below enforce that first path segment — a user can only touch their own households' folders.
-- Uploads go straight to Storage via signed upload URL (serverless request bodies are capped well
-- below phone-photo size); bucket-level size and MIME limits are enforced by Storage itself.
-- HEIC is deliberately not accepted: the client re-encodes to JPEG/WebP before upload.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('bottle-images',  'bottle-images',  false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('tasting-images', 'tasting-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('user-avatars',   'user-avatars',   false,  2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('wine-labels',    'wine-labels',    false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- household-scoped buckets
create policy cellr_household_files_select on storage.objects for select to authenticated
  using (bucket_id in ('bottle-images', 'tasting-images')
         and private.try_uuid((storage.foldername(name))[1]) = any (((select private.my_household_ids()))::uuid[]));
create policy cellr_household_files_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('bottle-images', 'tasting-images')
              and private.try_uuid((storage.foldername(name))[1]) = any (((select private.my_household_ids()))::uuid[]));
create policy cellr_household_files_update on storage.objects for update to authenticated
  using (bucket_id in ('bottle-images', 'tasting-images')
         and private.try_uuid((storage.foldername(name))[1]) = any (((select private.my_household_ids()))::uuid[]))
  with check (bucket_id in ('bottle-images', 'tasting-images')
              and private.try_uuid((storage.foldername(name))[1]) = any (((select private.my_household_ids()))::uuid[]));
create policy cellr_household_files_delete on storage.objects for delete to authenticated
  using (bucket_id in ('bottle-images', 'tasting-images')
         and private.try_uuid((storage.foldername(name))[1]) = any (((select private.my_household_ids()))::uuid[]));

-- avatars: write your own folder; read your own and those of people you share a household with
create policy cellr_avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'user-avatars'
         and ((storage.foldername(name))[1] = auth.uid()::text
              or private.shares_household(private.try_uuid((storage.foldername(name))[1]))));
create policy cellr_avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy cellr_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy cellr_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- canonical label art (if ever licensed): readable by signed-in users, written by the service role only
create policy cellr_wine_labels_select on storage.objects for select to authenticated
  using (bucket_id = 'wine-labels');
