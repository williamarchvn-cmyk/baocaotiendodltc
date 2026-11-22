import React, { memo, useState } from 'react';
import { Calendar, Plus, Trash2, X, HelpCircle, Clock, Briefcase, Image as ImageIcon, Loader2 } from 'lucide-react';
import { AgencyRow } from '../types';
import { thumbUrl } from '../lib/imageUtils';
import { calculateElapsedDays, formatViDate, toInputDateFormat } from '../lib/dateUtils';

export const MAX_IMAGES = 5;
export type EditableField = 'title' | 'notes' | 'startDate';

/** Các hàm xử lý do App cung cấp. Đối tượng này KHÔNG đổi giữa các lần render để thẻ không phải vẽ lại. */
export interface CardActions {
  updateField: (rowId: string, field: EditableField, value: string) => void;
  flushRow: (rowId: string) => void;
  deleteRow: (rowId: string) => void;
  processFiles: (files: FileList | File[], rowId: string) => void;
  removeImage: (rowId: string, index: number) => void;
  reorderImage: (rowId: string, from: number, to: number) => void;
  openLightbox: (rowId: string, index: number) => void;
  setHovered: (rowId: string | null) => void;
}

interface Props {
  row: AgencyRow;
  pending: string[];
  canEdit: boolean;
  readOnly: boolean;
  actions: CardActions;
}

/**
 * Một thẻ ĐLTC. Bọc memo: khi gõ ở thẻ này, các thẻ khác không bị vẽ lại → gõ mượt kể cả khi danh sách dài.
 */
