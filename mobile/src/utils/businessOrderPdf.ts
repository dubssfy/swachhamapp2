import { printPdfAs } from './pdfFile';
import { SWACHHAM_LOGO_DATA_URI } from './pdfBrandAssets';
import { BusinessOrderDetail } from '../services/businessOrderApi';
import {
  buildBusinessOrderPdfHtml, buildCombinedOrderPdfHtml, buildPdfFileName,
} from './businessOrderPdfHtml';

/*
 * The document itself lives in `businessOrderPdfHtml`, which has no Expo
 * imports and can therefore be built and checked off-device. It is re-exported
 * here so every existing import of this module keeps working unchanged.
 */
export * from './businessOrderPdfHtml';

/**
 * Business Order PDF.
 *
 * ONE generator — `generateOrderPdf` — behind both Share PDF and Download
 * PDF, so the two actions can never drift apart. It renders the HTML below
 * through expo-print, which produces a real PDF (not HTML with a renamed
 * extension), and names the file after the order number.
 *
 * Everything here is read-only: it renders the order the API already
 * returned and never writes back.
 *
 * Brand mark is always the capitalised word SWACHHAM with "Business of
 * Laundering" directly beneath it, and the existing Swachham logo alongside.
 */

/**
 * The single PDF generator behind both actions.
 *
 * expo-print renders the HTML to a genuine PDF; the file is then renamed to
 * `<order number>.pdf` in the cache directory so Share and Download hand over
 * exactly the same document under exactly the same name. The URI is
 * percent-encoded because an order number contains `#`, which would otherwise
 * be read as a URI fragment.
 */
export async function generateOrderPdf(
  order: BusinessOrderDetail
): Promise<{ uri: string; fileName: string }> {
  const logo = await getLogoDataUri();

  // Named for the business first, then the order. See buildPdfFileName.
  const fileName = buildPdfFileName(order.order_number, order.business_name);

  return printPdfAs(buildBusinessOrderPdfHtml(order, logo), fileName);
}

/**
 * MANY ORDERS, ONE PDF — the Combine Order document.
 *
 * NOT A SECOND GENERATOR. It goes through the same `getLogoDataUri`, the same
 * expo-print call and the same naming as the single-order PDF above, and each
 * order inside it is rendered by the very function that draws the one-order
 * document. What arrives is the existing Order Details page, once per order.
 *
 * THE ORDER OF THE ARRAY IS THE ORDER OF THE PAGES. Sorting belongs to the
 * caller, which knows what it is sorting by; this only lays them out.
 */
export async function generateCombinedOrderPdf(
  orders: BusinessOrderDetail[],
  fileName: string
): Promise<{ uri: string; fileName: string }> {
  const logo = await getLogoDataUri();
  return printPdfAs(buildCombinedOrderPdfHtml(orders, logo), fileName);
}

/*
 * `renameIntoCache` used to live here and is gone.
 *
 * It moved the printed file into the cache, and on Expo Go it could never
 * succeed: the printer writes outside the sandbox expo-file-system grants
 * permissions for, so both the move and the copy were refused before they
 * reached the disk, and every document fell through to the warning. It is
 * replaced by `printPdfAs` in `utils/pdfFile`, which is shared with the batch
 * and socked documents so the three cannot drift apart again. The full
 * explanation is in that file's header.
 */

/**
 * Swachham logo, as a data URI the document can draw offline.
 *
 * Exported so other PDF generators — `batchDetailsPdf.ts` included — use the
 * same asset instead of loading it a second way. It stays `async` and
 * nullable because those callers `await` it; there is simply nothing left
 * inside that can suspend or fail.
 *
 * WHY THIS IS A CONSTANT AND NOT AN ASSET READ.
 *
 * It used to resolve the PNG at runtime through `Asset.fromModule` and
 * `FileSystem.readAsStringAsync`, and returned null — a silently logo-less
 * document — whenever any step of that failed. Two separate things made it
 * fail:
 *
 *   THE ASSET DID NOT ALWAYS RESOLVE TO A READABLE FILE. Under Metro it is
 *   an http URL; on Expo Go it can land outside the sandbox expo-file-system
 *   grants this experience; and in an Android release build it resolves to
 *   `file:///android_res/...`, which expo-asset's own source flags as "not
 *   direct accessible". The old code handled the first two and still had to
 *   guess at the third, because the failure is invisible — a document simply
 *   came out without its mark.
 *
 *   THE SNAPSHOT RACED THE DECODE. Even when it resolved, the logo was 93%
 *   of the HTML handed to `Print.printToFileAsync` (116 KB of base64 against
 *   ~9 KB of order), and the print snapshot is taken whether or not the
 *   WebView has finished decoding it. That is why the mark appeared on some
 *   order PDFs and not others, from the same code, for the same business.
 *
 * `pdfBrandAssets` is generated from the SAME `assets/swachham-logo-pdf.png`
 * by `scripts/build_pdf_brand_assets.py`, downscaled to the 82px box it is
 * actually drawn in and palette-encoded: 28 KB instead of 116 KB, small
 * enough to decode inside the layout pass. A constant cannot be refused by a
 * file system, cannot differ between Expo Go and a release build, and cannot
 * arrive after the page has been printed.
 */
export async function getLogoDataUri(): Promise<string | null> {
  return SWACHHAM_LOGO_DATA_URI;
}
