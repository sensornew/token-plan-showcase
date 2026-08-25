const { runFetcher } = require('./price-fetcher.cjs');
const emailService = require('./email-service.cjs');
const subscriptionStore = require('./subscription-store.cjs');

const INTERVAL_MS = parseInt(process.env.FETCH_INTERVAL_HOURS || '6') * 3600000;
const MAX_ALERTS_PER_RUN = 50;

function log(msg) {
  console.log(`[scheduler ${new Date().toISOString()}] ${msg}`);
}

async function checkPriceChangesAndAlert() {
  try {
    const fs = require('fs');
    const path = require('path');
    const changesFile = path.join(__dirname, 'data', 'price-changes.json');
    if (!fs.existsSync(changesFile)) return;
    const changes = JSON.parse(fs.readFileSync(changesFile, 'utf8'));
    const recent = changes.filter(c => {
      const ts = new Date(c.timestamp).getTime();
      return Date.now() - ts < INTERVAL_MS;
    });
    if (recent.length === 0) { log('No recent price changes.'); return; }
    log(`${recent.length} recent price changes. Sending alerts...`);
    const subs = subscriptionStore.listActive();
    if (subs.length === 0) { log('No active subscribers.'); return; }
    let sent = 0;
    for (const sub of subs) {
      if (sent >= MAX_ALERTS_PER_RUN) break;
      const relevant = recent.filter(c => sub.providers.includes(c.provider) || sub.providers.length === 0);
      if (relevant.length === 0) continue;
      const drops = relevant.filter(c => c.type === 'drop').length;
      const rises = relevant.filter(c => c.type === 'rise').length;
      const newModels = relevant.filter(c => c.type === 'new-model').length;
      if (drops > 0 && !sub.alertTypes.includes('price_drop')) continue;
      if (rises > 0 && !sub.alertTypes.includes('price_rise')) continue;
      if (newModels > 0 && !sub.alertTypes.includes('new_model')) continue;
      try {
        const providerList = sub.providers.length ? sub.providers.join(', ') : '全部厂商';
        const subject = `[TokenPlan] 价格变动预警 - ${drops} 降价, ${rises} 涨价, ${newModels} 新模型`;
        const html = `
          <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#e0e0e8;padding:2rem;border-radius:12px">
            <h2 style="color:#c8a44a;margin:0 0 1rem">TokenPlan 价格变动预警</h2>
            <p style="color:#a0a0b8">您关注的厂商有以下价格变动：</p>
            <table style="width:100%;border-collapse:collapse;margin:1rem 0">
              <tr style="background:rgba(200,170,100,0.1)">
                <th style="padding:0.5rem;text-align:left;color:#c8a44a">厂商</th>
                <th style="padding:0.5rem;text-align:left;color:#c8a44a">模型</th>
                <th style="padding:0.5rem;text-align:left;color:#c8a44a">变动</th>
                <th style="padding:0.5rem;text-align:left;color:#c8a44a">详情</th>
              </tr>
              ${relevant.slice(0, 20).map(c => `
              <tr style="border-bottom:1px solid rgba(120,120,180,0.1)">
                <td style="padding:0.5rem">${c.provider}</td>
                <td style="padding:0.5rem;font-family:monospace">${c.model}</td>
                <td style="padding:0.5rem">
                  ${c.type === 'drop' ? '📉 降价' : c.type === 'rise' ? '📈 涨价' : '🆕 新模型'}
                </td>
                <td style="padding:0.5rem;font-family:monospace">
                  ${c.oldPrice ? `${c.oldPrice} → ${c.newPrice} (${c.changePercent}%)` : '新上线'}
                </td>
              </tr>`).join('')}
            </table>
            <p style="color:#6a6a82;font-size:0.8rem;margin-top:1rem">
              此邮件由 TokenPlan 自动发送。关注厂商：${providerList}<br>
              如需退订，请访问 TokenPlan 价格追踪页面。
            </p>
          </div>`;
        await emailService.send(sub.email, subject, html);
        sent++;
        log(`  ✓ Alert sent to ${sub.email} (${relevant.length} changes)`);
      } catch(e) {
        log(`  ✗ Failed to send to ${sub.email}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    log(`Alerts sent: ${sent}/${subs.length} subscribers.`);
    if (recent.length > 0) {
      const remaining = changes.slice(MAX_ALERTS_PER_RUN);
      const dataFile = require('path').join(__dirname, 'data', 'price-changes.json');
      require('fs').writeFileSync(dataFile, JSON.stringify(remaining.slice(-200), null, 2), 'utf8');
    }
  } catch(e) {
    log(`Alert check error: ${e.message}`);
  }
}

async function tick() {
  log('--- Price update cycle started ---');
  try {
    await runFetcher();
    log('Price fetch complete.');
    await checkPriceChangesAndAlert();
    log('Alert check complete.');
  } catch(e) {
    log(`Cycle error: ${e.message}`);
  }
  log(`Next cycle in ${INTERVAL_MS / 3600000} hours.`);
}

log(`Scheduler started. Interval: ${INTERVAL_MS / 3600000} hours.`);
tick();
setInterval(tick, INTERVAL_MS);

process.on('SIGINT', () => { log('Stopping...'); process.exit(0); });
process.on('SIGTERM', () => { log('Stopping...'); process.exit(0); });
