import dotenv from 'dotenv';
import { currentPriceBaseline, providerPricingUrls } from './price-data.js';
import {
  addPriceChange,
  getSubscriptionsByProvider,
  getActiveSubscriptions,
  setLastChecked,
  getPriceHistory,
} from './subscription-store.js';
import { sendPriceChangeEmail, isEmailConfigured } from './email-service.js';

dotenv.config();

const CHECK_INTERVAL = process.env.MONITOR_INTERVAL
  ? parseInt(process.env.MONITOR_INTERVAL) * 60 * 1000
  : 60 * 60 * 1000; // 默认 1 小时

// 已知价格变动记录（内存缓存，避免重复通知）
const notifiedChanges = new Set();

function loadNotifiedSet() {
  const history = getPriceHistory();
  history.forEach(h => {
    notifiedChanges.add(`${h.provider}|${h.model}|${h.date}`);
  });
}

// 模拟价格变动检测
// 实际生产中，这里应该抓取各厂商定价页面并解析最新价格
// 由于各家页面结构不同，此处提供框架，可按需扩展具体厂商的抓取逻辑
async function fetchProviderPrice(providerName) {
  const url = providerPricingUrls[providerName];
  if (!url) return null;

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'TokenPlan-Price-Monitor/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    return parsePriceFromHtml(providerName, html);
  } catch (err) {
    console.warn(`[监控] 抓取 ${providerName} 失败:`, err.message);
    return null;
  }
}

// 价格解析框架 — 按厂商扩展
function parsePriceFromHtml(providerName, html) {
  // 各厂商页面结构不同，需要定制解析逻辑
  // 这里提供 DeepSeek 的示例框架，其他厂商可按需扩展
  const parsers = {
    'DeepSeek': (text) => {
      // DeepSeek 定价页有 JSON-LD 或表格结构
      // 实际实现需要根据页面结构调整
      return null; // 返回 null 表示未检测到变动
    },
    // 其他厂商解析器可在此添加
  };

  const parser = parsers[providerName];
  if (parser) return parser(html);
  return null;
}

// 对比价格变动
function detectChange(baseline, latest) {
  const changes = [];
  for (const key of ['inputRMB', 'outputRMB', 'inputUSD', 'outputUSD']) {
    if (baseline[key] != null && latest[key] != null) {
      const oldVal = baseline[key];
      const newVal = latest[key];
      if (oldVal !== newVal) {
        const isDrop = newVal < oldVal;
        const pct = Math.abs(((newVal - oldVal) / oldVal) * 100).toFixed(1);
        changes.push({
          field: key,
          oldVal,
          newVal,
          isDrop,
          pct,
        });
      }
    }
  }
  return changes;
}

// 通知订阅用户
async function notifySubscribers(changeRecord) {
  const providerSubs = getSubscriptionsByProvider(changeRecord.provider);
  const alertType = changeRecord.type === 'drop' ? 'price-drop'
    : changeRecord.type === 'new' ? 'new-model'
    : 'price-rise';
  const typeSubs = getActiveSubscriptions().filter(s =>
    s.alertTypes.includes(alertType) || s.alertTypes.includes('all')
  );
  const allSubs = [...new Map([...providerSubs, ...typeSubs].map(s => [s.email, s])).values()];

  let sentCount = 0;
  for (const sub of allSubs) {
    try {
      await sendPriceChangeEmail(sub.email, changeRecord, sub.token);
      sentCount++;
    } catch (err) {
      console.error(`[监控] 发送邮件至 ${sub.email} 失败:`, err.message);
    }
  }
  return sentCount;
}

// 执行一轮价格检查
async function runPriceCheck() {
  console.log(`\n[${new Date().toISOString()}] 开始价格检查...`);
  const baseline = currentPriceBaseline.providers;
  let changeCount = 0;

  for (const provider of baseline) {
    const key = provider.name;
    console.log(`  检查 ${key} ${provider.model}...`);

    const latest = await fetchProviderPrice(key);
    if (!latest) {
      continue;
    }

    const changes = detectChange(provider, latest);
    if (changes.length === 0) continue;

    const changeKey = `${provider.name}|${provider.model}|${new Date().toISOString().slice(0, 10)}`;
    if (notifiedChanges.has(changeKey)) {
      console.log(`  → 已通知过，跳过`);
      continue;
    }
    notifiedChanges.add(changeKey);

    const changeText = changes.map(c => {
      const currency = c.field.includes('RMB') ? '¥' : '$';
      const arrow = c.isDrop ? '↓' : '↑';
      return `${c.field}: ${currency}${c.oldVal} → ${currency}${c.newVal} (${arrow}${c.pct}%)`;
    }).join('，');

    const isDrop = changes.every(c => c.isDrop);
    const changeRecord = {
      provider: provider.name,
      model: provider.model,
      type: isDrop ? 'drop' : 'rise',
      change: changeText,
      note: `自动检测到价格变动（${changes.length} 项）`,
      date: new Date().toISOString().slice(0, 10),
      tag: isDrop ? '降价' : '涨价',
      tagClass: isDrop ? 'tag-drop' : 'tag-rise',
    };

    addPriceChange(changeRecord);

    if (isEmailConfigured()) {
      const notified = await notifySubscribers(changeRecord);
      console.log(`  → 检测到变动！已通知 ${notified} 位订阅用户`);
    } else {
      console.log(`  → 检测到变动！邮件服务未配置，跳过通知`);
    }
    changeCount++;
  }

  setLastChecked(new Date().toISOString());
  console.log(`[${new Date().toISOString()}] 检查完成，检测到 ${changeCount} 项变动\n`);
  return changeCount;
}

// 手动触发单次检查
async function checkOnce() {
  loadNotifiedSet();
  await runPriceCheck();
  process.exit(0);
}

// 持续监控模式
async function startMonitor() {
  loadNotifiedSet();
  console.log(`\n  ┌─────────────────────────────────────────────┐`);
  console.log(`  │  TokenPlan 价格监控服务                      │`);
  console.log(`  │  检查间隔: ${CHECK_INTERVAL / 60000} 分钟                          │`);
  console.log(`  │  监控厂商: ${currentPriceBaseline.providers.length} 家                        │`);
  console.log(`  │  邮件服务: ${isEmailConfigured() ? '✅ 已配置' : '⚠️  未配置'}              │`);
  console.log(`  └─────────────────────────────────────────────┘\n`);

  // 启动时先检查一次
  await runPriceCheck();

  // 定时检查
  setInterval(async () => {
    try {
      await runPriceCheck();
    } catch (err) {
      console.error('[监控] 检查异常:', err);
    }
  }, CHECK_INTERVAL);
}

const mode = process.argv[2];

if (mode === '--once' || mode === 'once') {
  checkOnce();
} else {
  startMonitor();
}
