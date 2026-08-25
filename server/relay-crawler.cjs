const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'relay-stations.json');
const STATIC_FILE = path.join(__dirname, '..', 'token-plan-showcase.html');

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
        'Accept': 'text/html,application/json',
        ...options.headers
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetch(res.headers.location, options));
      }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function ensureDataDir() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadExisting() {
  ensureDataDir();
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) {}
  }
  return [];
}

function saveStations(stations) {
  ensureDataDir();
  const merged = mergeStations(loadExisting(), stations);
  fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`[relay-crawler] Saved ${merged.length} stations to ${DATA_FILE}`);
  return merged;
}

function mergeStations(existing, incoming) {
  const map = new Map();
  for (const s of existing) map.set(s.name.toLowerCase(), s);
  for (const s of incoming) {
    const key = s.name.toLowerCase();
    if (map.has(key)) {
      const old = map.get(key);
      map.set(key, { ...old, ...s, lastUpdated: new Date().toISOString() });
    } else {
      s.firstSeen = new Date().toISOString();
      s.lastUpdated = new Date().toISOString();
      map.set(key, s);
    }
  }
  return Array.from(map.values());
}

// ===== Crawler: AI API Hub (aiapihub.org) =====
async function crawlAIAPIHub() {
  console.log('[crawler] Fetching AI API Hub...');
  try {
    const { body } = await fetch('https://aiapihub.org/');
    const stations = [];
    const cardRegex = /<div class="[^"]*card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
    const nameRegex = /<h[3-5][^>]*>([^<]+)<\/h[3-5]>/;
    const linkRegex = /href="(https?:\/\/[^"]+)"/;
    const priceRegex = /[¥$][\d.]+\/?[KM]?/g;
    let match;
    const blocks = body.split(/<(?:div|article) class="[^"]*card/);
    for (const block of blocks) {
      const nm = block.match(nameRegex);
      const ln = block.match(linkRegex);
      if (nm && ln) {
        const name = nm[1].trim();
        if (name.length > 1 && name.length < 50) {
          const prices = (block.match(priceRegex) || []).slice(0, 3);
          stations.push({
            name, url: ln[1], type: 'relay', logo: name.slice(0, 2).toUpperCase(),
            color: '#3b82f6', models: ['GPT', 'Claude'],
            prices: prices.map(p => ({ l: '价格', v: p })),
            discount: '待确认', payment: ['待确认'], freeTier: false,
            note: 'AI API Hub 收录', status: 'unverified',
            source: 'aiapihub.org'
          });
        }
      }
    }
    console.log(`[crawler] AI API Hub: found ${stations.length} stations`);
    return stations;
  } catch(e) {
    console.error('[crawler] AI API Hub error:', e.message);
    return [];
  }
}

// ===== Crawler: HowToken (howtok.net) =====
async function crawlHowToken() {
  console.log('[crawler] Fetching HowToken...');
  try {
    const { body } = await fetch('https://howtok.net/');
    const stations = [];
    const blocks = body.split(/<(?:div|article|tr|li)[^>]*>/);
    const urlRegex = /href="(https?:\/\/(?!howtok\.net)[^"]+)"/;
    const nameRegex = />([^<]{2,40})</;
    for (const block of blocks) {
      const ln = block.match(urlRegex);
      if (ln) {
        const nm = block.match(nameRegex);
        const name = nm ? nm[1].trim() : ln[1].replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
        if (name.length > 1 && name.length < 50) {
          stations.push({
            name, url: ln[1], type: 'relay', logo: name.slice(0, 2).toUpperCase(),
            color: '#10b981', models: ['GPT', 'Claude'],
            prices: [], discount: '待确认', payment: ['待确认'],
            freeTier: false, note: 'HowToken 收录',
            status: 'unverified', source: 'howtok.net'
          });
        }
      }
    }
    console.log(`[crawler] HowToken: found ${stations.length} stations`);
    return stations;
  } catch(e) {
    console.error('[crawler] HowToken error:', e.message);
    return [];
  }
}

