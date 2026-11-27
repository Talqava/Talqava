// What the page expects to find around it, for the type check. Nothing here is sent to the browser.
interface Window {
  /** Set by theme-boot.js before the page draws: the look that was chosen, and a way to change it. */
  talqavaTheme?: { choice: string; set(next: string): void };
  /** For the desktop app's menus: open the guide, a legal document, or a new session. */
  talqavaShowGuide?: (id: string) => unknown;
  talqavaShowLegal?: (id: string) => unknown;
  talqavaNewSession?: () => unknown;
  /** Safari's older name for AudioContext. */
  webkitAudioContext?: typeof AudioContext;
}
