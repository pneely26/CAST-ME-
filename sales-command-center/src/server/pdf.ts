import "server-only";
import type { PdfMark, PdfPageContent } from "@/lib/domain/salesReport";

const MAX_PAGES = 60;

type Img = { width: number; height: number; kind?: number; data?: Uint8ClampedArray | Uint8Array };

/**
 * Is a small check-box image ticked? Looks for dark pixels inside the box (the border is ignored),
 * so it works whatever image the report uses for checked and unchecked boxes.
 */
function isTicked(img: Img): boolean {
  const { width: w, height: h, data, kind } = img;
  if (!data || !w || !h) return false;
  const ch = kind === 3 ? 4 : kind === 2 ? 3 : 0; // 1 = 1-bit grayscale, 2 = RGB, 3 = RGBA
  const dark = (x: number, y: number) => {
    if (!ch) return ((data[y * Math.ceil(w / 8) + (x >> 3)] >> (7 - (x & 7))) & 1) === 0;
    const i = (y * w + x) * ch;
    return data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128 && (ch === 3 || data[i + 3] > 128);
  };
  const x0 = Math.ceil(w * 0.25), x1 = Math.floor(w * 0.75), y0 = Math.ceil(h * 0.25), y1 = Math.floor(h * 0.75);
  let n = 0, total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, total++) if (dark(x, y)) n++;
  return total > 0 && n / total > 0.05;
}

/** Positioned text and small images (check boxes) from each page of a PDF. Nothing in the PDF is executed. */
export async function readPdfPages(bytes: Uint8Array): Promise<PdfPageContent[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, isOffscreenCanvasSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const out: PdfPageContent[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      const { height } = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.flatMap((i) => ("str" in i && i.str.trim() ? [{ str: i.str, x: i.transform[4], y: height - i.transform[5], w: i.width }] : []));

      const ops = await page.getOperatorList();
      type M = [number, number, number, number, number, number];
      const mul = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
      let ctm: M = [1, 0, 0, 1, 0, 0];
      const stack: M[] = [];
      const placed: { name: string; x: number; y: number; w: number; h: number }[] = [];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const f = ops.fnArray[i], a = ops.argsArray[i];
        if (f === pdfjs.OPS.save) stack.push(ctm);
        else if (f === pdfjs.OPS.restore) ctm = stack.pop() ?? ctm;
        else if (f === pdfjs.OPS.transform) ctm = mul(ctm, a as M);
        else if (f === pdfjs.OPS.paintImageXObject) {
          const w = Math.abs(ctm[0]), h = Math.abs(ctm[3]);
          if (w < 30 && h < 30) placed.push({ name: a[0] as string, x: ctm[4], y: height - ctm[5] - h, w, h }); // only small images can be check boxes
        }
      }
      const ticked = new Map<string, boolean>();
      for (const name of new Set(placed.map((m) => m.name))) {
        // images shared across pages ("g_" names) live in commonObjs; give up on one that never arrives
        const store = name.startsWith("g_") ? page.commonObjs : page.objs;
        const img = await new Promise<Img | null>((resolve) => {
          const timer = setTimeout(() => resolve(null), 5000);
          try {
            store.get(name, (o: Img) => {
              clearTimeout(timer);
              resolve(o);
            });
          } catch {
            clearTimeout(timer);
            resolve(null);
          }
        });
        ticked.set(name, img ? isTicked(img) : false);
      }
      const marks: PdfMark[] = placed.map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h, checked: ticked.get(m.name) ?? false }));
      out.push({ items, marks });
      page.cleanup();
    }
    return out;
  } finally {
    await doc.destroy();
  }
}
