import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { loadStore, saveStore, uid, inPeriod } from './store'
import { parseTelegramCaption, readReceipt } from './ocr'
import type { Loan, Period, Snapshot, Store, Transaction } from './types'

const CATS = ['P2P', 'Comida', 'Transporte', 'Servicios', 'Hogar', 'Salud', 'Ocio', 'Préstamos', 'Otros']
const COLORS = ['#6ea8ff', '#3ee0a7', '#f5c46b', '#a78bfa', '#ff6b8a', '#67e8f9', '#fb923c', '#94a3b8', '#c4b5fd']

function money(n: number, c = 'USD') {
  return `${c === 'USD' ? '$' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${c === 'VES' ? ' Bs' : ''}`
}

export default function App() {
  const [s, setS] = useState<Store>(() => loadStore())
  const [tab, setTab] = useState<'home' | 'tx' | 'p2p' | 'loans' | 'scan' | 'tg'>('home')
  const [period, setPeriod] = useState<Period>('month')
  const [q, setQ] = useState('')
  const [typeF, setTypeF] = useState<'all' | 'income' | 'expense'>('all')
  const [catF, setCatF] = useState('all')
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => saveStore(s), [s])

  const txs = useMemo(() => {
    return s.txs
      .filter((t) => inPeriod(t.date, period))
      .filter((t) => typeF === 'all' || t.type === typeF)
      .filter((t) => catF === 'all' || t.category === catF)
      .filter((t) => {
        const hay = `${t.note} ${t.category} ${t.person || ''}`.toLowerCase()
        return hay.includes(q.toLowerCase())
      })
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
  }, [s.txs, period, typeF, catF, q])

  const inc = txs.filter((t) => t.type === 'income').reduce((a, t) => a + t.amountUsd, 0)
  const exp = txs.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amountUsd, 0)
  const loansOpen = s.loans.filter((l) => l.status === 'open').reduce((a, l) => a + l.amountUsd, 0)

  const lastClose = [...s.snaps].filter((x) => x.session === 'close').sort((a, b) => +new Date(b.date) - +new Date(a.date))[0]
  const lastOpen = [...s.snaps].filter((x) => x.session === 'open').sort((a, b) => +new Date(b.date) - +new Date(a.date))[0]
  const cash = lastClose
    ? lastClose.vesInUsdt + lastClose.binanceUsdt
    : lastOpen
      ? lastOpen.vesInUsdt + lastOpen.binanceUsdt
      : 0

  const byCat = CATS.map((c, i) => ({
    name: c,
    value: txs.filter((t) => t.type === 'expense' && t.category === c).reduce((a, t) => a + t.amountUsd, 0),
    color: COLORS[i],
  })).filter((x) => x.value > 0)

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

  const p2pSeries = [...s.snaps]
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))
    .map((x) => ({
      d: x.date.slice(5, 10) + (x.session === 'open' ? '↑' : '↓'),
      ves: x.vesInUsdt,
      binance: x.binanceUsdt,
      total: x.vesInUsdt + x.binanceUsdt,
    }))

  function addTx(partial: Partial<Transaction> & { type: Transaction['type']; amountUsd: number }) {
    const tx: Transaction = {
      id: uid(),
      category: 'Otros',
      note: '',
      date: new Date().toISOString(),
      source: 'manual',
      ...partial,
    }
    setS((p) => ({ ...p, txs: [tx, ...p.txs] }))
    ping('Movimiento guardado')
  }

  function ping(m: string) {
    setToast(m)
    setTimeout(() => setToast(''), 2200)
  }

  async function onScan(file: File, kind: 'tx' | 'p2p') {
    setBusy('Leyendo captura con OCR…')
    try {
      const r = await readReceipt(file)
      const url = URL.createObjectURL(file)
      if (kind === 'p2p') {
        const cap = parseTelegramCaption(r.text)
        const ves = cap.ves || r.amount
        const vesUsdt = cap.vesInUsdt || (ves / (s.rate || 1))
        const snap: Snapshot = {
          id: uid(),
          date: new Date().toISOString(),
          session: cap.session as 'open' | 'close',
          ves,
          vesInUsdt: vesUsdt,
          binanceUsdt: cap.binanceUsdt || 0,
          receipt: url,
          note: r.text.slice(0, 180),
        }
        setS((p) => ({ ...p, snaps: [snap, ...p.snaps] }))
        ping('Snapshot P2P creado')
      } else {
        addTx({
          type: r.isIncome ? 'income' : 'expense',
          amountUsd: r.amount > 500 ? r.amount / (s.rate || 95) : r.amount,
          category: r.category,
          note: r.text.split('\n').filter(Boolean).slice(0, 2).join(' · '),
          source: 'ocr',
          receipt: url,
        })
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
          const n = parseFloat(text.replace(',', '.').match(/[\d.]+/)?.[0] || '0')
          extraTx.push({
            id: uid(), type: 'expense', amountUsd: n, category: 'Otros', note: text, date: new Date().toISOString(), source: 'telegram',
          })
        } else if (/ingreso|\+\s?\$|p2p/i.test(text) && !/apertura|cierre|binance/i.test(text)) {
          const n = parseFloat(text.replace(',', '.').match(/[\d.]+/)?.[0] || '0')
          extraTx.push({
            id: uid(), type: 'income', amountUsd: n, category: 'P2P', note: text, date: new Date().toISOString(), source: 'telegram',
          })
        }
        if (/apertura|cierre|binance|ves/i.test(text)) {
          const p = parseTelegramCaption(text)
          extraSn.push({
            id: uid(), date: new Date().toISOString(), session: p.session as 'open' | 'close',
            ves: p.ves, vesInUsdt: p.vesInUsdt, binanceUsdt: p.binanceUsdt, note: text,
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

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '18px 16px 110px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 2, color: 'var(--muted)', textTransform: 'uppercase' }}>MoneyControl</div>
          <h1 style={{ fontSize: 26, fontWeight: 700 }}>Tu flujo P2P</h1>
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--gold)', background: 'rgba(245,196,107,.1)', padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)' }}>
          1 USDT ≈ {s.rate} Bs
        </div>
      </header>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 16 }}>
        {(['day', 'week', 'month', 'year'] as Period[]).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} style={chip(period === p)}>
            {p === 'day' ? 'Hoy' : p === 'week' ? 'Semana' : p === 'month' ? 'Mes' : 'Año'}
          </button>
        ))}
      </div>

      {tab === 'home' && (
        <>
          <div style={hero}>
            <div style={{ opacity: 0.7, fontSize: 13 }}>Patrimonio operativo</div>
            <div className="mono" style={{ fontSize: 36, fontWeight: 700, margin: '6px 0 14px' }}>{money(cash)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Mini label="Ingresos" value={money(inc)} color="var(--green)" />
              <Mini label="Gastos" value={money(exp)} color="var(--red)" />
              <Mini label="Neto" value={money(inc - exp)} color="var(--blue)" />
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
              Prestado a terceros: <b style={{ color: 'var(--gold)' }}>{money(loansOpen)}</b>
            </div>
          </div>

          <Card title="Ingresos vs gastos">
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
                  <CartesianGrid stroke="rgba(255,255,255,.05)" />
                  <XAxis dataKey="d" stroke="#8b9bb8" fontSize={11} />
                  <YAxis stroke="#8b9bb8" fontSize={11} />
                  <Tooltip contentStyle={tip} />
                  <Area type="monotone" dataKey="in" stroke="#3ee0a7" fill="url(#gin)" />
                  <Area type="monotone" dataKey="out" stroke="#ff6b8a" fill="url(#gout)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Gastos por categoría">
            <div style={{ display: 'flex', height: 180, alignItems: 'center' }}>
              <ResponsiveContainer width="48%">
                <PieChart>
                  <Pie data={byCat} dataKey="value" innerRadius={42} outerRadius={68} paddingAngle={3}>
                    {byCat.map((e) => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tip} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1, fontSize: 13 }}>
                {byCat.map((c) => (
                  <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: c.color, marginRight: 6 }} />{c.name}</span>
                    <span className="mono">{money(c.value)}</span>
                  </div>
                ))}
                {byCat.length === 0 && <div style={{ color: 'var(--muted)' }}>Sin gastos en el período</div>}
              </div>
            </div>
          </Card>

          <Card title="Saldos P2P (VES+Binance)">
            <div style={{ height: 170 }}>
              <ResponsiveContainer>
                <BarChart data={p2pSeries.slice(-10)}>
                  <CartesianGrid stroke="rgba(255,255,255,.05)" />
                  <XAxis dataKey="d" stroke="#8b9bb8" fontSize={10} />
                  <Tooltip contentStyle={tip} />
                  <Bar dataKey="ves" stackId="a" fill="#f5c46b" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="binance" stackId="a" fill="#6ea8ff" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <QuickAdd onAdd={addTx} rate={s.rate} />
        </>
      )}

      {tab === 'tx' && (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nota, persona, categoría…" style={input} />
          <div style={{ display: 'flex', gap: 8, margin: '10px 0 14px', overflowX: 'auto' }}>
            {(['all', 'income', 'expense'] as const).map((t) => (
              <button key={t} onClick={() => setTypeF(t)} style={chip(typeF === t)}>{t === 'all' ? 'Todo' : t === 'income' ? 'Ingresos' : 'Gastos'}</button>
            ))}
            <select value={catF} onChange={(e) => setCatF(e.target.value)} style={{ ...chip(false), background: 'transparent', color: 'inherit' }}>
              <option value="all">Categorías</option>
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <QuickAdd onAdd={addTx} rate={s.rate} />
          {txs.map((t) => (
            <div key={t.id} style={row}>
              <div style={{ width: 42, height: 42, borderRadius: 14, background: t.type === 'income' ? 'rgba(62,224,167,.12)' : 'rgba(255,107,138,.12)', display: 'grid', placeItems: 'center' }}>
                {t.type === 'income' ? '↑' : '↓'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{t.note || t.category}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.category} · {new Date(t.date).toLocaleString()} · {t.source}</div>
              </div>
              <div className="mono" style={{ color: t.type === 'income' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                {t.type === 'income' ? '+' : '-'}{money(t.amountUsd)}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'p2p' && (
        <>
          <p style={{ color: 'var(--muted)', marginBottom: 12, fontSize: 14 }}>
            Cada día registra apertura y cierre: Bs en cuentas (con equivalente USDT) y USDT en Binance.
          </p>
          <SnapForm rate={s.rate} onSave={(sn) => { setS((p) => ({ ...p, snaps: [sn, ...p.snaps] })); ping('Snapshot guardado') }} />
          {s.snaps.sort((a, b) => +new Date(b.date) - +new Date(a.date)).map((sn) => (
            <div key={sn.id} style={row}>
              <div>
                <b>{sn.session === 'open' ? 'Apertura' : 'Cierre'}</b>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(sn.date).toLocaleString()}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>
                <div className="mono">{sn.ves.toLocaleString()} Bs → {money(sn.vesInUsdt)}</div>
                <div className="mono" style={{ color: 'var(--blue)' }}>Binance {money(sn.binanceUsdt)}</div>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'loans' && (
        <>
          <LoanForm onSave={(l) => setS((p) => ({ ...p, loans: [l, ...p.loans] }))} />
          {s.loans.map((l) => (
            <div key={l.id} style={row}>
              <div style={{ flex: 1 }}>
                <b>{l.person}</b>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{l.note} · {new Date(l.date).toLocaleDateString()}</div>
              </div>
              <div className="mono" style={{ color: l.status === 'open' ? 'var(--gold)' : 'var(--green)' }}>{money(l.amountUsd)}</div>
              {l.status === 'open' && (
                <button style={chip(true)} onClick={() => setS((p) => ({
                  ...p,
                  loans: p.loans.map((x) => x.id === l.id ? { ...x, status: 'paid', paidDate: new Date().toISOString() } : x),
                  txs: [{ id: uid(), type: 'income', amountUsd: l.amountUsd, category: 'Préstamos', note: `Devolución ${l.person}`, date: new Date().toISOString(), source: 'manual', person: l.person }, ...p.txs],
                }))}>Cobrado</button>
              )}
            </div>
          ))}
        </>
      )}

      {tab === 'scan' && (
        <div style={{ ...hero, textAlign: 'center' }}>
          <h2>Escanear factura o captura</h2>
          <p style={{ color: 'var(--muted)', margin: '10px 0 18px' }}>Toma foto a un recibo, captura de Binance o saldo en Bs. OCR detecta montos y categoría.</p>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onScan(f, 'tx')
          }} />
          <button style={btn} onClick={() => fileRef.current?.click()}>📷 Foto de gasto / ingreso</button>
          <label style={{ display: 'block', marginTop: 12 }}>
            <span style={{ ...btn, display: 'inline-block', background: 'transparent', border: '1px solid var(--line)' }}>Captura P2P / saldos</span>
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onScan(f, 'p2p') }} />
          </label>
          {busy && <p style={{ marginTop: 16, color: 'var(--gold)' }}>{busy}</p>}
        </div>
      )}

      {tab === 'tg' && (
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
      )}

      <nav style={nav}>
        {([
          ['home', 'Home'],
          ['tx', 'Movs'],
          ['p2p', 'P2P'],
          ['loans', 'Prestamos'],
          ['scan', 'Scan'],
          ['tg', 'TG'],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ background: 'none', border: 0, color: tab === k ? 'var(--text)' : 'var(--muted)', fontWeight: 600, fontSize: 11 }}>
            {l}
          </button>
        ))}
      </nav>
      {toast && <div style={toastSt}>{toast}</div>}
    </div>
  )
}

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'rgba(0,0,0,.25)', borderRadius: 14, padding: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div className="mono" style={{ color, fontWeight: 600, fontSize: 13 }}>{value}</div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...card, marginTop: 14 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8, color: 'var(--muted)', fontWeight: 600 }}>{title}</h3>
      {children}
    </section>
  )
}

