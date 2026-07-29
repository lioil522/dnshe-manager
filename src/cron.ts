import { DatabaseManager } from "./db";
import type { SubdomainInfo } from "./dnshe";

/**
 * Webhook 通知类型定义
 * 
 * NOTE: 支持按 WEBHOOK_TYPE 环境变量构造对应平台的规范 payload，
 * 而非同时携带所有平台的字段。
 */
type WebhookType = "dingtalk" | "feishu" | "wecom" | "custom";

/**
 * 推送 Webhook 通知
 */
export async function sendWebhookNotification(webhookUrl: string, message: string, webhookType: WebhookType = "custom") {
  if (!webhookUrl) return;
  try {
    let payload: Record<string, unknown>;

    switch (webhookType) {
      case "dingtalk":
        // 钉钉机器人 Webhook 格式
        payload = {
          msgtype: "text",
          text: { content: message }
        };
        break;
      case "feishu":
        // 飞书机器人 Webhook 格式
        payload = {
          msg_type: "text",
          content: { text: message }
        };
        break;
      case "wecom":
        // 企业微信机器人 Webhook 格式
        payload = {
          msgtype: "text",
          text: { content: message }
        };
        break;
      case "custom":
      default:
        // 通用格式，兼容大多数 Webhook 服务
        payload = {
          text: message,
          content: message
        };
        break;
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      console.error(`Webhook push failed with status: ${res.status}`);
    }
  } catch (e) {
    console.error("Failed to send Webhook notification:", e);
  }
}

// NOTE: 使用 DNSHEClient 的类型签名来定义分页拉取接口
interface SubdomainClient {
  listSubdomains(page: number, perPage: number): Promise<{
    success?: boolean;
    subdomains?: SubdomainInfo[];
    total?: number;
    message?: string;
  }>;
}

/**
 * 分页拉取某个账号下的全部子域名
 *
 * NOTE: DNSHE API 的 per_page 最大值为 500。循环分页直到所有数据拉取完毕。
 */
async function fetchAllSubdomainsFromClient(client: SubdomainClient): Promise<SubdomainInfo[]> {
  const allSubdomains: SubdomainInfo[] = [];
  const perPage = 500;
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await client.listSubdomains(page, perPage);
    if (!res || !res.success || !Array.isArray(res.subdomains)) {
      throw new Error(res?.message || "响应数据格式错误");
    }

    allSubdomains.push(...res.subdomains);

    // 判断是否还有下一页：当返回的数据量不足一页，或已达到 total 总数时停止
    if (res.subdomains.length < perPage) {
      hasMore = false;
    } else if (res.total !== undefined && allSubdomains.length >= res.total) {
      hasMore = false;
    } else {
      page++;
    }

    // 安全保护：最多拉取 50 页（25000 条），防止无限循环
    if (page > 50) {
      console.error("Pagination safety limit reached (50 pages), stopping.");
      break;
    }
  }

  return allSubdomains;
}

/**
 * 核心定时任务：全量同步所有账号的域名并自动续期即将到期的域名
 */
