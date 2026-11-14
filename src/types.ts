export interface AgencyRow {
  id: string;
  title: string;
  startDate: string;
  z: number; // Số ngày đã thi công (tính ở client từ startDate, không lưu DB)
  notes: string;
  images: string[]; // URL công khai của ảnh gốc (cùng thứ tự với imagePaths)
  imagePaths: string[]; // Đường dẫn file trong Supabase Storage
}

export interface AppData {
  hsh_mb: AgencyRow[];
  hsh_mt: AgencyRow[];
  hsh_mn: AgencyRow[];
  pkd_mb: AgencyRow[];
  pkd_mn: AgencyRow[];
  pkd_da: AgencyRow[];
}

export type UnitId = keyof AppData;

export type TabId = 'tong_quan' | UnitId;

export interface TabConfig {
  id: TabId;
  name: string;
  activeColor: string;
  textColor: string;
  isOverview?: boolean;
}
