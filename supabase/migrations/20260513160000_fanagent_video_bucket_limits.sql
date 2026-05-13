-- Allow rendered TikTok MP4s to be stored durably after audio overlay.
-- Some stock providers return high-bitrate clips; the worker now prefers
-- smaller variants, but final rendered videos can still exceed 50 MB.

update storage.buckets
set file_size_limit = 209715200
where id in ('post-assets', 'stock-cache', 'renders');
