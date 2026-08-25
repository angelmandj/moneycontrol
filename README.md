# MoneyControl

PWA móvil para control de microingresos P2P, gastos, préstamos y snapshots diarios (Bs / USDT / Binance).

## Uso

```bash
npm install
npm run dev
```

- **Home**: patrimonio, charts con título de mes y semana (1–4), ingresos vs gastos por período.
- **Movs**: buscador + filtros + micro-movimientos; cada movimiento se puede eliminar.
- **P2P**: apertura/cierre de saldos VES y Binance; al convertir Bs se pide el precio actual del USDT.
- **Préstamos y deudas**: quién te debe (cobros) y **cuánto debes tú** (deudas con nombre y monto; al marcar "Pagada" se registra el gasto). La conciliación general del Home muestra efectivo + te deben − debes = **patrimonio neto**.
- Todo se muestra en **USDT** (con su equivalente en Bs debajo) y cada movimiento/snapshot guarda la tasa (Bs/USDT) del momento.
- **Escanear facturas en Bs**: el OCR detecta el monto, te pregunta el precio actual del USDT y registra el gasto convertido (USDT + Bs).
- **Movs y QuickAdd** permiten registrar directamente en Bs o USDT con la tasa del momento; los movimientos se pueden **editar** y eliminar (modales inline).
- Meta de gasto diario y **presupuestos mensuales por categoría**, ambos con barras de progreso.
- **Conciliación P2P**: compara tu saldo real (snapshot) contra el esperado (snapshot previo + movimientos) y avisa diferencias.
- **Plantillas** de movimientos frecuentes (⭐) y **filtro por persona**.
- Tendencia del neto **vs. mes anterior** (▲/▼ %) y recordatorio de cierre P2P.
- **Respaldo JSON** (exportar/restaurar), **bloqueo con PIN** y **tema claro/oscuro** (sección Más).
- **Gastos fijos del mes** (celular, internet, alquiler, tarjeta…): con día de vencimiento y **alertas programables** (avisa X días antes; banner persistente en Home + notificación del navegador **hasta marcar pagado**). "Pagar" registra el gasto automáticamente y "des-marcar" lo revierte.
- Botón en Home para **borrar los datos de ejemplo y empezar desde cero**.
- **Reporte**: resumen del período exportable a **PDF** y **Excel (.xlsx)**.
- **Nube (Supabase)**: login con enlace mágico, respaldo automático de cada cambio, mismos datos en todos tus dispositivos (local-first: la app sigue funcionando offline).

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
