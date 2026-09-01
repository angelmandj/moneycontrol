# MoneyControl

PWA móvil para control de microingresos P2P, gastos, préstamos y snapshots diarios (Bs / USDT / Binance).

## 🌐 App en vivo

**https://angelmandj.github.io/moneycontrol/** — PWA instalable (Android: *Instalar app* · iPhone: *Compartir → Añadir a pantalla de inicio*). Cada push a `main` o `arena/01a03953-moneycontrol` redespliega solo vía GitHub Actions (`.github/workflows/deploy.yml`).

## Uso

```bash
npm install
npm run dev
```

- **Home**: patrimonio, charts con título de mes y semana (1–4), ingresos vs gastos por período.
- **Movs**: buscador + filtros + micro-movimientos; cada movimiento se puede eliminar.
- **P2P**: apertura/cierre de saldos VES y Binance; al convertir Bs se pide el precio actual del USDT.
- **✏️ Editar aperturas y cierres**: cada snapshot de la lista tiene ✏️ (corrige Bs, Binance, tasa, fecha o si fue apertura/cierre) y ✕ (eliminar). Al guardar se **recalcula sola** la «Ganancia hoy» de ese día y la conciliación P2P — si te equivocaste en una cifra, la editas y todo cuadra.
- **💱 Precio del USDT en la sección P2P**: tarjeta para fijarlo manualmente (aplica a toda la app por defecto) o tomarlo **automáticamente de una celda de tu Google Sheet** (cada 10 min, al abrir la app y con botón 🔄). Cambia el precio en tu hoja durante el día y la app lo adopta sola.
- **💰 Ganancia hoy**: al registrar el **cierre** del día se crea solo el movimiento «Ganancia hoy» (cierre − apertura, en USDT, categoría P2P); si ya existía se recalcula. Cada cierre muestra su insignia de ganancia en la lista de snapshots.
- **🧪 Reporte avanzado / P2P**: período propio (Hoy/Semana/Mes/Año/Todo), categorías multi-selección (incluye las personalizadas), tipo, persona, palabra clave y «Solo Ganancia hoy», con **presets** (⚡ Ganancias P2P · 💼 P2P menos trabajadores) y **selección manual por ítem** — exporta solo lo marcado a **PDF/Excel** con Ingresos/Egresos/Neto.
- **Préstamos y deudas**: quién te debe (cobros) y **cuánto debes tú** (deudas con nombre y monto; al marcar "Pagada" se registra el gasto). La conciliación general del Home muestra efectivo + te deben − debes = **patrimonio neto**.
- Todo se muestra en **USDT** (con su equivalente en Bs debajo) y cada movimiento/snapshot guarda la tasa (Bs/USDT) del momento.
- **Escanear facturas en Bs**: el OCR detecta el monto, te pregunta el precio actual del USDT y registra el gasto convertido (USDT + Bs).
- **Movs y QuickAdd** permiten registrar directamente en Bs o USDT con la tasa del momento; los movimientos se pueden **editar** y eliminar (modales inline).
- **📅 Fecha anterior**: en QuickAdd, al escanear una factura y al editar un movimiento puedes cambiar la fecha (botón **📅 Hoy** → eliges el día real). Si se te olvida subir algo y lo registras al día siguiente, queda en el día correcto de gráficos, filtros, reportes y presupuestos. No permite fechas futuras.
- Meta de gasto diario y **presupuestos mensuales por categoría**, ambos con barras de progreso.
- **Conciliación P2P**: compara tu saldo real (snapshot) contra el esperado (snapshot previo + movimientos) y avisa diferencias.
- **Plantillas** de movimientos frecuentes (⭐) y **filtro por persona**.
- **Categorías personalizadas** 🏷️: al registrar, elige «Otros» y escribe el nombre exacto del gasto (Trabajadores, Medicinas abuela…). Se crea tu categoría, se agrupa con su total en Inicio, filtros, presupuestos y reportes, y se administra desde *Más → Tus categorías*.
- **Desglose por categoría**: toca cualquier categoría del gráfico «Gastos por categoría» para ver su total y el listado movimiento por movimiento (con edición/eliminación directa).
- **Buscador inteligente**: al escribir una palabra clave ves cuántas coincidencias hay en las descripciones y sus totales (ingresos/gastos/neto) sobre el listado filtrado.
- Tendencia del neto **vs. mes anterior** (▲/▼ %) y recordatorio de cierre P2P.
- **Respaldo JSON** (exportar/restaurar), **bloqueo con PIN** y **tema claro/oscuro** (sección Más).
- **👁️ Modo privado**: el ícono de ojo junto a «Patrimonio operativo» tapa el total, los mini‑resúmenes (Ingresos/Gastos/Neto), «Te deben», «Debes», «Patrimonio neto», el gasto de hoy y el total de pagos pendientes. Se recuerda entre sesiones y sincroniza con la nube; tócalo de nuevo para mostrar todo.
- **Desbloqueo con huella/rostro 👆** (WebAuthn): en *Más → Seguridad*, con PIN activo, activa la biometría del dispositivo (se guarda solo en ese dispositivo; el PIN queda de respaldo). Al abrir la app la pide automáticamente.
- La nube **sincroniza en silencio al recargar** si nube y dispositivo coinciden (el modal "nube vs dispositivo" solo aparece cuando hay diferencias reales).
- **Gastos fijos del mes** (celular, internet, alquiler, tarjeta…): con día de vencimiento y **alertas programables** (avisa X días antes; banner persistente en Home + notificación del navegador **hasta marcar pagado**). "Pagar" registra el gasto automáticamente y "des-marcar" lo revierte.
- Botón en Home para **borrar los datos de ejemplo y empezar desde cero** (desaparece después del primer uso para evitar borrados accidentales).
- **Reporte**: resumen del período exportable a **PDF** y **Excel (.xlsx)**.
- **Nube (Supabase)**: login con enlace mágico, respaldo automático de cada cambio, mismos datos en todos tus dispositivos (local-first: la app sigue funcionando offline).

