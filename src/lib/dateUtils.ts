/**
 * Safe date parsing and elapsed days calculation utility
 * Handles ISO, YYYY-MM-DD, and Vietnamese standard DD/MM/YYYY formats
 */

export function parseLocalDate(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;

  // Case 1: YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    return new Date(year, month, day, 0, 0, 0, 0);
  }

  // Case 2: DD/MM/YYYY or DD-MM-YYYY (Vietnamese standard: ngày/tháng/năm)
  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    return new Date(year, month, day, 0, 0, 0, 0);
  }

  // Fallback to standard Date constructor
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Calculates the exact elapsed days from start date to today (current date)
 */
export function calculateElapsedDays(startDateStr?: string): number {
  const start = parseLocalDate(startDateStr);
  if (!start) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const diffTime = today.getTime() - start.getTime();
  if (diffTime < 0) return 0;
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Formats date into DD/MM/YYYY
 */
export function formatViDate(dateStr?: string): string {
  if (!dateStr) return '--/--/----';
  const d = parseLocalDate(dateStr);
  if (!d) return dateStr || '--/--/----';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Formats date into YYYY-MM-DD for HTML input[type="date"]
 */
export function toInputDateFormat(dateStr?: string): string {
  if (!dateStr) return '';
  const d = parseLocalDate(dateStr);
  if (!d) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Ngày hôm nay theo GIỜ MÁY (YYYY-MM-DD).
 * Không dùng toISOString() vì nó tính theo UTC: trước 7h sáng giờ Việt Nam sẽ ra ngày hôm qua.
 */
export function todayLocalISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
