const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'relay-stations.json');
const PRICE_HISTORY_FILE = path.join(__dirname, 'data', 'price-changes.json');
const SNAPSHOT_FILE = path.join(__dirname, 'data', 'price-snapshot.json');

const PROVIDERS_WITH_API = [
  { id: 'bltcy', name: '柏拉图 AI', url: 'https://api.bltcy.ai/api/pricing', format: 'new-api' },
  { id: 'uiuiapi', name: 'UiUiAPI', url: 'https://api1.uiuiapi.com/api/pricing', format: 'new-api' },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/models', format: 'openrouter' },
  { id: 'atlascloud', name: 'Atlas Cloud', url: 'https://www.atlascloud.ai/models', format: 'page-json' },
  { id: 'unorouter', name: 'UnoRouter', url: 'https://unorouter.ai/api/pricing', format: 'new-api' },
  { id: 'relaydance', name: 'Relaydance', url: 'https://relaydance.com/api/pricing', format: 'new-api' },
  { id: 'quicksilver', name: 'QuickSilver Pro', url: 'https://quicksilverpro.io/pricing.json', format: 'openrouter' },
  { id: 'novai', name: 'NovAI', url: 'https://aiapi-pro.com/v1/models', format: 'openai-models' },
  { id: 'aimlapi', name: 'AIMLAPI', url: 'https://api.aimlapi.com/v1/models', format: 'openai-models' },
];

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'TokenPlan-PriceBot/1.0',
        'Accept': 'application/json,text/html',
        ...options.headers
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return resolve(fetch(loc, options));
      }
      if (res.statusCode >= 400) { return reject(new Error(`HTTP ${res.statusCode}`)); }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function loadJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(e) { return null; }
}

function saveJson(f, data) {
  ensureDir(path.dirname(f));
  fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
}

// Parse new-api fork format: { data: [{ model_name, model_ratio, model_ratio_2, ... }] }
function parseNewApi(body) {
  try {
    const json = typeof body === 'string' ? JSON.parse(body) : body;
    if (!json.data || !Array.isArray(json.data)) return [];
    return json.data.map(m => ({
      model: m.model_name || m.name || m.id || 'unknown',
      inputRatio: parseFloat(m.model_ratio || m.ratio || 0),
      outputRatio: parseFloat(m.model_ratio_2 || m.completion_ratio || m.model_ratio || 0),
      cacheRatio: parseFloat(m.cache_ratio || 0),
      raw: m
    })).filter(m => m.model !== 'unknown');
  } catch(e) { return []; }
}

// Parse OpenRouter format: { data: [{ id, pricing: { prompt, completion, ... } }] }
function parseOpenRouter(body) {
  try {
    const json = typeof body === 'string' ? JSON.parse(body) : body;
    if (!json.data || !Array.isArray(json.data)) return [];
    return json.data.map(m => ({
      model: m.id || m.name || 'unknown',
      inputPrice: parseFloat(m.pricing?.prompt || 0),
      outputPrice: parseFloat(m.pricing?.completion || 0),
      cachePrice: parseFloat(m.pricing?.prompt_cache || 0),
      raw: m
    })).filter(m => m.model !== 'unknown' && m.inputPrice > 0);
  } catch(e) { []; }
}

// Parse OpenAI /v1/models format: { data: [{ id, pricing: { prompt, completion } }] }
function parseOpenAIModels(body) {
  try {
    const json = typeof body === 'string' ? JSON.parse(body) : body;
    if (!json.data || !Array.isArray(json.data)) return [];
    return json.data.map(m => ({
      model: m.id || m.name || 'unknown',
      inputPrice: parseFloat(m.pricing?.prompt || 0),
      outputPrice: parseFloat(m.pricing?.completion || 0),
      raw: m
    })).filter(m => m.model !== 'unknown' && (m.inputPrice > 0 || m.outputPrice > 0));
  } catch(e) { return []; }
}

async function fetchProvider(provider) {
  console.log(`[fetcher] Fetching ${provider.name} (${provider.id})...`);
  try {
    const { body } = await fetch(provider.url);
    let models = [];
    switch (provider.format) {
      case 'new-api': models = parseNewApi(body); break;
      case 'openrouter': models = parseOpenRouter(body); break;
      case 'openai-models': models = parseOpenAIModels(body); break;
      default: models = parseOpenRouter(body);
    }
    const result = {
      provider: provider.id,
      name: provider.name,
      url: provider.url,
      format: provider.format,
      fetchedAt: new Date().toISOString(),
      modelCount: models.length,
      models: models.slice(0, 50)
    };
    console.log(`[fetcher] ${provider.name}: ${models.length} models fetched`);
    return result;
  } catch(e) {
    console.error(`[fetcher] ${provider.name} error: ${e.message}`);
    return {
      provider: provider.id,
      name: provider.name,
      url: provider.url,
      error: e.message,
      fetchedAt: new Date().toISOString(),
      modelCount: 0,
      models: []
    };
  }
}

async function runFetcher() {
  console.log('=== Price Fetcher ===\n');
  const results = [];
  for (const p of PROVIDERS_WITH_API) {
    const r = await fetchProvider(p);
    results.push(r);
  }
  const snapshot = {
    snapshotTime: new Date().toISOString(),
    providerCount: results.length,
    successCount: results.filter(r => !r.error).length,
    totalModels: results.reduce((s, r) => s + r.modelCount, 0),
    results
  };
  saveJson(SNAPSHOT_FILE, snapshot);
  console.log(`\n=== Snapshot saved: ${snapshot.successCount}/${snapshot.providerCount} providers, ${snapshot.totalModels} models ===`);

  const changes = detectPriceChanges(snapshot);
  if (changes.length) {
    savePriceChanges(changes);
    console.log(`[fetcher] ${changes.length} price changes detected`);
  }
  return snapshot;
}

function detectPriceChanges(newSnapshot) {
  const old = loadJson(SNAPSHOT_FILE);
  if (!old || !old.results) return [];
  const changes = [];
  for (const newResult of newSnapshot.results) {
    if (newResult.error || !newResult.models) continue;
    const oldResult = old.results.find(r => r.provider === newResult.provider);
    if (!oldResult || !oldResult.models) continue;
    for (const newModel of newResult.models) {
      const oldModel = oldResult.models.find(m => m.model === newModel.model);
      if (!oldModel) {
        changes.push({
          provider: newResult.name,
          model: newModel.model,
          type: 'new-model',
          oldPrice: null,
          newPrice: newModel.inputPrice || newModel.inputRatio,
          timestamp: newSnapshot.snapshotTime
        });
        continue;
      }
      const oldP = oldModel.inputPrice || oldModel.inputRatio || 0;
      const newP = newModel.inputPrice || newModel.inputRatio || 0;
      if (oldP > 0 && newP > 0 && Math.abs(newP - oldP) / oldP > 0.01) {
        changes.push({
          provider: newResult.name,
          model: newModel.model,
          type: newP < oldP ? 'drop' : 'rise',
          oldPrice: oldP,
          newPrice: newP,
          changePercent: ((newP - oldP) / oldP * 100).toFixed(1),
          timestamp: newSnapshot.snapshotTime
        });
      }
    }
  }
  return changes;
}

function savePriceChanges(changes) {
  const existing = loadJson(PRICE_HISTORY_FILE) || [];
  existing.push(...changes);
  saveJson(PRICE_HISTORY_FILE, existing.slice(-200));
}

if (require.main === module) {
  runFetcher().catch(console.error);
}

module.exports = { runFetcher, PROVIDERS_WITH_API, fetchProvider };