export async function runDailySyncAndRenewal(
  dbManager: DatabaseManager,
  webhookUrl?: string,
  webhookType: WebhookType = "custom"
) {
  await dbManager.ensureTables();
  await dbManager.writeLog("info", "system", "自动定时任务启动：开始执行域名同步与到期检测续期任务");

  let accounts: Array<{ id: number; alias: string }> = [];
  try {
    accounts = await dbManager.getAccounts();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    await dbManager.writeLog("error", "system", "同步任务失败：无法获取绑定的账户列表", message);
    return;
  }

  let totalSynced = 0;
  let totalRenewSuccess = 0;
  let totalRenewFail = 0;
  const renewLogs: string[] = [];

  for (const acc of accounts) {
    try {
      // 1. 获取解密后的 API 客户端
      const { client, alias } = await dbManager.getClientForAccount(acc.id);

      // 2. 分页拉取该账户在 DNSHE 系统的全部域名
      const subdomains = await fetchAllSubdomainsFromClient(client);
      
      // 3. 并发获取每个子域名的 DNS 记录，自动计算真实状态（已委派 / 已解析 / 未解析）
      const subdomainsWithDnsInfo = await Promise.all(
        subdomains.map(async (sub) => {
          try {
            const recordsRes = await client.listDnsRecords(sub.id);
            const records = recordsRes.records || [];
            const customNsRecord = records.find(
              (r) => r.type === "NS" && !r.content.toLowerCase().includes("dnshe.com")
            );
            
            let computedStatus = sub.status;
            let hasDnsVal = 1;

            if (customNsRecord) {
              computedStatus = "已委派";
              hasDnsVal = 0;
            } else if (records.length > 0) {
              computedStatus = "已解析";
              hasDnsVal = 1;
            } else {
              computedStatus = "未解析";
              hasDnsVal = 1;
            }

            return {
              ...sub,
              status: computedStatus,
              has_dns: hasDnsVal
            };
          } catch (e) {
            return { ...sub, has_dns: 1 };
          }
        })
      );

      // 4. 同步到本地 cache
      await dbManager.syncAccountDomains(acc.id, subdomainsWithDnsInfo);
      totalSynced += subdomains.length;
      
      // 4. 扫描该账号下的域名，判断是否需要续期
      for (const sub of subdomains) {
        const expiresAt = sub.expires_at as string | undefined;
        if (!expiresAt) continue;

        // 计算到期剩余天数
        const expiresTime = new Date(expiresAt).getTime();
        const nowTime = Date.now();
        const remainingDays = (expiresTime - nowTime) / (1000 * 60 * 60 * 24);

        // 当剩余天数小于等于 15 天时，尝试触发自动续期
        if (remainingDays >= 0 && remainingDays <= 15) {
          const subId = sub.id as number;
          const fullDomain = sub.full_domain as string;

          try {
            // 触发续期
            const renewResult = await client.renewSubdomain(subId);
            if (renewResult && renewResult.success) {
              totalRenewSuccess++;
              const newExpiresAt = renewResult.new_expires_at || "";
              
              // 更新本地到期时间缓存
              await dbManager.markDomainRenewed(subId, newExpiresAt);
              
              const msg = `域名 [${fullDomain}] (账户: ${alias}) 自动续期成功！新有效期至: ${newExpiresAt}`;
              await dbManager.writeLog("success", "renew", msg, renewResult);
              renewLogs.push(`✅ ${msg}`);
            } else {
              throw new Error(renewResult.message || "未知原因导致的续期失败");
            }
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : "";
            
            // 针对尚未到免费续期窗口的情况，只作为普通信息记录，避免推送红色警报
            if (errMsg.includes("renewal_not_yet_available") || errMsg.includes("not yet available")) {
              await dbManager.writeLog("info", "renew", `域名 [${fullDomain}] 自动续期请求已提交，但因尚未进入免费续期窗口被拦截，将在后续定时任务中重试。`);
            } else {
              totalRenewFail++;
              const msg = `域名 [${fullDomain}] (账户: ${alias}) 自动续期失败：${errMsg}`;
              await dbManager.writeLog("error", "renew", msg, err instanceof Error ? (err.stack || errMsg) : errMsg);
              renewLogs.push(`❌ ${msg}`);
            }
          }
        }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "未知错误";
      const stack = e instanceof Error ? (e.stack || message) : message;
      await dbManager.writeLog("error", "sync", `同步账号 [${acc.alias}] 的域名数据失败：${message}`, stack);
    }
  }

  // 整理并发送总结通知
  const summaryMsg = `自动同步任务结束。本次同步域名数: ${totalSynced} 个，自动续期成功: ${totalRenewSuccess} 个，续期失败: ${totalRenewFail} 个。`;
  await dbManager.writeLog("info", "system", summaryMsg);

  // 自动清理 30 天前的过期日志
  await dbManager.pruneExpiredLogs();

  // 如果有域名触发了续期，并且配置了 webhook，则向用户发送消息推送
  if (webhookUrl && renewLogs.length > 0) {
    const notifyBody = `【DNSHE 域名自动续期报告】\n${summaryMsg}\n\n详细明细：\n${renewLogs.join("\n")}`;
    await sendWebhookNotification(webhookUrl, notifyBody, webhookType);
  }
}
