import Tesseract from 'tesseract.js'

const CAT_MAP: [RegExp, string][] = [
  [/almuerzo|comida|rest|pizza|burger|cafe|mercado|super/i, 'Comida'],
  [/uber|taxi|moto|gasolina|transporte|pasaje/i, 'Transporte'],
  [/luz|agua|internet|datos|cantv|digitel|movistar/i, 'Servicios'],
  [/binance|p2p|usdt|tether|spread/i, 'P2P'],
  [/farmacia|medico|salud/i, 'Salud'],
  [/netflix|spotify|juego|ocio/i, 'Ocio'],
  [/tarjeta|credito|deuda|prestamo bancario/i, 'Deudas'],
]

export async function readReceipt(file: File | Blob) {
  const { data } = await Tesseract.recognize(file, 'spa+eng')
  const text = data.text || ''
  const nums = [...text.matchAll(/(\d+[.,]\d{1,2}|\d{2,})/g)].map((m) =>
    parseFloat(m[1].replace(',', '.')),
  )
  const amount = nums.sort((a, b) => b - a)[0] || 0
  const cat = CAT_MAP.find(([r]) => r.test(text))?.[1] || 'Otros'
  const isIncome = /ingreso|deposito|recibido|usdt|binance|p2p/i.test(text)
  return { text, amount, category: cat, isIncome }
}

export function parseTelegramCaption(text: string) {
  const ves = parseFloat((text.match(/ves[:\s]*([\d.,]+)/i)?.[1] || '0').replace(',', '.'))
  const usdt = parseFloat((text.match(/usdt[:\s]*([\d.,]+)/i)?.[1] || '0').replace(',', '.'))
  const binance = parseFloat((text.match(/binance[:\s]*([\d.,]+)/i)?.[1] || '0').replace(',', '.'))
  const session = /cierre|close/i.test(text) ? 'close' : 'open'
  return { ves, vesInUsdt: usdt, binanceUsdt: binance, session }
}
