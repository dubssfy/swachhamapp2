import {
  SWACHHAM_LOGO_DATA_URI, SWACHHAM_WATERMARK_DATA_URI,
} from './pdfBrandAssets';

/**
 * THE ONE PLACE THE APP-GENERATED PDFs ARE BRANDED.
 *
 * The documents this app prints are different shapes — an order, a batch, a
 * socked list — and they should stay that way. What must NOT differ is the
 * mark: its size, where it sits, how faint the watermark is and, above all,
 * whether a document has one at all. Those are defined here and pulled in by
 * every builder, so a mark added to one document and forgotten in another is
 * not a thing that can happen.
 *
 * This is the client-side twin of the backend's `pdfTheme.ts`, which does the
 * same job for the six server-rendered documents. The two are separate because
 * one draws with PDFKit and the other writes CSS, not because the branding is
 * allowed to differ.
 *
 * NO EXPO IMPORTS. Everything here is a plain string, so the builders that
 * use it stay checkable off-device — which is how the branding is actually
 * verified rather than assumed.
 */

/**
 * How large the mark is drawn in a document header, in CSS pixels.
 *
 * The documents were already drawing it at this size; it is named here so the
 * three of them cannot drift apart by one edit.
 */
export const PDF_LOGO_PX = 82;

/**
 * How faint the page watermark is.
 *
 * CHOSEN AGAINST 12px TABLE TEXT, not against a blank page. The mark's orange
 * is already light, and at this alpha the darkest pixel it can put on white is
 * roughly 94% white — a tint that reads as branding from arm's length and
 * disappears behind a table row. Raising it is the single change here that can
 * make a document harder to read, which is why it is a named constant next to
 * the rule that uses it rather than a number buried in a stylesheet.
 */
export const PDF_WATERMARK_OPACITY = 0.07;

/**
 * The stylesheet every branded document includes.
 *
 * THE ART IS CARRIED HERE, IN THE STYLESHEET, AND NOT IN THE MARKUP. A
 * document's shell is emitted once while its body may be emitted once per
 * order or per batch, so inlining the base64 in the body would put one copy
 * of the art in the file per record — about 1.9 MB for a fifty-order
 * document, which is the weight that made the printer snapshot a page before
 * it had finished decoding the image. Declared as CSS, each image appears in
 * the file exactly once however many records the document holds.
 *
 * `background-size: contain` is doing what `object-fit: contain` did for the
 * `img` these rules replaced: the box is square, the art is not, so the art is
 * letterboxed inside it and never stretched. `flex: none` is needed because a
 * header is a flex row and a div, unlike an img, has no intrinsic width to
 * stop it being shrunk.
 *
 * Contains no backtick: it is embedded in TS template literals.
 */
export const PDF_BRANDING_CSS = `
  .logo { width: ${PDF_LOGO_PX}px; height: ${PDF_LOGO_PX}px; flex: none;
          border: 1px solid #E5E7EB; border-radius: 12px;
          background-image: url('${SWACHHAM_LOGO_DATA_URI}');
          background-size: contain; background-position: center;
          background-repeat: no-repeat; }
  /* The watermark is positioned against .wm-page, not against the page box.
     A combined document repeats its body once per record, so anchoring it to
     the record puts exactly one mark behind each one; a fixed-position mark
     was the alternative and does not repeat reliably across printed pages.
     Everything in the record is lifted to z-index 1 so no cell can land
     underneath the mark. pointer-events matters only if the same markup is
     ever shown on screen. */
  .wm-page { position: relative; }
  .wm-page > * { position: relative; z-index: 1; }
  /* 360x394 keeps the source art's 384x420 proportions, so giving the mark a
     box of its own does not squash it. */
  .watermark { position: absolute; top: 50%; left: 50%;
               width: 360px; height: 394px;
               transform: translate(-50%, -50%);
               opacity: ${PDF_WATERMARK_OPACITY}; z-index: 0;
               pointer-events: none;
               background-image: url('${SWACHHAM_WATERMARK_DATA_URI}');
               background-size: contain; background-position: center;
               background-repeat: no-repeat; }
`;

/**
 * The watermark element.
 *
 * Emitted FIRST inside its `.wm-page`, so it is beneath the content in
 * document order as well as by z-index. A document with one record wraps once;
 * a document that repeats a body wraps each repetition, which is what puts the
 * mark on every page rather than only the first.
 */
export const PDF_WATERMARK_ELEMENT = '<div class="watermark"></div>';

/**
 * The header mark, or nothing.
 *
 * Takes the same nullable logo every builder already passes around so the
 * call sites do not change. The VALUE is no longer used as the image source —
 * the art comes from the stylesheet above — but a null still has to produce a
 * header with no mark, which is the behaviour these documents have always had
 * when the logo could not be loaded.
 */
export function pdfLogoElement(logo: string | null): string {
  return logo ? '<div class="logo"></div>' : '';
}

/**
 * Wraps one record's markup so it carries the watermark.
 *
 * Use this around the part of a document that repeats — one order, one batch —
 * rather than around the whole file, so every page gets a mark.
 */
export function brandedPage(inner: string): string {
  return `<div class="wm-page">\n  ${PDF_WATERMARK_ELEMENT}\n${inner}\n</div>`;
}

/** Re-exported so a builder needs one import, not two. */
export { SWACHHAM_LOGO_DATA_URI, SWACHHAM_WATERMARK_DATA_URI };
