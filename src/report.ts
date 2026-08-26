import type { Debt, Loan, Snapshot, Transaction } from './types'

export interface ReportBill {
  name: string
  dayOfMonth: number
  category: string
  amountUsd: number
  status: string
}

export interface ReportData {
  scope: string
  generatedAt: Date
  rate: number
  inc: number
  exp: number
  cash: number
  loansOpen: number
  debtsOpen: number
  netWorth: number
  txs: Transaction[]
  snaps: Snapshot[]
  loans: Loan[]
  debts: Debt[]
  bills: ReportBill[]
  billsPendingCount: number
  billsPendingTotal: number
  byCat: { name: string; value: number }[]
}

const f2 = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fdate = (iso: string) =>
  new Date(iso).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' })

const fileBase = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `moneycontrol-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Exporta el reporte a PDF (jsPDF + autotable, cargados bajo demanda) */
export async function exportPdf(r: ReportData) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF()
  const dark: [number, number, number] = [18, 26, 44]
  const finalY = (fallback: number) => (((doc as any).lastAutoTable?.finalY as number) ?? fallback) + 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(20)
  doc.text('MoneyControl', 14, 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(90)
  doc.text(`Reporte · ${r.scope}`, 14, 26)
  doc.text(`Generado: ${r.generatedAt.toLocaleString('es-VE')}`, 14, 32)

  autoTable(doc, {
    startY: 38,
    head: [['Resumen', '']],
    body: [
      ['Ingresos', `${f2(r.inc)} USDT`],
      ['Gastos', `${f2(r.exp)} USDT`],
      ['Neto', `${f2(r.inc - r.exp)} USDT`],
      ['Efectivo (snapshots)', `${f2(r.cash)} USDT`],
      ['Te deben (préstamos)', `+${f2(r.loansOpen)} USDT`],
      ['Debes (deudas)', `-${f2(r.debtsOpen)} USDT`],
      ['Patrimonio neto', `${f2(r.netWorth)} USDT`],
      ['Gastos fijos pendientes', `${r.billsPendingCount} · ${f2(r.billsPendingTotal)} USDT`],
      ['Tasa actual', `1 USDT = ${r.rate} Bs`],
      ['Movimientos', String(r.txs.length)],
    ],
    theme: 'grid',
    styles: { fontSize: 10 },
    headStyles: { fillColor: dark },
  })

  autoTable(doc, {
    startY: finalY(38),
    head: [['Fecha', 'Tipo', 'Categoría', 'Nota', 'Monto', 'Tasa', 'Equiv. Bs']],
    body: r.txs.length
      ? r.txs.map((t) => [
          fdate(t.date),
          t.type === 'income' ? 'Ingreso' : 'Gasto',
          t.category,
          t.note || '—',
          `${t.type === 'income' ? '+' : '-'}${f2(t.amountUsd)} USDT`,
          t.rateVes ? `@${t.rateVes}` : '—',
          t.rateVes ? f2(t.amountUsd * t.rateVes) : '—',
        ])
      : [['—', 'Sin movimientos', '', '', '', '', '']],
    theme: 'striped',
    styles: { fontSize: 8 },
    headStyles: { fillColor: dark, fontSize: 8 },
  })

  if (r.byCat.length) {
    autoTable(doc, {
      startY: finalY(60),
      head: [['Gastos por categoría', 'Total']],
      body: r.byCat.map((c) => [c.name, `${f2(c.value)} USDT`]),
      theme: 'grid',
      styles: { fontSize: 10 },
      headStyles: { fillColor: dark },
    })
  }

  if (r.snaps.length) {
    autoTable(doc, {
      startY: finalY(60),
      head: [['Fecha', 'Sesión', 'Bs', 'Tasa', 'Bs en USDT', 'Binance']],
      body: r.snaps.map((sn) => [
        fdate(sn.date),
        sn.session === 'open' ? 'Apertura' : 'Cierre',
        sn.ves.toLocaleString('es-VE'),
        sn.rate ? String(sn.rate) : '—',
        `${f2(sn.vesInUsdt)} USDT`,
        `${f2(sn.binanceUsdt)} USDT`,
      ]),
      theme: 'striped',
      styles: { fontSize: 9 },
      headStyles: { fillColor: dark, fontSize: 9 },
    })
  }

  if (r.loans.length) {
    autoTable(doc, {
      startY: finalY(60),
      head: [['Préstamos (te deben)', 'Nota', 'Fecha', 'Estado', 'Monto']],
      body: r.loans.map((l) => [
        l.person,
        l.note || '—',
        fdate(l.date),
        l.status === 'open' ? 'Pendiente' : 'Pagado',
        `${f2(l.amountUsd)} USDT`,
      ]),
      theme: 'striped',
      styles: { fontSize: 9 },
      headStyles: { fillColor: dark, fontSize: 9 },
    })
  }

  if (r.debts.length) {
    autoTable(doc, {
      startY: finalY(60),
      head: [['Deudas (tú debes)', 'Nota', 'Fecha', 'Estado', 'Monto']],
      body: r.debts.map((d) => [
        d.name,
        d.note || '—',
        fdate(d.date),
        d.status === 'open' ? 'Pendiente' : 'Pagada',
        `${f2(d.amountUsd)} USDT`,
      ]),
      theme: 'striped',
      styles: { fontSize: 9 },
      headStyles: { fillColor: [128, 40, 60], fontSize: 9 },
    })
  }

  if (r.bills.length) {
    autoTable(doc, {
      startY: finalY(60),
      head: [['Gasto fijo', 'Vence día', 'Categoría', 'Estado (mes actual)', 'Monto']],
      body: r.bills.map((b) => [b.name, `Día ${b.dayOfMonth}`, b.category, b.status, `${f2(b.amountUsd)} USDT`]),
      theme: 'striped',
      styles: { fontSize: 9 },
      headStyles: { fillColor: [60, 60, 110], fontSize: 9 },
    })
  }

  doc.save(`${fileBase()}.pdf`)
}

/** Exporta el reporte a Excel .xlsx (SheetJS, cargado bajo demanda) */
export async function exportXlsx(r: ReportData) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  const resumen = XLSX.utils.aoa_to_sheet([
    ['MoneyControl — Reporte'],
    ['Alcance', r.scope],
    ['Generado', r.generatedAt.toLocaleString('es-VE')],
    [],
    ['Concepto', 'Monto'],
    ['Ingresos (USDT)', +r.inc.toFixed(2)],
    ['Gastos (USDT)', +r.exp.toFixed(2)],
    ['Neto (USDT)', +(r.inc - r.exp).toFixed(2)],
    ['Efectivo · snapshots (USDT)', +r.cash.toFixed(2)],
    ['Te deben · préstamos (USDT)', +r.loansOpen.toFixed(2)],
    ['Debes · deudas (USDT)', -r.debtsOpen.toFixed(2)],
    ['Patrimonio neto (USDT)', +r.netWorth.toFixed(2)],
    ['Gastos fijos pendientes', `${r.billsPendingCount} · ${r.billsPendingTotal.toFixed(2)} USDT`],
    ['Tasa actual (Bs/USDT)', r.rate],
    ['Nº movimientos', r.txs.length],
  ])
  resumen['!cols'] = [{ wch: 30 }, { wch: 24 }]
  XLSX.utils.book_append_sheet(wb, resumen, 'Resumen')

  const movs = r.txs.map((t) => ({
    Fecha: fdate(t.date),
    Tipo: t.type === 'income' ? 'Ingreso' : 'Gasto',
    Categoría: t.category,
    Nota: t.note,
    Fuente: t.source,
    'Monto (USDT)': +t.amountUsd.toFixed(2),
    'Tasa (Bs/USDT)': t.rateVes ?? null,
    'Equiv. (Bs)': t.rateVes ? +(t.amountUsd * t.rateVes).toFixed(2) : null,
  }))
  const wsM = XLSX.utils.json_to_sheet(movs.length ? movs : [{ Fecha: 'Sin movimientos' }])
  wsM['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 10 }, { wch: 13 }, { wch: 15 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, wsM, 'Movimientos')

  if (r.byCat.length) {
    const wsC = XLSX.utils.json_to_sheet(
      r.byCat.map((c) => ({ Categoría: c.name, 'Total (USDT)': +c.value.toFixed(2) })),
    )
    wsC['!cols'] = [{ wch: 20 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, wsC, 'Gastos por categoría')
  }

  if (r.snaps.length) {
    const wsS = XLSX.utils.json_to_sheet(
      r.snaps.map((sn) => ({
        Fecha: fdate(sn.date),
        Sesión: sn.session === 'open' ? 'Apertura' : 'Cierre',
        'Bs en cuentas': sn.ves,
        'Tasa (Bs/USDT)': sn.rate ?? null,
        'Bs en USDT': +sn.vesInUsdt.toFixed(2),
        'Binance (USDT)': +sn.binanceUsdt.toFixed(2),
        'Total (USDT)': +(sn.vesInUsdt + sn.binanceUsdt).toFixed(2),
      })),
    )
    wsS['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 13 }]
    XLSX.utils.book_append_sheet(wb, wsS, 'Snapshots P2P')
  }

  if (r.loans.length) {
    const wsL = XLSX.utils.json_to_sheet(
      r.loans.map((l) => ({
        Persona: l.person,
        Nota: l.note,
        Fecha: fdate(l.date),
        Estado: l.status === 'open' ? 'Pendiente' : 'Pagado',
        'Monto (USDT)': +l.amountUsd.toFixed(2),
      })),
    )
    wsL['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 13 }]
    XLSX.utils.book_append_sheet(wb, wsL, 'Préstamos')
  }

  if (r.debts.length) {
    const wsD = XLSX.utils.json_to_sheet(
      r.debts.map((d) => ({
        Deuda: d.name,
        Nota: d.note,
        Fecha: fdate(d.date),
        Estado: d.status === 'open' ? 'Pendiente' : 'Pagada',
        'Monto (USDT)': +d.amountUsd.toFixed(2),
      })),
    )
    wsD['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 13 }]
    XLSX.utils.book_append_sheet(wb, wsD, 'Deudas')
  }

  if (r.bills.length) {
    const wsB = XLSX.utils.json_to_sheet(
      r.bills.map((b) => ({
        'Gasto fijo': b.name,
        'Vence día': b.dayOfMonth,
        Categoría: b.category,
        'Estado (mes actual)': b.status,
        'Monto (USDT)': +b.amountUsd.toFixed(2),
      })),
    )
    wsB['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 13 }]
    XLSX.utils.book_append_sheet(wb, wsB, 'Gastos fijos')
  }

  XLSX.writeFile(wb, `${fileBase()}.xlsx`)
}
