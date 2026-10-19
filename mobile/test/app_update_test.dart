import 'package:flutter_test/flutter_test.dart';
import 'package:resto_dashboard/api/app_update.dart';

void main() {
  UpdateCheck check(int installed, Map<String, dynamic>? latest) => UpdateCheck(
      installedName: '0.2.0', installedCode: installed, latest: latest == null ? null : AppRelease.fromJson(latest));

  test('offers only a strictly newer version code', () {
    final newer = {'versionCode': 3, 'versionName': '0.3.0', 'releaseNotes': 'Faster', 'size': 1234};
    expect(check(2, newer).update?.versionName, '0.3.0');
    expect(check(3, newer).update, isNull);
    expect(check(4, newer).update, isNull);
  });

  test('nothing published means no update', () {
    expect(check(2, null).update, isNull);
  });

  test('reads a release without notes or size', () {
    final release = AppRelease.fromJson({'versionCode': 5, 'versionName': '1.0.0'});
    expect(release.releaseNotes, '');
    expect(release.size, 0);
  });
}
