#!/usr/bin/env node
/**
 * Builds an installable release APK locally, without EAS.
 *
 * Two things make a local-testing build different from a store build, and both
 * are handled here rather than left as tribal knowledge:
 *
 *  1. The API URL is baked into the JS bundle at build time. `src/config/env.ts`
 *     rewrites `localhost` to the packager's LAN address only while `__DEV__`
 *     is true, which a release binary never is — so a release APK built with
 *     the default config would point at the phone itself and fail every call.
 *     We therefore detect this machine's LAN address and bake that in.
 *
 *  2. Android blocks cleartext HTTP from API 28 up, and the exemption in the
 *     debug manifest does not apply to a release binary. `EXPO_PUBLIC_ALLOW_CLEARTEXT`
 *     turns on the opt-in in app.config.ts.
 *
 * Usage:
 *   node scripts/build-apk.mjs                      # bake this machine's LAN IP
 *   node scripts/build-apk.mjs --api-url https://staging.example.com/api/v1
 *   node scripts/build-apk.mjs --variant driver     # parent | student | driver | all
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * Pick the address a phone on the same Wi-Fi can actually reach. Virtual
 * adapters (VMware, Hyper-V, WSL, Docker) also present private IPv4 addresses
 * and are the usual reason a hand-typed IP silently fails, so they are skipped
 * by name before anything else.
 */
function lanAddress() {
  const VIRTUAL = /(vmware|virtualbox|hyper-v|vethernet|wsl|docker|loopback|bluetooth|tap|tun)/i;
  const candidates = [];

  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // Home/office networks are overwhelmingly 192.168.x — prefer those over
      // the 172.16/12 space that container bridges like to claim.
      candidates.push({ address: a.address, rank: a.address.startsWith('192.168.') ? 0 : 1 });
    }
  }

  candidates.sort((x, y) => x.rank - y.rank);
  return candidates[0]?.address;
}

/**
 * Give the NDK a path with no spaces in it.
 *
 * The Android NDK cannot link C++ when its own path contains a space. CMake
 * invokes the compiler through the 8.3 short path (`clang++.exe` becomes
 * `CLANG_~1.EXE`, since `+` is not legal in a short name), and the driver then
 * fails to add libc++ to the link. The build compiles cleanly and dies at the
 * link step with hundreds of undefined `operator new`, `__cxa_*` and
 * `std::__ndk1::*` symbols in every native module — an error that looks like a
 * React Native problem and is not one.
 *
 * The default SDK location is `%LOCALAPPDATA%\Android\Sdk`, which sits under
 * the user profile — so any account whose name has a space in it (very common)
 * hits this. A directory junction gives the same SDK a clean path, needs no
 * administrator rights, and costs no disk space.
 */
function spaceFreeSdk() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) {
    console.error('ANDROID_HOME is not set. Install the Android SDK, or run scripts/setup-android.ps1.');
    process.exit(1);
  }
  if (!sdk.includes(' ')) return sdk;

  const link = 'C:/AndroidSdk';
  if (!existsSync(link)) {
    try {
      symlinkSync(sdk, link, 'junction');
      console.log(`▸ sdk       linked ${link} -> ${sdk}  (NDK cannot link C++ from a path with spaces)`);
    } catch (err) {
      console.error(
        `The Android SDK is at "${sdk}", which contains a space — the NDK cannot link C++ from ` +
          `such a path.
Creating a junction at ${link} failed: ${err.message}

` +
          `Create it yourself, then re-run:
  mklink /J ${link} "${sdk}"`,
      );
      process.exit(1);
    }
  }
  return link;
}

/**
 * CMake bakes absolute toolchain paths into `.cxx/`, so a cached configure from
 * the old spaced path would keep failing to link even after the junction is in
 * place. Wipe those caches only when the SDK path actually changed — a full
 * native rebuild is many minutes and is not worth paying on every build.
 */
function clearStaleNativeCaches(sdk) {
  const marker = path.join(appRoot, 'node_modules', '.cache', 'apk-build-sdk');
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === sdk) return;

  for (const dir of [
    path.join(appRoot, 'android', 'app', '.cxx'),
    path.join(appRoot, 'node_modules', 'react-native-screens', 'android', '.cxx'),
    path.join(appRoot, 'node_modules', 'expo', 'node_modules', 'expo-modules-core', 'android', '.cxx'),
  ]) {
    rmSync(dir, { recursive: true, force: true });
  }

  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(marker, sdk);
}

const PORT = arg('port', '4000');
let apiUrl = arg('api-url');
let wsUrl = arg('ws-url');

