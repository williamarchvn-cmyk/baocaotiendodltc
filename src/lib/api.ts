import { supabase } from './supabase';
import { AgencyRow, AppData, UnitId } from '../types';
import { calculateElapsedDays } from './dateUtils';
import { makeImageVariants, thumbPath } from './imageUtils';

const BUCKET = 'agency-images';
const PAGE = 1000;

export const UNIT_IDS: UnitId[] = ['hsh_mb', 'hsh_mt', 'hsh_mn', 'pkd_mb', 'pkd_mn', 'pkd_da'];

export interface DbRow {
  id: string;
  unit: UnitId;
  title: string;
  start_date: string;
  notes: string;
  images: string[] | null;
}

export const emptyAppData = (): AppData => ({
  hsh_mb: [],
  hsh_mt: [],
  hsh_mn: [],
  pkd_mb: [],
  pkd_mn: [],
  pkd_da: [],
});

export function publicUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export function pathsToUrls(paths: string[]): string[] {
  return paths.map(publicUrl);
}

export function rowToAgency(r: DbRow): AgencyRow {
  const paths = Array.isArray(r.images) ? r.images : [];
  return {
    id: r.id,
    title: r.title ?? '',
    startDate: r.start_date,
    z: calculateElapsedDays(r.start_date),
    notes: r.notes ?? '',
    images: pathsToUrls(paths),
    imagePaths: paths,
  };
}

declare global {
  interface Window {
    /** Yêu cầu dữ liệu được gửi sớm từ index.html (trước khi mã nguồn tải xong). */
    __dltcEarly?: Promise<DbRow[] | null>;
  }
}

const COLUMNS = 'id,unit,title,start_date,notes,images';

async function fetchRows(): Promise<DbRow[]> {
  // Lần tải đầu: dùng kết quả đã gọi sớm trong index.html (chỉ dùng 1 lần).
  const early = window.__dltcEarly;
  window.__dltcEarly = undefined;
  if (early) {
    const rows = await early.catch(() => null);
    if (Array.isArray(rows) && rows.length < PAGE) return rows;
  }
  const all: DbRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('agencies')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as DbRow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

/** Lấy toàn bộ dữ liệu bằng truy vấn tối giản (chỉ chữ + đường dẫn ảnh, không có ảnh). */
export async function fetchAllAgencies(): Promise<AppData> {
  const result = emptyAppData();
  for (const r of await fetchRows()) {
    if (result[r.unit]) result[r.unit].push(rowToAgency(r));
  }
  return result;
}

export async function insertAgency(unit: UnitId, row: AgencyRow): Promise<void> {
  const { error } = await supabase.from('agencies').insert({
    id: row.id,
    unit,
    title: row.title,
    start_date: row.startDate,
    notes: row.notes,
    images: [],
  });
  if (error) throw error;
}

export interface AgencyPatch {
  title?: string;
  start_date?: string;
  notes?: string;
  images?: string[];
}

/** Trả lỗi nếu không có dòng nào được cập nhật (RLS chặn âm thầm khi hết phiên đăng nhập). */
export async function updateAgency(id: string, patch: AgencyPatch): Promise<void> {
  const { data, error } = await supabase.from('agencies').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Không có quyền ghi hoặc dữ liệu không còn tồn tại. Hãy đăng nhập lại.');
  }
}

export async function deleteAgency(id: string, imagePaths: string[]): Promise<void> {
  const { data, error } = await supabase.from('agencies').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Không có quyền xóa. Hãy đăng nhập lại.');
  }
  await removeImageFiles(imagePaths).catch((e) => console.warn('Không xóa được file ảnh:', e));
}

export async function removeImageFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const all = paths.flatMap((p) => [p, thumbPath(p)]);
  const { error } = await supabase.storage.from(BUCKET).remove(all);
  if (error) throw error;
}

/** Nén + tải ảnh gốc và ảnh thu nhỏ. Trả về đường dẫn ảnh gốc. */
export async function uploadImage(agencyId: string, file: File): Promise<string> {
  const { full, thumb } = await makeImageVariants(file);
  const name = crypto.randomUUID();
  const path = `${agencyId}/${name}.jpg`;
  const opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };

  const up1 = await supabase.storage.from(BUCKET).upload(path, full, opts);
  if (up1.error) throw up1.error;
  const up2 = await supabase.storage.from(BUCKET).upload(thumbPath(path), thumb, opts);
  if (up2.error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw up2.error;
  }
  return path;
}

export interface RealtimeHandlers {
  onInsert: (row: DbRow) => void;
  onUpdate: (row: DbRow) => void;
  onDelete: (id: string) => void;
  onStatus?: (status: string) => void;
}

/** Lắng nghe thay đổi của người khác. Trả về hàm hủy đăng ký. */
export function subscribeAgencies(h: RealtimeHandlers): () => void {
  const channel = supabase
    .channel('agencies-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agencies' }, (p) =>
      h.onInsert(p.new as DbRow)
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agencies' }, (p) =>
      h.onUpdate(p.new as DbRow)
    )
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'agencies' }, (p) => {
      const id = (p.old as { id?: string })?.id;
      if (id) h.onDelete(id);
    })
    .subscribe((status) => h.onStatus?.(status));

  return () => {
    supabase.removeChannel(channel);
  };
}
