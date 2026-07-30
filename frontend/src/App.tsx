import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Globe,
  Key,
  Database,
  ScrollText,
  RefreshCw,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  X,
  Info,
  ShieldCheck,
  MoreVertical,
  Server,
  Settings,
  UserCheck,
  Search,
  Sparkles,
  Play,
  Download
} from "lucide-react";

// API 响应基本接口
export interface ApiResponse {
  success: boolean;
  message?: string;
  error_code?: string;
}

// 域名接口
interface Domain {
  id: number;
  account_id: number;
  account_alias: string;
  subdomain: string;
  rootdomain: string;
  full_domain: string;
  status: string;
  created_at?: string;
  expires_at: string;
  last_renewed_at: string | null;
  has_dns?: number | boolean;
  ns1?: string;
  ns2?: string;
  disable_ns_management?: boolean;
}

// 账号接口
interface Account {
  id: number;
  alias: string;
  api_key: string;
  created_at: string;
}

// 配额接口
interface Quota {
  account_id: number;
  alias: string;
  used: number;
  base: number;
  invite_bonus: number;
  total: number;
  available: number;
  error?: string;
}

// DNS 解析记录接口
interface DnsRecord {
  id: number;
  record_id?: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  priority: number | null;
  line: string | null;
  proxied?: boolean;
}

// 日志接口
interface AppLog {
  id: number;
  type: "info" | "success" | "warning" | "error";
  category: "sync" | "renew" | "system";
  message: string;
  details: string | null;
  created_at: string;
}

/**
 * 主应用组件 - 提供 DNSHE 域名管理控制面板
 */
