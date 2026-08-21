import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import AppNavigator from './src/navigation/AppNavigator';

/**
 * Splash experience.
 *
 * The branding is drawn in JS by src/screens/auth/SplashScreen, the first
 * route in AppNavigator. That is deliberate: a native splash image is baked
 * into a native binary at prebuild, so Expo Go — which ships as Expo's own
 * prebuilt app — can never display it. A JS splash renders identically in
 * Expo Go and in a real build.
 *
 * Auto-hide is still blocked here at module scope, so the call lands before
 * the first frame and there is no white flash. The native splash is then
 * dropped as soon as this component mounts, which is what uncovers the
 * branded screen; the welcome audio plays over it rather than holding a blank
 * splash up until the clip ends.
 */
SplashScreen.preventAutoHideAsync().catch(() => {
  // Auto-hide may already have happened; there is nothing to recover from.
});

/** The welcome clip that ships in the app's own assets — never a remote URL. */
const WELCOME_AUDIO = require('./assets/splash_welcome.mp3.mp4');

/**
 * Safety net only. The clip runs ~5s; this cap exists so a player that never
 * reports finishing can still never strand the user on the splash.
 */
const MAX_SPLASH_MS = 12000;

/**
 * Module scope, so it outlives every remount: the welcome audio belongs to
 * the app launch. It plays once per launch and is never restarted by
 * re-rendering, navigating, logging out or returning to a screen.
 */
let welcomeStarted = false;

export default function App() {
  useEffect(() => {
    if (welcomeStarted) {
      // A remount is not a new launch — no audio, just make sure the splash
      // is not left hanging.
      SplashScreen.hideAsync().catch(() => {});
      return;
    }
    welcomeStarted = true;

    // Uncover the branded JS splash straight away. Holding the native splash
    // until the audio finished would keep a generic screen up for the whole
    // clip, and SplashScreen would have handed over before it was ever seen.
    SplashScreen.hideAsync().catch(() => {});

    let player: AudioPlayer | null = null;
    let subscription: { remove: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    /**
     * Ends the splash exactly once: stops listening, unloads the player so no
     * decoder is left running, and drops the splash. Safe to call from the
     * finish event, the timeout, an error, or unmount.
     */
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      timer = null;
      subscription?.remove();
      subscription = null;
      try {
        player?.remove();
      } catch (error) {
        if (__DEV__) console.warn('[Splash] could not release audio player', error);
      }
      player = null;
      SplashScreen.hideAsync().catch(() => {});
    };

    (async () => {
      try {
        // iOS silences non-media audio when the ringer switch is off; this is
        // what makes the welcome clip audible at launch.
        await setAudioModeAsync({ playsInSilentMode: true });

        player = createAudioPlayer(WELCOME_AUDIO);
        // Explicit, even though it is the default: the clip must never loop.
        player.loop = false;

        subscription = player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish) finish();
        });

        player.play();
        timer = setTimeout(finish, MAX_SPLASH_MS);
      } catch (error) {
        // Audio is decoration: if it cannot load or play, the app carries on
        // to its normal first screen straight away.
        if (__DEV__) console.warn('[Splash] welcome audio failed', error);
        finish();
      }
    })();

    return finish;
  }, []);

  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}
