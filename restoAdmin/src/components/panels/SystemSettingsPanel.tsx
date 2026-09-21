import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Settings,
    Globe,
    Shield,
    Info,
    ChevronRight,
    Store,
    Layout,
    Smartphone,
    ArrowLeft,
    Plus,
    Pencil,
    Trash2,
    Check,
    AlertCircle,
    Loader2,
    MapPin,
    Phone,
    Hash,
    Eye,
    EyeOff,
    RefreshCw,
    Calendar,
    User as UserIcon,
    FileText,
    QrCode,
} from 'lucide-react';
import DatePicker from 'react-datepicker';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
    formatDateToLocalYmd,
    getManilaMonthToDateRange,
    parseYmdToLocalDate,
} from '../../utils/manilaDateTime';
function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

const toDate = (s: string): Date | null => (s ? parseYmdToLocalDate(s) : null);
const toYYYYMMDD = (d: Date): string => formatDateToLocalYmd(d);
const getDefaultSyncDateRange = () => getManilaMonthToDateRange();

// ─── Shared Types & Helpers ────────────────────────────

type Toast = { type: 'success' | 'error'; message: string } | null;

function getToken() {
    return localStorage.getItem('token') || '';
}

function authHeaders(): HeadersInit {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
    };
}

// ─── Shared SettingsItem ────────────────────────────────

type SettingsItemProps = {
    icon: React.ElementType;
    label: string;
    description?: string;
    onClick?: () => void;
    badge?: string;
};

const SettingsItem: React.FC<SettingsItemProps> = ({
    icon: Icon,
    label,
    description,
    onClick,
    badge
}) => (
    <button
        onClick={onClick}
        className="w-full flex items-center justify-between p-4 rounded-2xl transition-all cursor-pointer group border border-transparent hover:bg-brand-orange/5 hover:border-brand-orange/10"
    >
        <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-gray-100 text-brand-muted group-hover:bg-brand-orange/10 group-hover:text-brand-orange transition-colors">
                <Icon size={18} />
            </div>
            <div className="text-left">
                <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-brand-text">{label}</p>
                    {badge && (
                        <span className="px-1.5 py-0.5 bg-brand-orange/10 text-brand-orange text-[10px] font-bold rounded uppercase tracking-wider">
                            {badge}
                        </span>
                    )}
                </div>
                {description && (
                    <p className="text-xs text-brand-muted font-medium">{description}</p>
                )}
            </div>
        </div>
        <ChevronRight
            size={16}
            className="text-brand-muted/40 transition-transform group-hover:translate-x-0.5"
        />
    </button>
);

// ─── Sub-header component ─────────────────────────────

const SubViewHeader: React.FC<{
    title: string;
    onBack: () => void;
    disabled?: boolean;
    action?: React.ReactNode;
}> = ({ title, onBack, disabled, action }) => (
    <div className="p-6 border-b border-gray-100">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <button
                    onClick={onBack}
                    disabled={disabled}
                    className={cn("p-2 rounded-lg transition-colors text-brand-muted", disabled ? "cursor-not-allowed opacity-50" : "hover:bg-gray-100 cursor-pointer")}
                >
                    <ArrowLeft size={20} />
                </button>
                <h3 className="text-lg font-bold text-brand-text">{title}</h3>
            </div>
            {action}
        </div>
    </div>
);

// ─── Toast component ──────────────────────────────────

const ToastMessage: React.FC<{ toast: Toast }> = ({ toast }) => (
    <AnimatePresence>
        {toast && (
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={cn(
                    "mx-6 mt-4 px-4 py-3 rounded-xl flex items-center gap-3 text-sm font-medium",
                    toast.type === 'success'
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-red-50 text-red-700 border border-red-200"
                )}
            >
                {toast.type === 'success' ? <Check size={16} className="shrink-0" /> : <AlertCircle size={16} className="shrink-0" />}
                <span>{toast.message}</span>
            </motion.div>
        )}
    </AnimatePresence>
);

// ═══════════════════════════════════════════════════════
// SUB-VIEW: Branch Management
// ═══════════════════════════════════════════════════════

type BranchRecord = {
    IDNo: number;
    BRANCH_CODE: string;
    BRANCH_NAME: string;
    ADDRESS?: string;
    PHONE?: string;
};