export default function App() {
  // 当前处于的选项卡：domains / accounts / register / quota / logs
  const [activeTab, setActiveTab] = useState<"domains" | "accounts" | "register" | "quota" | "logs">("domains");

  // 数据列表状态
  const [domains, setDomains] = useState<Domain[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [logs, setLogs] = useState<AppLog[]>([]);

  // 账号筛选、DNS 类型与下拉菜单状态
  const [selectedAccountFilter, setSelectedAccountFilter] = useState<string>("all");
  const [nsTypeFilter, setNsTypeFilter] = useState<"all" | "default" | "external">("all");
  const [openActionMenuId, setOpenActionMenuId] = useState<number | null>(null);

  // Loading 状态
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingQuotas, setLoadingQuotas] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Toast 提示状态
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // 绑定账号表单状态
  const [newAlias, setNewAlias] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newApiSecret, setNewApiSecret] = useState("");

  // 选中的域名与 DNS 记录管理模态框状态
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [loadingDns, setLoadingDns] = useState(false);
  const [dnsModalOpen, setDnsModalOpen] = useState(false);

  // NS 修改模态框状态
  const [nsModalOpen, setNsModalOpen] = useState(false);
  const [nsModalDomain, setNsModalDomain] = useState<Domain | null>(null);
  const [nsRecords, setNsRecords] = useState<DnsRecord[]>([]);
  const [loadingNsModal, setLoadingNsModal] = useState(false);
  const [newCustomNsContent, setNewCustomNsContent] = useState("");
  const [forceReplaceConflict, setForceReplaceConflict] = useState(true);

  // 新建 DNS 记录表单状态
  const [newDnsType, setNewDnsType] = useState("A");
  const [newDnsName, setNewDnsName] = useState("");
  const [newDnsContent, setNewDnsContent] = useState("");
  const [newDnsTtl, setNewDnsTtl] = useState(600);
  const [newDnsPriority, setNewDnsPriority] = useState<number>(10);
  const [newDnsLine, setNewDnsLine] = useState("");
  const [dnsFormOpen, setDnsFormOpen] = useState(false);

  // DNSHE 系统根域名 (支持动态添加)
  const DEFAULT_ROOT_DOMAINS = [
    "us.ci", "l.cd", "cc.cd", "cn.mt", "bot.cd", "de5.net", "ccwu.cc", "ddns.ge", "bbroot.com"
  ];

  const [allRootDomains, setAllRootDomains] = useState<string[]>(() => {
    const saved = localStorage.getItem("DNSHE_CUSTOM_ROOT_DOMAINS");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return DEFAULT_ROOT_DOMAINS;
  });
  const [newRootInput, setNewRootInput] = useState("");

  // 域名注册与查重状态
  const [searchSubdomain, setSearchSubdomain] = useState("");
  const [searchRootdomain, setSearchRootdomain] = useState("us.ci");
  const [whoisLoading, setWhoisLoading] = useState(false);
  const [whoisResult, setWhoisResult] = useState<{
    searchedDomain?: string;
    success?: boolean;
    registered?: boolean;
    status?: string;
    registered_at?: string;
    expires_at?: string;
    registrant_email?: string;
    nameservers?: string[];
    message?: string;
  } | null>(null);
  const [registerAccountId, setRegisterAccountId] = useState<number | "">("");

  // 规则多域名查重状态
  const [regMode, setRegMode] = useState<"single" | "batch">("single");
  const [batchRules, setBatchRules] = useState<string>("");
  const [excludeChars, setExcludeChars] = useState<string>("");
  const [selectedRoots, setSelectedRoots] = useState<string[]>([]);
  const [batchLength, setBatchLength] = useState<number>(2);
  const [scanStatus, setScanStatus] = useState<"idle" | "running" | "paused" | "completed">("idle");
  const scanControlRef = useRef<"idle" | "running" | "paused" | "completed">("idle");
  
  const updateScanStatus = (status: "idle" | "running" | "paused" | "completed") => {
    scanControlRef.current = status;
    setScanStatus(status);
  };
  const [scanProgress, setScanProgress] = useState<{ total: number; checked: number; available: number }>({ total: 0, checked: 0, available: 0 });
  const [availableDomainsList, setAvailableDomainsList] = useState<Array<{ fullDomain: string; subdomain: string; rootdomain: string; time: string }>>([]);
  const [scanLogs, setScanLogs] = useState<Array<{ id: number; time: string; text: string; status: "available" | "registered" | "error" }>>([]);

  // 管理员访问口令 (ADMIN_TOKEN) 与后端 Worker 地址状态
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [inputAuthToken, setInputAuthToken] = useState(localStorage.getItem("DNSHE_ADMIN_TOKEN") || "");
  const [backendUrl, setBackendUrl] = useState(localStorage.getItem("DNSHE_BACKEND_URL") || (import.meta as any).env?.VITE_API_BASE_URL || "");

  /**
   * 统一 API 请求封装 — 自动注入 Authorization 头部与后端 Worker 基准域名
   */
  const apiFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const token = localStorage.getItem("DNSHE_ADMIN_TOKEN");
    const storedBackend = localStorage.getItem("DNSHE_BACKEND_URL") || (import.meta as any).env?.VITE_API_BASE_URL || "";
    
    // 如果传入相对路径以 /api 开头，根据部署环境自动补全后端基准域名
    let finalUrl = url;
    if (url.startsWith("/api")) {
      if (storedBackend) {
        finalUrl = `${storedBackend.replace(/\/$/, "")}${url}`;
      } else if (window.location.hostname.endsWith(".pages.dev")) {
        // 当部署在 Pages 时，自动尝试拼装默认 Worker 后端地址
        const workerHost = window.location.hostname.replace("dnshe-manager-frontend.pages.dev", "dnshe-manager-backend.yinjiagang1-d4a.workers.dev");
        finalUrl = `https://${workerHost}${url}`;
      }
    }

    const headers = new Headers(options.headers || {});
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    try {
      const res = await fetch(finalUrl, { ...options, headers });
      if (res.status === 401 || res.status === 403) {
        setAuthModalOpen(true);
      }
      return res;
    } catch (err) {
      // 遇网络连接异常自动提示配置后端服务
      console.error("API Fetch Error:", err);
      throw err;
    }
  };

  // 保存/更新管理口令与后端服务地址
  const handleSaveAuthToken = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (inputAuthToken.trim()) {
      localStorage.setItem("DNSHE_ADMIN_TOKEN", inputAuthToken.trim());
    } else {
      localStorage.removeItem("DNSHE_ADMIN_TOKEN");
    }

    if (backendUrl.trim()) {
      localStorage.setItem("DNSHE_BACKEND_URL", backendUrl.trim().replace(/\/$/, ""));
    } else {
      localStorage.removeItem("DNSHE_BACKEND_URL");
    }

    showToast("success", "配置保存成功！正在重新加载数据...");
    setAuthModalOpen(false);
    fetchDomains();
    fetchAccounts();
  };

  // 自动淡出 Toast 提示
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // 点击外部关闭三点弹出菜单
  useEffect(() => {
    const handleClickOutside = () => setOpenActionMenuId(null);
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  // 显示 Toast 辅助函数
  const showToast = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
  };

  // 日期格式化辅助函数：转换为 YYYY/MM/DD（到期时间支持“永久”）
  const formatDate = (dateStr?: string | null, isExpiration = false) => {
    if (!dateStr || dateStr.startsWith("0000")) {
      return isExpiration ? "永久" : "未记录";
    }
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return isExpiration ? "永久" : dateStr;
    }
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}/${m}/${d}`;
  };

  // 判断域名是否使用默认 NS（ns1.dnshe.com/ns2.dnshe.com）并允许在线 DNS 管理
  const checkHasDns = (dom: Domain) => {
    if (dom.disable_ns_management) return false;
    if (dom.ns1 || dom.ns2) {
      const ns1 = (dom.ns1 || "").toLowerCase();
      const ns2 = (dom.ns2 || "").toLowerCase();
      if (!ns1.includes("dnshe.com") && !ns2.includes("dnshe.com")) return false;
    }
    if (dom.has_dns !== undefined && dom.has_dns !== null) {
      return Number(dom.has_dns) !== 0;
    }
    return true;
  };

  // 渲染域名三态徽章：未解析 / 已解析 / 已委派
  const renderStatusBadge = (dom: Domain) => {
    let statusText = dom.status;
    const isDelegated = Number(dom.has_dns) === 0 || dom.status === "已委派";
    
    if (isDelegated) {
      statusText = "已委派";
    } else if (dom.status === "Registered" || dom.status === "active" || dom.status === "已解析") {
      statusText = "已解析";
    } else if (dom.status === "未解析") {
      statusText = "未解析";
    }

    if (statusText === "已委派") {
      return (
        <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-sky-950/80 text-sky-300 border border-sky-800/60">
          已委派
        </span>
      );
    }
    if (statusText === "已解析") {
      return (
        <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-900/60">
          已解析
        </span>
      );
    }
    return (
      <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-slate-800/80 text-slate-400 border border-slate-700/60">
        未解析
      </span>
    );
  };

  // 渲染单个域名卡片
  const renderDomainCard = (dom: Domain) => (
    <div 
      key={dom.id} 
      className="bg-dark-900 border border-dark-800 hover:border-dark-700 rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 shadow-xl"
    >
      {/* 顶部：域名名称与状态 */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-base font-bold text-white tracking-wide truncate" title={dom.full_domain}>
          {dom.full_domain}
        </span>
        {renderStatusBadge(dom)}
      </div>

      {/* 中间：注册时间与到期时间 */}
      <div className="mt-4 space-y-2 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-slate-400 font-medium">注册时间</span>
          <span className="font-mono text-slate-200">{formatDate(dom.created_at, false)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-400 font-medium">到期时间</span>
          <span className="font-mono text-slate-200">{formatDate(dom.expires_at, true)}</span>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="border-t border-dark-800/80 my-3.5" />

      {/* 当前 DNS 服务器 */}
      <div className="flex justify-between items-center text-xs">
        <span className="text-slate-400 font-medium">当前 DNS 服务器</span>
        {checkHasDns(dom) ? (
          <span className="bg-slate-800/80 text-slate-200 border border-slate-700/60 text-xs font-medium px-2.5 py-0.5 rounded-md">
            系统默认
          </span>
        ) : (
          <span className="bg-sky-950/80 text-sky-300 border border-sky-800/60 text-xs font-medium px-2.5 py-0.5 rounded-md">
            外部 DNS
          </span>
        )}
      </div>

      {/* 分隔线 */}
      <div className="border-t border-dark-800/80 my-3.5" />

      {/* 底部：DNS 按钮与更多三点下拉菜单 */}
      <div className="flex items-center justify-end gap-3 relative">
        <button
          onClick={() => handleOpenDnsModal(dom)}
          disabled={!checkHasDns(dom)}
          className={`text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition-all shadow-inner ${
            checkHasDns(dom)
              ? "bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
              : "bg-slate-800/50 text-slate-500 opacity-50 cursor-not-allowed"
          }`}
        >
          <Settings className={`w-3.5 h-3.5 ${checkHasDns(dom) ? "text-slate-400" : "text-slate-600"}`} /> DNS
        </button>

        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenActionMenuId(openActionMenuId === dom.id ? null : dom.id);
            }}
            className="p-2 hover:bg-dark-800 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {/* 三点下拉操作菜单 */}
          {openActionMenuId === dom.id && (
            <div 
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 bottom-10 z-30 w-40 bg-dark-950 border border-dark-800 rounded-xl shadow-2xl overflow-hidden text-xs py-1 animate-in fade-in zoom-in-95"
            >
              <button
                onClick={() => {
                  setOpenActionMenuId(null);
                  handleOpenNsModal(dom);
                }}
                className="w-full text-left px-3.5 py-2.5 hover:bg-dark-900 text-slate-300 hover:text-white flex items-center gap-2"
              >
                <Server className="w-3.5 h-3.5 text-slate-400" /> 修改 NS 记录
              </button>
              
              <button
                onClick={() => {
                  setOpenActionMenuId(null);
                  handleRenewDomain(dom);
                }}
                disabled={actionLoading === `renew-${dom.id}`}
                className="w-full text-left px-3.5 py-2.5 hover:bg-dark-900 text-slate-300 hover:text-white flex items-center gap-2 border-t border-dark-850"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${actionLoading === `renew-${dom.id}` ? "animate-spin" : ""}`} />
                续期域名
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // 1. 获取所有域名列表（支持按账号筛选）
  const fetchDomains = async (accountIdFilter?: string) => {
    setLoadingDomains(true);
    try {
      const targetAcc = accountIdFilter ?? selectedAccountFilter;
      const accParam = targetAcc && targetAcc !== "all" ? `&account_id=${targetAcc}` : "";
      const res = await apiFetch(`/api/domains?${accParam}`);
      const data = await res.json();
      if (data.success) {
        setDomains(data.domains || []);
      } else {
        showToast("error", data.message || "拉取域名列表失败");
      }
    } catch (e) {
      showToast("error", "网络连接异常，无法获取域名列表");
    } finally {
      setLoadingDomains(false);
    }
  };

  // 2. 获取账号列表
  const fetchAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const res = await apiFetch("/api/accounts");
      const data = await res.json();
      if (data.success) {
        setAccounts(data.accounts || []);
      }
    } catch (e) {
      showToast("error", "获取账号列表失败");
    } finally {
      setLoadingAccounts(false);
    }
  };

  // 3. 获取配额列表
  const fetchQuotas = async () => {
    setLoadingQuotas(true);
    try {
      const res = await apiFetch("/api/quota");
      const data = await res.json();
      if (data.success) {
        setQuotas(data.quotas || []);
      }
    } catch (e) {
      showToast("error", "获取账户配额失败");
    } finally {
      setLoadingQuotas(false);
    }
  };

  // 4. 获取日志列表
  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await apiFetch("/api/logs");
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs || []);
      }
    } catch (e) {
      showToast("error", "获取系统运行日志失败");
    } finally {
      setLoadingLogs(false);
    }
  };

  // 根据当前 ActiveTab 初始化拉取数据
  useEffect(() => {
    fetchAccounts();
    if (activeTab === "domains") {
      fetchDomains();
    } else if (activeTab === "accounts") {
      fetchAccounts();
    } else if (activeTab === "quota") {
      fetchQuotas();
    } else if (activeTab === "logs") {
      fetchLogs();
    }
  }, [activeTab]);

  // 按账号分组处理域名列表
  const groupedDomains = useMemo(() => {
    const map = new Map<string, { alias: string; accountId: number; domains: Domain[] }>();
    domains.forEach((dom) => {
      const key = String(dom.account_id || 0);
      if (!map.has(key)) {
        map.set(key, {
          alias: dom.account_alias || `账号 ${dom.account_id}`,
          accountId: dom.account_id,
          domains: []
        });
      }
      map.get(key)!.domains.push(dom);
    });
    return Array.from(map.values());
  }, [domains]);

  // 立即发起域名同步
  const handleSyncDomains = async () => {
    setActionLoading("sync");
    try {
      const res = await apiFetch("/api/domains/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast("success", data.message || "同步域名任务已成功在后台启动");
        setTimeout(() => fetchDomains(), 5000);
      } else {
        showToast("error", data.message || "启动同步域名任务失败");
      }
    } catch (e) {
      showToast("error", "发起域名同步网络请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 绑定新账号
  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlias.trim() || !newApiKey.trim() || !newApiSecret.trim()) {
      showToast("error", "所有字段均为必填项！");
      return;
    }
    setActionLoading("add-account");
    try {
      const res = await apiFetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias: newAlias,
          api_key: newApiKey,
          api_secret: newApiSecret
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", `账号 [${newAlias}] 验证并绑定成功！`);
        setNewAlias("");
        setNewApiKey("");
        setNewApiSecret("");
        fetchAccounts();
        fetchDomains();
      } else {
        showToast("error", data.message || "账号绑定失败，请检查密钥是否正确");
      }
    } catch (err) {
      showToast("error", "绑定请求发送失败，请检查网络");
    } finally {
      setActionLoading(null);
    }
  };

  // 解绑账号
  const handleDeleteAccount = async (id: number) => {
    if (!confirm("确定要解绑该账号吗？这会同步清除该账号缓存的域名及解析日志！")) return;
    setActionLoading(`delete-account-${id}`);
    try {
      const res = await apiFetch(`/api/accounts/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showToast("success", "账户解绑成功");
        fetchAccounts();
        fetchDomains();
      } else {
        showToast("error", data.message || "账户解绑失败");
      }
    } catch (e) {
      showToast("error", "解绑请求发送失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 手动续期子域名
  const handleRenewDomain = async (domain: Domain) => {
    setActionLoading(`renew-${domain.id}`);
    try {
      const res = await apiFetch(`/api/domains/${domain.id}/renew`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast("success", `域名 [${domain.full_domain}] 手动续期成功！新有效期至 ${data.new_expires_at}`);
        fetchDomains();
      } else {
        showToast("error", data.message || "续期请求被拦截或失败，请检查是否处于续期窗口");
      }
    } catch (e) {
      showToast("error", "续期网络请求发生异常");
    } finally {
      setActionLoading(null);
    }
  };

  // 打开 NS 管理模态框
  const handleOpenNsModal = async (domain: Domain) => {
    setNsModalDomain(domain);
    setNsModalOpen(true);
    setLoadingNsModal(true);
    setNsRecords([]);
    setNewCustomNsContent("");

    try {
      const res = await apiFetch(`/api/domains/${domain.id}/dns`);
      const data = await res.json();
      if (data.success) {
        const nsOnly = (data.records || []).filter((r: DnsRecord) => r.type === "NS");
        setNsRecords(nsOnly);
      } else {
        showToast("error", data.message || "获取 NS 记录失败");
      }
    } catch (e) {
      showToast("error", "获取 NS 记录网络异常");
    } finally {
      setLoadingNsModal(false);
    }
  };

  // 一键恢复为系统默认 NS (删除所有第三方 custom NS 记录)
  const handleResetToDefaultNs = async () => {
    if (!nsModalDomain) return;
    if (!confirm(`确定要将域名 [${nsModalDomain.full_domain}] 恢复为系统默认 NS 吗？这会清除当前配置的第三方 NS 记录。`)) return;

    setActionLoading("reset-ns");
    try {
      for (const rec of nsRecords) {
        await apiFetch(`/api/domains/${nsModalDomain.id}/dns/${rec.id ?? rec.record_id}`, {
          method: "DELETE"
        });
      }
      showToast("success", `域名 [${nsModalDomain.full_domain}] 已成功恢复为系统默认 NS！`);
      setNsModalOpen(false);
      handleSyncDomains();
    } catch (e) {
      showToast("error", "恢复系统默认 NS 发生异常");
    } finally {
      setActionLoading(null);
    }
  };

  // 添加自定义 NS 记录 (支持自动清理与 NS 冲突的同名记录)
  const handleAddCustomNs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nsModalDomain || !newCustomNsContent.trim()) return;

    setActionLoading("add-ns");
    try {
      if (forceReplaceConflict) {
        // 1. 先查询当前域名的已有解析记录
        const res = await apiFetch(`/api/domains/${nsModalDomain.id}/dns`);
        const data = await res.json();
        if (data.success && Array.isArray(data.records)) {
          // 2. 筛选出非 NS 类型的冲突记录 (如 A, CNAME, TXT, MX 等)
          const conflicts = data.records.filter((r: DnsRecord) => r.type !== "NS");
          for (const conf of conflicts) {
            await apiFetch(`/api/domains/${nsModalDomain.id}/dns/${conf.id ?? conf.record_id}`, {
              method: "DELETE"
            });
          }
        }
      }

      // 3. 创建新的第三方 NS 记录
      const res = await apiFetch(`/api/domains/${nsModalDomain.id}/dns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "NS",
          name: "@",
          content: newCustomNsContent.trim(),
          ttl: 86400
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", `NS 记录 [${newCustomNsContent}] 添加成功！`);
        setNewCustomNsContent("");
        handleOpenNsModal(nsModalDomain);
        handleSyncDomains();
      } else {
        // NOTE: 区分 NS 管理被上游禁用 vs 其他错误
        const isNsDisabled = data.error_code === "ns_management_disabled";
        showToast("error", isNsDisabled
          ? "DNSHE 上游平台已禁用 NS 管理，无法通过 API 修改 NS 记录。请前往 DNSHE 官网后台手动设置。"
          : (data.message || "添加 NS 记录失败，请勾选【强制替换冲突记录】"));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "添加 NS 记录发生异常";
      showToast("error", msg);
    } finally {
      setActionLoading(null);
    }
  };

  // 打开 DNS 管理面板
  const handleOpenDnsModal = async (domain: Domain) => {
    setSelectedDomain(domain);
    setDnsModalOpen(true);
    setLoadingDns(true);
    setDnsRecords([]);
    setDnsFormOpen(false);
    
    // 初始化表单字段
    setNewDnsName("");
    setNewDnsContent("");
    setNewDnsType("A");
    setNewDnsTtl(600);
    setNewDnsPriority(10);
    setNewDnsLine("");

    try {
      const res = await apiFetch(`/api/domains/${domain.id}/dns`);
      const data = await res.json();
      if (data.success) {
        setDnsRecords(data.records || []);
      } else {
        showToast("error", data.message || "加载 DNS 解析记录失败");
      }
    } catch (e) {
      showToast("error", "加载 DNS 记录发生网络异常");
    } finally {
      setLoadingDns(false);
    }
  };

  // 创建新 DNS 记录
  const handleCreateDnsRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDomain) return;
    if (!newDnsContent.trim()) {
      showToast("error", "解析记录值不能为空！");
      return;
    }

    setActionLoading("create-dns");
    try {
      const res = await apiFetch(`/api/domains/${selectedDomain.id}/dns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newDnsType,
          name: newDnsName || "@",
          content: newDnsContent,
          ttl: newDnsTtl,
          priority: newDnsType === "MX" || newDnsType === "SRV" ? newDnsPriority : undefined,
          line: newDnsLine || undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", "DNS 解析记录创建成功！");
        setNewDnsName("");
        setNewDnsContent("");
        setDnsFormOpen(false);
        handleOpenDnsModal(selectedDomain);
        fetchDomains();
      } else {
        showToast("error", data.message || "创建解析记录失败");
      }
    } catch (err) {
      showToast("error", "创建解析记录请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 删除 DNS 记录
  const handleDeleteDnsRecord = async (recordId: string | number) => {
    if (!selectedDomain) return;
    if (!confirm("确定要删除这条 DNS 解析记录吗？这会立即影响该域名的解析！")) return;
    
    setActionLoading(`delete-dns-${recordId}`);
    try {
      const res = await apiFetch(`/api/domains/${selectedDomain.id}/dns/${recordId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", "DNS 解析记录删除成功！");
        handleOpenDnsModal(selectedDomain);
        fetchDomains();
      } else {
        showToast("error", data.message || "删除解析记录失败");
      }
    } catch (e) {
      showToast("error", "删除解析记录请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 清除运行日志
  const handleClearLogs = async () => {
    if (!confirm("确定要清空所有的运行日志吗？")) return;
    setActionLoading("clear-logs");
    try {
      const res = await apiFetch("/api/logs/clear", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast("success", "系统日志已成功清空");
        fetchLogs();
      } else {
        showToast("error", data.message || "清空日志失败");
      }
    } catch (e) {
      showToast("error", "清空日志网络请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 执行 WHOIS 域名查重
  const handleCheckWhois = async (
    e?: React.FormEvent,
    overrideSub?: string,
    overrideRoot?: string
  ) => {
    if (e) e.preventDefault();
    const sub = (overrideSub !== undefined ? overrideSub : searchSubdomain).trim().toLowerCase();
    const root = (overrideRoot !== undefined ? overrideRoot : searchRootdomain).trim().toLowerCase();

    if (!sub) {
      showToast("error", "请输入想要查询的子域名前缀！");
      return;
    }

    const fullTargetDomain = `${sub}.${root}`;
    setWhoisLoading(true);

    try {
      const res = await apiFetch(`/api/whois?domain=${encodeURIComponent(fullTargetDomain)}`);
      const data = await res.json();
      if (data.success && data.whois) {
        setWhoisResult({
          searchedDomain: fullTargetDomain,
          ...data.whois
        });
        if (accounts.length > 0 && !registerAccountId) {
          setRegisterAccountId(accounts[0].id);
        }
      } else {
        showToast("error", data.message || "WHOIS 查询失败");
      }
    } catch (err) {
      showToast("error", "WHOIS 查询请求失败，请检查网络连接");
    } finally {
      setWhoisLoading(false);
    }
  };

  // 提交在线注册免费域名
  const handleRegisterSubdomain = async () => {
    const sub = searchSubdomain.trim().toLowerCase();
    const root = searchRootdomain.trim().toLowerCase();
    if (!sub || !root) return;
    if (!registerAccountId) {
      showToast("error", "请先选择用于注册域名的 API 账号！");
      return;
    }

    setActionLoading("register-subdomain");
    try {
      const res = await apiFetch("/api/domains/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: registerAccountId,
          subdomain: sub,
          rootdomain: root
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", `🎉 域名 [${data.full_domain || sub + "." + root}] 注册成功！`);
        setWhoisResult(null);
        setSearchSubdomain("");
        fetchDomains();
        setActiveTab("domains");
      } else {
        showToast("error", data.message || "注册子域名失败，请重试");
      }
    } catch (err) {
      showToast("error", "注册请求失败，请重试");
    } finally {
      setActionLoading(null);
    }
  };

  // 添加与删除自定义根域名 handler
  const handleAddCustomRootDomain = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanRoot = newRootInput.trim().toLowerCase().replace(/^\./, "");
    if (!cleanRoot) return;
    if (allRootDomains.includes(cleanRoot)) {
      showToast("error", `根域名 [.${cleanRoot}] 已在列表中！`);
      return;
    }
    const updated = [...allRootDomains, cleanRoot];
    setAllRootDomains(updated);
    setSelectedRoots(prev => Array.from(new Set([...prev, cleanRoot])));
    localStorage.setItem("DNSHE_CUSTOM_ROOT_DOMAINS", JSON.stringify(updated));
    setNewRootInput("");
    showToast("success", `成功追加根域名 [.${cleanRoot}]！`);
  };

  const handleRemoveCustomRootDomain = (rootToRemove: string) => {
    const updated = allRootDomains.filter(r => r !== rootToRemove);
    setAllRootDomains(updated);
    setSelectedRoots(prev => prev.filter(r => r !== rootToRemove));
    localStorage.setItem("DNSHE_CUSTOM_ROOT_DOMAINS", JSON.stringify(updated));
    showToast("info", `已移除根域名 [.${rootToRemove}]`);
  };

  // 批量词库与自定义前缀生成器
  const generatePrefixesFromRule = (rule: string, len: number, exclude: string): string[] => {
    const consonants = "bcdfghjklmnpqrstvwxyz";
    const vowels = "aeiou";
    const digits = "0123456789";
    const digitsNo04 = "12356789";
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const pinyin2 = ["ba","pa","ma","fa","da","ta","na","la","ga","ka","ha","ji","qi","xi","zha","cha","sha","za","ca","sa","bo","po","mo","fo","de","te","ne","le","ge","ke","he","ji","qu","xu","zu","cu","su","ya","ye","wa","wo","er","an","en","ou"];

    const shortcutTags = ["字母", "数字", "数字无04", "声母", "韵母", "2位拼音", "双拼", "2位豹子", "3位豹子", "CVCV"];
    const hasShortcutTag = shortcutTags.some(tag => rule.includes(tag));

    // 当输入不包含快捷标签时，视为自定义具体前缀（支持逗号、空格、分号或换行分隔多个前缀）
    if (!hasShortcutTag && rule.trim()) {
      const rawCustoms = rule.trim().split(/[,;\s\n]+/);
      let customs = rawCustoms.map(s => s.trim().toLowerCase()).filter(Boolean);

      if (exclude) {
        const exSet = new Set(exclude.split(""));
        customs = customs.filter(sub => !sub.split("").some(c => exSet.has(c)));
      }

      return Array.from(new Set(customs));
    }

    let charPool: string[] = [];

    if (rule.includes("字母")) charPool.push(...letters.split(""));
    if (rule.includes("数字无04")) charPool.push(...digitsNo04.split(""));
    else if (rule.includes("数字")) charPool.push(...digits.split(""));
    if (rule.includes("声母")) charPool.push(...consonants.split(""));
    if (rule.includes("韵母")) charPool.push(...vowels.split(""));

    charPool = Array.from(new Set(charPool));

    if (exclude) {
      const exSet = new Set(exclude.split(""));
      charPool = charPool.filter(c => !exSet.has(c));
    }

    if (charPool.length === 0) {
      charPool = letters.split("").filter(c => !exclude.includes(c));
    }

    let results: string[] = [];
    if (rule.includes("2位拼音") || rule.includes("双拼")) {
      results = pinyin2.slice(0, 40);
    } else if (rule.includes("豹子")) {
      results = charPool.map(c => c.repeat(len));
    } else if (rule.includes("CVCV")) {
      const cList = consonants.split("").filter(c => !exclude.includes(c));
      const vList = vowels.split("").filter(c => !exclude.includes(c));
      for (const c1 of cList.slice(0, 6)) {
        for (const v1 of vList.slice(0, 4)) {
          results.push(`${c1}${v1}${c1}${v1}`);
        }
      }
    } else {
      const recursiveGen = (current: string, currentLen: number) => {
        if (currentLen === len) {
          results.push(current);
          return;
        }
        for (const char of charPool) {
          if (results.length >= 80) break;
          recursiveGen(current + char, currentLen + 1);
        }
      };
      recursiveGen("", 0);
    }

    return Array.from(new Set(results));
  };

  // 执行批量扫域名引擎
  const handleStartBatchScan = async () => {
    if (scanControlRef.current === "paused") {
      updateScanStatus("running");
      showToast("info", "▶️ 已恢复批量扫描任务！");
      return;
    }

    if (selectedRoots.length === 0) {
      showToast("error", "请至少勾选一个根域名后缀！");
      return;
    }

    const prefixes = generatePrefixesFromRule(batchRules, batchLength, excludeChars);
    if (prefixes.length === 0) {
      showToast("error", "根据当前规则未能生成有效的前缀词库，请修改规则！");
      return;
    }

    const totalTasks: Array<{ sub: string; root: string; full: string }> = [];
    for (const sub of prefixes) {
      for (const root of selectedRoots) {
        totalTasks.push({ sub, root, full: `${sub}.${root}` });
      }
    }

    // 多账号 API 轮询与动态限频计算：
    // 每个 API 独立保证 1.2s (1200ms) 规程，N 个账号使得整体调度间隔为 1200ms / N（最低底线 100ms）
    const accountCount = Math.max(1, accounts.length);
    const delayMs = Math.max(100, Math.floor(1200 / accountCount));

    updateScanStatus("running");
    setScanProgress({ total: totalTasks.length, checked: 0, available: availableDomainsList.length });
    showToast(
      "info",
      `🚀 开始多账号轮询查重！绑定 ${accountCount} 个 API 账号，全局调度间隔 ${delayMs}ms（每个 API 独立保障 1.2s 限频），查重速度提升 ${accountCount} 倍！`
    );

    for (let i = 0; i < totalTasks.length; i++) {
      // 检查停止或重置状态
      if ((scanControlRef.current as string) === "idle") {
        showToast("info", "查重任务已终止");
        return;
      }

      // 检查暂停状态：挂起循环直到解冻或停止
      while ((scanControlRef.current as string) === "paused") {
        await new Promise((r) => setTimeout(r, 300));
        if ((scanControlRef.current as string) === "idle") {
          showToast("info", "查重任务已终止");
          return;
        }
      }

      const task = totalTasks[i];
      // 轮询选取当前账号
      const currentAccount = accounts.length > 0 ? accounts[i % accounts.length] : null;
      const accountQuery = currentAccount ? `&account_id=${currentAccount.id}` : "";
      const nowTime = new Date().toLocaleTimeString();
      const accAlias = currentAccount ? currentAccount.alias : "公共轮询";

      try {
        const res = await apiFetch(`/api/whois?domain=${encodeURIComponent(task.full)}${accountQuery}`);
        const data = await res.json();
        
        if (data.success && data.whois && data.whois.registered === false) {
          setAvailableDomainsList(prev => [
            { fullDomain: task.full, subdomain: task.sub, rootdomain: task.root, time: nowTime },
            ...prev
          ]);
          setScanProgress(p => ({ ...p, checked: i + 1, available: p.available + 1 }));
          setScanLogs(prev => [
            { id: Date.now() + Math.random(), time: nowTime, text: `[${accAlias}] 校验域名 ${task.full} ➔ 🎉 尚未注册（可立即在线注册！）`, status: "available" },
            ...prev.slice(0, 49)
          ]);
        } else {
          setScanProgress(p => ({ ...p, checked: i + 1 }));
          setScanLogs(prev => [
            { id: Date.now() + Math.random(), time: nowTime, text: `[${accAlias}] 校验域名 ${task.full} ➔ 已被他人注册`, status: "registered" },
            ...prev.slice(0, 49)
          ]);
        }
      } catch (err) {
        setScanProgress(p => ({ ...p, checked: i + 1 }));
        setScanLogs(prev => [
          { id: Date.now() + Math.random(), time: nowTime, text: `[${accAlias}] 校验域名 ${task.full} ➔ ⚠️ 查询请求异常，已跳过`, status: "error" },
          ...prev.slice(0, 49)
        ]);
      }

      // 根据账号数量按比例自动缩短全局轮询休眠间隔
      await new Promise(r => setTimeout(r, delayMs));
    }

    if (scanControlRef.current === "running") {
      updateScanStatus("completed");
      showToast("success", "🎉 所有生成的域名字典查询完毕！");
    }
  };

  // 导出生成的 txt 结果
  const handleExportAvailableTxt = () => {
    if (availableDomainsList.length === 0) {
      showToast("info", "暂无已发现的可用域名供导出！");
      return;
    }

    const content = availableDomainsList.map(item => item.fullDomain).join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `available_domains_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("success", "已成功导出可用域名 txt 文本！");
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      
      {/* 头部面板 */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8 pb-6 border-b border-dark-800">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-2">
            <Globe className="text-indigo-500 w-8 h-8" /> DNSHE 多账号集控面板
          </h1>
          <p className="text-slate-400 mt-1">
            提供免费域名资产监控、DNS 解析托管及全自动到期续期平台
          </p>
        </div>
        <div className="flex items-center gap-3">
          {activeTab === "domains" && (
            <button
              onClick={handleSyncDomains}
              disabled={actionLoading === "sync" || loadingDomains}
              className="btn-primary px-4 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${actionLoading === "sync" ? "animate-spin" : ""}`} />
              同步所有账号
            </button>
          )}
          <button
            onClick={() => setAuthModalOpen(true)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-3.5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all"
            title="配置管理访问口令 (ADMIN_TOKEN)"
          >
            <Key className="w-4 h-4 text-amber-400" />
            <span>{localStorage.getItem("DNSHE_ADMIN_TOKEN") ? "已锁屏鉴权" : "设置口令"}</span>
          </button>
        </div>
      </header>

      {/* Tabs 切换菜单 */}
      <div className="flex border-b border-dark-800 mb-8 overflow-x-auto gap-2">
        <button
          onClick={() => setActiveTab("domains")}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all duration-200 whitespace-nowrap ${
            activeTab === "domains"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Globe className="w-4 h-4" /> 域名列表 ({domains.length})
        </button>
        <button
          onClick={() => setActiveTab("accounts")}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all duration-200 whitespace-nowrap ${
            activeTab === "accounts"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Key className="w-4 h-4" /> 账号管理 ({accounts.length})
        </button>
        <button
          onClick={() => setActiveTab("register")}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all duration-200 whitespace-nowrap ${
            activeTab === "register"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Plus className="w-4 h-4" /> 域名注册 / 查重
        </button>
        <button
          onClick={() => setActiveTab("quota")}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all duration-200 whitespace-nowrap ${
            activeTab === "quota"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Database className="w-4 h-4" /> 账户配额
        </button>
        <button
          onClick={() => setActiveTab("logs")}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all duration-200 whitespace-nowrap ${
            activeTab === "logs"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <ScrollText className="w-4 h-4" /> 运行日志
        </button>
      </div>

      {/* 主面板内容 */}
      <main>

        {/* Tab 5: 域名注册与查重 */}
        {activeTab === "register" && (
          <div className="space-y-6 max-w-5xl mx-auto">
            
            {/* 模式选择导航 */}
            <div className="flex bg-dark-900 p-1.5 rounded-2xl border border-dark-800 gap-2">
              <button
                onClick={() => setRegMode("single")}
                className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${
                  regMode === "single"
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                    : "text-slate-400 hover:text-slate-200 hover:bg-dark-850"
                }`}
              >
                <Search className="w-4 h-4" /> 精准单域名查重
              </button>
              <button
                onClick={() => setRegMode("batch")}
                className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${
                  regMode === "batch"
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                    : "text-slate-400 hover:text-slate-200 hover:bg-dark-850"
                }`}
              >
                <Sparkles className="w-4 h-4 text-amber-400" /> 规则多域名查重
              </button>
            </div>

            {/* 模式 A: 精准单域名查重卡片 */}
            {regMode === "single" && (
              <div className="space-y-6">
                {/* 1. 单域名 WHOIS 查重表单卡片 */}
                <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xl space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Search className="w-5 h-5 text-indigo-400" /> 单精准域名 WHOIS 查重与注册
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      输入您心仪的二级前缀，选择 9 大免费根域名之一，实时检测域名注册状态及 WHOIS 到期详细信息。
                    </p>
                  </div>

                  <form onSubmit={handleCheckWhois} className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
                    <div className="sm:col-span-6 space-y-2">
                      <label className="block text-xs font-semibold text-slate-300">
                        二级域名前缀:
                      </label>
                      <input
                        type="text"
                        placeholder="例如: myapp"
                        value={searchSubdomain}
                        onChange={(e) => setSearchSubdomain(e.target.value)}
                        className="w-full bg-dark-950 border border-dark-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-3 space-y-2">
                      <label className="block text-xs font-semibold text-slate-300">
                        根域名后缀:
                      </label>
                      <select
                        value={searchRootdomain}
                        onChange={(e) => setSearchRootdomain(e.target.value)}
                        className="w-full bg-dark-950 border border-dark-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white focus:outline-none"
                      >
                        {allRootDomains.map((rd) => (
                          <option key={rd} value={rd}>
                            .{rd}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-3">
                      <button
                        type="submit"
                        disabled={whoisLoading}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm px-6 py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <Search className={`w-4 h-4 ${whoisLoading ? "animate-spin" : ""}`} />
                        {whoisLoading ? "正在查询..." : "WHOIS 查重"}
                      </button>
                    </div>
                  </form>
                </div>

                {/* 2. WHOIS 查询结果展示 */}
                {whoisResult && (
                  <div>
                    {!whoisResult.registered ? (
                      /* 未注册：绿色可注册卡片 */
                      <div className="bg-dark-900 border border-emerald-500/30 rounded-2xl p-6 shadow-xl space-y-4">
                        <div className="flex items-center justify-between border-b border-dark-800 pb-4">
                          <div>
                            <span className="inline-block bg-emerald-500/20 text-emerald-400 text-xs font-bold px-2.5 py-1 rounded-full mb-1">
                              尚未注册
                            </span>
                            <h4 className="text-xl font-bold text-white">
                              {whoisResult.searchedDomain}
                            </h4>
                          </div>
                          <div className="text-emerald-400 text-sm font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-5 h-5" />
                            该域名目前仍处于未注册状态，可以立即在线注册！
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
                          <div className="w-full sm:w-1/2">
                            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                              选择注册的目标账号:
                            </label>
                            <select
                              value={registerAccountId}
                              onChange={(e) => setRegisterAccountId(Number(e.target.value))}
                              className="w-full bg-dark-950 border border-dark-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
                            >
                              {accounts.length === 0 ? (
                                <option value="">暂无可用的绑定账号</option>
                              ) : (
                                accounts.map((acc) => (
                                  <option key={acc.id} value={acc.id}>
                                    {acc.alias} (ID: {acc.id})
                                  </option>
                                ))
                              )}
                            </select>
                          </div>

                          <div className="w-full sm:w-1/2 flex items-end">
                            <button
                              onClick={handleRegisterSubdomain}
                              disabled={actionLoading === "register-subdomain" || accounts.length === 0}
                              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm px-6 py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Plus className="w-4 h-4" />
                              {actionLoading === "register-subdomain" ? "正在注册中..." : "一键注册该域名"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* 已被注册：红色提示卡片 */
                      <div className="bg-dark-900 border border-red-500/30 rounded-2xl p-6 shadow-xl space-y-4">
                        <div className="flex items-center justify-between border-b border-dark-800 pb-4">
                          <div>
                            <span className="inline-block bg-red-500/20 text-red-400 text-xs font-bold px-2.5 py-1 rounded-full mb-1">
                              已被注册
                            </span>
                            <h4 className="text-xl font-bold text-slate-300">
                              {whoisResult.searchedDomain}
                            </h4>
                          </div>
                          <div className="text-red-400 text-sm font-semibold flex items-center gap-1">
                            <AlertTriangle className="w-5 h-5" />
                            已被他人抢先注册
                          </div>
                        </div>

                        {/* WHOIS 详细数据表 */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2">
                          <div className="bg-dark-950 p-3 rounded-lg border border-dark-800">
                            <span className="text-slate-500">注册时间：</span>
                            <span className="text-slate-300 font-medium ml-1">{whoisResult.registered_at || "保密 / 未公开"}</span>
                          </div>
                          <div className="bg-dark-950 p-3 rounded-lg border border-dark-800">
                            <span className="text-slate-500">到期时间：</span>
                            <span className="text-slate-300 font-medium ml-1">{whoisResult.expires_at || "保密 / 未公开"}</span>
                          </div>
                          <div className="bg-dark-950 p-3 rounded-lg border border-dark-800 sm:col-span-2">
                            <span className="text-slate-500">当前 NS 域名服务器：</span>
                            <span className="text-slate-300 font-medium ml-1">
                              {Array.isArray(whoisResult.nameservers) ? whoisResult.nameservers.join(", ") : "系统默认 NS"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 模式 B: 规则多域名查重控制台 */}
            {regMode === "batch" && (
              <div className="space-y-6">
                
                {/* 规则与生成配置卡片 */}
                <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xl space-y-6">
                  
                  {/* 1. 生成规则输入框 */}
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-slate-200">
                      生成规则:
                    </label>
                    <div className="flex items-center bg-dark-950 border border-dark-800 rounded-xl px-4 focus-within:border-indigo-500 transition-colors">
                      <input
                        type="text"
                        value={batchRules}
                        onChange={(e) => setBatchRules(e.target.value)}
                        placeholder="例如: myapp, test123 或点击下方快捷标签（如 声母+韵母）"
                        className="w-full bg-transparent py-3 text-white text-sm focus:outline-none"
                      />
                      <span className="text-xs text-indigo-400 font-bold whitespace-nowrap px-2">ⓘ 规则就绪</span>
                    </div>
                  </div>

                  {/* 2. 排除字符与长度 */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2 space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">
                        排除字符 (可选，若域名中出现定义的字符，则忽略):
                      </label>
                      <input
                        type="text"
                        value={excludeChars}
                        onChange={(e) => setExcludeChars(e.target.value)}
                        placeholder="例如 01ol 避免字符易混淆 (可选)"
                        className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-2.5 text-white text-xs focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">
                        生成组合长度:
                      </label>
                      <select
                        value={batchLength}
                        onChange={(e) => setBatchLength(Number(e.target.value))}
                        className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-2.5 text-white text-xs focus:border-indigo-500 focus:outline-none"
                      >
                        <option value={2}>2位长度 (如 aa / ba / 88)</option>
                        <option value={3}>3位长度 (如 aaa / 123 / abc)</option>
                        <option value={4}>4位长度 (如 8888 / baba)</option>
                      </select>
                    </div>
                  </div>

                  {/* 3. 快捷标签按钮组 */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-400">
                      支持快捷标签 (点击追加到规则框):
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        "字母", "数字", "数字无04", "声母", "韵母", "2位拼音", "双拼", "2位豹子", "3位豹子", "CVCV"
                      ].map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setBatchRules(prev => prev ? `${prev}+${tag}` : tag)}
                          className="bg-dark-950 hover:bg-indigo-950/60 text-slate-300 hover:text-indigo-300 border border-dark-800 hover:border-indigo-500/40 text-xs px-3 py-1.5 rounded-lg transition-all"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 4. 根域名后缀多选组 (支持添加自定义根域名) */}
                  <div className="space-y-3 border-t border-dark-800 pt-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-slate-300">
                        选择欲检测的 DNSHE 官方及自定义根域名后缀:
                      </label>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setSelectedRoots([...allRootDomains])}
                          className="text-xs text-indigo-400 hover:underline"
                        >
                          全选 ({allRootDomains.length})
                        </button>
                        <span className="text-slate-600">|</span>
                        <button
                          onClick={() => setSelectedRoots([])}
                          className="text-xs text-slate-400 hover:underline"
                        >
                          反选
                        </button>
                      </div>
                    </div>

                    {/* 根域名复选框网格 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {allRootDomains.map((root) => {
                        const isChecked = selectedRoots.includes(root);
                        const isDefault = DEFAULT_ROOT_DOMAINS.includes(root);
                        return (
                          <div
                            key={root}
                            className={`group relative flex items-center justify-between p-2 rounded-lg border text-xs font-mono transition-all ${
                              isChecked
                                ? "bg-indigo-950/40 border-indigo-500/50 text-indigo-300"
                                : "bg-dark-950 border-dark-800 text-slate-500 hover:text-slate-300"
                            }`}
                          >
                            <label className="flex items-center gap-2 cursor-pointer w-full overflow-hidden">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedRoots(prev => Array.from(new Set([...prev, root])));
                                  } else {
                                    setSelectedRoots(prev => prev.filter(r => r !== root));
                                  }
                                }}
                                className="rounded border-dark-800 text-indigo-600 focus:ring-0"
                              />
                              <span className="truncate">.{root}</span>
                            </label>

                            {!isDefault && (
                              <button
                                type="button"
                                title="删除该自定义根域名"
                                onClick={() => handleRemoveCustomRootDomain(root)}
                                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-0.5 ml-1 transition-opacity"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* 添加自定义根域名输入栏 */}
                    <form onSubmit={handleAddCustomRootDomain} className="flex items-center gap-2 pt-1 max-w-sm">
                      <input
                        type="text"
                        placeholder="添加新根域名(如 sample.cd)"
                        value={newRootInput}
                        onChange={(e) => setNewRootInput(e.target.value)}
                        className="bg-dark-950 border border-dark-800 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none flex-1 font-mono"
                      />
                      <button
                        type="submit"
                        disabled={!newRootInput.trim()}
                        className="bg-dark-850 hover:bg-dark-800 text-indigo-400 hover:text-indigo-300 border border-dark-800 text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 disabled:opacity-40"
                      >
                        <Plus className="w-3.5 h-3.5" /> 添加根域
                      </button>
                    </form>
                  </div>

                  {/* 5. 主控制按钮条 */}
                  <div className="flex flex-wrap items-center gap-3 border-t border-dark-800 pt-5">
                    <button
                      onClick={handleStartBatchScan}
                      disabled={scanStatus === "running"}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm px-6 py-3 rounded-xl transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
                    >
                      <Play className={`w-4 h-4 ${scanStatus === "running" ? "animate-spin" : ""}`} />
                      {scanStatus === "running" ? "正在查重中..." : scanStatus === "paused" ? "恢复查询" : "开始生成查询"}
                    </button>

                    <button
                      onClick={() => {
                        updateScanStatus("paused");
                        showToast("info", "⏸️ 域名查重已暂停");
                      }}
                      disabled={scanStatus !== "running"}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm px-5 py-3 rounded-xl transition-all disabled:opacity-50"
                    >
                      暂停查询
                    </button>

                    <button
                      onClick={() => {
                        updateScanStatus("idle");
                        setAvailableDomainsList([]);
                        setScanLogs([]);
                        setScanProgress({ total: 0, checked: 0, available: 0 });
                        showToast("info", "🔄 已重置查重逻辑");
                      }}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm px-5 py-3 rounded-xl transition-all"
                    >
                      重新开始
                    </button>

                    <button
                      onClick={handleExportAvailableTxt}
                      disabled={availableDomainsList.length === 0}
                      className="bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-sm px-5 py-3 rounded-xl transition-all flex items-center gap-2 ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download className="w-4 h-4" />
                      导出 txt 字典文件 ({availableDomainsList.length})
                    </button>
                  </div>
                </div>

                {/* 扫描进度与发现结果列表 */}
                {scanProgress.total > 0 && (
                  <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                      <span>查重进度: {scanProgress.checked} / {scanProgress.total} ({Math.round((scanProgress.checked / scanProgress.total) * 100)}%)</span>
                      <span className="text-emerald-400 font-bold">🎉 发现可用免费域名: {availableDomainsList.length} 个</span>
                    </div>

                    {/* 进度条 */}
                    <div className="w-full bg-dark-950 rounded-full h-3 overflow-hidden border border-dark-800">
                      <div
                        className="bg-indigo-500 h-full transition-all duration-300"
                        style={{ width: `${Math.round((scanProgress.checked / scanProgress.total) * 100)}%` }}
                      ></div>
                    </div>

                    {/* 发现可注册域名的实时表格 */}
                    <div className="space-y-3 pt-2">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        发现未注册可用域名大盘 (点击一键注册)
                      </h4>

                      {availableDomainsList.length === 0 ? (
                        <div className="text-center py-8 bg-dark-950/40 rounded-xl border border-dark-800 text-xs text-slate-500">
                          {scanStatus === "running" ? "正在高频查重校验中，请稍候..." : "暂未查出可用的域名"}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {availableDomainsList.map((item, idx) => (
                            <div
                              key={idx}
                              className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between hover:border-emerald-500 transition-all"
                            >
                              <div>
                                <span className="font-mono text-sm font-bold text-white block">
                                  {item.fullDomain}
                                </span>
                                <span className="text-[10px] text-slate-400 block mt-0.5">
                                  查出时间: {item.time}
                                </span>
                              </div>

                              <button
                                onClick={() => {
                                  const sub = item.subdomain;
                                  const root = item.rootdomain;
                                  setSearchSubdomain(sub);
                                  setSearchRootdomain(root);
                                  setRegMode("single");
                                  if (accounts.length > 0 && !registerAccountId) {
                                    setRegisterAccountId(accounts[0].id);
                                  }
                                  // 瞬发呈现绿色【尚未注册】卡片，提升即时响应体验
                                  setWhoisResult({
                                    searchedDomain: item.fullDomain,
                                    registered: false
                                  });
                                  // 显式带参数自动触发后台 WHOIS 重新拉取详细元数据
                                  handleCheckWhois(undefined, sub, root);
                                }}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow transition-all flex items-center gap-1"
                              >
                                <Plus className="w-3.5 h-3.5" /> 注册
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 实时爆破扫描中文日志卡片 */}
                    <div className="space-y-3 pt-4 border-t border-dark-800">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <ScrollText className="w-4 h-4 text-indigo-400" />
                          实时爆破扫描中文日志 (自动滚动最新 50 条)
                        </h4>
                        <span className="text-xs text-slate-500 font-mono">
                          {scanLogs.length > 0 ? `最新推送: ${scanLogs[0].time}` : "等待扫码响应..."}
                        </span>
                      </div>

                      <div className="bg-dark-950/90 rounded-xl p-3.5 border border-dark-800 font-mono text-xs max-h-56 overflow-y-auto space-y-1.5 scrollbar-thin">
                        {scanLogs.length === 0 ? (
                          <div className="text-center py-6 text-slate-600">
                            正在高频检测中，实时中文日志流水将在此处高频输出...
                          </div>
                        ) : (
                          scanLogs.map((log) => (
                            <div key={log.id} className="flex items-center gap-2 border-b border-dark-900/60 pb-1 last:border-0">
                              <span className="text-slate-500 font-semibold">[{log.time}]</span>
                              <span className={
                                log.status === "available"
                                  ? "text-emerald-400 font-bold"
                                  : log.status === "error"
                                  ? "text-amber-400"
                                  : "text-slate-400"
                              }>
                                {log.text}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        )}

        {/* Tab 1: 域名列表 */}
        {activeTab === "domains" && (
          <div className="space-y-8">
            {/* 账号与 DNS 筛选控制器 */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-dark-900 border border-dark-800 p-4 rounded-xl">
              <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-300 flex items-center gap-1.5 whitespace-nowrap">
                    <UserCheck className="w-4 h-4 text-indigo-400" /> 选择账号:
                  </span>
                  <select
                    value={selectedAccountFilter}
                    onChange={(e) => {
                      setSelectedAccountFilter(e.target.value);
                      fetchDomains(e.target.value);
                    }}
                    className="form-input px-3 py-2 rounded-lg text-sm text-slate-200 min-w-[180px]"
                  >
                    <option value="all">全部账号 (按账号独立分组)</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={String(acc.id)}>
                        账号: {acc.alias}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-300 flex items-center gap-1.5 whitespace-nowrap">
                    <Server className="w-4 h-4 text-sky-400" /> DNS 类型:
                  </span>
                  <select
                    value={nsTypeFilter}
                    onChange={(e) => setNsTypeFilter(e.target.value as "all" | "default" | "external")}
                    className="form-input px-3 py-2 rounded-lg text-sm text-slate-200 min-w-[150px]"
                  >
                    <option value="all">全部 DNS 类型</option>
                    <option value="default">仅系统默认 DNS</option>
                    <option value="external">仅外部 DNS 委派</option>
                  </select>
                </div>
              </div>

              <div className="text-xs text-slate-400 font-mono">
                已绑定账户: <span className="text-indigo-400 font-bold">{accounts.length}</span> | 
                托管域名: <span className="text-emerald-400 font-bold">{domains.length}</span> 个
              </div>
            </div>

            {/* 域名列表展示 */}
            {loadingDomains ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
                <span>正在加载域名列表...</span>
              </div>
            ) : domains.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-dark-800 rounded-xl bg-dark-900/50">
                <Globe className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-slate-300">未找到域名记录</h3>
                <p className="text-slate-400 text-sm mt-1 max-w-md mx-auto">
                  {selectedAccountFilter !== "all" 
                    ? "当前选中账号下没有绑定任何域名。"
                    : "尚未绑定账号或本地缓存中没有域名。请前往「账号管理」添加 API 密钥，然后点击「同步所有账号」。"}
                </p>
              </div>
            ) : (
              <div className="space-y-10">
                {groupedDomains.map((group) => {
                  const defaultDomains = group.domains.filter(checkHasDns);
                  const externalDomains = group.domains.filter((d) => !checkHasDns(d));

                  const showDefault = nsTypeFilter === "all" || nsTypeFilter === "default";
                  const showExternal = nsTypeFilter === "all" || nsTypeFilter === "external";

                  return (
                    <div key={group.accountId} className="space-y-6 bg-dark-950/40 p-6 rounded-2xl border border-dark-800">
                      {/* 账号大标题 */}
                      <div className="flex items-center justify-between border-b border-dark-800 pb-4">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                          <Key className="w-4 h-4 text-indigo-400" />
                          账号：<span className="text-indigo-300">{group.alias}</span>
                          <span className="text-xs bg-indigo-950/80 text-indigo-300 border border-indigo-900/60 px-2.5 py-0.5 rounded-full font-normal">
                            共 {group.domains.length} 个域名（系统默认: {defaultDomains.length} | 外部DNS: {externalDomains.length}）
                          </span>
                        </h3>
                      </div>

                      {/* 子分块 1：系统默认 DNS 域名 */}
                      {showDefault && defaultDomains.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                            <span>系统默认 DNS 域名 ({defaultDomains.length})</span>
                            <span className="text-xs text-slate-400 font-normal">—— 支持直接在线管理 DNS 解析记录</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {defaultDomains.map(renderDomainCard)}
                          </div>
                        </div>
                      )}

                      {/* 子分块 2：外部 DNS 委派域名 */}
                      {showExternal && externalDomains.length > 0 && (
                        <div className="space-y-3 pt-2">
                          <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" />
                            <span>外部 DNS 委派域名 ({externalDomains.length})</span>
                            <span className="text-xs text-slate-400 font-normal">—— 已托管至 Cloudflare 等第三方服务商</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {externalDomains.map(renderDomainCard)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: 账号管理 */}
        {activeTab === "accounts" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* 左侧：绑定新账号 */}
            <div className="lg:col-span-1 bg-dark-900 border border-dark-800 rounded-xl p-6 h-fit">
              <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-500" /> 绑定新 DNSHE 账号
              </h2>
              
              <form onSubmit={handleAddAccount} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">账户别名 (备注标识)</label>
                  <input
                    type="text"
                    required
                    placeholder="如：主账号、测试组"
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">API Key</label>
                  <input
                    type="text"
                    required
                    placeholder="cfsd_xxxxxxxxxx"
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">API Secret</label>
                  <input
                    type="password"
                    required
                    placeholder="请输入 API Secret"
                    value={newApiSecret}
                    onChange={(e) => setNewApiSecret(e.target.value)}
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-slate-200"
                  />
                </div>

                <button
                  type="submit"
                  disabled={actionLoading === "add-account"}
                  className="w-full btn-primary py-2.5 rounded-lg font-semibold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {actionLoading === "add-account" ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    "验证并绑定账号"
                  )}
                </button>
              </form>
            </div>

            {/* 右侧：账号列表 */}
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-lg font-bold text-white mb-4">已绑定的 API 账号 ({accounts.length})</h2>
              
              {loadingAccounts ? (
                <div className="flex justify-center py-10">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                </div>
              ) : accounts.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-dark-800 rounded-xl bg-dark-900/30">
                  <Key className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">尚未绑定任何 API 账户</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {accounts.map((acc) => (
                    <div key={acc.id} className="glass-card rounded-xl p-5 border border-dark-800 flex justify-between items-start gap-4">
                      <div>
                        <h3 className="font-bold text-white text-base">{acc.alias}</h3>
                        <p className="text-slate-400 text-xs mt-1.5 font-mono">
                          Key: {acc.api_key.substring(0, 8)}***{acc.api_key.substring(acc.api_key.length - 4)}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-2">
                          绑定于: {new Date(acc.created_at).toLocaleString("zh-CN")}
                        </p>
                      </div>
                      
                      <button
                        onClick={() => handleDeleteAccount(acc.id)}
                        disabled={actionLoading === `delete-account-${acc.id}`}
                        className="bg-red-950/60 hover:bg-red-900/60 text-red-400 hover:text-red-200 border border-red-900/50 p-2 rounded-lg transition-all"
                        title="删除账号"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: 账户配额 */}
        {activeTab === "quota" && (
          <div>
            <h2 className="text-lg font-bold text-white mb-6">各账户域名配额概览</h2>
            
            {loadingQuotas ? (
              <div className="flex justify-center py-20">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
              </div>
            ) : quotas.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-dark-800 rounded-xl bg-dark-900/30">
                <Database className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">没有查到配额数据。请确保至少绑定了一个账户，并且密钥配置无误。</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {quotas.map((q, idx) => {
                  if (q.error) {
                    return (
                      <div key={idx} className="bg-red-950/20 border border-red-900/50 rounded-xl p-5">
                        <h3 className="font-bold text-red-400">{q.alias}</h3>
                        <p className="text-red-300 text-sm mt-2 flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                          API 调用异常: {q.error}
                        </p>
                      </div>
                    );
                  }

                  const percent = q.total > 0 ? Math.round((q.used / q.total) * 100) : 0;
                  
                  return (
                    <div key={q.account_id} className="glass-card rounded-xl p-5 border border-dark-800">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-white text-lg">{q.alias}</h3>
                        <span className="text-xs bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded-full">
                          可用: {q.available}
                        </span>
                      </div>

                      {/* 环形/条形进度展示 */}
                      <div className="space-y-3">
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>已用子域名: {q.used} / {q.total}</span>
                          <span>{percent}%</span>
                        </div>
                        <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${
                              percent > 85 ? "bg-red-500" : percent > 60 ? "bg-amber-500" : "bg-indigo-500"
                            }`} 
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-6 pt-4 border-t border-dark-800 text-center">
                        <div>
                          <span className="block text-[10px] text-slate-400">基础配额</span>
                          <span className="text-sm font-semibold text-slate-200">{q.base}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-400">邀请赠送</span>
                          <span className="text-sm font-semibold text-slate-200">+{q.invite_bonus}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-400">总配额</span>
                          <span className="text-sm font-semibold text-white">{q.total}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: 运行日志 */}
        {activeTab === "logs" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">定时同步与自动续期日志 (最近100条)</h2>
              <button
                onClick={handleClearLogs}
                disabled={actionLoading === "clear-logs"}
                className="bg-red-950/60 hover:bg-red-900/60 text-red-400 hover:text-red-200 border border-red-900/50 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
              >
                清空运行日志
              </button>
            </div>

            {loadingLogs ? (
              <div className="flex justify-center py-20">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-dark-800 rounded-xl bg-dark-900/30">
                <ScrollText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">暂无系统运行日志</p>
              </div>
            ) : (
              <div className="bg-dark-900/60 border border-dark-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="bg-dark-950 text-slate-400 text-xs border-b border-dark-850">
                        <th className="p-4 w-44">时间</th>
                        <th className="p-4 w-28">类型</th>
                        <th className="p-4 w-32">模块</th>
                        <th className="p-4">描述信息</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-850 font-medium">
                      {logs.map((log) => (
                        <tr key={log.id} className="hover:bg-dark-900/40 transition-colors">
                          <td className="p-4 text-xs text-slate-400 font-mono">
                            {new Date(log.created_at).toLocaleString("zh-CN")}
                          </td>
                          <td className="p-4 text-xs">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full font-bold uppercase ${
                              log.type === "success" ? "bg-emerald-950 text-emerald-400" :
                              log.type === "error" ? "bg-red-950 text-red-400 animate-pulse" :
                              log.type === "warning" ? "bg-amber-950 text-amber-400" :
                              "bg-slate-900 text-slate-300"
                            }`}>
                              {log.type}
                            </span>
                          </td>
                          <td className="p-4 text-xs text-slate-300 font-semibold capitalize">
                            {log.category}
                          </td>
                          <td className="p-4 text-slate-200">
                            <div>{log.message}</div>
                            {log.details && (
                              <pre className="mt-2 p-2.5 rounded bg-slate-950 text-slate-400 text-xs font-mono max-h-40 overflow-y-auto whitespace-pre-wrap">
                                {log.details}
                              </pre>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* DNS 解析管理模态框 (Modal) */}
      {dnsModalOpen && selectedDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-dark-900 border border-dark-800 w-full max-w-4xl max-h-[85vh] rounded-xl overflow-hidden flex flex-col shadow-2xl">
            {/* 模态框头部 */}
            <div className="bg-dark-950 px-6 py-4 flex items-center justify-between border-b border-dark-800">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-1.5">
                  <ShieldCheck className="text-indigo-400 w-5 h-5" />
                  DNS 解析记录管理
                </h3>
                <p className="text-xs text-slate-400 mt-0.5 font-mono">
                  域名: {selectedDomain.full_domain}
                </p>
              </div>
              <button 
                onClick={() => setDnsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 hover:bg-dark-850 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 模态框主体 */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              
              {/* 新建 DNS 记录表单折叠面板 */}
              <div className="border border-dark-800 rounded-lg overflow-hidden bg-dark-950/40">
                <button
                  onClick={() => setDnsFormOpen(!dnsFormOpen)}
                  className="w-full px-4 py-3 bg-dark-950 hover:bg-dark-900 flex justify-between items-center text-sm font-semibold text-slate-200 transition-colors"
                >
                  <span>{dnsFormOpen ? "隐藏新建解析表单" : "➕ 添加新解析记录"}</span>
                </button>

                {dnsFormOpen && (
                  <form onSubmit={handleCreateDnsRecord} className="p-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 border-t border-dark-800">
                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">记录类型</label>
                      <select
                        value={newDnsType}
                        onChange={(e) => setNewDnsType(e.target.value)}
                        className="w-full form-input px-2.5 py-2 rounded text-sm text-slate-200"
                      >
                        <option value="A">A (IPv4地址)</option>
                        <option value="AAAA">AAAA (IPv6地址)</option>
                        <option value="CNAME">CNAME (别名指向)</option>
                        <option value="TXT">TXT (文本记录)</option>
                        <option value="MX">MX (邮件服务器)</option>
                        <option value="NS">NS (域名服务器)</option>
                        <option value="CAA">CAA (证书签发限制)</option>
                        <option value="SRV">SRV (服务定位)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">主机记录</label>
                      <input
                        type="text"
                        placeholder="例如 @ 或 www"
                        value={newDnsName}
                        onChange={(e) => setNewDnsName(e.target.value)}
                        className="w-full form-input px-2.5 py-2 rounded text-sm text-slate-200"
                      />
                    </div>

                    <div className="md:col-span-2 lg:col-span-1">
                      <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">记录值 (Content)</label>
                      <input
                        type="text"
                        required
                        placeholder="例如 192.168.1.1"
                        value={newDnsContent}
                        onChange={(e) => setNewDnsContent(e.target.value)}
                        className="w-full form-input px-2.5 py-2 rounded text-sm text-slate-200"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">TTL (秒)</label>
                      <input
                        type="number"
                        min={120}
                        max={86400}
                        value={newDnsTtl}
                        onChange={(e) => setNewDnsTtl(parseInt(e.target.value, 10))}
                        className="w-full form-input px-2.5 py-2 rounded text-sm text-slate-200"
                      />
                    </div>

                    {(newDnsType === "MX" || newDnsType === "SRV") && (
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">优先级</label>
                        <input
                          type="number"
                          min={0}
                          max={65535}
                          value={newDnsPriority}
                          onChange={(e) => setNewDnsPriority(parseInt(e.target.value, 10))}
                          className="w-full form-input px-2.5 py-2 rounded text-sm text-slate-200"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">解析线路 (特定域名)</label>
                      <input
                        type="text"
                        placeholder="如 us.ci / cn.mt"
                        value={newDnsLine}
                        onChange={(e) => setNewDnsLine(e.target.value)}
                        className="w-full form-input px-2.5 py-2 rounded text-sm text-slate-200"
                      />
                    </div>

                    <div className="flex items-end md:col-span-3 lg:col-span-1">
                      <button
                        type="submit"
                        disabled={actionLoading === "create-dns"}
                        className="w-full btn-primary py-2 rounded text-sm font-semibold text-white flex items-center justify-center gap-1"
                      >
                        {actionLoading === "create-dns" && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        确认保存
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* DNS 记录列表展现 */}
              <div>
                <h4 className="text-sm font-bold text-white mb-3">当前解析记录列表</h4>

                {loadingDns ? (
                  <div className="flex justify-center py-10">
                    <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                  </div>
                ) : dnsRecords.length === 0 ? (
                  <div className="text-center py-10 bg-dark-950/20 rounded-lg border border-dark-800 text-slate-400 text-sm">
                    暂无解析记录。请点击上方按钮添加第一条记录。
                  </div>
                ) : (
                  <div className="bg-dark-950/40 border border-dark-800 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm border-collapse">
                        <thead>
                          <tr className="bg-dark-950 text-slate-400 text-[10px] uppercase font-bold tracking-wider border-b border-dark-850">
                            <th className="p-3">类型</th>
                            <th className="p-3">主机记录</th>
                            <th className="p-3">解析记录值</th>
                            <th className="p-3 w-20">TTL</th>
                            <th className="p-3 w-24">线路</th>
                            <th className="p-3 w-16 text-center">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-dark-850 text-slate-200">
                          {dnsRecords.map((rec) => (
                            <tr key={rec.id} className="hover:bg-dark-900/30">
                              <td className="p-3 font-bold text-xs text-indigo-400">{rec.type}</td>
                              <td className="p-3 font-mono text-xs">{rec.name}</td>
                              <td className="p-3 font-mono text-xs break-all max-w-xs" title={rec.content}>
                                {rec.priority !== null && rec.priority !== undefined && `[优先级: ${rec.priority}] `}
                                {rec.content}
                              </td>
                              <td className="p-3 text-xs text-slate-400">{rec.ttl}</td>
                              <td className="p-3 text-xs text-slate-400">{rec.line || "默认"}</td>
                              <td className="p-3 text-center">
                                <button
                                  onClick={() => handleDeleteDnsRecord(rec.id ?? rec.record_id!)}
                                  disabled={actionLoading === `delete-dns-${rec.id ?? rec.record_id}`}
                                  className="text-red-400 hover:text-red-300 disabled:opacity-50 p-1 hover:bg-red-950/40 rounded transition-all"
                                  title="删除此记录"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* 模态框页脚 */}
            <div className="bg-dark-950 px-6 py-4 border-t border-dark-800 flex justify-end">
              <button
                onClick={() => setDnsModalOpen(false)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold px-4 py-2 rounded-lg"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NS 域名服务器修改与重置模态框 (NS Modal) */}
      {nsModalOpen && nsModalDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-dark-900 border border-dark-800 w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col shadow-2xl">
            {/* 模态框头部 */}
            <div className="bg-dark-950 px-6 py-4 flex items-center justify-between border-b border-dark-800">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Server className="text-sky-400 w-5 h-5" />
                  NS 域名服务器设置 / 域名委派
                </h3>
                <p className="text-xs text-slate-400 mt-0.5 font-mono">
                  域名: {nsModalDomain.full_domain}
                </p>
              </div>
              <button 
                onClick={() => setNsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 hover:bg-dark-850 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 模态框内容 */}
            <div className="p-6 overflow-y-auto space-y-6">
              
              {/* 当前 NS 状态指示 */}
              <div className="p-4 rounded-xl border border-dark-800 bg-dark-950/60 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 block font-medium">当前 NS 运行状态</span>
                  <span className="text-sm font-bold text-white mt-1 block">
                    {nsRecords.length === 0 ? "系统默认 (ns1.dnshe.com / ns2.dnshe.com)" : "外部 DNS 委派托管中"}
                  </span>
                </div>
                <div>
                  {nsRecords.length === 0 ? (
                    <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-900/60 text-xs px-3 py-1 rounded-full font-semibold">
                      系统默认
                    </span>
                  ) : (
                    <span className="bg-sky-950/80 text-sky-300 border border-sky-800/60 text-xs px-3 py-1 rounded-full font-semibold">
                      外部 DNS
                    </span>
                  )}
                </div>
              </div>

              {/* 已设置的 NS 记录列表 */}
              {loadingNsModal ? (
                <div className="flex justify-center py-6">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                </div>
              ) : nsRecords.length > 0 ? (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">当前委派的第三方 NS 服务器列表</h4>
                  <div className="bg-dark-950/40 border border-dark-800 rounded-xl overflow-hidden divide-y divide-dark-850">
                    {nsRecords.map((rec) => (
                      <div key={rec.id} className="p-3.5 flex justify-between items-center text-xs font-mono">
                        <span className="text-slate-200">{rec.content}</span>
                        <button
                          onClick={async () => {
                            await handleDeleteDnsRecord(rec.id ?? rec.record_id!);
                            handleOpenNsModal(nsModalDomain);
                            handleSyncDomains();
                          }}
                          disabled={actionLoading === `delete-dns-${rec.id ?? rec.record_id}`}
                          className="text-red-400 hover:text-red-300 p-1 hover:bg-red-950/40 rounded transition-all"
                          title="删除此 NS 记录"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleResetToDefaultNs}
                    disabled={actionLoading === "reset-ns"}
                    className="w-full bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-900/60 py-2.5 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-inner mt-2"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === "reset-ns" ? "animate-spin" : ""}`} />
                    一键恢复为系统默认 NS (ns1.dnshe.com / ns2.dnshe.com)
                  </button>
                </div>
              ) : (
                <div className="text-center py-4 bg-dark-950/30 rounded-xl border border-dark-800 text-slate-400 text-xs">
                  当前处于系统默认 NS。填下方表单可直接新增外部 NS 并切为「外部 DNS 委派」模式。
                </div>
              )}

              {/* 添加自定义第三方 NS 表单 */}
              <form onSubmit={handleAddCustomNs} className="p-4 border border-dark-800 rounded-xl bg-dark-950/40 space-y-3">
                <h4 className="text-xs font-bold text-slate-300">添加 / 变更自定义 NS 服务器</h4>
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">第三方 NS 服务器地址</label>
                  <input
                    type="text"
                    required
                    placeholder="例如 dara.ns.cloudflare.com"
                    value={newCustomNsContent}
                    onChange={(e) => setNewCustomNsContent(e.target.value)}
                    className="w-full form-input px-3 py-2 rounded-lg text-sm text-slate-200"
                  />
                </div>
                <div className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    id="forceReplaceNs"
                    checked={forceReplaceConflict}
                    onChange={(e) => setForceReplaceConflict(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded bg-dark-900 border-dark-700 focus:ring-indigo-500 cursor-pointer"
                  />
                  <label htmlFor="forceReplaceNs" className="text-xs text-slate-300 font-medium cursor-pointer flex items-center gap-1">
                    强制替换冲突记录
                    <span className="text-[11px] text-slate-400 font-normal">（自动删除同名 A / CNAME / TXT / MX 等冲突解析）</span>
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={actionLoading === "add-ns"}
                  className="w-full btn-primary py-2.5 rounded-lg font-semibold text-xs text-white flex items-center justify-center gap-2"
                >
                  {actionLoading === "add-ns" && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  添加 NS 委派记录
                </button>
              </form>

            </div>

            {/* 页脚 */}
            <div className="bg-dark-950 px-6 py-4 border-t border-dark-800 flex justify-end">
              <button
                onClick={() => setNsModalOpen(false)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold px-4 py-2 rounded-lg"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 管理员口令 (ADMIN_TOKEN) 鉴权模态框 */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 snapshot-blur backdrop-blur-md">
          <div className="bg-dark-900 border border-dark-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl p-6">
            <div className="flex items-center gap-3 text-amber-400 mb-4">
              <Key className="w-7 h-7" />
              <h3 className="text-xl font-bold text-white">管理员安全鉴权</h3>
            </div>
            <p className="text-slate-400 text-sm mb-5 leading-relaxed">
              部署上线环境时若设置了 <code className="bg-slate-800 text-amber-300 px-1.5 py-0.5 rounded">ADMIN_TOKEN</code>，所有 API 接口均需要验证管理口令。请输入您的管理口令以解锁面板功能。
            </p>
            <form onSubmit={handleSaveAuthToken} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  管理访问口令 (Bearer Token)
                </label>
                <input
                  type="password"
                  value={inputAuthToken}
                  onChange={(e) => setInputAuthToken(e.target.value)}
                  placeholder="请输入 ADMIN_TOKEN"
                  className="w-full bg-dark-950 border border-dark-800 focus:border-indigo-500 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  后端 Worker API 地址 (可选，默认自动匹配)
                </label>
                <input
                  type="text"
                  value={backendUrl}
                  onChange={(e) => setBackendUrl(e.target.value)}
                  placeholder="https://dnshe-manager-backend.xxxx.workers.dev"
                  className="w-full bg-dark-950 border border-dark-800 focus:border-indigo-500 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none transition-colors"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                {localStorage.getItem("DNSHE_ADMIN_TOKEN") && (
                  <button
                    type="button"
                    onClick={() => {
                      setInputAuthToken("");
                      localStorage.removeItem("DNSHE_ADMIN_TOKEN");
                      setAuthModalOpen(false);
                      showToast("info", "已清除本地口令");
                    }}
                    className="text-xs text-slate-400 hover:text-slate-200 underline px-2 py-1"
                  >
                    清除口令
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold px-3.5 py-2 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-primary text-xs font-semibold text-white px-4 py-2 rounded-lg"
                >
                  验证并保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 全局 Toast 通知 */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-2xl border transition-all duration-300 transform translate-y-0 text-sm font-semibold bg-dark-900 text-white border-dark-800">
          {toast.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />}
          {toast.type === "error" && <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />}
          {toast.type === "info" && <Info className="w-5 h-5 text-indigo-500 flex-shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

    </div>
  );
}
