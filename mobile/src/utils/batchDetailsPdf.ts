import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { BatchRecord } from '../services/sorterBatchApi';
import { getLogoDataUri } from './businessOrderPdf';
import { buildBatchDetailsPdfHtml, buildBatchDetailsPdfFileName } from './batchDetailsPdfHtml';

export * from './batchDetailsPdfHtml';

/**
 * BATCH DETAILS PDF.
 *
 * Same generator shape as `generateOrderPdf`: expo-print renders the HTML in
 * `batchDetailsPdfHtml.ts` to a real PDF, then the file is renamed to a
 * readable name in the cache directory. Read-only — it renders the batch the
 * app already loaded and writes nothing back.
 */
export async function generateBatchDetailsPdf(
  batch: BatchRecord
): Promise<{ uri: string; fileName: string }> {
  const logo = await getLogoDataUri();
  const { uri } = await Print.printToFileAsync({
    html: buildBatchDetailsPdfHtml(batch, logo),
  });

  const fileName = buildBatchDetailsPdfFileName(batch);
  const targetUri = `${FileSystem.cacheDirectory}${encodeURIComponent(fileName)}`;
  try {
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
    await FileSystem.moveAsync({ from: uri, to: targetUri });
    return { uri: targetUri, fileName };
  } catch {
    try {
      await FileSystem.copyAsync({ from: uri, to: targetUri });
      return { uri: targetUri, fileName };
    } catch {
      if (__DEV__) console.warn('[BatchDetailsPdf] could not rename to', fileName);
      return { uri, fileName };
    }
  }
}
