// Builds the tablet app and publishes it to its dashboard server, where the
// app's "Check for updates" button picks it up (server/appReleases.ts).
//
//   npm run release:app -- dev --notes "Faster floor plan, new Take Out zone"
//
// The flavor's server is the address built into it (mobile/config/<flavor>.json).
// Needs APP_RELEASE_TOKEN in .env (the same value as on that server), the
// release keystore (mobile/android/key.properties), and a version in
// mobile/pubspec.yaml whose build number (+N) is above the published one.
// --skip-build publishes the APK already built for that flavor.

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = path.join(root, 'mobile');

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flavor = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--notes');
const notesAt = args.indexOf('--notes');
const notes = notesAt >= 0 ? args[notesAt + 1] || '' : '';
const skipBuild = args.includes('--skip-build');

if (!['prod', 'dev', 'local'].includes(flavor)) {
  fail('Usage: npm run release:app -- <prod|dev|local> [--notes "What changed"] [--skip-build]');
}

const config = JSON.parse(readFileSync(path.join(mobile, 'config', `${flavor}.json`), 'utf8'));
const server = (config.DASHBOARD_URL || '').replace(/\/+$/, '');
if (!server) fail(`config/${flavor}.json has no DASHBOARD_URL, so this build has no server to publish to.`);

const token = process.env.APP_RELEASE_TOKEN;
if (!token) fail('APP_RELEASE_TOKEN is missing from .env (it must match the one on the server).');

if (!existsSync(path.join(mobile, 'android', 'key.properties'))) {
  fail('mobile/android/key.properties is missing. Releases must be signed with the release keystore, or tablets refuse the update (see mobile/README.md).');
}

const version = /^version:\s*([0-9A-Za-z.\-]+)\+(\d+)\s*$/m.exec(readFileSync(path.join(mobile, 'pubspec.yaml'), 'utf8'));
if (!version) fail('Could not read "version: x.y.z+N" from mobile/pubspec.yaml.');
const [, versionName, codeText] = version;
const versionCode = Number(codeText);

console.log(`Blue Moon ${flavor} ${versionName}+${versionCode} → ${server}`);

// Checked before the (slow) build, so a forgotten version bump fails fast.
let published;
try {
  const res = await fetch(`${server}/api/app/version/${flavor}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  published = (await res.json()).data;
} catch (err) {
  fail(`Couldn't reach ${server} (${err.message}). Is the server up, and running a version with /api/app?`);
}
if (published && versionCode <= published.versionCode) {
  fail(`The server already has ${published.versionName}+${published.versionCode}. Raise the build number (+N) in mobile/pubspec.yaml.`);
}
console.log(published ? `Published now: ${published.versionName}+${published.versionCode}` : 'Nothing published yet.');

if (!skipBuild) {
  const build = spawnSync(
    'flutter',
    ['build', 'apk', '--release', '--flavor', flavor, `--dart-define-from-file=config/${flavor}.json`],
    { cwd: mobile, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (build.status !== 0) fail('flutter build failed.');
}

const apkPath = path.join(mobile, 'build', 'app', 'outputs', 'flutter-apk', `app-${flavor}-release.apk`);
if (!existsSync(apkPath)) fail(`No APK at ${apkPath}.`);
const apk = readFileSync(apkPath);

console.log(`Uploading ${(apk.length / 1048576).toFixed(1)} MB…`);
const res = await fetch(`${server}/api/app/releases/${flavor}`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/vnd.android.package-archive',
    'X-Version-Code': String(versionCode),
    'X-Version-Name': versionName,
    'X-Release-Notes': encodeURIComponent(notes),
  },
  body: apk,
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.success) fail(`Upload refused: ${body.error || `HTTP ${res.status}`}`);

console.log(`\n✔ Published ${flavor} ${versionName}+${versionCode}.`);
console.log('  Tablets get it from "Check for updates" on the sign-in page, or when the app next starts.');
console.log(`  New tablets can download it in a browser: ${server}/api/app/download/${flavor}`);
