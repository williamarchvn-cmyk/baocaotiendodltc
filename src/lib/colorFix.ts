/**
 * Utility to convert modern CSS color spaces (oklch, oklab) into standard rgb/rgba format.
 * This is needed because html2canvas's CSS parser crashes when encountering oklch() or oklab() colors,
 * which are the defaults in Tailwind v4.
 */

function parsePercentOrDecimal(val: string, maxVal: number = 1): number {
  if (!val || val.toLowerCase() === 'none') return 0;
  if (val.endsWith('%')) {
    return (parseFloat(val) / 100) * maxVal;
  }
  return parseFloat(val);
}

function parseHue(val: string): number {
  if (!val || val.toLowerCase() === 'none') return 0;
  if (val.endsWith('deg')) {
    return parseFloat(val);
  }
  if (val.endsWith('rad')) {
    return (parseFloat(val) * 180) / Math.PI;
  }
  if (val.endsWith('turn')) {
    return parseFloat(val) * 360;
  }
  return parseFloat(val);
}

function oklabToRgb(L: number, a: number, b: number, alpha: number = 1): string {
  // LMS cone response
  const l_lms = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_lms = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_lms = L - 0.0894841775 * a - 1.2914855480 * b;

  // non-linear LMS to linear LMS
  const l_ = Math.pow(Math.max(0, l_lms), 3);
  const m_ = Math.pow(Math.max(0, m_lms), 3);
  const s_ = Math.pow(Math.max(0, s_lms), 3);

  // linear LMS to linear sRGB
  const r_linear = +4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g_linear = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const b_linear = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_;

  // linear sRGB to sRGB (gamma correction)
  const toSRGB = (c: number) => {
    const absC = Math.abs(c);
    const s = absC <= 0.0031308 ? 12.92 * absC : 1.055 * Math.pow(absC, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round((c < 0 ? -s : s) * 255)));
  };

  const rVal = toSRGB(r_linear);
  const gVal = toSRGB(g_linear);
  const bVal = toSRGB(b_linear);

  if (alpha === 1) {
    return `rgb(${rVal}, ${gVal}, ${bVal})`;
  } else {
    return `rgba(${rVal}, ${gVal}, ${bVal}, ${alpha})`;
  }
}

function oklchToRgbHelper(L: number, C: number, H_deg: number, alpha: number = 1): string {
  const H_rad = (H_deg * Math.PI) / 180;
  const a = C * Math.cos(H_rad);
  const b = C * Math.sin(H_rad);
  return oklabToRgb(L, a, b, alpha);
}

export function convertOklchAndOklabStrings(str: string): string {
  if (typeof str !== 'string') return str;
  if (!str.includes('oklch') && !str.includes('oklab')) return str;

  return str.replace(/(oklch|oklab)\(([^)]+)\)/gi, (match, type, inner) => {
    try {
      const parts = inner.replace(/[,/]/g, ' ').trim().split(/\s+/);
      if (parts.length < 3) return match;

      const p1 = parsePercentOrDecimal(parts[0], 1); // L
      const p2 = parsePercentOrDecimal(parts[1], 1); // C or a
      const p3 = type.toLowerCase() === 'oklch' ? parseHue(parts[2]) : parsePercentOrDecimal(parts[2], 1); // H or b
      const alpha = parts[3] !== undefined ? parsePercentOrDecimal(parts[3], 1) : 1;

      if (type.toLowerCase() === 'oklch') {
        return oklchToRgbHelper(p1, p2, p3, alpha);
      } else {
        return oklabToRgb(p1, p2, p3, alpha);
      }
    } catch (e) {
      console.warn('Failed to parse color:', match, e);
      return match;
    }
  });
}

/**
 * Temporarily intercepts window.getComputedStyle to translate all returned
 * oklch/oklab styles into compatible rgb/rgba styles during html2canvas execution.
 */
export function withColorShim<T>(fn: () => Promise<T>): Promise<T> {
  const originalGetComputedStyle = window.getComputedStyle;

  window.getComputedStyle = function (elt, pseudoElt) {
    const style = originalGetComputedStyle.call(window, elt, pseudoElt);
    return new Proxy(style, {
      get(target, prop, receiver) {
        if (prop === 'getPropertyValue') {
          return function (propertyName: string) {
            const val = target.getPropertyValue(propertyName);
            if (typeof val === 'string' && (val.includes('oklch') || val.includes('oklab'))) {
              return convertOklchAndOklabStrings(val);
            }
            return val;
          };
        }
        // Use target instead of receiver as the this-value for native CSSStyleDeclaration getters to prevent "Illegal invocation"
        const val = Reflect.get(target, prop, target);
        if (typeof val === 'string' && (val.includes('oklch') || val.includes('oklab'))) {
          return convertOklchAndOklabStrings(val);
        }
        if (typeof val === 'function') {
          return val.bind(target);
        }
        return val;
      }
    });
  };

  return fn().finally(() => {
    window.getComputedStyle = originalGetComputedStyle;
  });
}
