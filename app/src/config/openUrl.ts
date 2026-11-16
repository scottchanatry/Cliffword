/**
 * Opens a URL in another app (the browser, the mail app) through expo-linking. Rejects when no
 * app takes it (no mail account on the phone, the learner cancelled the prompt); callers show a
 * quiet notice then.
 */
import * as Linking from 'expo-linking';

export async function openUrl(url: string): Promise<void> {
  await Linking.openURL(url);
}
