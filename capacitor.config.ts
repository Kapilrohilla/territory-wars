import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Permanent once published on Google Play.
  appId: 'com.kapilrohilla.territorywars',
  appName: 'Territory Wars',
  webDir: 'dist',
  android: {
    backgroundColor: '#e4e2dc',
  },
};

export default config;