function QuickAdd({ onAdd, rate }: { onAdd: (t: any) => void; rate: number }) {
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  const [cat, setCat] = useState('P2P')
  const [kind, setKind] = useState<'income' | 'expense'>('income')
  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button style={chip(kind === 'income')} onClick={() => setKind('income')}>Ingreso</button>
        <button style={chip(kind === 'expense')} onClick={() => setKind('expense')}>Gasto</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="mono" placeholder="USD" value={amt} onChange={(e) => setAmt(e.target.value)} style={input} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={input}>
          {CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <input placeholder="Nota / contraparte" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...input, marginTop: 8 }} />
      <button style={{ ...btn, marginTop: 10, width: '100%' }} onClick={() => {
        const n = parseFloat(amt)
        if (!n) return
        onAdd({ type: kind, amountUsd: n, category: cat, note, amountVes: n * rate })
        setAmt(''); setNote('')
      }}>Añadir micro-movimiento</button>
    </div>
  )
}

function SnapForm({ onSave, rate }: { onSave: (s: Snapshot) => void; rate: number }) {
  const [ves, setVes] = useState('')
  const [bin, setBin] = useState('')
  const [session, setSession] = useState<'open' | 'close'>('open')
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button style={chip(session === 'open')} onClick={() => setSession('open')}>Apertura</button>
        <button style={chip(session === 'close')} onClick={() => setSession('close')}>Cierre</button>
      </div>
      <input placeholder="Bs en cuentas" value={ves} onChange={(e) => setVes(e.target.value)} style={input} />
      <input placeholder="USDT Binance" value={bin} onChange={(e) => setBin(e.target.value)} style={{ ...input, marginTop: 8 }} />
      <button style={{ ...btn, marginTop: 10, width: '100%' }} onClick={() => {
        const v = parseFloat(ves) || 0
        onSave({ id: uid(), date: new Date().toISOString(), session, ves: v, vesInUsdt: v / (rate || 1), binanceUsdt: parseFloat(bin) || 0 })
        setVes(''); setBin('')
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
      <input placeholder="USD prestados" value={amt} onChange={(e) => setAmt(e.target.value)} style={{ ...input, marginTop: 8 }} />
      <input placeholder="Nota" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...input, marginTop: 8 }} />
      <button style={{ ...btn, marginTop: 10, width: '100%' }} onClick={() => {
        if (!person || !amt) return
        onSave({ id: uid(), person, amountUsd: parseFloat(amt), note, date: new Date().toISOString(), status: 'open' })
        setPerson(''); setAmt(''); setNote('')
      }}>Registrar préstamo</button>
    </div>
  )
}

