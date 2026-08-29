import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';

/**
 * Open a generated PDF in the device's OWN PDF viewer.
 *
 * ONE helper behind every "Open PDF" in the app, so the Super Admin row
 * action, the More Options menu and the Invoice History all hand the document
 * to the phone the same way.
 *
 * ANDROID: a real ACTION_VIEW intent, which is what lets the OS decide.
 *
 *   The file lives in the app's cache directory, which no other app can read,
 *   so a `file://` URI would raise FileUriExposedException and a bare
 *   `content://` VIEW intent — the thing that was tried before this helper
 *   existed — launches a viewer with NO READ ACCESS and renders a blank page.
 *
 *   `getContentUriAsync` wraps the file in the FileProvider that
 *   expo-file-system already declares, and FLAG_GRANT_READ_URI_PERMISSION (1)
 *   is what actually grants the viewer permission to read through it. That
 *   pair is the whole fix.
 *
 *   The intent is NOT restricted to a package, so when several PDF apps are
 *   installed Android shows its own chooser — which is the requirement: the
 *   OS decides, not this app.
 *
 * iOS: there is no equivalent "open in the default app" intent — iOS has no
 *   registered default PDF handler to open into. The share sheet IS the
 *   platform's document handoff: it lists every app that can open a PDF, plus
 *   Quick Look and Save to Files. So iOS goes to the sheet by design, not as a
 *   failure.
 *
 * FALLBACK: if no Android app can handle the intent — an unusual device with
 *   no PDF viewer at all — the share sheet is offered rather than the action
 *   failing and the document being lost.
 *
 * Returns how the document was actually opened, so a caller can tell the user
 * something accurate rather than guessing.
 */
export type PdfOpenOutcome = 'viewer' | 'shared' | 'unavailable';

export async function openPdfInDeviceViewer(
  uri: string,
  fileName: string
): Promise<PdfOpenOutcome> {
  if (Platform.OS === 'android') {
    try {
      // A content:// URI the viewer can actually read through.
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        // 1 = FLAG_GRANT_READ_URI_PERMISSION. Without it the viewer opens
        // with no access to the file and shows a blank page.
        flags: 1,
        type: 'application/pdf',
      });
      return 'viewer';
    } catch {
      // No installed app claims application/pdf, or the user dismissed the
      // chooser. Offer the sheet rather than lose the document.
      return shareAsFallback(uri, fileName);
    }
  }

  // iOS and everything else: the share sheet is the platform handoff.
  return shareAsFallback(uri, fileName);
}

async function shareAsFallback(uri: string, fileName: string): Promise<PdfOpenOutcome> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: fileName,
    UTI: 'com.adobe.pdf',
  });
  return 'shared';
}
