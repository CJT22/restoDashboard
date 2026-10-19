// In-app updates for the tablet app (mobile/): this server publishes the
// latest APK of each build flavor, and the app's "Check for updates" button
// (mobile/lib/api/app_update.dart) downloads and installs it, so a tablet
// never has to be plugged into a computer for a new version.
//
// Each flavor is its own channel (an app only updates from its own package):
// releases/<flavor>/latest.json plus that release's APK. A release arrives
// from `npm run release:app -- <flavor>` (scripts/release-app.mjs), which
// builds the APK and PUTs it here with the APP_RELEASE_TOKEN from .env.
// Checking and downloading are open (the sign-in page checks before anyone
// is signed in); only publishing needs the token.

import { Router, type Request } from 'express';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const FLAVORS = new Set(['prod', 'dev', 'local']);
const RELEASES_DIR =
  process.env.APP_RELEASES_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'releases');

interface AppRelease {
  versionCode: number;
  versionName: string;
  releaseNotes: string;
  apkFile: string;
  size: number;
  publishedAt: string;
}

const flavorDir = (flavor: string) => path.join(RELEASES_DIR, flavor);

async function latestRelease(flavor: string): Promise<AppRelease | null> {
  try {
    return JSON.parse(await readFile(path.join(flavorDir(flavor), 'latest.json'), 'utf8'));
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function hasReleaseToken(req: Request): boolean {
  const expected = process.env.APP_RELEASE_TOKEN;
  const given = /^Bearer (.+)$/.exec(req.get('authorization') || '')?.[1];
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const appReleasesRouter = Router();

appReleasesRouter.param('flavor', (req, res, next, flavor) => {
  if (FLAVORS.has(flavor)) return next();
  res.status(404).json({ success: false, error: `No such app build: ${flavor}` });
});

// GET /api/app/version/:flavor - the latest published release, or null.
appReleasesRouter.get('/version/:flavor', async (req, res) => {
  try {
    const release = await latestRelease(req.params.flavor);
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: release && {
        versionCode: release.versionCode,
        versionName: release.versionName,
        releaseNotes: release.releaseNotes,
        size: release.size,
        publishedAt: release.publishedAt,
      },
    });
  } catch (err: any) {
    console.error('[GET /api/app/version]', err.message || err);
    res.status(500).json({ success: false, error: 'Failed to read the latest app release' });
  }
});

// GET /api/app/download/:flavor - the latest release's APK. Opening this in a
// tablet's browser is also how a brand-new tablet gets the app.
appReleasesRouter.get('/download/:flavor', async (req, res) => {
  try {
    const release = await latestRelease(req.params.flavor);
    if (!release) {
      res.status(404).json({ success: false, error: 'No release has been published for this build yet' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.type('application/vnd.android.package-archive');
    res.download(path.join(flavorDir(req.params.flavor), release.apkFile), release.apkFile);
  } catch (err: any) {
    console.error('[GET /api/app/download]', err.message || err);
    res.status(500).json({ success: false, error: 'Failed to read the latest app release' });
  }
});

// PUT /api/app/releases/:flavor - publishes a new release. The body is the
// APK itself; its version comes in X-Version-Code / X-Version-Name and its
// notes in X-Release-Notes (URI-encoded, so any text fits in a header).
appReleasesRouter.put('/releases/:flavor', async (req, res) => {
  if (!process.env.APP_RELEASE_TOKEN) {
    res.status(403).json({ success: false, error: 'Publishing is off on this server (no APP_RELEASE_TOKEN in its .env)' });
    return;
  }
  if (!hasReleaseToken(req)) {
    res.status(401).json({ success: false, error: 'Wrong or missing release token' });
    return;
  }

  const flavor = req.params.flavor;
  const versionCode = Number(req.get('x-version-code'));
  const versionName = req.get('x-version-name') || '';
  let releaseNotes = '';
  try {
    releaseNotes = decodeURIComponent(req.get('x-release-notes') || '');
  } catch {
    // Left empty: notes are optional.
  }
  if (!Number.isInteger(versionCode) || versionCode < 1 || !versionName) {
    res.status(400).json({ success: false, error: 'X-Version-Code and X-Version-Name are required' });
    return;
  }

  const dir = flavorDir(flavor);
  const apkFile = `blue-moon-${flavor}-${versionName}+${versionCode}.apk`;
  const upload = path.join(dir, `.upload-${Date.now()}.apk`);
  try {
    // An installed app only accepts a higher versionCode, so an older or
    // repeated one would be offered to tablets that can never install it.
    const current = await latestRelease(flavor);
    if (current && versionCode <= current.versionCode) {
      res.status(409).json({
        success: false,
        error: `Version code ${versionCode} isn't newer than the published ${current.versionName}+${current.versionCode}`,
      });
      return;
    }

    await mkdir(dir, { recursive: true });
    await pipeline(req, createWriteStream(upload));
    const { size } = await stat(upload);
    // An APK is a zip: anything else (an error page, a cut-off upload) is refused.
    const head = Buffer.alloc(4);
    const file = await open(upload);
    await file.read(head, 0, 4, 0);
    await file.close();
    if (size < 1024 || head.readUInt32LE(0) !== 0x04034b50) {
      await rm(upload, { force: true });
      res.status(400).json({ success: false, error: "The upload isn't an APK" });
      return;
    }

    await rename(upload, path.join(dir, apkFile));
    const release: AppRelease = { versionCode, versionName, releaseNotes, apkFile, size, publishedAt: new Date().toISOString() };
    await writeFile(path.join(dir, 'latest.json.tmp'), JSON.stringify(release, null, 2));
    await rename(path.join(dir, 'latest.json.tmp'), path.join(dir, 'latest.json'));

    // Keep this release and the one before it (a tablet may be mid-download
    // of that one); older APKs only take up space.
    const keep = new Set([apkFile, current?.apkFile]);
    for (const name of await readdir(dir)) {
      if (name.endsWith('.apk') && !name.startsWith('.') && !keep.has(name)) await rm(path.join(dir, name), { force: true });
    }

    console.log(`[app release] ${flavor} ${versionName}+${versionCode} published (${size} bytes)`);
    res.json({ success: true, data: { versionCode, versionName, releaseNotes, size, publishedAt: release.publishedAt } });
  } catch (err: any) {
    await rm(upload, { force: true }).catch(() => {});
    console.error('[PUT /api/app/releases]', err.message || err);
    res.status(500).json({ success: false, error: 'Failed to save the release' });
  }
});
