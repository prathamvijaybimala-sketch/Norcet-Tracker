import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the Android wrapper.
 *
 * The web app is entirely client-side (IndexedDB + local files), so the native
 * project needs no plugins at all: `cap sync` copies `dist/` into the WebView
 * and the app runs fully offline.
 */
const config: CapacitorConfig = {
  appId: 'app.norcet.tracker',
  appName: 'NORCET Tracker',
  webDir: 'dist',
  // Keep the whole UI inside the safe area on phones with notches.
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  server: {
    // No dev-server remote URL: the app always loads its bundled assets.
    androidScheme: 'https',
  },
};

export default config;
