import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data', 'subscriptions.json');

function ensureDataFile() {
  const dir = join(__dirname, 'data');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(DATA_FILE)) {
    writeFileSync(DATA_FILE, JSON.stringify({ subscriptions: [], priceHistory: [], lastChecked: null }, null, 2));
  }
}

function readData() {
  ensureDataFile();
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { subscriptions: [], priceHistory: [], lastChecked: null };
  }
}

function writeData(data) {
  ensureDataFile();
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

export function addSubscription({ email, providers, alertTypes }) {
  const data = readData();
  const existing = data.subscriptions.find(s => s.email === email);
  if (existing) {
    const providerSet = new Set([...existing.providers, ...providers]);
    const typeSet = new Set([...existing.alertTypes, ...alertTypes]);
    existing.providers = [...providerSet];
    existing.alertTypes = [...typeSet];
    existing.updatedAt = new Date().toISOString();
  } else {
    const token = crypto.randomBytes(16).toString('hex');
    data.subscriptions.push({
      id: crypto.randomBytes(8).toString('hex'),
      email,
      providers,
      alertTypes,
      token,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  writeData(data);
  return existing || data.subscriptions[data.subscriptions.length - 1];
}

export function removeSubscription(email) {
  const data = readData();
  data.subscriptions = data.subscriptions.filter(s => s.email !== email);
  writeData(data);
}

export function unsubscribeByToken(token) {
  const data = readData();
  const sub = data.subscriptions.find(s => s.token === token);
  if (sub) {
    sub.active = false;
    sub.updatedAt = new Date().toISOString();
    writeData(data);
    return sub;
  }
  return null;
}

export function getActiveSubscriptions() {
  return readData().subscriptions.filter(s => s.active);
}

export function getSubscriptionsByProvider(providerName) {
  return getActiveSubscriptions().filter(s =>
    s.providers.includes(providerName) || s.providers.includes('all')
  );
}

export function getSubscriptionsByAlertType(alertType) {
  return getActiveSubscriptions().filter(s =>
    s.alertTypes.includes(alertType) || s.alertTypes.includes('all')
  );
}

export function getPriceHistory() {
  return readData().priceHistory;
}

export function addPriceChange(change) {
  const data = readData();
  const exists = data.priceHistory.some(
    h => h.provider === change.provider && h.model === change.model && h.date === change.date
  );
  if (!exists) {
    data.priceHistory.unshift(change);
    if (data.priceHistory.length > 200) data.priceHistory = data.priceHistory.slice(0, 200);
    writeData(data);
  }
  return !exists;
}

export function getLastChecked() {
  return readData().lastChecked;
}

export function setLastChecked(timestamp) {
  const data = readData();
  data.lastChecked = timestamp;
  writeData(data);
}

export function getStats() {
  const data = readData();
  return {
    totalSubscriptions: data.subscriptions.length,
    activeSubscriptions: data.subscriptions.filter(s => s.active).length,
    priceChanges: data.priceHistory.length,
    lastChecked: data.lastChecked,
  };
}
