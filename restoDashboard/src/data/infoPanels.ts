import { InfoPanel, InfoWidgetType } from '../types';

export const INFO_WIDGET_ORDER: InfoWidgetType[] = ['roomTimers', 'activeOrders', 'availableNow', 'occupancy'];

export const INFO_WIDGET_META: Record<InfoWidgetType, { title: string; description: string }> = {
  roomTimers: {
    title: 'Room Timers',
    description: 'Running rooms on this floor, expired first, then by time left.',
  },
  activeOrders: {
    title: 'Active Orders',
    description: 'Open orders on this floor, oldest first.',
  },
  availableNow: {
    title: 'Available Now',
    description: 'Free tables and rooms on this floor, for seating walk-ins.',
  },
  occupancy: {
    title: 'Occupancy',
    description: 'Occupied vs. available, plus active orders and room timers.',
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
    widgets: ['availableNow', 'occupancy'],
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

// The "Pending Orders" widget became "Active Orders" once dashboard orders
// started being confirmed on creation (nothing stays Pending for long).
// Panels saved before that still name the old widget; map it across.
export function migrateInfoPanels(panels: InfoPanel[]): InfoPanel[] {
  return panels.map((panel) => ({
    ...panel,
    widgets: Array.from(
      new Set(panel.widgets.map((w) => ((w as string) === 'pendingOrders' ? 'activeOrders' : w)))
    ) as InfoWidgetType[],
  }));
}
