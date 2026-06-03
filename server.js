const express = require('express');
const path = require('path');
const { streamSymbol, processCandlesAndGetState } = require('./scanner');
const { startIntradayScanner, stopIntradayScanner, getScannerState, scannerEmitter, candlesCache } = require('./intradayScanner');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Single Symbol SSE Stream
app.get('/api/stream', async (req, res) => {
    const symbol = req.query.symbol;
    const interval = req.query.interval || '1D';
    const strategy = req.query.strategy || 'HMA_SLOPE';
    const period = parseInt(req.query.period) || 16;
    const fastPeriod = parseInt(req.query.fastPeriod) || 9;
    const slowPeriod = parseInt(req.query.slowPeriod) || 21;
    const useHeikinAshi = req.query.useHeikinAshi === 'true';
    const confirmations = req.query.confirmations ? req.query.confirmations.split(',') : [];

    if (!symbol) {
        return res.status(400).json({ error: 'Symbol is required' });
    }

    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE

    // Check if background scanner is running and already scanning this symbol at this interval
    const bState = getScannerState();
    const isScannedByBackground = bState.scanStates[symbol] !== undefined && bState.interval === interval;

    if (isScannedByBackground && candlesCache[symbol] && candlesCache[symbol].length > 0) {
        console.log(`[SSE] Reusing active background stream for ${symbol} at ${interval}`);
        
        const sendUpdate = (candlesData) => {
            const state = processCandlesAndGetState(candlesData, symbol, interval, {
                strategy,
                period,
                fastPeriod,
                slowPeriod,
                useHeikinAshi,
                confirmations
            });
            if (state) {
                try {
                    res.write(`data: ${JSON.stringify(state)}\n\n`);
                } catch (e) {
                    console.error('[SSE] Failed to write shared update to res:', e.message);
                }
            }
        };

        // Immediately send the first state from memory cache
        sendUpdate(candlesCache[symbol]);

        // Register listener for live ticks on this symbol
        const updateListener = (data) => {
            if (data.symbol === symbol) {
                sendUpdate(data.candles);
            }
        };

        scannerEmitter.on('update', updateListener);

        req.on('close', () => {
            console.log(`[SSE] Disconnected shared stream: ${symbol}`);
            scannerEmitter.off('update', updateListener);
        });
        return;
    }

    console.log(`[SSE] Client connected (New browser tap): ${symbol} at ${interval} with strategy ${strategy}`);

    let cleanupStream = null;

    try {
        const options = { strategy, period, fastPeriod, slowPeriod, useHeikinAshi, confirmations };
        cleanupStream = await streamSymbol(symbol, interval, options, (state) => {
            // Send the updated state to the client
            res.write(`data: ${JSON.stringify(state)}\n\n`);
        });
    } catch (error) {
        console.error('[SSE] Error starting stream:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }

    // Handle client disconnect
    req.on('close', async () => {
        console.log(`[SSE] Client disconnected (New browser tap): ${symbol}`);
        if (cleanupStream) {
            await cleanupStream();
        }
    });
});

// Intraday Multi-Stock SSE Stream
let intradayClients = [];

function broadcastIntraday(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    intradayClients.forEach(client => {
        try {
            client.write(payload);
        } catch (e) {
            console.error('[SSE-Intraday] Error writing to client:', e.message);
        }
    });
}

app.get('/api/intraday-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    console.log('[SSE-Intraday] Client connected to multi-stock scanner');
    intradayClients.push(res);

    // Immediately send the current cached states and alerts to the newly connected client
    const currentState = getScannerState();
    res.write(`data: ${JSON.stringify({ states: currentState.scanStates, alerts: currentState.activeAlerts })}\n\n`);

    // If this is the first client, start the background browser scanner
    if (intradayClients.length === 1) {
        const config = getScannerState();
        startIntradayScanner(
            config.assetClass,
            config.interval,
            (alert) => broadcastIntraday({ alert }),
            (states) => broadcastIntraday({ states })
        ).catch(err => {
            console.error('[SSE-Intraday] Error starting scanner:', err);
        });
    }

    req.on('close', async () => {
        console.log('[SSE-Intraday] Client disconnected');
        intradayClients = intradayClients.filter(c => c !== res);

        // If no clients are active, shutdown the Playwright background tabs to save resources
        if (intradayClients.length === 0) {
            await stopIntradayScanner();
        }
    });
});

app.get('/api/daily-ledger', (req, res) => {
    try {
        const { getDailyLedger } = require('./intradayScanner');
        res.json({ success: true, ledger: getDailyLedger() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Configure Background Scanner Settings
app.post('/api/intraday-config', async (req, res) => {
    const { assetClass, interval } = req.body;
    if (!assetClass || !interval) {
        return res.status(400).json({ error: 'assetClass and interval are required' });
    }

    console.log(`[SSE-Intraday] Config change requested: ${assetClass} at ${interval}m`);

    try {
        if (intradayClients.length > 0) {
            // Scanner is active, restart it with new config
            await startIntradayScanner(
                assetClass,
                interval,
                (alert) => broadcastIntraday({ alert }),
                (states) => broadcastIntraday({ states })
            );
        } else {
            // Scanner is idle, just update state variables by running the startup / shutdown sequence
            await startIntradayScanner(assetClass, interval, null, null);
            await stopIntradayScanner();
        }
        res.json({ success: true, state: getScannerState() });
    } catch (err) {
        console.error('[SSE-Intraday] Error updating config:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Live Streaming Dashboard running on http://localhost:${PORT}`);
});
