import { toNum } from './store'

/**
 * Construye la URL CSV de UNA celda de Google Sheets.
 * Soporta:
 *  - Hoja "publicada en la web":  https://docs.google.com/spreadsheets/d/e/2PACX-…/pubhtml
 *  - Hoja compartida (cualquiera con el enlace puede ver): https://docs.google.com/spreadsheets/d/<id>/edit…
 *    (opcionalmente con #gid= para elegir la pestaña)
 */
export function sheetCellCsvUrl(raw: string, cell: string): string | null {
  const c = (cell || 'B1').trim().toUpperCase().replace(/[^A-Z0-9:]/g, '') || 'B1'
  const pub = raw.match(/\/d\/e\/(2PACX-[a-zA-Z0-9-_]+)/)
  if (pub) return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv&range=${c}`
  const m = raw.match(/\/d\/([a-zA-Z0-9-_]{20,})/)
  if (m) {
    const gid = (raw.match(/[#&?]gid=(\d+)/) || [])[1]
    return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}&range=${c}`
  }
  return null
}

/**
 * Lee el precio del USDT (Bs) desde la celda indicada.
 * Acepta formatos 225.50 / 225,50 / "Bs 225,50". Devuelve null si no se pudo leer.
 */
export async function fetchSheetRate(raw: string, cell: string): Promise<number | null> {
  const url = sheetCellCsvUrl(raw, cell)
  if (!url) return null
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const txt = await res.text()
    const clean = txt.replace(/﻿/g, '').replace(/"/g, '').trim().split('\n')[0]
    const n = toNum(clean)
    return Number.isFinite(n) && n > 0 && n < 100000 ? n : null
  } catch {
    return null
  }
}
