/**
 * PDF font registration — the business PDFs must render in the SAME typefaces as
 * the customer's printed source forms, not jsPDF's default Helvetica:
 *   • Tax Invoice  → Times New Roman  (jsPDF ships "times" built-in — no load)
 *   • Delivery Challan / Cash Bill / Quotation → Calibri
 *
 * Calibri is proprietary, so we embed **Carlito** — the metric-compatible,
 * OFL-licensed Calibri substitute (public/fonts/Carlito-*.ttf). The weights are
 * fetched once at runtime (browser-cached), base64-encoded, and registered onto
 * every jsPDF document via the global "addFonts" event. If the fetch fails the
 * builders fall back to a built-in font, so PDF generation never breaks.
 */
import { jsPDF } from "jspdf";

type FontStyle = "normal" | "bold" | "italic" | "bolditalic";

const FILES: Record<FontStyle, string> = {
  normal: "Carlito-Regular.ttf",
  bold: "Carlito-Bold.ttf",
  italic: "Carlito-Italic.ttf",
  bolditalic: "Carlito-BoldItalic.ttf",
};

/** The family name to setFont() with once loaded. */
export const CALIBRI = "Carlito";

let cache: Record<FontStyle, string> | null = null;
let loading: Promise<boolean> | null = null;

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000; // avoid call-stack limits on large fonts
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

// Register the family on EVERY new jsPDF document (VFS is per-document). Runs at
// module import so any doc created after the weights load picks up Carlito.
(jsPDF as unknown as { API: { events: Array<[string, () => void]> } }).API.events.push([
  "addFonts",
  function (this: {
    addFileToVFS: (f: string, d: string) => void;
    addFont: (f: string, fam: string, style: string) => void;
  }) {
    if (!cache) return;
    (Object.keys(FILES) as FontStyle[]).forEach((style) => {
      this.addFileToVFS(FILES[style], cache![style]);
      this.addFont(FILES[style], CALIBRI, style);
    });
  },
]);

/** Fetch + cache the Carlito weights. Idempotent; safe to await repeatedly. */
export async function ensurePdfFonts(): Promise<boolean> {
  if (cache) return true;
  if (loading) return loading;
  loading = (async () => {
    try {
      const styles = Object.keys(FILES) as FontStyle[];
      const bufs = await Promise.all(
        styles.map((st) =>
          fetch(`/fonts/${FILES[st]}`).then((r) => {
            if (!r.ok) throw new Error(`font ${FILES[st]} ${r.status}`);
            return r.arrayBuffer();
          }),
        ),
      );
      const next = {} as Record<FontStyle, string>;
      styles.forEach((st, i) => { next[st] = ab2b64(bufs[i]); });
      cache = next;
      return true;
    } catch {
      return false; // graceful: builders fall back to a built-in font
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** True once the Calibri-compatible weights are loaded and will attach to new docs. */
export function calibriReady(): boolean {
  return cache !== null;
}