// ===== Crawler: zuiquanapi.com =====
async function crawlZuiquanAPI() {
  console.log('[crawler] Fetching zuiquanapi...');
  try {
    const { body } = await fetch('https://zuiquanapi.com/');
    const stations = [];
    const linkRegex = /href="(https?:\/\/(?!zuiquanapi\.com)[^"]+)"/g;
    const blocks = body.split(/<(?:div|article|li|tr)[^>]*>/);
    const nameRegex = />([^<]{2,50})</;
    const priceRegex = /[¥$][\d.]+/g;
    for (const block of blocks) {
      const ln = block.match(/href="(https?:\/\/(?!zuiquanapi)[^"]+)"/);
      if (ln) {
        const nm = block.match(nameRegex);
        const name = nm ? nm[1].trim() : ln[1].replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
        if (name.length > 1 && name.length < 50) {
          const prices = (block.match(priceRegex) || []).slice(0, 2);
          const isFree = /免費|免费|free/i.test(block);
          stations.push({
            name, url: ln[1], type: 'relay', logo: name.slice(0, 2).toUpperCase(),
            color: '#f59e0b', models: ['GPT', 'Claude'],
            prices: prices.map(p => ({ l: '价格', v: p })),
            discount: '待确认', payment: isFree ? ['免费'] : ['待确认'],
            freeTier: isFree, note: 'zuiquanapi 收录',
            status: 'unverified', source: 'zuiquanapi.com'
          });
        }
      }
    }
    console.log(`[crawler] zuiquanapi: found ${stations.length} stations`);
    return stations;
  } catch(e) {
    console.error('[crawler] zuiquanapi error:', e.message);
    return [];
  }
}

// ===== Crawler: TokenScanAI (tokenscanai.com) =====
async function crawlTokenScanAI() {
  console.log('[crawler] Fetching TokenScanAI...');
  try {
    const { body } = await fetch('https://tokenscanai.com/guide/2026-ai-api-relay-ranking');
    const stations = [];
    const blocks = body.split(/<(?:div|article|li|tr|p)[^>]*>/);
    const urlRegex = /href="(https?:\/\/(?!tokenscanai)[^"]+)"/;
    const nameRegex = /(?:title|alt|>([^<]{2,50})<)/;
    for (const block of blocks) {
      const ln = block.match(urlRegex);
      if (ln) {
        const nm = block.match(nameRegex);
        const name = nm ? nm[1].trim() : ln[1].replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
        if (name.length > 1 && name.length < 50) {
          stations.push({
            name, url: ln[1], type: 'relay', logo: name.slice(0, 2).toUpperCase(),
            color: '#8b5cf6', models: ['GPT', 'Claude'],
            prices: [], discount: '待确认', payment: ['待确认'],
            freeTier: false, note: 'TokenScanAI 收录',
            status: 'unverified', source: 'tokenscanai.com'
          });
        }
      }
    }
    console.log(`[crawler] TokenScanAI: found ${stations.length} stations`);
    return stations;
  } catch(e) {
    console.error('[crawler] TokenScanAI error:', e.message);
    return [];
  }
}