function AgencyCard({ row, pending, canEdit, readOnly, actions }: Props) {
  const [isDragActive, setIsDragActive] = useState(false);
  const totalShown = row.images.length + pending.length;
  const canAddMore = canEdit && totalShown < MAX_IMAGES;
  const fileInputId = `file-upload-${row.id}`;

  const handleImageDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canEdit) return;
    try {
      const rawData = e.dataTransfer.getData('application/json');
      if (!rawData) return;
      const parsed = JSON.parse(rawData);
      if (!parsed || parsed.rowId !== row.id || parsed.imgIdx === targetIdx) return;
      actions.reorderImage(row.id, parsed.imgIdx, targetIdx);
    } catch (err) {
      console.error('Failed to handle image drop reorder:', err);
    }
  };

  return (
    <div
      id={`row-${row.id}`}
      className="agency-card card-enter items-stretch grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 p-3.5 sm:p-6 bg-white/60 border border-white/80 rounded-2xl shadow-xs hover:shadow-xl hover:bg-white/70 transition-[box-shadow,background-color] duration-300"
    >
      {/* Khu vực ảnh (trên máy tính nằm bên trái, trên điện thoại nằm dưới form) */}
      <div
        onMouseEnter={() => actions.setHovered(row.id)}
        onMouseLeave={() => actions.setHovered(null)}
        className="order-2 lg:order-1 lg:col-span-9 flex flex-col justify-between min-w-0"
      >
        <label className="block text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Hình ảnh thực tế ({totalShown}/{MAX_IMAGES})</span>
        </label>

        {/* Upload Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (canEdit && e.dataTransfer.types.includes('Files')) setIsDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragActive(false);
            if (canEdit && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              actions.processFiles(e.dataTransfer.files, row.id);
            }
          }}
          onClick={() => {
            if (canEdit) document.getElementById(fileInputId)?.click();
          }}
          className={`flex-grow border border-dashed rounded-xl p-2.5 sm:p-4 flex flex-col justify-center min-h-[140px] sm:min-h-[200px] transition-all duration-300 relative ${canEdit ? 'cursor-pointer' : ''} ${
            isDragActive ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-300 hover:border-slate-400 bg-white/40'
          }`}
        >
          {canEdit && (
            <input
              type="file"
              id={fileInputId}
              className="hidden"
              multiple
              accept="image/*"
              onChange={(e) => {
                if (e.target.files) actions.processFiles(e.target.files, row.id);
                e.target.value = ''; // cho phép chọn lại cùng một file
              }}
            />
          )}

          {totalShown === 0 ? (
            <div className="text-center pointer-events-none py-6">
              {canEdit ? (
                <>
                  <div className="w-10 h-10 rounded-full bg-white/80 border border-slate-200 text-slate-500 flex items-center justify-center mx-auto text-sm font-bold shadow-inner mb-2">
                    <Plus className="w-4 h-4" />
                  </div>
                  <p className="text-xs font-bold text-slate-600">Thêm hình ảnh dự án</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    <span className="hidden sm:inline">Kéo thả hoặc click để chọn tệp (Tối đa 5 hình)</span>
                    <span className="sm:hidden">Chạm để chọn ảnh (Tối đa 5 hình)</span>
                  </p>
                </>
              ) : (
                <>
                  <ImageIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-400">Chưa có hình ảnh</p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3 w-full" onClick={(e) => e.stopPropagation()}>
              {row.images.map((img, imgIdx) => (
                <div
                  key={row.imagePaths[imgIdx] || imgIdx}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/json', JSON.stringify({ rowId: row.id, imgIdx }));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleImageDrop(e, imgIdx)}
                  onClick={() => actions.openLightbox(row.id, imgIdx)}
                  className={`relative aspect-square rounded-lg overflow-hidden border border-slate-200/80 group/img shadow-xs bg-slate-100 cursor-zoom-in sm:hover:scale-[1.03] transition-transform duration-300 ${canEdit ? 'sm:cursor-grab active:opacity-70' : ''}`}
                >
                  <img
                    src={thumbUrl(img)}
                    loading="lazy"
                    decoding="async"
                    crossOrigin="anonymous"
                    onError={(e) => {
                      const t = e.currentTarget;
                      if (t.dataset.fb !== '1') {
                        t.dataset.fb = '1';
                        t.src = img; // dự phòng: dùng ảnh gốc nếu thiếu ảnh thu nhỏ
                      }
                    }}
                    className="w-full h-full object-cover pointer-events-none"
                    alt={`Ảnh dự án ${imgIdx + 1}`}
                  />
                  {canEdit && (
                    <button
                      data-html2canvas-ignore="true"
                      draggable={false}
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.removeImage(row.id, imgIdx);
                      }}
                      className="absolute top-1 right-1 bg-slate-700/90 hover:bg-slate-800 text-white w-7 h-7 sm:w-6 sm:h-6 rounded-full flex items-center justify-center shadow-md transition-all duration-300 cursor-pointer"
                      title="Xóa hình này"
                      aria-label="Xóa hình này"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}

              {/* Ảnh đang tải lên */}
              {pending.map((u) => (
                <div key={u} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200/80 bg-white shadow-xs">
                  <img src={u} decoding="async" className="w-full h-full object-cover opacity-60" alt="Đang tải lên" />
                  <div className="absolute inset-0 flex items-center justify-center bg-white/40">
                    <Loader2 className="w-6 h-6 text-slate-600 animate-spin" />
                  </div>
                </div>
              ))}

              {canAddMore && (
                <div
                  data-html2canvas-ignore="true"
                  onClick={() => document.getElementById(fileInputId)?.click()}
                  className="relative aspect-square border border-dashed border-slate-300 hover:border-slate-400 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer bg-white/50 transition-all duration-300 hover:bg-white"
                >
                  <Plus className="w-4 h-4" />
                  <span className="text-[10px] font-bold mt-1">Thêm ảnh</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Form thông tin (trên điện thoại hiển thị trước ảnh) */}
      <div className="order-1 lg:order-2 lg:col-span-3 flex flex-col justify-between gap-3.5 relative pb-4 lg:pb-0 border-b lg:border-b-0 border-slate-200/60 min-w-0">
        {canEdit && (
          <button
            data-html2canvas-ignore="true"
            onClick={() => actions.deleteRow(row.id)}
            className="absolute -top-1 -right-1 text-slate-400 hover:text-rose-600 p-2.5 transition-colors duration-300 cursor-pointer"
            title="Xóa toàn bộ đại lý này"
            aria-label="Xóa toàn bộ đại lý này"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        {/* Title Name */}
        <div className={canEdit ? 'pr-9' : ''}>
          <label className="block text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-1 flex items-center gap-1">
            <Briefcase className="w-3 h-3" />
            <span>ĐẠI LÝ TIÊU CHUẨN</span>
          </label>
          {readOnly ? (
            <div className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm sm:text-sm font-bold text-slate-800 bg-slate-50 min-h-[32px] flex items-center break-words">
              {row.title || <span className="text-slate-400 italic font-normal">(Chưa nhập tên đại lý)</span>}
            </div>
          ) : (
            <input
              id={`title-${row.id}`}
              type="text"
              value={row.title}
              onChange={(e) => actions.updateField(row.id, 'title', e.target.value)}
              onBlur={() => actions.flushRow(row.id)}
              placeholder="Nhập tên đại lý..."
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 sm:py-2 text-base sm:text-sm font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white/85 shadow-xs transition-all duration-300"
            />
          )}
        </div>

        {/* Date & Elapsed Time */}
        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <label className="block text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>Bắt đầu</span>
            </label>
            {readOnly ? (
              <div className="w-full border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs sm:text-sm text-slate-700 font-bold bg-slate-50 min-h-[32px] flex items-center">
                {formatViDate(row.startDate)}
              </div>
            ) : (
              <input
                type="date"
                value={toInputDateFormat(row.startDate)}
                onChange={(e) => actions.updateField(row.id, 'startDate', e.target.value)}
                className="w-full min-w-0 border border-slate-200 rounded-xl px-2.5 py-2 sm:py-1.5 text-base sm:text-[13px] text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white/85 shadow-xs transition-all duration-300"
              />
            )}
          </div>

          <div className="bg-white/80 border border-slate-200 px-2 rounded-xl flex items-center justify-center min-h-[36px] sm:h-[32px] self-end mb-[1px] shadow-xs">
            <span className="text-[10px] font-bold text-slate-600 tracking-tight flex items-center gap-1 whitespace-nowrap">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Đã làm: <span className="text-xs font-bold underline mx-0.5 font-mono text-slate-800">{calculateElapsedDays(row.startDate)}</span> ngày</span>
            </span>
          </div>
        </div>

        {/* Notes Content */}
        <div className="flex-grow flex flex-col">
          <label className="block text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-1 flex items-center gap-1">
            <HelpCircle className="w-3 h-3" />
            <span>Nội dung vướng mắc</span>
          </label>
          {readOnly ? (
            <div className="w-full flex-grow border border-slate-200 rounded-xl px-3 py-2 text-sm sm:text-sm text-slate-700 bg-slate-50 min-h-[90px] whitespace-pre-wrap break-words leading-relaxed">
              {row.notes || <span className="text-slate-400 italic font-normal">Chưa có nội dung vướng mắc</span>}
            </div>
          ) : (
            <textarea
              value={row.notes}
              onChange={(e) => actions.updateField(row.id, 'notes', e.target.value)}
              onBlur={() => actions.flushRow(row.id)}
              placeholder="Nhập nội dung vướng mắc hoặc ghi chú..."
              className="w-full flex-grow border border-slate-200 rounded-xl px-3 py-2 text-base sm:text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white/85 shadow-xs resize-none min-h-[110px] sm:min-h-[90px] custom-scrollbar transition-all duration-300"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(AgencyCard);
