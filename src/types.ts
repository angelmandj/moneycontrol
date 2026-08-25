export type TxType = 'income' | 'expense' | 'transfer'
export type Period = 'day' | 'week' | 'month' | 'year' | 'all'

export interface Transaction {
  id: string
  type: TxType
  amountUsd: number
  amountVes?: number
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

export interface Snapshot {
  id: string
  date: string
  session: 'open' | 'close'
  ves: number
  vesInUsdt: number
  binanceUsdt: number
  note?: string
  receipt?: string
}

export interface Store {
  txs: Transaction[]
  loans: Loan[]
  snaps: Snapshot[]
  telegram: { token: string; chatId: string; lastUpdate: number }
  rate: number
}
