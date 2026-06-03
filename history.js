const { chromium } = require('playwright');
const fs = require('fs');

// Parser for TradingView's custom WebSocket protocol: ~m~[length]~m~[JSON]
function parseTradingViewWS(payload) {
    const messages = [];
    let remaining = payload;
    while (remaining) {
        const match = remaining.match(/^~m~(\d+)~m~/);
        if (!match) break;
        const header = match[0];
        const length = parseInt(match[1], 10);
        const jsonStr = remaining.substring(header.length, header.length + length);
        try {
            messages.push(JSON.parse(jsonStr));
        } catch (e) {
            // Ignore non-JSON or heartbeat ping-pongs
        }
        remaining = remaining.substring(header.length + length);
    }
    return messages;
}

(async () => {
    // Launch headless browser to capture data silently and efficiently
    const browser = await chromium.launch({
        headless: true
    });

    const page = await browser.newPage();
    const candles = [];

    console.log("Analyzing TradingView WebSocket connection...");

    page.on('websocket', ws => {
        ws.on('framereceived', frame => {
            const payload = frame.payload.toString();
            const messages = parseTradingViewWS(payload);

            for (const msg of messages) {
                // 1. Initial history chunk usually arrives in "timescale_update"
                if (msg.m === 'timescale_update' && msg.p && msg.p[1]) {
                    const dataObj = msg.p[1];
                    for (const key in dataObj) {
                        if (dataObj[key].s) {
                            for (const bar of dataObj[key].s) {
                                // bar.v structure is: [timestamp, open, high, low, close, volume]
                                if (bar.v && bar.v.length >= 6) {
                                    candles.push({
                                        time: new Date(bar.v[0] * 1000).toISOString(),
                                        open: bar.v[1],
                                        high: bar.v[2],
                                        low: bar.v[3],
                                        close: bar.v[4],
                                        volume: bar.v[5]
                                    });
                                }
                            }
                        }
                    }
                }
                
                // 2. Real-time updates arrive in "du" (data update)
                if (msg.m === 'du' && msg.p && msg.p[1]) {
                    const dataObj = msg.p[1];
                    for (const key in dataObj) {
                        if (dataObj[key].s) {
                            for (const bar of dataObj[key].s) {
                                if (bar.v && bar.v.length >= 6) {
                                    const update = {
                                        time: new Date(bar.v[0] * 1000).toISOString(),
                                        open: bar.v[1],
                                        high: bar.v[2],
                                        low: bar.v[3],
                                        close: bar.v[4],
                                        volume: bar.v[5]
                                    };
                                    // Update last candle or push if new
                                    const existingIndex = candles.findIndex(c => c.time === update.time);
                                    if (existingIndex !== -1) {
                                        candles[existingIndex] = update;
                                    } else {
                                        candles.push(update);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
    });

    // Go to TradingView chart
    await page.goto('https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT');

    // Wait for the websocket connection to establish and transfer all historical bars
    console.log("Loading historical price bars...");
    await page.waitForTimeout(15000);

    // Helper to calculate Weighted Moving Average (WMA)
    function calculateWMA(data, period) {
        const wma = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) {
                wma.push(null);
                continue;
            }
            let sum = 0;
            let weightSum = 0;
            for (let j = 0; j < period; j++) {
                const price = data[i - j];
                const weight = period - j;
                sum += price * weight;
                weightSum += weight;
            }
            wma.push(sum / weightSum);
        }
        return wma;
    }

    // Calculate Hull Moving Average (HMA)
    function calculateHMA(prices, period) {
        const halfPeriod = Math.floor(period / 2);
        const sqrtPeriod = Math.floor(Math.sqrt(period));

        const wmaHalf = calculateWMA(prices, halfPeriod);
        const wmaFull = calculateWMA(prices, period);

        const rawHMA = [];
        for (let i = 0; i < prices.length; i++) {
            if (wmaHalf[i] === null || wmaFull[i] === null) {
                rawHMA.push(null);
            } else {
                rawHMA.push(2 * wmaHalf[i] - wmaFull[i]);
            }
        }

        const hma = [];
        for (let i = 0; i < prices.length; i++) {
            if (i < period - 1 + sqrtPeriod - 1) {
                hma.push(null);
                continue;
            }
            let sum = 0;
            let weightSum = 0;
            let valid = true;
            for (let j = 0; j < sqrtPeriod; j++) {
                const val = rawHMA[i - j];
                if (val === null) {
                    valid = false;
                    break;
                }
                const weight = sqrtPeriod - j;
                sum += val * weight;
                weightSum += weight;
            }
            hma.push(valid ? sum / weightSum : null);
        }
        return hma;
    }

    if (candles.length > 0) {
        // Sort chronologically
        candles.sort((a, b) => new Date(a.time) - new Date(b.time));

        console.log(`\nSuccessfully captured ${candles.length} historical bars!`);

        // Compute Indicators
        const prices = candles.map(c => c.close);
        const hmaPeriod = 16;
        const hmaValues = calculateHMA(prices, hmaPeriod);

        let prevColor = null;
        const signals = [];

        for (let i = 0; i < candles.length; i++) {
            const currentHMA = hmaValues[i];
            candles[i].hma = currentHMA !== null ? parseFloat(currentHMA.toFixed(2)) : null;
            candles[i].hmaColor = null;
            candles[i].signal = null;

            if (currentHMA !== null && i > 0 && hmaValues[i - 1] !== null) {
                const prevHMA = hmaValues[i - 1];
                const color = currentHMA > prevHMA ? 'GREEN' : 'RED';
                candles[i].hmaColor = color;

                if (prevColor && color !== prevColor) {
                    candles[i].signal = color === 'GREEN' ? 'BUY' : 'SELL';
                    signals.push({
                        time: candles[i].time,
                        price: candles[i].close,
                        type: candles[i].signal,
                        hma: candles[i].hma
                    });
                }
                prevColor = color;
            }
        }

        // Output dashboard
        console.log("\n=======================================================");
        console.log("             HULL MOVING AVERAGE DASHBOARD             ");
        console.log("=======================================================");
        console.log(`Analyzing HMA (Period: ${hmaPeriod}) over ${candles.length} Candles...`);

        console.log("\n[LATEST 5 COMPLETED SIGNALS]");
        console.table(signals.slice(-5));

        console.log("\n[CURRENT MARKET STATE]");
        const latest = candles[candles.length - 1];
        console.log(`Time:    ${latest.time}`);
        console.log(`Price:   $${latest.close.toLocaleString()}`);
        console.log(`HMA:     $${latest.hma ? latest.hma.toLocaleString() : 'N/A'}`);
        console.log(`Trend:   ${latest.hmaColor === 'GREEN' ? '🟢 BULLISH (Upward)' : '🔴 BEARISH (Downward)'}`);
        console.log(`Signal:  ${latest.signal ? `🚨 ${latest.signal} SIGNAL!` : 'No new trend change'}`);
        console.log("=======================================================");

        // Save enriched candles data to JSON
        fs.writeFileSync('btc_history.json', JSON.stringify(candles, null, 2));
        console.log("\nSaved enriched history to 'btc_history.json'");
    } else {
        console.log("No candle data captured. Ensure you are visiting a chart page.");
    }

    await browser.close();
})();