import open from "open";

/** Open a URL in the user's default browser. Best-effort; failures are logged but not thrown. */
export async function openInBrowser(url: string): Promise<void> {
  try {
    await open(url);
  } catch {
    // Swallow — caller already printed the URL.
  }
}
