# MoneyControl

PWA móvil para control de microingresos P2P, gastos, préstamos y snapshots diarios (Bs / USDT / Binance).

## Uso

```bash
npm install
npm run dev
```

- **Home**: patrimonio, charts, ingresos vs gastos por período.
- **Movs**: buscador + filtros + micro-movimientos.
- **P2P**: apertura/cierre de saldos VES y Binance.
- **Préstamos**: quién te debe y cobros.
- **Scan**: OCR de facturas y capturas (Tesseract).
- **TG**: pega el token de un bot de Telegram y sincroniza mensajes del tipo  
  `apertura ves:18500 usdt:194 binance:320` o `gasto 3.40 almuerzo`.

Los datos se guardan en el navegador (`localStorage`).
