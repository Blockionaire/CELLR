-- =====================================================================
-- 0010 photo bucket: only what our own upload path produces
-- =====================================================================
-- Photos are sanitised and re-encoded as JPEG by the app server before they are stored (no EXIF, bounded
-- size). A member could in principle write to Storage directly with their own session and skip that, so the
-- bucket itself now refuses anything but JPEG, and anything above what the app ever sends (4 MB).

update storage.buckets
   set allowed_mime_types = array['image/jpeg'],
       file_size_limit = 4194304
 where id = 'bottle-images';
