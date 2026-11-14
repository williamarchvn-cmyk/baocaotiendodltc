import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { initDB, loadData, saveData } from './lib/db';
import { isSupabaseConfigured } from './lib/supabase';
import * as api from './lib/api';
import { AppData, AgencyRow, TabConfig, TabId, UnitId } from './types';
import { calculateElapsedDays, todayLocalISO } from './lib/dateUtils';
import { useAuth } from './hooks/useAuth';
import LoginModal from './components/LoginModal';
import AgencyCard, { CardActions, EditableField, MAX_IMAGES } from './components/AgencyCard';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  PlusCircle,
  Clock,
  Layers,
  CheckCircle,
  Info,
  Loader2,
  LogIn,
  LogOut,
  Eye
} from 'lucide-react';

// Thư viện biểu đồ nặng → chỉ tải khi mở tab Tổng quan, không chặn lần hiển thị đầu tiên.
const OverviewChart = lazy(() => import('./components/OverviewChart'));

const TAB_CONFIGS: TabConfig[] = [
  { id: 'tong_quan', name: 'Tổng quan', activeColor: 'bg-white/95 text-slate-900 border-slate-300 ring-slate-400/20', textColor: 'text-slate-400', isOverview: true },
  { id: 'hsh_mb', name: 'HSH MB', activeColor: 'bg-blue-100/80 text-blue-950 border-blue-300/80 ring-blue-300/30', textColor: 'text-blue-500' },
  { id: 'hsh_mt', name: 'HSH MT', activeColor: 'bg-emerald-100/80 text-emerald-950 border-emerald-300/80 ring-emerald-300/30', textColor: 'text-emerald-500' },
  { id: 'hsh_mn', name: 'HSH MN', activeColor: 'bg-purple-100/80 text-purple-950 border-purple-300/80 ring-purple-300/30', textColor: 'text-purple-500' },
  { id: 'pkd_mb', name: 'P. KD MB', activeColor: 'bg-amber-100/80 text-amber-950 border-amber-300/80 ring-amber-300/30', textColor: 'text-amber-500' },
  { id: 'pkd_mn', name: 'P. KD MN', activeColor: 'bg-rose-100/80 text-rose-950 border-rose-300/80 ring-rose-300/30', textColor: 'text-rose-500' },
  { id: 'pkd_da', name: 'P.KD DA', activeColor: 'bg-fuchsia-100/80 text-fuchsia-950 border-fuchsia-300/80 ring-fuchsia-300/30', textColor: 'text-fuchsia-500' }
];

const DB_COLUMN: Record<EditableField, 'title' | 'notes' | 'start_date'> = {
  title: 'title',
  notes: 'notes',
  startDate: 'start_date'
};

/** Một thay đổi đang chờ gửi hoặc đang gửi. Giữ trong hàng đợi cho tới khi máy chủ xác nhận đã lưu. */
interface PendingWrite {
  rowId: string;
  field: EditableField;
  value: string;
  timer?: number;
  sending: boolean;
  dirty: boolean; // người dùng gõ tiếp trong lúc đang gửi → gửi lại giá trị mới nhất
  attempts: number;
}

const EMPTY_LIST: string[] = [];
const MAX_RETRY = 6;

function isNetworkError(e: any): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return /failed to fetch|networkerror|load failed|network request failed|fetch/i.test(String(e?.message || e || ''));
}

