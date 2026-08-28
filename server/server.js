import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

import {
  addSubscription,
  removeSubscription,
  unsubscribeByToken,
  getSubscriptionByEmail,
  getActiveSubscriptions,
  getSubscriptionsByProvider,
  addPriceChange,
  getPriceHistory,
  getStats,
  setLastChecked,
} from './subscription-store.js';
import { sendWelcomeEmail, sendPriceChangeEmail, isEmailConfigured } from './email-service.js';
import { createRequire } from 'module';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3210;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3210,http://localhost:3000';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function adminAuth(req, res, next) {
  if (!ADMIN_API_KEY) return res.status(403).json({ error: 'ADMIN_API_KEY 未配置' });
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (key !== ADMIN_API_KEY) return res.status(401).json({ error: '未授权' });
  next();
}

app.use(express.json());
// 安全提示: 生产环境请设置 FRONTEND_ORIGIN 为具体的域名，如 https://yourdomain.com
app.use(cors({ origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN.split(',').map(s=>s.trim()) }));
// 静态文件服务 - 将前端页面也通过后端提供，避免跨域问题
app.use(express.static(dirname(__dirname)));

// ===== 速率限制 =====
const rateLimitMap = new Map();
function rateLimit(windowMs = 60000, maxRequests = 20) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    if (!rateLimitMap.has(ip)) {
      rateLimitMap.set(ip, []);
    }
    const timestamps = rateLimitMap.get(ip).filter(t => now - t < windowMs);
    if (timestamps.length >= maxRequests) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);
    next();
  };
}
// 定期清理过期记录
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitMap) {
    const filtered = timestamps.filter(t => now - t < 60000);
    if (filtered.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, filtered);
  }
}, 60000);

// ===== CSRF 保护 =====
function csrfCheck(req, res, next) {
  if (req.method === 'GET') return next();
  const origin = req.get('origin');
  const referer = req.get('referer');
  const allowedOrigins = FRONTEND_ORIGIN === '*' ? null : FRONTEND_ORIGIN.split(',').map(s => s.trim());
  // 允许同源请求（无 Origin/Referer header）通过
  if (!origin && !referer) return next();
  // 检查 Origin
  if (origin && allowedOrigins) {
    if (allowedOrigins.some(o => origin.startsWith(o))) return next();
  }
  // 检查 Referer（提取根URL）
  if (referer && allowedOrigins) {
    try {
      const refUrl = new URL(referer);
      const refOrigin = refUrl.origin;
      if (allowedOrigins.some(o => refOrigin.startsWith(o))) return next();
    } catch {}
  }
  // 开发环境下允许 localhost
  if (origin && (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))) return next();
  if (referer && (referer.includes('localhost') || referer.includes('127.0.0.1'))) return next();
  return res.status(403).json({ error: 'CSRF 验证失败' });
}

// ===== 健康检查 =====
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    emailConfigured: isEmailConfigured(),
    stats: getStats(),
  });
});