## Instalarla como app (PWA)

El build de producción es una **PWA instalable**: ícono propio, pantalla completa, funciona sin conexión (service worker con caché local) y atajos desde el ícono (Registrar / Escanear).

1. Genera y sirve el build de producción (el service worker **no** corre en `npm run dev`):
   ```bash
   npm run build
   npm run preview   # http://localhost:4173
   ```
2. Ábrela en tu teléfono: **https://angelmandj.github.io/moneycontrol/** (HTTPS) y:
   - **Android (Chrome)**: Menú ⋮ → **Instalar app** / **Añadir a pantalla de inicio**. También aparece el botón **📲 Instalar como app** en la pestaña *Más*.
   - **iPhone (Safari)**: Compartir → **Añadir a pantalla de inicio**.

> Los datos son los mismos en todos los dispositivos gracias a la nube de Supabase. Las actualizaciones llegan solas: al abrir la app instalada, el service worker toma la versión nueva publicada.

## Sincronización en la nube (Supabase)

1. En tu proyecto de Supabase: **SQL Editor → New query** → pega el contenido de [`supabase/setup.sql`](supabase/setup.sql) → **Run**.
2. **Authentication → Sign In / Providers**: deja activado **Email**.
3. **Authentication → URL Configuration → Redirect URLs**: agrega `https://**` y `http://localhost:5173/**` (para que el enlace mágico funcione desde cualquier dominio de preview/desarrollo).
4. En la app: **Más → Nube**, escribe tu correo y abre el enlace que te llega.

> El SMTP por defecto de Supabase limita los correos (pocos por hora en proyectos nuevos). Si deja de llegar el enlace, configura un SMTP propio en **Authentication → SMTP**, o espera una hora.
- **Scan**: OCR de facturas y capturas (Tesseract).
- **TG**: pega el token de un bot de Telegram y sincroniza mensajes del tipo  
  `apertura ves:18500 usdt:194 binance:320` o `gasto 3.40 almuerzo`.

Los datos se guardan en el navegador (`localStorage`).

## Changelog rápido

- 2026-09-01: edición y eliminación de aperturas/cierres P2P (con recálculo automático de «Ganancia hoy» y conciliación), fecha anterior al registrar/editar movimientos y al escanear facturas, agrupación por **día local** (un cierre a las 9pm ya no salta al día siguiente) y **modo privado 👁️** para ocultar el monto total del Home.
- 2026-08-26: reportes avanzados/P2P, tasa USDT manual o automática (Google Sheets), «Ganancia hoy» automática al cierre, categorías personalizadas con desglose y resumen de búsqueda.
