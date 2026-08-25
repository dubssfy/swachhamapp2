import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert } from 'react-native';
import superAdminApi from '../../services/superAdminApi';

/**
 * Print a price list — the one flow both price screens use.
 *
 * THE SHEET IS BUILT ON THE SERVER, and this only fetches and prints it. The
 * screens are filtered down to a single sub-category before they show
 * anything, so a document assembled from what is on screen would be one
 * sub-category rather than a price list; the server builds the whole list from
 * the stored rows instead. See `backend/src/services/priceListPdf.service.ts`.
 *
 * `FileSystem.downloadAsync` performs its own request and cannot borrow the
 * axios interceptor that normally attaches the bearer token, so the header is
 * passed explicitly — the same way the profile PDF and the billing receipt are
 * fetched.
 *
 * PRINT, THEN SHARE. `Print.printAsync` opens the system print dialog with the
 * downloaded PDF, which is the action the button promises. Where printing is
 * unavailable the file is offered through the share sheet instead of failing,
 * so the sheet can still be saved or sent.
 */

export interface PrintResult {
  /** Null when the user simply dismissed the print dialog. */
  error: string | null;
}

/**
 * Downloads a price-list PDF and hands it to the printer.
 *
 * @param url        the endpoint that renders the sheet
 * @param cacheName  a stable file name, so repeated prints reuse one cache slot
 * @param title      what the share sheet calls the document
 */
export async function printPriceListPdf(
  url: string,
  cacheName: string,
  title: string
): Promise<PrintResult> {
  try {
    const headers = await superAdminApi.authHeader();
    const target = `${FileSystem.cacheDirectory}${cacheName}`;
    const result = await FileSystem.downloadAsync(url, target, { headers });

    if (result.status !== 200) {
      // The body of a failed download is the API's JSON error, not a PDF.
      // Reading it gives the real reason instead of a bare status code.
      let message = 'The server could not generate that price list.';
      try {
        const body = await FileSystem.readAsStringAsync(result.uri);
        message = JSON.parse(body)?.message || message;
      } catch {
        // A non-JSON body means there is nothing better to say than the above.
      }
      return { error: message };
    }

    try {
      await Print.printAsync({ uri: result.uri });
      return { error: null };
    } catch (printError: any) {
      // Dismissing the print dialog is a normal outcome, not a failure, and
      // must not be reported as one.
      if (/cancel|dismiss/i.test(String(printError?.message || ''))) {
        return { error: null };
      }
      // No printing available on this device — offer the file instead of
      // losing the download.
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          dialogTitle: title,
          UTI: 'com.adobe.pdf',
        });
        return { error: null };
      }
      Alert.alert('Price list ready', `Saved to ${result.uri}`);
      return { error: null };
    }
  } catch (e: any) {
    return {
      error: e?.response?.data?.message || e?.message || 'Could not open the price list',
    };
  }
}