// ===== 订阅价格预警 =====
app.post('/api/subscribe', csrfCheck, rateLimit(60000, 5), async (req, res) => {
  try {
    const { email, providers = [], alertTypes = [] } = req.body;

    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }

    const sub = addSubscription({ email, providers, alertTypes });

    // 发送欢迎确认邮件
    if (isEmailConfigured()) {
      try {
        await sendWelcomeEmail(email, providers, alertTypes, sub.token);
        res.json({ success: true, message: '订阅成功！确认邮件已发送至您的邮箱。', emailConfigured: true });
      } catch (err) {
        console.error('[API] 发送欢迎邮件失败:', err.message);
        res.json({ success: true, message: '订阅成功！但确认邮件发送失败，请检查邮件配置。', emailConfigured: false });
      }
    } else {
      // 开发模式：使用 Ethereal 测试邮箱
      try {
        const result = await sendWelcomeEmail(email, providers, alertTypes, sub.token);
        res.json({
          success: true,
          message: '订阅成功（开发模式）！测试邮件预览链接已生成。',
          dev: true,
          emailConfigured: false,
          previewUrl: result.previewUrl,
        });
      } catch (err) {
        console.error('[API] 测试邮件发送失败:', err.message);
        res.json({ success: true, message: '订阅成功！邮件服务尚未配置，后续配置后将自动生效。', emailConfigured: false });
      }
    }
  } catch (err) {
    console.error('[API] 订阅失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ===== 退订 =====
app.get('/api/unsubscribe', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send('缺少退订令牌');
  }
  const sub = unsubscribeByToken(token);
  if (sub) {
    res.send(`
      <div style="font-family:system-ui,sans-serif;max-width:500px;margin:80px auto;text-align:center;padding:40px;background:#0a0e1a;color:#e4e4e7;border-radius:16px">
        <h1 style="color:#34d399;font-size:22px">退订成功</h1>
        <p style="color:#8b8b9a;margin-top:12px">${escapeHtml(sub.email)} 已不再接收价格预警邮件。</p>
        <p style="color:#5a5a6a;margin-top:8px;font-size:13px">您可以随时重新订阅。</p>
      </div>
    `);
  } else {
    res.status(404).send('退订链接无效或已过期');
  }
});

// ===== 邮件退订（POST 方式）=====
app.post('/api/unsubscribe', csrfCheck, rateLimit(60000, 5), (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '缺少邮箱' });
  removeSubscription(email);
  res.json({ success: true, message: '已退订' });
});

// ===== 查询订阅状态 =====
app.get('/api/subscriptions', rateLimit(60000, 10), (req, res) => {
  const { email } = req.query;
  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    return res.status(400).json({ error: '请输入有效的邮箱地址' });
  }
  const sub = getSubscriptionByEmail(email);
  if (!sub || !sub.active) {
    return res.json({ active: false, providers: [], alertTypes: [] });
  }
  res.json({
    active: true,
    providers: sub.providers,
    alertTypes: sub.alertTypes,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  });
});

// ===== 获取价格变动历史 =====
app.get('/api/price-history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(getPriceHistory().slice(0, limit));
});

// ===== 手动添加价格变动记录（内部接口）=====
app.post('/api/price-change', adminAuth, csrfCheck, rateLimit(60000, 10), async (req, res) => {
  try {
    const { provider, model, type, change, note, date, tag, tagClass } = req.body;
    if (!provider || !model || !change) {
      return res.status(400).json({ error: '缺少必要字段' });
    }

    const changeRecord = {
      provider,
      model,
      type: type || 'drop',
      change,
      note: note || '',
      date: date || new Date().toISOString().slice(0, 10),
      tag: tag || (type === 'drop' ? '降价' : type === 'new' ? '新模型' : '涨价'),
      tagClass: tagClass || (type === 'drop' ? 'tag-drop' : type === 'new' ? 'tag-new' : 'tag-rise'),
    };

    const added = addPriceChange(changeRecord);

    if (added) {
      // 向订阅了该厂商的用户发送邮件
      const subscribers = getSubscriptionsByProvider(provider);
      const alertType = type === 'drop' ? 'price-drop' : type === 'new' ? 'new-model' : 'price-rise';
      const typeSubscribers = getActiveSubscriptions().filter(s =>
        s.alertTypes.includes(alertType) || s.alertTypes.includes('all')
      );
      const allSubs = [...new Set([...subscribers, ...typeSubscribers])];

      let sentCount = 0;
      for (const sub of allSubs) {
        try {
          await sendPriceChangeEmail(sub.email, changeRecord, sub.token);
          sentCount++;
        } catch (err) {
          console.error(`[API] 发送邮件至 ${sub.email} 失败:`, err.message);
        }
      }

      res.json({ success: true, added: true, subscribersNotified: sentCount, totalSubscribers: allSubs.length });
    } else {
      res.json({ success: true, added: false, message: '该价格变动已存在' });
    }
  } catch (err) {
    console.error('[API] 添加价格变动失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ===== 发送测试邮件 =====
app.post('/api/test-email', adminAuth, csrfCheck, rateLimit(60000, 3), async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '缺少邮箱' });

  try {
    const result = await sendPriceChangeEmail(
      email,
      {
        provider: 'DeepSeek',
        model: 'V4 Flash',
        type: 'drop',
        change: '输入价 ¥2 → ¥1.5（非高峰），输出 ¥8 → ¥4.5',
        note: '这是一封测试邮件，验证邮件服务是否正常工作。',
        date: new Date().toISOString().slice(0, 10),
        tag: '测试',
      },
      'test-token'
    );
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] 测试邮件发送失败:', err);
    res.status(500).json({ error: '邮件发送失败，请检查邮件服务配置' });
  }
});

