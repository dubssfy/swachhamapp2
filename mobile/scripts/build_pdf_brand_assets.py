"""
Bakes the Swachham logo and watermark into `src/utils/pdfBrandAssets.ts`.

WHY THE PDF CARRIES ITS BRANDING AS A COMPILED-IN CONSTANT.

The PDFs are rendered by handing HTML to `expo-print`, which snapshots a
WebView. Two things used to go wrong with loading the mark at runtime, and
this script removes both:

  1. THE SNAPSHOT RACED THE DECODE. The print snapshot is taken whether or
     not the WebView has finished decoding the image, and the logo was 93% of
     the document (116 KB of base64 against ~9 KB of actual order). That is
     why the mark appeared on some order PDFs and not others, from the same
     code, for the same business. Downscaling to the size actually drawn and
     quantising the flat brand art takes the pair to ~38 KB, small enough to
     decode within the layout pass.

  2. RESOLVING THE ASSET COULD SIMPLY FAIL. `Asset.fromModule` +
     `readAsStringAsync` has to go through expo-asset, the bundler's asset
     registry and the device file system, and every one of those differs
     between Expo Go, a dev client and a release build — on Android a
     release build resolves an embedded asset to `file:///android_res/...`,
     which expo-asset itself flags as "not direct accessible". Each failure
     returned null and produced a silently logo-less document. A constant
     cannot fail, cannot be async, and behaves identically on every platform
     and in every build type.

SOURCE ART IS THE EXISTING PROJECT ASSET IN BOTH CASES — no new brand files
were introduced. The logo is the 82px header mark; the watermark is the
mark-alone crop the backend PDFs already use.

Run after changing either source asset:

    python scripts/build_pdf_brand_assets.py

Requires Pillow (`pip install Pillow`), the same way the backend's
`scripts/xlsx_to_json.py` shells out to Python for a build-time step.
"""

import base64
import io
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.dirname(HERE)
ASSETS = os.path.join(MOBILE, 'assets')
OUT = os.path.join(MOBILE, 'src', 'utils', 'pdfBrandAssets.ts')

# (source, max px, palette size, keep alpha)
#
# The logo is drawn in an 82px box, so 246px is 3x density — past what a
# print renderer can resolve and a quarter of the bytes of the 328px source.
# The watermark is drawn ~360px wide and sits at 7% opacity, where palette
# banding is invisible, so it takes the smallest palette of the two.
LOGO = ('swachham-logo-pdf.png', 246, 32, False)
WATERMARK = ('swachham-watermark.png', 420, 32, True)


def encode(source: str, px: int, colors: int, alpha: bool) -> str:
    path = os.path.join(ASSETS, source)
    im = Image.open(path)
    im = im.convert('RGBA') if alpha else im.convert('RGB')
    im.thumbnail((px, px), Image.LANCZOS)

    # The art is flat vector-style brand colour, not photography, so a
    # palette holds it exactly while cutting the file several times over.
    # Dithering is off: it would add noise a flat fill does not need and
    # would cost more bytes than the colours it saves.
    method = Image.FASTOCTREE if alpha else Image.MEDIANCUT
    im = im.quantize(colors=colors, method=method, dither=Image.NONE)

    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    raw = buf.getvalue()
    print(f'  {source:26} {im.size[0]}x{im.size[1]:<4} '
          f'{len(raw) // 1024:>3} KB raw -> {len(raw) * 4 // 3 // 1024:>3} KB base64')
    return 'data:image/png;base64,' + base64.b64encode(raw).decode('ascii')


def main() -> None:
    print('Baking PDF brand assets:')
    logo = encode(*LOGO)
    watermark = encode(*WATERMARK)

    body = f'''/*
 * GENERATED FILE - DO NOT EDIT BY HAND.
 *
 * Produced by `scripts/build_pdf_brand_assets.py` from the existing brand
 * assets in `assets/`. Re-run that script after changing either source
 * image; the reasoning for baking them in lives in its header.
 *
 *   logo      <- assets/{LOGO[0]}      (drawn at 82px)
 *   watermark <- assets/{WATERMARK[0]} (drawn at ~360px, faint)
 */

/** The Swachham mark drawn in the PDF header. */
export const SWACHHAM_LOGO_DATA_URI =
  '{logo}';

/** The mark alone, drawn faintly behind the order body. */
export const SWACHHAM_WATERMARK_DATA_URI =
  '{watermark}';
'''

    with open(OUT, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(body)
    print(f'\nWrote {os.path.relpath(OUT, MOBILE)} ({os.path.getsize(OUT) // 1024} KB)')


if __name__ == '__main__':
    main()
