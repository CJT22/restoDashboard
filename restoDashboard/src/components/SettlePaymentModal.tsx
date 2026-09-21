import React, { useEffect, useState } from 'react';
import { getBilling, settleOrder } from '../services/orderSync';
import { X, Wallet } from 'lucide-react';

interface SettlePaymentModalProps {
  orderId: number;
  orderNo: string;
  onClose: () => void;
  onSettled: () => void;
}

const PAYMENT_METHODS = ['CASH', 'CARD', 'GCASH', 'BANK'];

export const SettlePaymentModal: React.FC<SettlePaymentModalProps> = ({ orderId, orderNo, onClose, onSettled }) => {
  const [loading, setLoading] = useState(true);
  const [remaining, setRemaining] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [amountPaid, setAmountPaid] = useState(0);
  const [paymentRef, setPaymentRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBilling(orderId)
      .then((billing) => {
        if (cancelled) return;
        const rem = billing ? Math.max(0, billing.amountDue - billing.amountPaid) : 0;
        setRemaining(rem);
        setAmountPaid(rem);
        if (billing?.paymentMethod) setPaymentMethod(billing.paymentMethod);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || 'Failed to load the billing record from restoAdmin');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const handleSubmit = async () => {
    if (amountPaid <= 0 || amountPaid > remaining + 1e-6) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await settleOrder(orderId, {
        paymentMethod,
        amountPaid,
        paymentRef: paymentRef.trim() || null,
      });
      if (result.ok) {
        onSettled();
        onClose();
      } else {
        setError(result.message || 'Failed to settle order');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to settle order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm bg-[#141628] border border-white/15 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-slate-100">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Settle Order</h3>
              <p className="text-xs text-slate-400">Order #{orderNo}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <p className="text-xs text-slate-500">Loading balance…</p>
          ) : (
            <>
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 text-xs text-slate-300 flex justify-between">
                <span>Remaining balance</span>
                <span className="font-mono font-bold text-white">₱{remaining.toFixed(2)}</span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m} className="bg-[#1a1c30]">
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Amount Paid (partial payment allowed)
                </label>
                <input
                  type="number"
                  min={0.01}
                  max={remaining}
                  step={0.01}
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Payment Reference (optional)</label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. GCash ref no."
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {error && (
                <div className="p-3 rounded-2xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-5 border-t border-white/10 bg-[#0f1120] flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={loading || submitting || amountPaid <= 0 || amountPaid > remaining + 1e-6}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold shadow-lg shadow-emerald-600/20"
          >
            {submitting ? 'Settling…' : amountPaid < remaining ? 'Record Partial Payment' : 'Settle in Full'}
          </button>
        </div>
      </div>
    </div>
  );
};
