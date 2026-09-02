/** Parser de captions de Telegram del tipo `apertura ves:18500 usdt:194 binance:320`.
 *  (El OCR de facturas se eliminó por no funcionar; este parser no depende de Tesseract.) */
export function parseTelegramCaption(text: string) {
  const ves = parseFloat((text.match(/ves[:\s]*([\d.,]+)/i)?.[1] || '0').replace(',', '.'))
  const usdt = parseFloat((text.match(/usdt[:\s]*([\d.,]+)/i)?.[1] || '0').replace(',', '.'))
  const binance = parseFloat((text.match(/binance[:\s]*([\d.,]+)/i)?.[1] || '0').replace(',', '.'))
  const session = /cierre|close/i.test(text) ? 'close' : 'open'
  return { ves, vesInUsdt: usdt, binanceUsdt: binance, session }
}
