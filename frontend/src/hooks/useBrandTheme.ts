import { useEffect } from "react";
import { loadCompanyProfile } from "@/lib/companyProfile";

/**
 * Convert a hex color (#rgb / #rrggbb, with or without leading #) into the
 * space-separated `H S% L%` string that our CSS custom properties expect
 * (consumed via `hsl(var(--primary))`).
 *
 * Returns null for empty/invalid input so callers can leave the CSS default.
 */
export function hexToHslString(hex: string | undefined | null): string | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, "");

  // Expand shorthand (#abc → #aabbcc)
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    h = h.split("").map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;

  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let s = 0;
  let hue = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hue = (b - r) / d + 2; break;
      default: hue = (r - g) / d + 4; break;
    }
    hue /= 6;
  }

  const H = Math.round(hue * 360);
  const S = Math.round(s * 100);
  const L = Math.round(l * 100);
  return `${H} ${S}% ${L}%`;
}

/**
 * Applies the tenant's brand color to the runtime CSS theme.
 *
 * On mount it loads the company profile, converts `primaryColor` (hex) → HSL,
 * and writes it to the `--primary`, `--ring` and `--sidebar-primary` custom
 * properties on <html>. If the color is empty/invalid the CSS default is kept.
 */
export function useBrandTheme(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
        const profile = await loadCompanyProfile();
        if (cancelled) return;
        const hsl = hexToHslString(profile.primaryColor);
        if (!hsl) return; // invalid/empty → keep CSS default
        const root = document.documentElement;
        root.style.setProperty("--primary", hsl);
        root.style.setProperty("--ring", hsl);
        root.style.setProperty("--sidebar-primary", hsl);
      } catch {
        // Network/profile failure → silently keep CSS default theme.
      }
    })();

    return () => { cancelled = true; };
  }, [enabled]);
}