if (!apiUrl) {
  const ip = lanAddress();
  if (!ip) {
    console.error('Could not detect a LAN address. Pass one explicitly:\n' +
      '  node scripts/build-apk.mjs --api-url http://<your-ip>:4000/api/v1');
    process.exit(1);
  }
  apiUrl = `http://${ip}:${PORT}/api/v1`;
  wsUrl = `http://${ip}:${PORT}`;
}
wsUrl ??= apiUrl.replace(/\/api\/v1\/?$/, '');

const variant = arg('variant', 'all');
const cleartext = apiUrl.startsWith('http://');

const keystore = path.join(appRoot, 'credentials', 'edusphere-release.keystore');
if (!existsSync(keystore)) {
  console.error(
    `No release keystore at ${keystore}\n\n` +
      'Generate one (keep it safe — it is the app identity, and it is gitignored):\n' +
      '  keytool -genkeypair -v -keystore credentials/edusphere-release.keystore \\n' +
      '    -alias edusphere -keyalg RSA -keysize 2048 -validity 10000 \\n' +
      '    -storepass edusphere -keypass edusphere \\n' +
      '    -dname "CN=EduSphere School ERP, OU=Mobile, O=EduSphere, C=IN"',
  );
  process.exit(1);
}

const sdk = spaceFreeSdk();

const env = {
  ...process.env,
  CI: '1',
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  APP_VARIANT: variant,
  EXPO_PUBLIC_API_URL: apiUrl,
  EXPO_PUBLIC_WS_URL: wsUrl,
  ...(cleartext ? { EXPO_PUBLIC_ALLOW_CLEARTEXT: 'true' } : {}),
};

const isWindows = process.platform === 'win32';

/**
 * Arguments reach a Windows shell as one joined string, so anything holding a
 * space - the keystore path under `C:\Users\first last\...`, for instance -
 * has to carry its own quotes or gradle receives it truncated.
 */
const quote = (a) => (isWindows && a.includes(' ') && !a.startsWith('"') ? `"${a}"` : a);

const run = (cmd, args, cwd) =>
  execFileSync(quote(cmd), args.map(quote), { cwd, env, stdio: 'inherit', shell: isWindows });

console.log(`\n▸ variant   ${variant}`);
console.log(`▸ api       ${apiUrl}`);
console.log(`▸ ws        ${wsUrl}`);
console.log(`▸ cleartext ${cleartext ? 'allowed (http)' : 'blocked (https)'}\n`);

clearStaleNativeCaches(sdk);

/**
 * Remove android/ ourselves instead of letting `prebuild --clean` do it.
 *
 * Gradle keeps a lock under `android/.gradle`, and a build that was interrupted
 * (Ctrl-C, a closed terminal, a killed daemon) leaves it held for a while. Expo
 * deletes the directory in one pass with no retry, so it aborts the whole build
 * with `EPERM: operation not permitted, rmdir '...android/.gradle/noVersion'`.
 * Node's rmSync retries on exactly these Windows sharing violations, which is
 * usually all it takes.
 */
function removeAndroidDir() {
  const dir = path.join(appRoot, 'android');
  if (!existsSync(dir)) return;

  // rmSync retries on the Windows sharing violations that make Expo's own
  // `prebuild --clean` abort the whole build with EPERM on android/.gradle.
  //
  // Deliberately no `gradlew --stop` fallback. It is global rather than scoped
  // to this build, so it aborts any build running in another terminal - and
  // running it when no daemon is alive leaves the stop command queued in
  // ~/.gradle/daemon/<version>/registry.bin, where the next daemon to start
  // picks it up and dies with "Gradle build daemon has been stopped: stop
  // command received" seconds into an unrelated build. Recovering from that
  // means deleting the registry by hand - a far worse failure than the locked
  // directory it was meant to solve.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (err) {
    console.error(`Could not delete ${dir}: ${err.message}

Something still holds a file open in there. Close any running Gradle build or
Android Studio session (and any editor with the folder open), then re-run.`);
    process.exit(1);
  }
}

removeAndroidDir();

// The manifest carries the cleartext opt-in, so the native project has to be
// regenerated whenever that flag or the variant changes. `--clean` is not passed:
// removeAndroidDir() has already cleared the way, and doing it ourselves is what
// makes the delete survive a stale Gradle lock.
run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install'], appRoot);

const androidDir = path.join(appRoot, 'android');

run(
  isWindows ? path.join(androidDir, 'gradlew.bat') : './gradlew',
  [
    ':app:assembleRelease',
    '--no-daemon',
    `-Pandroid.injected.signing.store.file=${keystore.split(String.fromCharCode(92)).join('/')}`,
    '-Pandroid.injected.signing.store.password=edusphere',
    '-Pandroid.injected.signing.key.alias=edusphere',
    '-Pandroid.injected.signing.key.password=edusphere',
  ],
  androidDir,
);

const apk = path.join(appRoot, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
console.log(`\n✔ APK ready\n  ${apk}\n\n  Install with:  adb install -r "${apk}"\n`);