// ===== Crawler: GrokCode (grokcode.cn) =====
async function crawlGrokCode() {
  console.log('[crawler] Fetching GrokCode...');
  try {
    const { body } = await fetch('https://www.grokcode.cn/api-transit');
    const stations = [];
    const blocks = body.split(/<(?:div|article|tr|td)[^>]*>/);
    const urlRegex = /href="(https?:\/\/(?!grokcode)[^"]+)"/;
    const nameRegex = />([^<]{2,50})</;
    const availRegex = /(\d+\.?\d*)%/;
    const rateRegex = /([\d.]+)x/;
    for (const block of blocks) {
      const ln = block.match(urlRegex);
      if (ln) {
        const nm = block.match(nameRegex);
        const name = nm ? nm[1].trim() : ln[1].replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
        if (name.length > 1 && name.length < 50) {
          const avail = block.match(availRegex);
          const rate = block.match(rateRegex);
          const prices = [];
          if (avail) prices.push({ l: '可用率', v: avail[1] + '%' });
          if (rate) prices.push({ l: '倍率', v: rate[1] + 'x' });
          stations.push({
            name, url: ln[1], type: 'relay', logo: name.slice(0, 2).toUpperCase(),
            color: '#3b82f6', models: ['GPT', 'Claude'],
            prices: prices.length ? prices : [],
            discount: rate ? rate[1] + 'x倍率' : '待确认',
            payment: ['待确认'], freeTier: false,
            note: 'GrokCode 监测收录', status: 'unverified',
            source: 'grokcode.cn'
          });
        }
      }
    }
    console.log(`[crawler] GrokCode: found ${stations.length} stations`);
    return stations;
  } catch(e) {
    console.error('[crawler] GrokCode error:', e.message);
    return [];
  }
}

// ===== Extract static relay data from HTML file =====
async function extractStaticRelays() {
  console.log('[crawler] Extracting static relays from HTML...');
  try {
    const html = fs.readFileSync(STATIC_FILE, 'utf8');
    const match = html.match(/const relayStations = \[([\s\S]*?)\];/);
    if (!match) { console.log('[crawler] No static relay data found'); return []; }
    const arrText = match[1];
    const entries = [];
    const objRegex = /\{name:'([^']+)',type:'([^']+)',logo:'([^']+)',color:'([^']+)',url:'([^']*)'[\s\S]*?\}/g;
    let m;
    while ((m = objRegex.exec(arrText)) !== null) {
      const name = m[1], type = m[2], logo = m[3], color = m[4], url = m[5];
      const modelsMatch = m[0].match(/models:\[([^\]]*)\]/);
      const discountMatch = m[0].match(/discount:'([^']*)'/);
      const freeMatch = m[0].match(/freeTier:(true|false)/);
      const statusMatch = m[0].match(/status:'([^']*)'/);
      const noteMatch = m[0].match(/note:'([^']*)'/);
      const paymentMatch = m[0].match(/payment:\[([^\]]*)\]/);
      entries.push({
        name, type, logo, color, url,
        models: modelsMatch ? modelsMatch[1].replace(/'/g, '').split(',') : ['GPT'],
        prices: [], discount: discountMatch ? discountMatch[1] : '待确认',
        payment: paymentMatch ? paymentMatch[1].replace(/'/g, '').split(',') : ['待确认'],
        freeTier: freeMatch ? freeMatch[1] === 'true' : false,
        note: noteMatch ? noteMatch[1] : '',
        status: statusMatch ? statusMatch[1] : 'verified',
        source: 'static-data'
      });
    }
    console.log(`[crawler] Static HTML: found ${entries.length} stations`);
    return entries;
  } catch(e) {
    console.error('[crawler] Static extraction error:', e.message);
    return [];
  }
}

// ===== Main =====
async function main() {
  console.log('=== Relay Station Crawler ===\n');
  const all = [];
  const sources = [
    () => extractStaticRelays(),
    () => crawlAIAPIHub(),
    () => crawlHowToken(),
    () => crawlZuiquanAPI(),
    () => crawlTokenScanAI(),
    () => crawlGrokCode()
  ];
  for (const src of sources) {
    try {
      const data = await src();
      all.push(...data);
      console.log(`  Total so far: ${all.length}\n`);
    } catch(e) {
      console.error('  Crawler failed:', e.message, '\n');
    }
  }
  const saved = saveStations(all);
  console.log(`\n=== DONE: ${saved.length} unique stations saved ===`);
  return saved;
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, saveStations, loadExisting };