const card: React.CSSProperties = {
  background: 'var(--card)', backdropFilter: 'blur(16px)', border: '1px solid var(--line)', borderRadius: 22, padding: 14,
}
const hero: React.CSSProperties = { ...card, background: 'linear-gradient(160deg, rgba(110,168,255,.16), rgba(18,26,44,.8) 45%, rgba(62,224,167,.08))' }
const input: React.CSSProperties = {
  width: '100%', background: 'rgba(0,0,0,.35)', border: '1px solid var(--line)', color: 'var(--text)',
  borderRadius: 14, padding: '12px 12px', outline: 'none',
}
const btn: React.CSSProperties = {
  background: 'linear-gradient(135deg,#6ea8ff,#a78bfa)', color: '#071018', fontWeight: 700,
  border: 0, borderRadius: 14, padding: '12px 16px', cursor: 'pointer',
}
function chip(on: boolean): React.CSSProperties {
  return {
    border: '1px solid var(--line)', background: on ? 'rgba(110,168,255,.2)' : 'rgba(255,255,255,.03)',
    color: 'var(--text)', borderRadius: 999, padding: '8px 12px', whiteSpace: 'nowrap', cursor: 'pointer',
  }
}
const row: React.CSSProperties = { ...card, display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }
const nav: React.CSSProperties = {
  position: 'fixed', left: 12, right: 12, bottom: 12, maxWidth: 496, margin: '0 auto',
  display: 'flex', justifyContent: 'space-around', background: 'rgba(10,14,24,.86)',
  backdropFilter: 'blur(18px)', border: '1px solid var(--line)', borderRadius: 20, padding: '12px 6px',
}
const toastSt: React.CSSProperties = {
  position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#122',
  border: '1px solid var(--line)', padding: '10px 14px', borderRadius: 12, zIndex: 20,
}
const tip = { background: '#121a2c', border: '1px solid #223', borderRadius: 10 }
