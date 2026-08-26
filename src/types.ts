export type TxType = 'income' | 'expense' | 'transfer'
export type Period = 'day' | 'week' | 'month' | 'year' | 'all'
export type Theme = 'dark' | 'light'

export interface Transaction {
  id: string
  type: TxType
  amountUsd: number
  amountVes?: number
  /** Tasa Bs por 1 USDT vigente al registrar el movimiento */
  rateVes?: number
  category: string
  note: string
  date: string
  source: 'manual' | 'ocr' | 'telegram' | 'p2p'
  person?: string
  receipt?: string
}

export interface Loan {
  id: string
  person: string
  amountUsd: number
  note: string
  date: string
  status: 'open' | 'paid'
  paidDate?: string
}

/** Deuda pendiente que tú debes a alguien/algo (ej. tarjeta, préstamo recibido) */
export interface Debt {
  id: string
  name: string
  amountUsd: number
  note: string
  date: string
  status: 'open' | 'paid'
  paidDate?: string
}

export interface Snapshot {
  id: string
  date: string
  session: 'open' | 'close'
  ves: number
  vesInUsdt: number
  binanceUsdt: number
  /** Tasa Bs por 1 USDT usada para convertir los Bs de este snapshot */
  rate?: number
  note?: string
  receipt?: string
}

/** Plantilla de movimiento frecuente */
export interface Template {
  id: string
  type: TxType
  amountUsd: number
  category: string
  note: string
  person?: string
}

/** Gasto fijo mensual con fecha de vencimiento y alerta programable */
export interface Recurring {
  id: string
  name: string
  amountUsd: number
  /** Día del mes en que vence (1–31) */
  dayOfMonth: number
  category: string
  note: string
  /** Recordar hasta marcar pagado */
  remind: boolean
  /** Con cuántos días de anticipación empezar a avisar (0 = el día del vencimiento) */
  remindDaysBefore: number
  /** Meses pagados: "YYYY-M" → id del movimiento generado */
  paidMonths: Record<string, string>
}

export interface Store {
  txs: Transaction[]
  loans: Loan[]
  /** Deudas pendientes que tú debes */
  debts: Debt[]
  /** Gastos fijos del mes con alertas */
  recurring: Recurring[]
  snaps: Snapshot[]
  telegram: { token: string; chatId: string; lastUpdate: number }
  /** Última tasa Bs/USDT conocida */
  rate: number
  /** Meta de gasto diario en USDT (0 = sin meta) */
  dailyGoal: number
  /** Presupuesto mensual en USDT por categoría */
  budgets: Record<string, number>
  /** Plantillas de movimientos frecuentes */
  templates: Template[]
  theme: Theme
  /** Categorías personalizadas creadas por el usuario (se suman a las base al elegir "Otros" + nombre) */
  customCats: string[]
  /** Hash SHA-256 del PIN de bloqueo (vacío = sin bloqueo) */
  pinHash?: string
  /** Ya usó "empezar desde cero": oculta el botón del Home para evitar borrados accidentales */
  didReset?: boolean
}
