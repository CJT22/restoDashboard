import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, Plus, Edit2, KeyRound, Eye, EyeOff, Globe } from 'lucide-react';
import { DataTable, ColumnDef } from '../ui/DataTable';
import { SidePanel } from '../ui/SidePanel';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { SkeletonStatCards, SkeletonPageHeader, SkeletonTable } from '../ui/Skeleton';
import { useUser } from '../../context/UserContext';

interface TokenRow {
  id: number;
  branchId: number | null;
  branchName: string;
  branchCode: string | null;
  accessToken: string;
  updatedAt: string;
}

interface BranchOption {
  id: number;
  code: string;
  name: string;
}

const authHeaders = (json = true): HeadersInit => {
  const token = localStorage.getItem('token');
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const maskToken = (token: string): string => {
  if (token.length <= 10) return '•'.repeat(token.length);
  return `${token.slice(0, 6)}${'•'.repeat(8)}${token.slice(-4)}`;
};

export const LoyverseTokens: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useUser();
  const is3core = (user?.username || '').trim().toLowerCase() === '3coredev';

  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [filteredTokens, setFilteredTokens] = useState<TokenRow[]>([]);
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingToken, setEditingToken] = useState<TokenRow | null>(null);
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());

  const [formData, setFormData] = useState({
    branchId: '' as '' | number,
    accessToken: '',
  });

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/loyverse/tokens', { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Failed to load tokens (${res.status})`);
      }
      const rawData = json.data ?? json;
      const mapped: TokenRow[] = (Array.isArray(rawData) ? rawData : []).map((r: any) => ({
        id: r.ID,
        branchId: r.BRANCH_ID,
        branchName: r.BRANCH_ID == null ? t('loyverse_tokens.global_default') : (r.BRANCH_NAME || '—'),
        branchCode: r.BRANCH_CODE || null,
        accessToken: r.ACCESS_TOKEN || '',
        updatedAt: r.UPDATED_DT || '',
      }));
      setTokens(mapped);
      setFilteredTokens(mapped);
    } catch (e: any) {
      console.error('Failed to fetch loyverse tokens', e);
      setError(e.message || t('loyverse_tokens.failed_to_load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const fetchBranchOptions = useCallback(async () => {
    try {
      const res = await fetch('/branch', { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok) return;
      const rawData = json.data ?? json;
      const mapped: BranchOption[] = (Array.isArray(rawData) ? rawData : []).map((b: any) => ({
        id: b.IDNo,
        code: b.BRANCH_CODE || '—',
        name: b.BRANCH_NAME || '—',
      }));
      setBranchOptions(mapped);
    } catch (e) {
      console.error('Failed to fetch branches', e);
    }
  }, []);

  useEffect(() => {
    if (!is3core) return;
    fetchTokens();
    fetchBranchOptions();
  }, [is3core, fetchTokens, fetchBranchOptions]);

  useEffect(() => {
    const filtered = tokens.filter(
      (r) =>
        (r.branchName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.branchCode || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredTokens(filtered);
  }, [searchQuery, tokens]);

  const handleOpenAddPanel = () => {
    setEditingToken(null);
    setFormData({ branchId: '', accessToken: '' });
    setIsPanelOpen(true);
  };

  const handleOpenEditPanel = (row: TokenRow) => {
    setEditingToken(row);
    setFormData({ branchId: row.branchId ?? '', accessToken: row.accessToken });
    setIsPanelOpen(true);
  };

  const toggleReveal = (id: number) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.accessToken.trim()) {
      toast.error(t('loyverse_tokens.token_required'));
      return;
    }
    setIsSubmitting(true);
    try {
      const url = editingToken ? `/api/loyverse/tokens/${editingToken.id}` : '/api/loyverse/tokens';
      const method = editingToken ? 'PUT' : 'POST';
      const body: Record<string, unknown> = { access_token: formData.accessToken.trim() };
      if (!editingToken) {
        body.branch_id = formData.branchId === '' ? null : formData.branchId;
      }
      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      let data: { success?: boolean; error?: string; message?: string };
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok) {
        throw new Error(data?.error || data?.message || `Failed to ${editingToken ? 'update' : 'create'} token (${res.status})`);
      }
      toast.success(editingToken ? t('loyverse_tokens.toast.updated_success') : t('loyverse_tokens.toast.created_success'));
      setIsPanelOpen(false);
      fetchTokens();
    } catch (e: any) {
      toast.error(e?.message || t('loyverse_tokens.toast.save_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const usedBranchIds = new Set(tokens.filter((r) => r.branchId != null).map((r) => r.branchId));
  const hasGlobalRow = tokens.some((r) => r.branchId == null);

  const columns: ColumnDef<TokenRow>[] = [
    {
      header: t('loyverse_tokens.branch'),
      render: (r) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
            {r.branchId == null ? (
              <Globe size={16} className="text-brand-muted" />
            ) : (
              <KeyRound size={16} className="text-brand-muted" />
            )}
          </div>
          <div>
            <div className="text-sm font-bold">{r.branchName}</div>
            {r.branchCode && <div className="text-xs text-brand-muted">{r.branchCode}</div>}
          </div>
        </div>
      ),
    },
    {
      header: t('loyverse_tokens.token'),
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono">{revealedIds.has(r.id) ? r.accessToken : maskToken(r.accessToken)}</span>
          <button
            type="button"
            onClick={() => toggleReveal(r.id)}
            className="p-1 text-brand-muted hover:text-brand-primary transition-colors"
            title={revealedIds.has(r.id) ? t('loyverse_tokens.hide_token') : t('loyverse_tokens.show_token')}
          >
            {revealedIds.has(r.id) ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      ),
    },
    {
      header: t('loyverse_tokens.last_updated'),
      render: (r) => (
        <span className="text-sm text-brand-muted">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}</span>
      ),
    },
    {
      header: t('loyverse_tokens.action'),
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end items-center gap-2">
          <button
            onClick={() => handleOpenEditPanel(r)}
            className="p-2 text-brand-muted hover:text-brand-primary hover:bg-brand-primary/10 transition-colors rounded-lg"
            title={t('loyverse_tokens.edit_token')}
          >
            <Edit2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  if (!is3core) {
    return (
      <div className="space-y-8 pt-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <p className="text-brand-muted font-medium">{t('loyverse_tokens.restricted')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pt-6">
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-8"
          >
            <SkeletonPageHeader />
            <SkeletonStatCards />
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <SkeletonTable columns={4} rows={6} />
            </div>
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center min-h-[500px]"
          >
            <p className="text-red-500 text-lg">{error}</p>
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="space-y-8"
          >
            <div className="flex items-center justify-between">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
                <input
                  type="text"
                  placeholder={t('loyverse_tokens.search_placeholder')}
                  className="bg-white border-none rounded-xl pl-10 pr-4 py-2.5 text-base w-80 shadow-sm focus:ring-2 focus:ring-brand-primary/20 outline-none"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button
                onClick={handleOpenAddPanel}
                className="bg-brand-primary text-white px-6 py-2.5 rounded-xl text-base font-bold flex items-center gap-2 shadow-lg shadow-brand-primary/20 hover:bg-brand-primary/90 transition-all"
              >
                <Plus size={18} />
                {t('loyverse_tokens.add_token')}
              </button>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm w-fit">
              <p className="text-brand-muted text-sm font-medium mb-1">{t('loyverse_tokens.total_tokens')}</p>
              <h3 className="text-3xl font-bold">{tokens.length}</h3>
            </div>

            <DataTable
              data={filteredTokens}
              columns={columns}
              keyExtractor={(item) => item.id}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <SidePanel
        isOpen={isPanelOpen}
        onClose={() => {
          if (!isSubmitting) {
            setIsPanelOpen(false);
            setFormData({ branchId: '', accessToken: '' });
          }
        }}
        title={editingToken ? t('loyverse_tokens.edit_token') : t('loyverse_tokens.add_token')}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setIsPanelOpen(false)}
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl font-bold text-brand-muted hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {t('loyverse_tokens.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !formData.accessToken.trim()}
              className="px-6 py-2.5 rounded-xl font-bold text-white bg-brand-primary shadow-lg shadow-brand-primary/30 hover:bg-brand-primary/90 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              {editingToken ? t('loyverse_tokens.update_token') : t('loyverse_tokens.save_token')}
            </button>
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-3">
            <label className="text-xs font-bold text-brand-text uppercase tracking-wider block">
              {t('loyverse_tokens.branch')}
            </label>
            <select
              disabled={!!editingToken}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary/50 outline-none transition-all disabled:opacity-60"
              value={formData.branchId}
              onChange={(e) => setFormData({ ...formData, branchId: e.target.value === '' ? '' : Number(e.target.value) })}
            >
              {!hasGlobalRow && <option value="">{t('loyverse_tokens.global_default')}</option>}
              {branchOptions
                .filter((b) => !usedBranchIds.has(b.id) || formData.branchId === b.id)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
            </select>
            {editingToken && (
              <p className="text-[10px] text-brand-muted">{t('loyverse_tokens.branch_locked_hint')}</p>
            )}
          </div>
          <div className="space-y-3">
            <label className="text-xs font-bold text-brand-text uppercase tracking-wider block">
              {t('loyverse_tokens.token')} *
            </label>
            <div className="relative">
              <KeyRound size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-muted" />
              <input
                type="text"
                required
                placeholder={t('loyverse_tokens.enter_token')}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-4 py-3 text-sm font-mono focus:bg-white focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary/50 outline-none transition-all"
                value={formData.accessToken}
                onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
                autoComplete="off"
              />
            </div>
          </div>
        </form>
      </SidePanel>
    </div>
  );
};
