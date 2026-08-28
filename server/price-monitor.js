import dotenv from 'dotenv';
import { createRequire } from 'module';
import { currentPriceBaseline } from './price-data.js';
import {
  addPriceChange,
  getSubscriptionsByProvider,
  getActiveSubscriptions,
  setLastChecked,
  getPriceHistory,
} from './subscription-store.js';
import { sendPriceChangeEmail, isEmailConfigured } from './email-service.js';

dotenv.config();

const _require = createRequire(import.meta.url);
const { runFetcher } = _require('./price-fetcher.cjs');
const path = _require('path');
const fs = _require('fs');
const SNAPSHOT_FILE = path.join(path.dirname(_require('url').fileURLToPath(import.meta.url)), 'data', 'price-snapshot.json');

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

// 从最新快照中提取价格变动，与基线对比
function detectChangesFromSnapshot(snapshot) {
  if (!snapshot || !snapshot.results) return [];
  const changes = [];
  const baselineProviders = currentPriceBaseline.providers;

  for (const result of snapshot.results) {
    if (result.error || !result.models) continue;

    // 检查该中转站是否有对应的基线数据
    const baseline = baselineProviders.find(b =>
      b.name === result.name || b.name === result.provider
    );
    if (!baseline) continue;

    for (const model of result.models) {
      const changeKey = `${result.name}|${model.model}|${new Date().toISOString().slice(0, 10)}`;
      if (notifiedChanges.has(changeKey)) continue;

      const inputPrice = model.inputPrice || model.inputRatio;
      const outputPrice = model.outputPrice || model.outputRatio;

      // 构建变动记录
      if (inputPrice > 0 || outputPrice > 0) {
        const changeText = [];
        if (inputPrice > 0) changeText.push(`输入: ${formatPrice(inputPrice)}`);
        if (outputPrice > 0) changeText.push(`输出: ${formatPrice(outputPrice)}`);

        changes.push({
          key: changeKey,
          record: {
            provider: result.name,
            model: model.model,
            type: 'snapshot',
            change: changeText.join(', '),
            note: `自动抓取价格快照`,
            date: new Date().toISOString().slice(0, 10),
            tag: '最新价格',
            tagClass: 'tag-new',
          }
        });
      }
    }
  }
  return changes;
}

function formatPrice(val) {
  if (val < 1) return val.toFixed(3);
  if (val < 10) return val.toFixed(2);
  return val.toFixed(1);
}

// 通知订阅用户
async function notifySubscribers(changeRecord) {
  const providerSubs = getSubscriptionsByProvider(changeRecord.provider);
  const typeSubs = getActiveSubscriptions().filter(s =>
    s.alertTypes.includes('all')
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

  // 1. 运行价格抓取器
  let snapshot;
  try {
    console.log('  [抓取] 开始抓取中转站价格...');
    snapshot = await runFetcher();
    console.log(`  [抓取] 完成: ${snapshot.successCount}/${snapshot.providerCount} 家中转站`);
  } catch (err) {
    // runFetcher 失败时尝试读取已有的快照
    console.warn(`  [抓取] 抓取异常: ${err.message}，尝试读取已有快照...`);
    try {
      if (fs.existsSync(SNAPSHOT_FILE)) {
        snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
      }
    } catch {}
  }

  if (!snapshot) {
    console.log('  [抓取] 无可用快照，跳过价格对比');
    return 0;
  }

  // 2. 检测变动
  const snapshotChanges = detectChangesFromSnapshot(snapshot);
  if (snapshotChanges.length === 0) {
    console.log('  无新价格变动');
    setLastChecked(new Date().toISOString());
    return 0;
  }

  // 3. 记录并通知
  let changeCount = 0;
  for (const { key, record } of snapshotChanges) {
    notifiedChanges.add(key);
    addPriceChange(record);

    if (isEmailConfigured()) {
      const notified = await notifySubscribers(record);
      console.log(`  → ${record.provider}/${record.model}: ${record.change} (通知 ${notified} 人)`);
    } else {
      console.log(`  → ${record.provider}/${record.model}: ${record.change} (邮件未配置，跳过通知)`);
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
  console.log(`  │  基线厂商: ${currentPriceBaseline.providers.length} 家                        │`);
  console.log(`  │  邮件服务: ${isEmailConfigured() ? '已配置' : '未配置'}              │`);
  console.log(`  └─────────────────────────────────────────────┘\n`);

  // 启动时先检查一次
  await runPriceCheck();

  // 定时检查（防重叠）
  let running = false;
  setInterval(async () => {
    if (running) { console.log('[监控] 上次检查仍在运行，跳过本次'); return; }
    running = true;
    try {
      await runPriceCheck();
    } catch (err) {
      console.error('[监控] 检查异常:', err.message);
    } finally {
      running = false;
    }
  }, CHECK_INTERVAL);

  // 优雅关闭
  process.on('SIGINT', () => { console.log('\n[监控] SIGINT，正在退出...'); process.exit(0); });
  process.on('SIGTERM', () => { console.log('\n[监控] SIGTERM，正在退出...'); process.exit(0); });
}

const mode = process.argv[2];

if (mode === '--once' || mode === 'once') {
  checkOnce();
} else {
  startMonitor();
}