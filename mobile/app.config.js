/**
 * Dynamic Expo config.
 *
 * `app.json` remains the single source of truth for the app — this file
 * receives it as `config` and returns it UNCHANGED for every build except the
 * demo one. A production build therefore has exactly the config it has always
 * had; adding this file changed nothing about it.
 *
 * FOR THE DEMO BUILD it overrides three things, and only these three:
 *
 *   name             the app's name in Expo's own config and in EAS.
 *   android.package  so the demo is a DIFFERENT APP to Android: it installs
 *                    alongside the production app rather than replacing it,
 *                    keeps its own storage, and can be uninstalled without
 *                    touching the other.
 *   ios.bundle       the same, for completeness. The deliverable is an APK;
 *                    this is here so an iOS demo build cannot collide either.
 *
 * ONE THING TO KNOW ABOUT THIS PROJECT. `mobile/android/` is checked in, so
 * EAS builds the native project directly and never runs prebuild — which
 * means the Android application id actually comes from `android/app/
 * build.gradle`, not from the `package` below. That file carries the matching
 * `.demo` suffix, gated on the same environment variable, and the two are
 * kept in step deliberately: the value here is what applies if the native
 * directory is ever regenerated.
 *
 * The Android launcher LABEL still comes from `android/app/src/main/res/
 * values/strings.xml` for the same reason, so both apps show as "Swachham" on
 * the home screen. The demo is unmistakable once opened — it carries the
 * BUSINESS DEMO badge on every screen and signs in on its own screen — but if
 * you want the icons to differ too, that string is the one to change.
 *
 * `slug`, `owner` and `extra.eas.projectId` are deliberately NOT changed: the
 * demo is a build of this project, and those three are what tie a build to
 * it.
 *
 * The switch is the same `EXPO_PUBLIC_DEMO_MODE` the app code reads, set by
 * the `demo` profile in eas.json. Nothing sets it locally, so `expo start`
 * and every other profile resolve to the production config.
 */

const IS_DEMO = process.env.EXPO_PUBLIC_DEMO_MODE === '1';

module.exports = ({ config }) => {
  if (!IS_DEMO) return config;

  return {
    ...config,
    name: 'Swachham Business Demo',
    android: {
      ...config.android,
      package: 'com.anonymous.swachham.demo',
    },
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.anonymous.swachham.demo',
    },
  };
};
