import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { AppData, AgencyRow, TabConfig } from '../types';
import { withColorShim } from './colorFix';
import { calculateElapsedDays, formatViDate, todayLocalISO } from './dateUtils';
import { thumbUrl } from './imageUtils';

// Helper to chunk array for clean pagination
const chunkArray = <T>(array: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

// Standard A4 dimensions in pixels at 96 DPI: 595 x 842 pt -> ~794 x 1123 px
// We use a clean 800 x 1130 canvas for high-quality representation.
const PAGE_WIDTH = 800;
const PAGE_HEIGHT = 1130;


/**
 * html2canvas vẽ chữ thấp hơn vị trí thật vài px với font có dấu tiếng Việt cao (Be Vietnam Pro),
 * làm chữ lệch so với chấm tròn / khung. Hàm này nâng toàn bộ chữ lên đúng một lượng tỉ lệ theo cỡ chữ
 * (position: relative chỉ dời nét vẽ, không đổi bố cục) để chữ nằm thẳng hàng như trên màn hình.
 */
const TEXT_NUDGE_EM = 0.5;
function fixTextBaseline(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    if (n.nodeValue && n.nodeValue.trim() && n.parentElement && n.parentElement.tagName !== 'STYLE') nodes.push(n);
  }
  nodes.forEach((n) => {
    const span = document.createElement('span');
    span.style.position = 'relative';
    span.style.top = `-${TEXT_NUDGE_EM}em`;
    n.parentNode!.insertBefore(span, n);
    span.appendChild(n);
  });
}

// Wait for all images in an element to load
const waitForImages = (element: HTMLElement): Promise<void[]> => {
  const images = element.querySelectorAll('img');
  const promises: Promise<void>[] = [];
  images.forEach((img) => {
    if (!img.complete) {
      promises.push(
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve(), 10000); // không để 1 ảnh hỏng treo cả quá trình xuất
          img.onload = () => { clearTimeout(timer); resolve(); };
          img.onerror = () => { clearTimeout(timer); resolve(); }; // continue even if an image fails
        })
      );
    }
  });
  return Promise.all(promises);
};

// Helper to escape HTML characters
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}



// Format notes into clean, left-aligned, beautifully structured bullet items
function renderFormattedNotes(rawNotes?: string): string {
  if (!rawNotes || !rawNotes.trim()) {
    return '<div class="text-slate-400 italic text-center py-3 text-[10px] w-full">Chưa có nội dung ghi nhận vướng mắc / tiến độ.</div>';
  }

  const lines = rawNotes
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    return '<div class="text-slate-400 italic text-center py-3 text-[10px] w-full">Chưa có nội dung ghi nhận vướng mắc / tiến độ.</div>';
  }

  const itemsHtml = lines.map(line => {
    // Check if line matches "Label: Value" (e.g. "Bảng hiệu: Đã làm bảng hiệu...")
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
      const label = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      return `
        <div class="flex items-start gap-2 leading-relaxed">
          <span class="inline-block w-1.5 h-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0"></span>
          <div class="flex-grow text-[11px]">
            <span class="font-bold text-slate-800">${escapeHtml(label)}:</span>
            <span class="text-slate-600 ml-1">${escapeHtml(value)}</span>
          </div>
        </div>
      `;
    }

    // Check for existing bullet symbol (-, *, •)
    if (/^[-*•]\s*/.test(line)) {
      const content = line.replace(/^[-*•]\s*/, '').trim();
      return `
        <div class="flex items-start gap-2 leading-relaxed">
          <span class="inline-block w-1.5 h-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0"></span>
          <div class="flex-grow text-[11px] text-slate-700">${escapeHtml(content)}</div>
        </div>
      `;
    }

    // Standard line: align identically with clean bullet dot
    return `
      <div class="flex items-start gap-2 leading-relaxed">
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0"></span>
        <div class="flex-grow text-[11px] text-slate-700 font-medium">${escapeHtml(line)}</div>
      </div>
    `;
  }).join('');

  return `<div class="flex flex-col gap-1.5 w-full">${itemsHtml}</div>`;
}

