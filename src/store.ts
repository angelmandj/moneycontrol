import type { Store } from './types'

const KEY = 'moneycontrol.v1'

const seed = (): Store => {
  const today = new Date()
  const d = (n: number) => {
    const x = new Date(today)
    x.setDate(x.getDate() - n)
    return x.toISOString()
  }
  return {
    rate: 95,
    dailyGoal: 0,
    budgets: { Comida: 40, Transporte: 15 },
    templates: [],
    theme: 'dark',
    telegram: { token: '', chatId: '', lastUpdate: 0 },
    loans: [
      { id: 'l1', person: 'Carlos', amountUsd: 40, note: 'P2P puente', date: d(3), status: 'open' },
      { id: 'l2', person: 'Maria', amountUsd: 15, note: 'Recarga', date: d(8), status: 'open' },
    ],
    debts: [],
    recurring: [],
    snaps: [
      { id: 's1', date: d(1), session: 'open', ves: 18500, vesInUsdt: 194.7, binanceUsdt: 320.4, rate: 95 },
      { id: 's1c', date: d(1), session: 'close', ves: 21200, vesInUsdt: 223.1, binanceUsdt: 348.2, rate: 95 },
      { id: 's0', date: d(0), session: 'open', ves: 19800, vesInUsdt: 208.4, binanceUsdt: 341.0, rate: 96 },
    ],
    txs: [
      { id: 't1', type: 'income', amountUsd: 28.5, category: 'P2P', note: 'Spread Binance', date: d(0), source: 'p2p', rateVes: 96 },
      { id: 't2', type: 'income', amountUsd: 12.2, category: 'P2P', note: 'Orden pequeña', date: d(0), source: 'p2p', rateVes: 96 },
      { id: 't3', type: 'expense', amountUsd: 3.4, category: 'Comida', note: 'Almuerzo', date: d(0), source: 'manual', rateVes: 96 },
      { id: 't4', type: 'expense', amountUsd: 1.2, category: 'Transporte', note: 'Mototaxi', date: d(0), source: 'manual', rateVes: 96 },
      { id: 't5', type: 'income', amountUsd: 41, category: 'P2P', note: 'Cierre día', date: d(1), source: 'p2p', rateVes: 95 },
      { id: 't6', type: 'expense', amountUsd: 8.9, category: 'Servicios', note: 'Datos móviles', date: d(1), source: 'ocr', rateVes: 95 },
      { id: 't7', type: 'expense', amountUsd: 22, category: 'Hogar', note: 'Mercado', date: d(2), source: 'manual', rateVes: 95 },
      { id: 't8', type: 'income', amountUsd: 18.7, category: 'P2P', note: 'Microordenes', date: d(2), source: 'p2p', rateVes: 95 },
      { id: 't9', type: 'expense', amountUsd: 5, category: 'Ocio', note: 'Café', date: d(3), source: 'manual', rateVes: 95 },
      { id: 't10', type: 'income', amountUsd: 55, category: 'P2P', note: 'Día fuerte', date: d(4), source: 'p2p', rateVes: 95 },
    ],
  }
}

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return seed()
    return { ...seed(), ...JSON.parse(raw) }
  } catch {
    return seed()
  }
}

export function saveStore(s: Store) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

/** Normaliza un JSON de respaldo a un Store válido (rellena campos nuevos) */
export function coerceStore(raw: any): Store | null {
  if (!raw || !Array.isArray(raw.txs) || !Array.isArray(raw.snaps) || !Array.isArray(raw.loans)) return null
  const merged = { ...seed(), ...raw }
  if (!Array.isArray(raw.debts)) merged.debts = []
  if (!Array.isArray(raw.recurring)) merged.recurring = []
  return merged
}

export const uid = () => Math.random().toString(36).slice(2, 10)

/** Semana del mes (1–4): días 1-7 → S1, 8-14 → S2, 15-21 → S3, 22+ → S4 */
export function weekOfMonth(d: Date) {
  return Math.min(4, Math.floor((d.getDate() - 1) / 7) + 1)
}

/** Clave de mes para agrupar (ej. "2026-7" = agosto 2026) */
export const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`

/** Parsea montos escritos como 1200.50, 1200,50, 1.200,50 o 1,200.50 */
export function toNum(s: string) {
  s = s.replace(/[^\d.,-]/g, '')
  if (s.includes(',') && s.includes('.')) {
    return parseFloat(s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')) || 0
  }
  return parseFloat(s.replace(',', '.')) || 0
}

/** Hash del PIN de bloqueo (SHA-256 nativo, con fallback simple) */
export async function hashPin(pin: string) {
  const str = 'mc:' + pin
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch { /* fallback */ }
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  return 'h' + h.toString(16)
}

/** Vacía movimientos, préstamos y snapshots; conserva tasa, meta, presupuestos, plantillas, tema, PIN y Telegram */
export function resetData(s: Store): Store {
  return { ...s, txs: [], loans: [], snaps: [], debts: [] }
}

export function inPeriod(iso: string, period: string) {
  const t = new Date(iso)
  const now = new Date()
  const start = new Date(now)
  if (period === 'day') start.setHours(0, 0, 0, 0)
  else if (period === 'week') {
    const day = (now.getDay() + 6) % 7
    start.setDate(now.getDate() - day)
    start.setHours(0, 0, 0, 0)
  } else if (period === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  } else if (period === 'year') {
    start.setMonth(0, 1)
    start.setHours(0, 0, 0, 0)
  } else return true
  return t >= start && t <= now
}
