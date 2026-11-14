import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** false khi chưa khai báo biến môi trường → App hiển thị màn hình hướng dẫn thay vì trắng trang. */
export const isSupabaseConfigured = Boolean(url && key);

/**
 * Các lệnh sửa chữ (PATCH) được đánh dấu keepalive: nếu người dùng đóng tab ngay sau khi gõ,
 * trình duyệt vẫn gửi nốt yêu cầu thay vì hủy → không mất nội dung vừa nhập.
 * (Không áp dụng cho tải ảnh vì keepalive giới hạn 64 KB.)
 */
const fetchKeepalive: typeof fetch = (input, init) => {
  const method = (init?.method || 'GET').toUpperCase();
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (method === 'PATCH' && href.includes('/rest/v1/')) {
    return fetch(input, { ...init, keepalive: true });
  }
  return fetch(input, init);
};

export const supabase = createClient(
  url || 'http://localhost:54321',
  key || 'missing-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    global: { fetch: fetchKeepalive },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  }
);
