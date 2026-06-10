const express = require('express');
const path = require('path');
const { streamSymbol, processCandlesAndGetState } = require('./scanner');
const {
    startIntradayScanner,
    stopIntradayScanner,
    getScannerState,
    getMarketHealth,
    getNiftyAnalysis,
    getDailyLedger,
    checkExitConditions,
    scannerEmitter,
    candlesCache
} = require('./intradayScanner');
const { getSignalHistory } = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─────────────────────────────────────────────
// SINGLE SYMBOL SSE STREAM
// Used by the single-stock chart page
// ─────────────────────────────────────────────

app.get('/api/stream', async (req, res) => {
    const symbol = req.query.symbol;
    const interval = req.query.interval || '1D';
    const strategy = req.query.strategy || 'HMA_SLOPE';
    const period = parseInt(req.query.period) || 16;
    const fastPeriod = parseInt(req.query.fastPeriod) || 9;
    const slowPeriod = parseInt(req.query.slowPeriod) || 21;
    const useHeikinAshi = req.query.useHeikinAshi === 'true';
    const confirmations = req.query.confirmations ? req.query.confirmations.split(',') : [];

    if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // If background scanner is already watching this symbol at same interval,
    // reuse its live candle cache instead of opening a new browser tab
    const bState = getScannerState();
    const isScannedByBackground = bState.scanStates[symbol] !== undefined && bState.interval === interval;

    if (isScannedByBackground && candlesCache[symbol] && candlesCache[symbol].length > 0) {
        console.log(`[SSE] Reusing background stream for ${symbol} at ${interval}`);

        const sendUpdate = (candlesData) => {
            const state = processCandlesAndGetState(candlesData, symbol, interval, {
                strategy, period, fastPeriod, slowPeriod, useHeikinAshi, confirmations
            });
            if (state) {
                try { res.write(`data: ${JSON.stringify(state)}\n\n`); } catch (e) { }
            }
        };

        sendUpdate(candlesCache[symbol]);

        const updateListener = (data) => {
            if (data.symbol === symbol) sendUpdate(data.candles);
        };

        scannerEmitter.on('update', updateListener);
        req.on('close', () => {
            console.log(`[SSE] Disconnected shared stream: ${symbol}`);
            scannerEmitter.off('update', updateListener);
        });
        return;
    }

    console.log(`[SSE] New browser tab: ${symbol} at ${interval} strategy: ${strategy}`);

    let cleanupStream = null;
    try {
        const options = { strategy, period, fastPeriod, slowPeriod, useHeikinAshi, confirmations };
        cleanupStream = await streamSymbol(symbol, interval, options, (state) => {
            res.write(`data: ${JSON.stringify(state)}\n\n`);
        });
    } catch (error) {
        console.error('[SSE] Error starting stream:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }

    req.on('close', async () => {
        console.log(`[SSE] Client disconnected: ${symbol}`);
        if (cleanupStream) await cleanupStream();
    });
});

// ─────────────────────────────────────────────
// INTRADAY MULTI-STOCK SSE STREAM
// Used by the intraday scanner dashboard
// ─────────────────────────────────────────────

let intradayClients = [];

function broadcastIntraday(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    intradayClients.forEach(client => {
        try { client.write(payload); } catch (e) {
            console.error('[SSE-Intraday] Error writing to client:', e.message);
        }
    });
}

// Also broadcast market health updates to all intraday clients
scannerEmitter.on('marketHealth', (health) => {
    broadcastIntraday({ marketHealth: health });
});

app.get('/api/intraday-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    console.log('[SSE-Intraday] Client connected');
    intradayClients.push(res);

    // Send current state immediately on connect
    const currentState = getScannerState();
    res.write(`data: ${JSON.stringify({
        states: currentState.scanStates,
        alerts: currentState.activeAlerts,
        marketHealth: currentState.marketHealth
    })}\n\n`);

    // Start scanner if this is the first client
    if (intradayClients.length === 1) {
        const config = getScannerState();
        startIntradayScanner(
            config.assetClass,
            config.interval,
            (alert) => broadcastIntraday({ alert }),
            (states) => broadcastIntraday({ states, marketHealth: getMarketHealth() })
        ).catch(err => {
            console.error('[SSE-Intraday] Error starting scanner:', err);
        });
    }

    req.on('close', async () => {
        console.log('[SSE-Intraday] Client disconnected');
        intradayClients = intradayClients.filter(c => c !== res);

        // Stop scanner when no clients remain
        if (intradayClients.length === 0) {
            await stopIntradayScanner();
        }
    });
});

// ─────────────────────────────────────────────
// DAILY LEDGER — all signals generated today
// ─────────────────────────────────────────────

app.get('/api/daily-ledger', (req, res) => {
    try {
        res.json({ success: true, ledger: getDailyLedger() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ─────────────────────────────────────────────
// MARKET HEALTH — current NIFTY status
// ─────────────────────────────────────────────

app.get('/api/market-health', (req, res) => {
    try {
        res.json({ success: true, health: getMarketHealth() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ─────────────────────────────────────────────
// SIGNALS HISTORY — persisted signals
// ─────────────────────────────────────────────

app.get('/api/signals-history', (req, res) => {
    try {
        res.json({ success: true, history: getSignalHistory() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ─────────────────────────────────────────────
// NIFTY FULL ANALYSIS — OI, S/R, BOS
// Polled by frontend every 5s for NIFTY panel
// ─────────────────────────────────────────────

app.get('/api/nifty-analysis', (req, res) => {
    try {
        res.json({ success: true, analysis: getNiftyAnalysis() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ─────────────────────────────────────────────
// EXIT CONDITIONS CHECK
// Called by focus mode when user is in a trade
// POST body: { symbol, tradeType: 'SHORT'|'LONG', entryPrice }
// ─────────────────────────────────────────────

app.post('/api/check-exit', (req, res) => {
    const { symbol, tradeType, entryPrice } = req.body;
    if (!symbol || !tradeType || !entryPrice) {
        return res.status(400).json({ error: 'symbol, tradeType, entryPrice required' });
    }
    try {
        const exitAlert = checkExitConditions(symbol, tradeType, parseFloat(entryPrice));
        res.json({ success: true, exitAlert });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ─────────────────────────────────────────────
// RUN BACKTEST FROM UI
// ─────────────────────────────────────────────

let isBacktesting = false;

app.post('/api/run-backtest', (req, res) => {
    if (isBacktesting) {
        return res.status(400).json({ success: false, error: 'Backtest is already running' });
    }
    isBacktesting = true;
    console.log('[Backtest] Triggered via web UI');
    const { exec } = require('child_process');
    exec('node scripts/run_historical_backtest.js', (error, stdout, stderr) => {
        isBacktesting = false;
        if (error) {
            console.error(`[Backtest] Error during UI-triggered run: ${error.message}`);
        } else {
            console.log('[Backtest] UI-triggered run finished successfully');
        }
    });
    res.json({ success: true, message: 'Backtest started in background' });
});

app.get('/api/backtest-status', (req, res) => {
    res.json({ success: true, running: isBacktesting });
});

// ─────────────────────────────────────────────
// SCANNER CONFIG — change asset class / interval
// ─────────────────────────────────────────────

app.post('/api/intraday-config', async (req, res) => {
    const { assetClass, interval } = req.body;
    if (!assetClass || !interval) {
        return res.status(400).json({ error: 'assetClass and interval are required' });
    }

    console.log(`[Config] Change requested: ${assetClass} at ${interval}m`);

    try {
        if (intradayClients.length > 0) {
            await startIntradayScanner(
                assetClass, interval,
                (alert) => broadcastIntraday({ alert }),
                (states) => broadcastIntraday({ states, marketHealth: getMarketHealth() })
            );
        } else {
            await startIntradayScanner(assetClass, interval, null, null);
            await stopIntradayScanner();
        }
        res.json({ success: true, state: getScannerState() });
    } catch (err) {
        console.error('[Config] Error updating config:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`\n🚀 Trading Dashboard running on http://localhost:${PORT}`);
    console.log(`   Strategy: Gap & Fade Short | Indian Stocks (12 liquid)\n`);
});