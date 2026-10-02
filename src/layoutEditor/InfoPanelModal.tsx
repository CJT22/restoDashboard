import React, { useEffect, useState } from 'react';
import { X, Check, Trash2, LayoutDashboard, ArrowUp, ArrowDown, Plus, Minus } from 'lucide-react';
import { InfoPanel, InfoPanelLayout, InfoWidgetType } from '../types';
import { INFO_WIDGET_META, INFO_WIDGET_ORDER } from '../data/infoPanels';
import { isCompactPanel, maxPanelColumns } from '../components/InfoPanelView';

interface InfoPanelModalProps {
  panel: InfoPanel | null;
  // The panel's on-screen size when opened — decides whether "Side by side"
  // fits right now.
  panelSize: { widthPx: number; heightPx: number } | null;
  onClose: () => void;
  onSave: (id: string, changes: { widgets: InfoWidgetType[]; layout: InfoPanelLayout }) => void;
  onDelete: (id: string) => void;
}

const LAYOUT_OPTIONS: { value: InfoPanelLayout; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto', description: 'As many columns as fit' },
  { value: 'stack', label: 'Stacked', description: 'One column, top to bottom' },
  { value: 'row', label: 'Side by side', description: 'One column per widget' },
];

// Edit Zones → click a panel: pick its layout and which widgets it shows, in
// what order (↑/↓ rather than drag-and-drop, which is unreliable by touch).
export const InfoPanelModal: React.FC<InfoPanelModalProps> = ({ panel, panelSize, onClose, onSave, onDelete }) => {
  const [widgets, setWidgets] = useState<InfoWidgetType[]>([]);
  const [layout, setLayout] = useState<InfoPanelLayout>('auto');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  useEffect(() => {
    setWidgets(panel?.widgets ?? []);
    setLayout(panel?.layout ?? 'auto');
    setIsConfirmingDelete(false);
  }, [panel]);

  if (!panel) return null;

  const maxColumns = panelSize
    ? maxPanelColumns(panelSize.widthPx, isCompactPanel(panelSize.widthPx, panelSize.heightPx))
    : widgets.length;
  const rowFits = widgets.length <= maxColumns;
  const autoColumns = Math.max(1, Math.min(widgets.length, maxColumns));
  const available = INFO_WIDGET_ORDER.filter((w) => !widgets.includes(w));

  const move = (index: number, delta: -1 | 1) =>
    setWidgets((prev) => {
      const next = [...prev];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });

  const iconButton =
    'w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-300';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md max-h-full bg-[#141628] border border-white/15 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-slate-100">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <LayoutDashboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Info Panel</h3>
              <p className="text-xs text-slate-400">Floor {panel.floor} · shows this floor only</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Layout</label>
            <div className="grid grid-cols-3 gap-2">
              {LAYOUT_OPTIONS.map((option) => {
                const disabled = option.value === 'row' && !rowFits;
                const selected = layout === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => setLayout(option.value)}
                    aria-pressed={selected}
                    className={`p-2.5 rounded-2xl border text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      selected ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="block text-sm font-semibold text-white">{option.label}</span>
                    <span className="block text-[11px] text-slate-400 leading-snug">{option.description}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-slate-500 leading-snug">
              {layout === 'auto' &&
                `At this size: ${autoColumns} ${autoColumns === 1 ? 'column' : 'columns'}. `}
              {!rowFits &&
                `Too narrow for ${widgets.length} widgets side by side at this size, so ${
                  layout === 'row' ? 'this panel stacks them' : '"Side by side" is unavailable'
                } until it's wider. `}
              Layouts adapt to the screen: on a smaller screen or when zoomed out, panels fall back to fewer columns.
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Widgets (in display order)</label>
            <div className="space-y-2">
              {widgets.map((type, index) => (
                <div key={type} className="p-3 rounded-2xl border bg-indigo-500/10 border-indigo-500/40 flex items-center gap-3">
                  <span className="w-5 text-center text-xs font-bold text-indigo-300 tabular-nums">{index + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-white">{INFO_WIDGET_META[type].title}</span>
                    <span className="block text-xs text-slate-400">{INFO_WIDGET_META[type].description}</span>
                  </span>
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className={iconButton} aria-label="Move up">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === widgets.length - 1}
                    className={iconButton}
                    aria-label="Move down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setWidgets((prev) => prev.filter((w) => w !== type))}
                    disabled={widgets.length === 1}
                    className={iconButton}
                    aria-label="Remove widget"
                    title={widgets.length === 1 ? 'A panel needs at least one widget' : 'Remove'}
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {available.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setWidgets((prev) => [...prev, type])}
                  className="w-full p-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] hover:bg-white/[0.05] flex items-center gap-3 text-left"
                >
                  <span className="w-5 flex justify-center text-slate-400">
                    <Plus className="w-3.5 h-3.5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-300">{INFO_WIDGET_META[type].title}</span>
                    <span className="block text-xs text-slate-500">{INFO_WIDGET_META[type].description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-white/10 bg-[#0f1120] flex items-center justify-between">
          {isConfirmingDelete ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-rose-300">Delete this panel?</span>
              <button
                onClick={() => onDelete(panel.id)}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold"
              >
                Yes
              </button>
              <button
                onClick={() => setIsConfirmingDelete(false)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 font-semibold"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsConfirmingDelete(true)}
              className="px-3 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Panel
            </button>
          )}
          <button
            onClick={() => onSave(panel.id, { widgets, layout })}
            disabled={widgets.length === 0}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold shadow-lg shadow-indigo-600/20 flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </div>
    </div>
  );
};
