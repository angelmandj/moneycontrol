import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { loadStore, saveStore, uid, inPeriod, weekOfMonth, resetData, toNum, monthKey, hashPin, coerceStore } from './store'
import { parseTelegramCaption, readReceipt } from './ocr'
import { exportPdf, exportXlsx } from './report'
import { supabase, pushStore, pullStore } from './supabase'
import type { Debt, Loan, Period, Recurring, Snapshot, Store, Template, Transaction } from './types'

const CATS = ['P2P', 'Comida', 'Transporte', 'Servicios', 'Hogar', 'Salud', 'Ocio', 'Préstamos', 'Deudas', 'Otros']
const COLORS = ['#6ea8ff', '#3ee0a7', '#f5c46b', '#a78bfa', '#ff6b8a', '#67e8f9', '#fb923c', '#94a3b8', '#f472b6', '#c4b5fd']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const CAT_ICON: Record<string, string> = { P2P: '💱', Comida: '🍔', Transporte: '🛵', Servicios: '💡', Hogar: '🏠', Salud: '💊', Ocio: '🎮', Préstamos: '🤝', Deudas: '💳', Otros: '📦' }
const DAYL = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

/** Todo el dinero principal se muestra en USDT */
function money(n: number) {
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
}
/** Equivalente en bolívares, como dato secundario */
function ves(n: number) {
  return `${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`
}

type Tab = 'home' | 'tx' | 'p2p' | 'scan' | 'mas' | 'loans' | 'bills' | 'rep' | 'tg'

/** Estado de un gasto fijo para el mes en curso (alertas hasta marcar pagado) */
function billState(b: Recurring, now: Date) {
  const key = monthKey(now)
  const paidTx = b.paidMonths[key]
  const due = new Date(now.getFullYear(), now.getMonth(), b.dayOfMonth)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((+due - +today) / 86400000)
  const state: 'paid' | 'overdue' | 'due' | 'upcoming' = paidTx ? 'paid' : diff < 0 ? 'overdue' : diff === 0 ? 'due' : 'upcoming'
  const alert = !paidTx && b.remind && diff <= (b.remindDaysBefore ?? 0)
  return { state, diff, paidTx, alert }
}

interface Review {
  url: string
  text: string
  amount: number
  category: string
  isIncome: boolean
}

interface Confirm {
  title: string
  msg: string
  onYes: () => void
}