// ===== 获取统计信息 =====
app.get('/api/stats', (req, res) => {
  res.json(getStats());
});

// ===== 中转站数据 API =====
const _require = createRequire(import.meta.url);
const { loadExisting: loadRelays, saveStations: saveRelays } = _require('./relay-crawler.cjs');

app.get('/api/relay-stations', (req, res) => {
  const stations = loadRelays();
  const { type, free, verified, search } = req.query;
  let filtered = stations;
  if (type && type !== 'all') {
    if (type === 'free') filtered = filtered.filter(s => s.freeTier);
    else if (type === 'verified') filtered = filtered.filter(s => s.status === 'verified');
    else filtered = filtered.filter(s => s.type === type);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(s => {
      const allText = (s.name + ' ' + (s.models || []).join(' ') + ' ' + (s.payment || []).join(' ') + ' ' + (s.note || '')).toLowerCase();
      return allText.includes(q);
    });
  }
  res.json({ total: filtered.length, stations: filtered });
});

app.post('/api/relay-stations/submit', csrfCheck, rateLimit(60000, 3), (req, res) => {
  try {
    const { name, url, type, models, prices, payment, freeTier, note, email } = req.body;
    if (!name || !url) return res.status(400).json({ error: '名称和 URL 为必填项' });
    if (typeof name !== 'string' || name.length > 200) return res.status(400).json({ error: '名称长度不合法' });
    if (typeof url !== 'string' || !/^https?:\/\/.+/i.test(url)) return res.status(400).json({ error: 'URL 格式无效' });
    if (email && !/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: '邮箱格式无效' });
    const safeNote = typeof note === 'string' ? note.slice(0, 500) : '';
    const station = {
      name: name.slice(0, 200), url, type: type || 'relay', logo: name.slice(0, 2).toUpperCase(),
      color: '#3b82f6', models: Array.isArray(models) ? models.slice(0, 20).map(m=>String(m).slice(0, 100)) : [],
      prices: Array.isArray(prices) ? prices.slice(0, 10) : [],
      discount: '待确认', payment: Array.isArray(payment) ? payment.slice(0, 10).map(p=>String(p).slice(0, 50)) : ['待确认'],
      freeTier: !!freeTier, note: safeNote,
      status: 'pending', source: 'user-submit',
      submitterEmail: email?.slice(0, 200), submittedAt: new Date().toISOString()
    };
    const saved = saveRelays([station]);
    res.json({ success: true, total: saved.length, message: '提交成功，等待审核' });
  } catch(e) {
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.post('/api/relay-stations/import', adminAuth, csrfCheck, rateLimit(60000, 2), (req, res) => {
  try {
    const stations = Array.isArray(req.body) ? req.body : [req.body];
    const saved = saveRelays(stations);
    res.json({ success: true, total: saved.length, message: `导入 ${stations.length} 条` });
  } catch(e) {
    console.error('[API] 批量导入中转站失败:', e);
    res.status(500).json({ error: '批量导入失败' });
  }
});

// ===== 价格快照 API =====
const SNAPSHOT_FILE = join(__dirname, 'data', 'price-snapshot.json');
const PRICE_CHANGES_FILE = join(__dirname, 'data', 'price-changes.json');

app.get('/api/price-snapshot', (req, res) => {
  try {
    if (!existsSync(SNAPSHOT_FILE)) {
      return res.json({ error: 'no_snapshot', message: '价格快照尚未生成。请运行 price-fetcher 或 price-scheduler。' });
    }
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));
    const provider = req.query.provider;
    if (provider) {
      const result = snapshot.results?.find(r => r.provider === provider || r.name === provider);
      if (result) return res.json(result);
    }
    res.json({
      snapshotTime: snapshot.snapshotTime,
      providerCount: snapshot.providerCount,
      successCount: snapshot.successCount,
      totalModels: snapshot.totalModels,
      providers: snapshot.results?.map(r => ({
        id: r.provider,
        name: r.name,
        url: r.url,
        format: r.format,
        modelCount: r.modelCount,
        error: r.error || null,
        fetchedAt: r.fetchedAt,
        topModels: (r.models || []).slice(0, 10).map(m => ({
          model: m.model,
          inputPrice: m.inputPrice || m.inputRatio,
          outputPrice: m.outputPrice || m.outputRatio,
          cachePrice: m.cachePrice || m.cacheRatio
        }))
      }))
    });
  } catch(e) {
    console.error('[API] 价格快照读取失败:', e);
    res.status(500).json({ error: '读取价格快照失败' });
  }
});

