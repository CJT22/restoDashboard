import { InfoPanel, InfoWidgetType } from '../types';

export const INFO_WIDGET_ORDER: InfoWidgetType[] = ['roomTimers', 'activeOrders', 'totalSales', 'occupancy'];

export const INFO_WIDGET_META: Record<InfoWidgetType, { title: string; description: string }> = {
  roomTimers: {
    title: 'Room Timers',
    description: 'Running rooms (1F, 2F or both), expired first, then A–Z.',
  },
  activeOrders: {
    title: 'Active Orders',
    description: 'Open orders (1F, 2F or both), A–Z by zone.',
  },
  totalSales: {
    title: 'Total Sales',
    description: 'Paid sales for both floors (today, yesterday, this week or month), plus open tabs.',
  },
  occupancy: {
    title: 'Occupancy',
    description: 'Occupied vs. available (1F, 2F or both), plus active orders and room timers.',
  },
};

// Default panels, fitted to the unused areas of first_floor.webp /
// second_floor.webp (the kitchen/billiards block and the lounge on the 1st
// floor, the empty hall on the 2nd). Staff can move, resize, re-widget or
// delete them in Edit Zones.
export const INITIAL_INFO_PANELS: InfoPanel[] = [
  {
    id: 'panel-f1-west',
    floor: 1,
    widgets: ['roomTimers', 'activeOrders'],
    layout: 'auto',
    x: 5.1,
    y: 43,
    width: 22.4,
    height: 38.6,
  },
  {
    id: 'panel-f1-east',
    floor: 1,
    widgets: ['totalSales', 'occupancy'],
    layout: 'auto',
    x: 62,
    y: 33.3,
    width: 14.2,
    height: 47.9,
  },
  {
    id: 'panel-f2-hall',
    floor: 2,
    widgets: ['roomTimers', 'activeOrders'],
    layout: 'auto',
    x: 58.1,
    y: 35.1,
    width: 24,
    height: 21,
  },
];

// Widgets that were renamed or replaced, mapped to what panels saved with
// them should show now:
//   pendingOrders → activeOrders: dashboard orders are confirmed on
//     creation, so nothing stays Pending for long.
//   availableNow → totalSales: Available Now was dropped, and Total Sales
//     takes its slot.
const RENAMED_WIDGETS: Record<string, InfoWidgetType> = {
  pendingOrders: 'activeOrders',
  availableNow: 'totalSales',
};

export function migrateInfoPanels(panels: InfoPanel[]): InfoPanel[] {
  return panels.map((panel) => ({
    ...panel,
    widgets: Array.from(
      new Set(panel.widgets.map((w) => RENAMED_WIDGETS[w as string] ?? w))
    ) as InfoWidgetType[],
  }));
}