export default function App() {
  const [s, setS] = useState<Store>(() => loadStore())
  const [tab, setTab] = useState<Tab>('home')
  const [period, setPeriod] = useState<Period>('month')
  const [weekSel, setWeekSel] = useState(0) // 0 = mes completo, 1–4 = semana del mes
  const [q, setQ] = useState('')
  const [typeF, setTypeF] = useState<'all' | 'income' | 'expense'>('all')
  const [catF, setCatF] = useState('all')
  const [personF, setPersonF] = useState('')
  const [busy, setBusy] = useState('')
  const [exporting, setExporting] = useState<'' | 'pdf' | 'xlsx'>('')
  const [review, setReview] = useState<Review | null>(null)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [goalOpen, setGoalOpen] = useState(false)
  const [budgOpen, setBudgOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [ldTab, setLdTab] = useState<'owed' | 'owe'>('owed')
  const [toast, setToast] = useState('')
  // --- Nube (Supabase) ---
  const [sbUser, setSbUser] = useState<{ id: string; email: string } | null>(null)
  const [syncSt, setSyncSt] = useState<'off' | 'saving' | 'saved' | 'error'>('off')
  const [cloudAsk, setCloudAsk] = useState<{ remote: Store; updatedAt: string } | null>(null)
  const [email, setEmail] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const sRef = useRef(s)

  useEffect(() => saveStore(s), [s])
  useEffect(() => {
    document.documentElement.dataset.theme = s.theme || 'dark'
  }, [s.theme])
  useEffect(() => { sRef.current = s }, [s])

  // Notificación del navegador al abrir la app si hay pagos fijos con alerta activa (una por sesión)
  const notifiedRef = useRef(false)
  useEffect(() => {
    if (notifiedRef.current) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const due = s.recurring.filter((b) => billState(b, new Date()).alert)
    if (!due.length) return
    notifiedRef.current = true
    const total = due.reduce((a, b) => a + b.amountUsd, 0)
    new Notification('MoneyControl · Pagos fijos pendientes', {
      body: `${due.length} pago(s) por ${total.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT: ${due.map((b) => b.name).join(', ')}`,
    })
  }, [s.recurring])

  // Sesión de Supabase: restaurar al cargar y reaccionar a login/logout
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((ev, session) => {
      if ((ev === 'INITIAL_SESSION' || ev === 'SIGNED_IN') && session?.user) {
        void handleSignedIn(session.user.id, session.user.email || '')
      } else if (ev === 'SIGNED_OUT') {
        setSbUser(null)
        setSyncSt('off')
      }
    })
    return () => sub.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sube a la nube (debounce) cada vez que cambia el store, si hay sesión
  useEffect(() => {
    if (!sbUser || cloudAsk) return
    const t = setTimeout(async () => {
      setSyncSt('saving')
      try {
        const err = await pushStore(sbUser.id, sRef.current)
        setSyncSt(err ? 'error' : 'saved')
      } catch {
        setSyncSt('error')
      }
    }, 1200)
    return () => clearTimeout(t)
  }, [s, sbUser, cloudAsk])

  const now = new Date()
  const mes = MESES[now.getMonth()]
  const curKey = monthKey(now)
  const scopeLbl =
    period === 'day'
      ? `Hoy · ${now.getDate()} ${mes}`
      : period === 'week'
        ? `${mes} · Semana ${weekOfMonth(now)}/4`
        : period === 'month'
          ? weekSel
            ? `${mes} · Semana ${weekSel}/4`
            : `${mes} · Semanas 1–4`
          : period === 'year'
            ? `Año ${now.getFullYear()}`
            : 'Todo el historial'

  const inWeek = (iso: string) => weekSel === 0 || weekOfMonth(new Date(iso)) === weekSel

  const txs = useMemo(() => {
    return s.txs
      .filter((t) => inPeriod(t.date, period))
      .filter((t) => period !== 'month' || inWeek(t.date))
      .filter((t) => typeF === 'all' || t.type === typeF)
      .filter((t) => catF === 'all' || t.category === catF)
      .filter((t) => !personF || t.person === personF)
      .filter((t) => {
        const hay = `${t.note} ${t.category} ${t.person || ''}`.toLowerCase()
        return hay.includes(q.toLowerCase())
      })
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.txs, period, weekSel, typeF, catF, personF, q])

  const inc = txs.filter((t) => t.type === 'income').reduce((a, t) => a + t.amountUsd, 0)
  const exp = txs.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amountUsd, 0)
  const loansOpen = s.loans.filter((l) => l.status === 'open').reduce((a, l) => a + l.amountUsd, 0)
  const debtsOpen = s.debts.filter((d) => d.status === 'open').reduce((a, d) => a + d.amountUsd, 0)
  const todayExp = s.txs.filter((t) => t.type === 'expense' && inPeriod(t.date, 'day')).reduce((a, t) => a + t.amountUsd, 0)
  // Gastos fijos con alerta activa hoy (siguen recordando hasta marcar pagado)
  const billsDue = s.recurring.filter((b) => billState(b, now).alert)
  const billsDueTotal = billsDue.reduce((a, b) => a + b.amountUsd, 0)
  const billsPendingMonth = s.recurring.filter((b) => !b.paidMonths[curKey])
  const billsPendingTotal = billsPendingMonth.reduce((a, b) => a + b.amountUsd, 0)

  const lastClose = [...s.snaps].filter((x) => x.session === 'close').sort((a, b) => +new Date(b.date) - +new Date(a.date))[0]
  const lastOpen = [...s.snaps].filter((x) => x.session === 'open').sort((a, b) => +new Date(b.date) - +new Date(a.date))[0]
  const cash = lastClose
    ? lastClose.vesInUsdt + lastClose.binanceUsdt
    : lastOpen
      ? lastOpen.vesInUsdt + lastOpen.binanceUsdt
      : 0
  // Conciliación general: efectivo (snapshots) + lo que te deben − lo que debes
  const netWorth = cash + loansOpen - debtsOpen

  // Tendencia del neto vs mes anterior
  const prevD = new Date(now)
  prevD.setMonth(prevD.getMonth() - 1)
  const prevKey = monthKey(prevD)
  const netIn = (key: string) =>
    s.txs
      .filter((t) => monthKey(new Date(t.date)) === key)
      .reduce((a, t) => a + (t.type === 'income' ? t.amountUsd : t.type === 'expense' ? -t.amountUsd : 0), 0)
  const curNet = netIn(curKey)
  const prevNet = netIn(prevKey)
  const trendPct = prevNet !== 0 ? ((curNet - prevNet) / Math.abs(prevNet)) * 100 : null

  const byCat = CATS.map((c, i) => ({
    name: c,
    value: txs.filter((t) => t.type === 'expense' && t.category === c).reduce((a, t) => a + t.amountUsd, 0),
    color: COLORS[i],
  })).filter((x) => x.value > 0)

  // Presupuestos del mes en curso por categoría
  const budgRows = useMemo(() => {
    const spent: Record<string, number> = {}
    for (const t of s.txs) {
      if (t.type !== 'expense' || monthKey(new Date(t.date)) !== curKey) continue
      spent[t.category] = (spent[t.category] || 0) + t.amountUsd
    }
    return CATS
      .filter((c) => (s.budgets[c] || 0) > 0 || (spent[c] || 0) > 0)
      .map((c) => ({ c, spent: spent[c] || 0, budget: s.budgets[c] || 0 }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.txs, s.budgets])

  const byDay = (() => {
    const map = new Map<string, { d: string; in: number; out: number }>()
    for (const t of txs) {
      const k = t.date.slice(0, 10)
      const row = map.get(k) || { d: k.slice(5), in: 0, out: 0 }
      if (t.type === 'income') row.in += t.amountUsd
      else if (t.type === 'expense') row.out += t.amountUsd
      map.set(k, row)
    }
    return [...map.entries()].sort().map(([, v]) => v)
  })()

  const p2pSeries = (() => {
    const inScope = s.snaps.filter((x) => inPeriod(x.date, period) && (period !== 'month' || inWeek(x.date)))
    const base = inScope.length ? inScope : [...s.snaps].sort((a, b) => +new Date(a.date) - +new Date(b.date)).slice(-10)
    return [...base]
      .sort((a, b) => +new Date(a.date) - +new Date(b.date))
      .map((x) => ({
        d: x.date.slice(5, 10) + (x.session === 'open' ? '↑' : '↓'),
        ves: x.vesInUsdt,
        binance: x.binanceUsdt,
        total: x.vesInUsdt + x.binanceUsdt,
      }))
  })()

  // Conciliación: saldo real (último snapshot) vs saldo esperado (snapshot previo + movimientos)
  const recon = useMemo(() => {
    const ord = [...s.snaps].sort((a, b) => +new Date(a.date) - +new Date(b.date))
    if (ord.length < 2) return null
    const last = ord[ord.length - 1]
    const prev = ord[ord.length - 2]
    const net = s.txs
      .filter((t) => +new Date(t.date) > +new Date(prev.date) && +new Date(t.date) <= +new Date(last.date))
      .reduce((a, t) => a + (t.type === 'income' ? t.amountUsd : t.type === 'expense' ? -t.amountUsd : 0), 0)
    const expected = prev.vesInUsdt + prev.binanceUsdt + net
    const actual = last.vesInUsdt + last.binanceUsdt
    return {
      diff: +(actual - expected).toFixed(2),
      actual: +actual.toFixed(2),
      expected: +expected.toFixed(2),
      from: prev.date,
      to: last.date,
    }
  }, [s.snaps, s.txs])

  // Barras apiladas por día de la semana (Lun–Dom) según categoría de gasto
  const weekStack = useMemo(() => {
    const t0 = new Date()
    t0.setHours(0, 0, 0, 0)
    const off = (t0.getDay() + 6) % 7
    const days = [...Array(7)].map((_, i) => {
      const d = new Date(t0)
      d.setDate(t0.getDate() - off + i)
      return d
    })
    const top = CATS
      .map((c) => ({ c, v: txs.filter((t) => t.type === 'expense' && t.category === c).reduce((a, t) => a + t.amountUsd, 0) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 4)
      .map((x) => x.c)
    const totalExp = txs.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amountUsd, 0)
    const topSum = txs.filter((t) => t.type === 'expense' && top.includes(t.category)).reduce((a, t) => a + t.amountUsd, 0)
    const cats = totalExp - topSum > 0.004 ? [...top, 'Otros+'] : top
    const rows = days.map((d, i) => {
      const row: Record<string, number | string> = { d: `${DAYL[i]} ${d.getDate()}` }
      for (const c of cats) row[c] = 0
      for (const t of txs) {
        if (t.type !== 'expense') continue
        const td = new Date(t.date)
        if (td.toDateString() !== d.toDateString()) continue
        const c = top.includes(t.category) ? t.category : 'Otros+'
        if (cats.includes(c)) row[c] = +(row[c] as number) + t.amountUsd
      }
      return row
    })
    return { cats, rows }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txs])

  const barColor = (c: string) => (c === 'Otros+' ? '#64748b' : COLORS[Math.max(0, CATS.indexOf(c)) % COLORS.length])

  // Personas con las que has operado (filtro rápido)
  const persons = useMemo(
    () => [...new Set(s.txs.map((t) => t.person).filter(Boolean))] as string[],
    [s.txs],
  )

  // Datos del reporte: mismo alcance (período + semana), sin filtros de búsqueda
  const repTxs = useMemo(() => {
    return s.txs
      .filter((t) => inPeriod(t.date, period))
      .filter((t) => period !== 'month' || inWeek(t.date))
      .sort((a, b) => +new Date(a.date) - +new Date(b.date))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.txs, period, weekSel])
  const repInc = repTxs.filter((t) => t.type === 'income').reduce((a, t) => a + t.amountUsd, 0)
  const repExp = repTxs.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amountUsd, 0)
  const repByCat = CATS.map((c) => ({
    name: c,
    value: repTxs.filter((t) => t.type === 'expense' && t.category === c).reduce((a, t) => a + t.amountUsd, 0),
  })).filter((x) => x.value > 0)
  const repSnaps = [...s.snaps]
    .filter((x) => inPeriod(x.date, period) && (period !== 'month' || inWeek(x.date)))
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))

  // Recordatorio de cierre P2P (después de las 5pm si no hay cierre hoy)
  const closeToday = s.snaps.some((x) => x.session === 'close' && new Date(x.date).toDateString() === now.toDateString())
  const showCloseReminder = now.getHours() >= 17 && !closeToday

  async function onExport(kind: 'pdf' | 'xlsx') {
    setExporting(kind)
    try {
      const data = {
        scope: scopeLbl,
        generatedAt: new Date(),
        rate: s.rate,
        inc: repInc,
        exp: repExp,
        cash,
        loansOpen,
        debtsOpen,
        netWorth,
        txs: repTxs,
        snaps: repSnaps,
        loans: s.loans,
        debts: s.debts,
        bills: s.recurring.map((b) => {
          const st = billState(b, now)
          return {
            name: b.name,
            dayOfMonth: b.dayOfMonth,
            category: b.category,
            amountUsd: b.amountUsd,
            status: st.state === 'paid' ? 'Pagado' : st.state === 'overdue' ? 'Vencido' : st.state === 'due' ? 'Vence hoy' : 'Por vencer',
          }
        }),
        billsPendingCount: billsPendingMonth.length,
        billsPendingTotal,
        byCat: repByCat,
      }
      if (kind === 'pdf') await exportPdf(data)
      else await exportXlsx(data)
      ping('Reporte descargado')
    } catch (e) {
      console.error(e)
      ping('No se pudo generar el reporte')
    } finally {
      setExporting('')
    }
  }

  function addTx(partial: Partial<Transaction> & { type: Transaction['type']; amountUsd: number }) {
    const tx: Transaction = {
      id: uid(),
      category: 'Otros',
      note: '',
      date: new Date().toISOString(),
      source: 'manual',
      rateVes: s.rate, // guarda la tasa del momento
      ...partial,
    }
    setS((p) => ({ ...p, txs: [tx, ...p.txs] }))
    ping('Movimiento guardado')
  }

  function delTx(id: string) {
    setConfirm({
      title: 'Eliminar movimiento',
      msg: '¿Eliminar este movimiento? Esta acción no se puede deshacer.',
      onYes: () => {
        setS((p) => ({ ...p, txs: p.txs.filter((t) => t.id !== id) }))
        ping('Movimiento eliminado')
      },
    })
  }

  function startFromZero() {
    setConfirm({
      title: 'Empezar desde cero',
      msg: 'Se borrarán todos los movimientos, préstamos, deudas y snapshots. Conservamos tu tasa, metas, presupuestos, gastos fijos, plantillas y configuración.',
      onYes: () => {
        setS((p) => resetData(p))
        ping('Datos borrados · empiezas desde cero')
      },
    })
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    a.href = URL.createObjectURL(blob)
    a.download = `moneycontrol-respaldo-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    ping('Respaldo descargado')
  }

  function importBackup(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      let parsed: Store | null = null
      try {
        parsed = coerceStore(JSON.parse(String(reader.result)))
      } catch {
        /* inválido */
      }
      if (!parsed) return ping('Archivo de respaldo no válido')
      const ok = parsed
      setConfirm({
        title: 'Restaurar respaldo',
        msg: `Se reemplazarán tus datos actuales por los del archivo (${ok.txs.length} movimientos, ${ok.snaps.length} snapshots, ${ok.loans.length} préstamos).`,
        onYes: () => {
          setS(ok)
          ping('Respaldo restaurado')
        },
      })
    }
    reader.readAsText(file)
  }

  function ping(m: string) {
    setToast(m)
    setTimeout(() => setToast(''), 2200)
  }

  /* ---------- Nube (Supabase) ---------- */

  async function handleSignedIn(uid: string, mail: string) {
    setSbUser({ id: uid, email: mail })
    try {
      const remote = await pullStore(uid)
      if (!remote) {
        // Primera vez: la nube está vacía → subir lo que hay en este dispositivo
        const err = await pushStore(uid, sRef.current)
        setSyncSt(err ? 'error' : 'saved')
        if (!err) ping('Tus datos ya están en la nube ☁️')
      } else {
        const st = coerceStore(remote.payload)
        if (st) setCloudAsk({ remote: st, updatedAt: remote.updated_at })
        else setSyncSt('saved')
      }
    } catch (e: any) {
      setSyncSt('error')
      ping(e?.message?.includes('user_data') ? 'Falta crear la tabla en Supabase (ver setup.sql)' : 'No se pudo conectar con la nube')
    }
  }

  async function sendMagic() {
    const mail = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(mail)) return ping('Escribe un correo válido')
    const { error } = await supabase.auth.signInWithOtp({
      email: mail,
      options: { emailRedirectTo: window.location.origin },
    })
    ping(error ? error.message : `Enlace enviado a ${mail} · revísalo en este dispositivo`)
    if (!error) setEmail('')
  }

  async function pullNow() {
    if (!sbUser) return
    try {
      const remote = await pullStore(sbUser.id)
      const st = remote && coerceStore(remote.payload)
      if (!st || !remote) return ping('La nube aún está vacía')
      setCloudAsk({ remote: st, updatedAt: remote.updated_at })
    } catch {
      ping('No se pudo leer la nube')
    }
  }

  async function pushNow() {
    if (!sbUser) return
    setSyncSt('saving')
    try {
      const err = await pushStore(sbUser.id, s)
      setSyncSt(err ? 'error' : 'saved')
      ping(err ? 'Error al subir' : 'Subido a la nube ☁️')
    } catch {
      setSyncSt('error')
      ping('Error al subir')
    }
  }

  async function onScan(file: File, kind: 'tx' | 'p2p') {
    setBusy('Leyendo captura con OCR…')
    try {
      const r = await readReceipt(file)
      const url = URL.createObjectURL(file)
      if (kind === 'p2p') {
        const cap = parseTelegramCaption(r.text)
        const v = cap.ves || r.amount
        const snap: Snapshot = {
          id: uid(),
          date: new Date().toISOString(),
          session: cap.session as 'open' | 'close',
          ves: v,
          vesInUsdt: cap.vesInUsdt || v / (s.rate || 1),
          binanceUsdt: cap.binanceUsdt || 0,
          rate: s.rate,
          receipt: url,
          note: r.text.slice(0, 180),
        }
        setS((p) => ({ ...p, snaps: [snap, ...p.snaps] }))
        ping('Snapshot P2P creado')
      } else {
        // Factura: abrir confirmación con conversión Bs → USDT
        setReview({ url, text: r.text, amount: r.amount, category: r.category, isIncome: r.isIncome })
      }
    } catch {
      ping('No se pudo leer la imagen')
    } finally {
      setBusy('')
    }
  }

  async function pollTelegram() {
    if (!s.telegram.token) return ping('Pega el token del bot')
    setBusy('Sincronizando Telegram…')
    try {
      const url = `https://api.telegram.org/bot${s.telegram.token}/getUpdates?offset=${s.telegram.lastUpdate + 1}&timeout=5`
      const res = await fetch(url)
      const data = await res.json()
      if (!data.ok) throw new Error(data.description)
      let last = s.telegram.lastUpdate
      const extraTx: Transaction[] = []
      const extraSn: Snapshot[] = []
      for (const u of data.result as any[]) {
        last = Math.max(last, u.update_id)
        const msg = u.message
        if (!msg) continue
        const text: string = msg.text || msg.caption || ''
        if (/gasto|expense|-\s?\$/i.test(text)) {
          extraTx.push({
            id: uid(), type: 'expense', amountUsd: toNum(text), category: 'Otros', note: text, date: new Date().toISOString(), source: 'telegram', rateVes: s.rate,
          })
        } else if (/ingreso|\+\s?\$|p2p/i.test(text) && !/apertura|cierre|binance/i.test(text)) {
          extraTx.push({
            id: uid(), type: 'income', amountUsd: toNum(text), category: 'P2P', note: text, date: new Date().toISOString(), source: 'telegram', rateVes: s.rate,
          })
        }
        if (/apertura|cierre|binance|ves/i.test(text)) {
          const p = parseTelegramCaption(text)
          extraSn.push({
            id: uid(), date: new Date().toISOString(), session: p.session as 'open' | 'close',
            ves: p.ves, vesInUsdt: p.vesInUsdt || p.ves / (s.rate || 1), binanceUsdt: p.binanceUsdt, rate: s.rate, note: text,
          })
        }
      }
      setS((prev) => ({
        ...prev,
        txs: [...extraTx, ...prev.txs],
        snaps: [...extraSn, ...prev.snaps],
        telegram: { ...prev.telegram, lastUpdate: last, chatId: String(data.result?.[0]?.message?.chat?.id || prev.telegram.chatId) },
      }))
      ping(`${extraTx.length + extraSn.length} eventos importados`)
    } catch (e: any) {
      ping(e.message || 'Error Telegram (CORS: usa el bot localmente o un proxy)')
    } finally {
      setBusy('')
    }
  }

  const goalPct = s.dailyGoal > 0 ? Math.min(100, (todayExp / s.dailyGoal) * 100) : 0
  const goalColor = goalPct < 70 ? 'var(--green)' : goalPct < 100 ? 'var(--gold)' : 'var(--red)'

  const acts = [
    { icon: '＋', label: 'Registrar', go: 'tx' as Tab, color: 'var(--blue)' },
    { icon: '📷', label: 'Escanear', go: 'scan' as Tab, color: 'var(--violet)' },
    { icon: '💱', label: 'Snapshot', go: 'p2p' as Tab, color: 'var(--gold)' },
    { icon: '📄', label: 'Reporte', go: 'rep' as Tab, color: 'var(--green)' },
  ]

  const navItems = [
    { k: 'home' as Tab, icon: '🏠', l: 'Home' },
    { k: 'tx' as Tab, icon: '📋', l: 'Movs' },
    { k: 'scan' as Tab, icon: '📷', l: 'Scan' },
    { k: 'p2p' as Tab, icon: '💱', l: 'P2P' },
    { k: 'mas' as Tab, icon: '☰', l: 'Más' },
  ]
  const navActive = (k: Tab) => (k === 'mas' ? ['mas', 'loans', 'bills', 'rep', 'tg'].includes(tab) : tab === k)

  // Bloqueo por PIN: todos los hooks ya se ejecutaron
  if (s.pinHash && !unlocked) {
    return <LockScreen pinHash={s.pinHash} onOk={() => setUnlocked(true)} />
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '18px 16px 130px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: 0.5 }}>MoneyControl</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>
            {now.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {sbUser && (
            <span
              style={{ fontSize: 13 }}
              title={syncSt === 'saving' ? 'Subiendo a la nube…' : syncSt === 'error' ? 'Sin conexión con la nube' : 'Sincronizado con la nube'}
            >
              {syncSt === 'saving' ? '⏳' : syncSt === 'error' ? '⚠️' : '☁️'}
            </span>
          )}
          <div className="mono" style={{ fontSize: 12, color: 'var(--gold)', background: 'rgba(245,196,107,.1)', padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)' }}>
            1 USDT ≈ {s.rate} Bs
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 10 }}>
        {(['day', 'week', 'month', 'year'] as Period[]).map((p) => (
          <button key={p} onClick={() => { setPeriod(p); setWeekSel(0) }} style={chip(period === p)}>
            {p === 'day' ? 'Hoy' : p === 'week' ? 'Semana' : p === 'month' ? 'Mes' : 'Año'}
          </button>
        ))}
      </div>

      {period === 'month' && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 14 }}>
          {[0, 1, 2, 3, 4].map((w) => (
            <button key={w} onClick={() => setWeekSel(w)} style={chip(weekSel === w)}>
              {w === 0 ? 'Todo' : `Sem ${w}`}
            </button>
          ))}
        </div>
      )}

      {tab === 'home' && (
        <>
          {billsDue.length > 0 && (
            <button onClick={() => setTab('bills')} style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer', color: 'var(--text)', display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, borderColor: 'rgba(255,107,138,.4)', background: 'rgba(255,107,138,.08)' }}>
              <span style={{ fontSize: 18 }}>🔔</span>
              <span style={{ flex: 1, fontSize: 13 }}>
                <b>{billsDue.length} pago{billsDue.length > 1 ? 's' : ''} fijo{billsDue.length > 1 ? 's' : ''} pendiente{billsDue.length > 1 ? 's' : ''}</b> · {money(billsDueTotal)}
                <br />
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{billsDue.map((b) => b.name).join(' · ')}</span>
              </span>
              <span style={{ color: 'var(--red)' }}>›</span>
            </button>
          )}

          {showCloseReminder && (
            <button onClick={() => setTab('p2p')} style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer', color: 'var(--text)', display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, borderColor: 'rgba(245,196,107,.35)', background: 'rgba(245,196,107,.08)' }}>
              <span style={{ fontSize: 18 }}>🌙</span>
              <span style={{ flex: 1, fontSize: 13 }}>Aún no registraste el <b>cierre P2P</b> de hoy</span>
              <span style={{ color: 'var(--gold)' }}>›</span>
            </button>
          )}

          <div style={hero}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ opacity: 0.7, fontSize: 13 }}>Patrimonio operativo</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{scopeLbl}</div>
            </div>
            <div className="mono" style={{ fontSize: 36, fontWeight: 700, margin: '4px 0 4px', letterSpacing: -0.5 }}>{money(cash)}</div>
            {trendPct !== null && (
              <div style={{ fontSize: 12, color: trendPct >= 0 ? 'var(--green)' : 'var(--red)', marginBottom: 10 }}>
                {trendPct >= 0 ? '▲' : '▼'} {Math.abs(trendPct).toFixed(1)}% neto vs. {MESES[prevD.getMonth()]}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: trendPct !== null ? 0 : 10 }}>
              <Mini label="Ingresos" value={money(inc)} color="var(--green)" />
              <Mini label="Gastos" value={money(exp)} color="var(--red)" />
              <Mini label="Neto" value={money(inc - exp)} color="var(--blue)" />
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                <span>Gasto de hoy</span>
                <span className="mono">
                  {money(todayExp)}{s.dailyGoal > 0 ? ` / ${money(s.dailyGoal)}` : ''}
                  <button
                    title="Fijar meta diaria"
                    style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', marginLeft: 4, fontSize: 12 }}
                    onClick={() => setGoalOpen(true)}
                  >✎</button>
                </span>
              </div>
              {s.dailyGoal > 0 && (
                <div style={{ height: 8, borderRadius: 99, background: 'var(--chip)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${goalPct}%`, borderRadius: 99, background: `linear-gradient(90deg, ${goalColor}, ${goalColor}cc)`, transition: 'width .4s' }} />
                </div>
              )}
            </div>

            <div style={{ marginTop: 12, display: 'grid', gap: 5, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)' }}>
                <span>🤝 Te deben</span>
                <b className="mono" style={{ color: 'var(--gold)' }}>+{money(loansOpen)}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)' }}>
                <span>💳 Debes</span>
                <b className="mono" style={{ color: 'var(--red)' }}>-{money(debtsOpen)}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 7, marginTop: 3 }}>
                <span style={{ color: 'var(--muted)' }}>Patrimonio neto</span>
                <b className="mono" style={{ color: netWorth >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(netWorth)}</b>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-around', margin: '18px 6px 2px' }}>
            {acts.map((a) => (
              <button key={a.label} onClick={() => setTab(a.go)} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--text)' }}>
                <div style={{
                  width: 52, height: 52, margin: '0 auto', display: 'grid', placeItems: 'center', fontSize: 20,
                  borderRadius: '50%', background: 'var(--chip)', border: `1px solid ${a.color}55`,
                  boxShadow: `0 8px 24px -12px ${a.color}66`,
                }}>
                  <span style={{ color: a.color, fontWeight: 700 }}>{a.icon}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, textAlign: 'center' }}>{a.label}</div>
              </button>
            ))}
          </div>

          <Card title={period === 'week' ? `Gasto diario por categoría · ${scopeLbl}` : `Ingresos vs gastos · ${scopeLbl}`}>
            {period === 'week' && weekStack.cats.length > 0 ? (
              <>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer>
                    <BarChart data={weekStack.rows} barCategoryGap="28%">
                      <CartesianGrid stroke="var(--grid)" vertical={false} />
                      <XAxis dataKey="d" stroke="#8b9bb8" fontSize={10} />
                      <YAxis stroke="#8b9bb8" fontSize={11} width={34} />
                      <Tooltip contentStyle={tip} cursor={{ fill: 'var(--chip)' }} />
                      {weekStack.cats.map((c, i) => (
                        <Bar key={c} dataKey={c} stackId="a" fill={barColor(c)} radius={i === weekStack.cats.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
                  {weekStack.cats.map((c) => (
                    <span key={c}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 3, background: barColor(c), marginRight: 5 }} />{c}</span>
                  ))}
                </div>
              </>
            ) : byDay.length > 0 ? (
              <div style={{ height: 180 }}>
                <ResponsiveContainer>
                  <AreaChart data={byDay}>
                    <defs>
                      <linearGradient id="gin" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3ee0a7" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#3ee0a7" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gout" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ff6b8a" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#ff6b8a" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--grid)" />
                    <XAxis dataKey="d" stroke="#8b9bb8" fontSize={11} />
                    <YAxis stroke="#8b9bb8" fontSize={11} />
                    <Tooltip contentStyle={tip} />
                    <Area type="monotone" dataKey="in" stroke="#3ee0a7" fill="url(#gin)" name="Ingresos" />
                    <Area type="monotone" dataKey="out" stroke="#ff6b8a" fill="url(#gout)" name="Gastos" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 13, padding: '22px 0', textAlign: 'center' }}>Sin datos en este período</p>
            )}
          </Card>

          <Card title={`Presupuestos de ${mes}`} action={{ label: 'Ajustar', onClick: () => setBudgOpen(true) }}>
            {budgRows.length === 0 && (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>Define un presupuesto mensual por categoría para controlar tus gastos.</p>
            )}
            {budgRows.map((r) => {
              const pct = r.budget > 0 ? Math.min(100, (r.spent / r.budget) * 100) : 0
              const col = pct >= 100 ? 'var(--red)' : pct >= 75 ? 'var(--gold)' : 'var(--green)'
              return (
                <div key={r.c} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span>{CAT_ICON[r.c] || '📦'} {r.c}</span>
                    <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {money(r.spent)}{r.budget > 0 ? ` / ${money(r.budget)}` : ' (sin presupuesto)'}
                    </span>
                  </div>
                  {r.budget > 0 && (
                    <div style={{ height: 7, borderRadius: 99, background: 'var(--chip)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: col, transition: 'width .4s' }} />
                    </div>
                  )}
                </div>
              )
            })}
          </Card>

          <Card title={`Gastos por categoría · ${scopeLbl}`}>
            <div style={{ display: 'flex', minHeight: 150, alignItems: 'center' }}>
              {byCat.length > 0 && (
                <ResponsiveContainer width="44%">
                  <PieChart>
                    <Pie data={byCat} dataKey="value" innerRadius={42} outerRadius={64} paddingAngle={3}>
                      {byCat.map((e) => <Cell key={e.name} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={tip} />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <div style={{ flex: 1, fontSize: 13 }}>
                {byCat.map((c) => (
                  <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 6 }}>
                    <span style={{ color: 'var(--muted)' }}>{CAT_ICON[c.name] || '📦'} {c.name}</span>
                    <span className="mono" style={{ whiteSpace: 'nowrap' }}>{money(c.value)}</span>
                  </div>
                ))}
                {byCat.length === 0 && <div style={{ color: 'var(--muted)' }}>Sin gastos en el período</div>}
              </div>
            </div>
          </Card>

          <Card title={`Saldos P2P (VES+Binance) · ${scopeLbl}`}>
            {p2pSeries.length > 0 ? (
              <div style={{ height: 160 }}>
                <ResponsiveContainer>
                  <BarChart data={p2pSeries}>
                    <CartesianGrid stroke="var(--grid)" />
                    <XAxis dataKey="d" stroke="#8b9bb8" fontSize={10} />
                    <Tooltip contentStyle={tip} cursor={{ fill: 'var(--chip)' }} />
                    <Bar dataKey="ves" stackId="a" fill="#f5c46b" name="Bs en USDT" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="binance" stackId="a" fill="#6ea8ff" name="Binance" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 13, padding: '22px 0', textAlign: 'center' }}>Sin snapshots registrados</p>
            )}
          </Card>

          <Card title="Últimos movimientos" action={{ label: 'Ver todos →', onClick: () => setTab('tx') }}>
            {[...s.txs]
              .sort((a, b) => +new Date(b.date) - +new Date(a.date))
              .slice(0, 4)
              .map((t) => <TxRow key={t.id} t={t} />)}
            {s.txs.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Aún no tienes movimientos</p>}
          </Card>

          <QuickAdd
            onAdd={addTx}
            rate={s.rate}
            onRate={(r) => setS((p) => ({ ...p, rate: r }))}
            templates={s.templates}
            onSaveTemplate={(t) => { setS((p) => ({ ...p, templates: [t, ...p.templates] })); ping('Plantilla guardada') }}
            onDelTemplate={(id) => setS((p) => ({ ...p, templates: p.templates.filter((t) => t.id !== id) }))}
          />

          <button style={dangerBtn} onClick={startFromZero}>
            🗑 Borrar datos de ejemplo y empezar desde cero
          </button>
        </>
      )}

      {tab === 'tx' && (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nota, persona, categoría…" style={input} />
          <div style={{ display: 'flex', gap: 8, margin: '10px 0 10px', overflowX: 'auto' }}>
            {(['all', 'income', 'expense'] as const).map((t) => (
              <button key={t} onClick={() => setTypeF(t)} style={chip(typeF === t)}>{t === 'all' ? 'Todo' : t === 'income' ? 'Ingresos' : 'Gastos'}</button>
            ))}
            <select value={catF} onChange={(e) => setCatF(e.target.value)} style={{ ...chip(false), background: 'transparent', color: 'inherit' }}>
              <option value="all">Categorías</option>
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {persons.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto' }}>
              <button onClick={() => setPersonF('')} style={chip(personF === '')}>Todos</button>
              {persons.map((p) => (
                <button key={p} onClick={() => setPersonF(personF === p ? '' : p)} style={chip(personF === p)}>👤 {p}</button>
              ))}
            </div>
          )}
          <QuickAdd
            onAdd={addTx}
            rate={s.rate}
            onRate={(r) => setS((p) => ({ ...p, rate: r }))}
            templates={s.templates}
            onSaveTemplate={(t) => { setS((p) => ({ ...p, templates: [t, ...p.templates] })); ping('Plantilla guardada') }}
            onDelTemplate={(id) => setS((p) => ({ ...p, templates: p.templates.filter((t) => t.id !== id) }))}
          />
          {txs.length === 0 && <p style={{ color: 'var(--muted)', marginTop: 16, textAlign: 'center' }}>Sin movimientos en este período</p>}
          {txs.map((t) => (
            <TxRow key={t.id} t={t} onEdit={() => setEditTx(t)} onDel={() => delTx(t.id)} />
          ))}
        </>
      )}

      {tab === 'p2p' && (
        <>
          <p style={{ color: 'var(--muted)', marginBottom: 12, fontSize: 14 }}>
            Cada día registra apertura y cierre: Bs en cuentas (convertidos a USDT con la tasa del momento) y USDT en Binance.
          </p>
          <SnapForm rate={s.rate} onSave={(sn, r) => { setS((p) => ({ ...p, rate: r, snaps: [sn, ...p.snaps] })); ping(`Snapshot guardado · tasa ${r} Bs`) }} />
          {recon && (
            <div style={{
              ...card, marginTop: 12,
              borderColor: Math.abs(recon.diff) < 0.5 ? 'rgba(62,224,167,.35)' : 'rgba(245,196,107,.35)',
              background: Math.abs(recon.diff) < 0.5 ? 'rgba(62,224,167,.07)' : 'rgba(245,196,107,.07)',
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 20 }}>{Math.abs(recon.diff) < 0.5 ? '✅' : '⚖️'}</span>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 14 }}>Conciliación</b>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Saldo real {money(recon.actual)} vs. esperado {money(recon.expected)} (+movimientos)
                  </div>
                </div>
                <div className="mono" style={{ fontWeight: 700, color: Math.abs(recon.diff) < 0.5 ? 'var(--green)' : 'var(--gold)', fontSize: 14 }}>
                  {recon.diff >= 0 ? '+' : ''}{money(recon.diff)}
                </div>
              </div>
              {Math.abs(recon.diff) >= 0.5 && (
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                  Hay movimientos sin registrar entre el {new Date(recon.from).toLocaleDateString('es-VE')} y el {new Date(recon.to).toLocaleDateString('es-VE')}, o el snapshot tiene un monto distinto. Revísalos.
                </p>
              )}
            </div>
          )}
          {s.snaps.length === 0 && <p style={{ color: 'var(--muted)', marginTop: 16, textAlign: 'center' }}>Aún no hay snapshots</p>}
          {[...s.snaps].sort((a, b) => +new Date(b.date) - +new Date(a.date)).map((sn) => (
            <div key={sn.id} style={row}>
              <div style={{ width: 42, height: 42, borderRadius: 14, background: 'rgba(110,168,255,.1)', display: 'grid', placeItems: 'center', fontSize: 18 }}>
                {sn.session === 'open' ? '🌅' : '🌙'}
              </div>
              <div style={{ flex: 1 }}>
                <b>{sn.session === 'open' ? 'Apertura' : 'Cierre'}</b>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {new Date(sn.date).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' })}{sn.rate ? ` · tasa ${sn.rate} Bs` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>
                <div className="mono">{money(sn.vesInUsdt)} <span style={{ color: 'var(--muted)', fontSize: 11 }}>({sn.ves.toLocaleString('es-VE')} Bs)</span></div>
                <div className="mono" style={{ color: 'var(--blue)' }}>Binance {money(sn.binanceUsdt)}</div>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'scan' && (
        review ? (
          <ReviewForm
            r={review}
            rate={s.rate}
            onCancel={() => setReview(null)}
            onSave={(partial, newRate) => {
              if (newRate && newRate !== s.rate) setS((p) => ({ ...p, rate: newRate }))
              addTx(partial)
              setReview(null)
            }}
          />
        ) : (
          <div style={{ ...hero, textAlign: 'center' }}>
            <h2>Escanear factura o captura</h2>
            <p style={{ color: 'var(--muted)', margin: '10px 0 18px', fontSize: 14 }}>
              Toma foto a un recibo o captura. El OCR detecta el monto; si está en <b>Bs</b> te preguntamos el precio actual del USDT y lo convertimos automáticamente.
            </p>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onScan(f, 'tx')
              e.target.value = ''
            }} />
            <button style={btn} onClick={() => fileRef.current?.click()}>📷 Foto de factura (Bs o USDT)</button>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span style={{ ...btn, display: 'inline-block', background: 'transparent', border: '1px solid var(--line)', color: 'var(--text)' }}>Captura P2P / saldos</span>
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onScan(f, 'p2p'); e.target.value = '' }} />
            </label>
            {busy && <p style={{ marginTop: 16, color: 'var(--gold)' }}>{busy}</p>}
          </div>
        )
      )}

      {tab === 'mas' && (
        <>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Más opciones</h2>
          {([
            ['loans', '🤝', 'Préstamos y deudas', 'Quién te debe, a quién debes, cobros y pagos'],
            ['bills', '📅', 'Gastos fijos', 'Celular, internet, alquiler… con recordatorios de pago'],
            ['rep', '📄', 'Reportes', 'Resumen del período exportable a PDF y Excel'],
            ['tg', '✈️', 'Telegram', 'Sincroniza movimientos desde tu canal'],
          ] as const).map(([go, icon, title, desc]) => (
            <button key={go} onClick={() => setTab(go)} style={{ ...row, width: '100%', textAlign: 'left', cursor: 'pointer', color: 'var(--text)', border: '1px solid var(--line)' }}>
              <div style={{ width: 46, height: 46, borderRadius: 16, background: 'rgba(110,168,255,.12)', display: 'grid', placeItems: 'center', fontSize: 20 }}>{icon}</div>
              <div style={{ flex: 1 }}>
                <b>{title}</b>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{desc}</div>
              </div>
              <span style={{ color: 'var(--muted)' }}>›</span>
            </button>
          ))}

          <Card title="Nube · Sincronización">
            {sbUser ? (
              <>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                  Conectado como <b style={{ color: 'var(--text)' }}>{sbUser.email}</b>
                </p>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                  {syncSt === 'saving' && '⏳ Subiendo cambios…'}
                  {syncSt === 'saved' && '☁️ Todo sincronizado · cada cambio se sube solo'}
                  {syncSt === 'error' && '⚠️ Sin conexión con la nube · se reintenta con cada cambio'}
                  {syncSt === 'off' && '☁️ Listo para sincronizar'}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={chip(false)} onClick={pullNow}>⬇️ Traer de la nube</button>
                  <button style={chip(false)} onClick={pushNow}>⬆️ Subir ahora</button>
                  <button style={chip(false)} onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                  Entra con tu correo para tener <b>respaldo automático</b> y tus mismos datos en todos tus dispositivos. Sin contraseña: te llega un enlace mágico.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="email"
                    placeholder="tu@correo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMagic()}
                    style={{ ...input, flex: 1 }}
                  />
                  <button style={{ ...btn, whiteSpace: 'nowrap' }} onClick={sendMagic}>✈️ Entrar</button>
                </div>
              </>
            )}
          </Card>

          <Card title="Respaldo">
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              Tus datos viven solo en este navegador. Descarga un respaldo para no perderlos.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ ...btn, flex: 1 }} onClick={exportBackup}>💾 Exportar JSON</button>
              <button style={{ ...btn, flex: 1, background: 'transparent', border: '1px solid var(--line)', color: 'var(--text)' }} onClick={() => importRef.current?.click()}>
                📥 Restaurar
              </button>
              <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importBackup(f)
                e.target.value = ''
              }} />
            </div>
          </Card>

          <Card title="Apariencia">
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={chip(s.theme !== 'light')} onClick={() => setS((p) => ({ ...p, theme: 'dark' }))}>🌙 Oscuro</button>
              <button style={chip(s.theme === 'light')} onClick={() => setS((p) => ({ ...p, theme: 'light' }))}>☀️ Claro</button>
            </div>
          </Card>

          <Card title="Seguridad">
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              {s.pinHash ? '🔒 La app pide un PIN al abrirse.' : 'Sin bloqueo. Activa un PIN para proteger tus datos.'}
            </p>
            <button style={{ ...btn, width: '100%' }} onClick={() => setPinOpen(true)}>
              {s.pinHash ? 'Quitar PIN' : 'Activar PIN'}
            </button>
          </Card>
        </>
      )}

      {tab === 'loans' && (
        <>
          <BackBtn onClick={() => setTab('mas')} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button style={chip(ldTab === 'owed')} onClick={() => setLdTab('owed')}>🤝 Me deben</button>
            <button style={chip(ldTab === 'owe')} onClick={() => setLdTab('owe')}>💳 Debo</button>
          </div>

          {ldTab === 'owed' && (
            <>
              <LoanForm onSave={(l) => setS((p) => ({ ...p, loans: [l, ...p.loans] }))} />
              {s.loans.length === 0 && <p style={{ color: 'var(--muted)', marginTop: 16, textAlign: 'center' }}>Nadie te debe 🎉</p>}
              {s.loans.map((l) => (
                <div key={l.id} style={row}>
                  <div style={{ width: 42, height: 42, borderRadius: 14, background: 'rgba(245,196,107,.12)', display: 'grid', placeItems: 'center', fontSize: 18 }}>🤝</div>
                  <div style={{ flex: 1 }}>
                    <b>{l.person}</b>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{l.note} · {new Date(l.date).toLocaleDateString('es-VE')}</div>
                  </div>
                  <div className="mono" style={{ color: l.status === 'open' ? 'var(--gold)' : 'var(--green)', fontSize: 13 }}>{money(l.amountUsd)}</div>
                  {l.status === 'open' && (
                    <button style={chip(true)} onClick={() => setS((p) => ({
                      ...p,
                      loans: p.loans.map((x) => x.id === l.id ? { ...x, status: 'paid', paidDate: new Date().toISOString() } : x),
                      txs: [{ id: uid(), type: 'income', amountUsd: l.amountUsd, category: 'Préstamos', note: `Devolución ${l.person}`, date: new Date().toISOString(), source: 'manual', person: l.person, rateVes: p.rate }, ...p.txs],
                    }))}>Cobrado</button>
                  )}
                </div>
              ))}
            </>
          )}

          {ldTab === 'owe' && (
            <>
              <DebtForm onSave={(d) => { setS((p) => ({ ...p, debts: [d, ...p.debts] })); ping('Deuda registrada') }} />
              {debtsOpen > 0 && (
                <div style={{ ...card, marginTop: 12, borderColor: 'rgba(255,107,138,.3)', background: 'rgba(255,107,138,.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>Total que debes</span>
                  <b className="mono" style={{ color: 'var(--red)' }}>{money(debtsOpen)}</b>
                </div>
              )}
              {s.debts.length === 0 && <p style={{ color: 'var(--muted)', marginTop: 16, textAlign: 'center' }}>No debes nada 🎉</p>}
              {[...s.debts]
                .sort((a, b) => (a.status === b.status ? +new Date(b.date) - +new Date(a.date) : a.status === 'open' ? -1 : 1))
                .map((d) => (
                  <div key={d.id} style={{ ...row, opacity: d.status === 'paid' ? 0.55 : 1 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 14, background: 'rgba(255,107,138,.12)', display: 'grid', placeItems: 'center', fontSize: 18 }}>💳</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{d.name}</b>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {d.status === 'paid' ? '✅ Pagada' : 'Pendiente'}{d.note ? ` · ${d.note}` : ''} · {new Date(d.date).toLocaleDateString('es-VE')}
                      </div>
                    </div>
                    <div className="mono" style={{ color: d.status === 'open' ? 'var(--red)' : 'var(--green)', fontSize: 13 }}>{money(d.amountUsd)}</div>
                    {d.status === 'open' && (
                      <button style={chip(true)} title="Marcar como pagada (registra el gasto)" onClick={() => setS((p) => ({
                        ...p,
                        debts: p.debts.map((x) => x.id === d.id ? { ...x, status: 'paid', paidDate: new Date().toISOString() } : x),
                        txs: [{ id: uid(), type: 'expense', amountUsd: d.amountUsd, category: 'Deudas', note: `Pago deuda · ${d.name}`, date: new Date().toISOString(), source: 'manual', person: d.name, rateVes: p.rate }, ...p.txs],
                      }))}>Pagada</button>
                    )}
                    <button style={delBtn} title="Eliminar deuda" onClick={() => setConfirm({
                      title: 'Eliminar deuda',
                      msg: `¿Eliminar "${d.name}" (${money(d.amountUsd)})? Esto no crea ningún movimiento.`,
                      onYes: () => { setS((p) => ({ ...p, debts: p.debts.filter((x) => x.id !== d.id) })); ping('Deuda eliminada') },
                    })}>✕</button>
                  </div>
                ))}
            </>
          )}
        </>
      )}

      {tab === 'bills' && (
        <>
          <BackBtn onClick={() => setTab('mas')} />

          <div style={hero}>
            <h2 style={{ fontSize: 18 }}>📅 Gastos fijos · {mes}</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 12px' }}>
              Pagos con fecha fija. Te aviso desde los días que elijas y <b>sigo recordándote hasta que los marques como pagados</b>.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Mini label="Pendientes este mes" value={`${billsPendingMonth.length} · ${money(billsPendingTotal)}`} color="var(--red)" />
              <Mini label="Pagados" value={`${s.recurring.length - billsPendingMonth.length} · ${money(s.recurring.reduce((a, b) => a + (b.paidMonths[curKey] ? b.amountUsd : 0), 0))}`} color="var(--green)" />
            </div>
            {'Notification' in window && Notification.permission === 'default' && (
              <button style={{ ...btn, width: '100%', marginTop: 12 }} onClick={async () => {
                const p = await Notification.requestPermission()
                ping(p === 'granted' ? 'Notificaciones activadas 🔔' : 'Notificaciones bloqueadas por el navegador')
                if (p === 'granted') notifiedRef.current = false
              }}>🔔 Activar notificaciones de pago</button>
            )}
            {'Notification' in window && Notification.permission === 'granted' && (
              <p style={{ fontSize: 12, color: 'var(--green)', marginTop: 10 }}>🔔 Notificaciones activas · te aviso al abrir la app cuando haya pagos pendientes</p>
            )}
            {'Notification' in window && Notification.permission === 'denied' && (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>🔕 Tu navegador bloqueó las notificaciones. El banner del Home seguirá avisándote. (Actívalas en los ajustes del navegador)</p>
            )}
          </div>

          <BillForm onSave={(b) => { setS((p) => ({ ...p, recurring: [b, ...p.recurring] })); ping('Gasto fijo agregado') }} />

          {s.recurring.length === 0 && <p style={{ color: 'var(--muted)', marginTop: 16, textAlign: 'center' }}>Sin gastos fijos. Agrega celular, internet, alquiler…</p>}
          {[...s.recurring]
            .sort((a, b) => {
              const sa = billState(a, now)
              const sb = billState(b, now)
              const rank = { overdue: 0, due: 1, upcoming: 2, paid: 3 } as const
              return rank[sa.state] - rank[sb.state] || (sa.diff - sb.diff)
            })
            .map((b) => {
              const st = billState(b, now)
              return (
                <div key={b.id} style={{ ...row, opacity: st.state === 'paid' ? 0.6 : 1 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 14, background: 'rgba(110,168,255,.12)', display: 'grid', placeItems: 'center', fontSize: 18, flexShrink: 0 }}>
                    {CAT_ICON[b.category] || '🔁'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{b.name}</b>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Cada día {b.dayOfMonth} · {b.note || b.category}
                      {b.remind ? ` · 🔔 ${b.remindDaysBefore === 0 ? 'el mismo día' : `${b.remindDaysBefore}d antes`}` : ' · 🔕 sin aviso'}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 3, color:
                      st.state === 'overdue' ? 'var(--red)' : st.state === 'due' ? 'var(--gold)' : st.state === 'paid' ? 'var(--green)' : 'var(--muted)' }}>
                      {st.state === 'paid' && '✅ Pagado este mes'}
                      {st.state === 'overdue' && `⚠️ Vencido hace ${-st.diff} día${st.diff === -1 ? '' : 's'}`}
                      {st.state === 'due' && '⏰ Vence hoy'}
                      {st.state === 'upcoming' && `Vence en ${st.diff} día${st.diff === 1 ? '' : 's'}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', display: 'grid', gap: 6, justifyItems: 'end' }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{money(b.amountUsd)}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {st.state !== 'paid' ? (
                        <button style={chip(true)} onClick={() => setS((p) => {
                          const txId = uid()
                          return {
                            ...p,
                            recurring: p.recurring.map((x) => x.id === b.id ? { ...x, paidMonths: { ...x.paidMonths, [curKey]: txId } } : x),
                            txs: [{ id: txId, type: 'expense', amountUsd: b.amountUsd, category: b.category, note: `Pago fijo · ${b.name}`, date: new Date().toISOString(), source: 'manual', person: b.name, rateVes: p.rate }, ...p.txs],
                          }
                        })}>Pagar</button>
                      ) : (
                        <button style={chip(false)} title="Quitar marca de pagado" onClick={() => setConfirm({
                          title: 'Desmarcar pago',
                          msg: `Volverás a ver "${b.name}" como pendiente y se eliminará el movimiento de pago generado.`,
                          onYes: () => setS((p) => ({
                            ...p,
                            recurring: p.recurring.map((x) => {
                              if (x.id !== b.id) return x
                              const pm = { ...x.paidMonths }
                              delete pm[curKey]
                              return { ...x, paidMonths: pm }
                            }),
                            txs: st.paidTx ? p.txs.filter((t) => t.id !== st.paidTx) : p.txs,
                          })),
                        })}>↩️</button>
                      )}
                      <button style={chip(false)} title={b.remind ? 'Silenciar aviso' : 'Activar aviso'} onClick={() => setS((p) => ({
                        ...p, recurring: p.recurring.map((x) => x.id === b.id ? { ...x, remind: !x.remind } : x),
                      }))}>{b.remind ? '🔔' : '🔕'}</button>
                      <button style={delBtn} title="Eliminar gasto fijo" onClick={() => setConfirm({
                        title: 'Eliminar gasto fijo',
                        msg: `¿Eliminar "${b.name}" (${money(b.amountUsd)}/mes)? Los movimientos de pagos ya hechos no se borran.`,
                        onYes: () => { setS((p) => ({ ...p, recurring: p.recurring.filter((x) => x.id !== b.id) })); ping('Gasto fijo eliminado') },
                      })}>✕</button>
                    </div>
                  </div>
                </div>
              )
            })}
        </>
      )}

      {tab === 'rep' && (
        <>
          <BackBtn onClick={() => setTab('mas')} />
          <div style={hero}>
            <h2>Reportes</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: '8px 0 4px' }}>
              Alcance: <b style={{ color: 'var(--text)' }}>{scopeLbl}</b> · {repTxs.length} movimientos
            </p>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
              Ajusta el período y la semana con los filtros de arriba antes de exportar.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
              <Mini label="Ingresos" value={money(repInc)} color="var(--green)" />
              <Mini label="Gastos" value={money(repExp)} color="var(--red)" />
              <Mini label="Neto" value={money(repInc - repExp)} color="var(--blue)" />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ ...btn, flex: 1, opacity: exporting ? 0.6 : 1 }} disabled={!!exporting} onClick={() => onExport('pdf')}>
                {exporting === 'pdf' ? 'Generando…' : '📄 Exportar PDF'}
              </button>
              <button
                style={{ ...btn, flex: 1, background: 'rgba(62,224,167,.15)', color: 'var(--green)', border: '1px solid rgba(62,224,167,.3)', opacity: exporting ? 0.6 : 1 }}
                disabled={!!exporting}
                onClick={() => onExport('xlsx')}
              >
                {exporting === 'xlsx' ? 'Generando…' : '📊 Exportar Excel'}
              </button>
            </div>
          </div>
          <Card title="El reporte incluye">
            <ul style={{ fontSize: 13, color: 'var(--muted)', paddingLeft: 18, lineHeight: 1.9 }}>
              <li>Resumen del período: ingresos, gastos, neto, patrimonio neto</li>
              <li>Detalle de movimientos con la tasa Bs/USDT de cada momento</li>
              <li>Gastos por categoría</li>
              <li>Snapshots P2P (aperturas y cierres)</li>
              <li>Préstamos (te deben) y deudas (tú debes)</li>
            </ul>
          </Card>
        </>
      )}

      {tab === 'tg' && (
        <>
          <BackBtn onClick={() => setTab('mas')} />
          <div style={hero}>
            <h2>Telegram</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: '8px 0 14px' }}>
              Crea un bot con @BotFather, pega el token. En tu canal escribe:
              <br /><code className="mono">apertura ves:18500 usdt:194 binance:320</code>
              <br /><code className="mono">gasto 3.40 almuerzo</code>
            </p>
            <input placeholder="Bot token" value={s.telegram.token} onChange={(e) => setS({ ...s, telegram: { ...s.telegram, token: e.target.value } })} style={input} />
            <input placeholder="Tasa USDT/Bs" type="number" value={s.rate} onChange={(e) => setS({ ...s, rate: +e.target.value })} style={{ ...input, marginTop: 8 }} />
            <button style={{ ...btn, marginTop: 12 }} onClick={pollTelegram}>Sincronizar canal</button>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>Chat ID: {s.telegram.chatId || '—'}</p>
          </div>
        </>
      )}

      {/* ---------- Modales ---------- */}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>{confirm.msg}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{ ...dangerBtn, marginTop: 0, flex: 1 }} onClick={() => { confirm.onYes(); setConfirm(null) }}>Confirmar</button>
            <button style={{ ...btn, background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)', flex: 1 }} onClick={() => setConfirm(null)}>Cancelar</button>
          </div>
        </Modal>
      )}

      {goalOpen && (
        <Modal title="Meta diaria de gasto" onClose={() => setGoalOpen(false)}>
          <GoalForm
            initial={s.dailyGoal}
            onSave={(v) => {
              setS((p) => ({ ...p, dailyGoal: v }))
              setGoalOpen(false)
              ping(v > 0 ? 'Meta diaria actualizada' : 'Meta eliminada')
            }}
          />
        </Modal>
      )}

      {budgOpen && (
        <Modal title={`Presupuestos mensuales (USDT)`} onClose={() => setBudgOpen(false)}>
          <BudgetForm
            initial={s.budgets}
            onSave={(b) => {
              setS((p) => ({ ...p, budgets: b }))
              setBudgOpen(false)
              ping('Presupuestos guardados')
            }}
          />
        </Modal>
      )}

      {editTx && (
        <Modal title="Editar movimiento" onClose={() => setEditTx(null)}>
          <EditTxForm
            tx={editTx}
            rate={s.rate}
            onSave={(t) => {
              setS((p) => ({ ...p, txs: p.txs.map((x) => (x.id === t.id ? t : x)) }))
              setEditTx(null)
              ping('Movimiento actualizado')
            }}
          />
        </Modal>
      )}

      {pinOpen && (
        <Modal title={s.pinHash ? 'Quitar PIN' : 'Activar PIN'} onClose={() => setPinOpen(false)}>
          <PinForm
            hasPin={!!s.pinHash}
            pinHash={s.pinHash}
            onSet={async (pin) => {
              const h = await hashPin(pin)
              setS((p) => ({ ...p, pinHash: h }))
              setPinOpen(false)
              ping('PIN activado')
            }}
            onRemove={() => {
              setS((p) => {
                const n = { ...p }
                delete n.pinHash
                return n
              })
              setPinOpen(false)
              ping('PIN desactivado')
            }}
          />
        </Modal>
      )}

      {cloudAsk && (
        <Modal title="☁️ Datos en la nube" onClose={() => setCloudAsk(null)}>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 6 }}>
            Encontramos datos guardados el{' '}
            <b style={{ color: 'var(--text)' }}>{new Date(cloudAsk.updatedAt).toLocaleString('es-VE')}</b>:
          </p>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
            {cloudAsk.remote.txs.length} movimientos · {cloudAsk.remote.snaps.length} snapshots · {cloudAsk.remote.loans.length} préstamos
          </p>
          <button style={{ ...btn, width: '100%' }} onClick={() => {
            setS(cloudAsk.remote)
            setCloudAsk(null)
            ping('Restaurado desde la nube ☁️')
          }}>
            ☁️ Usar los datos de la nube
          </button>
          <button
            style={{ ...btn, width: '100%', marginTop: 8, background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)' }}
            onClick={() => setCloudAsk(null)}
          >
            📱 Mantener los de este dispositivo
          </button>
        </Modal>
      )}

      <nav style={nav}>
        {navItems.map(({ k, icon, l }) => (
          k === 'scan' ? (
            <button key={k} onClick={() => setTab(k)} style={{ background: 'none', border: 0, cursor: 'pointer', transform: 'translateY(-14px)' }}>
              <div style={{
                width: 54, height: 54, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 22,
                background: 'linear-gradient(135deg,#6ea8ff,#a78bfa)',
                boxShadow: tab === 'scan' ? '0 10px 26px -6px rgba(110,168,255,.8)' : '0 8px 20px -8px rgba(110,168,255,.5)',
                border: '4px solid var(--bg)',
              }}>{icon}</div>
            </button>
          ) : (
            <button key={k} onClick={() => setTab(k)} style={{ background: 'none', border: 0, cursor: 'pointer', color: navActive(k) ? 'var(--text)' : 'var(--muted)' }}>
              <div style={{ fontSize: 20, opacity: navActive(k) ? 1 : 0.6 }}>{icon}</div>
              <div style={{ fontWeight: 600, fontSize: 10, marginTop: 2 }}>{l}</div>
            </button>
          )
        ))}
      </nav>
      {toast && <div style={toastSt}>{toast}</div>}
    </div>
  )
}

/* ---------- Componentes ---------- */

function TxRow({ t, onEdit, onDel }: { t: Transaction; onEdit?: () => void; onDel?: () => void }) {
  const vesEq = t.amountVes ?? (t.rateVes ? t.amountUsd * t.rateVes : 0)
  return (
    <div style={row}>
      <button
        onClick={onEdit}
        style={{ background: 'none', border: 0, padding: 0, display: 'flex', gap: 10, alignItems: 'center', flex: 1, minWidth: 0, cursor: onEdit ? 'pointer' : 'default', color: 'var(--text)', textAlign: 'left' }}
      >
        <div style={{
          width: 42, height: 42, borderRadius: 14, flexShrink: 0, fontSize: 18, display: 'grid', placeItems: 'center',
          background: t.type === 'income' ? 'rgba(62,224,167,.12)' : 'rgba(255,107,138,.12)',
        }}>
          {CAT_ICON[t.category] || '📦'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.note || t.category}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {t.person ? `${t.person} · ` : ''}{t.category} · {new Date(t.date).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' })}
          </div>
          {t.receipt && (
            <a href={t.receipt} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, color: 'var(--blue)' }}>
              📎 ver captura
            </a>
          )}
        </div>
      </button>
      <div style={{ textAlign: 'right' }}>
        <div className="mono" style={{ color: t.type === 'income' ? 'var(--green)' : 'var(--red)', fontWeight: 600, whiteSpace: 'nowrap', fontSize: 13 }}>
          {t.type === 'income' ? '+' : '-'}{money(t.amountUsd)}
        </div>
        {t.rateVes ? (
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {ves(vesEq)} @{t.rateVes}
          </div>
        ) : null}
      </div>
      {onDel && <button style={delBtn} title="Eliminar movimiento" onClick={onDel}>✕</button>}
    </div>
  )
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 13, marginBottom: 12, padding: 0 }}>
      ← Volver
    </button>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function GoalForm({ initial, onSave }: { initial: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(initial > 0 ? String(initial) : '')
  return (
    <>
      <label style={lbl}>¿Cuánto quieres gastar máximo por día? (USDT)</label>
      <input className="mono" inputMode="decimal" placeholder="Ej: 20" value={v} onChange={(e) => setV(e.target.value)} style={input} autoFocus />
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button style={{ ...btn, flex: 1 }} onClick={() => onSave(toNum(v))}>Guardar</button>
        {initial > 0 && (
          <button style={{ ...btn, background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)' }} onClick={() => onSave(0)}>Quitar meta</button>
        )}
      </div>
    </>
  )
}

function BudgetForm({ initial, onSave }: { initial: Record<string, number>; onSave: (b: Record<string, number>) => void }) {
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(CATS.map((c) => [c, initial[c] ? String(initial[c]) : ''])),
  )
  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Deja en blanco (o 0) las categorías sin presupuesto.</p>
      {CATS.map((c) => (
        <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ flex: 1, fontSize: 14 }}>{CAT_ICON[c] || '📦'} {c}</span>
          <input
            className="mono"
            inputMode="decimal"
            placeholder="0"
            value={vals[c]}
            onChange={(e) => setVals((p) => ({ ...p, [c]: e.target.value }))}
            style={{ ...input, width: 110, padding: '8px 10px' }}
          />
        </div>
      ))}
      <button style={{ ...btn, width: '100%', marginTop: 6 }} onClick={() => {
        const out: Record<string, number> = {}
        for (const c of CATS) {
          const v = toNum(vals[c] || '0')
          if (v > 0) out[c] = v
        }
        onSave(out)
      }}>Guardar presupuestos</button>
    </>
  )
}

function EditTxForm({ tx, rate, onSave }: { tx: Transaction; rate: number; onSave: (t: Transaction) => void }) {
  const [kind, setKind] = useState<'income' | 'expense'>(tx.type === 'income' ? 'income' : 'expense')
  const [amt, setAmt] = useState(String(tx.amountUsd))
  const [rateStr, setRateStr] = useState(String(tx.rateVes || rate))
  const [cat, setCat] = useState(tx.category)
  const [note, setNote] = useState(tx.note)
  const [person, setPerson] = useState(tx.person || '')
  const n = toNum(amt)
  const rr = toNum(rateStr)
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button style={chip(kind === 'expense')} onClick={() => setKind('expense')}>Gasto</button>
        <button style={chip(kind === 'income')} onClick={() => setKind('income')}>Ingreso</button>
      </div>
      <label style={lbl}>Monto (USDT)</label>
      <input className="mono" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} style={input} autoFocus />
      <label style={{ ...lbl, marginTop: 10 }}>Tasa Bs/USDT registrada</label>
      <input className="mono" inputMode="decimal" value={rateStr} onChange={(e) => setRateStr(e.target.value)} style={input} />
      {n > 0 && rr > 0 && (
        <div className="mono" style={{ fontSize: 12, color: 'var(--gold)', marginTop: 6 }}>≈ {ves(n * rr)} @{rr}</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={input}>
          {CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input placeholder="Persona (opcional)" value={person} onChange={(e) => setPerson(e.target.value)} style={input} />
      </div>
      <input placeholder="Nota" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...input, marginTop: 8 }} />
      <button style={{ ...btn, width: '100%', marginTop: 12, opacity: n > 0 ? 1 : 0.5 }} disabled={!(n > 0)} onClick={() => {
        onSave({
          ...tx,
          type: kind,
          amountUsd: n,
          rateVes: rr || undefined,
          amountVes: rr ? +(n * rr).toFixed(2) : undefined,
          category: cat,
          note,
          person: person || undefined,
        })
      }}>Guardar cambios</button>
    </>
  )
}

function PinForm({ hasPin, pinHash, onSet, onRemove }: {
  hasPin: boolean
  pinHash?: string
  onSet: (pin: string) => void
  onRemove: () => void
}) {
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [err, setErr] = useState('')
  const valid = /^\d{4,8}$/.test(pin)
  return (
    <>
      {hasPin ? (
        <>
          <label style={lbl}>Ingresa tu PIN actual para quitarlo</label>
          <input className="mono" type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => { setPin(e.target.value); setErr('') }} style={input} autoFocus />
          {err && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{err}</p>}
          <button style={{ ...btn, width: '100%', marginTop: 12, opacity: valid ? 1 : 0.5 }} disabled={!valid} onClick={async () => {
            if ((await hashPin(pin)) === pinHash) onRemove()
            else { setErr('PIN incorrecto'); setPin('') }
          }}>Quitar PIN</button>
        </>
      ) : (
        <>
          <label style={lbl}>Nuevo PIN (4–8 dígitos)</label>
          <input className="mono" type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => { setPin(e.target.value); setErr('') }} style={input} autoFocus />
          <label style={{ ...lbl, marginTop: 10 }}>Repite el PIN</label>
          <input className="mono" type="password" inputMode="numeric" maxLength={8} value={pin2} onChange={(e) => { setPin2(e.target.value); setErr('') }} style={input} />
          {err && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{err}</p>}
          <button style={{ ...btn, width: '100%', marginTop: 12, opacity: valid ? 1 : 0.5 }} disabled={!valid} onClick={() => {
            if (pin !== pin2) return setErr('Los PIN no coinciden')
            onSet(pin)
          }}>Activar bloqueo</button>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
            Nota: el PIN protege la vista de la app en este dispositivo. Guárdalo bien; si lo olvidas tendrás que borrar los datos del navegador.
          </p>
        </>
      )}
    </>
  )
}

function LockScreen({ pinHash, onOk }: { pinHash: string; onOk: () => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  const tryUnlock = async () => {
    if ((await hashPin(pin)) === pinHash) onOk()
    else { setErr(true); setPin('') }
  }
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ ...card, width: '100%', maxWidth: 340, textAlign: 'center' }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>🔒</div>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>MoneyControl</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 16px' }}>Ingresa tu PIN para continuar</p>
        <input
          className="mono"
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin}
          autoFocus
          onChange={(e) => { setPin(e.target.value); setErr(false) }}
          onKeyDown={(e) => e.key === 'Enter' && tryUnlock()}
          style={{ ...input, textAlign: 'center', fontSize: 22, letterSpacing: 8 }}
        />
        {err && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>PIN incorrecto</p>}
        <button style={{ ...btn, width: '100%', marginTop: 14 }} onClick={tryUnlock}>Desbloquear</button>
      </div>
    </div>
  )
}

/** Confirmación de factura escaneada: convierte Bs → USDT preguntando el precio actual */
function ReviewForm({ r, rate, onSave, onCancel }: {
  r: Review
  rate: number
  onSave: (t: Partial<Transaction> & { type: Transaction['type']; amountUsd: number }, rate: number) => void
  onCancel: () => void
}) {
  const guessVes = r.amount > 500
  const [amt, setAmt] = useState(String(r.amount))
  const [curr, setCurr] = useState<'VES' | 'USD'>(guessVes ? 'VES' : 'USD')
  const [rateStr, setRateStr] = useState(String(rate))
  const [cat, setCat] = useState(CATS.includes(r.category) ? r.category : 'Otros')
  const [kind, setKind] = useState<'income' | 'expense'>(r.isIncome ? 'income' : 'expense')
  const [note, setNote] = useState(r.text.split('\n').filter(Boolean).slice(0, 2).join(' · ').slice(0, 80))
  const n = toNum(amt)
  const rr = toNum(rateStr) || rate || 0
  const usdtEq = curr === 'VES' ? (rr ? n / rr : 0) : n
  const vesEq = curr === 'VES' ? n : n * rr

  return (
    <div style={hero}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ fontSize: 17 }}>Confirmar factura</h2>
        <button onClick={onCancel} style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button style={chip(kind === 'expense')} onClick={() => setKind('expense')}>Gasto</button>
        <button style={chip(kind === 'income')} onClick={() => setKind('income')}>Ingreso</button>
        <div style={{ flex: 1 }} />
        <button style={chip(curr === 'VES')} onClick={() => setCurr('VES')}>Bs</button>
        <button style={chip(curr === 'USD')} onClick={() => setCurr('USD')}>USDT</button>
      </div>

      <label style={lbl}>Monto detectado ({curr === 'VES' ? 'Bs' : 'USDT'}) — editable</label>
      <input className="mono" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} style={input} />

      <label style={{ ...lbl, marginTop: 10 }}>Precio actual del USDT (Bs)</label>
      <input className="mono" inputMode="decimal" placeholder="Ej: 220.50" value={rateStr} onChange={(e) => setRateStr(e.target.value)} style={input} />

      {n > 0 && rr > 0 && (
        <div style={{ marginTop: 12, background: 'var(--well)', borderRadius: 14, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>Se registrará</span>
            <b className="mono" style={{ color: kind === 'income' ? 'var(--green)' : 'var(--red)' }}>{money(usdtEq)}</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
            <span style={{ color: 'var(--muted)' }}>Equivalente</span>
            <span className="mono" style={{ color: 'var(--gold)' }}>{ves(vesEq)} @{rr}</span>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={input}>
          {CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input placeholder="Nota" value={note} onChange={(e) => setNote(e.target.value)} style={input} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button style={{ ...btn, flex: 1, opacity: n > 0 && rr > 0 ? 1 : 0.5 }} disabled={!(n > 0 && rr > 0)} onClick={() => {
          onSave({
            type: kind,
            amountUsd: +usdtEq.toFixed(4),
            amountVes: +vesEq.toFixed(2),
            rateVes: rr,
            category: cat,
            note,
            source: 'ocr',
            receipt: r.url,
          }, rr)
        }}>Registrar en USDT</button>
        <button style={{ ...btn, background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)' }} onClick={onCancel}>Descartar</button>
      </div>
    </div>
  )
}

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'var(--well)', borderRadius: 14, padding: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div className="mono" style={{ color, fontWeight: 600, fontSize: 12 }}>{value}</div>
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: { label: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <section style={{ ...card, marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>{title}</h3>
        {action && (
          <button onClick={action.onClick} style={{ background: 'none', border: 0, color: 'var(--blue)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function QuickAdd({ onAdd, rate, onRate, templates, onSaveTemplate, onDelTemplate }: {
  onAdd: (t: any) => void
  rate: number
  onRate: (r: number) => void
  templates: Template[]
  onSaveTemplate: (t: Template) => void
  onDelTemplate: (id: string) => void
}) {
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  const [person, setPerson] = useState('')
  const [cat, setCat] = useState('P2P')
  const [kind, setKind] = useState<'income' | 'expense'>('income')
  const [curr, setCurr] = useState<'USD' | 'VES'>('USD')
  const [rateStr, setRateStr] = useState(String(rate))
  useEffect(() => setRateStr(String(rate)), [rate])
  const n = toNum(amt)
  const rr = toNum(rateStr) || rate || 0
  const usdNow = curr === 'VES' ? (rr ? n / rr : 0) : n

  return (
    <div style={{ ...card, marginTop: 14 }}>
      {templates.length > 0 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 10 }}>
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setKind(t.type === 'income' ? 'income' : 'expense')
                setCurr('USD')
                setAmt(String(t.amountUsd))
                setCat(t.category)
                setNote(t.note)
                setPerson(t.person || '')
              }}
              style={{ ...chip(false), display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}
            >
              ⭐ {t.note || t.category} · {t.amountUsd}
              <span
                style={{ color: 'var(--muted)', marginLeft: 2 }}
                onClick={(e) => { e.stopPropagation(); onDelTemplate(t.id) }}
              >✕</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button style={chip(kind === 'income')} onClick={() => setKind('income')}>Ingreso</button>
        <button style={chip(kind === 'expense')} onClick={() => setKind('expense')}>Gasto</button>
        <div style={{ flex: 1 }} />
        <button style={chip(curr === 'USD')} onClick={() => setCurr('USD')}>USDT</button>
        <button style={chip(curr === 'VES')} onClick={() => setCurr('VES')}>Bs</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="mono" placeholder={curr === 'VES' ? 'Monto (Bs)' : 'Monto USDT'} value={amt} onChange={(e) => setAmt(e.target.value)} style={input} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={input}>
          {CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      {curr === 'VES' && (
        <>
          <label style={{ ...lbl, marginTop: 10 }}>Precio actual del USDT (Bs)</label>
          <input className="mono" inputMode="decimal" value={rateStr} onChange={(e) => setRateStr(e.target.value)} style={input} />
          {n > 0 && rr > 0 && (
            <div className="mono" style={{ fontSize: 12, color: 'var(--gold)', marginTop: 6 }}>
              ≈ {money(n / rr)} @{rr}
            </div>
          )}
        </>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <input placeholder="Nota / descripción" value={note} onChange={(e) => setNote(e.target.value)} style={input} />
        <input placeholder="Persona (opcional)" value={person} onChange={(e) => setPerson(e.target.value)} style={input} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button style={{ ...btn, flex: 1 }} onClick={() => {
          if (!n) return
          if (curr === 'VES' && !rr) return
          if (curr === 'VES' && rr) onRate(rr)
          onAdd({
            type: kind,
            amountUsd: curr === 'VES' ? +(n / rr).toFixed(4) : n,
            amountVes: curr === 'VES' ? n : +(n * (rr || rate)).toFixed(2),
            rateVes: curr === 'VES' ? rr : rate,
            category: cat,
            note,
            person: person || undefined,
          })
          setAmt(''); setNote(''); setPerson('')
        }}>Añadir {curr === 'VES' ? 'en Bs → USDT' : 'en USDT'}</button>
        <button
          title="Guardar como plantilla frecuente"
          style={{ ...btn, background: 'transparent', border: '1px solid var(--line)', color: 'var(--gold)', opacity: n > 0 ? 1 : 0.4 }}
          disabled={!(n > 0)}
          onClick={() => onSaveTemplate({ id: uid(), type: kind, amountUsd: +usdNow.toFixed(4), category: cat, note, person: person || undefined })}
        >☆</button>
      </div>
    </div>
  )
}

function SnapForm({ onSave, rate }: { onSave: (s: Snapshot, rate: number) => void; rate: number }) {
  const [vesStr, setVesStr] = useState('')
  const [bin, setBin] = useState('')
  const [rateStr, setRateStr] = useState(String(rate))
  const [session, setSession] = useState<'open' | 'close'>('open')
  useEffect(() => setRateStr(String(rate)), [rate])
  const r = toNum(rateStr)
  const v = toNum(vesStr)
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button style={chip(session === 'open')} onClick={() => setSession('open')}>Apertura</button>
        <button style={chip(session === 'close')} onClick={() => setSession('close')}>Cierre</button>
      </div>
      <label style={lbl}>Precio actual del USDT (Bs)</label>
      <input className="mono" inputMode="decimal" placeholder="Ej: 220.50" value={rateStr} onChange={(e) => setRateStr(e.target.value)} style={input} />
      <input placeholder="Bs en cuentas" value={vesStr} onChange={(e) => setVesStr(e.target.value)} style={{ ...input, marginTop: 8 }} />
      {v > 0 && r > 0 && (
        <div className="mono" style={{ fontSize: 12, color: 'var(--gold)', marginTop: 6 }}>
          ≈ {money(v / r)} @{r}
        </div>
      )}
      <input placeholder="USDT Binance" value={bin} onChange={(e) => setBin(e.target.value)} style={{ ...input, marginTop: 8 }} />
      <button style={{ ...btn, marginTop: 10, width: '100%' }} onClick={() => {
        const rr = r || rate || 1
        onSave({ id: uid(), date: new Date().toISOString(), session, ves: v, vesInUsdt: v / rr, binanceUsdt: toNum(bin), rate: rr }, rr)
        setVesStr(''); setBin('')
      }}>Guardar snapshot</button>
    </div>
  )
}

function LoanForm({ onSave }: { onSave: (l: Loan) => void }) {
  const [person, setPerson] = useState('')
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  return (
    <div style={card}>
      <input placeholder="Persona" value={person} onChange={(e) => setPerson(e.target.value)} style={input} />
      <input placeholder="USDT prestados" value={amt} onChange={(e) => setAmt(e.target.value)} style={{ ...input, marginTop: 8 }} />
      <input placeholder="Nota" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...input, marginTop: 8 }} />
      <button style={{ ...btn, marginTop: 10, width: '100%' }} onClick={() => {
        if (!person || !amt) return
        onSave({ id: uid(), person, amountUsd: toNum(amt), note, date: new Date().toISOString(), status: 'open' })
        setPerson(''); setAmt(''); setNote('')
      }}>Registrar préstamo</button>
    </div>
  )
}

function DebtForm({ onSave }: { onSave: (d: Debt) => void }) {
  const [name, setName] = useState('')
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  return (
    <div style={card}>
      <input placeholder="Nombre de la deuda (ej. Tarjeta, préstamo de Ana)" value={name} onChange={(e) => setName(e.target.value)} style={input} />
      <input placeholder="Monto que debes (USDT)" value={amt} onChange={(e) => setAmt(e.target.value)} style={{ ...input, marginTop: 8 }} />
      <input placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...input, marginTop: 8 }} />
      <button style={{ ...btn, marginTop: 10, width: '100%', opacity: name && toNum(amt) > 0 ? 1 : 0.5 }} disabled={!(name && toNum(amt) > 0)} onClick={() => {
        onSave({ id: uid(), name, amountUsd: toNum(amt), note, date: new Date().toISOString(), status: 'open' })
        setName(''); setAmt(''); setNote('')
      }}>💳 Registrar deuda</button>
    </div>
  )
}

function BillForm({ onSave }: { onSave: (b: Recurring) => void }) {
  const [name, setName] = useState('')
  const [amt, setAmt] = useState('')
  const [day, setDay] = useState('5')
  const [cat, setCat] = useState('Servicios')
  const [daysBefore, setDaysBefore] = useState(2)
  const [remind, setRemind] = useState(true)
  const ok = name.trim() && toNum(amt) > 0 && toNum(day) >= 1 && toNum(day) <= 31
  return (
    <div style={{ ...card, marginTop: 14 }}>
      <input placeholder="Nombre (ej. Celular Digitel, Internet, Alquiler)" value={name} onChange={(e) => setName(e.target.value)} style={input} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <input className="mono" inputMode="decimal" placeholder="Monto (USDT)" value={amt} onChange={(e) => setAmt(e.target.value)} style={input} />
        <input className="mono" inputMode="numeric" min={1} max={31} placeholder="Día de vencimiento (1–31)" value={day} onChange={(e) => setDay(e.target.value)} style={input} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={input}>
          {CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <div style={{ ...input, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button style={stepBtn} onClick={() => setDaysBefore((d) => Math.max(0, d - 1))}>−</button>
          <span className="mono" style={{ flex: 1, textAlign: 'center', fontSize: 13 }}>{daysBefore === 0 ? 'ese día' : `${daysBefore}d antes`}</span>
          <button style={stepBtn} onClick={() => setDaysBefore((d) => Math.min(7, d + 1))}>＋</button>
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }} onClick={() => setRemind((r) => !r)}>
        <div style={{ width: 38, height: 22, borderRadius: 99, background: remind ? 'var(--green)' : 'var(--chip)', position: 'relative', transition: 'background .2s' }}>
          <div style={{ position: 'absolute', top: 3, left: remind ? 18 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
        </div>
        Recordarme hasta que marque pagado
      </label>
      <button style={{ ...btn, marginTop: 12, width: '100%', opacity: ok ? 1 : 0.5 }} disabled={!ok} onClick={() => {
        onSave({
          id: uid(),
          name: name.trim(),
          amountUsd: toNum(amt),
          dayOfMonth: Math.min(31, Math.max(1, Math.round(toNum(day)))),
          category: cat,
          note: '',
          remind,
          remindDaysBefore: daysBefore,
          paidMonths: {},
        })
        setName(''); setAmt('')
      }}>📅 Agregar gasto fijo</button>
    </div>
  )
}

/* ---------- Estilos ---------- */

const card: React.CSSProperties = {
  background: 'var(--card)', backdropFilter: 'blur(16px)', border: '1px solid var(--line)', borderRadius: 24, padding: 14,
}
const hero: React.CSSProperties = {
  ...card,
  background: 'linear-gradient(160deg, var(--heroA), var(--card) 45%, var(--heroB))',
  boxShadow: '0 24px 50px -30px rgba(3,6,14,.9)',
}
const input: React.CSSProperties = {
  width: '100%', background: 'var(--input)', border: '1px solid var(--line)', color: 'var(--text)',
  borderRadius: 14, padding: '12px 12px', outline: 'none',
}
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }
const btn: React.CSSProperties = {
  background: 'linear-gradient(135deg,#6ea8ff,#a78bfa)', color: '#071018', fontWeight: 700,
  border: 0, borderRadius: 14, padding: '12px 16px', cursor: 'pointer',
}
const dangerBtn: React.CSSProperties = {
  ...btn, width: '100%', marginTop: 14, background: 'rgba(255,107,138,.1)',
  color: 'var(--red)', border: '1px solid rgba(255,107,138,.3)', fontWeight: 600,
}
const stepBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--chip)',
  color: 'var(--text)', cursor: 'pointer', fontWeight: 700, fontSize: 14, lineHeight: 1,
}
const delBtn: React.CSSProperties = {
  background: 'rgba(255,107,138,.08)', color: 'var(--red)', border: '1px solid rgba(255,107,138,.25)',
  borderRadius: 10, padding: '6px 9px', cursor: 'pointer', fontSize: 12, lineHeight: 1, flexShrink: 0,
}
function chip(on: boolean): React.CSSProperties {
  return {
    border: '1px solid var(--line)', background: on ? 'rgba(110,168,255,.2)' : 'var(--chip)',
    color: 'var(--text)', borderRadius: 999, padding: '8px 12px', whiteSpace: 'nowrap', cursor: 'pointer',
  }
}
const row: React.CSSProperties = { ...card, display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(3,6,14,.65)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 40, padding: 16,
}
const sheet: React.CSSProperties = {
  width: '100%', maxWidth: 488, maxHeight: '85vh', overflow: 'auto',
  background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 24, padding: 16,
}
const nav: React.CSSProperties = {
  position: 'fixed', left: 12, right: 12, bottom: 12, maxWidth: 496, margin: '0 auto',
  display: 'flex', justifyContent: 'space-around', alignItems: 'center', background: 'var(--navbg)',
  backdropFilter: 'blur(18px)', border: '1px solid var(--line)', borderRadius: 24, padding: '10px 8px 12px',
}
const toastSt: React.CSSProperties = {
  position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg2)', color: 'var(--text)',
  border: '1px solid var(--line)', padding: '10px 14px', borderRadius: 12, zIndex: 50,
}
const tip = { background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 10 }
