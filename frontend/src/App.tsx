import React, { useState, useEffect, useMemo, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
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
  Download,
  LayoutDashboard,
  Menu,
  Bell,
  Sun,
  Moon,
  Activity,
  LogIn,
  Send,
  Save,
  Pencil,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff
} from "lucide-react";
import { toASCII, hasNonASCII, toUnicode } from "./punycode";
import {
  loadWordBanks,
  saveWordBanks,
  makeBankId,
  buildDefaultBanks,
  parseWords,
  BANK_KIND_META,
  type WordBank,
  type BankKind
} from "./wordbanks";
import {
  parseRule,
  countCombos,
  generateCombos,
  BUILTIN_TOKENS
} from "./rulegen";
import {
  DNS_TYPE_OPTIONS,
  needsDnsPriority,
  dnsRecordKey,
  toRelativeRecordName,
  parseDnsBatchInput,
  buildDnsEditTargets,
  type ParsedDnsLine
} from "./dnsrecords";

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
  dns_provider?: string | null;
  provider_account_id?: string | number | null;
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

/** 简易异步等待工具（用于轮询后台同步进度） */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 带「显示 / 隐藏」小眼睛的密码输入框
 *
 * 用在所有 type="password" 的位置（登录、初始化、修改密码、API Secret），
 * 让用户能自查手输 / 粘贴的内容，省掉「输了两遍还是不匹配」的来回。
 *
 * NOTE: 必须定义在 App() 外面。若写成 App 内部的组件，App 每次重渲染都会生成
 * 新的组件类型，React 会卸载重挂载整棵子树 —— 明暗态会被重置，输入框还会丢焦点。
 *
 * NOTE: 眼睛按钮一定要写 type="button"。登录页与初始化表单是真 <form onSubmit>，
 * button 默认 type="submit"，点一下眼睛就会顺手把表单提交掉。
 *
 * NOTE: name / autoComplete 一律原样透传给 input，不在这里加工。本项目为了压制
 * Chrome 的凭据预填，刻意把修改密码的三个框都标成 new-password、并给 name 取了
 * 不像 username 的值（见「修改登录密码」处的注释），组件替调用处改写会破坏这套约定。
 */
const PasswordInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  name?: string;
  autoComplete?: string;
  required?: boolean;
}> = ({ value, onChange, className, placeholder, name, autoComplete, required }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        /* 明文态切成 type="text"；pr-10 给右侧眼睛让位，避免长密码钻到图标底下。
           Tailwind 生成的 CSS 里 pr-* 排在 px-* 之后，所以能盖住调用处的 px-3 / px-3.5 */
        type={visible ? "text" : "password"}
        name={name}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        /* 命中区撑满输入框高度，窄屏上也够点 */
        className="absolute inset-y-0 right-0 px-3 flex items-center text-content-muted hover:text-content-primary transition-colors"
        title={visible ? "隐藏密码" : "显示密码"}
        aria-label={visible ? "隐藏密码" : "显示密码"}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
};

/**
 * 解析线路（Line）可选值
 *
 * NOTE: 取自官网 DNS 管理页 <select name="line"> 的 option value —— 提交值是英文代码
 * 而不是中文标签（「电信」只是显示文案，实际提交 telecom），且 oversea 没有尾部的 s。
 * API 文档只把 line 描述为「解析线路（us.ci/cn.mt可用，其他域名自动忽略）」，从未列出
 * 合法取值，因此这份清单以官网表单为准。
 */
const DNS_LINE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "default", label: "默认" },
  { value: "telecom", label: "电信" },
  { value: "unicom", label: "联通" },
  { value: "mobile", label: "移动" },
  { value: "oversea", label: "海外" },
  { value: "edu", label: "教育网" }
];

/**
 * 已知支持按线路解析的解析服务商账号 ID（domains_cache.provider_account_id）
 *
 * NOTE: 实测 us.ci / cn.mt（官网标注支持线路）均为 1，其余 7 个根域名为 7 或 8。
 * 上游没有任何「是否支持线路」的字段或接口，这是目前唯一可查的信号，详见
 * src/dnshe.ts 里 provider_account_id 的注释。名单可在设置页增删。
 */
const DEFAULT_LINE_PROVIDERS = ["1"];

/**
 * 解析线路下拉框
 *
 * NOTE: 不支持线路的域名是「禁用」而不是隐藏 —— 一是保持表单网格对齐，二是上游对
 * 这类域名会静默忽略 line（不报错），不显式拦住的话用户会以为自己设置生效了。
 */
const DnsLineSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  supported: boolean;
  className: string;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}> = ({ value, onChange, supported, className, disabled, onKeyDown }) => (
  <select
    value={supported ? value || "default" : "default"}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={onKeyDown}
    disabled={disabled || !supported}
    title={
      supported
        ? "不同运营商/地域可选择对应的解析线路，无特殊需求保持默认"
        : "该域名所在的解析服务商不支持按线路解析，填了也会被上游静默忽略"
    }
    className={`${className} disabled:opacity-50 disabled:cursor-not-allowed`}
  >
    {(supported ? DNS_LINE_OPTIONS : DNS_LINE_OPTIONS.slice(0, 1)).map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
);

/**
 * 主应用组件 - 提供 DNSHE 域名管理控制面板
 */
export default function App() {
  // 当前处于的选项卡（通过 URL hash 持久化，刷新/前进后退保持所在页面）
  type TabKey = "dashboard" | "domains" | "accounts" | "register" | "quota" | "logs" | "settings";
  const TAB_KEYS: TabKey[] = ["dashboard", "domains", "accounts", "register", "quota", "logs", "settings"];
  const tabFromHash = (): TabKey => {
    const h = window.location.hash.replace(/^#\/?/, "") as TabKey;
    return TAB_KEYS.includes(h) ? h : "dashboard";
  };
  const [activeTab, setActiveTab] = useState<TabKey>(tabFromHash);

  // 主题（明/暗）与侧栏折叠状态
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("DNSHE_THEME") as "light" | "dark") || "dark"
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem("DNSHE_SIDEBAR_COLLAPSED") === "1"
  );

  // 手机端侧栏抽屉开关（仅 <md 生效；≥md 侧栏常驻，这个状态用不上）
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /**
   * 是否处于 md 及以上宽度 —— 手机抽屉与桌面常驻侧栏的分界
   *
   * NOTE: 断点值必须与 Tailwind 的 md (768px) 保持一致：同一个 <aside> 既要在
   * ≥md 作为常驻侧栏参与布局流，又要在 <md 作为 fixed 抽屉，而"折叠成图标条"
   * 这件事只在桌面有意义 —— 折叠态是持久化的，若不区分宽度，从桌面带过来的
   * sidebarCollapsed=1 会让手机抽屉也只剩图标，没有文字标签。
   */
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => window.matchMedia("(min-width: 768px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
      // 升到桌面宽度时顺手关掉抽屉，避免旋转屏幕后遗留一个打开状态
      if (e.matches) setSidebarOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // 图标条模式：只有桌面 + 已折叠时才成立
  const railMode = isDesktop && sidebarCollapsed;

  // 抽屉打开时支持 Esc 关闭
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);
  // 顶部全局搜索词与通知下拉开关
  const [globalSearch, setGlobalSearch] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  // 日志页当前分类：登录 / API / 操作 / 全部
  const [logCategory, setLogCategory] = useState<"all" | "auth" | "api" | "operation">("all");

  // 应用设置状态
  interface AppSettings {
    webhook_url: string;
    webhook_type: string;
    tg_token: string;
    tg_chat_id: string;
    renew_threshold_days: string;
    auto_renew: string;
  }
  const [settings, setSettings] = useState<AppSettings>({
    webhook_url: "",
    webhook_type: "custom",
    tg_token: "",
    tg_chat_id: "",
    renew_threshold_days: "180",
    auto_renew: "1",
  });
  const [settingsConfigured, setSettingsConfigured] = useState<{ tg_token: boolean; webhook_url: boolean }>({ tg_token: false, webhook_url: false });
  const [loadingSettings, setLoadingSettings] = useState(false);
  // 设置页本地后端地址输入
  const [backendUrlInput, setBackendUrlInput] = useState(
    () => localStorage.getItem("DNSHE_BACKEND_URL") || ""
  );
  // 后端地址是否处于编辑状态（保存后收起，不常驻显示在输入框）
  const [backendUrlEditing, setBackendUrlEditing] = useState(false);

  // 同步主题到 <html> 类并持久化
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("DNSHE_THEME", theme);
  }, [theme]);

  // 持久化侧栏折叠
  useEffect(() => {
    localStorage.setItem("DNSHE_SIDEBAR_COLLAPSED", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

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
  const [toast, setToast] = useState<{ type: "success" | "error" | "info" | "warning"; message: string } | null>(null);

  // 绑定账号表单状态
  const [newAlias, setNewAlias] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newApiSecret, setNewApiSecret] = useState("");

  // 批量绑定表单状态
  const [batchInput, setBatchInput] = useState("");
  const [batchResults, setBatchResults] = useState<Array<{ api_key: string; alias?: string; success: boolean; message: string }> | null>(null);

  // 绑定弹窗状态（"single" 单个 / "batch" 批量 / null 关闭）
  const [bindModal, setBindModal] = useState<"single" | "batch" | null>(null);
  // 批量输入框引用（自绘拖拽调整高度用）
  const batchTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 批量输入框自绘拖拽手柄：直接改 DOM 高度，不走 React 渲染，保证跟手
  const handleBatchResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const ta = batchTextareaRef.current;
    if (!ta) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = ta.offsetHeight;
    const move = (ev: PointerEvent) => {
      const h = Math.max(96, Math.min(480, startH + (ev.clientY - startY)));
      ta.style.height = `${h}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // 修改账号表单状态
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editAlias, setEditAlias] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editApiSecret, setEditApiSecret] = useState("");

  // 选中的域名与 DNS 记录管理模态框状态
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [loadingDns, setLoadingDns] = useState(false);
  const [dnsModalOpen, setDnsModalOpen] = useState(false);

  // 域名列表中被收起的账号分组集合（存 accountId，持久化于本地，刷新后保持上次布局）
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem("DNSHE_COLLAPSED_ACCOUNTS");
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  });

  // 折叠状态落盘
  const persistCollapsed = (next: Set<number>) => {
    setCollapsedAccounts(next);
    localStorage.setItem("DNSHE_COLLAPSED_ACCOUNTS", JSON.stringify([...next]));
  };

  // 切换单个账号分组展开/收起
  const toggleAccountCollapse = (accountId: number) => {
    const next = new Set(collapsedAccounts);
    if (next.has(accountId)) {
      next.delete(accountId);
    } else {
      next.add(accountId);
    }
    persistCollapsed(next);
  };

  // 展开/收起全部账号分组
  const toggleAllAccounts = () => {
    if (collapsedAccounts.size > 0) {
      persistCollapsed(new Set()); // 存在收起的 → 全部展开
    } else {
      persistCollapsed(new Set(groupedDomains.map(g => g.accountId))); // 全部收起
    }
  };

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

  // 行内修改解析记录状态（editingDnsKey 为 dnsRecordKey(rec)，null 表示当前没有在编辑）
  const [editingDnsKey, setEditingDnsKey] = useState<string | null>(null);
  const [editDnsType, setEditDnsType] = useState("A");
  const [editDnsName, setEditDnsName] = useState("");
  const [editDnsContent, setEditDnsContent] = useState("");
  const [editDnsTtl, setEditDnsTtl] = useState(600);
  const [editDnsPriority, setEditDnsPriority] = useState<number>(10);
  const [editDnsLine, setEditDnsLine] = useState("");

  // 批量添加解析记录面板状态（面板上的类型/主机记录/TTL 等作为每行缺省字段的默认值）
  const [dnsBatchOpen, setDnsBatchOpen] = useState(false);
  const [dnsBatchInput, setDnsBatchInput] = useState("");
  const [dnsBatchType, setDnsBatchType] = useState("A");
  const [dnsBatchName, setDnsBatchName] = useState("@");
  const [dnsBatchTtl, setDnsBatchTtl] = useState(600);
  const [dnsBatchPriority, setDnsBatchPriority] = useState<number>(10);
  const [dnsBatchLine, setDnsBatchLine] = useState("");
  const [dnsBatchResults, setDnsBatchResults] = useState<Array<{ label: string; success: boolean; message: string }> | null>(null);

  // 批量删除：已勾选的解析记录键集合
  const [selectedDnsKeys, setSelectedDnsKeys] = useState<Set<string>>(new Set());

  // 批量修改面板状态
  //
  // NOTE: 勾选哪个字段就只覆盖那个字段，其余字段沿用每条记录的原值 —— 批量选中的
  // 记录往往只有 TTL / 线路 需要统一，记录值各不相同（如 6 条不同 IP 的 AAAA），
  // 整表覆盖会把它们改成一模一样。
  const [dnsEditPanelOpen, setDnsEditPanelOpen] = useState(false);
  const [dnsEditFields, setDnsEditFields] = useState({
    type: false,
    name: false,
    content: false,
    ttl: true,
    line: false,
    priority: false
  });
  const [batchEditType, setBatchEditType] = useState("A");
  const [batchEditName, setBatchEditName] = useState("@");
  const [batchEditTtl, setBatchEditTtl] = useState(600);
  const [batchEditLine, setBatchEditLine] = useState("");
  const [batchEditPriority, setBatchEditPriority] = useState<number>(10);
  // 记录值逐条给值（键为 record_id）：勾选「记录值」后每行都能单独改，留空即保持原值
  const [batchEditContents, setBatchEditContents] = useState<Record<string, string>>({});
  const [dnsEditResults, setDnsEditResults] = useState<Array<{ label: string; success: boolean; message: string }> | null>(null);

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

  // 域名删除确认状态（删除不可逆，必须输入完整域名二次确认）
  const [deleteModalDomain, setDeleteModalDomain] = useState<Domain | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [deleteError, setDeleteError] = useState("");

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
  const [scanLogs, setScanLogs] = useState<Array<{ id: number; time: string; text: string; status: "available" | "registered" | "error" | "info" }>>([]);

  // ===== 顺序检测（进位递增）与断点续查状态 =====
  // 顺序模式开关：开启后忽略规则框，按字符集进位顺序惰性生成候选（如 aaa→aab→...）
  const [seqMode, setSeqMode] = useState(false);
  // 顺序模式的字符集与长度
  const [seqCharset, setSeqCharset] = useState<"字母" | "数字" | "字母数字">("字母");
  const [seqLength, setSeqLength] = useState<number>(3);
  // 顺序模式的起始串（留空则从最小串开始，如 aaa）
  const [seqStart, setSeqStart] = useState<string>("");
  // 已保存的断点光标（从 localStorage 恢复，供「继续上次」提示使用）
  const [scanCursor, setScanCursor] = useState<{
    seqMode: boolean;
    charset: string;
    length: number;
    lastCandidate: string;
    taskIndex: number;
    checked: number;
    savedAt: string;
  } | null>(() => {
    try {
      const raw = localStorage.getItem("DNSHE_SCAN_CURSOR");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  // 扫描运行期间实时记录当前进度，供暂停/限流时落盘
  const scanCursorRef = useRef<{ lastCandidate: string; taskIndex: number; checked: number }>({
    lastCandidate: "",
    taskIndex: 0,
    checked: 0
  });

  // 查重池：是否忽略池子强制全部重查（用于刷新可能已过期的结论）
  const [ignorePool, setIgnorePool] = useState(false);

  // ===== 官方保留前缀排除名单 =====
  // DNSHE 官方设置为不可注册的前缀（整词匹配，如 ai 不可注册但 ailu 可以）。
  // 查重前直接剔除，避免浪费 API 配额。名单可编辑并持久化。
  const DEFAULT_RESERVED_PREFIXES = ["ai", "jd", "qq", "mail"];
  const [reservedPrefixes, setReservedPrefixes] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("DNSHE_RESERVED_PREFIXES");
      if (!raw) return DEFAULT_RESERVED_PREFIXES;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : DEFAULT_RESERVED_PREFIXES;
    } catch {
      return DEFAULT_RESERVED_PREFIXES;
    }
  });
  // 是否启用保留前缀排除
  const [enableReservedFilter, setEnableReservedFilter] = useState(
    () => localStorage.getItem("DNSHE_RESERVED_FILTER_OFF") !== "1"
  );
  // 新增保留前缀的输入框
  const [newReservedInput, setNewReservedInput] = useState("");

  // 支持按线路解析的解析服务商账号名单（可增删，持久化于浏览器本地）。
  // 判定依据是域名的 provider_account_id —— 上游没有「是否支持线路」的字段。
  const [lineProviders, setLineProviders] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("DNSHE_LINE_PROVIDERS");
      if (!raw) return DEFAULT_LINE_PROVIDERS;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : DEFAULT_LINE_PROVIDERS;
    } catch {
      return DEFAULT_LINE_PROVIDERS;
    }
  });
  // 新增线路服务商 ID 的输入框
  const [newLineProviderInput, setNewLineProviderInput] = useState("");

  // ===== 可编辑词库状态 =====
  // 词库分组列表（首次从内置种子导入，之后持久化在 localStorage）
  const [wordBanks, setWordBanks] = useState<WordBank[]>(() =>
    loadWordBanks(new Set(BUILTIN_TOKENS))
  );
  // 词库管理弹窗开关
  const [bankModalOpen, setBankModalOpen] = useState(false);
  // 正在编辑的分组（null 表示新建）
  const [editingBank, setEditingBank] = useState<WordBank | null>(null);
  // 编辑表单字段
  const [bankFormName, setBankFormName] = useState("");
  const [bankFormKind, setBankFormKind] = useState<BankKind>("cn");
  const [bankFormWords, setBankFormWords] = useState("");

  // 后端 Worker 地址
  const backendUrl = localStorage.getItem("DNSHE_BACKEND_URL") || (import.meta as any).env?.VITE_API_BASE_URL || "";

  // ===== 鉴权与登录状态 =====
  // 当前会话 Token（登录成功后签发；存在即视为已登录）
  const [sessionToken, setSessionToken] = useState<string | null>(
    () => sessionStorage.getItem("DNSHE_SESSION") || localStorage.getItem("DNSHE_SESSION")
  );
  // 是否已向后端查询过鉴权状态（决定登录页显示"登录"还是"首次设置"）
  const [authStatusLoaded, setAuthStatusLoaded] = useState(false);
  // 系统是否已初始化（设置过管理员密码）
  const [authInitialized, setAuthInitialized] = useState(true);
  // 系统是否已开启 2FA（登录页直接展示动态码输入框）
  const [authTwoFaEnabled, setAuthTwoFaEnabled] = useState(false);
  // 本次登录是否需要 2FA 动态码（后端返回 need_2fa 时置真）
  const [loginNeeds2fa, setLoginNeeds2fa] = useState(false);

  // 登录表单状态
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginTotp, setLoginTotp] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  // 首次初始化表单状态
  const [setupUsername, setSetupUsername] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupPassword2, setSetupPassword2] = useState("");

  // ===== 账户安全（设置页）状态 =====
  // 当前账户信息（用户名 + 2FA 是否开启）
  const [accountInfo, setAccountInfo] = useState<{ username: string; two_fa_enabled: boolean }>({ username: "", two_fa_enabled: false });
  // 修改密码表单
  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwNew2, setPwNew2] = useState("");
  const [pwNewUsername, setPwNewUsername] = useState("");
  // 2FA 开启流程：生成的密钥与二维码 URI，以及验证动态码
  const [twoFaSetup, setTwoFaSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [twoFaEnableToken, setTwoFaEnableToken] = useState("");
  // 关闭 2FA 时的动态码确认
  const [twoFaDisableToken, setTwoFaDisableToken] = useState("");

  /**
   * 统一 API 请求封装 — 自动注入 Authorization 头部与后端 Worker 基准域名
   */
  const apiFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    // 从会话存储获取登录后签发的 Session Token
    const token = sessionStorage.getItem("DNSHE_SESSION") || localStorage.getItem("DNSHE_SESSION");
    const storedBackend = backendUrl || localStorage.getItem("DNSHE_BACKEND_URL") || (import.meta as any).env?.VITE_API_BASE_URL;

    // 如果传入相对路径以 /api 开头，智能补全后端基准域名
    //
    // NOTE: 此处不再按当前域名猜测后端地址（原先会拼出 https://api-dnshe.<主域名>）。
    //       那个约定并不成立：Worker 未绑同名自定义域名时该主机根本不解析，
    //       请求只会以一句 Failed to fetch 结束，反而掩盖了「后端地址未配置」这个真实原因。
    //       地址来源现在只有两个：用户在设置页保存的覆盖值，以及构建期烘焙的 VITE_API_BASE_URL。
    let finalUrl = url;
    if (url.startsWith("/api")) {
      if (storedBackend) {
        finalUrl = `${storedBackend.replace(/\/$/, "")}${url}`;
      } else {
        const host = window.location.hostname;
        const isLocalDev = host === "localhost" || host === "127.0.0.1";
        if (!isLocalDev) {
          // 线上两者皆空：走相对路径只会打到 Pages 自身、被 SPA 兜底返回 HTML，
          // 报错会变成 JSON 解析失败。这里直接给出真实原因。
          throw new Error("未配置后端地址（部署时未能推导出 Worker 地址），请在设置页手动填写后端 Worker 地址");
        }
        // 本地开发走 Vite 代理的相对路径
        finalUrl = url;
      }
    }

    const headers = new Headers(options.headers || {});
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    try {
      const res = await fetch(finalUrl, { ...options, headers });
      if (res.status === 401 || res.status === 403) {
        // 会话失效：清理凭据并回到登录页（登录/初始化/状态接口自身除外，避免误清）
        const isAuthEndpoint = url.startsWith("/api/auth/login") || url.startsWith("/api/auth/setup") || url.startsWith("/api/auth/status");
        if (!isAuthEndpoint) {
          sessionStorage.removeItem("DNSHE_SESSION");
          localStorage.removeItem("DNSHE_SESSION");
          setSessionToken(null);
        }
      }
      return res;
    } catch (err) {
      // 遇网络连接异常自动提示配置后端服务
      console.error("API Fetch Error:", err);
      throw err;
    }
  };

  // NOTE: 这里原先有一份 checkAuthStatus() + 无依赖 useEffect，会在挂载时无条件
  //       请求一次 /api/auth/status。它与下面 [sessionToken] 那个 effect 完全重复：
  //       未登录时冷加载会把这个接口打两遍，已登录时这一次请求的结果又根本用不上
  //       （authStatusLoaded 只在未登录分支里被读取）。已删除，只保留会在已登录时
  //       提前 return 的那一个。

  // 保存会话 Token 并进入系统
  //
  // NOTE: 这里刻意不再把 backendUrl 写回 localStorage。backendUrl 在用户没有手动配置时
  //       等于构建期烘焙的 VITE_API_BASE_URL，一旦登录成功就被冻结进 localStorage，
  //       而 localStorage 的优先级又高于烘焙值 —— 之后 CI 重新检测出的新后端地址会被
  //       这个旧值永久遮蔽（部署流水线每次都会重新推导该地址：自定义域名 → workers.dev
  //       子域 → 空），表现为换域名/换后端后登录一直 Failed to fetch，且只能靠清站点数据恢复。
  //       localStorage 只应保存用户在设置页显式填写的覆盖值。
  const persistSession = (token: string) => {
    sessionStorage.setItem("DNSHE_SESSION", token);
    setSessionToken(token);
  };

  // 提交登录（用户名 + 密码，若后端要求则附带 2FA 动态码）
  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoginError("");

    if (!loginUsername.trim() || !loginPassword) {
      setLoginError("请输入用户名与密码");
      return;
    }
    if (authTwoFaEnabled && !loginTotp.trim()) {
      setLoginError("请输入 6 位动态验证码");
      return;
    }

    setLoginLoading(true);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
          token: loginTotp.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (data.success && data.session_token) {
        persistSession(data.session_token);
        setLoginPassword("");
        setLoginTotp("");
        setLoginNeeds2fa(false);
        showToast("success", data.message || "🎉 登录成功");
      } else if (data.error_code === "need_2fa") {
        // 密码正确但需要补充动态码
        setLoginNeeds2fa(true);
        setLoginError("请输入身份验证器上的 6 位动态验证码");
      } else if (data.error_code === "not_initialized") {
        setAuthInitialized(false);
        setLoginError("系统尚未初始化，请先设置管理员账户");
      } else {
        setLoginError(data.message || "登录失败");
      }
    } catch (err: any) {
      console.error("Login error:", err);
      // 网络类失败最常见的成因是后端地址不对，且本地覆盖值优先级高于构建期烘焙值，
      // 故直接把当前实际使用的地址与来源写进提示，避免只看到一句 Failed to fetch。
      const override = localStorage.getItem("DNSHE_BACKEND_URL");
      const target = override || backendUrl;
      const hint = target
        ? `当前请求地址：${target}${override ? "（来自本机保存的覆盖值，优先级高于部署时写入的默认地址；如该地址已失效，清除本站点数据即可恢复默认）" : "（来自部署时写入的默认地址）"}`
        : "尚未配置后端地址";
      setLoginError(`登录请求失败：${err?.message || "网络异常"}。${hint}`);
    } finally {
      setLoginLoading(false);
    }
  };

  // 提交首次初始化（自行设置管理员用户名与密码）
  const handleSetup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoginError("");

    if (!setupUsername.trim() || setupUsername.trim().length < 3) {
      setLoginError("用户名至少需要 3 个字符");
      return;
    }
    if (setupPassword.length < 8) {
      setLoginError("密码至少需要 8 个字符");
      return;
    }
    if (setupPassword !== setupPassword2) {
      setLoginError("两次输入的密码不一致");
      return;
    }

    setLoginLoading(true);
    try {
      const res = await apiFetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: setupUsername.trim(), password: setupPassword }),
      });
      const data = await res.json();

      if (data.success && data.session_token) {
        persistSession(data.session_token);
        setSetupPassword("");
        setSetupPassword2("");
        setAuthInitialized(true);
        showToast("success", data.message || "🎉 初始化成功");
      } else {
        setLoginError(data.message || "初始化失败");
      }
    } catch (err: any) {
      console.error("Setup error:", err);
      setLoginError(`初始化请求失败：${err?.message || "网络异常"}`);
    } finally {
      setLoginLoading(false);
    }
  };

  // 退出登录
  const handleLogout = () => {
    sessionStorage.removeItem("DNSHE_SESSION");
    localStorage.removeItem("DNSHE_SESSION");
    setSessionToken(null);
    setLoginUsername("");
    setLoginPassword("");
    setLoginTotp("");
    setLoginNeeds2fa(false);
    showToast("info", "已退出登录");
  };

  // 读取账户安全信息（用户名 + 2FA 状态）
  const fetchAccountInfo = async () => {
    try {
      const res = await apiFetch("/api/auth/account");
      const data = await res.json();
      if (data.success) {
        setAccountInfo({ username: data.username || "", two_fa_enabled: !!data.two_fa_enabled });
      }
    } catch (e) {
      // 静默失败，设置页其余部分仍可用
    }
  };

  // 修改密码（可选同时改用户名）
  const handleChangePassword = async () => {
    if (!pwOld) {
      showToast("error", "请输入原密码");
      return;
    }
    if (pwNew.length < 8) {
      showToast("error", "新密码至少需要 8 个字符");
      return;
    }
    if (pwNew !== pwNew2) {
      showToast("error", "两次输入的新密码不一致");
      return;
    }
    setActionLoading("change-pw");
    try {
      const payload: Record<string, string> = { old_password: pwOld, new_password: pwNew };
      // 与当前用户名相同时不下发 username：避免浏览器把当前用户名预填进「同时修改用户名」
      // 之后，提交时产生一次毫无意义的改名写入与日志。
      const wantUsername = pwNewUsername.trim();
      if (wantUsername && wantUsername !== (accountInfo.username || "")) {
        payload.username = wantUsername;
      }
      const res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", data.message || "密码修改成功，请重新登录");
        setPwOld(""); setPwNew(""); setPwNew2(""); setPwNewUsername("");
        // 密码已变更，当前会话作废，强制重新登录
        setTimeout(() => handleLogout(), 1500);
      } else {
        showToast("error", data.message || "修改密码失败");
      }
    } catch (e) {
      showToast("error", "修改密码请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 第一步：生成 2FA 密钥与二维码
  const handleStart2faSetup = async () => {
    setActionLoading("2fa-setup");
    try {
      const res = await apiFetch("/api/auth/2fa/setup", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setTwoFaSetup({ secret: data.secret, otpauth_uri: data.otpauth_uri });
        setTwoFaEnableToken("");
      } else {
        showToast("error", data.message || "生成 2FA 密钥失败");
      }
    } catch (e) {
      showToast("error", "生成 2FA 密钥请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 第二步：输入动态码正式开启 2FA
  const handleEnable2fa = async () => {
    if (!twoFaEnableToken.trim()) {
      showToast("error", "请输入身份验证器上的 6 位动态码");
      return;
    }
    setActionLoading("2fa-enable");
    try {
      const res = await apiFetch("/api/auth/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: twoFaEnableToken.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", data.message || "两步验证已开启");
        setTwoFaSetup(null);
        setTwoFaEnableToken("");
        fetchAccountInfo();
      } else {
        showToast("error", data.message || "开启 2FA 失败");
      }
    } catch (e) {
      showToast("error", "开启 2FA 请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 关闭 2FA（需输入当前动态码确认）
  const handleDisable2fa = async () => {
    if (!twoFaDisableToken) {
      showToast("error", "请输入身份验证器上的 6 位动态码以确认关闭 2FA");
      return;
    }
    setActionLoading("2fa-disable");
    try {
      const res = await apiFetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: twoFaDisableToken }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", data.message || "两步验证已关闭");
        setTwoFaDisableToken("");
        fetchAccountInfo();
      } else {
        showToast("error", data.message || "关闭 2FA 失败");
      }
    } catch (e) {
      showToast("error", "关闭 2FA 请求失败");
    } finally {
      setActionLoading(null);
    }
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
  const showToast = (type: "success" | "error" | "info" | "warning", message: string) => {
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

  const detectDnsProvider = (nameservers: string[]): string => {
    const hosts = nameservers
      .map((value) => value.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean);
    const matchesDomain = (host: string, domain: string) =>
      host === domain || host.endsWith(`.${domain}`);

    if (hosts.some((host) => matchesDomain(host, "vps8.zz.cd"))) return "vps8";
    if (hosts.some((host) => matchesDomain(host, "ns.cloudflare.com"))) return "Cloudflare";
    if (hosts.some((host) =>
      matchesDomain(host, "dnspod.net") ||
      matchesDomain(host, "dnspod.com") ||
      matchesDomain(host, "dnsv.com") ||
      /(^|\.)dnsv[1-5]\.com$/.test(host)
    )) return "DNSPod";
    if (hosts.some((host) => matchesDomain(host, "vercel-dns.com"))) return "Vercel";
    return "外部 DNS";
  };

  const getDnsProviderLabel = (dom: Domain, records?: DnsRecord[]): string => {
    if (checkHasDns(dom)) return "系统默认";
    if (records) {
      return detectDnsProvider(
        records.filter((record) => record.type === "NS").map((record) => String(record.content || ""))
      );
    }
    return dom.dns_provider && dom.dns_provider !== "external"
      ? dom.dns_provider
      : "外部 DNS";
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
        <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-800/60">
          已委派
        </span>
      );
    }
    if (statusText === "已解析") {
      return (
        <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-900/60">
          已解析
        </span>
      );
    }
    return (
      <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-elevated text-content-muted border border-border-base">
        未解析
      </span>
    );
  };

  // 渲染单个域名卡片
  const renderDomainCard = (dom: Domain) => {
    const unicodeDomain = toUnicode(dom.full_domain);

    const handleCopyDomain = () => {
      navigator.clipboard.writeText(dom.full_domain).then(() => {
        showToast("success", `已复制：${dom.full_domain}`);
      }).catch(() => {
        showToast("error", "复制失败，请手动选择");
      });
    };

    return (
      <div
        key={dom.id}
        className="bg-surface border border-border-base hover:border-border-base rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 shadow-xl"
      >
        {/* 顶部：域名名称与状态 */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={handleCopyDomain}
            /* 手机上小一号字号，让常见长度的域名不必省略；超长域名仍截断，
               但 title 与「点击复制」拿到的都是完整域名 */
            className="font-mono text-sm sm:text-base font-bold text-content-primary tracking-wide truncate min-w-0 hover:text-indigo-400 transition-colors cursor-pointer text-left"
            title={`点击复制：${dom.full_domain}`}
          >
            {unicodeDomain}
          </button>
          {renderStatusBadge(dom)}
        </div>

      {/* 中间：注册时间与到期时间 */}
      <div className="mt-4 space-y-2 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-content-muted font-medium">注册时间</span>
          <span className="font-mono text-content-secondary">{formatDate(dom.created_at, false)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-content-muted font-medium">到期时间</span>
          <span className="font-mono text-content-secondary">{formatDate(dom.expires_at, true)}</span>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="border-t border-border-base my-3.5" />

      {/* 当前 DNS 服务器 */}
      <div className="flex justify-between items-center text-xs">
        <span className="text-content-muted font-medium">当前 DNS 服务器</span>
        {checkHasDns(dom) ? (
          <span className="bg-elevated text-content-secondary border border-border-base text-xs font-medium px-2.5 py-0.5 rounded-md">
            系统默认
          </span>
        ) : (
          <span className="bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-800/60 text-xs font-medium px-2.5 py-0.5 rounded-md">
            {getDnsProviderLabel(dom)}
          </span>
        )}
      </div>

      {/* 分隔线 */}
      <div className="border-t border-border-base my-3.5" />

      {/* 底部：DNS 按钮与更多三点下拉菜单 */}
      <div className="flex items-center justify-end gap-3 relative">
        <button
          onClick={() => handleOpenDnsModal(dom)}
          disabled={!checkHasDns(dom)}
          className={`text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition-all shadow-inner ${
            checkHasDns(dom)
              ? "bg-elevated hover:bg-hovered text-content-secondary cursor-pointer"
              : "bg-elevated text-content-muted opacity-50 cursor-not-allowed"
          }`}
        >
          <Settings className={`w-3.5 h-3.5 ${checkHasDns(dom) ? "text-content-muted" : "text-content-muted"}`} /> DNS
        </button>

        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenActionMenuId(openActionMenuId === dom.id ? null : dom.id);
            }}
            className="p-2 hover:bg-hovered text-content-muted hover:text-content-primary rounded-lg transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {/* 三点下拉操作菜单 */}
          {openActionMenuId === dom.id && (
            <div 
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 bottom-10 z-30 w-40 bg-elevated border border-border-base rounded-xl shadow-2xl overflow-hidden text-xs py-1 animate-in fade-in zoom-in-95"
            >
              <button
                onClick={() => {
                  setOpenActionMenuId(null);
                  handleOpenNsModal(dom);
                }}
                className="w-full text-left px-3.5 py-2.5 hover:bg-hovered text-content-secondary hover:text-content-primary flex items-center gap-2"
              >
                <Server className="w-3.5 h-3.5 text-content-muted" /> 修改 NS 记录
              </button>
              
              <button
                onClick={() => {
                  setOpenActionMenuId(null);
                  handleRenewDomain(dom);
                }}
                disabled={actionLoading === `renew-${dom.id}`}
                className="w-full text-left px-3.5 py-2.5 hover:bg-hovered text-content-secondary hover:text-content-primary flex items-center gap-2 border-t border-border-base"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-content-muted ${actionLoading === `renew-${dom.id}` ? "animate-spin" : ""}`} />
                续期域名
              </button>

              <button
                onClick={() => {
                  setOpenActionMenuId(null);
                  handleOpenDeleteModal(dom);
                }}
                className="w-full text-left px-3.5 py-2.5 hover:bg-rose-50 text-rose-600 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:text-rose-400 dark:hover:text-rose-300 flex items-center gap-2 border-t border-border-base"
              >
                <Trash2 className="w-3.5 h-3.5" /> 删除域名
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

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

  // 2.5 读取某账号域名缓存的「指纹」：域名条数 + 最新的 updated_at
  //
  // NOTE: 后端每个账号的域名是在一次 db.batch 里整批写入的，所以指纹一变
  //       就说明该账号这一轮后台同步已经落库。新绑定账号从「0 条」变为有域名，
  //       换 Key 重新同步则是 updated_at 被刷新，两种场景都能用同一个信号判断。
  const readAccountDomainFingerprint = async (accountId: number): Promise<string | null> => {
    try {
      const res = await apiFetch(`/api/domains?account_id=${accountId}`);
      const data = await res.json();
      if (!data.success) return null;
      const list: Array<Record<string, unknown>> = data.domains || [];
      const newest = list.reduce((max, d) => {
        const v = String(d.updated_at || "");
        return v > max ? v : max;
      }, "");
      return `${list.length}:${newest}`;
    } catch (e) {
      return null;
    }
  };

  // 2.6 等待账号的域名在后端落库后再刷新列表
  //
  // NOTE: 绑定 / 换 Key 接口里的域名同步是 waitUntil 后台任务（逐个域名拉解析记录
  //       判定三态），接口返回「成功」时库里通常还没写完。原先紧接着调 fetchDomains()
  //       只会拿到空列表或旧数据，看起来像「账号绑上了却没有域名」，只能手动刷新页面。
  const waitForAccountDomainSync = async (
    accountIds: number[],
    label: string,
    baseline?: Map<number, string>
  ) => {
    const pending = new Set(accountIds.filter((id) => Number.isFinite(id) && id > 0));
    if (pending.size === 0) {
      fetchDomains();
      return;
    }

    showToast("info", `${label}，正在后台同步域名，完成后自动刷新…`);

    // 后端逐个账号同步，账号之间还有 1.2s 间隔，等待预算随账号数增长
    const deadline = Date.now() + 15_000 + pending.size * 8_000;

    while (pending.size > 0 && Date.now() < deadline) {
      await sleep(1500);

      // 轮询期间会话失效（登出 / 过期）就不再空转
      if (!sessionStorage.getItem("DNSHE_SESSION") && !localStorage.getItem("DNSHE_SESSION")) return;

      // 逐个账号单独查询，不受域名页当前账号筛选影响
      for (const id of [...pending]) {
        const fingerprint = await readAccountDomainFingerprint(id);
        // 查询失败（null）不终止等待，下一轮继续
        if (fingerprint !== null && fingerprint !== (baseline?.get(id) ?? "0:")) {
          pending.delete(id);
        }
      }
    }

    // 无论是否等齐都刷新一次列表，让已完成的账号立即可见
    fetchDomains();
    // 后端在同步域名之前已经刷过这些账号的配额缓存，这里顺带把配额也拉新
    invalidateQuotaTabCache();
    fetchQuotas();

    if (pending.size === 0) {
      showToast("success", "域名同步完成，列表已刷新");
    } else {
      showToast(
        "warning",
        `${pending.size} 个账号暂未同步到域名（可能仍在后台进行，也可能该账号名下确实没有域名），可稍后点击「同步所有账号」`
      );
    }
  };

  // 3. 获取配额列表（默认命中缓存，forceRefresh 时强制回源刷新）
  const fetchQuotas = async (forceRefresh = false) => {
    setLoadingQuotas(true);
    try {
      const res = await apiFetch(`/api/quota${forceRefresh ? "?refresh=1" : ""}`);
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

  // 5. 获取应用设置
  const fetchSettings = async () => {
    setLoadingSettings(true);
    try {
      const res = await apiFetch("/api/settings");
      const data = await res.json();
      if (data.success && data.settings) {
        setSettings((prev) => ({ ...prev, ...data.settings }));
        if (data.configured) setSettingsConfigured(data.configured);
      }
    } catch (e) {
      showToast("error", "获取设置失败");
    } finally {
      setLoadingSettings(false);
    }
  };

  // 保存应用设置
  const handleSaveSettings = async () => {
    setActionLoading("save-settings");
    try {
      // 敏感字段：若仍是打码占位（已配置且用户未改动），则不提交，避免覆盖
      const payload: Record<string, string> = {
        webhook_type: settings.webhook_type,
        tg_chat_id: settings.tg_chat_id,
        renew_threshold_days: settings.renew_threshold_days,
        auto_renew: settings.auto_renew,
      };
      if (settings.tg_token && !settings.tg_token.startsWith("****")) payload.tg_token = settings.tg_token;
      if (settings.webhook_url && !settings.webhook_url.startsWith("****")) payload.webhook_url = settings.webhook_url;

      const res = await apiFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", "✅ 设置已保存");
        fetchSettings();
      } else {
        showToast("error", data.message || "保存设置失败");
      }
    } catch (e) {
      showToast("error", "保存设置网络请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 测试 Telegram 推送
  const handleTestTelegram = async () => {
    setActionLoading("test-tg");
    try {
      const payload: Record<string, string> = { tg_chat_id: settings.tg_chat_id };
      if (settings.tg_token && !settings.tg_token.startsWith("****")) payload.tg_token = settings.tg_token;
      const res = await apiFetch("/api/settings/test-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", data.message || "测试消息已发送");
      } else {
        showToast("error", data.message || "测试推送失败");
      }
    } catch (e) {
      showToast("error", "测试推送网络请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 保存本地后端地址
  const handleSaveBackendUrl = () => {
    const v = backendUrlInput.trim().replace(/\/$/, "");
    if (v) {
      localStorage.setItem("DNSHE_BACKEND_URL", v);
      showToast("success", "后端地址已保存，即将刷新页面生效");
    } else {
      localStorage.removeItem("DNSHE_BACKEND_URL");
      showToast("info", "已清除自定义后端地址");
    }
    setBackendUrlEditing(false);
    setTimeout(() => window.location.reload(), 1200);
  };

  // 取消编辑，恢复已保存的值并收起输入框
  const handleCancelBackendUrl = () => {
    setBackendUrlInput(localStorage.getItem("DNSHE_BACKEND_URL") || "");
    setBackendUrlEditing(false);
  };

  // 未登录时向后端查询鉴权状态，决定登录页展示"登录"还是"首次设置"
  useEffect(() => {
    if (sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/auth/status");
        const data = await res.json();
        if (!cancelled && data.success) {
          setAuthInitialized(!!data.initialized);
          setAuthTwoFaEnabled(!!data.two_fa_enabled);
        }
      } catch (e) {
        // 网络异常时保持默认（已初始化），仍展示登录表单
      } finally {
        if (!cancelled) setAuthStatusLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  // 切换选项卡时同步 URL hash；浏览器前进/后退或手动改 hash 时同步回 state
  useEffect(() => {
    const syncFromHash = () => {
      const next = tabFromHash();
      setActiveTab((prev) => (prev === next ? prev : next));
    };
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  useEffect(() => {
    const want = `#${activeTab}`;
    if (window.location.hash !== want) {
      window.location.hash = want;
    }
  }, [activeTab]);

  // 会话建立后拉取一次全局数据（账号列表 + 全量域名列表）
  //
  // NOTE: 这两个请求原先和下面的标签页数据挤在同一个 [activeTab, sessionToken] effect 里，
  //       于是每切一次标签页就要重新拉一遍账号和全量域名——两个请求各自都要付
  //       「ensureTables + 校验 session + 真实查询」的串行 D1 往返，切页因此固定卡两秒。
  //       它们是侧栏徽标与各页共用的全局数据，跟当前在哪个标签页无关，所以只挂 sessionToken。
  //       增删改、续期、同步等操作后，各自的处理函数里已经显式调用了
  //       fetchAccounts() / fetchDomains() 刷新，不依赖切页来触发。
  // 标签页专属数据的「上次拉取时刻」，用于避免每次点击标签页都重新请求一遍
  const tabDataFetchedAtRef = useRef<Record<string, number>>({});

  // 账号增删改后让「账户配额」页的时效缓存失效
  //
  // NOTE: 配额是按账号聚合的，账号集合一变它就过时了。后端已按账号粒度维护配额缓存，
  //       但前端这层还有 60 秒时效判断——不主动失效的话，解绑账号后立刻切到配额页
  //       仍会显示刚删掉的账号，只能等 60 秒或点「刷新」。
  const invalidateQuotaTabCache = () => {
    delete tabDataFetchedAtRef.current.quota;
  };

  useEffect(() => {
    if (!sessionToken) return;
    // 换会话（登录 / 重新登录）时清空时效记录，让下面的按需拉取重新跑一轮
    tabDataFetchedAtRef.current = {};
    fetchAccounts();
    fetchDomains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  // 按当前 ActiveTab 拉取该页专属数据（仅在已登录时触发）
  //
  // NOTE: 这里原先每次切到对应标签页都会无条件重新请求一遍，来回点几下
  //       「设置 / 运行日志 / 账户配额」就是好几轮 D1 往返的白等。改为带时效判断：
  //       日志与配额 60 秒内不重复拉；设置与账户信息只在本次会话首次进入时拉一次
  //       —— 它们只会通过本界面修改，而保存设置、改密码、开关 2FA 等处理函数
  //       已经各自显式调用了对应的 fetch 刷新，不依赖切页触发。
  //       时间戳在发起请求前就写入，这样快速连点同一个标签页也不会打出重复请求。
  useEffect(() => {
    if (!sessionToken) return;
    const now = Date.now();
    const fetchIfStale = (key: string, ttlMs: number, run: () => void) => {
      const last = tabDataFetchedAtRef.current[key];
      if (last !== undefined && now - last < ttlMs) return;
      tabDataFetchedAtRef.current[key] = now;
      run();
    };

    if (activeTab === "dashboard" || activeTab === "logs") {
      fetchIfStale("logs", 60_000, fetchLogs);
    } else if (activeTab === "quota") {
      fetchIfStale("quota", 60_000, fetchQuotas);
    } else if (activeTab === "settings") {
      fetchIfStale("settings", Infinity, fetchSettings);
      fetchIfStale("account", Infinity, fetchAccountInfo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, sessionToken]);

  // 域名搜索索引：full_domain 在库中一律以 Punycode(xn--) 存储，
  // 而列表展示的是解码后的中文，直接拿中文关键词匹配 ASCII 串永远搜不到。
  // 这里为每个域名预计算「Punycode 原文 + 中文解码」两种形态供匹配。
  const domainSearchIndex = useMemo(() => {
    const map = new Map<number, string>();
    domains.forEach((d) => {
      const ascii = (d.full_domain || "").toLowerCase();
      const unicode = toUnicode(d.full_domain || "").toLowerCase();
      map.set(d.id, ascii === unicode ? ascii : `${ascii} ${unicode}`);
    });
    return map;
  }, [domains]);

  // 账号序号：以 accounts 列表的顺序为准，而不是分组数组的下标。
  //
  // 分组数组会被搜索/账号筛选裁剪，用它的下标当序号会导致「只看某个账号时永远显示账号 1」。
  // 锚定到 accounts 后，序号在任何筛选下都保持不变，删除账号后又会自然重排。
  const accountSeqMap = useMemo(() => {
    const map = new Map<number, number>();
    accounts.forEach((a, i) => map.set(a.id, i + 1));
    return map;
  }, [accounts]);

  // 按账号分组处理域名列表
  const groupedDomains = useMemo(() => {
    const kw = globalSearch.trim().toLowerCase();
    // 关键词本身也转一次 Punycode：用户粘贴完整中文域名时可直接命中 ASCII 形态。
    // 注意中文「部分匹配」依赖上面的解码形态，因为半个标签的 Punycode 编码
    // 并不是整标签编码的子串。
    const kwAscii = kw ? toASCII(kw).toLowerCase() : "";
    const source = kw
      ? domains.filter((d) => {
          const hay = domainSearchIndex.get(d.id) || "";
          return hay.includes(kw) || (kwAscii !== kw && hay.includes(kwAscii));
        })
      : domains;
    const map = new Map<string, { alias: string; accountId: number; seq: number; domains: Domain[] }>();
    source.forEach((dom) => {
      const key = String(dom.account_id || 0);
      if (!map.has(key)) {
        map.set(key, {
          alias: dom.account_alias || `账号 ${dom.account_id}`,
          accountId: dom.account_id,
          // 已解绑账号的历史域名拿不到序号，用 0 表示（渲染处退化为只显示别名）
          seq: accountSeqMap.get(dom.account_id) ?? 0,
          domains: []
        });
      }
      map.get(key)!.domains.push(dom);
    });
    // 按账号序号排序，让卡片顺序与「账号管理」一致且不随筛选变化；
    // 无序号的（已解绑账号遗留）排在最后
    return Array.from(map.values()).sort((a, b) => {
      if (a.seq === 0) return 1;
      if (b.seq === 0) return -1;
      return a.seq - b.seq;
    });
  }, [domains, globalSearch, domainSearchIndex, accountSeqMap]);

  // 当前搜索命中的域名总数 —— 供筛选栏提示使用。
  //
  // NOTE: 表头的「托管域名: N 个」读的是 domains.length（总数），搜索过滤发生在渲染层，
  //       两个数字不一致时很容易被误读成「账号和域名凭空少了一大半」。
  //       把命中数显式摆出来，让过滤状态不再是隐形的。
  const searchHitCount = useMemo(
    () => groupedDomains.reduce((n, g) => n + g.domains.length, 0),
    [groupedDomains]
  );

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

  // 绑定新账号（别名可选，留空时后端自动从 API Key 解析密钥名称）
  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newApiKey.trim() || !newApiSecret.trim()) {
      showToast("error", "API Key 与 API Secret 为必填项！");
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
        showToast("success", `账号 [${data.account?.alias || newAlias || newApiKey}] 验证并绑定成功！`);
        setNewAlias("");
        setNewApiKey("");
        setNewApiSecret("");
        setBindModal(null);
        fetchAccounts();
        // 域名由后端 waitUntil 后台深度同步，轮询等它落库后再刷新列表
        waitForAccountDomainSync(
          [Number(data.account?.id)],
          `账号 [${data.account?.alias || newApiKey}] 绑定成功`
        );
      } else {
        showToast("error", data.message || "账号绑定失败，请检查密钥是否正确");
      }
    } catch (err) {
      showToast("error", "绑定请求发送失败，请检查网络");
    } finally {
      setActionLoading(null);
    }
  };

  // 批量绑定账号（每行一条：API Key + API Secret，支持空格/逗号/Tab 等分隔，别名留空自动解析）
  const handleBatchAddAccounts = async () => {
    const lines = batchInput
      .split(/[\n;；]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      showToast("error", "请先粘贴至少一条 API Key 与 API Secret");
      return;
    }
    if (lines.length > 50) {
      showToast("error", "单次最多批量绑定 50 个账号");
      return;
    }

    let parsed: Array<{ alias: string; api_key: string; api_secret: string }> = [];

    // 兼容 JSON 数组格式：[{"api_key":"cfsd_xx","api_secret":"yy","alias":"可选"}]
    try {
      const jsonParsed = JSON.parse(batchInput.trim());
      if (Array.isArray(jsonParsed) && jsonParsed.length > 0 && jsonParsed[0]?.api_key) {
        parsed = jsonParsed.map((it) => ({
          alias: it.alias ? String(it.alias).trim() : "",
          api_key: String(it.api_key).trim(),
          api_secret: String(it.api_secret).trim(),
        }));
      }
    } catch (e) {
      // 非 JSON，走逐行解析
    }

    // 逐行解析：key 与 secret 用空格 / Tab / 逗号 / 竖线 分隔
    if (parsed.length === 0) {
      let invalidLines = 0;
      for (const line of lines) {
        const parts = line.split(/[\s,，|]+/).map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          parsed.push({
            api_key: parts[0],
            api_secret: parts[1],
            alias: parts.length >= 3 ? parts.slice(2).join(" ") : "",
          });
        } else {
          invalidLines++;
        }
      }
      if (invalidLines > 0) {
        showToast("warning", `${invalidLines} 行格式不正确（每行需包含 API Key 与 API Secret），已自动跳过`);
      }
    }

    if (parsed.length === 0) {
      showToast("error", "未能解析出任何有效的账号信息，请检查输入格式");
      return;
    }

    setActionLoading("batch-add-accounts");
    setBatchResults(null);
    try {
      const res = await apiFetch("/api/accounts/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: parsed }),
      });
      const data = await res.json();
      if (data.success) {
        setBatchResults(data.results || []);
        showToast("success", data.message || "批量绑定完成");
        setBatchInput("");
        fetchAccounts();
        // 后端按账号串行同步（每个间隔 1.2s），轮询等这批账号的域名全部落库
        waitForAccountDomainSync(
          (data.account_ids || []).map(Number),
          `${(data.account_ids || []).length} 个账号绑定成功`
        );
      } else {
        showToast("error", data.message || "批量绑定失败");
      }
    } catch (err) {
      showToast("error", "批量绑定请求发送失败，请检查网络");
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
        // 后端已从配额缓存中摘掉该账号，同步刷新配额列表，避免配额页还列着它
        invalidateQuotaTabCache();
        fetchQuotas();
      } else {
        showToast("error", data.message || "账户解绑失败");
      }
    } catch (e) {
      showToast("error", "解绑请求发送失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 打开修改账号弹窗
  const openEditAccount = (acc: Account) => {
    setEditingAccount(acc);
    setEditAlias(acc.alias);
    setEditApiKey("");
    setEditApiSecret("");
  };

  // 提交修改账号（可仅改别名，或同时更换 API Key/Secret）
  const handleUpdateAccount = async () => {
    if (!editingAccount) return;
    if (!editAlias.trim()) {
      showToast("error", "账户别名不能为空");
      return;
    }
    if (Boolean(editApiKey.trim()) !== Boolean(editApiSecret.trim())) {
      showToast("error", "更换 API 密钥时，API Key 与 API Secret 需同时填写（留空则保持不变）");
      return;
    }
    setActionLoading(`update-account-${editingAccount.id}`);
    const accountId = editingAccount.id;
    try {
      const body: Record<string, string> = { alias: editAlias.trim() };
      const keyChanged = Boolean(editApiKey.trim() && editApiSecret.trim());
      if (keyChanged) {
        body.api_key = editApiKey.trim();
        body.api_secret = editApiSecret.trim();
      }

      // 换 Key 会触发后台重新深度同步，先记下当前指纹作为「同步已生效」的对照基线
      const baseline = new Map<number, string>();
      if (keyChanged) {
        const current = await readAccountDomainFingerprint(accountId);
        if (current !== null) baseline.set(accountId, current);
      }

      const res = await apiFetch(`/api/accounts/${accountId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", data.message || "账号信息已更新");
        setEditingAccount(null);
        fetchAccounts();
        if (keyChanged) {
          // 只改别名时后端不会重新同步域名，没必要轮询
          waitForAccountDomainSync([accountId], "API 密钥已更换", baseline);
        } else {
          fetchDomains();
          // 后端已就地改掉配额缓存里的别名，刷新一次让配额页的标题跟上
          invalidateQuotaTabCache();
          fetchQuotas();
        }
      } else {
        // 密钥框非空却失败，多半是被密码管理器预填的登录凭据当成了新密钥送去校验
        const hint = keyChanged ? "（若 API Key/Secret 是浏览器自动填充的，请清空这两个框后重试）" : "";
        showToast("error", `${data.message || "更新账号失败"}${hint}`);
      }
    } catch (e) {
      showToast("error", "更新账号请求失败");
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

  // 删除确认校验：中文原文与 Punycode 两种写法都算通过（与后端校验规则保持一致）
  const isDeleteConfirmed = (domain: Domain, input: string) => {
    const typed = input.trim().toLowerCase();
    if (!typed) return false;
    const expected = (domain.full_domain || "").toLowerCase();
    return typed === expected || toASCII(typed).toLowerCase() === expected;
  };

  // 打开删除确认弹窗
  const handleOpenDeleteModal = (domain: Domain) => {
    setDeleteModalDomain(domain);
    setDeleteConfirmInput("");
    setDeleteError("");
  };

  // 执行删除域名（不可逆）
  const handleDeleteDomain = async () => {
    if (!deleteModalDomain) return;
    const dom = deleteModalDomain;

    setActionLoading(`delete-${dom.id}`);
    setDeleteError("");
    try {
      const res = await apiFetch(`/api/domains/${dom.id}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_domain: deleteConfirmInput.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", `域名 [${toUnicode(dom.full_domain)}] 已删除`);
        setDeleteModalDomain(null);
        setDeleteConfirmInput("");
        fetchDomains();
      } else {
        // 限制类错误（存在解析记录 / 转赠 / ServerHold / PendingDelete）保留弹窗并就地展示原因
        setDeleteError(data.message || "删除失败");
      }
    } catch (e) {
      setDeleteError("删除请求发生网络异常");
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

  // 一键恢复为系统默认 NS / 清理残留 NS 记录（两者都是删除区域内的 NS 解析记录）
  const handleResetToDefaultNs = async () => {
    if (!nsModalDomain) return;
    const isDefaultNs = checkHasDns(nsModalDomain);
    const confirmMsg = isDefaultNs
      ? `域名 [${nsModalDomain.full_domain}] 已委派回系统默认 NS，确定清理区域内残留的 ${nsRecords.length} 条 NS 解析记录吗？`
      : `确定要将域名 [${nsModalDomain.full_domain}] 恢复为系统默认 NS 吗？这会清除当前配置的第三方 NS 记录。`;
    if (!confirm(confirmMsg)) return;

    setActionLoading("reset-ns");
    try {
      // 逐条删除并检查每条的业务结果 —— apiFetch 只在网络层失败时抛异常，
      // 后端返回 {success:false} 时不会抛，若不检查就会误报"恢复成功"而记录仍在。
      const failed: Array<{ ns: string; msg: string }> = [];
      let nsDisabled = false;

      for (const rec of nsRecords) {
        const label = rec.content || rec.name || String(rec.id ?? rec.record_id);
        try {
          const res = await apiFetch(`/api/domains/${nsModalDomain.id}/dns/${rec.id ?? rec.record_id}`, {
            method: "DELETE"
          });
          const data = await res.json().catch(() => ({ success: res.ok }));
          if (!data.success) {
            if (data.error_code === "ns_management_disabled") nsDisabled = true;
            failed.push({ ns: label, msg: data.message || `HTTP ${res.status}` });
          }
        } catch (err) {
          failed.push({ ns: label, msg: err instanceof Error ? err.message : "请求异常" });
        }
      }

      if (failed.length === 0) {
        showToast(
          "success",
          isDefaultNs
            ? `已清理 ${nsRecords.length} 条残留 NS 记录`
            : `域名 [${nsModalDomain.full_domain}] 已成功恢复为系统默认 NS！`
        );
        setNsModalOpen(false);
      } else {
        showToast(
          "error",
          nsDisabled
            ? "DNSHE 上游平台已禁用 NS 管理，无法通过 API 删除 NS 记录。请前往 DNSHE 官网后台手动设置。"
            : `${failed.length} 条 NS 记录删除失败：${failed.map(f => `${f.ns}(${f.msg})`).join("；")}`
        );
        // 失败时保持弹窗打开并刷新列表，让实际剩余记录可见
        handleOpenNsModal(nsModalDomain);
      }
      handleSyncDomains();
    } catch (e) {
      showToast("error", "恢复系统默认 NS 发生异常");
    } finally {
      setActionLoading(null);
    }
  };

  // 把 NS 输入框内容解析为去重后的地址列表（换行/逗号/空格分隔，去掉末尾的根点）
  const parseNsInput = (text: string): string[] =>
    Array.from(
      new Set(
        text
          .split(/[,，;；\s\n]+/)
          .map(s => s.trim().replace(/\.$/, "").toLowerCase())
          .filter(Boolean)
      )
    );

  // 输入框实时解析结果，供表单显示「已识别 N 条」
  const parsedNsList = useMemo(() => parseNsInput(newCustomNsContent), [newCustomNsContent]);

  // 添加自定义 NS 记录 (支持一次填多个，逐条提交；并可自动清理与 NS 冲突的同名记录)
  const handleAddCustomNs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nsModalDomain) return;

    // NS 委派通常要求至少主备两条，这里逐条提交
    const nsList = parseNsInput(newCustomNsContent);
    if (nsList.length === 0) return;

    setActionLoading("add-ns");
    try {
      if (forceReplaceConflict) {
        // 1. 先查询当前域名的已有解析记录
        const res = await apiFetch(`/api/domains/${nsModalDomain.id}/dns`);
        const data = await res.json();
        if (data.success && Array.isArray(data.records)) {
          // 2. 筛选出非 NS 类型的冲突记录 (如 A, CNAME, TXT, MX 等)
          const conflicts = data.records.filter((r: DnsRecord) => r.type !== "NS");
          const undeleted: string[] = [];
          for (const conf of conflicts) {
            try {
              const delRes = await apiFetch(
                `/api/domains/${nsModalDomain.id}/dns/${conf.id ?? conf.record_id}`,
                { method: "DELETE" }
              );
              const delData = await delRes.json().catch(() => ({ success: delRes.ok }));
              if (!delData.success) undeleted.push(`${conf.type} ${conf.name}`);
            } catch {
              undeleted.push(`${conf.type} ${conf.name}`);
            }
          }
          // 删不掉要说出来：否则后面 NS 添加失败时，用户会以为是别的原因
          if (undeleted.length > 0) {
            showToast("warning", `${undeleted.length} 条冲突记录未能删除：${undeleted.join("、")}`);
          }
        }
      }

      // 3. 逐条创建 NS 记录。上游接口一次只收一条，且有限频，因此串行提交。
      //    单条失败不中断其余条目，最后统一汇报，避免"加了一半却什么都没说"。
      const succeeded: string[] = [];
      const failed: Array<{ ns: string; msg: string }> = [];
      let nsDisabled = false;

      for (const ns of nsList) {
        try {
          const res = await apiFetch(`/api/domains/${nsModalDomain.id}/dns`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "NS", name: "@", content: ns, ttl: 86400 })
          });
          const data = await res.json();
          if (data.success) {
            succeeded.push(ns);
          } else {
            if (data.error_code === "ns_management_disabled") nsDisabled = true;
            failed.push({ ns, msg: data.message || "添加失败" });
          }
        } catch (err) {
          failed.push({ ns, msg: err instanceof Error ? err.message : "请求异常" });
        }
      }

      if (succeeded.length > 0) {
        showToast("success", `成功添加 ${succeeded.length} 条 NS 记录：${succeeded.join("、")}`);
        setNewCustomNsContent("");
        handleOpenNsModal(nsModalDomain);
        handleSyncDomains();
      }

      if (failed.length > 0) {
        showToast(
          "error",
          nsDisabled
            ? "DNSHE 上游平台已禁用 NS 管理，无法通过 API 修改 NS 记录。请前往 DNSHE 官网后台手动设置。"
            : `${failed.length} 条添加失败：${failed.map(f => `${f.ns}(${f.msg})`).join("；")}${
                succeeded.length === 0 ? "。可尝试勾选【强制替换冲突记录】" : ""
              }`
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "添加 NS 记录发生异常";
      showToast("error", msg);
    } finally {
      setActionLoading(null);
    }
  };

  // 拉取解析记录列表（只刷新列表，不重置弹窗内已展开的表单与批量结果）
  const reloadDnsRecords = async (domain: Domain, forceRefresh = false) => {
    setLoadingDns(true);
    // 记录集合变了，之前的勾选与行内编辑都可能指向已不存在的行，一并作废
    setSelectedDnsKeys(new Set());
    setEditingDnsKey(null);
    // 批量修改面板依赖勾选，勾选清空后面板也没有意义（结果回执保留给用户看）
    setDnsEditPanelOpen(false);

    try {
      const res = await apiFetch(`/api/domains/${domain.id}/dns${forceRefresh ? "?refresh=1" : ""}`);
      const data = await res.json();
      if (data.success) {
        const records: DnsRecord[] = data.records || [];
        setDnsRecords(records);
        // 顺手自学习线路支持名单（数据本来就要读，零额外上游调用）
        learnLineProviderFrom(domain, records);
      } else {
        showToast("error", data.message || "加载 DNS 解析记录失败");
      }
    } catch (e) {
      showToast("error", "加载 DNS 记录发生网络异常");
    } finally {
      setLoadingDns(false);
    }
  };

  // 打开 DNS 管理面板
  const handleOpenDnsModal = async (domain: Domain, forceRefresh = false) => {
    setSelectedDomain(domain);
    setDnsModalOpen(true);
    setDnsRecords([]);
    setDnsFormOpen(false);

    // 初始化表单字段
    setNewDnsName("");
    setNewDnsContent("");
    setNewDnsType("A");
    setNewDnsTtl(600);
    setNewDnsPriority(10);
    setNewDnsLine("");

    // 初始化批量添加面板
    setDnsBatchOpen(false);
    setDnsBatchInput("");
    setDnsBatchType("A");
    setDnsBatchName("@");
    setDnsBatchTtl(600);
    setDnsBatchPriority(10);
    setDnsBatchLine("");
    setDnsBatchResults(null);

    // 初始化批量修改面板
    setDnsEditPanelOpen(false);
    setDnsEditFields({ type: false, name: false, content: false, ttl: true, line: false, priority: false });
    setDnsEditResults(null);

    await reloadDnsRecords(domain, forceRefresh);
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
          priority: needsDnsPriority(newDnsType) ? newDnsPriority : undefined,
          line: newDnsLine || undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", "DNS 解析记录创建成功！");
        setNewDnsName("");
        setNewDnsContent("");
        setDnsFormOpen(false);
        reloadDnsRecords(selectedDomain);
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

  // 进入某条记录的行内编辑态：把当前值灌进编辑表单
  const handleStartEditDnsRecord = (rec: DnsRecord) => {
    setEditingDnsKey(dnsRecordKey(rec));
    setEditDnsType(rec.type || "A");
    // 上游读到的是完整域名，编辑框里要显示相对名（@ / jp），否则改完提交会被上游拒绝
    setEditDnsName(toRelativeRecordName(rec.name, selectedDomain?.full_domain || ""));
    setEditDnsContent(rec.content || "");
    setEditDnsTtl(rec.ttl > 0 ? rec.ttl : 600);
    setEditDnsPriority(rec.priority !== null && rec.priority !== undefined ? rec.priority : 10);
    setEditDnsLine(rec.line || "");
  };

  // 提交行内修改
  const handleUpdateDnsRecord = async (recordId: string | number) => {
    if (!selectedDomain) return;
    if (!editDnsContent.trim()) {
      showToast("error", "解析记录值不能为空！");
      return;
    }

    setActionLoading(`update-dns-${recordId}`);
    try {
      const res = await apiFetch(`/api/domains/${selectedDomain.id}/dns/${recordId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: editDnsType,
          name: editDnsName.trim() || "@",
          content: editDnsContent.trim(),
          ttl: editDnsTtl,
          priority: needsDnsPriority(editDnsType) ? editDnsPriority : undefined,
          line: editDnsLine.trim() || undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", "DNS 解析记录修改成功！");
        setEditingDnsKey(null);
        reloadDnsRecords(selectedDomain);
        fetchDomains();
      } else {
        showToast("error", data.message || "修改解析记录失败");
      }
    } catch (e) {
      showToast("error", "修改解析记录请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 行内编辑的键盘操作：回车保存、Esc 取消（表格行里放不了 <form>，只能手工绑定）
  const handleEditDnsKeyDown = (e: React.KeyboardEvent, recordId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleUpdateDnsRecord(recordId);
    } else if (e.key === "Escape") {
      setEditingDnsKey(null);
    }
  };

  /**
   * 单条解析记录在「桌面表格行」与「手机卡片」两种布局下共用的字段节点
   *
   * NOTE: 表格行必须待在 <tbody> 里、卡片必须在表格外，两种布局无法共用一次 map；
   * 但这 6 个受控输入的定义只写这一份 —— 复制两套的话，日后改一处漏一处，
   * 行内编辑很快就会在其中一种宽度下失灵。
   */
  const dnsRowParts = (rec: DnsRecord) => {
    const key = dnsRecordKey(rec);
    const isEditing = editingDnsKey === key;
    const saving = actionLoading === `update-dns-${key}`;

    return {
      key,
      isEditing,
      // ── 勾选（批量操作用）──
      checkbox: (
        <input
          type="checkbox"
          checked={selectedDnsKeys.has(key)}
          onChange={() => toggleDnsSelection(key)}
          className="w-4 h-4 accent-indigo-500 cursor-pointer align-middle"
        />
      ),
      // ── 编辑态控件 ──
      typeSelect: (
        <select
          value={editDnsType}
          onChange={(e) => setEditDnsType(e.target.value)}
          className="w-full form-input px-1.5 py-1.5 rounded text-xs text-content-secondary"
        >
          {DNS_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.value}</option>
          ))}
        </select>
      ),
      nameInput: (
        <input
          type="text"
          name="dns-edit-name"
          autoComplete="off"
          value={editDnsName}
          onChange={(e) => setEditDnsName(e.target.value)}
          onKeyDown={(e) => handleEditDnsKeyDown(e, key)}
          placeholder="@ 或 jp"
          title={`只能填相对名：@ 代表 ${selectedDomain?.full_domain ?? ""}，jp 代表 jp.${selectedDomain?.full_domain ?? ""}`}
          className="w-full form-input px-2 py-1.5 rounded text-xs font-mono text-content-secondary"
        />
      ),
      contentInput: (
        <input
          type="text"
          name="dns-edit-content"
          autoComplete="off"
          value={editDnsContent}
          onChange={(e) => setEditDnsContent(e.target.value)}
          onKeyDown={(e) => handleEditDnsKeyDown(e, key)}
          placeholder="记录值"
          className="flex-1 min-w-0 form-input px-2 py-1.5 rounded text-xs font-mono text-content-secondary"
        />
      ),
      priorityInput: needsDnsPriority(editDnsType) ? (
        <input
          type="number"
          name="dns-edit-priority"
          autoComplete="off"
          min={0}
          max={65535}
          value={editDnsPriority}
          onChange={(e) => setEditDnsPriority(parseInt(e.target.value, 10) || 0)}
          onKeyDown={(e) => handleEditDnsKeyDown(e, key)}
          title="优先级"
          className="w-16 form-input px-1.5 py-1.5 rounded text-xs text-content-secondary"
        />
      ) : null,
      ttlInput: (
        <input
          type="number"
          name="dns-edit-ttl"
          autoComplete="off"
          min={120}
          max={86400}
          value={editDnsTtl}
          onChange={(e) => setEditDnsTtl(parseInt(e.target.value, 10) || 600)}
          onKeyDown={(e) => handleEditDnsKeyDown(e, key)}
          className="w-full form-input px-1.5 py-1.5 rounded text-xs text-content-secondary"
        />
      ),
      lineInput: (
        <DnsLineSelect
          value={editDnsLine}
          onChange={setEditDnsLine}
          supported={domainSupportsLine(selectedDomain)}
          onKeyDown={(e) => handleEditDnsKeyDown(e, key)}
          className="w-full form-input px-1.5 py-1.5 rounded text-xs text-content-secondary"
        />
      ),
      saveButton: (
        <button
          onClick={() => handleUpdateDnsRecord(key)}
          disabled={saving}
          className="text-emerald-700 hover:text-emerald-800 disabled:opacity-50 p-2 md:p-1 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:text-emerald-300 dark:hover:bg-emerald-950/40 rounded transition-all"
          title="保存修改（回车）"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        </button>
      ),
      cancelButton: (
        <button
          onClick={() => setEditingDnsKey(null)}
          className="text-content-muted hover:text-content-primary p-2 md:p-1 hover:bg-hovered rounded transition-all"
          title="取消（Esc）"
        >
          <X className="w-4 h-4" />
        </button>
      ),
      // ── 展示态操作 ──
      editButton: (
        <button
          onClick={() => handleStartEditDnsRecord(rec)}
          className="text-indigo-600 hover:text-indigo-700 p-2 md:p-1 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:text-indigo-300 dark:hover:bg-indigo-950/40 rounded transition-all"
          title="修改此记录"
        >
          <Pencil className="w-4 h-4" />
        </button>
      ),
      deleteButton: (
        <button
          onClick={() => handleDeleteDnsRecord(key)}
          disabled={actionLoading === `delete-dns-${key}`}
          className="text-red-600 hover:text-red-700 disabled:opacity-50 p-2 md:p-1 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/40 rounded transition-all"
          title="删除此记录"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      ),
    };
  };

  // 删除 DNS 记录
  // NOTE: domain 显式传入 —— NS 弹窗里删除 NS 记录时打开的是 nsModalDomain，
  // 与 DNS 弹窗的 selectedDomain 不一定是同一个域名（甚至可能为 null）。
  const handleDeleteDnsRecord = async (recordId: string | number, domain: Domain | null = selectedDomain) => {
    if (!domain) return;
    if (!confirm("确定要删除这条 DNS 解析记录吗？这会立即影响该域名的解析！")) return;

    setActionLoading(`delete-dns-${recordId}`);
    try {
      const res = await apiFetch(`/api/domains/${domain.id}/dns/${recordId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", "DNS 解析记录删除成功！");
        if (dnsModalOpen && selectedDomain?.id === domain.id) {
          reloadDnsRecords(domain);
        }
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

  // 勾选 / 取消勾选单条记录（用于批量删除）
  const toggleDnsSelection = (key: string) => {
    const next = new Set(selectedDnsKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelectedDnsKeys(next);
  };

  // 全选 / 取消全选当前列表
  const toggleAllDnsSelection = () => {
    if (selectedDnsKeys.size === dnsRecords.length) {
      setSelectedDnsKeys(new Set());
    } else {
      setSelectedDnsKeys(new Set(dnsRecords.map(dnsRecordKey)));
    }
  };

  // 当前勾选的记录（批量修改 / 批量删除共用）
  const selectedDnsRecords = useMemo(
    () => dnsRecords.filter((rec) => selectedDnsKeys.has(dnsRecordKey(rec))),
    [dnsRecords, selectedDnsKeys]
  );

  // 批量修改的目标记录：勾选的字段用新值，其余字段沿用每条记录的原值
  const batchEditTargets = useMemo(
    () =>
      buildDnsEditTargets(
        selectedDnsRecords,
        dnsEditFields,
        {
          type: batchEditType,
          name: batchEditName,
          content: "",
          ttl: batchEditTtl,
          line: batchEditLine,
          priority: batchEditPriority
        },
        selectedDomain?.full_domain || "",
        batchEditContents
      ),
    [
      selectedDnsRecords,
      selectedDomain,
      dnsEditFields,
      batchEditType,
      batchEditName,
      batchEditContents,
      batchEditTtl,
      batchEditLine,
      batchEditPriority
    ]
  );

  // 真正需要提交的记录：合并后与原记录完全一致的跳过，不为没变化的记录白跑一次上游
  const batchEditChanged = useMemo(
    () => batchEditTargets.filter((t) => !t.unchanged),
    [batchEditTargets]
  );

  // 面板里是否需要露出优先级：改成 MX / SRV，或选中的记录里本来就有 MX / SRV
  const batchEditNeedsPriority = dnsEditFields.type
    ? needsDnsPriority(batchEditType)
    : selectedDnsRecords.some((rec) => needsDnsPriority(rec.type));

  // 打开批量修改面板：默认值取第一条选中记录，避免面板一开就是空的
  const handleOpenDnsEditPanel = () => {
    const first = selectedDnsRecords[0];
    if (first) {
      setBatchEditType(first.type || "A");
      setBatchEditName(toRelativeRecordName(first.name, selectedDomain?.full_domain || ""));
      setBatchEditTtl(first.ttl > 0 ? first.ttl : 600);
      setBatchEditLine(first.line || "");
      setBatchEditPriority(first.priority !== null && first.priority !== undefined ? first.priority : 10);
    }
    // 逐条记录值预填各自原值，用户只改需要改的那几行
    setBatchEditContents(
      Object.fromEntries(selectedDnsRecords.map((rec) => [dnsRecordKey(rec), rec.content || ""]))
    );
    setDnsEditResults(null);
    setDnsEditPanelOpen(true);
  };

  // 批量修改已勾选的解析记录（后端串行提交并逐条回执）
  const handleBatchUpdateDnsRecords = async () => {
    if (!selectedDomain || batchEditTargets.length === 0) return;

    const enabled = Object.entries(dnsEditFields).filter(([, on]) => on).map(([k]) => k);
    if (enabled.length === 0) {
      showToast("error", "请至少勾选一个要修改的字段");
      return;
    }
    if (batchEditChanged.length === 0) {
      showToast("info", "选中的记录与当前值一致，没有需要提交的修改");
      return;
    }
    if (batchEditChanged.length > 50) {
      showToast("error", "单次最多批量修改 50 条解析记录");
      return;
    }

    setActionLoading("batch-update-dns");
    setDnsEditResults(null);
    try {
      const res = await apiFetch(`/api/domains/${selectedDomain.id}/dns/batch-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: batchEditChanged })
      });
      const data = await res.json();
      if (data.success) {
        setDnsEditResults(data.results || []);
        if (data.fail_count === 0) {
          showToast("success", `已修改 ${data.success_count} 条解析记录`);
          setDnsEditPanelOpen(false);
        } else {
          showToast(
            "warning",
            data.error_code === "ns_management_disabled"
              ? "DNSHE 上游平台已禁用 NS 管理，NS 记录无法通过 API 修改。请前往 DNSHE 官网后台手动设置。"
              : `批量修改完成：成功 ${data.success_count} 条，失败 ${data.fail_count} 条（详见下方明细）`
          );
        }
        reloadDnsRecords(selectedDomain);
        fetchDomains();
      } else {
        showToast("error", data.message || "批量修改解析记录失败");
      }
    } catch (e) {
      showToast("error", "批量修改解析记录请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 批量删除已勾选的解析记录（后端串行删除并逐条回执）
  const handleBatchDeleteDnsRecords = async () => {
    if (!selectedDomain || selectedDnsKeys.size === 0) return;

    const targets = selectedDnsRecords.map((rec) => ({
      record_id: dnsRecordKey(rec),
      label: `${rec.type} ${rec.name} → ${rec.content}`
    }));

    if (
      !confirm(
        `确定要删除选中的 ${targets.length} 条 DNS 解析记录吗？这会立即影响该域名的解析！\n\n${targets
          .map((t) => t.label)
          .join("\n")}`
      )
    ) {
      return;
    }

    setActionLoading("batch-delete-dns");
    try {
      const res = await apiFetch(`/api/domains/${selectedDomain.id}/dns/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: targets })
      });
      const data = await res.json();
      if (data.success) {
        const failed = (data.results || []).filter((r: { success: boolean }) => !r.success);
        if (failed.length === 0) {
          showToast("success", `已删除 ${data.success_count} 条解析记录`);
        } else {
          showToast(
            "error",
            data.error_code === "ns_management_disabled"
              ? "DNSHE 上游平台已禁用 NS 管理，NS 记录无法通过 API 删除。请前往 DNSHE 官网后台手动设置。"
              : `${failed.length} 条删除失败：${failed
                  .map((f: { label: string; message: string }) => `${f.label}(${f.message})`)
                  .join("；")}`
          );
        }
        reloadDnsRecords(selectedDomain);
        fetchDomains();
      } else {
        showToast("error", data.message || "批量删除解析记录失败");
      }
    } catch (e) {
      showToast("error", "批量删除解析记录请求失败");
    } finally {
      setActionLoading(null);
    }
  };

  // 批量添加输入框的实时解析结果，供按钮显示「已识别 N 条」并复用于提交
  // NOTE: 主机记录在这里就转成相对名，让预览显示的与真正写进去的完全一致
  const parsedDnsBatchLines = useMemo(
    () =>
      parseDnsBatchInput(dnsBatchInput, {
        type: dnsBatchType,
        name: dnsBatchName,
        ttl: dnsBatchTtl,
        priority: dnsBatchPriority
      }).map((r) =>
        r ? { ...r, name: toRelativeRecordName(r.name, selectedDomain?.full_domain || "") } : null
      ),
    [dnsBatchInput, dnsBatchType, dnsBatchName, dnsBatchTtl, dnsBatchPriority, selectedDomain]
  );

  const validDnsBatchLines = useMemo(
    () => parsedDnsBatchLines.filter((r): r is ParsedDnsLine => r !== null),
    [parsedDnsBatchLines]
  );

  // 批量添加解析记录
  const handleBatchCreateDnsRecords = async () => {
    if (!selectedDomain) return;

    if (validDnsBatchLines.length === 0) {
      showToast("error", "未能解析出任何有效的解析记录，请检查输入格式");
      return;
    }
    if (validDnsBatchLines.length > 50) {
      showToast("error", "单次最多批量添加 50 条解析记录");
      return;
    }

    const records = validDnsBatchLines.map((r) => ({
      ...r,
      line: dnsBatchLine.trim() || undefined
    }));

    setActionLoading("batch-create-dns");
    setDnsBatchResults(null);
    try {
      const res = await apiFetch(`/api/domains/${selectedDomain.id}/dns/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records })
      });
      const data = await res.json();
      if (data.success) {
        setDnsBatchResults(data.results || []);
        if (data.fail_count === 0) {
          showToast("success", `已添加 ${data.success_count} 条解析记录`);
          setDnsBatchInput("");
        } else {
          showToast(
            "warning",
            data.error_code === "ns_management_disabled"
              ? "DNSHE 上游平台已禁用 NS 管理，NS 记录无法通过 API 添加。请前往 DNSHE 官网后台手动设置。"
              : `批量添加完成：成功 ${data.success_count} 条，失败 ${data.fail_count} 条（详见下方明细）`
          );
        }
        reloadDnsRecords(selectedDomain);
        fetchDomains();
      } else {
        showToast("error", data.message || "批量添加解析记录失败");
      }
    } catch (e) {
      showToast("error", "批量添加解析记录请求失败");
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
    // 中文等非 ASCII 前缀/根域名统一转 Punycode (xn--) 再查询
    const sub = toASCII((overrideSub !== undefined ? overrideSub : searchSubdomain).trim());
    const root = toASCII((overrideRoot !== undefined ? overrideRoot : searchRootdomain).trim());

    if (!sub) {
      showToast("error", "请输入想要查询的子域名前缀！");
      return;
    }

    // 官方保留前缀：直接拦截，不浪费一次上游查询
    if (enableReservedFilter && reservedPrefixes.some(p => p.toLowerCase() === sub.toLowerCase())) {
      showToast("error", `前缀 [${sub}] 属于官方保留名单，不可注册（可在批量页的保留名单中调整）`);
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
    const sub = toASCII(searchSubdomain.trim());
    const root = toASCII(searchRootdomain.trim());
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
    const cleanRoot = toASCII(newRootInput.trim().replace(/^\./, ""));
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

  // 批量规则生成：解析与组合逻辑见 rulegen.ts（花括号槽位模型）
  //
  // 生成上限对齐 west.cn 在线版的 30 万条。注意这只是「生成」上限，
  // 实际扫描速度受单账号 1.2s 限频约束（见 handleStartBatchScan 的 RATE_LIMIT_MS）。
  const MAX_PREFIXES = 300000;

  // 让用户自建词库也能作为 {词库名} 标签参与组合 —— 比 west.cn 固定的「我的字典1-6」更灵活
  const resolveBank = useMemo(
    () => (name: string): string[] | null => {
      const bank = wordBanks.find(b => b.name === name);
      return bank ? bank.words : null;
    },
    [wordBanks]
  );

  // 规则实时解析：组合数预估 + 耗时估算
  const rulePreview = useMemo(() => {
    const parsed = parseRule(batchRules, excludeChars, batchLength, resolveBank);
    const total = countCombos(parsed);
    const rootCount = Math.max(selectedRoots.length, 1);
    const workerCount = Math.max(accounts.length, 1);
    // 每个候选前缀要对每个根域名各查一次，单账号 1.2s 限频，N 个账号 N 条流水线
    const scanned = Math.min(total, MAX_PREFIXES) * rootCount;
    // 规则本身有效但被排除字符清空 —— 与「还没输入规则」是两回事，提示语要能区分
    const emptiedByExclude =
      total === 0 &&
      parsed.unknownTokens.length === 0 &&
      (parsed.slots.length > 0 || parsed.literalList !== null) &&
      excludeChars.trim().length > 0;
    return {
      parsed,
      total,
      emptiedByExclude,
      isBraceSyntax: batchRules.includes("{"),
      estSeconds: (scanned * 1.2) / workerCount
    };
  }, [batchRules, excludeChars, batchLength, resolveBank, selectedRoots.length, accounts.length]);

  // 把秒数格式化为「3.2 小时 / 12 分钟 / 45 秒」
  const formatDuration = (sec: number): string => {
    if (sec < 60) return `${Math.ceil(sec)} 秒`;
    if (sec < 3600) return `${(sec / 60).toFixed(1)} 分钟`;
    if (sec < 86400) return `${(sec / 3600).toFixed(1)} 小时`;
    return `${(sec / 86400).toFixed(1)} 天`;
  };

  // ===== 顺序检测：进位递增生成器 =====
  // 取顺序模式对应的字符集
  const getSeqCharset = (name: string): string[] => {
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    const digits = "0123456789".split("");
    if (name === "数字") return digits;
    if (name === "字母数字") return [...letters, ...digits];
    return letters;
  };

  // 进位递增：给定当前串返回下一个串（qwe→qwf，qwz→qxa）；已到最大串则返回 null
  const nextSeqCandidate = (current: string, charset: string[]): string | null => {
    const idxMap = new Map(charset.map((c, i) => [c, i]));
    const chars = current.split("");
    let pos = chars.length - 1;
    while (pos >= 0) {
      const cur = idxMap.get(chars[pos]);
      if (cur === undefined) return null; // 出现字符集外的字符
      if (cur < charset.length - 1) {
        chars[pos] = charset[cur + 1];
        return chars.join("");
      }
      chars[pos] = charset[0]; // 进位：本位归零，继续向前进位
      pos--;
    }
    return null; // 全部进位完毕，空间穷尽
  };

  // 惰性生成顺序候选：从 start 开始最多取 limit 个（避免 26^4 一次性撑爆内存）
  const generateSeqPrefixes = (
    charsetName: string,
    length: number,
    start: string,
    limit: number
  ): string[] => {
    const charset = getSeqCharset(charsetName);
    const min = charset[0].repeat(length);
    let cur = start && start.length === length ? start.toLowerCase() : min;
    // 起始串含字符集外字符时回退到最小串
    if (cur.split("").some(c => !charset.includes(c))) cur = min;

    const out: string[] = [];
    while (out.length < limit) {
      out.push(cur);
      const nxt = nextSeqCandidate(cur, charset);
      if (nxt === null) break;
      cur = nxt;
    }
    return out;
  };

  // 保存/清除断点光标
  const saveScanCursor = (lastCandidate: string, taskIndex: number, checked: number) => {
    const cursor = {
      seqMode,
      charset: seqCharset,
      length: seqLength,
      lastCandidate,
      taskIndex,
      checked,
      savedAt: new Date().toLocaleString()
    };
    localStorage.setItem("DNSHE_SCAN_CURSOR", JSON.stringify(cursor));
    setScanCursor(cursor);
  };

  const clearScanCursor = () => {
    localStorage.removeItem("DNSHE_SCAN_CURSOR");
    setScanCursor(null);
  };

  // ===== 线路解析支持名单 =====
  const persistLineProviders = (next: string[]) => {
    const cleaned = Array.from(new Set(next.map((v) => String(v).trim()).filter(Boolean)));
    setLineProviders(cleaned);
    localStorage.setItem("DNSHE_LINE_PROVIDERS", JSON.stringify(cleaned));
  };

  /** 该域名是否支持按线路（运营商/地域）解析 */
  const domainSupportsLine = (dom: Domain | null | undefined): boolean => {
    const pid = dom?.provider_account_id;
    if (pid === undefined || pid === null || String(pid).trim() === "") return false;
    return lineProviders.includes(String(pid).trim());
  };

  /**
   * 从解析记录反推「该服务商支持线路」并自动补进名单
   *
   * NOTE: 只加不减。支持线路的域名如果所有记录都留在默认线路，line 全是空值，
   * 据此判「不支持」会误杀 —— 所以这里是单向补充。好处是即便 DNSHE 以后另开一个
   * 支持线路的服务商，只要有人在上面成功设过线路就会被学到，不用等改代码。
   * 数据来自本来就要读的解析记录，零额外上游调用。
   */
  const learnLineProviderFrom = (dom: Domain, records: DnsRecord[]) => {
    const pid = String(dom.provider_account_id ?? "").trim();
    if (!pid || lineProviders.includes(pid)) return;
    const usesLine = records.some((r) => {
      const v = String(r.line || "").trim().toLowerCase();
      return v !== "" && v !== "default";
    });
    if (!usesLine) return;

    // NOTE: 走函数式更新而不是 persistLineProviders([...lineProviders, pid]) ——
    // 闭包里的 lineProviders 可能已过期（连续打开两个域名时后一次会覆盖前一次的补充）。
    setLineProviders((prev) => {
      if (prev.includes(pid)) return prev;
      const next = [...prev, pid];
      localStorage.setItem("DNSHE_LINE_PROVIDERS", JSON.stringify(next));
      return next;
    });
    showToast("info", `检测到 ${dom.full_domain} 使用了线路解析，已将服务商 ${pid} 加入线路支持名单`);
  };

  // 添加线路服务商 ID（支持一次粘贴多个）
  const handleAddLineProvider = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const incoming = parseWords(newLineProviderInput);
    if (incoming.length === 0) return;
    const merged = Array.from(new Set([...lineProviders, ...incoming]));
    const added = merged.length - lineProviders.length;
    persistLineProviders(merged);
    setNewLineProviderInput("");
    showToast(added > 0 ? "success" : "info", added > 0 ? `已添加 ${added} 个服务商 ID` : "输入的 ID 都已在名单中");
  };

  const handleRemoveLineProvider = (pid: string) => {
    persistLineProviders(lineProviders.filter((p) => p !== pid));
  };

  const handleRestoreLineProviders = () => {
    persistLineProviders(DEFAULT_LINE_PROVIDERS);
    showToast("success", "已恢复默认线路支持名单");
  };

  /**
   * 已缓存域名按解析服务商 ID 归并
   *
   * NOTE: 给设置页做参照用 —— 服务商 ID 是个裸数字，光让用户填很难猜。把「哪个 ID
   * 底下挂着哪些根域名」摊出来，对着官网标注支持线路的后缀就能判断该加哪个。
   */
  const providerRootMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const d of domains) {
      const pid = String(d.provider_account_id ?? "").trim();
      if (!pid) continue;
      if (!map.has(pid)) map.set(pid, new Set<string>());
      map.get(pid)!.add(d.rootdomain);
    }
    return Array.from(map.entries())
      .map(([pid, roots]) => ({ pid, roots: Array.from(roots).sort() }))
      .sort((a, b) => a.pid.localeCompare(b.pid, undefined, { numeric: true }));
  }, [domains]);

  // ===== 保留前缀名单增删 =====
  const persistReserved = (next: string[]) => {
    setReservedPrefixes(next);
    localStorage.setItem("DNSHE_RESERVED_PREFIXES", JSON.stringify(next));
  };
  // 添加保留前缀（支持一次粘贴多个，逗号/空格/换行分隔）
  const handleAddReserved = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const incoming = parseWords(newReservedInput).map(w => w.toLowerCase());
    if (incoming.length === 0) return;

    const merged = Array.from(new Set([...reservedPrefixes, ...incoming]));
    const added = merged.length - reservedPrefixes.length;
    persistReserved(merged);
    setNewReservedInput("");
    if (added > 0) {
      showToast("success", `已添加 ${added} 个保留前缀`);
    } else {
      showToast("info", "输入的前缀均已在名单中");
    }
  };

  const handleRemoveReserved = (prefix: string) => {
    persistReserved(reservedPrefixes.filter(p => p !== prefix));
    showToast("info", `已从名单移除 [${prefix}]`);
  };

  const handleResetReserved = () => {
    persistReserved(DEFAULT_RESERVED_PREFIXES);
    showToast("success", "已恢复官方默认保留前缀名单");
  };

  // 切换启用状态并持久化
  const toggleReservedFilter = (enabled: boolean) => {
    setEnableReservedFilter(enabled);
    localStorage.setItem("DNSHE_RESERVED_FILTER_OFF", enabled ? "0" : "1");
  };

  // ===== 词库增删改 =====
  // 统一落盘：状态与 localStorage 同步更新
  const persistBanks = (next: WordBank[]) => {
    setWordBanks(next);
    saveWordBanks(next);
  };

  // 打开新建分组弹窗
  const openCreateBank = () => {
    setEditingBank(null);
    setBankFormName("");
    setBankFormKind("cn");
    setBankFormWords("");
    setBankModalOpen(true);
  };

  // 打开编辑分组弹窗
  const openEditBank = (bank: WordBank) => {
    setEditingBank(bank);
    setBankFormName(bank.name);
    setBankFormKind(bank.kind);
    setBankFormWords(bank.words.join(", "));
    setBankModalOpen(true);
  };

  // 保存（新建或更新）分组
  const handleSaveBank = () => {
    const name = bankFormName.trim();
    if (!name) {
      showToast("error", "请填写词库名称！");
      return;
    }
    // 词库名会作为 {名称} 标签写进规则，含花括号或逗号会破坏规则解析
    if (/[{},]/.test(name)) {
      showToast("error", "词库名称不能包含 { } 或逗号，否则无法作为规则标签使用！");
      return;
    }
    // 与内置标签重名会被内置定义遮蔽，导致点击词库标签却取到内置候选集
    if ((BUILTIN_TOKENS as readonly string[]).includes(name)) {
      showToast("error", `[${name}] 与内置标签同名，请换一个词库名称！`);
      return;
    }
    const words = parseWords(bankFormWords);
    if (words.length === 0) {
      showToast("error", "请至少填写一个词条！");
      return;
    }

    // 同类型下不允许重名（编辑自身除外）
    const dup = wordBanks.some(
      b => b.kind === bankFormKind && b.name === name && b.id !== editingBank?.id
    );
    if (dup) {
      showToast("error", `「${BANK_KIND_META[bankFormKind].label}」下已存在同名词库 [${name}]！`);
      return;
    }

    if (editingBank) {
      persistBanks(
        wordBanks.map(b =>
          b.id === editingBank.id ? { ...b, name, kind: bankFormKind, words } : b
        )
      );
      showToast("success", `词库 [${name}] 已更新（${words.length} 个词）`);
    } else {
      persistBanks([...wordBanks, { id: makeBankId(), kind: bankFormKind, name, words }]);
      showToast("success", `已新建词库 [${name}]（${words.length} 个词）`);
    }
    setBankModalOpen(false);
  };

  // 删除分组
  const handleDeleteBank = (bank: WordBank) => {
    if (!confirm(`确定要删除词库 [${bank.name}] 吗？该分组下 ${bank.words.length} 个词条将一并移除。`)) return;
    persistBanks(wordBanks.filter(b => b.id !== bank.id));
    showToast("info", `已删除词库 [${bank.name}]`);
  };

  // 恢复内置默认词库（覆盖当前全部自定义内容）
  const handleResetBanks = () => {
    if (!confirm("确定要恢复内置默认词库吗？您当前所有的自定义词库分组与修改都将被覆盖！")) return;
    const defaults = buildDefaultBanks();
    persistBanks(defaults);
    showToast("success", `已恢复内置默认词库（${defaults.length} 个分组）`);
  };

  // 把词库作为 {词库名} 标签插入规则框。
  // 早先是把整类词逗号展开进输入框，几百个词会把框挤满、完全看不清规则结构；
  // 改插占位符后词库还能与其它标签组合（如 {地名城市}{数字}）。
  const appendWordbank = (words: string[], label: string) => {
    setBatchRules(prev => `${prev}{${label}}`);
    showToast("success", `已插入「${label}」词库标签（${words.length} 个词）`);
  };

  // 执行批量扫域名引擎（resumeFrom 非空时表示从断点续查）
  const handleStartBatchScan = async (resumeFrom?: string) => {
    if (scanControlRef.current === "paused") {
      updateScanStatus("running");
      showToast("info", "▶️ 已恢复批量扫描任务！");
      return;
    }

    if (selectedRoots.length === 0) {
      showToast("error", "请至少勾选一个根域名后缀！");
      return;
    }

    // 顺序模式：按字符集进位递增惰性生成；否则走原有规则词库生成
    let prefixes: string[];
    if (seqMode) {
      const startFrom = resumeFrom || seqStart;
      prefixes = generateSeqPrefixes(seqCharset, seqLength, startFrom, 20000);
      if (prefixes.length === 0) {
        showToast("error", "顺序模式未能生成候选，请检查字符集与长度设置！");
        return;
      }
      showToast(
        "info",
        `🔢 顺序模式：从 [${prefixes[0]}] 开始，本轮生成 ${prefixes.length} 个候选前缀`
      );
    } else {
      const parsed = parseRule(batchRules, excludeChars, batchLength, resolveBank);
      if (parsed.unknownTokens.length > 0) {
        showToast("error", `规则中存在无法识别的标签：${parsed.unknownTokens.join("、")}`);
        return;
      }
      prefixes = generateCombos(parsed, MAX_PREFIXES);
      if (prefixes.length === 0) {
        showToast("error", "根据当前规则未能生成有效的前缀词库，请修改规则！");
        return;
      }
      const totalCombos = countCombos(parsed);
      if (totalCombos > MAX_PREFIXES) {
        showToast(
          "warning",
          `⚠️ 该规则共 ${totalCombos.toLocaleString()} 条组合，已截断为前 ${MAX_PREFIXES.toLocaleString()} 条。超大规则建议改用顺序模式配合断点续查。`
        );
      }
    }

    // ── 官方保留前缀过滤：整词匹配剔除不可注册的前缀，避免浪费 API 配额 ──
    if (enableReservedFilter && reservedPrefixes.length > 0) {
      const reservedSet = new Set(reservedPrefixes.map(p => p.toLowerCase()));
      const before = prefixes.length;
      prefixes = prefixes.filter(p => !reservedSet.has(p.toLowerCase()));
      const removed = before - prefixes.length;
      if (removed > 0) {
        showToast("info", `🚫 已排除 ${removed} 个官方保留前缀（不可注册）`);
      }
      if (prefixes.length === 0) {
        showToast("error", "全部候选前缀都属于官方保留名单，无可查询项！");
        return;
      }
    }

    // 生成任务：中文等非 ASCII 前缀转 Punycode 用于实际查询(queryFull)，
    // 同时保留中文原文(full)用于日志与结果展示
    const allTasks: Array<{ sub: string; root: string; full: string; queryFull: string }> = [];
    for (const sub of prefixes) {
      for (const root of selectedRoots) {
        const full = `${sub}.${root}`;
        allTasks.push({ sub, root, full, queryFull: toASCII(full) });
      }
    }

    // ── 查重池过滤 ──
    // 池子只用于「跳过已确认已注册的域名」，属于纯优化项，不是扫描的前置依赖。
    // 因此这里不再阻塞等待全部批次查完（旧实现串行 await 40+ 次往返，
    // 用户开扫前要白等十几秒），而是：
    //   1) 先同步查第一批，拿到即可开工；
    //   2) 其余批次在后台并发补充进 skipSet，worker 领任务时实时查表跳过。
    const POOL_BATCH = 400; // 与后端单条语句内联上限对齐
    const skipSet = new Set<string>();
    let poolFailed = false;

    const fetchPoolChunk = async (chunk: typeof allTasks) => {
      const res = await apiFetch("/api/whois/pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: chunk.map(t => t.queryFull) })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.registered)) {
        data.registered.forEach((d: string) => skipSet.add(d));
      }
    };

    const logPoolFailure = (e: unknown) => {
      if (poolFailed) return; // 只提示一次，避免日志被刷屏
      poolFailed = true;
      console.error("查重池查询失败，将退化为全量扫描:", e);
      setScanLogs(prev => [
        {
          id: Date.now() + Math.random(),
          time: new Date().toLocaleTimeString(),
          text: "⚠️ 查重池查询失败，本轮已退化为全量扫描（不影响结果，仅多消耗 API 配额）",
          status: "error"
        },
        ...prev.slice(0, 49)
      ]);
      showToast("warning", "⚠️ 查重池查询失败，已退化为全量扫描");
    };

    if (!ignorePool) {
      const chunks: Array<typeof allTasks> = [];
      for (let i = 0; i < allTasks.length; i += POOL_BATCH) {
        chunks.push(allTasks.slice(i, i + POOL_BATCH));
      }

      // 第一批同步等待：小规模扫描（单批）到这里池子就已完整
      try {
        if (chunks.length > 0) await fetchPoolChunk(chunks[0]);
      } catch (e) {
        logPoolFailure(e);
      }

      // 其余批次后台并发补充，不阻塞扫描启动
      if (chunks.length > 1) {
        void Promise.all(
          chunks.slice(1).map(ch => fetchPoolChunk(ch).catch(logPoolFailure))
        ).then(() => {
          if (!poolFailed && skipSet.size > 0) {
            setScanLogs(prev => [
              {
                id: Date.now() + Math.random(),
                time: new Date().toLocaleTimeString(),
                text: `🗂️ 查重池加载完毕，共命中 ${skipSet.size} 个已注册域名（扫描中自动跳过）`,
                status: "info"
              },
              ...prev.slice(0, 49)
            ]);
          }
        });
      }

      if (skipSet.size > 0) {
        showToast("info", `🗂️ 查重池已命中 ${skipSet.size} 个已注册域名，将在扫描中自动跳过`);
      }
    }

    // 全部候选都在池中（仅当池子已完整加载时才可能成立）
    if (allTasks.length > 0 && skipSet.size >= allTasks.length) {
      showToast("success", "🎉 本轮全部候选均已在查重池中确认为已注册，无需重复查询！");
      updateScanStatus("completed");
      return;
    }

    const totalTasks = allTasks;

    // 多账号并发查重：
    // 为每个 API 账号开一条独立的流水线（worker），各自绑定固定账号并遵守自身 1.2s (1200ms) 限频。
    // N 条流水线同时工作 => 整体吞吐量约为单账号的 N 倍（真并发，而非串行轮询）。
    const RATE_LIMIT_MS = 1200; // 单个 API 账号的独立限频底线
    const workerAccounts = accounts.length > 0 ? accounts : [null];
    const workerCount = workerAccounts.length;

    updateScanStatus("running");
    setScanProgress({ total: totalTasks.length, checked: 0, available: availableDomainsList.length });
    showToast(
      "info",
      `🚀 开始多账号并发查重！绑定 ${workerCount} 个 API 账号，${workerCount} 条流水线并行（每个 API 独立保障 1.2s 限频），查重吞吐提升约 ${workerCount} 倍！`
    );

    // 共享的任务游标：各 worker 抢占式领取任务，天然实现负载均衡
    let nextTaskIndex = 0;
    let checkedCount = 0;
    let skippedCount = 0; // 因命中查重池而跳过的数量（未消耗上游 API 配额）

    // 单个域名的查询与日志上报逻辑
    const processTask = async (
      task: { sub: string; root: string; full: string; queryFull: string },
      account: (typeof workerAccounts)[number]
    ) => {
      const accountQuery = account ? `&account_id=${account.id}` : "";
      const accAlias = account ? account.alias : "公共轮询";
      const nowTime = new Date().toLocaleTimeString();
      try {
        const res = await apiFetch(`/api/whois?domain=${encodeURIComponent(task.queryFull)}${accountQuery}&batch=1`);
        const data = await res.json();

        // 限流感知：撞到 429 / 配额耗尽时自动暂停，保住断点光标供稍后继续
        if (res.status === 429 || data.error_code === "rate_limited" || data.error_code === "quota_exceeded") {
          saveScanCursor(task.sub, nextTaskIndex, checkedCount);
          updateScanStatus("paused");
          setScanLogs(prev => [
            { id: Date.now() + Math.random(), time: nowTime, text: `[${accAlias}] ⛔ 触发 API 限流/配额上限，已自动暂停（断点已保存至 ${task.sub}）`, status: "error" },
            ...prev.slice(0, 49)
          ]);
          showToast("warning", "⛔ 触发 API 限流，已自动暂停并保存断点，稍后可点击继续");
          return;
        }

        if (data.success && data.whois && data.whois.registered === false) {
          setAvailableDomainsList(prev => [
            { fullDomain: task.full, subdomain: task.sub, rootdomain: task.root, time: nowTime },
            ...prev
          ]);
          checkedCount++;
          setScanProgress(p => ({ ...p, checked: checkedCount, available: p.available + 1 }));
          setScanLogs(prev => [
            { id: Date.now() + Math.random(), time: nowTime, text: `[${accAlias}] 校验域名 ${task.full} ➔ 🎉 尚未注册（可立即在线注册！）`, status: "available" },
            ...prev.slice(0, 49)
          ]);
        } else {
          checkedCount++;
          setScanProgress(p => ({ ...p, checked: checkedCount }));
          setScanLogs(prev => [
            { id: Date.now() + Math.random(), time: nowTime, text: `[${accAlias}] 校验域名 ${task.full} ➔ 已被他人注册`, status: "registered" },
            ...prev.slice(0, 49)
          ]);
        }
      } catch (err) {
        checkedCount++;
        setScanProgress(p => ({ ...p, checked: checkedCount }));
        setScanLogs(prev => [
          { id: Date.now() + Math.random(), time: nowTime, text: `[${accAlias}] 校验域名 ${task.full} ➔ ⚠️ 查询请求异常，已跳过`, status: "error" },
          ...prev.slice(0, 49)
        ]);
      }
    };

    // 单条流水线：固定绑定一个账号，循环领取任务并遵守自身 1.2s 限频
    const runWorker = async (account: (typeof workerAccounts)[number]) => {
      while (true) {
        // 停止或重置
        if ((scanControlRef.current as string) === "idle") return;

        // 暂停：挂起直到解冻或停止
        while ((scanControlRef.current as string) === "paused") {
          await new Promise(r => setTimeout(r, 300));
          if ((scanControlRef.current as string) === "idle") return;
        }

        // 抢占式领取下一个任务
        const idx = nextTaskIndex++;
        if (idx >= totalTasks.length) return;

        // 实时记录进度，供暂停/限流时落盘为断点光标
        scanCursorRef.current = {
          lastCandidate: totalTasks[idx].sub,
          taskIndex: idx,
          checked: checkedCount
        };

        // 查重池命中：直接跳过，既不发请求也不占用该账号的限频窗口。
        // 池子在后台持续加载，越往后命中率越完整。
        if (!ignorePool && skipSet.has(totalTasks[idx].queryFull)) {
          checkedCount++;
          skippedCount++;
          setScanProgress(p => ({ ...p, checked: checkedCount }));
          continue;
        }

        const startedAt = Date.now();
        await processTask(totalTasks[idx], account);

        // 该账号自身限频：距上次请求发起不足 1.2s 则补足剩余时间
        const elapsed = Date.now() - startedAt;
        if (elapsed < RATE_LIMIT_MS) {
          await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
        }
      }
    };

    // 所有流水线同时启动，等待全部跑完
    await Promise.all(workerAccounts.map(acc => runWorker(acc)));

    if (scanControlRef.current === "running") {
      updateScanStatus("completed");
      clearScanCursor(); // 正常跑完，断点光标不再需要
      showToast(
        "success",
        skippedCount > 0
          ? `🎉 所有生成的域名字典查询完毕！其中 ${skippedCount} 个命中查重池已跳过，节省了同等数量的 API 配额。`
          : "🎉 所有生成的域名字典查询完毕！"
      );
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

  // 侧栏菜单项定义
  const navItems: Array<{ key: TabKey; label: string; icon: React.ReactNode; badge?: number }> = [
    { key: "dashboard", label: "概览", icon: <LayoutDashboard className="w-5 h-5" /> },
    { key: "domains", label: "域名列表", icon: <Globe className="w-5 h-5" />, badge: domains.length },
    { key: "accounts", label: "账号管理", icon: <Key className="w-5 h-5" />, badge: accounts.length },
    { key: "register", label: "注册 / 查重", icon: <Plus className="w-5 h-5" /> },
    { key: "quota", label: "账户配额", icon: <Database className="w-5 h-5" /> },
    { key: "logs", label: "运行日志", icon: <ScrollText className="w-5 h-5" /> },
    { key: "settings", label: "设置", icon: <Settings className="w-5 h-5" /> },
  ];

  // 通知铃铛数据源：最近的告警/错误日志
  const alertLogs = useMemo(
    () => logs.filter((l) => l.type === "error" || l.type === "warning").slice(0, 6),
    [logs]
  );

  // 已读告警标记：持久化最近查看过的告警 ID，用于小铃铛红点显隐
  const [lastAlertSeenId, setLastAlertSeenId] = useState<number>(
    () => Number(localStorage.getItem("DNSHE_LAST_SEEN_ALERT_ID") || 0)
  );
  // 是否存在比上次已读更新/更高的未读告警
  const unreadAlert = useMemo(() => {
    const newest = alertLogs[0];
    return !!newest && newest.id > lastAlertSeenId;
  }, [alertLogs, lastAlertSeenId]);
  // 将当前全部告警标记为已读
  const markAlertsRead = () => {
    const newest = alertLogs[0];
    if (newest) {
      setLastAlertSeenId(newest.id);
      localStorage.setItem("DNSHE_LAST_SEEN_ALERT_ID", String(newest.id));
    }
  };

  // 日志分类映射（兼容历史 category 值）
  //   登录 ← auth
  //   API  ← api / sync / renew
  //   操作 ← operation / system
  const filteredLogs = useMemo(() => {
    if (logCategory === "all") return logs;
    const groupMap: Record<string, string[]> = {
      auth: ["auth"],
      api: ["api", "sync", "renew"],
      operation: ["operation", "system"],
    };
    const allowed = groupMap[logCategory] || [];
    return logs.filter((l) => allowed.includes(l.category));
  }, [logs, logCategory]);

  /**
   * 单条日志在「表格行」与「手机卡片」两种布局下共用的字段节点
   *
   * NOTE: 表格行必须待在 <tbody> 里、卡片必须在表格外，两者无法共用一次 map，
   * 但字段的格式化与样式只写这一份 —— 否则两套布局早晚各自走形。
   */
  const logRowParts = (log: AppLog) => ({
    time: new Date(log.created_at).toLocaleString("zh-CN"),
    badge: (
      <span className={`inline-block px-2.5 py-0.5 rounded-full font-bold uppercase text-xs flex-shrink-0 ${
        log.type === "success" ? "bg-emerald-950 text-emerald-400" :
        log.type === "error" ? "bg-red-950 text-red-400 animate-pulse" :
        log.type === "warning" ? "bg-amber-950 text-amber-400" :
        "bg-elevated text-content-secondary"
      }`}>
        {log.type}
      </span>
    ),
    details: log.details ? (
      <pre className="mt-2 p-2.5 rounded bg-elevated text-content-muted text-[11px] md:text-xs font-mono max-h-40 overflow-auto whitespace-pre-wrap break-all">
        {log.details}
      </pre>
    ) : null,
  });

  // Dashboard 概览统计（纯前端计算）
  const dashboardStats = useMemo(() => {
    const now = Date.now();
    let active = 0;
    let expired = 0;
    domains.forEach((d) => {
      const exp = d.expires_at ? new Date(d.expires_at).getTime() : NaN;
      const isExpired = (!isNaN(exp) && exp < now) || d.status === "已过期";
      if (isExpired) expired++;
      else active++;
    });
    // 最近注册（按 created_at 倒序，前 6 条）
    const recent = [...domains]
      .filter((d) => d.created_at)
      .sort((a, b) => new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime())
      .slice(0, 6);
    return {
      total: domains.length,
      active,
      expired,
      accounts: accounts.length,
      recent,
    };
  }, [domains, accounts]);

  // 顶部搜索提交：跳转到域名页并带入搜索词
  const handleGlobalSearchSubmit = () => {
    if (activeTab !== "domains") setActiveTab("domains");
  };

  // ===== 未登录：展示登录 / 首次初始化页面 =====
  if (!sessionToken) {
    // 鉴权状态尚未加载完成时，先展示加载态，避免登录/初始化界面闪烁
    if (!authStatusLoaded) {
      return (
        <div className="flex h-screen items-center justify-center bg-page text-content-primary">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
        </div>
      );
    }

    return (
      <div className="flex h-screen items-center justify-center bg-page text-content-primary px-4">
        <div className="w-full max-w-sm bg-surface border border-border-base rounded-2xl shadow-2xl p-7 space-y-6">
          {/* 头部 LOGO */}
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Globe className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-xl font-black text-content-primary">DNSHE 集控台</h1>
            <p className="text-xs text-content-muted">
              {authInitialized ? "请登录以管理您的免费域名资产" : "首次使用，请设置管理员账户"}
            </p>
          </div>

          {/* 错误提示 */}
          {loginError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          {authInitialized ? (
            /* ── 登录表单 ── */
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-content-secondary">用户名</label>
                <input
                  type="text"
                  autoComplete="username"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="管理员用户名"
                  className="form-input w-full px-3.5 py-2.5 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-content-secondary">密码</label>
                <PasswordInput
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={setLoginPassword}
                  placeholder="登录密码"
                  className="form-input w-full px-3.5 py-2.5 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                />
              </div>
              {(authTwoFaEnabled || loginNeeds2fa) && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-content-secondary flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> 两步验证动态码
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={loginTotp}
                    onChange={(e) => setLoginTotp(e.target.value)}
                    placeholder="身份验证器上的 6 位数字"
                    className="form-input w-full px-3.5 py-2.5 rounded-lg text-sm font-mono text-content-primary placeholder:text-content-muted"
                  />
                </div>
              )}
              <button
                type="submit"
                disabled={loginLoading}
                className="btn-primary w-full py-2.5 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loginLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                {loginLoading ? "登录中..." : "登录"}
              </button>
            </form>
          ) : (
            /* ── 首次初始化表单 ── */
            <form onSubmit={handleSetup} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-content-secondary">设置用户名</label>
                <input
                  type="text"
                  autoComplete="username"
                  value={setupUsername}
                  onChange={(e) => setSetupUsername(e.target.value)}
                  placeholder="至少 3 个字符"
                  className="form-input w-full px-3.5 py-2.5 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-content-secondary">设置密码</label>
                <PasswordInput
                  autoComplete="new-password"
                  value={setupPassword}
                  onChange={setSetupPassword}
                  placeholder="至少 8 个字符"
                  className="form-input w-full px-3.5 py-2.5 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-content-secondary">确认密码</label>
                <PasswordInput
                  autoComplete="new-password"
                  value={setupPassword2}
                  onChange={setSetupPassword2}
                  placeholder="再次输入密码"
                  className="form-input w-full px-3.5 py-2.5 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                />
              </div>
              <button
                type="submit"
                disabled={loginLoading}
                className="btn-primary w-full py-2.5 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loginLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {loginLoading ? "创建中..." : "创建管理员账户并进入"}
              </button>
            </form>
          )}

          {/* 登录页 Toast 通知 */}
        </div>

        {/* 登录页也需要 Toast 通知 */}
        {toast && (
          <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-2xl border text-sm font-semibold bg-surface text-content-primary border-border-base">
            {toast.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />}
            {toast.type === "error" && <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />}
            {toast.type === "info" && <Info className="w-5 h-5 text-indigo-500 flex-shrink-0" />}
            {toast.type === "warning" && <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />}
            <span>{toast.message}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    /*
      NOTE: 高度用 100dvh 而非 100vh —— 移动浏览器的 100vh 把地址栏高度也算进去，
      底部内容会被切掉一截。桌面上 dvh 与 vh 等价，渲染结果不变。
    */
    <div className="flex h-[100dvh] overflow-hidden bg-page text-content-primary">

      {/* 手机抽屉遮罩：点击关闭；≥md 侧栏常驻，不需要遮罩 */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm md:hidden"
          aria-hidden="true"
        />
      )}

      {/* ===== 左侧菜单：<md 为抽屉，≥md 为常驻可折叠侧栏 ===== */}
      {/*
        NOTE: 同一个 aside 兼任两种形态，导航项只写一份。
        <md：fixed 定位 + translate-x 滑入滑出，不占布局流（否则会吃掉 224px 中的一半屏宽）；
        ≥md：md:static 归位到布局流，宽度由 railMode 决定，与改造前完全一致。
        根容器是 h-[100dvh] overflow-hidden、页面本身不滚动（滚动在 main 内部），
        且抽屉是 fixed，所以不需要额外锁 body 滚动。
      */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 flex flex-col border-r border-border-base bg-surface transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:static md:z-auto md:translate-x-0 md:flex-shrink-0 md:transition-all ${
          railMode ? "md:w-16" : "md:w-56"
        }`}
      >
        {/* LOGO + 折叠按钮 */}
        <div className="h-16 flex items-center gap-2 px-3 border-b border-border-base">
          {/* 折叠切换只在桌面有意义：手机上这个按钮所在的抽屉本身就是被汉堡唤出的 */}
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="hidden md:flex p-2 rounded-lg text-content-muted hover:text-content-primary hover:bg-hovered transition-all flex-shrink-0"
            title={railMode ? "展开菜单" : "折叠菜单"}
          >
            <Menu className="w-5 h-5" />
          </button>
          {!railMode && (
            <div className="flex items-center gap-1.5 font-black text-content-primary whitespace-nowrap overflow-hidden">
              <Globe className="w-5 h-5 text-indigo-500 flex-shrink-0" />
              <span className="truncate">DNSHE 集控</span>
            </div>
          )}
          {/* 抽屉关闭按钮（仅手机） */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden ml-auto p-2 rounded-lg text-content-muted hover:text-content-primary hover:bg-hovered transition-all"
            title="关闭菜单"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 菜单项 */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setActiveTab(item.key);
                // 手机上选完就收起抽屉，否则内容被遮住还得再点一次
                setSidebarOpen(false);
              }}
              title={railMode ? item.label : undefined}
              className={`group w-full flex items-center gap-3 px-3 py-3 md:py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === item.key
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                  : "text-content-muted hover:text-content-primary hover:bg-hovered"
              } ${railMode ? "justify-center" : ""}`}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!railMode && (
                <>
                  <span className="flex-1 text-left whitespace-nowrap">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-black/20 text-current opacity-80">
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </nav>

        {/* 抽屉底部退出入口（仅手机）：头部横向空间紧张，退出按钮挪到这里 */}
        <div className="md:hidden border-t border-border-base p-2">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-semibold text-content-secondary hover:text-content-primary hover:bg-hovered transition-all"
          >
            <LogIn className="w-5 h-5 text-amber-400 flex-shrink-0" />
            退出登录
          </button>
        </div>
      </aside>

      {/* ===== 右侧主区（顶部栏 + 内容） ===== */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ===== 顶部栏 ===== */}
        <header className="h-16 flex-shrink-0 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 md:px-6 border-b border-border-base bg-surface">
          {/* 汉堡按钮：唤出手机抽屉（≥md 侧栏常驻，折叠切换在侧栏内部） */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 -ml-1 rounded-lg text-content-muted hover:text-content-primary hover:bg-hovered transition-all flex-shrink-0"
            title="打开菜单"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* 全局搜索框 */}
          {/* NOTE: min-w-0 是必需的 —— flex 子项默认 min-width:auto，没有它 flex-1 不会真的收缩 */}
          <div className="flex-1 min-w-0 max-w-md relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-muted pointer-events-none" />
            {/*
              NOTE: type="search" + autoComplete="off" 是为了挡住 Chrome 密码管理器。
              设置页的「修改登录密码」表单一旦被自动填充，Chrome 会去猜用户名字段，
              往前找到的第一个纯文本输入框就是这里，于是把用户名塞进搜索框、
              静默过滤掉域名列表（看起来像账号和域名凭空少了一大半）。
              Chrome 不会把 type="search" 的输入框当作用户名字段。
              原生清除按钮在 index.css 里隐藏，外观与改造前一致。
            */}
            <input
              type="search"
              name="domain-search"
              autoComplete="off"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleGlobalSearchSubmit(); }}
              placeholder="搜索域名（回车跳转域名列表）..."
              className="form-input w-full pl-9 pr-3 py-2 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
            />
          </div>

          {/* 把右侧按钮推到最右；手机上让搜索框吃掉这部分空间 */}
          <div className="hidden sm:block flex-1" />

          {/* 域名页快捷同步 */}
          {activeTab === "domains" && (
            <button
              onClick={handleSyncDomains}
              disabled={actionLoading === "sync" || loadingDomains}
              className="btn-primary px-2.5 sm:px-3.5 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${actionLoading === "sync" ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">同步所有账号</span>
            </button>
          )}

          {/* 通知铃铛 */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => {
                const next = !notifOpen;
                setNotifOpen(next);
                if (next) markAlertsRead();
              }}
              className="relative p-2 rounded-lg text-content-muted hover:text-content-primary hover:bg-hovered transition-all"
              title="告警通知"
            >
              <Bell className="w-5 h-5" />
              {unreadAlert && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              )}
            </button>
            {notifOpen && (
              /* NOTE: w-80 在 390px 屏上会顶出右边界，窄屏改用视口宽度减去两侧留白 */
              <div className="absolute right-0 mt-2 w-[calc(100vw-1.5rem)] sm:w-80 max-h-96 overflow-y-auto bg-elevated border border-border-base rounded-xl shadow-2xl z-50 p-2">
                <div className="px-2 py-1.5 text-xs font-bold text-content-muted flex items-center justify-between">
                  <span>最近告警</span>
                  <button
                    onClick={() => { markAlertsRead(); setActiveTab("logs"); setNotifOpen(false); }}
                    className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    查看全部
                  </button>
                </div>
                {alertLogs.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-content-muted">暂无告警</div>
                ) : (
                  alertLogs.map((log) => (
                    <div key={log.id} className="px-2 py-2 rounded-lg hover:bg-hovered text-xs">
                      <div className={`font-semibold ${log.type === "error" ? "text-red-400" : "text-amber-400"}`}>
                        {log.type.toUpperCase()}
                      </div>
                      <div className="text-content-secondary mt-0.5 line-clamp-2">{log.message}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 主题切换 */}
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="p-2 rounded-lg text-content-muted hover:text-content-primary hover:bg-hovered transition-all flex-shrink-0"
            title={theme === "dark" ? "切换到亮色" : "切换到暗色"}
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          {/* 退出登录：手机上头部空间紧张，入口挪进抽屉底部 */}
          <button
            onClick={handleLogout}
            className="hidden md:flex bg-elevated hover:bg-hovered text-content-secondary border border-border-base px-3 py-2 rounded-lg text-sm font-semibold items-center gap-2 transition-all flex-shrink-0"
            title="退出登录"
          >
            <LogIn className="w-4 h-4 text-amber-400" />
            <span className="hidden md:inline">退出登录</span>
          </button>
        </header>

        {/* 主面板内容 */}
        <main className="flex-1 overflow-y-auto px-3 sm:px-4 md:px-6 py-5 md:py-6">

        {/* Tab 0: Dashboard 概览 */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-black text-content-primary flex items-center gap-2">
                <LayoutDashboard className="w-6 h-6 text-indigo-500" /> 概览
              </h2>
              <p className="text-content-muted mt-1 text-sm">免费域名资产总览与到期预警</p>
            </div>

            {/* 顶部统计卡片 */}
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {[
                { label: "总域名", value: dashboardStats.total, icon: <Globe className="w-5 h-5" />, color: "text-indigo-400", tab: "domains" as TabKey },
                { label: "活跃域名", value: dashboardStats.active, icon: <CheckCircle2 className="w-5 h-5" />, color: "text-emerald-400", tab: "domains" as TabKey },
                { label: "已过期", value: dashboardStats.expired, icon: <AlertTriangle className="w-5 h-5" />, color: "text-red-400", tab: "domains" as TabKey },
                { label: "API 账号", value: dashboardStats.accounts, icon: <Key className="w-5 h-5" />, color: "text-amber-400", tab: "accounts" as TabKey },
              ].map((card) => (
                <button
                  key={card.label}
                  onClick={() => setActiveTab(card.tab)}
                  className="glass-card rounded-2xl p-4 sm:p-5 text-left flex flex-col gap-2 sm:gap-3 group"
                >
                  <div className={`flex items-center gap-2 min-w-0 ${card.color}`}>
                    <span className="flex-shrink-0">{card.icon}</span>
                    <span className="text-[11px] sm:text-xs font-semibold text-content-muted uppercase tracking-wide truncate">{card.label}</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-content-primary">{card.value}</div>
                </button>
              ))}
            </div>

            {/* 中间：最近注册 */}
            <div className="bg-surface border border-border-base rounded-2xl overflow-hidden">
              <div className="px-4 sm:px-5 py-3.5 border-b border-border-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400" />
                <h3 className="font-bold text-content-primary text-sm">最近注册</h3>
              </div>
              <div className="divide-y divide-border-soft">
                {dashboardStats.recent.length === 0 ? (
                  <div className="px-5 py-10 text-center text-content-muted text-sm">暂无数据</div>
                ) : (
                  dashboardStats.recent.map((d) => (
                    /* NOTE: 手机上域名与账号别名各占一行 —— 挤在一行里两者都会被截断，
                       而这两个信息都要看（长别名在 390px 下会丢掉一半） */
                    <div key={d.id} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-2 hover:bg-hovered transition-colors">
                      <span className="font-mono text-xs sm:text-sm text-content-primary truncate min-w-0">{d.full_domain}</span>
                      <span className="text-[11px] sm:text-xs text-content-muted truncate min-w-0 sm:flex-shrink-0 sm:max-w-[35%]">{d.account_alias}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: 域名注册与查重 */}
        {activeTab === "register" && (
          <div className="space-y-6 max-w-5xl mx-auto">
            
            {/* 模式选择导航 */}
            <div className="flex flex-col sm:flex-row bg-surface p-1.5 rounded-2xl border border-border-base gap-2">
              <button
                onClick={() => setRegMode("single")}
                className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${
                  regMode === "single"
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                    : "text-content-muted hover:text-content-primary hover:bg-hovered"
                }`}
              >
                <Search className="w-4 h-4" /> 精准单域名查重
              </button>
              <button
                onClick={() => setRegMode("batch")}
                className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${
                  regMode === "batch"
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                    : "text-content-muted hover:text-content-primary hover:bg-hovered"
                }`}
              >
                <Sparkles className="w-4 h-4 text-amber-400" /> 规则多域名查重
              </button>
            </div>

            {/* 模式 A: 精准单域名查重卡片 */}
            {regMode === "single" && (
              <div className="space-y-6">
                {/* 1. 单域名 WHOIS 查重表单卡片 */}
                <div className="bg-surface border border-border-base rounded-2xl p-6 shadow-xl space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-content-primary flex items-center gap-2">
                      <Search className="w-5 h-5 text-indigo-400" /> 单精准域名 WHOIS 查重与注册
                    </h3>
                    <p className="text-xs text-content-muted mt-1">
                      输入您心仪的二级前缀，选择 9 大免费根域名之一，实时检测域名注册状态及 WHOIS 到期详细信息。
                    </p>
                  </div>

                  <form onSubmit={handleCheckWhois} className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
                    <div className="sm:col-span-6 space-y-2">
                      <label className="block text-xs font-semibold text-content-secondary">
                        二级域名前缀:
                      </label>
                      <input
                        type="text"
                        placeholder="例如: myapp 或 中文域名"
                        value={searchSubdomain}
                        onChange={(e) => setSearchSubdomain(e.target.value)}
                        className="w-full bg-elevated border border-border-base focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-content-primary placeholder-content-muted focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-3 space-y-2">
                      <label className="block text-xs font-semibold text-content-secondary">
                        根域名后缀:
                      </label>
                      <select
                        value={searchRootdomain}
                        onChange={(e) => setSearchRootdomain(e.target.value)}
                        className="w-full bg-elevated border border-border-base focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-content-primary focus:outline-none"
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

                  {/* 中文前缀实时 Punycode 预览（置于表单外，避免撑乱 grid 行高） */}
                  {hasNonASCII(searchSubdomain) && (
                    <p className="text-[11px] text-indigo-400 -mt-2 font-mono">
                      将以 Punycode 提交：<span className="font-bold">{toASCII(searchSubdomain.trim())}.{searchRootdomain}</span>
                    </p>
                  )}
                </div>

                {/* 2. WHOIS 查询结果展示 */}
                {whoisResult && (
                  <div>
                    {!whoisResult.registered ? (
                      /* 未注册：绿色可注册卡片 */
                      <div className="bg-surface border border-emerald-500/30 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-base pb-4">
                          <div className="min-w-0">
                            <span className="inline-block bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 text-xs font-bold px-2.5 py-1 rounded-full mb-1">
                              尚未注册
                            </span>
                            <h4 className="text-lg sm:text-xl font-bold text-content-primary break-all">
                              {whoisResult.searchedDomain}
                            </h4>
                          </div>
                          <div className="text-emerald-400 text-xs sm:text-sm font-semibold flex items-start sm:items-center gap-1 min-w-0">
                            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5 sm:mt-0" />
                            该域名目前仍处于未注册状态，可以立即在线注册！
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 items-end">
                          <div className="space-y-2">
                            <label className="block text-xs font-semibold text-content-secondary">
                              选择注册的目标账号:
                            </label>
                            <select
                              value={registerAccountId}
                              onChange={(e) => setRegisterAccountId(Number(e.target.value))}
                              className="w-full bg-elevated border border-border-base focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-content-primary focus:outline-none"
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

                          <div>
                            <button
                              onClick={handleRegisterSubdomain}
                              disabled={actionLoading === "register-subdomain" || accounts.length === 0}
                              className="w-full bg-emerald-600 hover:bg-emerald-500 border border-transparent text-white font-bold text-sm px-6 py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Plus className="w-4 h-4" />
                              {actionLoading === "register-subdomain" ? "正在注册中..." : "一键注册该域名"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* 已被注册：红色提示卡片 */
                      <div className="bg-surface border border-red-500/30 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-base pb-4">
                          <div className="min-w-0">
                            <span className="inline-block bg-red-50 text-red-700 dark:bg-red-500/20 dark:text-red-400 text-xs font-bold px-2.5 py-1 rounded-full mb-1">
                              已被注册
                            </span>
                            <h4 className="text-lg sm:text-xl font-bold text-content-secondary break-all">
                              {whoisResult.searchedDomain}
                            </h4>
                          </div>
                          <div className="text-red-400 text-xs sm:text-sm font-semibold flex items-center gap-1 flex-shrink-0">
                            <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                            已被他人抢先注册
                          </div>
                        </div>

                        {/* WHOIS 详细数据表 */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2">
                          <div className="bg-elevated p-3 rounded-lg border border-border-base">
                            <span className="text-content-muted">注册时间：</span>
                            <span className="text-content-secondary font-medium ml-1">{whoisResult.registered_at || "保密 / 未公开"}</span>
                          </div>
                          <div className="bg-elevated p-3 rounded-lg border border-border-base">
                            <span className="text-content-muted">到期时间：</span>
                            <span className="text-content-secondary font-medium ml-1">{whoisResult.expires_at || "保密 / 未公开"}</span>
                          </div>
                          <div className="bg-elevated p-3 rounded-lg border border-border-base sm:col-span-2">
                            <span className="text-content-muted">当前 NS 域名服务器：</span>
                            <span className="text-content-secondary font-medium ml-1">
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
                <div className="bg-surface border border-border-base rounded-2xl p-6 shadow-xl space-y-6">
                  
                  {/* 1. 生成规则输入框 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1 min-w-0">
                        <label className="block text-sm font-semibold text-content-secondary shrink-0">
                          生成规则:
                        </label>
                        {/* 组合数预估：由各槽位大小相乘得出，不实际生成。
                            放在标题行而非输入框下方 —— 标题行本就有横向留白，不额外占高度。 */}
                        {rulePreview.parsed.unknownTokens.length > 0 ? (
                          <span className="text-xs text-red-400 flex items-center gap-1.5 min-w-0">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">
                              无法识别的标签：{rulePreview.parsed.unknownTokens.join("、")}
                            </span>
                          </span>
                        ) : rulePreview.emptiedByExclude ? (
                          <span className="text-xs text-amber-400 flex items-center gap-1.5 min-w-0">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">
                              排除字符「{excludeChars.trim()}」把某一位的候选全滤掉了，组合数为 0
                            </span>
                          </span>
                        ) : rulePreview.total > 0 ? (
                          <span className="text-xs text-content-muted flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                            当前规则穷举将会产生
                            <span className="text-red-400 font-bold">
                              {rulePreview.total.toLocaleString()}
                            </span>
                            条域名组合
                          </span>
                        ) : null}
                      </div>
                      <button
                        onClick={() => {
                          setBatchRules("");
                          showToast("info", "已清空生成规则");
                        }}
                        disabled={!batchRules}
                        className="shrink-0 text-xs font-semibold text-content-muted hover:text-red-700 border border-border-base hover:border-red-300 bg-elevated hover:bg-red-50 dark:hover:text-red-400 dark:hover:border-red-500/40 dark:hover:bg-red-950/30 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        一键清空
                      </button>
                    </div>
                    <div className="flex items-center bg-elevated border border-border-base rounded-xl px-4 focus-within:border-indigo-500 transition-colors">
                      <input
                        type="text"
                        value={batchRules}
                        onChange={(e) => setBatchRules(e.target.value)}
                        placeholder="例如: {字母}{字母}{字母} 或 my{字母}{数字}，也可直接填 myapp, test123"
                        className="w-full bg-transparent py-3 text-content-primary text-sm focus:outline-none"
                      />
                      <span className="text-xs text-indigo-400 font-bold whitespace-nowrap px-2">
                        {rulePreview.parsed.unknownTokens.length > 0
                          ? "⚠ 标签无法识别"
                          : rulePreview.emptiedByExclude
                            ? "⚠ 已被排除字符清空"
                            : rulePreview.total > 0
                              ? "ⓘ 规则就绪"
                              : "ⓘ 待输入规则"}
                      </span>
                    </div>

                    {/* 超限与耗时警告：偶发且文字较长，留在输入框下方，不挤占标题行 */}
                    {rulePreview.total > 0 &&
                      (rulePreview.total > MAX_PREFIXES ||
                        (selectedRoots.length > 0 && rulePreview.total > 5000)) && (
                        <p className="text-xs text-amber-400 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {rulePreview.total > MAX_PREFIXES && (
                            <span>超出上限，仅处理前 {MAX_PREFIXES.toLocaleString()} 条。</span>
                          )}
                          {selectedRoots.length > 0 && rulePreview.total > 5000 && (
                            <span>
                              按当前 {accounts.length || 1} 个账号 × {selectedRoots.length} 个后缀估算，
                              约需 {formatDuration(rulePreview.estSeconds)}，建议改用顺序模式配合断点续查
                            </span>
                          )}
                        </p>
                      )}
                  </div>

                  {/* 2. 排除字符与长度 */}
                  <div className="flex flex-col md:flex-row md:items-start gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <label className="block text-xs font-semibold text-content-muted h-4 leading-4">
                        排除字符 (可选，若域名中出现定义的字符，则忽略):
                      </label>
                      <input
                        type="text"
                        value={excludeChars}
                        onChange={(e) => setExcludeChars(e.target.value)}
                        placeholder="例如 01ol 避免字符易混淆 (可选)"
                        className="w-full bg-elevated border border-border-base rounded-xl px-4 py-2.5 text-content-primary text-xs focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div className="w-full md:w-[19rem] shrink-0 space-y-2">
                      {/* 提示放在标题行：与左列标题同高，不撑高行、不影响两列输入框对齐 */}
                      <div className="flex items-baseline gap-2 h-4 leading-4">
                        <label className="block text-xs font-semibold text-content-muted shrink-0">
                          生成组合长度:
                        </label>
                        {rulePreview.isBraceSyntax && (
                          <span className="text-[11px] text-content-muted/70 truncate">
                            花括号规则由标签数量决定长度，此项不生效
                          </span>
                        )}
                      </div>
                      <select
                        value={batchLength}
                        onChange={(e) => setBatchLength(Number(e.target.value))}
                        disabled={rulePreview.isBraceSyntax}
                        className="w-full bg-elevated border border-border-base rounded-xl px-4 py-2.5 text-content-primary text-xs focus:border-indigo-500 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          rulePreview.isBraceSyntax
                            ? "花括号规则由标签数量决定长度，此项不生效"
                            : undefined
                        }
                      >
                        <option value={2}>2位长度 (如 aa / ba / 88)</option>
                        <option value={3}>3位长度 (如 aaa / 123 / abc)</option>
                        <option value={4}>4位长度 (如 8888 / baba)</option>
                      </select>
                    </div>
                  </div>

                  {/* 3. 快捷标签按钮组 —— 点击插入 {标签} 占位符，可与字面量混排 */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-content-muted">
                      支持标签 (点击追加到规则框，可任意组合，也可与固定字符混排如 my
                      <span className="text-indigo-400">{"{字母}"}</span>):
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {BUILTIN_TOKENS.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setBatchRules(prev => `${prev}{${tag}}`)}
                          className="bg-elevated hover:bg-indigo-50 text-content-secondary hover:text-indigo-700 border border-border-base hover:border-indigo-300 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-300 dark:hover:border-indigo-500/40 text-xs px-3 py-1.5 rounded-lg transition-all"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 3.5 词库分类（点击追加到规则框；支持增删改） */}
                  <div className="space-y-3 border-t border-border-base pt-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-content-muted">
                        词库 (点击插入 <span className="text-indigo-400">{"{词库名}"}</span> 标签，可与其它标签组合；中文将自动转 Punycode 提交):
                      </label>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={openCreateBank}
                          className="text-xs font-semibold text-indigo-700 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-300 bg-indigo-50 hover:bg-indigo-100 dark:text-indigo-400 dark:hover:text-indigo-300 dark:border-indigo-500/40 dark:hover:border-indigo-500 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/60 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          新建词库
                        </button>
                        <button
                          onClick={handleResetBanks}
                          className="text-xs font-semibold text-content-muted hover:text-content-primary border border-border-base hover:border-content-muted bg-elevated hover:bg-hovered px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          恢复默认
                        </button>
                      </div>
                    </div>

                    {/* 按分组类型分栏渲染 */}
                    {(Object.keys(BANK_KIND_META) as BankKind[]).map((kind) => {
                      const banks = wordBanks.filter((b) => b.kind === kind);
                      const meta = BANK_KIND_META[kind];
                      return (
                        <div key={kind} className="space-y-1.5">
                          <span className={`text-[11px] font-semibold ${meta.titleClass}`}>
                            {meta.label}
                            <span className="text-content-muted font-normal ml-1">({banks.length})</span>
                          </span>
                          {banks.length === 0 ? (
                            <div className="text-[11px] text-content-muted italic">
                              该分类下暂无词库，可点击右上「新建词库」添加
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {banks.map((bank) => (
                                <div
                                  key={bank.id}
                                  className={`group flex items-center bg-elevated border border-border-base ${meta.hoverBorderClass} rounded-lg overflow-hidden transition-all`}
                                >
                                  {/* 主体：点击追加到规则框 */}
                                  <button
                                    onClick={() => appendWordbank(bank.words, bank.name)}
                                    className={`text-content-secondary ${meta.hoverTextClass} text-xs px-3 py-2.5 md:py-1.5 transition-all`}
                                    title={`点击追加 ${bank.words.length} 个词到规则框`}
                                  >
                                    {bank.name}
                                    <span className="ml-1 text-[10px] text-content-muted">
                                      {bank.words.length}
                                    </span>
                                  </button>
                                  {/* 编辑 / 删除 */}
                                  <button
                                    onClick={() => openEditBank(bank)}
                                    className="px-2.5 py-2.5 md:px-1.5 md:py-1.5 text-content-muted hover:text-indigo-400 hover:bg-hovered transition-all border-l border-border-base"
                                    title="编辑该词库"
                                  >
                                    <Pencil className="w-3.5 h-3.5 md:w-3 md:h-3" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteBank(bank)}
                                    className="px-2.5 py-2.5 md:px-1.5 md:py-1.5 text-content-muted hover:text-red-400 hover:bg-hovered transition-all border-l border-border-base"
                                    title="删除该词库"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 md:w-3 md:h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 3.55 官方保留前缀排除名单 */}
                  <div className="space-y-3 border-t border-border-base pt-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enableReservedFilter}
                          onChange={(e) => toggleReservedFilter(e.target.checked)}
                          className="w-4 h-4 accent-red-500"
                        />
                        <span className="text-xs font-semibold text-content-secondary">
                          启用官方保留前缀排除
                          <span className="text-content-muted font-normal ml-1">
                            (整词匹配，如 ai 被排除但 ailu 仍会查询)
                          </span>
                        </span>
                      </label>
                      <button
                        onClick={handleResetReserved}
                        className="text-xs font-semibold text-content-muted hover:text-content-primary border border-border-base hover:border-content-muted bg-elevated hover:bg-hovered px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 shrink-0"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        恢复默认
                      </button>
                    </div>

                    {enableReservedFilter && (
                      <div className="space-y-2.5 pl-6">
                        {/* 已有名单标签 */}
                        <div className="flex flex-wrap gap-2">
                          {reservedPrefixes.length === 0 ? (
                            <span className="text-[11px] text-content-muted italic">
                              名单为空，当前不会排除任何前缀
                            </span>
                          ) : (
                            reservedPrefixes.map((p) => (
                              <span
                                key={p}
                                className="group flex items-center bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-500/30 dark:text-red-300 text-xs rounded-lg overflow-hidden"
                              >
                                <span className="px-2.5 py-1 font-mono">{p}</span>
                                <button
                                  onClick={() => handleRemoveReserved(p)}
                                  className="px-1.5 py-1 text-red-500/70 hover:text-red-800 hover:bg-red-100 border-l border-red-200 dark:text-red-400/60 dark:hover:text-red-300 dark:hover:bg-red-900/40 dark:border-red-500/30 transition-all"
                                  title={`从名单移除 ${p}`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))
                          )}
                        </div>

                        {/* 添加输入框 */}
                        <form onSubmit={handleAddReserved} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newReservedInput}
                            onChange={(e) => setNewReservedInput(e.target.value)}
                            placeholder="添加保留前缀，可一次粘贴多个（逗号/空格分隔）"
                            className="flex-1 bg-elevated border border-border-base rounded-xl px-3 py-2 text-content-primary text-xs focus:border-red-500/60 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={!newReservedInput.trim()}
                            className="bg-elevated hover:bg-hovered text-content-secondary hover:text-content-primary border border-border-base text-xs font-semibold px-3 py-2 rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            添加
                          </button>
                        </form>
                      </div>
                    )}
                  </div>

                  {/* 3.6 顺序检测模式（进位递增 + 断点续查） */}
                  <div className="space-y-3 border-t border-border-base pt-5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={seqMode}
                        onChange={(e) => setSeqMode(e.target.checked)}
                        className="w-4 h-4 accent-indigo-500"
                      />
                      <span className="text-xs font-semibold text-content-secondary">
                        启用顺序检测模式（按字符集进位递增，如 aaa → aab → aac…，开启后忽略上方规则框）
                      </span>
                    </label>

                    {seqMode && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pl-6">
                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-semibold text-content-muted">字符集:</label>
                          <select
                            value={seqCharset}
                            onChange={(e) => setSeqCharset(e.target.value as typeof seqCharset)}
                            className="w-full bg-elevated border border-border-base rounded-xl px-3 py-2 text-content-primary text-xs focus:border-indigo-500 focus:outline-none"
                          >
                            <option value="字母">纯字母 (a-z)</option>
                            <option value="数字">纯数字 (0-9)</option>
                            <option value="字母数字">字母+数字 (a-z0-9)</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-semibold text-content-muted">长度:</label>
                          <select
                            value={seqLength}
                            onChange={(e) => setSeqLength(Number(e.target.value))}
                            className="w-full bg-elevated border border-border-base rounded-xl px-3 py-2 text-content-primary text-xs focus:border-indigo-500 focus:outline-none"
                          >
                            <option value={2}>2 位</option>
                            <option value={3}>3 位</option>
                            <option value={4}>4 位</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-semibold text-content-muted">起始串 (可选):</label>
                          <input
                            type="text"
                            value={seqStart}
                            onChange={(e) => setSeqStart(e.target.value)}
                            placeholder="如 qwe，留空从头开始"
                            className="w-full bg-elevated border border-border-base rounded-xl px-3 py-2 text-content-primary text-xs focus:border-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    )}

                    {/* 查重池开关 */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ignorePool}
                        onChange={(e) => setIgnorePool(e.target.checked)}
                        className="w-4 h-4 accent-amber-500"
                      />
                      <span className="text-xs font-semibold text-content-secondary">
                        忽略查重池，强制全部重查
                        <span className="text-content-muted font-normal ml-1">
                          （默认会跳过池中 7 天内已确认「已注册」的域名以节省 API 配额；勾选此项可刷新过期结论）
                        </span>
                      </span>
                    </label>

                    {/* 断点续查提示条 */}
                    {scanCursor && scanStatus !== "running" && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-500/30 rounded-xl px-4 py-3">
                        <div className="text-xs text-amber-800 dark:text-amber-300">
                          🔖 检测到上次未完成的扫描断点：
                          <span className="font-mono font-bold mx-1">{scanCursor.lastCandidate || "起点"}</span>
                          （已查 {scanCursor.checked} 个 · 保存于 {scanCursor.savedAt}）
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleStartBatchScan(scanCursor.lastCandidate)}
                            className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                          >
                            从断点继续
                          </button>
                          <button
                            onClick={clearScanCursor}
                            className="text-xs text-content-muted hover:text-content-primary px-2 py-1.5"
                          >
                            清除断点
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 4. 根域名后缀多选组 (支持添加自定义根域名) */}
                  <div className="space-y-3 border-t border-border-base pt-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-content-secondary">
                        选择欲检测的 DNSHE 官方及自定义根域名后缀:
                      </label>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setSelectedRoots([...allRootDomains])}
                          className="text-xs text-indigo-400 hover:underline"
                        >
                          全选 ({allRootDomains.length})
                        </button>
                        <span className="text-content-muted">|</span>
                        <button
                          onClick={() => setSelectedRoots([])}
                          className="text-xs text-content-muted hover:underline"
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
                            className={`group relative flex items-center justify-between p-2.5 md:p-2 rounded-lg border text-xs font-mono transition-all ${
                              isChecked
                                ? "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-950/40 dark:border-indigo-500/50 dark:text-indigo-300"
                                : "bg-elevated border-border-base text-content-muted hover:text-content-primary"
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
                                className="rounded border-border-base text-indigo-600 focus:ring-0"
                              />
                              <span className="truncate">.{root}</span>
                            </label>

                            {!isDefault && (
                              <button
                                type="button"
                                title="删除该自定义根域名"
                                onClick={() => handleRemoveCustomRootDomain(root)}
                                /*
                                  NOTE: 原本是 opacity-0 group-hover:opacity-100 —— 触屏没有
                                  hover，这个按钮在手机上永远显不出来也点不到。窄屏改为常显，
                                  ≥md 才保留"悬停才出现"的桌面观感。
                                */
                                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-content-muted hover:text-red-400 p-1.5 md:p-0.5 ml-1 transition-opacity"
                              >
                                <X className="w-3.5 h-3.5 md:w-3 md:h-3" />
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
                        className="bg-elevated border border-border-base focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-content-primary focus:outline-none flex-1 font-mono"
                      />
                      <button
                        type="submit"
                        disabled={!newRootInput.trim()}
                        className="bg-elevated hover:bg-hovered text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 border border-border-base text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 disabled:opacity-40"
                      >
                        <Plus className="w-3.5 h-3.5" /> 添加根域
                      </button>
                    </form>
                  </div>

                  {/* 5. 主控制按钮条 */}
                  <div className="flex flex-wrap items-center gap-3 border-t border-border-base pt-5">
                    <button
                      onClick={() => handleStartBatchScan()}
                      disabled={scanStatus === "running"}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm px-6 py-3 rounded-xl transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
                    >
                      <Play className={`w-4 h-4 ${scanStatus === "running" ? "animate-spin" : ""}`} />
                      {scanStatus === "running" ? "正在查重中..." : scanStatus === "paused" ? "恢复查询" : "开始生成查询"}
                    </button>

                    <button
                      onClick={() => {
                        const c = scanCursorRef.current;
                        saveScanCursor(c.lastCandidate, c.taskIndex, c.checked);
                        updateScanStatus("paused");
                        showToast("info", `⏸️ 已暂停并保存断点（当前位置：${c.lastCandidate || "起点"}）`);
                      }}
                      disabled={scanStatus !== "running"}
                      className="bg-elevated hover:bg-hovered text-content-secondary font-semibold text-sm px-5 py-3 rounded-xl transition-all disabled:opacity-50"
                    >
                      暂停查询
                    </button>

                    <button
                      onClick={() => {
                        updateScanStatus("idle");
                        setAvailableDomainsList([]);
                        setScanLogs([]);
                        setScanProgress({ total: 0, checked: 0, available: 0 });
                        clearScanCursor();
                        showToast("info", "🔄 已重置查重逻辑（断点已清除）");
                      }}
                      className="bg-elevated hover:bg-hovered text-content-secondary font-semibold text-sm px-5 py-3 rounded-xl transition-all"
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
                  <div className="bg-surface border border-border-base rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-center justify-between text-xs font-semibold text-content-secondary">
                      <span>查重进度: {scanProgress.checked} / {scanProgress.total} ({Math.round((scanProgress.checked / scanProgress.total) * 100)}%)</span>
                      <span className="text-emerald-400 font-bold">🎉 发现可用免费域名: {availableDomainsList.length} 个</span>
                    </div>

                    {/* 进度条 */}
                    <div className="w-full bg-elevated rounded-full h-3 overflow-hidden border border-border-base">
                      <div
                        className="bg-indigo-500 h-full transition-all duration-300"
                        style={{ width: `${Math.round((scanProgress.checked / scanProgress.total) * 100)}%` }}
                      ></div>
                    </div>

                    {/* 发现可注册域名的实时表格 */}
                    <div className="space-y-3 pt-2">
                      <h4 className="text-sm font-bold text-content-primary flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        发现未注册域名 (点击注册)
                      </h4>

                      {availableDomainsList.length === 0 ? (
                        <div className="text-center py-8 bg-hovered rounded-xl border border-border-base text-xs text-content-muted">
                          {scanStatus === "running" ? "正在高频查重校验中，请稍候..." : "暂未查出可用的域名"}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {availableDomainsList.map((item, idx) => (
                            <div
                              key={idx}
                              className="bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-500/30 rounded-xl p-3 flex items-center justify-between gap-2 hover:border-emerald-500 transition-all"
                            >
                              <div className="min-w-0">
                                <span className="font-mono text-sm font-bold text-content-primary block truncate">
                                  {item.fullDomain}
                                </span>
                                <span className="text-[10px] text-content-muted block mt-0.5">
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
                                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 sm:py-1.5 rounded-lg shadow transition-all flex items-center gap-1 flex-shrink-0"
                              >
                                <Plus className="w-3.5 h-3.5" /> 注册
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 实时爆破扫描中文日志卡片 */}
                    <div className="space-y-3 pt-4 border-t border-border-base">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-content-primary flex items-center gap-2">
                          <ScrollText className="w-4 h-4 text-indigo-400" />
                          实时查询日志 (自动滚动最新 50 条)
                        </h4>
                        <span className="text-xs text-content-muted font-mono">
                          {scanLogs.length > 0 ? `最新推送: ${scanLogs[0].time}` : "等待扫码响应..."}
                        </span>
                      </div>

                      <div className="bg-elevated rounded-xl p-3.5 border border-border-base font-mono text-xs max-h-56 overflow-y-auto space-y-1.5 scrollbar-thin">
                        {scanLogs.length === 0 ? (
                          <div className="text-center py-6 text-content-muted">
                            正在高频检测中，实时中文日志流水将在此处高频输出...
                          </div>
                        ) : (
                          scanLogs.map((log) => (
                            <div key={log.id} className="flex items-start gap-2 border-b border-border-base pb-1 last:border-0">
                              <span className="text-content-muted font-semibold flex-shrink-0">[{log.time}]</span>
                              <span className={`min-w-0 break-all ${
                                log.status === "available"
                                  ? "text-emerald-400 font-bold"
                                  : log.status === "error"
                                  ? "text-amber-400"
                                  : "text-content-muted"
                              }`}>
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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4 bg-surface border border-border-base p-3 sm:p-4 rounded-xl">
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-4 w-full md:w-auto">
                {/* NOTE: 下拉框原先是 min-w-[180px]，配上 whitespace-nowrap 的标签在手机上是
                    硬溢出（不是"挤"）。窄屏改为占满行宽并允许收缩，≥md 才恢复最小宽度。 */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-content-secondary flex items-center gap-1.5 whitespace-nowrap flex-shrink-0">
                    <UserCheck className="w-4 h-4 text-indigo-400" /> 选择账号:
                  </span>
                  <select
                    value={selectedAccountFilter}
                    onChange={(e) => {
                      setSelectedAccountFilter(e.target.value);
                      fetchDomains(e.target.value);
                    }}
                    className="form-input px-3 py-2 rounded-lg text-sm text-content-secondary flex-1 min-w-0 md:flex-none md:min-w-[180px]"
                  >
                    <option value="all">全部账号 (按账号独立分组)</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={String(acc.id)}>
                        账号: {acc.alias}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-content-secondary flex items-center gap-1.5 whitespace-nowrap flex-shrink-0">
                    <Server className="w-4 h-4 text-sky-400" /> DNS 类型:
                  </span>
                  <select
                    value={nsTypeFilter}
                    onChange={(e) => setNsTypeFilter(e.target.value as "all" | "default" | "external")}
                    className="form-input px-3 py-2 rounded-lg text-sm text-content-secondary flex-1 min-w-0 md:flex-none md:min-w-[150px]"
                  >
                    <option value="all">全部 DNS 类型</option>
                    <option value="default">仅系统默认 DNS</option>
                    <option value="external">仅外部 DNS 委派</option>
                  </select>
                </div>
              </div>

              {/* NOTE: 这一组原先没有 flex-wrap，却装着三个 whitespace-nowrap 的元素 */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full md:w-auto">
                {globalSearch.trim() && (
                  <div className="flex items-center gap-1.5 text-xs bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60 px-2.5 py-1 rounded-full whitespace-nowrap">
                    <Search className="w-3 h-3 shrink-0" />
                    <span className="font-mono">
                      搜索「{globalSearch.trim()}」· 命中 {searchHitCount} 个
                    </span>
                    <button
                      onClick={() => setGlobalSearch("")}
                      className="ml-0.5 font-semibold underline decoration-dotted hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
                    >
                      清除
                    </button>
                  </div>
                )}
                <div className="text-xs text-content-muted font-mono whitespace-nowrap">
                  已绑定账户: <span className="text-indigo-400 font-bold">{accounts.length}</span> |
                  托管域名: <span className="text-emerald-400 font-bold">{domains.length}</span> 个
                </div>
                {domains.length > 0 && (
                  <button
                    onClick={toggleAllAccounts}
                    className="px-3 py-2 sm:py-1.5 text-xs font-semibold text-content-secondary hover:text-content-primary bg-elevated hover:bg-hovered border border-border-base rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ml-auto sm:ml-0"
                  >
                    {collapsedAccounts.size > 0 ? (
                      <>
                        <ChevronsUpDown className="w-3.5 h-3.5" />
                        展开全部
                      </>
                    ) : (
                      <>
                        <ChevronsDownUp className="w-3.5 h-3.5" />
                        收起全部
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* 域名列表展示 */}
            {loadingDomains ? (
              <div className="flex flex-col items-center justify-center py-20 text-content-muted">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
                <span>正在加载域名列表...</span>
              </div>
            ) : domains.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border-base rounded-xl bg-surface">
                <Globe className="w-12 h-12 text-content-muted mx-auto mb-3" />
                <h3 className="text-lg font-bold text-content-secondary">未找到域名记录</h3>
                <p className="text-content-muted text-sm mt-1 max-w-md mx-auto">
                  {selectedAccountFilter !== "all" 
                    ? "当前选中账号下没有绑定任何域名。"
                    : "尚未绑定账号或本地缓存中没有域名。请前往「账号管理」添加 API 密钥，然后点击「同步所有账号」。"}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {groupedDomains.map((group) => {
                  const defaultDomains = group.domains.filter(checkHasDns);
                  const externalDomains = group.domains.filter((d) => !checkHasDns(d));

                  const showDefault = nsTypeFilter === "all" || nsTypeFilter === "default";
                  const showExternal = nsTypeFilter === "all" || nsTypeFilter === "external";
                  const isCollapsed = collapsedAccounts.has(group.accountId);

                  return (
                    <div
                      key={group.accountId}
                      className={`bg-hovered p-3 sm:p-4 md:p-6 rounded-2xl border border-border-base ${
                        isCollapsed ? "" : "space-y-4 md:space-y-6"
                      }`}
                    >
                      {/* 账号大标题（可点击展开/收起）；收起时去掉分隔线与下边距，保持上下留白对称 */}
                      <button
                        onClick={() => toggleAccountCollapse(group.accountId)}
                        className={`w-full flex items-center justify-between hover:opacity-80 transition-opacity text-left ${
                          isCollapsed ? "" : "border-b border-border-base pb-4"
                        }`}
                      >
                        <h3 className="text-base md:text-lg font-bold text-content-primary flex items-center gap-2 flex-wrap min-w-0">
                          {isCollapsed ? (
                            <ChevronRight className="w-5 h-5 text-indigo-400 shrink-0" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-indigo-400 shrink-0" />
                          )}
                          <Key className="w-4 h-4 text-indigo-400 shrink-0" />
                          {group.seq > 0 && (
                            <>
                              <span className="text-emerald-400">账号 {group.seq}</span>
                              <span className="text-content-muted">·</span>
                            </>
                          )}
                          <span className="text-indigo-700 dark:text-indigo-300 truncate max-w-full">{group.alias}</span>
                          <span className="text-[11px] md:text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/80 dark:text-indigo-300 dark:border-indigo-900/60 px-2 md:px-2.5 py-0.5 rounded-full font-normal">
                            共 {group.domains.length} 个域名（系统默认: {defaultDomains.length} | 外部DNS: {externalDomains.length}）
                          </span>
                        </h3>
                      </button>

                      {/* 域名内容区（收起时隐藏） */}
                      {!isCollapsed && (
                      <>
                      {/* 子分块 1：系统默认 DNS 域名 */}
                      {showDefault && defaultDomains.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-sm font-bold text-content-secondary">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block shrink-0" />
                            <span>系统默认 DNS 域名 ({defaultDomains.length})</span>
                            <span className="hidden sm:inline text-xs text-content-muted font-normal">—— 支持直接在线管理 DNS 解析记录</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
                            {defaultDomains.map(renderDomainCard)}
                          </div>
                        </div>
                      )}

                      {/* 子分块 2：外部 DNS 委派域名 */}
                      {showExternal && externalDomains.length > 0 && (
                        <div className="space-y-3 pt-2">
                          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-sm font-bold text-content-secondary">
                            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block shrink-0" />
                            <span>外部 DNS 委派域名 ({externalDomains.length})</span>
                            <span className="hidden sm:inline text-xs text-content-muted font-normal">—— 已托管至 Cloudflare 等第三方服务商</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
                            {externalDomains.map(renderDomainCard)}
                          </div>
                        </div>
                      )}
                      </>
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
          <div className="space-y-6">
            {/* 顶部：绑定按钮（横排，点击打开弹窗） */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setBindModal("single")}
                className="flex-1 py-3 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500 shadow-lg shadow-indigo-900/40 flex items-center justify-center gap-2 transition-all"
              >
                <Plus className="w-5 h-5" />
                绑定单个账号
              </button>
              <button
                type="button"
                onClick={() => setBindModal("batch")}
                className="flex-1 py-3 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500 shadow-lg shadow-emerald-900/40 flex items-center justify-center gap-2 transition-all"
              >
                <Sparkles className="w-5 h-5" />
                批量绑定账号
              </button>
            </div>

            {/* 已绑定的 API 账号 */}
            <div>
              <h2 className="text-lg font-bold text-content-primary mb-4">已绑定的 API 账号 ({accounts.length})</h2>

              {loadingAccounts ? (
                <div className="flex justify-center py-10">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                </div>
              ) : accounts.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-border-base rounded-xl bg-surface">
                  <Key className="w-10 h-10 text-content-muted mx-auto mb-2" />
                  <p className="text-content-muted text-sm">尚未绑定任何 API 账户</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {accounts.map((acc) => (
                    <div key={acc.id} className="glass-card rounded-xl p-5 border border-border-base flex justify-between items-start gap-4">
                      <div className="min-w-0">
                        <h3 className="font-bold text-content-primary text-base truncate">{acc.alias}</h3>
                        <p className="text-content-muted text-xs mt-1.5 font-mono break-all">
                          Key: {acc.api_key.substring(0, 8)}***{acc.api_key.substring(acc.api_key.length - 4)}
                        </p>
                        <p className="text-[10px] text-content-muted mt-2">
                          绑定于: {new Date(acc.created_at).toLocaleString("zh-CN")}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button
                          onClick={() => openEditAccount(acc)}
                          disabled={actionLoading === `update-account-${acc.id}`}
                          className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-800 border border-indigo-200 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 dark:text-indigo-400 dark:hover:text-indigo-200 dark:border-indigo-900/50 p-2 rounded-lg transition-all"
                          title="修改账号"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAccount(acc.id)}
                          disabled={actionLoading === `delete-account-${acc.id}`}
                          className="bg-red-50 hover:bg-red-100 text-red-700 hover:text-red-800 border border-red-200 dark:bg-red-950/60 dark:hover:bg-red-900/60 dark:text-red-400 dark:hover:text-red-200 dark:border-red-900/50 p-2 rounded-lg transition-all"
                          title="删除账号"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 修改账号弹窗 */}
        {editingAccount && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md">
            {/* NOTE: max-h + flex-col + 正文 overflow-y-auto 三件套缺一不可 —— 少了 max-h，
                内容超过屏高时会被 overflow-hidden 直接裁掉且滚不到（手机上尤其明显） */}
            <div className="bg-surface border border-border-base w-full max-w-md max-h-[90dvh] rounded-xl overflow-hidden flex flex-col shadow-2xl">
              <div className="bg-elevated px-4 sm:px-6 py-4 flex items-center justify-between border-b border-border-base flex-shrink-0">
                <h3 className="text-lg font-bold text-content-primary flex items-center gap-1.5">
                  <Settings className="w-5 h-5 text-indigo-400" /> 修改账号
                </h3>
                <button
                  onClick={() => setEditingAccount(null)}
                  className="text-content-muted hover:text-content-primary p-2 md:p-1 hover:bg-hovered rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
                {/*
                  NOTE: 这三个输入框必须显式标注 autoComplete 与不像凭据的 name。
                  缺了这些提示，Chrome 密码管理器会把「API Secret」当成登录密码框，
                  再顺手把它上方最近的文本框（API Key）当成用户名一起填上——于是
                  只想改个别名时，两个密钥框会被静默填成登录用户名与登录密码。
                  这不只是要手动清空的麻烦：handleUpdateAccount 见到两个框都非空
                  就认定「要换密钥」，把填进去的登录凭据当新密钥送去校验，结果是
                  改别名直接失败在「无法验证新 API 密钥有效性」上。

                  和设置页的密码表单同一套解法：把密码框标成 new-password，表单内
                  就不存在可填充的凭据目标，Chrome 不会发起这次成对填充。
                */}
                <div>
                  <label className="block text-xs font-semibold text-content-muted mb-1.5">账户别名</label>
                  <input
                    type="text"
                    name="dnshe-account-alias"
                    autoComplete="off"
                    value={editAlias}
                    onChange={(e) => setEditAlias(e.target.value)}
                    placeholder="账户别名"
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-content-secondary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-content-muted mb-1.5">API Key（留空保持不变）</label>
                  <input
                    type="text"
                    name="dnshe-edit-api-key"
                    autoComplete="off"
                    value={editApiKey}
                    onChange={(e) => setEditApiKey(e.target.value)}
                    placeholder={`当前: ${editingAccount.api_key.substring(0, 8)}***${editingAccount.api_key.substring(editingAccount.api_key.length - 4)}`}
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-content-secondary font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-content-muted mb-1.5">API Secret（留空保持不变）</label>
                  <PasswordInput
                    name="dnshe-edit-api-secret"
                    autoComplete="new-password"
                    value={editApiSecret}
                    onChange={setEditApiSecret}
                    placeholder="如需更换密钥则填写新的 API Secret"
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-content-secondary"
                  />
                </div>
                <p className="text-[11px] text-content-muted leading-relaxed">
                  仅修改别名时无需填写密钥；更换 API Key/Secret 会校验新密钥有效性，并自动重新同步该账号的域名缓存。
                </p>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setEditingAccount(null)}
                    className="flex-1 bg-elevated hover:bg-hovered text-content-muted border border-border-base px-4 py-2 rounded-lg text-sm"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleUpdateAccount}
                    disabled={actionLoading === `update-account-${editingAccount.id}`}
                    className="flex-1 btn-primary px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {actionLoading === `update-account-${editingAccount.id}` ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Save className="w-4 h-4" /> 保存修改
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 绑定单个账号弹窗 */}
        {/* 词库新建 / 编辑模态框 */}
        {bankModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md">
            <div className="bg-surface border border-border-base w-full max-w-lg max-h-[90dvh] rounded-xl overflow-hidden flex flex-col shadow-2xl">
              <div className="bg-elevated px-4 sm:px-6 py-4 flex items-center justify-between border-b border-border-base flex-shrink-0">
                <h3 className="text-lg font-bold text-content-primary flex items-center gap-1.5">
                  {editingBank ? (
                    <>
                      <Pencil className="w-5 h-5 text-indigo-400" /> 编辑词库
                    </>
                  ) : (
                    <>
                      <Plus className="w-5 h-5 text-indigo-400" /> 新建词库
                    </>
                  )}
                </h3>
                <button
                  onClick={() => setBankModalOpen(false)}
                  className="text-content-muted hover:text-content-primary p-2 md:p-1 hover:bg-hovered rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className="block text-xs font-semibold text-content-muted mb-1.5">
                    词库类型
                  </label>
                  <select
                    value={bankFormKind}
                    onChange={(e) => setBankFormKind(e.target.value as BankKind)}
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-content-secondary"
                  >
                    {(Object.keys(BANK_KIND_META) as BankKind[]).map((k) => (
                      <option key={k} value={k}>
                        {BANK_KIND_META[k].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-content-muted mb-1.5">
                    词库名称
                  </label>
                  <input
                    type="text"
                    placeholder="如：热门城市 / 5字母单词 / 我的收藏"
                    value={bankFormName}
                    onChange={(e) => setBankFormName(e.target.value)}
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-content-secondary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-content-muted mb-1.5">
                    词条内容
                    <span className="font-normal ml-1">
                      (用逗号、空格或换行分隔，保存时自动去重)
                    </span>
                  </label>
                  <textarea
                    rows={8}
                    placeholder={"如：\n北京, 上海, 广州\n或每行一个词"}
                    value={bankFormWords}
                    onChange={(e) => setBankFormWords(e.target.value)}
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-content-secondary font-mono resize-y"
                  />
                  <p className="text-[11px] text-content-muted mt-1.5">
                    当前解析出 <span className="text-indigo-400 font-bold">{parseWords(bankFormWords).length}</span> 个词条
                  </p>
                </div>
              </div>

              <div className="bg-elevated px-6 py-4 flex items-center justify-end gap-3 border-t border-border-base">
                <button
                  onClick={() => setBankModalOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-content-secondary hover:text-content-primary bg-surface hover:bg-hovered border border-border-base rounded-lg transition-all"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveBank}
                  className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-all shadow-lg flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  {editingBank ? "保存修改" : "创建词库"}
                </button>
              </div>
            </div>
          </div>
        )}

        {bindModal === "single" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md">
            <div className="bg-surface border border-border-base w-full max-w-md max-h-[90dvh] rounded-xl overflow-hidden flex flex-col shadow-2xl">
              <div className="bg-elevated px-4 sm:px-6 py-4 flex items-center justify-between border-b border-border-base flex-shrink-0">
                <h3 className="text-lg font-bold text-content-primary flex items-center gap-1.5">
                  <Plus className="w-5 h-5 text-indigo-400" /> 绑定单个账号
                </h3>
                <button
                  onClick={() => setBindModal(null)}
                  className="text-content-muted hover:text-content-primary p-2 md:p-1 hover:bg-hovered rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddAccount} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
                {/* NOTE: 与「修改账号」弹窗同理，避免 Chrome 把 API Key/Secret 当成登录凭据对填充 */}
                <div>
                  <label className="block text-xs font-semibold text-content-muted mb-1.5">账户别名 (可选，留空自动解析)</label>
                  <input
                    type="text"
                    name="dnshe-bind-alias"
                    autoComplete="off"
                    placeholder="如：主账号、测试组"
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-content-secondary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-content-muted mb-1.5">API Key</label>
                  <input
                    type="text"
                    required
                    name="dnshe-bind-api-key"
                    autoComplete="off"
                    placeholder="cfsd_xxxxxxxxxx"
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-content-secondary font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-content-muted mb-1.5">API Secret</label>
                  <PasswordInput
                    required
                    name="dnshe-bind-api-secret"
                    autoComplete="new-password"
                    placeholder="请输入 API Secret"
                    value={newApiSecret}
                    onChange={setNewApiSecret}
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm text-content-secondary"
                  />
                </div>
                <p className="text-[11px] text-content-muted leading-relaxed">
                  别名留空时，系统会自动调用 DNSHE 密钥列表接口获取该 Key 的名称作为别名。
                </p>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setBindModal(null)}
                    className="flex-1 bg-elevated hover:bg-hovered text-content-muted border border-border-base px-4 py-2 rounded-lg text-sm"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading === "add-account"}
                    className="flex-1 btn-primary px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {actionLoading === "add-account" ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Plus className="w-4 h-4" /> 验证并绑定账号
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 批量绑定账号弹窗 */}
        {bindModal === "batch" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85">
            <div className="bg-surface border border-border-base w-full max-w-lg max-h-[90dvh] rounded-xl overflow-hidden flex flex-col shadow-2xl">
              <div className="bg-elevated px-4 sm:px-6 py-4 flex items-center justify-between border-b border-border-base flex-shrink-0">
                <h3 className="text-lg font-bold text-content-primary flex items-center gap-1.5">
                  <Sparkles className="w-5 h-5 text-emerald-400" /> 批量绑定账号
                </h3>
                <button
                  onClick={() => setBindModal(null)}
                  className="text-content-muted hover:text-content-primary p-2 md:p-1 hover:bg-hovered rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
                <p className="text-xs text-content-muted leading-relaxed">
                  每行填入一组 <span className="font-mono text-indigo-400">API Key + API Secret</span>（用空格 / Tab / 逗号分隔），别名自动从 API Key 解析，无需填写。
                </p>
                <div className="relative">
                  <textarea
                    ref={batchTextareaRef}
                    value={batchInput}
                    onChange={(e) => setBatchInput(e.target.value)}
                    rows={6}
                    spellCheck={false}
                    placeholder={"cfsd_xxxxxxxx1 你的secret1\ncfsd_xxxxxxxx2 你的secret2\ncfsd_xxxxxxxx3,你的secret3"}
                    className="w-full form-input px-3 py-2.5 rounded-lg text-sm font-mono text-content-secondary resize-none"
                    style={{ height: 160, transition: "none" }}
                  />
                  <div
                    onPointerDown={handleBatchResizeStart}
                    className="absolute bottom-0 right-1 h-4 w-10 cursor-ns-resize touch-none select-none flex items-center justify-center gap-[3px]"
                    title="拖拽调整高度"
                  >
                    <span className="block w-3.5 h-[3px] rounded-full bg-current opacity-50" />
                    <span className="block w-3.5 h-[3px] rounded-full bg-current opacity-50" />
                  </div>
                </div>
                <button
                  onClick={handleBatchAddAccounts}
                  disabled={actionLoading === "batch-add-accounts"}
                  className="w-full btn-primary py-2.5 rounded-lg font-semibold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {actionLoading === "batch-add-accounts" ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> 正在批量验证绑定…
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" /> 开始批量绑定 ({batchInput.split(/[\n;；]+/).map((l) => l.trim()).filter(Boolean).length} 条)
                    </>
                  )}
                </button>

                {batchResults && batchResults.length > 0 && (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {batchResults.map((r, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start justify-between gap-2 text-xs px-3 py-2 rounded-lg border ${
                          r.success
                            ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300"
                            : "bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-mono truncate">{r.api_key}</div>
                          {r.alias && <div className="text-content-muted truncate">别名: {r.alias}</div>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {r.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                          <span>{r.success ? "成功" : r.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: 账户配额 */}
        {activeTab === "quota" && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4 sm:mb-6">
              <h2 className="text-base sm:text-lg font-bold text-content-primary">各账户域名配额概览</h2>
              <button
                onClick={() => fetchQuotas(true)}
                disabled={loadingQuotas}
                className="bg-elevated hover:bg-hovered text-content-secondary border border-border-base px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60 flex-shrink-0"
                title="强制从 DNSHE 重新拉取配额"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingQuotas ? "animate-spin" : ""}`} />
                刷新
              </button>
            </div>
            
            {loadingQuotas ? (
              <div className="flex justify-center py-20">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
              </div>
            ) : quotas.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border-base rounded-xl bg-surface">
                <Database className="w-12 h-12 text-content-muted mx-auto mb-3" />
                <p className="text-content-muted">没有查到配额数据。请确保至少绑定了一个账户，并且密钥配置无误。</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {quotas.map((q, idx) => {
                  if (q.error) {
                    return (
                      <div key={idx} className="bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-900/50 rounded-xl p-4 sm:p-5">
                        <h3 className="font-bold text-red-700 dark:text-red-400 truncate">{q.alias}</h3>
                        <p className="text-red-800 dark:text-red-300 text-sm mt-2 flex items-start gap-1.5">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <span className="min-w-0 break-words">API 调用异常: {q.error}</span>
                        </p>
                      </div>
                    );
                  }

                  const percent = q.total > 0 ? Math.round((q.used / q.total) * 100) : 0;

                  return (
                    <div key={q.account_id} className="glass-card rounded-xl p-4 sm:p-5 border border-border-base">
                      <div className="flex justify-between items-center gap-2 mb-4">
                        <h3 className="font-bold text-content-primary text-base sm:text-lg truncate min-w-0">{q.alias}</h3>
                        <span className="text-xs bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 px-2 py-0.5 rounded-full flex-shrink-0">
                          可用: {q.available}
                        </span>
                      </div>

                      {/* 环形/条形进度展示 */}
                      <div className="space-y-3">
                        <div className="flex justify-between text-xs text-content-muted">
                          <span>已用子域名: {q.used} / {q.total}</span>
                          <span>{percent}%</span>
                        </div>
                        <div className="w-full bg-elevated h-2 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${
                              percent > 85 ? "bg-red-500" : percent > 60 ? "bg-amber-500" : "bg-indigo-500"
                            }`} 
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-6 pt-4 border-t border-border-base text-center">
                        <div>
                          <span className="block text-[11px] text-content-muted">基础配额</span>
                          <span className="text-sm font-semibold text-content-secondary">{q.base}</span>
                        </div>
                        <div>
                          <span className="block text-[11px] text-content-muted">邀请赠送</span>
                          <span className="text-sm font-semibold text-content-secondary">+{q.invite_bonus}</span>
                        </div>
                        <div>
                          <span className="block text-[11px] text-content-muted">总配额</span>
                          <span className="text-sm font-semibold text-content-primary">{q.total}</span>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base sm:text-lg font-bold text-content-primary">运行日志 (最近100条)</h2>
              <button
                onClick={handleClearLogs}
                disabled={actionLoading === "clear-logs"}
                className="bg-red-50 hover:bg-red-100 text-red-700 hover:text-red-800 border border-red-200 dark:bg-red-950/60 dark:hover:bg-red-900/60 dark:text-red-400 dark:hover:text-red-200 dark:border-red-900/50 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all flex-shrink-0"
              >
                清空运行日志
              </button>
            </div>

            {/* 日志分类子标签 */}
            <div className="flex gap-2 flex-wrap">
              {([
                { key: "all", label: "全部", icon: <ScrollText className="w-4 h-4" /> },
                { key: "auth", label: "登录", icon: <LogIn className="w-4 h-4" /> },
                { key: "api", label: "API", icon: <Server className="w-4 h-4" /> },
                { key: "operation", label: "操作", icon: <Activity className="w-4 h-4" /> },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setLogCategory(t.key)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    logCategory === t.key
                      ? "bg-indigo-600 text-white"
                      : "bg-elevated text-content-muted hover:text-content-primary hover:bg-hovered border border-border-base"
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {loadingLogs ? (
              <div className="flex justify-center py-20">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border-base rounded-xl bg-surface">
                <ScrollText className="w-12 h-12 text-content-muted mx-auto mb-3" />
                <p className="text-content-muted">该分类下暂无运行日志</p>
              </div>
            ) : (
              <>
                {/* ≥md：保持原有 4 列表格（固定列宽合计 416px + p-4 内边距，在手机上必然横向溢出） */}
                <div className="hidden md:block bg-surface border border-border-base rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead>
                        <tr className="bg-elevated text-content-muted text-xs border-b border-border-base">
                          <th className="p-4 w-44">时间</th>
                          <th className="p-4 w-28">类型</th>
                          <th className="p-4 w-32">模块</th>
                          <th className="p-4">描述信息</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-soft font-medium">
                        {filteredLogs.map((log) => {
                          const parts = logRowParts(log);
                          return (
                            <tr key={log.id} className="hover:bg-hovered transition-colors">
                              <td className="p-4 text-xs text-content-muted font-mono">{parts.time}</td>
                              <td className="p-4 text-xs">{parts.badge}</td>
                              <td className="p-4 text-xs text-content-secondary font-semibold capitalize">
                                {log.category}
                              </td>
                              <td className="p-4 text-content-secondary">
                                <div>{log.message}</div>
                                {parts.details}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* <md：每条日志一张卡片，字段纵向堆叠 */}
                <div className="md:hidden space-y-2">
                  {filteredLogs.map((log) => {
                    const parts = logRowParts(log);
                    return (
                      <div
                        key={log.id}
                        className="bg-surface border border-border-base rounded-xl p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          {parts.badge}
                          <span className="text-content-muted font-mono truncate">{parts.time}</span>
                        </div>
                        <div className="text-sm text-content-secondary break-words">{log.message}</div>
                        <div className="flex items-center gap-1.5 text-[11px] text-content-muted">
                          <Server className="w-3 h-3 flex-shrink-0" />
                          <span className="capitalize">{log.category}</span>
                        </div>
                        {parts.details}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 7: 设置 */}
        {activeTab === "settings" && (
          <div className="space-y-6 max-w-3xl">
            <div>
              <h2 className="text-2xl font-black text-content-primary flex items-center gap-2">
                <Settings className="w-6 h-6 text-indigo-500" /> 设置
              </h2>
              <p className="text-content-muted mt-1 text-sm">系统配置、通知渠道与自动续期策略</p>
            </div>

            {loadingSettings ? (
              <div className="flex justify-center py-20">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
              </div>
            ) : (
              <>
                {/* NOTE: 这里原有一个「外观 / 主题模式」卡片，与顶栏的太阳/月亮切换按钮
                    完全同源（都改 theme 这一个 state），属重复入口，已移除。
                    主题切换保留在顶栏，任何页面都能直接点到，不必先进设置页。 */}

                {/* 后端地址 */}
                <div className="bg-surface border border-border-base rounded-2xl p-4 sm:p-5 space-y-4">
                  <h3 className="font-bold text-content-primary flex items-center gap-2">
                    <Server className="w-4 h-4 text-indigo-400" /> 后端地址
                  </h3>

                  {backendUrlEditing ? (
                    <div>
                      <label className="text-sm font-semibold text-content-primary">后端 Worker 地址</label>
                      <div className="flex gap-2 mt-2">
                        <input
                          value={backendUrlInput}
                          onChange={(e) => setBackendUrlInput(e.target.value)}
                          placeholder="https://dnshe-manager-backend.<子域>.workers.dev"
                          className="form-input flex-1 px-3 py-2 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                        />
                        <button onClick={handleSaveBackendUrl} className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5">
                          <Save className="w-4 h-4" /> 保存
                        </button>
                        <button onClick={handleCancelBackendUrl} className="bg-elevated hover:bg-hovered text-content-muted border border-border-base px-4 py-2 rounded-lg text-sm">
                          取消
                        </button>
                      </div>
                      <p className="text-xs text-content-muted mt-2">保存后刷新页面生效；清空保存可恢复自动推演。</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        {backendUrl ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                            <span className="text-content-primary">已配置自定义后端地址</span>
                          </>
                        ) : (
                          <>
                            <Info className="w-4 h-4 text-content-muted flex-shrink-0" />
                            <span className="text-content-muted">未配置，使用自动推演</span>
                          </>
                        )}
                      </div>
                      <button
                        onClick={() => { setBackendUrlInput(localStorage.getItem("DNSHE_BACKEND_URL") || ""); setBackendUrlEditing(true); }}
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-800 border border-indigo-200 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 dark:text-indigo-400 dark:hover:text-indigo-200 dark:border-indigo-900/50 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
                      >
                        <Pencil className="w-3.5 h-3.5" /> {backendUrl ? "修改" : "配置"}
                      </button>
                    </div>
                  )}
                </div>

                {/* 账户安全：修改密码 + 两步验证 */}
                <div className="bg-surface border border-border-base rounded-2xl p-4 sm:p-5 space-y-5">
                  <h3 className="font-bold text-content-primary flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" /> 账户安全
                  </h3>

                  {/* 当前账户 */}
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-content-muted flex-shrink-0">当前管理员</span>
                    <span className="font-mono font-semibold text-content-primary flex items-center gap-1.5 min-w-0">
                      <UserCheck className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                      <span className="truncate">{accountInfo.username || "—"}</span>
                    </span>
                  </div>

                  {/* 修改密码 */}
                  <div className="space-y-3 pt-3 border-t border-border-soft">
                    <div className="text-sm font-semibold text-content-primary flex items-center gap-1.5">
                      <Key className="w-4 h-4 text-amber-400" /> 修改登录密码
                    </div>
                    {/*
                      NOTE: 这里刻意不用 autoComplete="current-password" / "username"。
                      Chrome 是「成对」填充凭据的：只要表单里存在一个 current-password
                      目标，它就会连带去找用户名字段填上。上一版把这两个语义标注补齐后，
                      填充确实不再跑到页头搜索框，但改成精准落进「原密码 + 同时修改用户名」，
                      等于换了个地方犯同样的毛病——修改密码表单被预填本来就不是我们想要的。
                      把三个密码框统一标成 new-password（表单内不存在可填充的凭据目标），
                      Chrome 就不会发起这次凭据填充，也就不会再去找用户名字段。
                      name 也故意取成不像 username 的值，避免命中它的启发式。
                    */}
                    <PasswordInput
                      name="dnshe-old-password"
                      autoComplete="new-password"
                      value={pwOld}
                      onChange={setPwOld}
                      placeholder="原密码"
                      className="form-input w-full px-3 py-2 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <PasswordInput
                        name="dnshe-new-password"
                        autoComplete="new-password"
                        value={pwNew}
                        onChange={setPwNew}
                        placeholder="新密码（至少 8 位）"
                        className="form-input w-full px-3 py-2 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                      />
                      <PasswordInput
                        name="dnshe-new-password-confirm"
                        autoComplete="new-password"
                        value={pwNew2}
                        onChange={setPwNew2}
                        placeholder="确认新密码"
                        className="form-input w-full px-3 py-2 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                      />
                    </div>
                    <input
                      type="text"
                      name="dnshe-rename"
                      autoComplete="off"
                      value={pwNewUsername}
                      onChange={(e) => setPwNewUsername(e.target.value)}
                      placeholder={`同时修改用户名（可选，当前：${accountInfo.username || "admin"}）`}
                      className="form-input w-full px-3 py-2 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={handleChangePassword}
                        disabled={actionLoading === "change-pw"}
                        className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Save className="w-4 h-4" /> 保存新密码
                      </button>
                    </div>
                    <p className="text-[11px] text-content-muted">修改成功后当前会话将失效，需用新凭据重新登录。</p>
                  </div>

                  {/* 两步验证 (2FA) */}
                  <div className="space-y-3 pt-3 border-t border-border-soft">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-content-primary flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" /> 两步验证 (2FA / TOTP)
                        </div>
                        <div className="text-xs text-content-muted mt-0.5">开启后登录需额外输入身份验证器的 6 位动态码</div>
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold self-start sm:self-auto flex-shrink-0 ${accountInfo.two_fa_enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "bg-elevated text-content-muted border border-border-base"}`}>
                        {accountInfo.two_fa_enabled ? "已开启" : "未开启"}
                      </span>
                    </div>

                    {/* 未开启：走生成密钥 → 验证动态码 流程 */}
                    {!accountInfo.two_fa_enabled && (
                      <div className="space-y-3">
                        {!twoFaSetup ? (
                          <button
                            onClick={handleStart2faSetup}
                            disabled={actionLoading === "2fa-setup"}
                            className="bg-elevated hover:bg-hovered text-content-secondary border border-border-base px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <ShieldCheck className="w-4 h-4 text-emerald-400" /> 开启两步验证
                          </button>
                        ) : (
                          <div className="bg-elevated border border-border-base rounded-xl p-4 space-y-3">
                            <p className="text-xs text-content-secondary leading-relaxed">
                              1. 用身份验证器（Google / Microsoft Authenticator）扫描下方二维码：
                            </p>
                            <div className="flex justify-center py-2">
                              <div className="bg-white p-3 rounded-xl">
                                <QRCodeSVG value={twoFaSetup.otpauth_uri} size={176} level="M" includeMargin={false} />
                              </div>
                            </div>
                            <p className="text-[11px] text-content-muted">
                              无法扫码时，可在验证器中手动录入以下密钥：
                            </p>
                            <div className="font-mono text-sm bg-surface border border-border-base rounded-lg px-3 py-2 break-all text-indigo-400 select-all text-center tracking-wider">
                              {twoFaSetup.secret}
                            </div>
                            <p className="text-xs text-content-secondary">2. 输入验证器当前显示的 6 位动态码以完成开启：</p>
                            <div className="flex flex-wrap gap-2">
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={twoFaEnableToken}
                                onChange={(e) => setTwoFaEnableToken(e.target.value.replace(/\D/g, ""))}
                                placeholder="6 位动态码"
                                className="form-input flex-1 px-3 py-2 rounded-lg text-sm font-mono text-content-primary placeholder:text-content-muted"
                              />
                              <button
                                onClick={handleEnable2fa}
                                disabled={actionLoading === "2fa-enable"}
                                className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5 disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-4 h-4" /> 确认开启
                              </button>
                              <button
                                onClick={() => { setTwoFaSetup(null); setTwoFaEnableToken(""); }}
                                className="bg-elevated hover:bg-hovered text-content-muted border border-border-base px-3 py-2 rounded-lg text-sm"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 已开启：输入当前动态码确认关闭 */}
                    {accountInfo.two_fa_enabled && (
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={twoFaDisableToken}
                          onChange={(e) => setTwoFaDisableToken(e.target.value.replace(/\D/g, ""))}
                          placeholder="输入身份验证器当前 6 位动态码"
                          className="form-input flex-1 px-3 py-2 rounded-lg text-sm font-mono text-content-primary placeholder:text-content-muted"
                        />
                        <button
                          onClick={handleDisable2fa}
                          disabled={actionLoading === "2fa-disable"}
                          className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 dark:bg-red-500/10 dark:hover:bg-red-500/20 dark:text-red-400 dark:border-red-500/30 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                        >
                          关闭 2FA
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 自动续期 */}
                <div className="bg-surface border border-border-base rounded-2xl p-4 sm:p-5 space-y-4">
                  <h3 className="font-bold text-content-primary flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-emerald-400" /> 自动续期
                  </h3>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-content-primary">启用自动续期</div>
                      <div className="text-xs text-content-muted mt-0.5">定时任务自动为即将到期的域名续期</div>
                    </div>
                    <button
                      onClick={() => setSettings((s) => ({ ...s, auto_renew: s.auto_renew === "1" ? "0" : "1" }))}
                      className={`w-12 h-6 rounded-full transition-all relative flex-shrink-0 ${settings.auto_renew === "1" ? "bg-indigo-600" : "bg-elevated border border-border-base"}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${settings.auto_renew === "1" ? "left-6" : "left-0.5"}`} />
                    </button>
                  </div>
                  <div className="pt-2 border-t border-border-soft">
                    <label className="text-sm font-semibold text-content-primary">续期阈值（天）</label>
                    <p className="text-xs text-content-muted mt-0.5 mb-2">剩余有效期低于此值时触发续期；续期结果（成功 / 失败）会通过通知渠道推送</p>
                    <input
                      type="number"
                      value={settings.renew_threshold_days}
                      onChange={(e) => setSettings((s) => ({ ...s, renew_threshold_days: e.target.value }))}
                      className="form-input w-full px-3 py-2 rounded-lg text-sm text-content-primary"
                    />
                  </div>
                </div>

                {/* 解析线路支持名单 */}
                <div className="bg-surface border border-border-base rounded-2xl p-4 sm:p-5 space-y-4">
                  <h3 className="font-bold text-content-primary flex items-center gap-2">
                    <Server className="w-4 h-4 text-sky-600 dark:text-sky-400" /> 解析线路支持名单
                  </h3>
                  <p className="text-xs text-content-muted leading-relaxed">
                    上游 API 没有「域名是否支持按线路解析」的字段，本面板按域名所属的
                    <span className="font-mono text-indigo-600 dark:text-indigo-400"> 解析服务商 ID </span>
                    判断：名单内服务商的域名可以选择电信 / 联通 / 移动 / 海外 / 教育网，其余只能保持默认。
                    上游对不支持的域名会<b>静默忽略</b>线路参数而不报错，所以这里主动拦住，
                    避免出现「设了线路却没生效」。读取解析记录时若发现某域名实际用了非默认线路，
                    会自动把它的服务商补进名单。
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {lineProviders.length === 0 ? (
                      <span className="text-xs text-content-muted">名单为空，所有域名都会按「不支持线路」处理</span>
                    ) : (
                      lineProviders.map((pid) => (
                        <span
                          key={pid}
                          className="group flex items-center bg-sky-50 border border-sky-200 text-sky-700 dark:bg-sky-950/30 dark:border-sky-500/30 dark:text-sky-300 text-xs rounded-lg overflow-hidden"
                        >
                          <span className="px-2.5 py-1 font-mono">服务商 {pid}</span>
                          <button
                            onClick={() => handleRemoveLineProvider(pid)}
                            className="px-1.5 py-1 text-sky-500/70 hover:text-sky-800 hover:bg-sky-100 border-l border-sky-200 dark:text-sky-400/60 dark:hover:text-sky-300 dark:hover:bg-sky-900/40 dark:border-sky-500/30 transition-all"
                            title={`从名单移除服务商 ${pid}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  <form onSubmit={handleAddLineProvider} className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      name="dnshe-line-provider"
                      autoComplete="off"
                      value={newLineProviderInput}
                      onChange={(e) => setNewLineProviderInput(e.target.value)}
                      placeholder="服务商 ID，可一次填多个（逗号 / 空格分隔）"
                      className="form-input flex-1 min-w-[12rem] px-3 py-2 rounded-lg text-sm font-mono text-content-primary placeholder:text-content-muted"
                    />
                    <button
                      type="submit"
                      className="btn-primary px-3 py-2 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 flex-shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" /> 添加
                    </button>
                    <button
                      type="button"
                      onClick={handleRestoreLineProviders}
                      className="bg-elevated hover:bg-hovered text-content-secondary border border-border-base px-3 py-2 rounded-lg text-xs font-semibold flex-shrink-0"
                    >
                      恢复默认
                    </button>
                  </form>

                  {providerRootMap.length > 0 && (
                    <div className="pt-3 border-t border-border-soft space-y-1.5">
                      <div className="text-xs font-semibold text-content-secondary">已缓存域名的服务商分布（对照官网标注即可判断该加哪个）</div>
                      {providerRootMap.map(({ pid, roots }) => {
                        const on = lineProviders.includes(pid);
                        return (
                          <div key={pid} className="text-[11px] font-mono flex flex-wrap items-baseline gap-x-2">
                            <span className={on ? "text-sky-700 dark:text-sky-300 font-bold" : "text-content-muted"}>
                              服务商 {pid}
                            </span>
                            <span className="text-content-muted">→</span>
                            <span className="text-content-secondary break-all">{roots.join("、")}</span>
                            {on && <span className="text-[10px] text-sky-700 dark:text-sky-300">（支持线路）</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 通知 */}
                <div className="bg-surface border border-border-base rounded-2xl p-4 sm:p-5 space-y-4">
                  <h3 className="font-bold text-content-primary flex items-center gap-2">
                    <Bell className="w-4 h-4 text-amber-400" /> 通知渠道
                  </h3>

                  {/* Telegram */}
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-content-primary flex items-center gap-1.5">
                      <Send className="w-4 h-4 text-sky-400" /> Telegram
                    </div>
                    <input
                      value={settings.tg_token}
                      onChange={(e) => setSettings((s) => ({ ...s, tg_token: e.target.value }))}
                      placeholder={settingsConfigured.tg_token ? "已配置（留空不修改）" : "Bot Token"}
                      className="form-input w-full px-3 py-2 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                    />
                    <div className="flex gap-2">
                      <input
                        value={settings.tg_chat_id}
                        onChange={(e) => setSettings((s) => ({ ...s, tg_chat_id: e.target.value }))}
                        placeholder="Chat ID"
                        className="form-input flex-1 px-3 py-2 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                      />
                      <button
                        onClick={handleTestTelegram}
                        disabled={actionLoading === "test-tg"}
                        className="bg-elevated hover:bg-hovered text-content-secondary border border-border-base px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Send className="w-4 h-4" /> 测试推送
                      </button>
                    </div>
                  </div>

                  {/* Webhook */}
                  <div className="space-y-3 pt-3 border-t border-border-soft">
                    <div className="text-sm font-semibold text-content-primary">Webhook</div>
                    <input
                      value={settings.webhook_url}
                      onChange={(e) => setSettings((s) => ({ ...s, webhook_url: e.target.value }))}
                      placeholder={settingsConfigured.webhook_url ? "已配置（留空不修改）" : "Webhook URL"}
                      className="form-input w-full px-3 py-2 rounded-lg text-sm text-content-primary placeholder:text-content-muted"
                    />
                    <select
                      value={settings.webhook_type}
                      onChange={(e) => setSettings((s) => ({ ...s, webhook_type: e.target.value }))}
                      className="form-input w-full px-3 py-2 rounded-lg text-sm text-content-primary"
                    >
                      <option value="custom">通用 (custom)</option>
                      <option value="dingtalk">钉钉 (dingtalk)</option>
                      <option value="feishu">飞书 (feishu)</option>
                      <option value="wecom">企业微信 (wecom)</option>
                    </select>
                  </div>
                </div>

                {/* 保存按钮 */}
                <div className="flex justify-end">
                  <button
                    onClick={handleSaveSettings}
                    disabled={actionLoading === "save-settings"}
                    className="btn-primary px-6 py-2.5 rounded-lg text-sm font-bold text-content-primary flex items-center gap-2 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" /> 保存全部设置
                  </button>
                </div>
              </>
            )}
          </div>
        )}

      </main>
      </div>

      {/* DNS 解析管理模态框 (Modal) */}
      {dnsModalOpen && selectedDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-surface border border-border-base w-full max-w-4xl max-h-[90dvh] rounded-xl overflow-hidden flex flex-col shadow-2xl">
            {/* 模态框头部 */}
            <div className="bg-elevated px-4 sm:px-6 py-4 flex items-center justify-between gap-2 border-b border-border-base flex-shrink-0">
              {/* NOTE: min-w-0 + truncate —— 长 IDN 域名（xn-- 形式很长）会把右侧按钮挤出屏幕 */}
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-bold text-content-primary flex items-center gap-1.5">
                  <ShieldCheck className="text-indigo-400 w-5 h-5 flex-shrink-0" />
                  <span className="truncate">DNS 解析记录管理</span>
                </h3>
                <p className="text-xs text-content-muted mt-0.5 font-mono truncate">
                  域名: {selectedDomain.full_domain}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => reloadDnsRecords(selectedDomain, true)}
                  disabled={loadingDns}
                  className="text-content-muted hover:text-content-primary p-2 md:p-1 hover:bg-hovered rounded disabled:opacity-50"
                  title="强制刷新（重新从 DNSHE 拉取）"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingDns ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={() => setDnsModalOpen(false)}
                  className="text-content-muted hover:text-content-primary p-2 md:p-1 hover:bg-hovered rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* 模态框主体 */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 sm:space-y-6">
              
              {/* 新建 DNS 记录表单折叠面板 */}
              <div className="border border-border-base rounded-lg overflow-hidden bg-hovered">
                <button
                  onClick={() => setDnsFormOpen(!dnsFormOpen)}
                  className="w-full px-4 py-3 bg-elevated hover:bg-hovered flex justify-between items-center text-sm font-semibold text-content-secondary transition-colors"
                >
                  <span>{dnsFormOpen ? "隐藏新建解析表单" : "➕ 添加新解析记录"}</span>
                </button>

                {dnsFormOpen && (
                  <form onSubmit={handleCreateDnsRecord} className="p-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 border-t border-border-base">
                    <div>
                      <label className="block text-[11px] md:text-[10px] text-content-muted font-bold uppercase mb-1">记录类型</label>
                      <select
                        value={newDnsType}
                        onChange={(e) => setNewDnsType(e.target.value)}
                        className="w-full form-input px-2.5 py-2 rounded text-sm text-content-secondary"
                      >
                        {DNS_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] md:text-[10px] text-content-muted font-bold uppercase mb-1">主机记录</label>
                      <input
                        type="text"
                        name="dns-new-name"
                        autoComplete="off"
                        placeholder="例如 @ 或 www"
                        value={newDnsName}
                        onChange={(e) => setNewDnsName(e.target.value)}
                        className="w-full form-input px-2.5 py-2 rounded text-sm text-content-secondary"
                      />
                    </div>

                    <div className="md:col-span-2 lg:col-span-1">
                      <label className="block text-[11px] md:text-[10px] text-content-muted font-bold uppercase mb-1">记录值 (Content)</label>
                      <input
                        type="text"
                        name="dns-new-content"
                        autoComplete="off"
                        required
                        placeholder="例如 192.0.2.1"
                        value={newDnsContent}
                        onChange={(e) => setNewDnsContent(e.target.value)}
                        className="w-full form-input px-2.5 py-2 rounded text-sm text-content-secondary"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] md:text-[10px] text-content-muted font-bold uppercase mb-1">TTL (秒)</label>
                      <input
                        type="number"
                        name="dns-new-ttl"
                        autoComplete="off"
                        min={120}
                        max={86400}
                        value={newDnsTtl}
                        onChange={(e) => setNewDnsTtl(parseInt(e.target.value, 10))}
                        className="w-full form-input px-2.5 py-2 rounded text-sm text-content-secondary"
                      />
                    </div>

                    {needsDnsPriority(newDnsType) && (
                      <div>
                        <label className="block text-[11px] md:text-[10px] text-content-muted font-bold uppercase mb-1">优先级</label>
                        <input
                          type="number"
                          name="dns-new-priority"
                          autoComplete="off"
                          min={0}
                          max={65535}
                          value={newDnsPriority}
                          onChange={(e) => setNewDnsPriority(parseInt(e.target.value, 10))}
                          className="w-full form-input px-2.5 py-2 rounded text-sm text-content-secondary"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] md:text-[10px] text-content-muted font-bold uppercase mb-1">解析线路</label>
                      <DnsLineSelect
                        value={newDnsLine}
                        onChange={setNewDnsLine}
                        supported={domainSupportsLine(selectedDomain)}
                        className="w-full form-input px-2.5 py-2 rounded text-sm text-content-secondary"
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

              {/* 批量添加解析记录折叠面板 */}
              <div className="border border-border-base rounded-lg overflow-hidden bg-hovered">
                <button
                  onClick={() => setDnsBatchOpen(!dnsBatchOpen)}
                  className="w-full px-4 py-3 bg-elevated hover:bg-hovered flex justify-between items-center text-sm font-semibold text-content-secondary transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    {dnsBatchOpen ? "隐藏批量添加面板" : "批量添加解析记录"}
                  </span>
                  {!dnsBatchOpen && (
                    <span className="text-[10px] text-content-muted font-normal">一行一条，缺省字段取下方默认值</span>
                  )}
                </button>

                {dnsBatchOpen && (
                  <div className="p-4 space-y-4 border-t border-border-base">
                    <p className="text-xs text-content-muted leading-relaxed">
                      每行一条记录，支持 <span className="font-mono text-indigo-400">记录值</span> /
                      <span className="font-mono text-indigo-400"> 主机记录 记录值</span> /
                      <span className="font-mono text-indigo-400"> 类型 主机记录 记录值 [TTL] [优先级]</span>；
                      字段分隔符优先级为 <span className="font-mono">竖线 &gt; 逗号 &gt; 空格</span>
                      （TXT 记录值本身含空格时请改用竖线或逗号分隔），<span className="font-mono">#</span> 开头的行会被忽略。
                      未写明的字段取下方默认值，单次最多 50 条。
                      主机记录只能是相对名 —— <span className="font-mono text-indigo-400">@</span> 代表
                      <span className="font-mono"> {selectedDomain.full_domain}</span>，
                      填完整域名会自动剥成相对名。
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[11px] md:text-[10px] text-content-muted font-bold uppercase mb-1">默认类型</label>
                        <select
                          value={dnsBatchType}
                          onChange={(e) => setDnsBatchType(e.target.value)}
                          className="w-full form-input px-2.5 py-2 rounded text-sm text-content-secondary"
                        >
                          {DNS_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] md:text-[10px] text-content-muted font-bold uppercase mb-1">默认主机记录</label>
                        <input
                          type="text"
                          name="dns-batch-name"
                          autoComplete="off"
                          placeholder="@ 或 www"
                          value={dnsBatchName}
                          onChange={(e) => setDnsBatchName(e.target.value)}
                          className="w-full form-input px-2.5 py-2 rounded text-sm text-content-secondary"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] md:text-[10px] text-content-muted font-bold uppercase mb-1">默认 TTL (秒)</label>
                        <input
                          type="number"
                          name="dns-batch-ttl"
                          autoComplete="off"
                          min={120}
                          max={86400}
                          value={dnsBatchTtl}
                          onChange={(e) => setDnsBatchTtl(parseInt(e.target.value, 10) || 600)}
                          className="w-full form-input px-2.5 py-2 rounded text-sm text-content-secondary"
                        />
                      </div>

                      {needsDnsPriority(dnsBatchType) && (
                        <div>
                          <label className="block text-[11px] md:text-[10px] text-content-muted font-bold uppercase mb-1">默认优先级</label>
                          <input
                            type="number"
                            name="dns-batch-priority"
                            autoComplete="off"
                            min={0}
                            max={65535}
                            value={dnsBatchPriority}
                            onChange={(e) => setDnsBatchPriority(parseInt(e.target.value, 10) || 0)}
                            className="w-full form-input px-2.5 py-2 rounded text-sm text-content-secondary"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-[11px] md:text-[10px] text-content-muted font-bold uppercase mb-1">解析线路</label>
                        <DnsLineSelect
                          value={dnsBatchLine}
                          onChange={setDnsBatchLine}
                          supported={domainSupportsLine(selectedDomain)}
                          className="w-full form-input px-2.5 py-2 rounded text-sm text-content-secondary"
                        />
                      </div>
                    </div>

                    {/* NOTE: 占位示例一律用文档保留段（RFC 3849 的 2001:db8::/32、
                        RFC 5737 的 192.0.2.0/24、RFC 2606 的 example.com），不放真实地址 */}
                    <textarea
                      value={dnsBatchInput}
                      onChange={(e) => setDnsBatchInput(e.target.value)}
                      rows={6}
                      name="dns-batch-input"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={"2001:db8::5010:e191\n2001:db8::527:8a4e\nAAAA ipv6 2001:db8::e095:d9aa\nA www 192.0.2.1 600\nMX @ mail.example.com 600 10"}
                      className="w-full form-input px-3 py-2.5 rounded-lg text-sm font-mono text-content-secondary resize-y"
                    />

                    <button
                      onClick={handleBatchCreateDnsRecords}
                      disabled={actionLoading === "batch-create-dns" || validDnsBatchLines.length === 0}
                      className="w-full btn-primary py-2.5 rounded-lg font-semibold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {actionLoading === "batch-create-dns" ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" /> 正在逐条提交…
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" /> 开始批量添加 (已识别 {validDnsBatchLines.length} 条)
                        </>
                      )}
                    </button>

                    {/* 无法解析的行（缺少记录值）会被跳过，这里明确告知条数，避免静默丢弃 */}
                    {parsedDnsBatchLines.length > validDnsBatchLines.length && (
                      <p className="text-xs text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        有 {parsedDnsBatchLines.length - validDnsBatchLines.length} 行无法解析（缺少记录值），提交时会自动跳过
                      </p>
                    )}

                    {/* 解析预览：提交前先让用户核对每行被解析成了什么 */}
                    {validDnsBatchLines.length > 0 && (
                      <div className="max-h-40 overflow-y-auto pr-1 space-y-1">
                        {validDnsBatchLines.map((r, idx) => (
                          <div key={idx} className="text-[11px] font-mono text-content-muted flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-indigo-400 font-bold w-12 shrink-0">{r.type}</span>
                            <span className="w-20 sm:w-24 shrink-0 truncate" title={r.name}>{r.name}</span>
                            <span className="w-full sm:flex-1 sm:w-auto truncate text-content-secondary" title={r.content}>{r.content}</span>
                            <span className="shrink-0">TTL {r.ttl}</span>
                            {r.priority !== undefined && <span className="shrink-0">优先级 {r.priority}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 逐条提交结果回执 */}
                    {dnsBatchResults && dnsBatchResults.length > 0 && (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {dnsBatchResults.map((r, idx) => (
                          <div
                            key={idx}
                            className={`flex items-start justify-between gap-2 text-xs px-3 py-2 rounded-lg border ${
                              r.success
                                ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300"
                                : "bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300"
                            }`}
                          >
                            <div className="font-mono min-w-0 truncate" title={r.label}>{r.label}</div>
                            <div className="flex items-center gap-1 shrink-0">
                              {r.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                              <span>{r.success ? "成功" : r.message}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* DNS 记录列表展现 */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h4 className="text-sm font-bold text-content-primary">
                    当前解析记录列表
                    {dnsRecords.length > 0 && (
                      <span className="ml-2 text-xs text-content-muted font-normal">共 {dnsRecords.length} 条</span>
                    )}
                  </h4>

                  {selectedDnsKeys.size > 0 && (
                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      <span className="text-xs text-content-muted">已选 {selectedDnsKeys.size} 条</span>
                      <button
                        onClick={() => setSelectedDnsKeys(new Set())}
                        className="bg-elevated hover:bg-hovered text-content-secondary border border-border-base px-2.5 py-2 sm:py-1.5 rounded-lg text-xs font-semibold"
                      >
                        取消选择
                      </button>
                      <button
                        onClick={() => (dnsEditPanelOpen ? setDnsEditPanelOpen(false) : handleOpenDnsEditPanel())}
                        className={`px-2.5 py-2 sm:py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
                          dnsEditPanelOpen
                            ? "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-500/20 dark:border-indigo-500/50 dark:text-indigo-200"
                            : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 dark:text-indigo-300 dark:border-indigo-900/60"
                        }`}
                        title="批量修改已勾选记录的指定字段"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        批量修改 ({selectedDnsKeys.size})
                      </button>
                      <button
                        onClick={handleBatchDeleteDnsRecords}
                        disabled={actionLoading === "batch-delete-dns"}
                        className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/60 dark:hover:bg-red-900/60 dark:text-red-300 dark:border-red-900/60 px-2.5 py-2 sm:py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                        title="批量删除已勾选的解析记录"
                      >
                        {actionLoading === "batch-delete-dns" ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        批量删除 ({selectedDnsKeys.size})
                      </button>
                    </div>
                  )}
                </div>

                {/* 批量修改面板：勾选哪个字段就只覆盖那个字段 */}
                {dnsEditPanelOpen && selectedDnsKeys.size > 0 && (
                  <div className="mb-3 border border-indigo-200 bg-indigo-50 dark:border-indigo-900/60 dark:bg-indigo-950/20 rounded-lg p-4 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      {/* NOTE: 强调色必须分主题给值 —— 浅色字（*-200/300）只在暗色底上成立，
                          压在亮色主题的浅底上对比度会掉到 1.1:1 左右，等于没画。
                          全项目的 tint chip 都按「亮色 bg-*-50 + text-*-700，暗色原值加
                          dark: 前缀」这一套写，dark 变体带 :is(.dark *) 后缀，特异性比
                          同名亮色类多一个 class，所以暗色渲染与改造前完全一致。 */}
                      <h5 className="text-xs font-bold text-indigo-700 dark:text-indigo-200 flex items-center gap-1.5">
                        <Pencil className="w-3.5 h-3.5" />
                        批量修改 {selectedDnsKeys.size} 条记录
                      </h5>
                      <span className="text-[10px] text-content-muted hidden sm:inline">只有勾选的字段会被覆盖，其余字段保留各自原值</span>
                    </div>
                    <p className="text-[11px] text-content-muted sm:hidden -mt-2">只有勾选的字段会被覆盖，其余保留原值</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* 记录类型 */}
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={dnsEditFields.type}
                          onChange={(e) => setDnsEditFields({ ...dnsEditFields, type: e.target.checked })}
                          className="w-4 h-4 accent-indigo-500 cursor-pointer shrink-0"
                        />
                        <span className="text-xs text-content-secondary w-20 shrink-0">记录类型</span>
                        <select
                          value={batchEditType}
                          onChange={(e) => setBatchEditType(e.target.value)}
                          disabled={!dnsEditFields.type}
                          className="flex-1 form-input px-2 py-1.5 rounded text-xs text-content-secondary disabled:opacity-40"
                        >
                          {DNS_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </label>

                      {/* TTL */}
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={dnsEditFields.ttl}
                          onChange={(e) => setDnsEditFields({ ...dnsEditFields, ttl: e.target.checked })}
                          className="w-4 h-4 accent-indigo-500 cursor-pointer shrink-0"
                        />
                        <span className="text-xs text-content-secondary w-20 shrink-0">TTL (秒)</span>
                        <input
                          type="number"
                          name="dns-bulk-ttl"
                          autoComplete="off"
                          min={120}
                          max={86400}
                          value={batchEditTtl}
                          onChange={(e) => setBatchEditTtl(parseInt(e.target.value, 10) || 600)}
                          disabled={!dnsEditFields.ttl}
                          className="flex-1 form-input px-2 py-1.5 rounded text-xs text-content-secondary disabled:opacity-40"
                        />
                      </label>

                      {/* 主机记录 */}
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={dnsEditFields.name}
                          onChange={(e) => setDnsEditFields({ ...dnsEditFields, name: e.target.checked })}
                          className="w-4 h-4 accent-indigo-500 cursor-pointer shrink-0"
                        />
                        <span className="text-xs text-content-secondary w-20 shrink-0">主机记录</span>
                        <input
                          type="text"
                          name="dns-bulk-name"
                          autoComplete="off"
                          placeholder="@ 或 jp"
                          title={`只能填相对名：@ 代表 ${selectedDomain.full_domain}`}
                          value={batchEditName}
                          onChange={(e) => setBatchEditName(e.target.value)}
                          disabled={!dnsEditFields.name}
                          className="flex-1 form-input px-2 py-1.5 rounded text-xs font-mono text-content-secondary disabled:opacity-40"
                        />
                      </label>

                      {/* 解析线路 */}
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={dnsEditFields.line}
                          onChange={(e) => setDnsEditFields({ ...dnsEditFields, line: e.target.checked })}
                          disabled={!domainSupportsLine(selectedDomain)}
                          className="w-4 h-4 accent-indigo-500 cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                        <span className="text-xs text-content-secondary w-20 shrink-0">解析线路</span>
                        <DnsLineSelect
                          value={batchEditLine}
                          onChange={setBatchEditLine}
                          supported={domainSupportsLine(selectedDomain)}
                          disabled={!dnsEditFields.line}
                          className="flex-1 form-input px-2 py-1.5 rounded text-xs text-content-secondary disabled:opacity-40"
                        />
                      </label>

                      {/* 记录值：只在这里开关，具体新值在下方逐条编辑 */}
                      <label className="flex items-center gap-2 md:col-span-2">
                        <input
                          type="checkbox"
                          checked={dnsEditFields.content}
                          onChange={(e) => setDnsEditFields({ ...dnsEditFields, content: e.target.checked })}
                          className="w-4 h-4 accent-indigo-500 cursor-pointer shrink-0"
                        />
                        <span className="text-xs text-content-secondary w-20 shrink-0">记录值</span>
                        <span className="text-[11px] text-content-muted">
                          {dnsEditFields.content
                            ? "在下方逐条编辑各自的新记录值，不改的行保持原值"
                            : "勾选后可在下方逐条编辑记录值"}
                        </span>
                      </label>

                      {/* 优先级：仅在改成 MX / SRV 或选中记录含 MX / SRV 时出现 */}
                      {batchEditNeedsPriority && (
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={dnsEditFields.priority}
                            onChange={(e) => setDnsEditFields({ ...dnsEditFields, priority: e.target.checked })}
                            className="w-4 h-4 accent-indigo-500 cursor-pointer shrink-0"
                          />
                          <span className="text-xs text-content-secondary w-20 shrink-0">优先级</span>
                          <input
                            type="number"
                            name="dns-bulk-priority"
                            autoComplete="off"
                            min={0}
                            max={65535}
                            value={batchEditPriority}
                            onChange={(e) => setBatchEditPriority(parseInt(e.target.value, 10) || 0)}
                            disabled={!dnsEditFields.priority}
                            className="flex-1 form-input px-2 py-1.5 rounded text-xs text-content-secondary disabled:opacity-40"
                          />
                        </label>
                      )}
                    </div>

                    {/* 记录值逐条编辑时，提示重复值会造成重复记录（上游通常直接拒绝） */}
                    {dnsEditFields.content && (() => {
                      const values = batchEditTargets.map((t) => `${t.type}|${t.name}|${t.content}`);
                      const dupCount = values.length - new Set(values).size;
                      return dupCount > 0 ? (
                        <p className="text-xs text-amber-400 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          有 {dupCount} 条记录的「类型 + 主机记录 + 记录值」与其它行重复，上游可能拒绝写入
                        </p>
                      ) : null;
                    })()}

                    {/* 变更预览：逐条显示「原记录 → 改后」；勾了记录值时该列可就地编辑 */}
                    <div className="max-h-56 overflow-y-auto pr-1 space-y-1">
                      {batchEditTargets.map((t) => (
                        <div
                          key={t.record_id}
                          /* NOTE: 窄屏改为纵向两段（原记录 / 改后），横排 7 段在手机上必然溢出 */
                          className={`text-[11px] font-mono flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 rounded px-1 py-1 sm:py-0.5 border-b border-border-soft sm:border-0 last:border-0 ${
                            t.unchanged ? "opacity-45" : ""
                          }`}
                          title={t.unchanged ? "与原记录一致，提交时会跳过" : undefined}
                        >
                          <span className="text-content-muted flex-1 truncate min-w-0" title={t.label}>{t.label}</span>
                          <ChevronRight className="w-3 h-3 text-content-muted shrink-0 rotate-90 sm:rotate-0" />
                          <span className="flex items-center gap-2 min-w-0 sm:contents">
                            <span className="text-indigo-400 shrink-0">{t.type}</span>
                            <span className="text-content-secondary shrink-0 max-w-[7rem] truncate" title={t.name}>{t.name}</span>
                          </span>
                          {dnsEditFields.content ? (
                            <input
                              type="text"
                              name={`dns-bulk-content-${t.record_id}`}
                              autoComplete="off"
                              value={batchEditContents[t.record_id] ?? ""}
                              onChange={(e) =>
                                setBatchEditContents({ ...batchEditContents, [t.record_id]: e.target.value })
                              }
                              placeholder={t.origin_content}
                              title="留空则保持原记录值"
                              className="flex-1 min-w-0 form-input px-2 py-1 rounded text-[11px] font-mono text-content-secondary"
                            />
                          ) : (
                            <span className="text-content-secondary flex-1 truncate min-w-0" title={t.content}>{t.content}</span>
                          )}
                          <span className="flex items-center gap-2 sm:contents">
                            <span className="text-content-muted shrink-0">TTL {t.ttl}</span>
                            {t.priority !== undefined && <span className="text-content-muted shrink-0">优先级 {t.priority}</span>}
                            <span className="text-content-muted shrink-0">{t.line || "默认线路"}</span>
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleBatchUpdateDnsRecords}
                        disabled={actionLoading === "batch-update-dns" || batchEditChanged.length === 0}
                        className="flex-1 btn-primary py-2 rounded-lg font-semibold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {actionLoading === "batch-update-dns" ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" /> 正在逐条提交…
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
                            {batchEditChanged.length === 0
                              ? "没有需要提交的修改"
                              : `应用到 ${batchEditChanged.length} 条记录${
                                  batchEditChanged.length < batchEditTargets.length
                                    ? `（跳过 ${batchEditTargets.length - batchEditChanged.length} 条无变化）`
                                    : ""
                                }`}
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => setDnsEditPanelOpen(false)}
                        className="bg-elevated hover:bg-hovered text-content-secondary border border-border-base px-4 py-2 rounded-lg text-sm font-semibold"
                      >
                        取消
                      </button>
                    </div>

                    {/* 逐条提交结果回执 */}
                    {dnsEditResults && dnsEditResults.length > 0 && (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {dnsEditResults.map((r, idx) => (
                          <div
                            key={idx}
                            className={`flex items-start justify-between gap-2 text-xs px-3 py-2 rounded-lg border ${
                              r.success
                                ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300"
                                : "bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300"
                            }`}
                          >
                            <div className="font-mono min-w-0 truncate" title={r.label}>{r.label}</div>
                            <div className="flex items-center gap-1 shrink-0">
                              {r.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                              <span>{r.success ? "成功" : r.message}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {loadingDns ? (
                  <div className="flex justify-center py-10">
                    <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                  </div>
                ) : dnsRecords.length === 0 ? (
                  <div className="text-center py-10 bg-hovered rounded-lg border border-border-base text-content-muted text-sm">
                    暂无解析记录。请点击上方按钮添加第一条记录。
                  </div>
                ) : (
                  <>
                    {/* ≥md：保持原有 7 列表格（手机上这张表最小需要约 750px，只能横拖） */}
                    <div className="hidden md:block bg-hovered border border-border-base rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm border-collapse">
                          <thead>
                            <tr className="bg-elevated text-content-muted text-[10px] uppercase font-bold tracking-wider border-b border-border-base">
                              <th className="p-3 w-10">
                                <input
                                  type="checkbox"
                                  checked={dnsRecords.length > 0 && selectedDnsKeys.size === dnsRecords.length}
                                  onChange={toggleAllDnsSelection}
                                  className="w-4 h-4 accent-indigo-500 cursor-pointer align-middle"
                                  title="全选 / 取消全选"
                                />
                              </th>
                              <th className="p-3">类型</th>
                              <th className="p-3">主机记录</th>
                              <th className="p-3">解析记录值</th>
                              <th className="p-3 w-20">TTL</th>
                              <th className="p-3 w-24">线路</th>
                              <th className="p-3 w-20 text-center">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border-soft text-content-secondary">
                            {dnsRecords.map((rec) => {
                              const p = dnsRowParts(rec);

                              // 行内编辑态：整行换成输入控件，保存 / 取消就地完成
                              if (p.isEditing) {
                                return (
                                  <tr key={p.key} className="bg-indigo-500/5">
                                    <td className="p-3" />
                                    <td className="p-2">{p.typeSelect}</td>
                                    <td className="p-2">{p.nameInput}</td>
                                    <td className="p-2">
                                      <div className="flex items-center gap-1.5">
                                        {p.contentInput}
                                        {p.priorityInput}
                                      </div>
                                    </td>
                                    <td className="p-2">{p.ttlInput}</td>
                                    <td className="p-2">{p.lineInput}</td>
                                    <td className="p-2">
                                      <div className="flex items-center justify-center gap-1">
                                        {p.saveButton}
                                        {p.cancelButton}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              }

                              return (
                                <tr key={p.key} className="hover:bg-hovered">
                                  <td className="p-3">{p.checkbox}</td>
                                  <td className="p-3 font-bold text-xs text-indigo-400">{rec.type}</td>
                                  <td className="p-3 font-mono text-xs">{rec.name}</td>
                                  <td className="p-3 font-mono text-xs break-all max-w-xs" title={rec.content}>
                                    {rec.priority !== null && rec.priority !== undefined && `[优先级: ${rec.priority}] `}
                                    {rec.content}
                                  </td>
                                  <td className="p-3 text-xs text-content-muted">{rec.ttl}</td>
                                  <td className="p-3 text-xs text-content-muted">{rec.line || "默认"}</td>
                                  <td className="p-3">
                                    <div className="flex items-center justify-center gap-1">
                                      {p.editButton}
                                      {p.deleteButton}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* <md：每条记录一张卡片，字段纵向堆叠；编辑态在同一张卡里展开 */}
                    <div className="md:hidden space-y-2">
                      {/* 卡片模式下表头消失了，全选入口单独给一行 */}
                      <label className="flex items-center gap-2 px-1 py-1 text-xs text-content-muted">
                        <input
                          type="checkbox"
                          checked={dnsRecords.length > 0 && selectedDnsKeys.size === dnsRecords.length}
                          onChange={toggleAllDnsSelection}
                          className="w-4 h-4 accent-indigo-500 cursor-pointer"
                        />
                        全选（共 {dnsRecords.length} 条）
                      </label>

                      {dnsRecords.map((rec) => {
                        const p = dnsRowParts(rec);

                        if (p.isEditing) {
                          return (
                            <div
                              key={p.key}
                              className="bg-indigo-500/5 border border-indigo-500/40 rounded-lg p-3 space-y-2.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
                                  修改解析记录
                                </span>
                                <div className="flex items-center gap-1">
                                  {p.saveButton}
                                  {p.cancelButton}
                                </div>
                              </div>
                              <div>
                                <label className="block text-[11px] text-content-muted mb-1">记录类型</label>
                                {p.typeSelect}
                              </div>
                              <div>
                                <label className="block text-[11px] text-content-muted mb-1">主机记录</label>
                                {p.nameInput}
                              </div>
                              <div>
                                <label className="block text-[11px] text-content-muted mb-1">
                                  记录值{p.priorityInput ? " / 优先级" : ""}
                                </label>
                                <div className="flex items-center gap-1.5">
                                  {p.contentInput}
                                  {p.priorityInput}
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[11px] text-content-muted mb-1">TTL (秒)</label>
                                  {p.ttlInput}
                                </div>
                                <div>
                                  <label className="block text-[11px] text-content-muted mb-1">解析线路</label>
                                  {p.lineInput}
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={p.key}
                            className={`bg-hovered border rounded-lg p-3 space-y-2 ${
                              selectedDnsKeys.has(p.key) ? "border-indigo-500/50" : "border-border-base"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {p.checkbox}
                              <span className="font-bold text-xs text-indigo-400">{rec.type}</span>
                              <span className="ml-auto flex items-center gap-1">
                                {p.editButton}
                                {p.deleteButton}
                              </span>
                            </div>
                            <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                              <span className="text-content-muted">主机记录</span>
                              <span className="font-mono text-content-secondary break-all">{rec.name}</span>

                              <span className="text-content-muted">记录值</span>
                              <span className="font-mono text-content-secondary break-all">
                                {rec.priority !== null && rec.priority !== undefined && `[优先级: ${rec.priority}] `}
                                {rec.content}
                              </span>

                              <span className="text-content-muted">TTL</span>
                              <span className="text-content-secondary">{rec.ttl}</span>

                              <span className="text-content-muted">线路</span>
                              <span className="text-content-secondary">{rec.line || "默认"}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

            </div>

            {/* 模态框页脚 */}
            <div className="bg-elevated px-4 sm:px-6 py-4 border-t border-border-base flex justify-end flex-shrink-0">
              <button
                onClick={() => setDnsModalOpen(false)}
                className="bg-elevated hover:bg-hovered text-content-secondary text-sm font-semibold px-4 py-2 rounded-lg"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NS 域名服务器修改与重置模态框 (NS Modal) */}
      {/* 删除域名确认弹窗 —— 不可逆操作，需输入完整域名二次确认 */}
      {deleteModalDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-surface border border-rose-200 dark:border-rose-900/60 w-full max-w-lg max-h-[90dvh] rounded-2xl overflow-hidden flex flex-col shadow-2xl">
            {/* 头部 */}
            <div className="bg-elevated px-4 sm:px-6 py-4 flex items-center justify-between gap-2 border-b border-border-base flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-content-primary flex items-center gap-2">
                  <Trash2 className="text-rose-400 w-5 h-5 flex-shrink-0" />
                  删除域名
                </h3>
                <p className="text-xs text-content-muted mt-0.5 font-mono truncate">
                  {toUnicode(deleteModalDomain.full_domain)}
                </p>
              </div>
              <button
                onClick={() => setDeleteModalDomain(null)}
                className="text-content-muted hover:text-content-primary p-2 md:p-1 hover:bg-hovered rounded flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 内容 */}
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200 flex gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">此操作不可逆</p>
                  <p className="text-xs text-rose-700/90 dark:text-rose-300/90 leading-relaxed">
                    删除后域名将立即释放，可能被他人抢注，且无法恢复。
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-border-base bg-hovered text-xs text-content-secondary leading-relaxed">
                <p className="font-semibold text-content-primary mb-1.5 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-content-muted" /> 上游限制说明
                </p>
                <p className="text-content-muted">
                  域名存在<span className="text-content-secondary font-medium">解析记录历史</span>，
                  或处于<span className="text-content-secondary font-medium">转赠、ServerHold、PendingDelete</span> 等状态时，
                  上游不支持删除操作。此限制无法绕过，如被拒绝请按提示处理后重试。
                </p>
              </div>

              <div>
                <label className="text-xs text-content-muted font-medium block mb-1.5">
                  请输入完整域名以确认删除：
                  <span className="font-mono text-content-primary ml-1">
                    {toUnicode(deleteModalDomain.full_domain)}
                  </span>
                </label>
                <input
                  autoFocus
                  value={deleteConfirmInput}
                  onChange={(e) => { setDeleteConfirmInput(e.target.value); setDeleteError(""); }}
                  placeholder="在此输入完整域名"
                  className="w-full bg-elevated border border-border-base rounded-lg px-3 py-2 text-sm font-mono text-content-primary focus:outline-none focus:border-rose-700"
                />
              </div>

              {deleteError && (
                <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300 flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{deleteError}</span>
                </div>
              )}
            </div>

            {/* 底部操作 */}
            <div className="bg-elevated px-4 sm:px-6 py-4 flex items-center justify-end gap-3 border-t border-border-base flex-shrink-0">
              <button
                onClick={() => setDeleteModalDomain(null)}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-elevated hover:bg-hovered text-content-secondary border border-border-base"
              >
                取消
              </button>
              <button
                onClick={handleDeleteDomain}
                disabled={
                  actionLoading === `delete-${deleteModalDomain.id}` ||
                  !isDeleteConfirmed(deleteModalDomain, deleteConfirmInput)
                }
                className={`text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition-all ${
                  isDeleteConfirmed(deleteModalDomain, deleteConfirmInput) &&
                  actionLoading !== `delete-${deleteModalDomain.id}`
                    ? "bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
                    : "bg-elevated text-content-muted opacity-50 cursor-not-allowed"
                }`}
              >
                {actionLoading === `delete-${deleteModalDomain.id}` ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {nsModalOpen && nsModalDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-surface border border-border-base w-full max-w-2xl max-h-[90dvh] rounded-2xl overflow-hidden flex flex-col shadow-2xl">
            {/* 模态框头部 */}
            <div className="bg-elevated px-4 sm:px-6 py-4 flex items-center justify-between gap-2 border-b border-border-base flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-bold text-content-primary flex items-center gap-2">
                  <Server className="text-sky-400 w-5 h-5 flex-shrink-0" />
                  <span className="truncate">NS 域名服务器设置 / 域名委派</span>
                </h3>
                <p className="text-xs text-content-muted mt-0.5 font-mono truncate">
                  域名: {nsModalDomain.full_domain}
                </p>
              </div>
              <button
                onClick={() => setNsModalOpen(false)}
                className="text-content-muted hover:text-content-primary p-2 md:p-1 hover:bg-hovered rounded flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 模态框内容 */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 sm:space-y-6">
              
              {/* 当前 NS 状态指示
                  以域名自身的委派状态（checkHasDns，来自同步的 ns1/ns2 字段）为准，
                  而不是区域内 NS 解析记录的条数 —— 两者是两回事：
                  官网把 NS 改回 ns1/ns2.dnshe.com 后，区域里遗留的 NS 记录不会自动消失。 */}
              {(() => {
                const isDefaultNs = checkHasDns(nsModalDomain);
                const hasLeftoverNs = nsRecords.length > 0;
                const providerLabel = getDnsProviderLabel(nsModalDomain, nsRecords);
                return (
                  <div className="p-4 rounded-xl border border-border-base bg-hovered flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-xs text-content-muted block font-medium">当前 NS 运行状态</span>
                      <span className="text-sm font-bold text-content-primary mt-1 block">
                        {isDefaultNs
                          ? "系统默认 (ns1.dnshe.com / ns2.dnshe.com)"
                          : `${providerLabel} 委派托管中`}
                      </span>
                      {isDefaultNs && hasLeftoverNs && (
                        <span className="text-[11px] text-amber-400 mt-1 block">
                          域名已委派回系统默认，但区域内仍残留 {nsRecords.length} 条 NS 解析记录，建议清理
                        </span>
                      )}
                    </div>
                    <div className="shrink-0">
                      {isDefaultNs ? (
                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-900/60 text-xs px-3 py-1 rounded-full font-semibold">
                          系统默认
                        </span>
                      ) : (
                        <span className="bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-800/60 text-xs px-3 py-1 rounded-full font-semibold">
                          {providerLabel}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* 已设置的 NS 记录列表 */}
              {loadingNsModal ? (
                <div className="flex justify-center py-6">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                </div>
              ) : nsRecords.length > 0 ? (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-content-secondary uppercase tracking-wider">
                    {checkHasDns(nsModalDomain)
                      ? "区域内残留的 NS 解析记录"
                      : "当前委派的第三方 NS 服务器列表"}
                  </h4>
                  <div className="bg-hovered border border-border-base rounded-xl overflow-hidden divide-y divide-border-soft">
                    {nsRecords.map((rec) => (
                      <div key={rec.id} className="p-3.5 flex justify-between items-center text-xs font-mono">
                        <span className="text-content-secondary">{rec.content}</span>
                        <button
                          onClick={async () => {
                            await handleDeleteDnsRecord(rec.id ?? rec.record_id!, nsModalDomain);
                            handleOpenNsModal(nsModalDomain);
                            handleSyncDomains();
                          }}
                          disabled={actionLoading === `delete-dns-${rec.id ?? rec.record_id}`}
                          className="text-red-600 hover:text-red-700 p-2 md:p-1 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/40 rounded transition-all"
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
                    className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 dark:text-emerald-300 dark:border-emerald-900/60 py-2.5 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-inner mt-2"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === "reset-ns" ? "animate-spin" : ""}`} />
                    {checkHasDns(nsModalDomain)
                      ? `清理这 ${nsRecords.length} 条残留 NS 记录`
                      : "一键恢复为系统默认 NS (ns1.dnshe.com / ns2.dnshe.com)"}
                  </button>
                </div>
              ) : (
                <div className="text-center py-4 bg-hovered rounded-xl border border-border-base text-content-muted text-xs">
                  当前处于系统默认 NS。填下方表单可直接新增外部 NS 并切为「外部 DNS 委派」模式。
                </div>
              )}

              {/* 添加自定义第三方 NS 表单 */}
              <form onSubmit={handleAddCustomNs} className="p-4 border border-border-base rounded-xl bg-hovered space-y-3">
                <h4 className="text-xs font-bold text-content-secondary">添加 / 变更自定义 NS 服务器</h4>
                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <label className="block text-[10px] text-content-muted font-bold uppercase">
                      第三方 NS 服务器地址
                    </label>
                    {parsedNsList.length > 0 && (
                      <span className="text-[10px] text-indigo-400 font-semibold">
                        已识别 {parsedNsList.length} 条
                      </span>
                    )}
                  </div>
                  <textarea
                    required
                    rows={3}
                    placeholder={"每行一个，或用逗号/空格分隔，例如：\ndara.ns.cloudflare.com\nrick.ns.cloudflare.com"}
                    value={newCustomNsContent}
                    onChange={(e) => setNewCustomNsContent(e.target.value)}
                    className="w-full form-input px-3 py-2 rounded-lg text-sm text-content-secondary font-mono resize-y"
                  />
                  <p className="text-[10px] text-content-muted mt-1">
                    可一次填多个（NS 委派通常需要主备至少两条），将逐条提交
                  </p>
                </div>
                <div className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    id="forceReplaceNs"
                    checked={forceReplaceConflict}
                    onChange={(e) => setForceReplaceConflict(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded bg-surface border-border-base focus:ring-indigo-500 cursor-pointer"
                  />
                  <label htmlFor="forceReplaceNs" className="text-xs text-content-secondary font-medium cursor-pointer flex items-center gap-1">
                    强制替换冲突记录
                    <span className="text-[11px] text-content-muted font-normal">（自动删除同名 A / CNAME / TXT / MX 等冲突解析）</span>
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={actionLoading === "add-ns" || parsedNsList.length === 0}
                  className="w-full btn-primary py-2.5 rounded-lg font-semibold text-xs text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {actionLoading === "add-ns" && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  {parsedNsList.length > 1
                    ? `添加 ${parsedNsList.length} 条 NS 委派记录`
                    : "添加 NS 委派记录"}
                </button>
              </form>

            </div>

            {/* 页脚 */}
            <div className="bg-elevated px-4 sm:px-6 py-4 border-t border-border-base flex justify-end flex-shrink-0">
              <button
                onClick={() => setNsModalOpen(false)}
                className="bg-elevated hover:bg-hovered text-content-secondary text-sm font-semibold px-4 py-2 rounded-lg"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全局 Toast 通知 */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-2xl border transition-all duration-300 transform translate-y-0 text-sm font-semibold bg-surface text-content-primary border-border-base">
          {toast.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />}
          {toast.type === "error" && <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />}
          {toast.type === "info" && <Info className="w-5 h-5 text-indigo-500 flex-shrink-0" />}
          {toast.type === "warning" && <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

    </div>
  );
}
