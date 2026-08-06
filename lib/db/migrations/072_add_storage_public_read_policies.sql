-- 072_add_storage_public_read_policies.sql
-- Public read access for Supabase Storage buckets
--
-- ROOT CAUSE
-- The CRM creates its storage buckets at runtime by inserting directly into
-- storage.buckets (see artifacts/api-server/src/lib/storage.ts ->
-- createBucketViaDb). That path bypasses the Storage REST API, so Supabase
-- never auto-generates the "public read" SELECT policy on storage.objects for
-- those buckets. The bucket flag public=true IS set, but anonymous requests
-- (a plain <img src>, <audio src>, or <a href> with no auth header) are still
-- checked against storage.objects RLS -> HTTP 403. This is why profile photos
-- render for the admin (whose browser/app request carries a valid auth header)
-- but 403 for anonymous public URL loads used by the avatar components.
--
-- FIX
-- Grant SELECT on storage.objects to PUBLIC (anon + authenticated roles) for
-- every bucket flagged public = true. A single generic policy covers
-- profile-photos, voice-notes, documents, builty and any future public bucket
-- automatically. Files in non-public buckets stay protected (the subquery only
-- matches public buckets).
--
-- HOW TO APPLY
-- Run this file against your Supabase project via SQL Editor (or
-- psql/postgres connection). It is idempotent and safe to re-run.
-- The API server also attempts this policy at runtime (ensurePublicReadPolicies)
-- so it self-heals even if this migration is applied late.

DROP POLICY IF EXISTS "Public read access (all public buckets)" ON storage.objects;

CREATE POLICY "Public read access (all public buckets)"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id IN (SELECT id FROM storage.buckets WHERE public = true));