async function runLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      try {
        results[idx] = { status: 'fulfilled', value: await fn(items[idx]) };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function normalizeCache(loaded: AppData): AppData {
  const fix = (list?: AgencyRow[]) =>
    (list || []).map((item) => ({
      ...item,
      images: item.images || [],
      imagePaths: item.imagePaths || [],
      z: calculateElapsedDays(item.startDate)
    }));
  return {
    hsh_mb: fix(loaded.hsh_mb),
    hsh_mt: fix(loaded.hsh_mt),
    hsh_mn: fix(loaded.hsh_mn),
    pkd_mb: fix(loaded.pkd_mb),
    pkd_mn: fix(loaded.pkd_mn),
    pkd_da: fix(loaded.pkd_da)
  };
}

export default function App() {
  const { session, signIn, signOut } = useAuth();
  const canEdit = !!session;

  const dbRef = useRef<IDBDatabase | null>(null);
  const hasCacheRef = useRef(false);
  const [currentTabId, setCurrentTabId] = useState<TabId>('tong_quan');
  const [searchQuery, setSearchQuery] = useState('');
  const [appData, setAppData] = useState<AppData>(api.emptyAppData());
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const appDataRef = useRef(appData);
  appDataRef.current = appData;

  // Ảnh đang tải lên (blob URL tạm) theo từng thẻ
  const [pendingUploads, setPendingUploads] = useState<Record<string, string[]>>({});
  const pendingUploadsRef = useRef(pendingUploads);
  pendingUploadsRef.current = pendingUploads;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // Lightbox Modal states
  const [lightboxRowId, setLightboxRowId] = useState<string | null>(null);
  const [lightboxImgIdx, setLightboxImgIdx] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  // PDF Export states
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isExportingVisuals, setIsExportingVisuals] = useState(false);
  const [currentExportingTabName, setCurrentExportingTabName] = useState<string>('');

  // Đăng nhập + thông báo
  const [showLogin, setShowLogin] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: 'error' | 'info' } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const exportMenuRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const currentDateDisplay = new Date().toLocaleDateString('vi-VN');

  // Ghi dữ liệu chờ (debounce) + các lệnh thêm mới đang bay
  const pendingWrites = useRef(new Map<string, PendingWrite>());
  const insertsRef = useRef(new Map<string, Promise<void>>());

  const readOnly = !canEdit || isExportingVisuals;

  const notify = useCallback((text: string, kind: 'error' | 'info' = 'error') => {
    setToast({ text, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  // ---------- Helpers truy cập dữ liệu ----------
  const findRow = (id: string): { unit: UnitId; row: AgencyRow } | null => {
    for (const u of api.UNIT_IDS) {
      const row = appDataRef.current[u].find((r) => r.id === id);
      if (row) return { unit: u, row };
    }
    return null;
  };

  const mutateRow = useCallback((id: string, fn: (r: AgencyRow) => AgencyRow) => {
    setAppData((prev) => {
      const next = { ...prev };
      for (const u of api.UNIT_IDS) {
        if (prev[u].some((r) => r.id === id)) {
          next[u] = prev[u].map((r) => (r.id === id ? fn(r) : r));
        }
      }
      return next;
    });
  }, []);

  const setRowImages = useCallback(
    (id: string, paths: string[]) => {
      mutateRow(id, (r) => ({ ...r, imagePaths: paths, images: api.pathsToUrls(paths) }));
    },
    [mutateRow]
  );

  const waitInsert = async (id: string) => {
    const p = insertsRef.current.get(id);
    if (p) await p.catch(() => undefined);
  };

  /** Phủ lại giá trị đang gõ dở (chưa kịp gửi) lên dữ liệu nhận từ máy chủ để không bị giật chữ. */
  const overlayPending = useCallback((row: AgencyRow): AgencyRow => {
    let r = row;
    (['title', 'notes', 'startDate'] as EditableField[]).forEach((f) => {
      const p = pendingWrites.current.get(`${row.id}:${f}`);
      if (p) {
        r = { ...r, [f]: p.value };
        if (f === 'startDate') r.z = calculateElapsedDays(p.value);
      }
    });
    return r;
  }, []);

  // ---------- Tải dữ liệu ----------
  const loadRemote = useCallback(
    async (silent = false) => {
      try {
        const remote = await api.fetchAllAgencies();
        const merged = api.emptyAppData();
        for (const u of api.UNIT_IDS) merged[u] = remote[u].map(overlayPending);
        setAppData(merged);
      } catch (e) {
        console.error('Không tải được dữ liệu từ Supabase:', e);
        if (!silent) {
          notify(
            hasCacheRef.current
              ? 'Không kết nối được máy chủ, đang hiển thị dữ liệu đã lưu.'
              : 'Không tải được dữ liệu từ máy chủ. Vui lòng kiểm tra mạng và tải lại trang.'
          );
        }
      } finally {
        setIsDataLoaded(true);
      }
    },
    [notify, overlayPending]
  );

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsDataLoaded(true);
      return;
    }
    (async () => {
      try {
        const db = await initDB();
        dbRef.current = db;
        const cached = await loadData(db);
        if (cached) {
          hasCacheRef.current = true;
          setAppData(normalizeCache(cached)); // hiển thị ngay từ bộ nhớ đệm
          setIsDataLoaded(true);
        }
      } catch (err) {
        console.error('Không mở được bộ nhớ đệm:', err);
      }
      await loadRemote();
    })();
  }, [loadRemote]);

  // Lưu bộ nhớ đệm (debounce 1 giây)
  useEffect(() => {
    if (!isDataLoaded || !dbRef.current) return;
    const t = window.setTimeout(() => {
      if (dbRef.current) saveData(dbRef.current, appData).catch(() => undefined);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [appData, isDataLoaded]);

  // ---------- Ghi dữ liệu (debounce theo từng trường, tự gửi lại khi rớt mạng) ----------
  const sendWrite = useCallback(
    async (key: string) => {
      const p = pendingWrites.current.get(key);
      if (!p || p.sending) return;
      window.clearTimeout(p.timer);
      p.timer = undefined;
      p.sending = true;
      p.dirty = false;
      const value = p.value;
      try {
        await waitInsert(p.rowId);
        await api.updateAgency(p.rowId, { [DB_COLUMN[p.field]]: value });
        if (pendingWrites.current.get(key) !== p) return; // thẻ đã bị xóa trong lúc gửi
        p.sending = false;
        p.attempts = 0;
        if (p.dirty) void sendWrite(key);
        else pendingWrites.current.delete(key);
      } catch (e: any) {
        if (pendingWrites.current.get(key) !== p) return;
        p.sending = false;
        if (isNetworkError(e) && p.attempts < MAX_RETRY) {
          // Rớt mạng: giữ lại và tự gửi lại (2s, 4s, 8s... tối đa 30s), hoặc ngay khi có mạng trở lại.
          p.attempts += 1;
          if (p.attempts === 1) notify('Mất kết nối. Thay đổi sẽ tự được lưu khi có mạng trở lại.', 'info');
          p.timer = window.setTimeout(() => void sendWrite(key), Math.min(30000, 1000 * 2 ** p.attempts));
        } else {
          console.error('Lưu thất bại:', e);
          pendingWrites.current.delete(key);
          notify('Không lưu được thay đổi. Hãy kiểm tra mạng hoặc đăng nhập lại.');
        }
      }
    },
    [notify]
  );

  const flushAll = useCallback(() => {
    Array.from(pendingWrites.current.keys()).forEach((k) => void sendWrite(k));
  }, [sendWrite]);

  const flushRow = (rowId: string) => {
    Array.from(pendingWrites.current.keys())
      .filter((k) => k.startsWith(`${rowId}:`))
      .forEach((k) => void sendWrite(k));
  };

  const queueWrite = (rowId: string, field: EditableField, value: string, delay = 600) => {
    const key = `${rowId}:${field}`;
    let p = pendingWrites.current.get(key);
    if (!p) {
      p = { rowId, field, value, sending: false, dirty: false, attempts: 0 };
      pendingWrites.current.set(key, p);
    }
    p.value = value;
    if (p.sending) {
      p.dirty = true; // sẽ gửi lại ngay sau khi lần gửi hiện tại xong
      return;
    }
    window.clearTimeout(p.timer);
    p.timer = window.setTimeout(() => void sendWrite(key), delay);
  };

  // Gửi nốt dữ liệu chờ khi đổi tab / ẩn trang / đóng trang
  useEffect(() => {
    flushAll();
  }, [currentTabId, flushAll]);

  // ---------- Đồng bộ nhiều người (Realtime) ----------
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let hasSubscribed = false;
    let hiddenAt = 0;

    const unsubscribe = api.subscribeAgencies({
      onInsert: (r) => {
        const agency = api.rowToAgency(r);
        setAppData((prev) => {
          if (api.UNIT_IDS.some((u) => prev[u].some((x) => x.id === agency.id))) return prev;
          if (!prev[r.unit]) return prev;
          return { ...prev, [r.unit]: [agency, ...prev[r.unit]] };
        });
      },
      onUpdate: (r) => {
        const agency = overlayPending(api.rowToAgency(r));
        setAppData((prev) => {
          const next = { ...prev };
          for (const u of api.UNIT_IDS) {
            if (prev[u].some((x) => x.id === agency.id)) {
              next[u] = prev[u].map((x) => (x.id === agency.id ? agency : x));
            }
          }
          return next;
        });
      },
      onDelete: (id) => {
        setAppData((prev) => {
          const next = { ...prev };
          for (const u of api.UNIT_IDS) {
            if (prev[u].some((x) => x.id === id)) next[u] = prev[u].filter((x) => x.id !== id);
          }
          return next;
        });
        setLightboxRowId((cur) => (cur === id ? null : cur));
      },
      onStatus: (status) => {
        if (status === 'SUBSCRIBED') {
          if (hasSubscribed) void loadRemote(true); // kết nối lại sau khi mất mạng → đồng bộ lại
          hasSubscribed = true;
        }
      }
    });

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        flushAll();
      } else if (hiddenAt && Date.now() - hiddenAt > 60000) {
        void loadRemote(true);
      }
    };
    const onPageHide = () => flushAll();
    const onOnline = () => flushAll(); // có mạng trở lại → gửi ngay các thay đổi còn chờ
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
    };
  }, [flushAll, loadRemote, overlayPending]);

  // Khóa cuộn nền khi mở ảnh lớn / hộp đăng nhập
  useEffect(() => {
    const lock = lightboxRowId !== null || showLogin;
    document.body.style.overflow = lock ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [lightboxRowId, showLogin]);

  // Cuộn tab đang chọn vào giữa thanh tab (hữu ích trên điện thoại)
  useEffect(() => {
    tabRefs.current[currentTabId]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [currentTabId]);

  // Tải sẵn ảnh kế trước / kế sau để chuyển ảnh trong chế độ phóng to không phải chờ
  useEffect(() => {
    if (lightboxRowId === null || lightboxImgIdx === null) return;
    const imgs = findRow(lightboxRowId)?.row.images || [];
    if (imgs.length < 2) return;
    [imgs[(lightboxImgIdx + 1) % imgs.length], imgs[(lightboxImgIdx - 1 + imgs.length) % imgs.length]].forEach((url) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.src = url;
    });
  }, [lightboxRowId, lightboxImgIdx]);

  // Keyboard navigation for Lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxRowId === null || lightboxImgIdx === null) return;
      const found = findRow(lightboxRowId);
      if (!found) return;
      const totalImages = found.row.images.length;
      if (e.key === 'Escape') {
        closeLightbox();
      } else if (e.key === 'ArrowLeft') {
        setLightboxImgIdx((prev) => (prev !== null ? (prev - 1 + totalImages) % totalImages : null));
      } else if (e.key === 'ArrowRight') {
        setLightboxImgIdx((prev) => (prev !== null ? (prev + 1) % totalImages : null));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxRowId, lightboxImgIdx, appData]);

  // Click outside to close PDF Export Menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Global Clipboard paste handler for images (copied from Zalo, Telegram, WhatsApp, etc.)
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (!canEdit) return;
      if (currentTabId === 'tong_quan') return;
      if (!hoveredRowId) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      let hasImage = false;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          hasImage = true;
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }

      if (hasImage && files.length > 0) {
        e.preventDefault();
        void processFiles(files, hoveredRowId);
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [hoveredRowId, canEdit, currentTabId]);

  // ---------- Thao tác dữ liệu ----------
  const handleAddNewRow = () => {
    if (!canEdit || currentTabId === 'tong_quan') return;
    const unit = currentTabId as UnitId;

    const newAgency: AgencyRow = {
      id: crypto.randomUUID(),
      title: '',
      startDate: todayLocalISO(),
      z: 0,
      notes: '',
      images: [],
      imagePaths: []
    };

    setSearchQuery('');
    setAppData((prev) => ({ ...prev, [unit]: [newAgency, ...prev[unit]] }));

    const p = api.insertAgency(unit, newAgency);
    insertsRef.current.set(newAgency.id, p);
    p.catch((e) => {
      console.error('Không tạo được ĐLTC:', e);
      setAppData((prev) => ({ ...prev, [unit]: prev[unit].filter((r) => r.id !== newAgency.id) }));
      notify('Không tạo được ĐLTC mới. Hãy kiểm tra mạng hoặc đăng nhập lại.');
    }).finally(() => insertsRef.current.delete(newAgency.id));

    window.setTimeout(() => {
      const el = document.getElementById(`row-${newAgency.id}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (document.getElementById(`title-${newAgency.id}`) as HTMLInputElement | null)?.focus({ preventScroll: true });
    }, 150);
  };

  const handleDeleteRow = async (rowId: string) => {
    if (!canEdit) return;
    const found = findRow(rowId);
    if (!found) return;
    if (!confirm('Bạn có chắc chắn muốn xóa hoàn toàn Đại lý tiêu chuẩn này? Dữ liệu không thể khôi phục.')) return;

    // hủy các lệnh ghi đang chờ của thẻ này
    Array.from(pendingWrites.current.keys())
      .filter((k) => k.startsWith(`${rowId}:`))
      .forEach((k) => {
        window.clearTimeout(pendingWrites.current.get(k)?.timer);
        pendingWrites.current.delete(k);
      });

    const { unit, row } = found;
    setAppData((prev) => ({ ...prev, [unit]: prev[unit].filter((r) => r.id !== rowId) }));
    try {
      await waitInsert(rowId);
      await api.deleteAgency(rowId, row.imagePaths);
    } catch (e) {
      console.error('Không xóa được ĐLTC:', e);
      setAppData((prev) => (prev[unit].some((r) => r.id === rowId) ? prev : { ...prev, [unit]: [row, ...prev[unit]] }));
      notify('Không xóa được. Hãy kiểm tra mạng hoặc đăng nhập lại.');
    }
  };

  const handleUpdateField = (rowId: string, field: EditableField, value: string) => {
    if (!canEdit) return;
    if (field === 'startDate' && !value) return; // ngày bắt đầu bắt buộc phải có
    mutateRow(rowId, (r) => {
      const next = { ...r, [field]: value } as AgencyRow;
      if (field === 'startDate') next.z = calculateElapsedDays(value);
      return next;
    });
    queueWrite(rowId, field, value, field === 'startDate' ? 0 : 600);
  };

  // Nén + tải ảnh lên Supabase Storage
  const processFiles = async (files: FileList | File[], rowId: string) => {
    if (!canEdit) return;
    const found = findRow(rowId);
    if (!found) return;

    const pendingCount = (pendingUploadsRef.current[rowId] || []).length;
    const slotsAvailable = MAX_IMAGES - found.row.imagePaths.length - pendingCount;
    if (slotsAvailable <= 0) {
      alert('Đại lý tiêu chuẩn này đã đạt giới hạn tối đa 5 hình ảnh báo cáo!');
      return;
    }

    const list = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, slotsAvailable);
    if (list.length === 0) return;

    const temps = list.map((f) => URL.createObjectURL(f));
    setPendingUploads((prev) => ({ ...prev, [rowId]: [...(prev[rowId] || []), ...temps] }));

    const clearTemps = () => {
      setPendingUploads((prev) => {
        const rest = (prev[rowId] || []).filter((u) => !temps.includes(u));
        const next = { ...prev };
        if (rest.length) next[rowId] = rest;
        else delete next[rowId];
        return next;
      });
      temps.forEach((u) => URL.revokeObjectURL(u));
    };

    await waitInsert(rowId);
    const results = await runLimited(list, 3, (f) => api.uploadImage(rowId, f));
    const uploaded = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = results.length - uploaded.length;
    if (failed > 0) {
      console.error('Tải ảnh lỗi:', results.filter((r) => r.status === 'rejected'));
      notify(`Tải ${failed} ảnh thất bại. Hãy kiểm tra mạng hoặc đăng nhập lại.`);
    }
    if (uploaded.length === 0) {
      clearTemps();
      return;
    }

    const latest = findRow(rowId);
    if (!latest) {
      // thẻ đã bị xóa trong lúc tải
      api.removeImageFiles(uploaded).catch(() => undefined);
      clearTemps();
      return;
    }

    const room = Math.max(0, MAX_IMAGES - latest.row.imagePaths.length);
    const keep = uploaded.slice(0, room);
    const extra = uploaded.slice(room);
    if (extra.length) api.removeImageFiles(extra).catch(() => undefined);
    if (keep.length === 0) {
      clearTemps();
      notify('Đã đạt giới hạn 5 hình ảnh.');
      return;
    }

    const before = latest.row.imagePaths;
    const after = [...before, ...keep];
    setRowImages(rowId, after);
    clearTemps();
    try {
      await api.updateAgency(rowId, { images: after });
    } catch (e) {
      console.error('Không lưu được danh sách ảnh:', e);
      setRowImages(rowId, before);
      api.removeImageFiles(keep).catch(() => undefined);
      notify('Không lưu được ảnh. Hãy kiểm tra mạng hoặc đăng nhập lại.');
    }
  };

  const handleRemoveImage = async (rowId: string, index: number) => {
    if (!canEdit) return;
    const found = findRow(rowId);
    if (!found) return;
    const before = found.row.imagePaths;
    const removed = before[index];
    if (!removed) return;
    const after = before.filter((_, i) => i !== index);
    setRowImages(rowId, after);
    try {
      await api.updateAgency(rowId, { images: after });
      api.removeImageFiles([removed]).catch(() => undefined);
    } catch (e) {
      console.error('Không xóa được ảnh:', e);
      setRowImages(rowId, before);
      notify('Không xóa được ảnh. Hãy kiểm tra mạng hoặc đăng nhập lại.');
    }
  };

  // Lightbox controllers
  const openLightbox = (rowId: string, imageIndex: number) => {
    setLightboxRowId(rowId);
    setLightboxImgIdx(imageIndex);
  };

  const closeLightbox = () => {
    setLightboxRowId(null);
    setLightboxImgIdx(null);
  };

  const navigateLightbox = (direction: number) => {
    if (lightboxRowId === null || lightboxImgIdx === null) return;
    const found = findRow(lightboxRowId);
    if (!found) return;
    const total = found.row.images.length;
    setLightboxImgIdx((lightboxImgIdx + direction + total) % total);
  };

  // Đổi thứ tự ảnh (kéo thả trên máy tính)
  const handleReorderImage = async (rowId: string, srcIdx: number, targetIdx: number) => {
    if (!canEdit) return;
    const found = findRow(rowId);
    if (!found) return;
    const before = found.row.imagePaths;
    if (srcIdx < 0 || srcIdx >= before.length || targetIdx < 0 || targetIdx >= before.length) return;
    const after = [...before];
    const [moved] = after.splice(srcIdx, 1);
    after.splice(targetIdx, 0, moved);
    setRowImages(rowId, after);
    try {
      await api.updateAgency(rowId, { images: after });
    } catch (err) {
      setRowImages(rowId, before);
      notify('Không lưu được thứ tự ảnh.');
    }
  };

  // Các hàm xử lý cho thẻ: đối tượng `cardActions` giữ nguyên danh tính giữa các lần render (để memo có tác dụng),
  // nhưng luôn gọi tới phiên bản hàm mới nhất.
  const latestActions = useRef<CardActions>(null as unknown as CardActions);
  latestActions.current = {
    updateField: handleUpdateField,
    flushRow,
    deleteRow: (id) => void handleDeleteRow(id),
    processFiles: (files, id) => void processFiles(files, id),
    removeImage: (id, i) => void handleRemoveImage(id, i),
    reorderImage: (id, from, to) => void handleReorderImage(id, from, to),
    openLightbox,
    setHovered: setHoveredRowId
  };
  const cardActions = useMemo<CardActions>(
    () => ({
      updateField: (...a) => latestActions.current.updateField(...a),
      flushRow: (...a) => latestActions.current.flushRow(...a),
      deleteRow: (...a) => latestActions.current.deleteRow(...a),
      processFiles: (...a) => latestActions.current.processFiles(...a),
      removeImage: (...a) => latestActions.current.removeImage(...a),
      reorderImage: (...a) => latestActions.current.reorderImage(...a),
      openLightbox: (...a) => latestActions.current.openLightbox(...a),
      setHovered: (...a) => latestActions.current.setHovered(...a)
    }),
    []
  );

  // Chuyển ảnh bằng thao tác vuốt (điện thoại / máy tính bảng)
  const onLightboxTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onLightboxTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) > 50) navigateLightbox(dx > 0 ? -1 : 1);
  };

  // ---------- Xuất PDF (nạp thư viện nặng khi cần) ----------
  const triggerTabPdfExport = async () => {
    setIsExportMenuOpen(false);
    const activeTab = TAB_CONFIGS.find((t) => t.id === currentTabId);
    if (!activeTab || currentTabId === 'tong_quan') return;

    setExportProgress(15);
    setIsExportingVisuals(true);
    setCurrentExportingTabName(activeTab.name);

    try {
      const { exportTabToPDF } = await import('./lib/pdfExport');
      const agencies = filteredAgencies.map((a) => ({ ...a, z: calculateElapsedDays(a.startDate) }));
      await exportTabToPDF(activeTab, agencies, (progress) => setExportProgress(progress));
      setExportProgress(100);
      setTimeout(() => {
        setExportProgress(null);
        setIsExportingVisuals(false);
      }, 800);
    } catch (err) {
      console.error('Failed to export current tab PDF:', err);
      notify('Đã xảy ra lỗi khi kết xuất báo cáo PDF. Vui lòng thử lại.');
      setExportProgress(null);
      setIsExportingVisuals(false);
    }
  };

  const triggerFullPdfExport = async () => {
    setIsExportMenuOpen(false);
    setIsExportingVisuals(true);
    setExportProgress(5);
    setCurrentExportingTabName('Báo cáo tổng hợp toàn quốc');

    try {
      const { exportFullReportToPDF } = await import('./lib/pdfExport');
      await exportFullReportToPDF(appData, TAB_CONFIGS, chartRef.current, (progress) => setExportProgress(progress));
      setExportProgress(100);
      setTimeout(() => {
        setExportProgress(null);
        setIsExportingVisuals(false);
      }, 800);
    } catch (err) {
      console.error('Error generating complete report PDF:', err);
      setIsExportingVisuals(false);
      notify('Đã xảy ra lỗi khi kết xuất báo cáo tổng hợp toàn quốc. Vui lòng thử lại.');
      setExportProgress(null);
    }
  };

  // Danh sách ĐLTC của tab hiện tại (sắp theo số ngày giảm dần). Giữ nguyên object từng dòng để thẻ không vẽ lại thừa.
  const filteredAgencies = useMemo(() => {
    if (currentTabId === 'tong_quan') return [];
    const agencies = appData[currentTabId as UnitId] || [];
    const days = new Map(agencies.map((a) => [a.id, calculateElapsedDays(a.startDate)]));
    const sorted = [...agencies].sort((a, b) => days.get(b.id)! - days.get(a.id)!);
    const query = searchQuery.toLowerCase().trim();
    return query ? sorted.filter((row) => row.title.toLowerCase().includes(query)) : sorted;
  }, [appData, currentTabId, searchQuery]);

  // Recharts Data Prep
  const chartData = useMemo(
    () => [
      { name: 'HSH MB', count: appData.hsh_mb.length, key: 'hsh_mb', color: '#60a5fa' },
      { name: 'HSH MT', count: appData.hsh_mt.length, key: 'hsh_mt', color: '#34d399' },
      { name: 'HSH MN', count: appData.hsh_mn.length, key: 'hsh_mn', color: '#a78bfa' },
      { name: 'P. KD MB', count: appData.pkd_mb.length, key: 'pkd_mb', color: '#fbbf24' },
      { name: 'P. KD MN', count: appData.pkd_mn.length, key: 'pkd_mn', color: '#f87171' },
      { name: 'P.KD DA', count: appData.pkd_da.length, key: 'pkd_da', color: '#f472b6' }
    ],
    [appData]
  );

  const grandTotal = api.UNIT_IDS.reduce((sum, u) => sum + (appData[u]?.length || 0), 0);

  const activeTabConfig = TAB_CONFIGS.find((t) => t.id === currentTabId);

  // Chưa khai báo Supabase → hướng dẫn thay vì trắng trang
  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-100 p-6">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-200 p-8 text-center">
          <Info className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-lg font-extrabold text-slate-800 mb-2">Chưa cấu hình Supabase</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Thiếu biến môi trường <code className="font-mono text-slate-700">VITE_SUPABASE_URL</code> và{' '}
            <code className="font-mono text-slate-700">VITE_SUPABASE_ANON_KEY</code>. Xem file README.md để khai báo rồi chạy lại.
          </p>
        </div>
      </div>
    );
  }

  const lightboxRow = lightboxRowId !== null ? findRow(lightboxRowId)?.row : undefined;

  return (
    <div className="min-h-[100dvh] text-slate-800 flex flex-col bg-gradient-to-br from-[#f6f8fc] via-[#eef2f7] to-[#e0e7ff]/60 relative overflow-x-hidden selection:bg-indigo-100 font-sans">

      {/* Decorative ambient background orbs (ẩn trên điện thoại để mượt hơn) */}
      <div className="hidden md:block absolute top-[20%] -left-[10%] w-[600px] h-[600px] bg-blue-300/10 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="hidden md:block absolute bottom-[15%] -right-[10%] w-[700px] h-[700px] bg-purple-300/10 rounded-full blur-[160px] pointer-events-none"></div>

      {/* Corporate header (dính đầu trang trên màn hình ≥ md) */}
      <header className="md:sticky md:top-0 z-40 bg-slate-900/95 md:bg-slate-900/90 md:backdrop-blur-xl border-b border-slate-800/60 text-white shadow-xl no-print pt-[env(safe-area-inset-top)]">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-8 py-3 sm:py-4 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 md:gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="bg-gradient-to-br from-red-500 to-red-600 p-2 sm:p-3 rounded-xl border border-red-400 shadow-lg shadow-red-600/20 flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 shrink-0 transition-transform hover:scale-105 duration-300">
              <span className="text-white font-black text-base sm:text-lg tracking-wider">HSH</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-xl font-extrabold tracking-wide sm:tracking-wider uppercase drop-shadow-sm text-white flex flex-wrap items-center gap-x-2 gap-y-1 leading-tight">
                <span>BÁO CÁO TIẾN ĐỘ ĐẠI LÝ TIÊU CHUẨN</span>
                <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded text-slate-300 font-normal normal-case border border-white/5 tracking-normal whitespace-nowrap">ĐANG THI CÔNG</span>
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            {/* Đăng nhập / Đăng xuất */}
            {canEdit ? (
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl pl-3 pr-1 py-1 min-w-0">
                <span className="text-[11px] text-slate-300 font-medium truncate max-w-[140px] sm:max-w-[200px]" title={session?.user.email || ''}>
                  {session?.user.email}
                </span>
                <button
                  onClick={() => void signOut()}
                  className="flex items-center gap-1 text-[11px] font-bold uppercase text-slate-200 hover:text-white hover:bg-white/10 px-2.5 py-2 rounded-lg transition-colors cursor-pointer"
                  aria-label="Đăng xuất"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Đăng xuất</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs uppercase px-3.5 sm:px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-1.5 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Đăng nhập</span>
              </button>
            )}

            {isDataLoaded && (
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase px-3.5 sm:px-4 py-2.5 rounded-xl shadow-lg shadow-red-600/20 transition-all duration-300 flex items-center gap-1.5 cursor-pointer border border-red-500"
                >
                  <Download className="w-3.5 h-3.5 animate-bounce" />
                  <span>XUẤT BÁO CÁO PDF</span>
                </button>

                <AnimatePresence>
                  {isExportMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden text-slate-800 py-2 z-50"
                    >
                      <div className="px-4 py-2 border-b border-slate-50">
                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Tùy chọn tải về</span>
                      </div>

                      {currentTabId !== 'tong_quan' && (
                        <button
                          onClick={triggerTabPdfExport}
                          className="w-full text-left px-4 py-3.5 hover:bg-slate-50 transition-colors flex items-start gap-3 group"
                        >
                          <FileText className="w-4 h-4 text-slate-400 group-hover:text-red-500 mt-0.5" />
                          <div>
                            <span className="block text-xs font-extrabold text-slate-800">Xuất PDF ĐVKD Hiện Tại</span>
                            <span className="block text-[10px] text-slate-400">In riêng báo cáo cho {activeTabConfig?.name}</span>
                          </div>
                        </button>
                      )}

                      <button
                        onClick={triggerFullPdfExport}
                        className="w-full text-left px-4 py-3.5 hover:bg-slate-50 transition-colors flex items-start gap-3 group"
                      >
                        <Layers className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 mt-0.5" />
                        <div>
                          <span className="block text-xs font-extrabold text-slate-800">Lập Báo Cáo Tổng Hợp Toàn Quốc</span>
                          <span className="block text-[10px] text-slate-400">Gồm trang bìa, biểu đồ phân tích và tất cả ĐVKD</span>
                        </div>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <div className="hidden lg:flex bg-white/5 px-4 py-2.5 rounded-xl text-xs font-medium border border-white/10 items-center gap-2 shadow-inner">
              <Clock className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
              <span className="text-slate-300">Ngày <span className="font-bold text-white">{currentDateDisplay}</span></span>
            </div>
          </div>
        </div>
      </header>

      {/* Main app container */}
      <main className="flex-grow max-w-[1440px] w-full mx-auto px-3 sm:px-8 py-4 sm:py-8 z-10 flex flex-col gap-4 sm:gap-6">

        {/* Dải thông báo chế độ chỉ-xem */}
        {!canEdit && isDataLoaded && (
          <div className="no-print flex items-center gap-2 bg-white/70 border border-slate-200/80 rounded-xl px-3.5 py-2 text-[11px] sm:text-xs font-semibold text-slate-500">
            <Eye className="w-3.5 h-3.5 shrink-0 text-slate-400" />
            <span>Bạn đang ở chế độ chỉ xem. Đăng nhập để thêm, sửa hoặc xóa dữ liệu.</span>
          </div>
        )}

        {/* Navigation Tabs Bar */}
        <div className="bg-white/60 md:bg-white/40 md:backdrop-blur-md p-1.5 sm:p-2 rounded-2xl shadow-lg border border-white/60 overflow-x-auto custom-scrollbar flex gap-1.5 sm:gap-2 no-print snap-x">
          {TAB_CONFIGS.map((tab) => {
            const isSelected = currentTabId === tab.id;
            const dotColor = tab.textColor.replace('text-', 'bg-');
            const totalItemsCount = tab.isOverview
              ? grandTotal
              : (tab.id !== 'tong_quan' ? (appData[tab.id as UnitId]?.length || 0) : 0);

            return (
              <button
                key={tab.id}
                ref={(el) => { tabRefs.current[tab.id] = el; }}
                onClick={() => {
                  setCurrentTabId(tab.id);
                  setSearchQuery('');
                }}
                className={`snap-center flex-1 min-w-[108px] sm:min-w-[125px] text-center py-3 sm:py-3.5 px-3 sm:px-4 rounded-xl text-[11px] sm:text-xs uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer whitespace-nowrap border flex items-center justify-center gap-1.5 sm:gap-2 ${
                  isSelected
                    ? `${tab.activeColor} shadow-md ring-2 sm:ring-4 sm:scale-[1.02] border-slate-300/60`
                    : `bg-white/30 hover:bg-white/60 text-slate-600 hover:text-slate-900 border-white/40`
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${dotColor} shadow-xs shrink-0`}></span>
                <span>{tab.name}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-slate-900/10 text-slate-900' : 'bg-slate-400/10 text-slate-500'}`}>
                  {totalItemsCount}
                </span>
              </button>
            );
          })}
        </div>

        {/* Main interactive workstation */}
        <div id="main-workstation" className="bg-white/70 md:bg-white/60 md:backdrop-blur-xl rounded-2xl sm:rounded-3xl shadow-2xl border border-white/70 p-3 sm:p-6 lg:p-8 min-h-[420px] sm:min-h-[550px] flex flex-col">

          {!isDataLoaded ? (
            <div className="flex-grow flex flex-col items-center justify-center py-20 text-slate-400">
              <Loader2 className="w-10 h-10 animate-spin text-slate-500 mb-4" />
              <p className="text-sm font-semibold">Đang tải dữ liệu...</p>
            </div>
          ) : (
            <AnimatePresence mode="wait">

              {/* 1. OVERVIEW TAB PANEL */}
              {currentTabId === 'tong_quan' ? (
                <motion.div
                  key="tong_quan"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.25 }}
                  className="flex-grow flex flex-col gap-5 sm:gap-8"
                >
                  <div className="text-center">
                    <h2 className="text-sm sm:text-lg font-extrabold text-slate-800 tracking-tight flex items-center justify-center gap-2 px-2">
                      <Layers className="w-5 h-5 text-indigo-500 shrink-0" />
                      <span>Biểu đồ số lượng ĐLTC đang thi công theo ĐVKD</span>
                    </h2>

                    <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 bg-white/80 backdrop-blur-sm border border-slate-200/80 px-4 sm:px-6 py-2 rounded-full shadow-sm">
                      <span className="text-slate-500 text-[10px] sm:text-xs uppercase tracking-widest font-bold">Tổng số đại lý đang thi công toàn quốc:</span>
                      <span className="text-lg font-black text-slate-800 font-mono">{grandTotal}</span>
                    </div>
                  </div>

                  {/* Recharts Graphical Display */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-8">
                    <div className="lg:col-span-8 bg-white/50 backdrop-blur-sm p-3 sm:p-6 rounded-2xl border border-white/60 shadow-inner h-[280px] sm:h-[400px]" ref={chartRef}>
                      <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}>
                        <OverviewChart data={chartData} />
                      </Suspense>
                    </div>

                    {/* Numeric breakdown quicklist */}
                    <div className="lg:col-span-4 flex flex-col gap-4">
                      <div className="bg-white/80 p-4 sm:p-5 rounded-2xl border border-white/80 shadow-md">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-1.5">
                          <CheckCircle className="w-4 h-4 text-slate-400" />
                          <span>Chi tiết phân bổ</span>
                        </h3>
                        <div className="divide-y divide-slate-100">
                          {TAB_CONFIGS.filter(t => !t.isOverview).map((tab) => {
                            const count = appData[tab.id as UnitId]?.length || 0;
                            const percentage = grandTotal > 0 ? Math.round((count / grandTotal) * 100) : 0;
                            const bgC = tab.textColor.replace('text-', 'bg-');

                            return (
                              <button
                                key={tab.id}
                                onClick={() => { setCurrentTabId(tab.id); setSearchQuery(''); }}
                                className="w-full py-3 flex items-center justify-between first:pt-0 last:pb-0 text-left cursor-pointer hover:opacity-80 transition-opacity"
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`w-2.5 h-2.5 rounded-full ${bgC} shadow-xs`}></span>
                                  <span className="text-xs font-extrabold text-slate-700">{tab.name}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded-md">{percentage}%</span>
                                  <span className="text-sm font-black text-slate-800 font-mono w-6 text-right">{count}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (

                /* 2. DATA TABLE INTERFACE */
                <motion.div
                  key={currentTabId}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.25 }}
                  className="flex-grow flex flex-col"
                >
                  {/* Tab Toolbar controls */}
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 pb-4 sm:pb-6 border-b border-slate-200/60 mb-4 sm:mb-6">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 flex-grow">
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-7 rounded-full ${activeTabConfig?.textColor.replace('text-', 'bg-')}`}></div>
                        <h3 className="text-lg font-extrabold text-slate-800 tracking-tight">{activeTabConfig?.name}</h3>
                        <span className="px-3.5 py-1 bg-white border border-slate-200 text-slate-700 rounded-full text-xs font-bold shadow-xs">
                          {appData[currentTabId as UnitId]?.length || 0} ĐLTC
                        </span>
                      </div>

                      {/* Search Filter input matching Column B */}
                      <div data-html2canvas-ignore="true" className="relative w-full sm:w-72 md:w-80 sm:ml-4">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                          <Search className="w-3.5 h-3.5" />
                        </span>
                        <input
                          type="search"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Tìm kiếm ĐLTC đang thi công..."
                          className="w-full pl-9 pr-9 py-2.5 sm:py-2 bg-white/95 border border-slate-200 rounded-xl text-base sm:text-xs font-medium placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/50 focus:bg-white transition-all duration-300 shadow-xs [&::-webkit-search-cancel-button]:hidden"
                        />
                        {searchQuery && (
                          <button
                            onClick={() => setSearchQuery('')}
                            className="absolute inset-y-0 right-0 pr-3 pl-2 flex items-center text-slate-400 hover:text-slate-600"
                            aria-label="Xóa từ khóa"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {canEdit && (
                      <button
                        data-html2canvas-ignore="true"
                        onClick={handleAddNewRow}
                        className="bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs tracking-wide uppercase px-5 py-3 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 active:scale-95 flex items-center justify-center gap-2 cursor-pointer w-full sm:w-auto lg:self-auto"
                      >
                        <PlusCircle className="w-4 h-4" />
                        <span>Tạo ĐLTC Mới</span>
                      </button>
                    )}
                  </div>

                  {/* Dynamic grid container */}
                  <div className="space-y-4 sm:space-y-6 flex-grow">
                    {filteredAgencies.length === 0 ? (
                      <div className="text-center py-14 sm:py-20 px-3 border-2 border-dashed border-slate-200/80 rounded-2xl bg-white/30 backdrop-blur-xs">
                        <FolderOpen className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                        <p className="text-slate-500 text-sm font-bold">Không tìm thấy dữ liệu ĐLTC phù hợp.</p>
                        <p className="text-slate-400 text-xs mt-1 max-w-sm mx-auto">
                          {canEdit
                            ? 'Vui lòng kiểm tra lại từ khóa tìm kiếm hoặc nhấn nút "Tạo ĐLTC Mới" để bắt đầu ghi nhận tiến độ thi công.'
                            : 'Vui lòng kiểm tra lại từ khóa tìm kiếm. Đăng nhập để tạo ĐLTC mới.'}
                        </p>
                      </div>
                    ) : (
                      filteredAgencies.map((row) => (
                        <AgencyCard
                          key={row.id}
                          row={row}
                          pending={pendingUploads[row.id] || EMPTY_LIST}
                          canEdit={canEdit}
                          readOnly={readOnly}
                          actions={cardActions}
                        />
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}

        </div>
      </main>

      {/* Corporate footer */}
      <footer className="bg-slate-950 text-slate-500 text-center py-5 px-3 border-t border-slate-900 text-[10px] sm:text-[11px] uppercase tracking-wider mt-auto z-10 no-print pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        BAN PHÁT TRIỂN ĐẠI LÝ TIÊU CHUẨN HOA SEN HOME
      </footer>

      {/* Hộp đăng nhập */}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onSignIn={signIn} />}

      {/* Lightbox full-screen modal */}
      {lightboxRow && lightboxImgIdx !== null && lightboxRow.images.length > 0 && (() => {
        const totalImg = lightboxRow.images.length;
        const idx = Math.min(lightboxImgIdx, totalImg - 1);
        const currentImg = lightboxRow.images[idx];

        return (
          <div
            className="fixed inset-0 bg-slate-950/95 z-50 flex items-center justify-center backdrop-blur-md select-none touch-pan-y"
            onTouchStart={onLightboxTouchStart}
            onTouchEnd={onLightboxTouchEnd}
            onClick={closeLightbox}
          >
            <button
              onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
              className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 sm:top-6 sm:right-6 text-white/80 hover:text-white cursor-pointer p-2 transition-all hover:scale-110 z-50 bg-white/10 hover:bg-white/20 rounded-full w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center border border-white/10"
              aria-label="Đóng"
            >
              <X className="w-6 h-6" />
            </button>

            {totalImg > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); navigateLightbox(-1); }}
                className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 text-white/80 hover:text-white cursor-pointer transition-all hover:scale-110 bg-white/10 hover:bg-white/20 rounded-full w-11 h-11 sm:w-16 sm:h-16 flex items-center justify-center border border-white/5 z-50"
                aria-label="Ảnh trước"
              >
                <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8" />
              </button>
            )}

            <div className="max-w-[100vw] sm:max-w-[85vw] max-h-[80dvh] sm:max-h-[85dvh] flex items-center justify-center px-1" onClick={(e) => e.stopPropagation()}>
              <img
                src={currentImg}
                crossOrigin="anonymous"
                className="max-w-full max-h-[80dvh] sm:max-h-[85dvh] object-contain rounded-xl shadow-2xl border border-white/10"
                alt="Ảnh phóng to"
              />
            </div>

            {totalImg > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); navigateLightbox(1); }}
                className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 text-white/80 hover:text-white cursor-pointer transition-all hover:scale-110 bg-white/10 hover:bg-white/20 rounded-full w-11 h-11 sm:w-16 sm:h-16 flex items-center justify-center border border-white/5 z-50"
                aria-label="Ảnh sau"
              >
                <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8" />
              </button>
            )}

            <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-6 left-1/2 -translate-x-1/2 text-white/80 text-xs font-bold tracking-widest uppercase bg-slate-900/80 px-5 py-2 rounded-full backdrop-blur-sm shadow-xl border border-slate-700/60 font-mono">
              {idx + 1} / {totalImg}
            </div>
          </div>
        );
      })()}

      {/* PDF Export overlay with spinner progress */}
      <AnimatePresence>
        {exportProgress !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center backdrop-blur-sm"
          >
            <div className="bg-white p-6 sm:p-8 rounded-3xl max-w-sm w-full text-center shadow-2xl border border-slate-100 mx-4">
              <Loader2 className="w-12 h-12 text-red-600 animate-spin mx-auto mb-4" />
              <h3 className="text-slate-900 font-extrabold text-base uppercase tracking-wider mb-2">Đang kết xuất PDF</h3>
              {isExportingVisuals && currentExportingTabName && (
                <div className="bg-slate-50 text-slate-700 text-xs font-bold py-1.5 px-3.5 rounded-lg inline-flex items-center gap-2 border border-slate-100 mb-3 animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span>Đang ghi nhận: {currentExportingTabName}</span>
                </div>
              )}
              <p className="text-slate-500 text-xs mb-6 font-medium">
                {isExportingVisuals
                  ? "Hệ thống đang tự động duyệt qua các phân hệ và chụp lại toàn bộ giao diện làm việc."
                  : "Hệ thống đang thu thập dữ liệu và chuyển cấu trúc ảnh sang tài liệu vector. Vui lòng giữ cửa sổ hoạt động."
                }
              </p>

              {/* Progress bar */}
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden mb-2">
                <motion.div
                  className="bg-gradient-to-r from-red-500 to-red-600 h-full rounded-full"
                  style={{ width: `${exportProgress}%` }}
                  transition={{ duration: 0.1 }}
                />
              </div>
              <span className="text-xs font-black text-slate-700 font-mono">{exportProgress}%</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Thông báo (lỗi / thông tin) */}
      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-3 right-3 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md text-white font-bold text-xs px-5 py-3 rounded-xl shadow-2xl border flex items-center gap-2 z-[70] ${
              toast.kind === 'error' ? 'bg-rose-600 border-rose-500' : 'bg-slate-800 border-slate-700'
            }`}
          >
            <Info className="w-4 h-4 shrink-0" />
            <span>{toast.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
