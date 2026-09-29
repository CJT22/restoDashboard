import { InfoWidgetType } from '../types';

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
