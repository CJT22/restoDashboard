import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'api_client.dart';

/// The floor plan images, also kept on disk so the floor plan still draws
/// when the app starts with no connection (Image.network only caches them
/// in memory). The plan shows the server's copy when it can and falls back
/// to this one.
class FloorImages {
  static Directory? _dir;

  /// Finds the app's storage folder; before this (and in tests) there's no
  /// copy on disk.
  static Future<void> init() async {
    try {
      _dir = await getApplicationSupportDirectory();
    } catch (_) {}
  }

  static File? _file(int floor) => _dir == null ? null : File('${_dir!.path}/floorplan_$floor.webp');

  /// The copy on disk, if there is one.
  static File? cached(int floor) {
    final file = _file(floor);
    return file != null && file.existsSync() ? file : null;
  }

  /// Saves both images from the server, so the copies follow a new floor
  /// plan. Quiet when the server can't be reached.
  static Future<void> refresh(ApiClient api) async {
    if (api.baseUrl.isEmpty) return;
    for (final floor in [1, 2]) {
      final file = _file(floor);
      if (file == null) return;
      try {
        final res = await http.get(Uri.parse(api.floorPlanImageUrl(floor))).timeout(const Duration(seconds: 30));
        if (res.statusCode != 200 || res.bodyBytes.isEmpty) continue;
        // Written aside first, so a cut-off download never replaces a good copy.
        final part = File('${file.path}.part');
        await part.writeAsBytes(res.bodyBytes, flush: true);
        await part.rename(file.path);
      } catch (_) {}
    }
  }
}
