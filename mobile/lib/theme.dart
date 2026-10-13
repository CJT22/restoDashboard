import 'package:flutter/material.dart';

import 'api/models.dart';

/// The web dashboard's palette (Tailwind colours it uses), so both look alike.
class AppColors {
  static const bg = Color(0xFF0B0C16);
  static const sidebar = Color(0xFF11121D);
  static const panel = Color(0xFF141628);
  static const card = Color(0xFF15172B);
  static const cardAlt = Color(0xFF16182C);
  static const input = Color(0xFF1A1C2E);
  static const footer = Color(0xFF0F1120);
  static const rail = Color(0xFF10122A);
  static const orderBg = Color(0xFF0B0D1C);

  static const gradientA = Color(0xFF0C0D1C);
  static const gradientB = Color(0xFF14122D);
  static const gradientC = Color(0xFF1E1542);

  static const border = Color(0x1AFFFFFF); // white/10
  static const borderStrong = Color(0x26FFFFFF); // white/15
  static const faint = Color(0x08FFFFFF); // white/[0.03]
  static const subtle = Color(0x0DFFFFFF); // white/5

  static const slate200 = Color(0xFFE2E8F0);
  static const slate300 = Color(0xFFCBD5E1);
  static const slate400 = Color(0xFF94A3B8);
  static const slate500 = Color(0xFF64748B);
  static const slate600 = Color(0xFF475569);

  static const indigo300 = Color(0xFFA5B4FC);
  static const indigo400 = Color(0xFF818CF8);
  static const indigo500 = Color(0xFF6366F1);
  static const indigo600 = Color(0xFF4F46E5);

  static const emerald300 = Color(0xFF6EE7B7);
  static const emerald400 = Color(0xFF34D399);
  static const emerald500 = Color(0xFF10B981);
  static const emerald600 = Color(0xFF059669);
  static const teal600 = Color(0xFF0D9488);

  static const amber200 = Color(0xFFFDE68A);
  static const amber300 = Color(0xFFFCD34D);
  static const amber400 = Color(0xFFFBBF24);
  static const amber500 = Color(0xFFF59E0B);
  static const amber600 = Color(0xFFD97706);
  static const orange500 = Color(0xFFF97316);

  static const sky300 = Color(0xFF7DD3FC);
  static const sky400 = Color(0xFF38BDF8);
  static const sky500 = Color(0xFF0EA5E9);

  static const rose200 = Color(0xFFFECDD3);
  static const rose300 = Color(0xFFFDA4AF);
  static const rose400 = Color(0xFFFB7185);
  static const rose500 = Color(0xFFF43F5E);
  static const rose600 = Color(0xFFE11D48);

  static const yellow300 = Color(0xFFFDE047);
  static const yellow400 = Color(0xFFFACC15);

  /// The Blue Moon logo's gold, for small brand accents (sign-in page).
  static const gold = Color(0xFFF1C83E);
}

const workspaceGradient = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [AppColors.gradientA, AppColors.gradientB, AppColors.gradientC],
);

/// Per-status colours (src/utils/statusColors.ts). Reserved and Not
/// Available are set only from restoAdmin's Table Settings.
class StatusColors {
  final String label;
  final Color base; // the -500 shade, for fills/borders
  final Color dot; // the -400 shade
  final Color text; // the -300 shade
  const StatusColors(this.label, this.base, this.dot, this.text);

  Color get fill => base.withValues(alpha: 0.24);
  Color get glow => base.withValues(alpha: 0.4);
  Color get border => dot.withValues(alpha: 0.7);
  Color get badgeBg => base.withValues(alpha: 0.2);
}

const statusColors = {
  TableStatus.available: StatusColors('Available', AppColors.emerald500, AppColors.emerald400, AppColors.emerald300),
  TableStatus.occupied: StatusColors('Occupied', AppColors.amber500, AppColors.amber400, AppColors.amber300),
  TableStatus.reserved: StatusColors('Reserved', AppColors.sky500, AppColors.sky400, AppColors.sky300),
  TableStatus.unavailable: StatusColors('Not Available', AppColors.rose500, AppColors.rose400, AppColors.rose300),
};

/// restoAdmin's order status, as staff read it.
String orderStatusLabel(int status) => switch (status) {
      3 => 'Pending',
      2 => 'Confirmed',
      1 => 'Settled',
      -1 => 'Cancelled',
      _ => 'Unknown',
    };

ThemeData buildTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: AppColors.bg,
    colorScheme: base.colorScheme.copyWith(
      primary: AppColors.indigo500,
      secondary: AppColors.indigo400,
      surface: AppColors.panel,
      error: AppColors.rose400,
    ),
    textTheme: base.textTheme.apply(bodyColor: AppColors.slate200, displayColor: Colors.white),
    dividerColor: AppColors.border,
    splashFactory: InkSparkle.splashFactory,
    textSelectionTheme: const TextSelectionThemeData(cursorColor: AppColors.indigo400),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.subtle,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: const TextStyle(color: AppColors.slate500, fontSize: 13),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.border)),
      enabledBorder:
          OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.border)),
      focusedBorder:
          OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.indigo500)),
    ),
  );
}

const tabular = [FontFeature.tabularFigures()];
