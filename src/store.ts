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
    telegram: { token: '', chatId: '', lastUpdate: 0 },
    loans: [
      { id: 'l1', person: 'Carlos', amountUsd: 40, note: 'P2P puente', date: d(3), status: 'open' },
      { id: 'l2', person: 'Maria', amountUsd: 15, note: 'Recarga', date: d(8), status: 'open' },
    ],
    snaps: [
      { id: 's1', date: d(1), session: 'open', ves: 18500, vesInUsdt: 194.7, binanceUsdt: 320.4 },
      { id: 's1c', date: d(1), session: 'close', ves: 21200, vesInUsdt: 223.1, binanceUsdt: 348.2 },
      { id: 's0', date: d(0), session: 'open', ves: 19800, vesInUsdt: 208.4, binanceUsdt: 341.0 },
    ],
    txs: [
      { id: 't1', type: 'income', amountUsd: 28.5, category: 'P2P', note: 'Spread Binance', date: d(0), source: 'p2p' },
      { id: 't2', type: 'income', amountUsd: 12.2, category: 'P2P', note: 'Orden pequeña', date: d(0), source: 'p2p' },
      { id: 't3', type: 'expense', amountUsd: 3.4, category: 'Comida', note: 'Almuerzo', date: d(0), source: 'manual' },
      { id: 't4', type: 'expense', amountUsd: 1.2, category: 'Transporte', note: 'Mototaxi', date: d(0), source: 'manual' },
      { id: 't5', type: 'income', amountUsd: 41, category: 'P2P', note: 'Cierre día', date: d(1), source: 'p2p' },
      { id: 't6', type: 'expense', amountUsd: 8.9, category: 'Servicios', note: 'Datos móviles', date: d(1), source: 'ocr' },
      { id: 't7', type: 'expense', amountUsd: 22, category: 'Hogar', note: 'Mercado', date: d(2), source: 'manual' },
      { id: 't8', type: 'income', amountUsd: 18.7, category: 'P2P', note: 'Microordenes', date: d(2), source: 'p2p' },
      { id: 't9', type: 'expense', amountUsd: 5, category: 'Ocio', note: 'Café', date: d(3), source: 'manual' },
      { id: 't10', type: 'income', amountUsd: 55, category: 'P2P', note: 'Día fuerte', date: d(4), source: 'p2p' },
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

export const uid = () => Math.random().toString(36).slice(2, 10)

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
