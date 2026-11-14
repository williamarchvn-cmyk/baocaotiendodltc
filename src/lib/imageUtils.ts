/**
 * Nén ảnh ngay trên trình duyệt trước khi tải lên (gói Supabase free chỉ có 1 GB lưu trữ).
 * Mỗi ảnh tạo 2 bản JPEG: ảnh gốc (cạnh dài ≤ 1600px) và ảnh thu nhỏ (cạnh dài ≤ 480px).
 */

export const FULL_MAX_EDGE = 1600;
export const FULL_QUALITY = 0.8;
export const THUMB_MAX_EDGE = 480;
export const THUMB_QUALITY = 0.7;

type Drawable = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(file: Blob): Promise<Drawable> {
  // Ưu tiên createImageBitmap: tự xoay đúng chiều ảnh chụp từ điện thoại.
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    // Dự phòng cho trình duyệt cũ (Safari < 15...)
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function render(d: Drawable, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(d.width, d.height));
  const w = Math.max(1, Math.round(d.width * scale));
  const h = Math.max(1, Math.round(d.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Không tạo được canvas'));
  ctx.fillStyle = '#ffffff'; // nền trắng cho ảnh PNG trong suốt
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(d.source, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Không nén được ảnh'))),
      'image/jpeg',
      quality
    )
  );
}

export async function makeImageVariants(file: Blob): Promise<{ full: Blob; thumb: Blob }> {
  const d = await decode(file);
  try {
    const full = await render(d, FULL_MAX_EDGE, FULL_QUALITY);
    const thumb = await render(d, THUMB_MAX_EDGE, THUMB_QUALITY);
    return { full, thumb };
  } finally {
    d.close();
  }
}

/** "abc/xyz.jpg" → "abc/xyz_t.jpg" (cũng dùng được cho URL đầy đủ) */
export function thumbPath(path: string): string {
  return path.replace(/\.jpg(\?.*)?$/i, '_t.jpg$1');
}

/** URL ảnh thu nhỏ từ URL ảnh gốc. Dùng cho lưới ảnh và PDF. */
export function thumbUrl(fullUrl: string): string {
  if (!fullUrl || fullUrl.startsWith('blob:') || fullUrl.startsWith('data:')) return fullUrl;
  return thumbPath(fullUrl);
}
