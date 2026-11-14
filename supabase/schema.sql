-- =====================================================================
-- SCHEMA cho "Báo cáo Tiến độ ĐLTC"
-- Chạy toàn bộ file này trong Supabase → SQL Editor → New query → Run.
-- Có thể chạy lại nhiều lần mà không lỗi.
-- =====================================================================

-- 1. BẢNG CHÍNH ---------------------------------------------------------
create table if not exists public.agencies (
  id          uuid primary key default gen_random_uuid(),
  unit        text not null check (unit in ('hsh_mb','hsh_mt','hsh_mn','pkd_mb','pkd_mn','pkd_da')),
  title       text not null default '',
  start_date  date not null,
  notes       text not null default '',
  images      jsonb not null default '[]'::jsonb,   -- mảng CÓ THỨ TỰ các đường dẫn ảnh gốc trong Storage, tối đa 5
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  constraint images_max_5 check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 5)
);

create index if not exists agencies_unit_idx on public.agencies(unit);

-- 2. TỰ CẬP NHẬT updated_at / updated_by ----------------------------------
create or replace function public.touch_agency() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_touch_agency on public.agencies;
create trigger trg_touch_agency before insert or update on public.agencies
  for each row execute function public.touch_agency();

-- 3. PHÂN QUYỀN (RLS): ai cũng ĐỌC được, chỉ người đã đăng nhập mới GHI ----
alter table public.agencies enable row level security;

drop policy if exists "read_all" on public.agencies;
drop policy if exists "ins_auth" on public.agencies;
drop policy if exists "upd_auth" on public.agencies;
drop policy if exists "del_auth" on public.agencies;

create policy "read_all" on public.agencies for select to anon, authenticated using (true);
create policy "ins_auth" on public.agencies for insert to authenticated with check (true);
create policy "upd_auth" on public.agencies for update to authenticated using (true) with check (true);
create policy "del_auth" on public.agencies for delete to authenticated using (true);

-- 4. REALTIME (người khác sửa là thấy ngay) -------------------------------
do $$ begin
  alter publication supabase_realtime add table public.agencies;
exception when duplicate_object then null; end $$;

-- 5. KHO ẢNH: bucket công khai (xem ảnh qua URL), giới hạn 2 MB/ảnh, chỉ JPEG
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agency-images', 'agency-images', true, 2097152, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "img_select_auth" on storage.objects;
drop policy if exists "img_insert_auth" on storage.objects;
drop policy if exists "img_delete_auth" on storage.objects;

-- Chỉ người đã đăng nhập được tải lên / xóa ảnh. Người xem dùng URL công khai nên không cần policy.
create policy "img_select_auth" on storage.objects for select to authenticated using (bucket_id = 'agency-images');
create policy "img_insert_auth" on storage.objects for insert to authenticated with check (bucket_id = 'agency-images');
create policy "img_delete_auth" on storage.objects for delete to authenticated using (bucket_id = 'agency-images');