// Generate HTML for each agency card with harmonious, clean layout
function renderAgencyCardHtml(agency: AgencyRow): string {
  const zDays = calculateElapsedDays(agency.startDate);

  return `
    <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between" style="min-height: 440px;">
      <!-- Header Card (Top of red box) -->
      <div class="flex justify-between items-center border-b border-slate-100 pb-3 mb-3">
        <div>
          <div class="flex items-center gap-1.5 mb-1">
            <span class="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
            <span class="text-[9px] uppercase tracking-wider text-indigo-600 font-extrabold">ĐẠI LÝ TIÊU CHUẨN</span>
          </div>
          <h3 class="text-base font-extrabold text-slate-800 leading-tight">
            ${escapeHtml(agency.title || '(Chưa nhập tên đại lý)')}
          </h3>
        </div>
        <div class="flex items-center gap-3">
          <div class="bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-1.5 text-right">
            <span class="text-[8px] uppercase font-bold text-slate-400 block tracking-wider leading-none mb-1">Ngày bắt đầu</span>
            <span class="text-xs font-bold text-slate-700 leading-none">${formatViDate(agency.startDate)}</span>
          </div>
          <div class="bg-amber-50 border border-amber-200/90 px-3.5 py-1.5 rounded-lg flex items-center justify-center shadow-2xs">
            <span class="text-[10px] font-bold text-amber-800 tracking-tight">
              Đã thi công: <span class="text-xs font-black text-amber-900 mx-0.5 font-mono">${zDays}</span> ngày
            </span>
          </div>
        </div>
      </div>

      <!-- Content Card -->
      <div class="flex-grow flex flex-col justify-between">
        <!-- Vướng mắc (Middle of red box) -->
        <div class="mb-3.5">
          <div class="flex items-center gap-1.5 mb-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
            <span class="text-[9px] uppercase tracking-wider text-rose-600 font-extrabold">NỘI DUNG VƯỚNG MẮC / TIẾN ĐỘ THI CÔNG</span>
          </div>
          <div class="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 min-h-[92px] flex items-center">
            ${renderFormattedNotes(agency.notes)}
          </div>
        </div>

        <!-- Photos -->
        <div>
          <div class="flex items-center gap-1.5 mb-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            <span class="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold">HÌNH ẢNH THỰC TẾ DỰ ÁN (${agency.images.length}/5)</span>
          </div>
          ${agency.images.length === 0 ? `
            <div class="border border-dashed border-slate-200 rounded-lg bg-slate-50/50 p-4 text-center">
              <span class="text-[10px] text-slate-400 italic font-medium">Chưa có hình ảnh báo cáo thực tế nào được tải lên.</span>
            </div>
          ` : `
            <div class="grid grid-cols-5 gap-2.5">
              ${agency.images.map(img => `
                <div class="aspect-square rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                  <img src="${escapeHtml(thumbUrl(img))}" crossorigin="anonymous" class="w-full h-full object-cover">
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

export async function exportTabToPDF(
  tabConfig: TabConfig,
  agencies: AgencyRow[],
  onProgress?: (progress: number) => void
): Promise<void> {
  const tabName = tabConfig.name;
  const todayStr = new Date().toLocaleDateString('vi-VN');

  // Create temporary container for rendering pages
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = `${PAGE_WIDTH}px`;
  container.style.backgroundColor = '#f8fafc'; // light slate background
  document.body.appendChild(container);

  try {
    // If there are no agencies, show an empty state page
    const itemsToRender = agencies.length > 0 ? agencies : [];
    
    // Chunk agencies: 2 agencies per A4 page fits perfectly without clipping!
    const agencyChunks = chunkArray(itemsToRender, 2);
    const totalPages = Math.max(1, agencyChunks.length);

    // Render HTML pages in container
    if (itemsToRender.length === 0) {
      // Empty page
      const pageEl = document.createElement('div');
      pageEl.className = 'bg-slate-50 relative p-12 flex flex-col justify-between';
      pageEl.style.width = `${PAGE_WIDTH}px`;
      pageEl.style.height = `${PAGE_HEIGHT}px`;
      pageEl.style.boxSizing = 'border-box';

      pageEl.innerHTML = `
        <!-- Header -->
        <div class="flex justify-between items-center border-b-2 border-red-500 pb-4">
          <div class="flex items-center gap-3">
            <div class="bg-red-600 px-3 py-1.5 rounded-lg text-white font-extrabold tracking-wider text-sm">HSH</div>
            <div>
              <h1 class="text-xs font-black uppercase text-slate-800 tracking-wider">BÁO CÁO TIẾN ĐỘ ĐẠI LÝ TIÊU CHUẨN</h1>
              <p class="text-[9px] text-slate-400 uppercase font-bold">ĐƠN VỊ KINH DOANH: ${tabName}</p>
            </div>
          </div>
          <div class="text-right">
            <p class="text-[10px] font-bold text-slate-600">Ngày lập: ${todayStr}</p>
            <p class="text-[8px] text-slate-400 font-semibold uppercase">TÀI LIỆU NỘI BỘ</p>
          </div>
        </div>

        <!-- Body Empty -->
        <div class="flex-grow flex flex-col justify-center items-center text-center">
          <div class="w-16 h-16 rounded-full bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center text-xl mb-4">
            📂
          </div>
          <h2 class="text-sm font-extrabold text-slate-700 uppercase tracking-wider">Không có đại lý đang thi công</h2>
          <p class="text-[11px] text-slate-400 mt-1 max-w-sm">Hiện tại đơn vị này chưa ghi nhận đại lý tiêu chuẩn nào đang trong quá trình thi công.</p>
        </div>

        <!-- Footer -->
        <div class="border-t border-slate-200 pt-3 flex justify-between text-[9px] font-bold text-slate-400 tracking-wider uppercase">
          <span>BAN PHÁT TRIỂN ĐẠI LÝ TIÊU CHUẨN HOA SEN HOME</span>
          <span>Trang 1 / 1</span>
        </div>
      `;
      container.appendChild(pageEl);
    } else {
      // Render each chunk as a separate page
      agencyChunks.forEach((chunk, pageIndex) => {
        const pageEl = document.createElement('div');
        pageEl.className = 'bg-slate-50 relative p-10 flex flex-col justify-between';
        pageEl.style.width = `${PAGE_WIDTH}px`;
        pageEl.style.height = `${PAGE_HEIGHT}px`;
        pageEl.style.boxSizing = 'border-box';

        // Page content
        let contentHtml = `
          <!-- Header -->
          <div class="flex justify-between items-center border-b-2 border-red-500 pb-4 mb-6">
            <div class="flex items-center gap-3">
              <div class="bg-red-600 px-3 py-1.5 rounded-lg text-white font-extrabold tracking-wider text-sm">HSH</div>
              <div>
                <h1 class="text-xs font-black uppercase text-slate-800 tracking-wider">BÁO CÁO TIẾN ĐỘ ĐẠI LÝ TIÊU CHUẨN ĐANG THI CÔNG</h1>
                <p class="text-[9px] text-slate-500 uppercase font-bold">ĐƠN VỊ KINH DOANH: <span class="text-slate-800 font-extrabold">${tabName}</span></p>
              </div>
            </div>
            <div class="text-right">
              <p class="text-[10px] font-bold text-slate-600">Ngày lập: ${todayStr}</p>
              <p class="text-[8px] text-slate-400 font-semibold uppercase">TÀI LIỆU NỘI BỘ</p>
            </div>
          </div>

          <!-- Cards Stack -->
          <div class="flex-grow flex flex-col gap-6">
        `;

        chunk.forEach((agency) => {
          contentHtml += renderAgencyCardHtml(agency);
        });

        contentHtml += `
          </div>

          <!-- Footer -->
          <div class="border-t border-slate-200 pt-3 flex justify-between text-[9px] font-bold text-slate-400 tracking-wider uppercase mt-4">
            <span>BAN PHÁT TRIỂN ĐẠI LÝ TIÊU CHUẨN HOA SEN HOME</span>
            <span>Trang ${pageIndex + 1} / ${totalPages}</span>
          </div>
        `;

        pageEl.innerHTML = contentHtml;
        container.appendChild(pageEl);
      });
    }

    // Wait for all images in the container to complete loading
    fixTextBaseline(container);
    await waitForImages(container);

    // Initialize jsPDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4',
    });

    const pages = container.children;
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) {
        pdf.addPage();
      }

      onProgress?.(Math.round((i / pages.length) * 100));

      const pageCanvas = await withColorShim(() => html2canvas(pages[i] as HTMLElement, {
        scale: 2, // high quality sharp print
        useCORS: true,
        backgroundColor: '#f8fafc',
        logging: false,
      }));

      const imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
      
      // Standard A4 sizes in pt are 595.28 x 841.89
      pdf.addImage(imgData, 'JPEG', 0, 0, 595.28, 841.89, undefined, 'FAST');
    }

    onProgress?.(100);

    // Save File
    const sanitizedTabName = tabName.replace(/\s+/g, '_').toUpperCase();
    const cleanDate = todayLocalISO();
    pdf.save(`BAO_CAO_TIEN_DO_DLTC_${sanitizedTabName}_${cleanDate}.pdf`);

  } catch (error) {
    console.error('Error exporting PDF:', error);
    throw error;
  } finally {
    // Clean up
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
  }
}

export async function exportFullReportToPDF(
  appData: AppData,
  configs: TabConfig[],
  chartElement: HTMLElement | null,
  onProgress?: (progress: number) => void
): Promise<void> {
  const todayStr = new Date().toLocaleDateString('vi-VN');
  const todayIso = todayLocalISO();

  // Create temporary container for rendering pages
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = `${PAGE_WIDTH}px`;
  container.style.backgroundColor = '#f8fafc';
  document.body.appendChild(container);

  try {
    const listPagesToRender: HTMLElement[] = [];

    // ==========================================
    // PAGE 1: COVER PAGE AND OVERVIEW STATS
    // ==========================================
    const coverPage = document.createElement('div');
    coverPage.className = 'bg-slate-900 relative p-16 flex flex-col justify-between text-white';
    coverPage.style.width = `${PAGE_WIDTH}px`;
    coverPage.style.height = `${PAGE_HEIGHT}px`;
    coverPage.style.boxSizing = 'border-box';

    // Summing counts
    const counts = {
      hsh_mb: appData.hsh_mb.length,
      hsh_mt: appData.hsh_mt.length,
      hsh_mn: appData.hsh_mn.length,
      pkd_mb: appData.pkd_mb.length,
      pkd_mn: appData.pkd_mn.length,
      pkd_da: appData.pkd_da.length,
    };
    const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

    // Capture chart element snapshot as static image if available
    let chartImgSrc = '';
    if (chartElement) {
      try {
        const chartCanvas = await withColorShim(() => html2canvas(chartElement, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff'
        }));
        chartImgSrc = chartCanvas.toDataURL('image/jpeg', 0.95);
      } catch (e) {
        console.warn("Failed to capture chart container element", e);
      }
    }

    coverPage.innerHTML = `
      <!-- Red brand bar -->
      <div class="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-red-500 via-red-600 to-red-700"></div>

      <!-- Top info -->
      <div class="flex justify-between items-center">
        <div class="flex items-center gap-3">
          <div class="bg-red-600 px-4 py-2 rounded-xl text-white font-extrabold tracking-wider text-base border border-red-500 shadow-md">HSH</div>
          <span class="text-[10px] font-bold text-slate-400 tracking-widest uppercase">HOA SEN HOME</span>
        </div>
        <div class="text-right">
          <span class="px-2.5 py-1 bg-red-600/15 border border-red-500/20 rounded-md text-[9px] font-bold tracking-wider text-red-400">BÁO CÁO NỘI BỘ</span>
        </div>
      </div>

      <!-- Mid content: Corporate Title -->
      <div class="my-auto space-y-8 py-10">
        <div class="space-y-4">
          <span class="text-xs font-black text-red-500 tracking-widest uppercase block">BAN PHÁT TRIỂN ĐẠI LÝ TIÊU CHUẨN</span>
          <h1 class="text-3xl font-black uppercase tracking-tight leading-tight max-w-xl text-white">
            Báo cáo Tiến độ các Đại lý tiêu chuẩn đang thi công
          </h1>
          <div class="w-16 h-1 bg-red-500 rounded"></div>
        </div>

        <p class="text-slate-400 text-xs leading-relaxed max-w-lg font-medium">
          Hệ thống tổng hợp và đánh giá tình hình thi công, tiến độ thực tế cùng các nội dung vướng mắc cốt lõi của từng Đại lý tiêu chuẩn Hoa Sen Home trên toàn quốc.
        </p>

        <!-- Summary Grid -->
        <div class="grid grid-cols-3 gap-4 pt-4">
          <div class="bg-slate-800/50 border border-slate-800 p-4 rounded-xl shadow-inner">
            <span class="text-slate-500 text-[10px] uppercase font-bold tracking-wider block mb-1">TỔNG ĐẠI LÝ</span>
            <span class="text-2xl font-black text-white">${totalCount}</span> <span class="text-xs font-bold text-slate-400">đại lý</span>
          </div>
          <div class="bg-slate-800/50 border border-slate-800 p-4 rounded-xl shadow-inner">
            <span class="text-slate-500 text-[10px] uppercase font-bold tracking-wider block mb-1">ĐƠN VỊ KINH DOANH</span>
            <span class="text-2xl font-black text-white">6</span> <span class="text-xs font-bold text-slate-400">đơn vị</span>
          </div>
          <div class="bg-slate-800/50 border border-slate-800 p-4 rounded-xl shadow-inner">
            <span class="text-slate-500 text-[10px] uppercase font-bold tracking-wider block mb-1">NGÀY LẬP</span>
            <span class="text-sm font-bold text-white block mt-2">${todayStr}</span>
          </div>
        </div>

        <!-- Mini table for overview counts -->
        <div class="bg-slate-800/30 border border-slate-800/60 rounded-xl p-4 mt-6">
          <h3 class="text-slate-300 text-xs font-extrabold uppercase tracking-wide mb-3">Tỉ lệ phân bổ Đại lý tiêu chuẩn đang thi công</h3>
          <div class="grid grid-cols-6 gap-2 text-center">
            ${configs.filter(c => !c.isOverview).map(c => `
              <div class="border-r border-slate-800/60 last:border-0 py-1">
                <span class="text-[9px] font-bold text-slate-400 block">${c.name}</span>
                <span class="text-sm font-black text-white block mt-0.5">${appData[c.id as keyof AppData]?.length || 0}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Footer cover -->
      <div class="border-t border-slate-800/80 pt-4 flex justify-between items-center text-[9px] font-bold text-slate-500 tracking-wider uppercase">
        <span>© 2026 TẬP ĐOÀN HOA SEN — ĐẠI LÝ TIÊU CHUẨN</span>
        <span>Phòng Phát Triển Đại Lý Tiêu Chuẩn</span>
      </div>
    `;

    container.appendChild(coverPage);
    listPagesToRender.push(coverPage);

    // ==========================================
    // PAGE 2: CHARTS & OVERVIEW STATS (WITH CSS FALLBACK)
    // ==========================================
    const chartPage = document.createElement('div');
    chartPage.className = 'bg-slate-50 relative p-12 flex flex-col justify-between';
    chartPage.style.width = `${PAGE_WIDTH}px`;
    chartPage.style.height = `${PAGE_HEIGHT}px`;
    chartPage.style.boxSizing = 'border-box';

    chartPage.innerHTML = `
      <!-- Header -->
      <div class="flex justify-between items-center border-b-2 border-red-500 pb-4">
        <div class="flex items-center gap-3">
          <div class="bg-red-600 px-3 py-1.5 rounded-lg text-white font-extrabold tracking-wider text-sm">HSH</div>
          <div>
            <h1 class="text-xs font-black uppercase text-slate-800 tracking-wider">TỔNG QUAN PHÂN BỔ ĐẠI LÝ TOÀN QUỐC</h1>
            <p class="text-[9px] text-slate-400 uppercase font-bold">BIỂU ĐỒ BÁO CÁO TIẾN ĐỘ</p>
          </div>
        </div>
        <div class="text-right">
          <p class="text-[10px] font-bold text-slate-600">Ngày lập: ${todayStr}</p>
          <p class="text-[8px] text-slate-400 font-semibold uppercase">TÀI LIỆU NỘI BỘ</p>
        </div>
      </div>

      <!-- Body with chart image or fallback CSS chart -->
      <div class="flex-grow flex flex-col justify-center items-center py-6">
        <h2 class="text-xs font-bold text-slate-600 uppercase tracking-widest mb-6">Biểu đồ thống kê số lượng Đại lý tiêu chuẩn đang thi công</h2>
        
        ${chartImgSrc ? `
          <div class="bg-white border border-slate-200/80 p-8 rounded-2xl shadow-md w-full flex justify-center items-center h-[340px]">
            <img src="${chartImgSrc}" class="max-w-full max-h-[300px] object-contain">
          </div>
        ` : `
          <div class="bg-white border border-slate-200/80 p-8 rounded-2xl shadow-md w-full flex flex-col justify-center h-[340px]">
            <div class="flex items-end justify-around h-48 border-b border-slate-200 pb-4 px-10">
              ${configs.filter(c => !c.isOverview).map(c => {
                const count = appData[c.id as keyof AppData]?.length || 0;
                const maxCount = Math.max(...configs.filter(x => !x.isOverview).map(x => appData[x.id as keyof AppData]?.length || 0), 1);
                const heightPercent = Math.max(8, Math.round((count / maxCount) * 85)); // minimum 8% for visibility
                return `
                  <div class="flex flex-col items-center flex-1 max-w-[80px]" style="height: 100%; justify-content: flex-end;">
                    <span class="text-[10px] font-extrabold text-slate-800 mb-2">${count} ĐLTC</span>
                    <div class="w-10 rounded-t-lg" style="height: ${heightPercent}%; background: rgba(147, 197, 253, 0.85); border: 1.5px solid rgba(96, 165, 250, 0.9); border-bottom: 0;"></div>
                    <span class="text-[9px] font-bold text-slate-500 uppercase tracking-wider mt-3 text-center leading-tight whitespace-nowrap">${c.name}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `}
        
        <!-- Key summary message -->
        <div class="mt-8 border-l-4 border-indigo-500 bg-white shadow-xs p-4 rounded-r-xl w-full">
          <span class="text-[10px] uppercase tracking-wider font-extrabold text-indigo-600 block mb-1">Nhận định tổng quan</span>
          <p class="text-[11px] font-medium text-slate-600 leading-relaxed">
            Tính đến ngày ${todayStr}, toàn quốc hiện đang ghi nhận <strong class="text-slate-800 font-black">${totalCount} đại lý tiêu chuẩn</strong> đang tiến hành thi công lắp đặt và thiết kế nội ngoại thất. Trong đó, các đơn vị đang tiếp tục bám sát và đốc thúc đẩy nhanh tiến độ hoàn thiện cơ sở hạ tầng.
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div class="border-t border-slate-200 pt-3 flex justify-between text-[9px] font-bold text-slate-400 tracking-wider uppercase">
        <span>BAN PHÁT TRIỂN ĐẠI LÝ TIÊU CHUẨN HOA SEN HOME</span>
        <span>Trang 2 / ...</span>
      </div>
    `;

    container.appendChild(chartPage);
    listPagesToRender.push(chartPage);

    // ==========================================
    // SUBSEQUENT PAGES: DETAILS OF EACH BUSSINESS UNIT
    // ==========================================
    const activeConfigs = configs.filter(c => !c.isOverview);
    
    // We will render cards unit by unit
    activeConfigs.forEach((unitConfig) => {
      const unitId = unitConfig.id as keyof AppData;
      const unitAgencies = appData[unitId] || [];

      if (unitAgencies.length > 0) {
        // Chunk them into 2 cards per page
        const agencyChunks = chunkArray(unitAgencies, 2);
        
        agencyChunks.forEach((chunk) => {
          const pageEl = document.createElement('div');
          pageEl.className = 'bg-slate-50 relative p-10 flex flex-col justify-between';
          pageEl.style.width = `${PAGE_WIDTH}px`;
          pageEl.style.height = `${PAGE_HEIGHT}px`;
          pageEl.style.boxSizing = 'border-box';

          let pageHtml = `
            <!-- Header -->
            <div class="flex justify-between items-center border-b-2 border-red-500 pb-4 mb-6">
              <div class="flex items-center gap-3">
                <div class="bg-red-600 px-3 py-1.5 rounded-lg text-white font-extrabold tracking-wider text-sm">HSH</div>
                <div>
                  <h1 class="text-xs font-black uppercase text-slate-800 tracking-wider">BÁO CÁO TIẾN ĐỘ ĐẠI LÝ TIÊU CHUẨN ĐANG THI CÔNG</h1>
                  <p class="text-[9px] text-slate-500 uppercase font-bold">ĐƠN VỊ KINH DOANH: <span class="text-slate-800 font-extrabold">${unitConfig.name}</span></p>
                </div>
              </div>
              <div class="text-right">
                <p class="text-[10px] font-bold text-slate-600">Ngày lập: ${todayStr}</p>
                <p class="text-[8px] text-slate-400 font-semibold uppercase">TÀI LIỆU NỘI BỘ</p>
              </div>
            </div>

            <!-- Cards Stack -->
            <div class="flex-grow flex flex-col gap-6">
          `;

          chunk.forEach((agency) => {
            pageHtml += renderAgencyCardHtml(agency);
          });

          pageHtml += `
            </div>

            <!-- Footer -->
            <div class="border-t border-slate-200 pt-3 flex justify-between text-[9px] font-bold text-slate-400 tracking-wider uppercase mt-4">
              <span>BAN PHÁT TRIỂN ĐẠI LÝ TIÊU CHUẨN HOA SEN HOME</span>
              <span>Trang ... / ...</span>
            </div>
          `;

          pageEl.innerHTML = pageHtml;
          container.appendChild(pageEl);
          listPagesToRender.push(pageEl);
        });
      }
    });

    // Update page counters dynamically
    listPagesToRender.forEach((page, index) => {
      const pageFooter = page.querySelector('.border-t span:last-child');
      if (pageFooter) {
        pageFooter.innerHTML = `Trang ${index + 1} / ${listPagesToRender.length}`;
      }
    });

    // Wait for all images in container to load
    fixTextBaseline(container);
    await waitForImages(container);

    // Create jsPDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4',
    });

    for (let i = 0; i < listPagesToRender.length; i++) {
      if (i > 0) {
        pdf.addPage();
      }

      onProgress?.(Math.round((i / listPagesToRender.length) * 100));

      const pageCanvas = await withColorShim(() => html2canvas(listPagesToRender[i], {
        scale: 2,
        useCORS: true,
        backgroundColor: i === 0 ? '#0f172a' : '#f8fafc', // first is dark, rest light
        logging: false,
      }));

      const imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', 0, 0, 595.28, 841.89, undefined, 'FAST');
    }

    onProgress?.(100);

    // Save
    pdf.save(`BAO_CAO_TIEN_DO_DLTC_TOAN_QUOC_${todayIso}.pdf`);

  } catch (error) {
    console.error('Error generating complete report PDF:', error);
    throw error;
  } finally {
    // Clean up
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
  }
}