const BranchManagementView: React.FC<{ onBack: () => void; t: (key: string) => string }> = ({ onBack, t }) => {
    const [branches, setBranches] = useState<BranchRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<Toast>(null);
    const [editingBranch, setEditingBranch] = useState<BranchRecord | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [saving, setSaving] = useState(false);

    // Form
    const [formCode, setFormCode] = useState('');
    const [formName, setFormName] = useState('');
    const [formAddress, setFormAddress] = useState('');
    const [formPhone, setFormPhone] = useState('');

    useEffect(() => {
        if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }
    }, [toast]);

    const fetchBranches = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/branch/', { headers: authHeaders() });
            const data = await res.json();
            if (data.success) setBranches(data.data || []);
        } catch { setToast({ type: 'error', message: t('system_settings.branch_load_failed') }); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchBranches(); }, [fetchBranches]);

    const resetForm = () => {
        setFormCode(''); setFormName(''); setFormAddress(''); setFormPhone('');
        setEditingBranch(null); setIsCreating(false);
    };

    const startEdit = (b: BranchRecord) => {
        setEditingBranch(b); setIsCreating(false);
        setFormCode(b.BRANCH_CODE); setFormName(b.BRANCH_NAME);
        setFormAddress(b.ADDRESS || ''); setFormPhone(b.PHONE || '');
    };

    const startCreate = () => {
        resetForm(); setIsCreating(true);
    };

    const handleSave = async () => {
        if (!formCode.trim() || !formName.trim()) {
            setToast({ type: 'error', message: t('system_settings.branch_required') });
            return;
        }
        setSaving(true);
        try {
            const body = { BRANCH_CODE: formCode.trim(), BRANCH_NAME: formName.trim(), ADDRESS: formAddress.trim(), PHONE: formPhone.trim() };
            let res;
            if (editingBranch) {
                res = await fetch(`/branch/${editingBranch.IDNo}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
            } else {
                res = await fetch('/branch/', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
            }
            const data = await res.json();
            if (data.success) {
                setToast({ type: 'success', message: editingBranch ? t('system_settings.branch_updated') : t('system_settings.branch_created') });
                resetForm();
                fetchBranches();
            } else {
                setToast({ type: 'error', message: data.message || data.error || t('system_settings.branch_save_failed') });
            }
        } catch { setToast({ type: 'error', message: 'Network error' }); }
        finally { setSaving(false); }
    };

    const handleDelete = async (id: number) => {
        if (!confirm(t('system_settings.branch_delete_confirm'))) return;
        try {
            const res = await fetch(`/branch/${id}`, { method: 'DELETE', headers: authHeaders() });
            const data = await res.json();
            if (data.success) {
                setToast({ type: 'success', message: t('system_settings.branch_deleted') });
                fetchBranches();
            } else {
                setToast({ type: 'error', message: data.message || data.error || t('system_settings.branch_delete_failed') });
            }
        } catch { setToast({ type: 'error', message: 'Network error' }); }
    };

    const showForm = isCreating || editingBranch;

    return (
        <div className="flex flex-col h-full">
            <SubViewHeader
                title={t('system_settings.branch_management')}
                onBack={onBack}
                action={
                    !showForm ? (
                        <button onClick={startCreate} className="p-2 bg-brand-orange/10 text-brand-orange rounded-lg hover:bg-brand-orange/20 transition-colors cursor-pointer">
                            <Plus size={18} />
                        </button>
                    ) : undefined
                }
            />
            <ToastMessage toast={toast} />

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
                {showForm ? (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                        <h4 className="text-sm font-bold text-brand-text">{editingBranch ? t('system_settings.edit_branch') : t('system_settings.new_branch')}</h4>
                        <div className="space-y-1.5">
                            <label className="block text-xs font-bold uppercase tracking-wider text-brand-muted ml-1">{t('system_settings.branch_code')} *</label>
                            <div className="relative">
                                <Hash size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-muted" />
                                <input value={formCode} onChange={e => setFormCode(e.target.value)} disabled={saving}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-4 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange/50 outline-none transition-all disabled:opacity-50" />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="block text-xs font-bold uppercase tracking-wider text-brand-muted ml-1">{t('system_settings.branch_name')} *</label>
                            <div className="relative">
                                <Store size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-muted" />
                                <input value={formName} onChange={e => setFormName(e.target.value)} disabled={saving}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-4 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange/50 outline-none transition-all disabled:opacity-50" />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="block text-xs font-bold uppercase tracking-wider text-brand-muted ml-1">{t('system_settings.address')}</label>
                            <div className="relative">
                                <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-muted" />
                                <input value={formAddress} onChange={e => setFormAddress(e.target.value)} disabled={saving}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-4 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange/50 outline-none transition-all disabled:opacity-50" />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="block text-xs font-bold uppercase tracking-wider text-brand-muted ml-1">{t('system_settings.phone')}</label>
                            <div className="relative">
                                <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-muted" />
                                <input value={formPhone} onChange={e => setFormPhone(e.target.value)} disabled={saving}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-4 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange/50 outline-none transition-all disabled:opacity-50" />
                            </div>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={resetForm} disabled={saving}
                                className="flex-1 py-3 bg-gray-100 text-brand-text rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors cursor-pointer disabled:opacity-50">
                                {t('system_settings.cancel')}
                            </button>
                            <button onClick={handleSave} disabled={saving}
                                className="flex-1 py-3 bg-brand-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-brand-primary/20 hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                                {saving ? <><Loader2 size={16} className="animate-spin" /> {t('system_settings.saving')}...</> : t('system_settings.save')}
                            </button>
                        </div>
                    </motion.div>
                ) : loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 size={24} className="animate-spin text-brand-orange" />
                    </div>
                ) : branches.length === 0 ? (
                    <div className="text-center py-12">
                        <Store size={40} className="mx-auto text-brand-muted/30 mb-3" />
                        <p className="text-sm text-brand-muted font-medium">{t('system_settings.no_branches')}</p>
                        <button onClick={startCreate} className="mt-3 text-sm text-brand-orange font-bold hover:underline cursor-pointer">+ {t('system_settings.add_first_branch')}</button>
                    </div>
                ) : (
                    branches.map(b => (
                        <motion.div key={b.IDNo} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-brand-orange/20 transition-colors group">
                            <div className="flex items-start justify-between">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="px-2 py-0.5 bg-brand-orange/10 text-brand-orange text-[10px] font-bold rounded uppercase tracking-wider">{b.BRANCH_CODE}</span>
                                        <h4 className="text-sm font-bold text-brand-text truncate">{b.BRANCH_NAME}</h4>
                                    </div>
                                    {b.ADDRESS && <p className="text-xs text-brand-muted flex items-center gap-1 mt-1"><MapPin size={12} /> {b.ADDRESS}</p>}
                                    {b.PHONE && <p className="text-xs text-brand-muted flex items-center gap-1 mt-0.5"><Phone size={12} /> {b.PHONE}</p>}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                                    <button onClick={() => startEdit(b)} className="p-1.5 hover:bg-white rounded-lg text-brand-muted hover:text-brand-orange transition-colors cursor-pointer">
                                        <Pencil size={14} />
                                    </button>
                                    <button onClick={() => handleDelete(b.IDNo)} className="p-1.5 hover:bg-white rounded-lg text-brand-muted hover:text-red-500 transition-colors cursor-pointer">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    ))
                )}
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// SUB-VIEW: Localization
// ═══════════════════════════════════════════════════════

const LANGUAGES = [
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'ko', label: '한국어 (Korean)', flag: '🇰🇷' },
    { code: 'ja', label: '日本語 (Japanese)', flag: '🇯🇵' },
    { code: 'zh', label: '中文 (Chinese)', flag: '🇨🇳' },
];

const LocalizationView: React.FC<{ onBack: () => void; t: (key: string) => string }> = ({ onBack, t }) => {
    const [currentLang, setCurrentLang] = useState('en');
    const [toast, setToast] = useState<Toast>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        // Read current language from cookie
        const match = document.cookie.match(/(?:^|;\s*)lang=(\w+)/);
        if (match) setCurrentLang(match[1]);
    }, []);

    useEffect(() => {
        if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }
    }, [toast]);

    const handleChangeLang = async (code: string) => {
        if (code === currentLang) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/change-lang?lang=${code}`);
            const data = await res.json();
            if (data.success) {
                setCurrentLang(code);
                setToast({ type: 'success', message: `Language changed to ${LANGUAGES.find(l => l.code === code)?.label}` });
            } else {
                setToast({ type: 'error', message: t('system_settings.lang_change_failed') });
            }
        } catch { setToast({ type: 'error', message: 'Network error' }); }
        finally { setSaving(false); }
    };

    return (
        <div className="flex flex-col h-full">
            <SubViewHeader title={t('system_settings.localization')} onBack={onBack} />
            <ToastMessage toast={toast} />
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-3">
                <p className="text-xs text-brand-muted font-medium mb-4">{t('system_settings.lang_description')}</p>
                {LANGUAGES.map(lang => (
                    <button
                        key={lang.code}
                        onClick={() => handleChangeLang(lang.code)}
                        disabled={saving}
                        className={cn(
                            "w-full flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer disabled:opacity-50",
                            currentLang === lang.code
                                ? "border-brand-orange bg-brand-orange/5"
                                : "border-gray-100 hover:border-brand-orange/20 hover:bg-gray-50"
                        )}
                    >
                        <div className="flex items-center gap-4">
                            <span className="text-2xl">{lang.flag}</span>
                            <span className="text-sm font-bold text-brand-text">{lang.label}</span>
                        </div>
                        {currentLang === lang.code && (
                            <div className="w-6 h-6 bg-brand-orange rounded-full flex items-center justify-center">
                                <Check size={14} className="text-white" />
                            </div>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// SUB-VIEW: Dashboard Layout
// ═══════════════════════════════════════════════════════

const DASHBOARD_WIDGETS = [
    { key: 'revenue_chart', label: 'Revenue Chart', description: 'Monthly income vs expense graph' },
    { key: 'stat_cards', label: 'Stat Cards', description: 'Revenue, orders, customers overview' },
    { key: 'trending_menu', label: 'Trending Menu', description: 'Top selling menu items' },
    { key: 'recent_orders', label: 'Recent Orders', description: 'Latest order activity feed' },
    { key: 'quick_actions', label: 'Quick Actions', description: 'Shortcut buttons for common tasks' },
];

const STORAGE_KEY = 'dashboard_widget_visibility';

const DashboardLayoutView: React.FC<{ onBack: () => void; t: (key: string) => string }> = ({ onBack, t }) => {
    const [visibility, setVisibility] = useState<Record<string, boolean>>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch { return {}; }
    });
    const [toast, setToast] = useState<Toast>(null);

    useEffect(() => {
        if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }
    }, [toast]);

    const isVisible = (key: string) => visibility[key] !== false; // default visible

    const toggle = (key: string) => {
        const updated = { ...visibility, [key]: !isVisible(key) };
        setVisibility(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setToast({ type: 'success', message: `Widget ${isVisible(key) ? 'hidden' : 'shown'}` });
    };

    return (
        <div className="flex flex-col h-full">
            <SubViewHeader title={t('system_settings.dashboard_layout')} onBack={onBack} />
            <ToastMessage toast={toast} />
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-3">
                <p className="text-xs text-brand-muted font-medium mb-4">{t('system_settings.dashboard_layout_desc')}</p>
                {DASHBOARD_WIDGETS.map(w => (
                    <button
                        key={w.key}
                        onClick={() => toggle(w.key)}
                        className={cn(
                            "w-full flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer",
                            isVisible(w.key) ? "border-green-200 bg-green-50/50" : "border-gray-100 bg-gray-50 opacity-60"
                        )}
                    >
                        <div className="flex items-center gap-4">
                            <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center",
                                isVisible(w.key) ? "bg-green-100 text-green-600" : "bg-gray-200 text-gray-400"
                            )}>
                                {isVisible(w.key) ? <Eye size={18} /> : <EyeOff size={18} />}
                            </div>
                            <div className="text-left">
                                <p className="text-sm font-bold text-brand-text">{w.label}</p>
                                <p className="text-xs text-brand-muted font-medium">{w.description}</p>
                            </div>
                        </div>
                        <div className={cn(
                            "w-12 h-7 rounded-full p-1 transition-colors",
                            isVisible(w.key) ? "bg-green-500" : "bg-gray-300"
                        )}>
                            <motion.div
                                layout
                                className="w-5 h-5 bg-white rounded-full shadow-sm"
                                style={{ marginLeft: isVisible(w.key) ? 'auto' : 0 }}
                            />
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// SUB-VIEW: Mobile App
// ═══════════════════════════════════════════════════════

const MobileAppView: React.FC<{ onBack: () => void; t: (key: string) => string }> = ({ onBack, t }) => {
    const serverUrl = window.location.origin;

    return (
        <div className="flex flex-col h-full">
            <SubViewHeader title={t('system_settings.mobile_app')} onBack={onBack} />
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                <div className="text-center">
                    <div className="w-20 h-20 mx-auto bg-brand-orange/10 rounded-3xl flex items-center justify-center mb-4">
                        <Smartphone size={36} className="text-brand-orange" />
                    </div>
                    <h4 className="text-base font-bold text-brand-text mb-2">{t('system_settings.connect_mobile')}</h4>
                    <p className="text-xs text-brand-muted font-medium leading-relaxed">
                        {t('system_settings.mobile_description')}
                    </p>
                </div>

                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-3">
                    <p className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">{t('system_settings.server_address')}</p>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 bg-white px-3 py-2.5 rounded-xl text-sm font-mono text-brand-text border border-gray-200 truncate">
                            {serverUrl}
                        </code>
                        <button
                            onClick={() => { navigator.clipboard.writeText(serverUrl); }}
                            className="px-3 py-2.5 bg-brand-orange/10 text-brand-orange rounded-xl text-xs font-bold hover:bg-brand-orange/20 transition-colors cursor-pointer shrink-0"
                        >
                            {t('system_settings.copy')}
                        </button>
                    </div>
                </div>

                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center space-y-3">
                    <QrCode size={80} className="mx-auto text-brand-muted/30" />
                    <p className="text-xs text-brand-muted font-medium">{t('system_settings.qr_description')}</p>
                </div>

                <div className="space-y-2">
                    <p className="text-[10px] font-bold text-brand-muted uppercase tracking-widest px-1">{t('system_settings.requirements')}</p>
                    <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700 font-medium">
                        ✓ {t('system_settings.req_same_network')}
                    </div>
                    <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700 font-medium">
                        ✓ {t('system_settings.req_server_port')}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// SUB-VIEW: Security Audit
// ═══════════════════════════════════════════════════════

type AuditLog = {
    IDNo: number;
    USER_ID: number;
    USERNAME?: string;
    FIRSTNAME?: string;
    LASTNAME?: string;
    ACTION: string;
    TABLE_NAME: string;
    RECORD_ID?: number;
    BRANCH_ID?: number;
    BRANCH_NAME?: string;
    CREATED_DT: string;
};

const SecurityAuditView: React.FC<{ onBack: () => void; t: (key: string) => string }> = ({ onBack, t }) => {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<Toast>(null);

    useEffect(() => {
        if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }
    }, [toast]);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/audit-logs?limit=50', { headers: authHeaders() });
            const data = await res.json();
            if (data.success) setLogs(data.data || []);
            else setToast({ type: 'error', message: 'Failed to load audit logs' });
        } catch { setToast({ type: 'error', message: 'Network error' }); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    const getActionColor = (action: string) => {
        switch (action) {
            case 'CREATE': return 'bg-green-100 text-green-700';
            case 'UPDATE': return 'bg-blue-100 text-blue-700';
            case 'DELETE': return 'bg-red-100 text-red-700';
            case 'LOGIN': return 'bg-purple-100 text-purple-700';
            default: return 'bg-gray-100 text-gray-600';
        }
    };

    return (
        <div className="flex flex-col h-full">
            <SubViewHeader
                title={t('system_settings.security_audit')}
                onBack={onBack}
                action={
                    <button onClick={fetchLogs} disabled={loading}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-brand-muted cursor-pointer disabled:opacity-50">
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                }
            />
            <ToastMessage toast={toast} />
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-2">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 size={24} className="animate-spin text-brand-orange" />
                    </div>
                ) : logs.length === 0 ? (
                    <div className="text-center py-12">
                        <Shield size={40} className="mx-auto text-brand-muted/30 mb-3" />
                        <p className="text-sm text-brand-muted font-medium">{t('system_settings.no_audit_logs')}</p>
                    </div>
                ) : (
                    logs.map(log => (
                        <div key={log.IDNo} className="p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className={cn("px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider", getActionColor(log.ACTION))}>
                                    {log.ACTION}
                                </span>
                                <span className="text-[10px] text-brand-muted font-medium">
                                    {new Date(log.CREATED_DT).toLocaleString()}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                                <UserIcon size={12} className="text-brand-muted shrink-0" />
                                <span className="text-brand-text font-medium truncate">
                                    {log.FIRSTNAME && log.LASTNAME ? `${log.FIRSTNAME} ${log.LASTNAME}` : log.USERNAME || `User #${log.USER_ID}`}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs mt-0.5">
                                <FileText size={12} className="text-brand-muted shrink-0" />
                                <span className="text-brand-muted font-medium">{log.TABLE_NAME}{log.RECORD_ID ? ` #${log.RECORD_ID}` : ''}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// SUB-VIEW: Version Info
// ═══════════════════════════════════════════════════════

const VersionInfoView: React.FC<{ onBack: () => void; t: (key: string) => string }> = ({ onBack, t }) => {
    const appName = '3Core Dashboard';
    const appVersion = '1.0.0';
    const buildDate = 'Feb 26, 2026';

    const infoItems = [
        { label: t('system_settings.application'), value: appName },
        { label: t('system_settings.version'), value: `v${appVersion}` },
        { label: t('system_settings.build_date'), value: buildDate },
        { label: t('system_settings.frontend'), value: 'React 19 + Vite 6' },
        { label: t('system_settings.backend'), value: 'Node.js + Express 4' },
        { label: t('system_settings.database'), value: 'MySQL' },
        { label: t('system_settings.auth'), value: 'JWT + Session' },
        { label: t('system_settings.realtime'), value: 'Socket.IO' },
    ];

    return (
        <div className="flex flex-col h-full">
            <SubViewHeader title={t('system_settings.version_info')} onBack={onBack} />
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                <div className="text-center">
                    <div className="w-20 h-20 mx-auto bg-gradient-to-br from-brand-orange/20 to-brand-primary/20 rounded-3xl flex items-center justify-center mb-4">
                        <Settings size={36} className="text-brand-orange" />
                    </div>
                    <h4 className="text-lg font-bold text-brand-text">{appName}</h4>
                    <p className="text-sm text-brand-muted font-medium">{t('system_settings.restaurant_management')}</p>
                </div>

                <div className="space-y-1">
                    {infoItems.map((item, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors">
                            <span className="text-xs font-bold text-brand-muted uppercase tracking-wider">{item.label}</span>
                            <span className="text-sm font-bold text-brand-text">{item.value}</span>
                        </div>
                    ))}
                </div>

                <div className="p-4 bg-green-50 rounded-2xl border border-green-100 text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                        <Check size={16} className="text-green-600" />
                        <span className="text-sm font-bold text-green-700">{t('system_settings.latest_version')}</span>
                    </div>
                    <p className="text-xs text-green-600 font-medium">{t('system_settings.no_updates')}</p>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// SUB-VIEW: Data Sync (Loyverse)
// ═══════════════════════════════════════════════════════

const DataSyncView: React.FC<{ onBack: () => void; t: (key: string) => string }> = ({ onBack, t }) => {
    const defaultRange = getDefaultSyncDateRange();
    const [toast, setToast] = useState<Toast>(null);
    const [running, setRunning] = useState(false);
    const [syncStatus, setSyncStatus] = useState<any>(null);
    const [branchIds, setBranchIds] = useState<string>('2,9');
    const [startDate, setStartDate] = useState<string>(defaultRange.start);
    const [endDate, setEndDate] = useState<string>(defaultRange.end);
    const [lastResult, setLastResult] = useState<any>(null);
    const [dateDropdownOpen, setDateDropdownOpen] = useState(false);
    const [rangeRunning, setRangeRunning] = useState(false);
    const syncRangeAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (toast) { const tt = setTimeout(() => setToast(null), 3000); return () => clearTimeout(tt); }
    }, [toast]);
    useEffect(() => {
        return () => {
            syncRangeAbortRef.current?.abort();
        };
    }, []);

    const toIsoMin = (d: string) => {
        const [y, m, day] = String(d).split('-').map((n) => Number(n));
        const dt = new Date(y, (m || 1) - 1, day || 1, 0, 0, 0, 0);
        return dt.toISOString();
    };
    const toIsoMax = (d: string) => {
        const [y, m, day] = String(d).split('-').map((n) => Number(n));
        const dt = new Date(y, (m || 1) - 1, day || 1, 23, 59, 59, 999);
        return dt.toISOString();
    };

    const parseBranchIds = (raw: string) => {
        const ids = String(raw || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n) && n > 0);
        return Array.from(new Set(ids));
    };

    const readBranchIdFromUrl = () => {
        try {
            const params = new URLSearchParams(window.location.search);
            const bid = params.get('branchId');
            if (!bid || bid === 'all') return null;
            const n = Number(bid);
            return Number.isFinite(n) && n > 0 ? n : null;
        } catch {
            return null;
        }
    };

    const getEffectiveBranchIdsForActions = () => {
        const bids = parseBranchIds(branchIds);
        if (bids.length > 0) return bids;
        const urlBid = readBranchIdFromUrl();
        return urlBid ? [urlBid] : [];
    };
    const selectedBranchIds = getEffectiveBranchIdsForActions();
    const syncingBranchIds = Array.isArray(syncStatus?.syncingBranches)
        ? syncStatus.syncingBranches
            .map((n: any) => Number(n))
            .filter((n: number) => Number.isFinite(n))
        : [];
    const autoSyncBranchIds = Array.isArray(syncStatus?.autoSync?.branchIds)
        ? syncStatus.autoSync.branchIds
            .map((n: any) => Number(n))
            .filter((n: number) => Number.isFinite(n))
        : [];
    const isSelectedBranchSyncing = selectedBranchIds.length > 0
        ? selectedBranchIds.some((id) => syncingBranchIds.includes(id))
        : !!syncStatus?.isSyncing;
    const isSelectedBranchAutoSyncActive = selectedBranchIds.length > 0
        ? selectedBranchIds.some((id) => autoSyncBranchIds.includes(id))
        : !!syncStatus?.autoSyncActive;
    const activeDateRangeByBranch = (syncStatus?.activeDateRangeByBranch && typeof syncStatus.activeDateRangeByBranch === 'object')
        ? syncStatus.activeDateRangeByBranch
        : {};
    const activeSyncMetaByBranch = (syncStatus?.activeSyncMetaByBranch && typeof syncStatus.activeSyncMetaByBranch === 'object')
        ? syncStatus.activeSyncMetaByBranch
        : {};
    const activeRangeBranchId = selectedBranchIds.find((id) => !!activeDateRangeByBranch[String(id)]);
    const activeSelectedSyncRange = activeRangeBranchId != null ? activeDateRangeByBranch[String(activeRangeBranchId)] : null;
    const activeMetaBranchId = selectedBranchIds.find((id) => !!activeSyncMetaByBranch[String(id)]);
    const activeSelectedSyncMeta = activeMetaBranchId != null ? activeSyncMetaByBranch[String(activeMetaBranchId)] : null;
    const isSelectedBranchDateRangeSyncing = !!(
        isSelectedBranchSyncing &&
        (
            activeSelectedSyncMeta?.source === 'date_range' ||
            activeSelectedSyncRange ||
            rangeRunning
        )
    );
    const isoToYYYYMMDD = (v: any) => {
        if (!v) return '';
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? '' : toYYYYMMDD(d);
    };
    const displayStartDate = (isSelectedBranchSyncing && (activeSelectedSyncMeta?.created_at_min || activeSelectedSyncRange?.created_at_min))
        ? isoToYYYYMMDD(activeSelectedSyncMeta?.created_at_min || activeSelectedSyncRange?.created_at_min)
        : startDate;
    const displayEndDate = (isSelectedBranchSyncing && (activeSelectedSyncMeta?.created_at_max || activeSelectedSyncRange?.created_at_max))
        ? isoToYYYYMMDD(activeSelectedSyncMeta?.created_at_max || activeSelectedSyncRange?.created_at_max)
        : endDate;

    const progressBranchId =
        selectedBranchIds.find((id) => syncingBranchIds.includes(id)) ?? selectedBranchIds[0];
    const syncProgress =
        progressBranchId != null && syncStatus?.syncProgressByBranch && typeof syncStatus.syncProgressByBranch === 'object'
            ? (syncStatus.syncProgressByBranch as Record<string, any>)[String(progressBranchId)]
            : null;
    const progressPhase = syncProgress?.phase as string | undefined;
    const receiptsThisPage = Number(syncProgress?.receiptsThisPage) || 0;
    const processedInPage = Number(syncProgress?.processedInPage) || 0;
    const totalFetchedProg = Number(syncProgress?.totalFetched) || 0;
    const progressHasMore = syncProgress?.hasMore === true;
    const progressPage = Number(syncProgress?.page) || 0;
    const progressElapsedMs = Number(syncProgress?.elapsedMs) || 0;
    const progressIndeterminate =
        progressPhase === 'starting' ||
        progressPhase === 'fetching_api' ||
        (progressPhase === 'processing_receipts' && receiptsThisPage === 0);
    const pageProgressPct =
        !progressIndeterminate && receiptsThisPage > 0
            ? Math.min(100, Math.round((processedInPage / receiptsThisPage) * 1000) / 10)
            : 0;
    const formatElapsed = (ms: number) => {
        if (!Number.isFinite(ms) || ms < 0) return '0:00';
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m}:${String(r).padStart(2, '0')}`;
    };

    // Default branch behavior:
    // - If URL has ?branchId=9, then Data Sync uses ONLY that branch by default.
    // - If no URL branch, try /api/me branch_id (branch user login).
    // - Otherwise fall back to multi-branch (2,9) for admins.
    useEffect(() => {
        const urlBid = readBranchIdFromUrl();
        if (urlBid) {
            setBranchIds(String(urlBid));
            return;
        }
        const token = getToken();
        if (!token) return;
        fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })
            .then((res) => res.json())
            .then((json) => {
                const bid = json?.data?.branch_id ?? json?.data?.BRANCH_ID ?? null;
                const n = Number(bid);
                if (Number.isFinite(n) && n > 0) {
                    setBranchIds(String(n));
                }
            })
            .catch(() => {});
    }, []);

    const refreshStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/loyverse/status', { headers: authHeaders() });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) {
                setToast({ type: 'error', message: json?.message || 'Failed to load sync status' });
                return;
            }
            setSyncStatus(json?.data || null);
        } catch {
            setToast({ type: 'error', message: t('sales_analytics.network_error') });
        }
    }, []);

    useEffect(() => { refreshStatus(); }, [refreshStatus]);

    // Auto-refresh status while a sync is running (1s while syncing for progress bar smoothness).
    useEffect(() => {
        if (!syncStatus?.isSyncing && !syncStatus?.autoSyncActive) return;
        const ms = syncStatus?.isSyncing ? 1000 : 2500;
        const id = window.setInterval(() => {
            refreshStatus();
        }, ms);
        return () => window.clearInterval(id);
    }, [syncStatus?.isSyncing, syncStatus?.autoSyncActive, refreshStatus]);

    const stopAutoSync = async () => {
        setRunning(true);
        try {
            const bids = getEffectiveBranchIdsForActions();
            const res = await fetch('/api/loyverse/auto-sync/stop', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(
                    bids.length > 1
                        ? { branch_ids: bids }
                        : { branch_id: bids[0] || null }
                ),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) {
                setToast({ type: 'error', message: json?.message || 'Failed to stop auto-sync' });
                return;
            }
            setToast({ type: 'success', message: t('system_settings.stop') });
            await refreshStatus();
        } catch {
            setToast({ type: 'error', message: t('sales_analytics.network_error') });
        } finally {
            setRunning(false);
        }
    };

    const startAutoSync = async () => {
        setRunning(true);
        try {
            // Start auto-sync for the currently selected branch/branches.
            const bids = getEffectiveBranchIdsForActions();
            const res = await fetch('/api/loyverse/auto-sync/start', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(
                    bids.length > 1
                        ? { branch_ids: bids }
                        : { branch_id: bids[0] || null }
                ),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) {
                setToast({ type: 'error', message: json?.message || 'Failed to start auto-sync' });
                return;
            }
            setToast({ type: 'success', message: t('system_settings.start') });
            await refreshStatus();
        } catch {
            setToast({ type: 'error', message: t('sales_analytics.network_error') });
        } finally {
            setRunning(false);
        }
    };

    const runSyncRange = async () => {
        const bids = parseBranchIds(branchIds);
        if (bids.length === 0) {
            setToast({ type: 'error', message: 'Branch IDs are required (e.g. 2,9).' });
            return;
        }
        if (!startDate || !endDate) {
            setToast({ type: 'error', message: 'Start date and end date are required.' });
            return;
        }
        setRunning(true);
        setRangeRunning(true);
        setLastResult(null);
        try {
            const results: any[] = [];
            for (const bid of bids) {
                const controller = new AbortController();
                syncRangeAbortRef.current = controller;
                const res = await fetch('/api/loyverse/sync-range', {
                    method: 'POST',
                    headers: authHeaders(),
                    signal: controller.signal,
                    body: JSON.stringify({
                        branch_id: bid,
                        created_at_min: toIsoMin(startDate),
                        created_at_max: toIsoMax(endDate),
                        limit: 250,
                    }),
                });
                const json = await res.json().catch(() => null);
                if (json?.alreadyRunning) {
                    setSyncStatus(json?.status || null);
                    setLastResult({ alreadyRunning: true, branch_id: bid, response: json });
                    setToast({ type: 'error', message: json?.message || 'Sync already running. Please wait.' });
                    return;
                }
                if (!res.ok || !json?.success) {
                    const msg = json?.message || 'Sync failed';
                    setLastResult({ branch_id: bid, response: json });
                    setToast({ type: 'error', message: `Branch ${bid}: ${msg}` });
                    return;
                }
                results.push({ branch_id: bid, ...json?.data });
            }
            setLastResult({
                success: true,
                message: 'Sync range completed successfully',
                data: results,
            });

            // Auto-enable incremental auto-sync right after a successful date-range resync.
            try {
                const startRes = await fetch('/api/loyverse/auto-sync/start', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify(
                        bids.length > 1
                            ? { branch_ids: bids }
                            : { branch_id: bids[0] || null }
                    ),
                });
                const startJson = await startRes.json().catch(() => null);
                if (!startRes.ok || !startJson?.success) {
                    setToast({ type: 'error', message: startJson?.message || 'Resync completed, but failed to start auto-sync.' });
                    await refreshStatus();
                    return;
                }
                setToast({ type: 'success', message: 'Sync completed. Auto-sync started.' });
            } catch {
                setToast({ type: 'error', message: 'Sync completed, but auto-sync could not be started.' });
                await refreshStatus();
                return;
            }
            await refreshStatus();
        } catch (error: any) {
            if (error?.name === 'AbortError') {
                setToast({ type: 'success', message: 'Sync stopped by user.' });
                await refreshStatus();
                return;
            }
            setToast({ type: 'error', message: t('sales_analytics.network_error') });
        } finally {
            syncRangeAbortRef.current = null;
            setRangeRunning(false);
            setRunning(false);
        }
    };

    const stopSelectedBranchSync = async () => {
        setRunning(true);
        try {
            // Cancel local request immediately (same tab), then request server-side stop (all tabs/browsers).
            syncRangeAbortRef.current?.abort();
            const bids = getEffectiveBranchIdsForActions();
            const res = await fetch('/api/loyverse/auto-sync/stop', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(
                    bids.length > 1
                        ? { branch_ids: bids }
                        : { branch_id: bids[0] || null }
                ),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) {
                setToast({ type: 'error', message: json?.message || 'Failed to stop sync' });
                return;
            }
            setToast({ type: 'success', message: 'Stop requested. Sync will halt shortly.' });
            await refreshStatus();
        } catch {
            setToast({ type: 'error', message: t('sales_analytics.network_error') });
        } finally {
            syncRangeAbortRef.current = null;
            setRangeRunning(false);
            setRunning(false);
        }
    };

    /** Remove all LOY-* / LOY-R-* orders for one branch, then user runs date-range (or full) sync to match Loyverse. */
    const purgeLoyverseImported = async () => {
        if (isSelectedBranchSyncing) {
            setToast({ type: 'error', message: 'Wait until sync finishes, or stop it first.' });
            return;
        }
        if (isSelectedBranchAutoSyncActive) {
            setToast({ type: 'error', message: 'Turn off auto-sync first.' });
            return;
        }
        const bids = parseBranchIds(branchIds);
        if (bids.length !== 1) {
            setToast({ type: 'error', message: 'Enter exactly one branch ID (e.g. 2) to delete Loyverse imports.' });
            return;
        }
        const br = bids[0];
        if (
            !window.confirm(
                `Delete ALL Loyverse-imported orders for branch ${br} (ORDER_NO starting with LOY-)? Manual orders are kept. Then run Sync for your date range. This cannot be undone.`
            )
        ) {
            return;
        }
        setRunning(true);
        try {
            const res = await fetch('/api/loyverse/purge-imported', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ branch_id: br }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) {
                setToast({ type: 'error', message: json?.message || json?.error || 'Purge failed' });
                return;
            }
            const n = json?.data?.deletedOrders ?? 0;
            setToast({
                type: 'success',
                message: `Removed ${n} Loyverse order(s). Run Sync now for your date range to match Loyverse.`,
            });
            setLastResult({ purge: true, branch_id: br, ...json?.data });
            await refreshStatus();
        } catch {
            setToast({ type: 'error', message: t('sales_analytics.network_error') });
        } finally {
            setRunning(false);
        }
    };

    const pickerValue: [Date | null, Date | null] = [toDate(startDate), toDate(endDate)];
    const handleDateRangeChange = (
        update: [Date | null, Date | null] | null,
        options?: { closeOnComplete?: boolean }
    ) => {
        const [s, e] = update ?? [null, null];
        setStartDate(s ? toYYYYMMDD(s) : '');
        setEndDate(e ? toYYYYMMDD(e) : '');
        const closeOnComplete = options?.closeOnComplete ?? true;
        if (closeOnComplete && s && e) setDateDropdownOpen(false);
    };

    return (
        <div className="flex flex-col h-full">
            <SubViewHeader
                title={t('system_settings.data_sync')}
                onBack={onBack}
                disabled={running}
            />

            <ToastMessage toast={toast} />

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-5">
                <div className="p-4 rounded-2xl border border-gray-100 bg-brand-bg">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0">
                            <RefreshCw size={18} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-brand-text">{t('system_settings.sync_description')}</p>
                            <p className="text-xs text-brand-muted font-medium mt-1">
                                Resync a date range to backfill Loyverse values (e.g. Product unit price).
                            </p>
                        </div>
                    </div>
                </div>

                <div className="p-4 rounded-2xl border border-gray-100 bg-white space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-xs font-bold text-brand-muted uppercase tracking-widest">Sync status</p>
                            <p className="text-sm font-bold text-brand-text mt-1">
                                {isSelectedBranchSyncing ? 'Running' : 'Idle'}
                                {(isSelectedBranchAutoSyncActive && !isSelectedBranchDateRangeSyncing) ? ' · Auto-sync ON' : ' · Auto-sync OFF'}
                            </p>
                        
                        </div>
                        
                    </div>

                    {isSelectedBranchAutoSyncActive && !isSelectedBranchDateRangeSyncing && (
                        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                            <p className="text-xs text-amber-800 font-semibold">
                                {isSelectedBranchSyncing ? 'Sync is running.' : 'Auto-sync is ON.'}
                            </p>
                            <button
                                type="button"
                                onClick={stopAutoSync}
                                disabled={running}
                                className="px-3 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                            >
                                Stop auto-sync
                            </button>
                        </div>
                    )}

                    {!isSelectedBranchSyncing && !isSelectedBranchAutoSyncActive && (
                        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                            <p className="text-xs text-emerald-800 font-semibold">
                                Auto-sync is OFF.
                            </p>
                            <button
                                type="button"
                                onClick={startAutoSync}
                                disabled={running}
                                className="px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                            >
                                Start auto-sync
                            </button>
                        </div>
                    )}

                </div>

                {/* Page-level progress: date range resync only (not incremental / auto-sync). */}
                {isSelectedBranchDateRangeSyncing && syncProgress && (
                    <div className="p-4 rounded-2xl border border-gray-100 bg-white space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold text-brand-muted uppercase tracking-widest">Date range resync</p>
                            <span className="text-[10px] font-mono text-slate-600 tabular-nums">
                                {formatElapsed(progressElapsedMs)}
                            </span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
                            {progressIndeterminate ? (
                                <div className="h-full w-[38%] rounded-full bg-brand-orange/90 animate-pulse" />
                            ) : (
                                <div
                                    className="h-full rounded-full bg-brand-orange transition-[width] duration-300 ease-out"
                                    style={{ width: `${pageProgressPct}%` }}
                                />
                            )}
                        </div>
                        {progressIndeterminate ? (
                            <p className="text-[11px] text-slate-600 font-medium">
                                {progressPhase === 'fetching_api'
                                    ? `Fetching page ${progressPage || 1} from Loyverse…`
                                    : 'Preparing sync…'}
                            </p>
                        ) : (
                            <p className="text-[11px] text-slate-600 font-medium leading-snug">
                                Branch {progressBranchId} · Page {progressPage} ·{' '}
                                <span className="font-bold text-brand-text">
                                    {processedInPage}/{receiptsThisPage}
                                </span>{' '}
                                receipts on this page ·{' '}
                                <span className="font-bold text-brand-text">{totalFetchedProg}</span> fetched total
                                {progressHasMore ? ' · more pages after this' : receiptsThisPage > 0 && processedInPage >= receiptsThisPage ? ' · finishing…' : ''}
                            </p>
                        )}
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                            Overall completion % is not available (Loyverse does not return total count). The bar shows this page only; it resets each new page.
                        </p>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                        <label className="text-xs font-bold text-brand-muted uppercase tracking-widest">Branch IDs</label>
                        <input
                            value={branchIds}
                            onChange={(e) => setBranchIds(e.target.value)}
                            disabled={running || isSelectedBranchSyncing}
                            inputMode="numeric"
                            className="mt-2 w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm font-medium text-brand-text outline-none focus:ring-2 focus:ring-brand-orange/20"
                            placeholder="e.g. 2,9"
                        />
                       
                    </div>
                    {!isSelectedBranchAutoSyncActive && (
                    <div className="col-span-2">
                        <label className="text-xs font-bold text-brand-muted uppercase tracking-widest">Date range</label>
                        <div className="relative mt-2">
                            <button
                                type="button"
                                onClick={() => setDateDropdownOpen((o) => !o)}
                                disabled={running || isSelectedBranchSyncing}
                                className={cn(
                                    "w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors",
                                    (running || isSelectedBranchSyncing)
                                        ? "bg-gray-50 border-gray-200 text-brand-muted cursor-not-allowed"
                                        : "bg-white border-gray-200 text-brand-text hover:bg-gray-50 cursor-pointer"
                                )}
                            >
                                <span className="truncate">
                                    {displayStartDate && displayEndDate ? `${displayStartDate} - ${displayEndDate}` : 'Select date range'}
                                </span>
                                <Calendar size={18} className="text-brand-muted shrink-0" />
                            </button>

                            {dateDropdownOpen && (
                                <>
                                    <div
                                        className="fixed inset-0 z-[80]"
                                        onClick={() => setDateDropdownOpen(false)}
                                        aria-hidden
                                    />
                                    <div className="absolute top-full left-0 mt-2 z-[90]">
                                        <DatePicker
                                            inline
                                            selectsRange
                                            startDate={pickerValue[0]}
                                            endDate={pickerValue[1]}
                                            openToDate={pickerValue[1] ?? pickerValue[0] ?? undefined}
                                            onChange={(update) => handleDateRangeChange(update, { closeOnComplete: true })}
                                            dateFormat="MMM d, yyyy"
                                            calendarClassName="react-datepicker-material"
                                            isClearable
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                    )}
                </div>

                {!isSelectedBranchAutoSyncActive && (
                <div className="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={runSyncRange}
                        disabled={running || isSelectedBranchSyncing}
                        className={cn(
                            "h-11 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2",
                            isSelectedBranchSyncing ? "col-span-1" : "col-span-2",
                            (running || isSelectedBranchSyncing) ? "bg-gray-100 text-brand-muted cursor-not-allowed" : "bg-brand-orange text-white hover:bg-brand-orange/90 cursor-pointer"
                        )}
                    >
                        {(running || isSelectedBranchSyncing)
                            ? <Loader2 size={16} className="animate-spin" />
                            : <RefreshCw size={16} />}
                        {(running || isSelectedBranchSyncing) ? t('system_settings.syncing') : t('system_settings.sync_now')}
                    </button>
                    {isSelectedBranchSyncing && (
                        <button
                            type="button"
                            onClick={stopSelectedBranchSync}
                            disabled={running && !rangeRunning}
                            className="col-span-1 h-11 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 bg-amber-600 text-white hover:bg-amber-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Stop sync
                        </button>
                    )}
                </div>
                )}

                {!isSelectedBranchAutoSyncActive && (
                    <div className="p-4 rounded-2xl border border-red-200 bg-red-50/90 space-y-2">
                        <p className="text-[10px] font-bold text-red-800 uppercase tracking-widest">Clean resync (match Loyverse)</p>
                        <p className="text-[11px] text-red-900/90 leading-relaxed">
                            Deletes Loyverse imports (<span className="font-mono text-[10px]">LOY-*</span> /{' '}
                            <span className="font-mono text-[10px]">LOY-R-*</span>) tied to this branch — including rows where billing is branch{' '}
                            <strong>X</strong> but the order row was saved under another branch id (fixes “empty orders but sales still show”).
                        </p>
                        <button
                            type="button"
                            onClick={purgeLoyverseImported}
                            disabled={running || isSelectedBranchSyncing || isSelectedBranchAutoSyncActive}
                            className="w-full py-2.5 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Delete Loyverse imports for this branch
                        </button>
                    </div>
                )}

                {!isSelectedBranchAutoSyncActive && lastResult && (
                    <div className="p-4 rounded-2xl border border-gray-100 bg-white">
                        <p className="text-xs font-bold text-brand-muted uppercase tracking-widest mb-2">Result</p>
                        <pre className="text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                            {JSON.stringify(lastResult, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════
// MAIN PANEL
// ═══════════════════════════════════════════════════════

type ViewState = 'main' | 'branch' | 'localization' | 'dashboard-layout' | 'data-sync' | 'mobile-app' | 'security-audit' | 'version-info';

type SystemSettingsPanelProps = {
    isOpen: boolean;
    onClose: () => void;
};

export const SystemSettingsPanel: React.FC<SystemSettingsPanelProps> = ({
    isOpen,
    onClose,
}) => {
    const [view, setView] = useState<ViewState>('main');
    const { t } = useTranslation();

    const handleClose = () => {
        onClose();
        setTimeout(() => setView('main'), 300);
    };

    const goBack = () => setView('main');

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={handleClose}
                        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
                    />

                    {/* Side Panel */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed top-0 right-0 h-full w-96 bg-white shadow-2xl z-[70] flex flex-col"
                    >
                        <AnimatePresence mode="wait">
                            {view === 'main' ? (
                                <motion.div
                                    key="main"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="flex flex-col h-full"
                                >
                                    {/* Header */}
                                    <div className="p-6 border-b border-gray-100">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-brand-orange/10 text-brand-orange rounded-xl flex items-center justify-center">
                                                    <Settings size={20} />
                                                </div>
                                                <h3 className="text-lg font-bold text-brand-text">{t('system_settings.title')}</h3>
                                            </div>
                                            <button
                                                onClick={handleClose}
                                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-brand-muted cursor-pointer"
                                            >
                                                <X size={20} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Scrollable Content */}
                                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
                                        <div className="px-4 py-2">
                                            <h5 className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">{t('system_settings.general')}</h5>
                                        </div>
                                        <SettingsItem
                                            icon={Store}
                                            label={t('system_settings.branch_management')}
                                            description={t('system_settings.branch_management_desc')}
                                            onClick={() => setView('branch')}
                                        />
                                        <SettingsItem
                                            icon={Globe}
                                            label={t('system_settings.localization')}
                                            description={t('system_settings.localization_desc')}
                                            onClick={() => setView('localization')}
                                        />
                                        <SettingsItem
                                            icon={Layout}
                                            label={t('system_settings.dashboard_layout')}
                                            description={t('system_settings.dashboard_layout_desc_short')}
                                            badge={t('system_settings.new')}
                                            onClick={() => setView('dashboard-layout')}
                                        />

                                        <div className="px-4 py-2 mt-4">
                                            <h5 className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">{t('system_settings.connect_sync')}</h5>
                                        </div>
                                        <SettingsItem
                                            icon={Smartphone}
                                            label={t('system_settings.mobile_app')}
                                            description={t('system_settings.mobile_app_desc')}
                                            onClick={() => setView('mobile-app')}
                                        />
                                        <SettingsItem
                                            icon={RefreshCw}
                                            label={t('system_settings.data_sync')}
                                            description={t('system_settings.data_sync_desc')}
                                            onClick={() => setView('data-sync')}
                                        />

                                        <div className="px-4 py-2 mt-4">
                                            <h5 className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">{t('system_settings.system_info')}</h5>
                                        </div>
                                        <SettingsItem
                                            icon={Shield}
                                            label={t('system_settings.security_audit')}
                                            description={t('system_settings.security_audit_desc')}
                                            onClick={() => setView('security-audit')}
                                        />
                                        <SettingsItem
                                            icon={Info}
                                            label={t('system_settings.version_info')}
                                            description="v1.0.0 — 3Core Dashboard"
                                            onClick={() => setView('version-info')}
                                        />
                                    </div>

                                    {/* Footer */}
                                    <div className="p-6 border-t border-gray-100">
                                        <div className="bg-brand-bg rounded-2xl p-4 border border-gray-100">
                                            <p className="text-xs text-brand-muted font-medium mb-3">
                                                {t('system_settings.system_health')}: <span className="text-green-600 font-bold uppercase tracking-wider ml-1">{t('system_settings.optimal')}</span>
                                            </p>
                                            <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
                                                <motion.div
                                                    initial={{ width: 0 }}
                                                    animate={{ width: '94%' }}
                                                    className="bg-green-500 h-full"
                                                />
                                            </div>
                                            <p className="mt-3 text-[10px] text-brand-muted leading-relaxed">
                                                {t('system_settings.last_update')}: Feb 26, 2026 at 11:00 AM
                                            </p>
                                        </div>
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key={view}
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="flex flex-col h-full"
                                >
                                    {view === 'branch' && <BranchManagementView onBack={goBack} t={t} />}
                                    {view === 'localization' && <LocalizationView onBack={goBack} t={t} />}
                                    {view === 'dashboard-layout' && <DashboardLayoutView onBack={goBack} t={t} />}
                                    {view === 'data-sync' && <DataSyncView onBack={goBack} t={t} />}
                                    {view === 'mobile-app' && <MobileAppView onBack={goBack} t={t} />}
                                    {view === 'security-audit' && <SecurityAuditView onBack={goBack} t={t} />}
                                    {view === 'version-info' && <VersionInfoView onBack={goBack} t={t} />}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