app.get('/api/price-changes', (req, res) => {
  try {
    if (!existsSync(PRICE_CHANGES_FILE)) {
      return res.json({ changes: [], message: '暂无价格变动记录。' });
    }
    const changes = JSON.parse(readFileSync(PRICE_CHANGES_FILE, 'utf8'));
    const limit = parseInt(req.query.limit) || 50;
    const provider = req.query.provider;
    const type = req.query.type;
    let filtered = changes;
    if (provider) filtered = filtered.filter(c => c.provider === provider);
    if (type) filtered = filtered.filter(c => c.type === type);
    res.json({
      total: filtered.length,
      changes: filtered.slice(-limit).reverse()
    });
  } catch(e) {
    console.error('[API] 价格变动读取失败:', e);
    res.status(500).json({ error: '读取价格变动记录失败' });
  }
});

// ===== 启动服务器 =====
app.listen(PORT, () => {
  console.log(`\n  ┌─────────────────────────────────────────────┐`);
  console.log(`  │  TokenPlan 价格预警服务器                    │`);
  console.log(`  │  端口: ${PORT}                                   │`);
  console.log(`  │  邮件服务: ${isEmailConfigured() ? '✅ 已配置' : '⚠️  未配置（开发模式）'}          │`);
  console.log(`  │  CORS: ${FRONTEND_ORIGIN === '*' ? '允许所有来源' : FRONTEND_ORIGIN}                 │`);
  console.log(`  └─────────────────────────────────────────────┘`);
  console.log(`\n  API 端点:`);
  console.log(`  POST /api/subscribe        - 订阅价格预警`);
  console.log(`  GET  /api/subscriptions    - 查询订阅状态`);
  console.log(`  GET  /api/unsubscribe      - 退订`);
  console.log(`  POST /api/unsubscribe      - 退订（POST）`);
  console.log(`  GET  /api/price-history    - 价格变动历史`);
  console.log(`  GET  /api/relay-stations   - 获取中转站列表`);
  console.log(`  POST /api/relay-stations/submit  - 提交新中转站`);
  console.log(`  POST /api/relay-stations/import  - 批量导入中转站`);
  console.log(`  POST /api/price-change     - 添加价格变动（触发通知）`);
  console.log(`  GET  /api/price-snapshot   - 获取价格快照`);
  console.log(`  GET  /api/price-changes    - 获取价格变动记录`);
  console.log(`  POST /api/test-email       - 发送测试邮件`);
  console.log(`  GET  /api/health           - 健康检查\n`);

  if (!isEmailConfigured()) {
    console.log('  ⚠️  邮件服务未配置。复制 .env.example 为 .env 并填写 SMTP 信息。');
    console.log('     开发模式下将使用 Ethereal 测试邮箱，邮件预览链接会输出到控制台。\n');
  }
});

// ===== 优雅关闭 =====
process.on('SIGINT', () => {
  console.log('\n[server] SIGINT received, shutting down...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('\n[server] SIGTERM received, shutting down...');
  process.exit(0);
});
