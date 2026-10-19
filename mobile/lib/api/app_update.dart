import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:open_filex/open_filex.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import 'api_client.dart';

/// A release of this build flavor, as published on the dashboard server
/// (server/appReleases.ts, by `npm run release:app`).
class AppRelease {
  final int versionCode;
  final String versionName;
  final String releaseNotes;
  final int size;
  const AppRelease({required this.versionCode, required this.versionName, this.releaseNotes = '', this.size = 0});

  factory AppRelease.fromJson(Map<String, dynamic> json) => AppRelease(
        versionCode: (json['versionCode'] as num).toInt(),
        versionName: json['versionName'] as String? ?? '',
        releaseNotes: json['releaseNotes'] as String? ?? '',
        size: (json['size'] as num?)?.toInt() ?? 0,
      );
}

/// What a check found: the installed version, and the published release if
/// it's newer (an app only installs over a lower version code).
class UpdateCheck {
  final String installedName;
  final int installedCode;
  final AppRelease? latest;
  const UpdateCheck({required this.installedName, required this.installedCode, required this.latest});

  AppRelease? get update => latest != null && latest!.versionCode > installedCode ? latest : null;
}

/// In-app updates: there's no app store, so the dashboard server publishes
/// each flavor's latest APK, and this downloads it and hands it to Android's
/// installer. Android still asks "Install this update?" (and, the first time,
/// to allow installs from Blue Moon); skipping that would need the tablets
/// enrolled in device management.
class AppUpdates {
  final ApiClient api;
  const AppUpdates(this.api);

  /// Throws when the server can't be reached; [checkQuietly] doesn't.
  Future<UpdateCheck> check() async {
    if (api.baseUrl.isEmpty) throw ApiException('This build has no dashboard address yet.');
    final info = await PackageInfo.fromPlatform();
    final http.Response res;
    try {
      res = await http.get(api.uri('/api/app/version/${ApiClient.appEnv}')).timeout(const Duration(seconds: 8));
    } on TimeoutException {
      throw ApiException("The dashboard server didn't answer. Check the Wi-Fi and try again.");
    } on Exception {
      throw ApiException("Couldn't reach the dashboard server. Check the Wi-Fi and try again.");
    }
    // A server running an older dashboard has no /api/app routes yet.
    if (res.statusCode == 404) throw ApiException("The dashboard server doesn't offer app updates yet.");
    if (res.statusCode != 200) throw ApiException("The server couldn't check for updates (HTTP ${res.statusCode}).");
    final data = (jsonDecode(res.body) as Map<String, dynamic>)['data'];
    return UpdateCheck(
      installedName: info.version,
      installedCode: int.tryParse(info.buildNumber) ?? 0,
      latest: data is Map<String, dynamic> ? AppRelease.fromJson(data) : null,
    );
  }

  /// The startup check: a check that found a newer release, or null for no
  /// update or any failure (offline, server down), so starting the app never
  /// shows an error.
  Future<UpdateCheck?> checkQuietly() async {
    try {
      final result = await check();
      return result.update == null ? null : result;
    } catch (e) {
      debugPrint('[AppUpdates] startup check failed: $e');
      return null;
    }
  }

  /// Downloads the release's APK, reporting 0–1 progress, and opens
  /// Android's installer on it. The app is replaced (and closed) once staff
  /// confirm there.
  Future<void> downloadAndInstall(AppRelease release, {ValueChanged<double>? onProgress}) async {
    final client = http.Client();
    try {
      final res = await client.send(http.Request('GET', api.uri('/api/app/download/${ApiClient.appEnv}')));
      if (res.statusCode != 200) throw ApiException('The download failed (HTTP ${res.statusCode}).');
      // One fixed name, so a retried download overwrites the last one.
      final file = File('${(await getTemporaryDirectory()).path}/blue-moon-update.apk');
      final total = res.contentLength ?? release.size;
      var received = 0;
      await res.stream
          .timeout(const Duration(seconds: 30))
          .map((chunk) {
            received += chunk.length;
            if (total > 0) onProgress?.call((received / total).clamp(0, 1));
            return chunk;
          })
          .pipe(file.openWrite());
      if (release.size > 0 && received != release.size) {
        throw ApiException('The download was cut off. Try again.');
      }
      final result = await OpenFilex.open(file.path, type: 'application/vnd.android.package-archive');
      if (result.type != ResultType.done) throw ApiException("Couldn't open the installer: ${result.message}");
    } on TimeoutException {
      throw ApiException('The download stalled. Check the Wi-Fi and try again.');
    } on ApiException {
      rethrow;
    } on IOException {
      throw ApiException("Couldn't download the update. Check the Wi-Fi and try again.");
    } on http.ClientException {
      throw ApiException("Couldn't download the update. Check the Wi-Fi and try again.");
    } finally {
      client.close();
    }
  }
}
