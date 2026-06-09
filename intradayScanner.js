const { chromium } = require('playwright');
const {
    processCandlesAndGetState,
    detectGapFadeShort,
    analyzeMarketHealth,
    calculateVWAP,
    getPrevDayData,
    getDailyRSI,
    getConsecutiveRedDays,
    parseTradingViewWS
} = require('./scanner');

// ─────────────────────────────────────────────
// STOCK LISTS
// Indian list trimmed to 12 most liquid stocks
// + NIFTY as hidden market health tab
// ─────────────────────────────────────────────

const NIFTY_SYMBOL = { symbol: 'NSE:NIFTY', name: 'NIFTY 50 (Market Health)' };

const STOCK_LISTS = {
    // 12 most liquid Indian stocks for gap fade strategy
    INDIAN_STOCKS: [
        { symbol: 'NSE:RELIANCE', name: 'Reliance Industries' },
        { symbol: 'NSE:HDFCBANK', name: 'HDFC Bank' },
        { symbol: 'NSE:ICICIBANK', name: 'ICICI Bank' },
        { symbol: 'NSE:INFY', name: 'Infosys' },
        { symbol: 'NSE:TCS', name: 'TCS' },
        { symbol: 'NSE:SBIN', name: 'State Bank of India' },
        { symbol: 'NSE:AXISBANK', name: 'Axis Bank' },
        { symbol: 'NSE:BAJFINANCE', name: 'Bajaj Finance' },
        { symbol: 'NSE:MARUTI', name: 'Maruti Suzuki' },
        { symbol: 'NSE:TATAMOTORS', name: 'Tata Motors' },
        { symbol: 'NSE:LT', name: 'Larsen & Toubro' },
        { symbol: 'NSE:KOTAKBANK', name: 'Kotak Mahindra Bank' }
    ],
    US_STOCKS: [
        { symbol: 'NASDAQ:AAPL', name: 'Apple Inc.' },
        { symbol: 'NASDAQ:MSFT', name: 'Microsoft Corp.' },
        { symbol: 'NASDAQ:NVDA', name: 'NVIDIA Corp.' },
        { symbol: 'NASDAQ:AMZN', name: 'Amazon.com Inc.' },
        { symbol: 'NASDAQ:META', name: 'Meta Platforms' },
        { symbol: 'NASDAQ:GOOGL', name: 'Alphabet Inc.' },
        { symbol: 'NASDAQ:TSLA', name: 'Tesla Inc.' },
        { symbol: 'NASDAQ:AMD', name: 'Advanced Micro Devices' },
        { symbol: 'NASDAQ:NFLX', name: 'Netflix Inc.' },
        { symbol: 'NYSE:JPM', name: 'JPMorgan Chase' }
    ],
    CRYPTO: [
        { symbol: 'BINANCE:BTCUSDT', name: 'Bitcoin / USDT' },
        { symbol: 'BINANCE:ETHUSDT', name: 'Ethereum / USDT' },
        { symbol: 'BINANCE:SOLUSDT', name: 'Solana / USDT' },
        { symbol: 'BINANCE:ADAUSDT', name: 'Cardano / USDT' },
        { symbol: 'BINANCE:XRPUSDT', name: 'XRP / USDT' },
        { symbol: 'BINANCE:DOGEUSDT', name: 'Dogecoin / USDT' },
        { symbol: 'BINANCE:DOTUSDT', name: 'Polkadot / USDT' },
        { symbol: 'BINANCE:AVAXUSDT', name: 'Avalanche / USDT' },
        { symbol: 'BINANCE:LINKUSDT', name: 'Chainlink / USDT' },
        { symbol: 'BINANCE:MATICUSDT', name: 'Polygon / USDT' }
    ]
};

// ─────────────────────────────────────────────
// STATE VARIABLES
// ─────────────────────────────────────────────

const EventEmitter = require('events');
const scannerEmitter = new EventEmitter();

let browser = null;
let currentAssetClass = 'INDIAN_STOCKS';
let currentInterval = '5';
let activePages = [];

// Per-stock scan state shown on dashboard
// Shape: { symbol, name, price, trend, rsi, gapPercent, gapFadeSignal,
//          vwap, prevDayClose, prevDayHigh, dailyRSI, consecutiveRedDays,
//          status, lastSignal, marketAlignment }
let scanStates = {};

// Raw candle cache per symbol (used by focus-mode SSE reuse)
let candlesCache = {};

// Live alerts list (recent signals)
let activeAlerts = [];

// Persistent daily ledger (survives page refreshes)
let dailyLedger = [];

// NIFTY market health — shared across all stocks
let marketHealth = {
    status: 'UNKNOWN',
    label: 'Loading NIFTY...',
    shortFriendly: false,
    gapPercent: null,
    rsi: null,
    currentPrice: null,
    vwap: null,
    isFading: null,
    belowVWAP: null
};

// NIFTY raw candles cache
let niftyCandles = [];

// NIFTY futures OI data (from NSE:NIFTY1! tab)
// Each entry: { time, oi, price }
let niftyOIHistory = [];
let latestNiftyOI = null;

// ─────────────────────────────────────────────
// HELPER: IST time check
// ─────────────────────────────────────────────

function getISTTimeVal() {
    const now = new Date();
    const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    const ist = new Date(istMs);
    return ist.getUTCHours() * 100 + ist.getUTCMinutes();
}

// ─────────────────────────────────────────────
// OI ANALYSIS — interpret NIFTY futures OI trend
// Long Buildup  : price ↑, OI ↑
// Short Covering: price ↑, OI ↓
// Short Buildup : price ↓, OI ↑
// Long Unwinding: price ↓, OI ↓
// ─────────────────────────────────────────────

function interpretOITrend(oiHistory) {
    if (!oiHistory || oiHistory.length < 3) return { trend: 'UNKNOWN', label: 'Waiting for OI data...', bullish: null };

    const recent = oiHistory.slice(-6); // last 6 ticks
    const first = recent[0];
    const last = recent[recent.length - 1];

    const oiChange = last.oi - first.oi;
    const priceChange = last.price - first.price;

    const oiUp = oiChange > 0;
    const priceUp = priceChange > 0;

    if (priceUp && oiUp) return { trend: 'LONG_BUILDUP', label: '🟢 Long Buildup — bulls adding', bullish: true };
    if (priceUp && !oiUp) return { trend: 'SHORT_COVERING', label: '🟡 Short Covering — bears exiting', bullish: true };
    if (!priceUp && oiUp) return { trend: 'SHORT_BUILDUP', label: '🔴 Short Buildup — bears adding', bullish: false };
    if (!priceUp && !oiUp) return { trend: 'LONG_UNWINDING', label: '🟠 Long Unwinding — bulls exiting', bullish: false };

    return { trend: 'UNKNOWN', label: 'Insufficient OI data', bullish: null };
}

// ─────────────────────────────────────────────
// SUPPORT / RESISTANCE from NIFTY candles
// Simple: recent pivot highs and lows
// ─────────────────────────────────────────────

function getSupportResistance(candles) {
    if (!candles || candles.length < 10) return { support: null, resistance: null };

    // Use only today's candles for intraday S/R
    const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const todayStr = nowIST.toISOString().slice(0, 10);
    const todayCandles = candles.filter(c => {
        const d = new Date(new Date(c.time).getTime() + 5.5 * 60 * 60 * 1000);
        return d.toISOString().slice(0, 10) === todayStr;
    });

    if (todayCandles.length < 3) {
        // Fall back to last 20 candles across days
        const slice = candles.slice(-20);
        return {
            support: parseFloat(Math.min(...slice.map(c => c.low)).toFixed(2)),
            resistance: parseFloat(Math.max(...slice.map(c => c.high)).toFixed(2))
        };
    }

    const highs = todayCandles.map(c => c.high);
    const lows = todayCandles.map(c => c.low);

    // Pivot-style: find local high/low clusters
    const resistance = parseFloat(Math.max(...highs).toFixed(2));
    const support = parseFloat(Math.min(...lows).toFixed(2));

    // Second-level: strongest intraday cluster (most touches)
    // Simple approach — round to nearest 50 and count touches
    const roundTo50 = v => Math.round(v / 50) * 50;
    const highClusters = {};
    highs.forEach(h => { const k = roundTo50(h); highClusters[k] = (highClusters[k] || 0) + 1; });
    const topResistance = Object.entries(highClusters).sort((a, b) => b[1] - a[1])[0];

    const lowClusters = {};
    lows.forEach(l => { const k = roundTo50(l); lowClusters[k] = (lowClusters[k] || 0) + 1; });
    const topSupport = Object.entries(lowClusters).sort((a, b) => b[1] - a[1])[0];

    return {
        support: topSupport ? parseFloat(topSupport[0]) : support,
        resistance: topResistance ? parseFloat(topResistance[0]) : resistance,
        dayHigh: resistance,
        dayLow: support
    };
}

// ─────────────────────────────────────────────
// BREAK OF STRUCTURE DETECTION
// BOS = price closes beyond previous swing H/L
// ─────────────────────────────────────────────

function detectBOS(candles) {
    if (!candles || candles.length < 10) return { bos: null, label: 'Waiting for data' };

    const sorted = [...candles].sort((a, b) => new Date(a.time) - new Date(b.time));
    const recent = sorted.slice(-15); // last 15 candles

    // Swing high = highest high in first half
    // BOS bearish = current close breaks below swing low
    const mid = Math.floor(recent.length / 2);
    const leftHalf = recent.slice(0, mid);
    const rightHalf = recent.slice(mid);

    const swingHigh = Math.max(...leftHalf.map(c => c.high));
    const swingLow = Math.min(...leftHalf.map(c => c.low));
    const currentClose = rightHalf[rightHalf.length - 1].close;
    const currentHigh = rightHalf[rightHalf.length - 1].high;

    if (currentClose > swingHigh) {
        return { bos: 'BULLISH', label: `🔼 BOS Bullish — broke above ₹${swingHigh.toFixed(0)}`, level: swingHigh };
    }
    if (currentClose < swingLow) {
        return { bos: 'BEARISH', label: `🔽 BOS Bearish — broke below ₹${swingLow.toFixed(0)}`, level: swingLow };
    }

    return { bos: null, label: `Range: ₹${swingLow.toFixed(0)} – ₹${swingHigh.toFixed(0)}`, swingHigh, swingLow };
}

// ─────────────────────────────────────────────
// FULL NIFTY ANALYSIS — called by /api/nifty-analysis
// ─────────────────────────────────────────────

function getNiftyAnalysis() {
    const health = marketHealth;
    const oiTrend = interpretOITrend(niftyOIHistory);
    const sr = getSupportResistance(niftyCandles);
    const bos = detectBOS(niftyCandles);

    return {
        health,
        oiTrend,
        latestOI: latestNiftyOI,
        oiHistory: niftyOIHistory.slice(-30), // last 30 ticks for mini-chart
        supportResistance: sr,
        bos,
        candleCount: niftyCandles.length,
        lastUpdated: new Date().toISOString()
    };
}

// ─────────────────────────────────────────────
// NIFTY FUTURES TAB — scrapes NSE:NIFTY1! for OI
// Opens alongside the index tab
// ─────────────────────────────────────────────

async function startNiftyFuturesOITab(context) {
    if (!context) return;

    const page = await context.newPage();
    activePages.push(page);

    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) route.abort();
        else route.continue();
    });

    page.on('websocket', ws => {
        ws.on('framereceived', frame => {
            if (!browser) return;
            const payload = frame.payload.toString();
            const messages = parseTradingViewWS(payload);

            for (const msg of messages) {
                const processBar = (bar) => {
                    // NIFTY1! futures: v[0]=time, v[1]=open, v[2]=high, v[3]=low, v[4]=close, v[5]=volume, v[6]=OI
                    if (!bar.v || bar.v.length < 7) return;
                    const oi = bar.v[6];
                    const price = bar.v[4];
                    const time = new Date(bar.v[0] * 1000).toISOString();
                    if (oi === null || oi === undefined) return;

                    latestNiftyOI = { oi, price, time };

                    // Update or push to OI history (keyed by time)
                    const idx = niftyOIHistory.findIndex(e => e.time === time);
                    if (idx !== -1) {
                        niftyOIHistory[idx] = { time, oi, price };
                    } else {
                        niftyOIHistory.push({ time, oi, price });
                        if (niftyOIHistory.length > 200) niftyOIHistory.shift();
                    }

                    console.log(`[NIFTY-OI] OI: ${oi.toLocaleString()} | Price: ${price}`);
                };

                if (msg.m === 'timescale_update' && msg.p && msg.p[1]) {
                    const dataObj = msg.p[1];
                    for (const key in dataObj) {
                        if (dataObj[key].s) dataObj[key].s.forEach(processBar);
                    }
                }
                if (msg.m === 'du' && msg.p && msg.p[1]) {
                    const dataObj = msg.p[1];
                    for (const key in dataObj) {
                        if (dataObj[key].s) dataObj[key].s.forEach(processBar);
                    }
                }
            }
        });
    });

    // NSE:NIFTY1! = NIFTY near-month futures — has OI at bar.v[6]
    const tvUrl = `https://www.tradingview.com/chart/?symbol=NSE:NIFTY1%21&interval=${currentInterval}`;
    page.goto(tvUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(err => {
        console.error('[NIFTY-OI] Error loading futures tab:', err.message);
    });

    console.log('[NIFTY-OI] Futures OI tab started for NSE:NIFTY1!');
}

// ─────────────────────────────────────────────
// NIFTY TAB — background market health watcher
// Opens a separate headless tab for NIFTY index
// Never shown as a tradeable stock on dashboard
// ─────────────────────────────────────────────

async function startNiftyHealthTab(context) {
    if (!context) return;

    const page = await context.newPage();
    activePages.push(page);

    // Block heavy resources
    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
            route.abort();
        } else {
            route.continue();
        }
    });

    page.on('websocket', ws => {
        ws.on('framereceived', frame => {
            if (!browser) return;
            const payload = frame.payload.toString();
            const messages = parseTradingViewWS(payload);
            let updated = false;

            for (const msg of messages) {
                if (msg.m === 'timescale_update' && msg.p && msg.p[1]) {
                    const dataObj = msg.p[1];
                    for (const key in dataObj) {
                        if (dataObj[key].s) {
                            for (const bar of dataObj[key].s) {
                                if (bar.v && bar.v.length >= 6) {
                                    niftyCandles.push({
                                        time: new Date(bar.v[0] * 1000).toISOString(),
                                        open: bar.v[1], high: bar.v[2],
                                        low: bar.v[3], close: bar.v[4],
                                        volume: bar.v[5]
                                    });
                                    updated = true;
                                }
                            }
                        }
                    }
                }

                if (msg.m === 'du' && msg.p && msg.p[1]) {
                    const dataObj = msg.p[1];
                    for (const key in dataObj) {
                        if (dataObj[key].s) {
                            for (const bar of dataObj[key].s) {
                                if (bar.v && bar.v.length >= 6) {
                                    const update = {
                                        time: new Date(bar.v[0] * 1000).toISOString(),
                                        open: bar.v[1], high: bar.v[2],
                                        low: bar.v[3], close: bar.v[4],
                                        volume: bar.v[5]
                                    };
                                    const idx = niftyCandles.findIndex(c => c.time === update.time);
                                    if (idx !== -1) niftyCandles[idx] = update;
                                    else niftyCandles.push(update);
                                    updated = true;
                                }
                            }
                        }
                    }
                }
            }

            if (updated && niftyCandles.length > 0) {
                // Recompute market health every tick
                marketHealth = analyzeMarketHealth(niftyCandles);
                // Emit so any listening SSE clients get updated market health
                scannerEmitter.emit('marketHealth', marketHealth);
                console.log(`[NIFTY] ${marketHealth.label} | RSI: ${marketHealth.rsi} | Gap: ${marketHealth.gapPercent}%`);
            }
        });
    });

    const tvUrl = `https://www.tradingview.com/chart/?symbol=${NIFTY_SYMBOL.symbol}&interval=${currentInterval}`;
    page.goto(tvUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(err => {
        console.error('[NIFTY] Error loading NIFTY tab:', err.message);
    });

    console.log('[NIFTY] Market health tab started for NSE:NIFTY');
}

// ─────────────────────────────────────────────
// MAIN SCANNER START
// ─────────────────────────────────────────────

async function startIntradayScanner(assetClass, interval, onAlert, onStatusUpdate) {
    // Stop any existing scanner first
    if (browser) {
        await stopIntradayScanner();
    }

    currentAssetClass = assetClass || 'INDIAN_STOCKS';
    currentInterval = interval || '5';
    const targetStocks = STOCK_LISTS[currentAssetClass] || STOCK_LISTS.INDIAN_STOCKS;
    const isIndian = currentAssetClass === 'INDIAN_STOCKS';

    console.log(`[Scanner] Starting for ${currentAssetClass} at ${currentInterval}m interval (${targetStocks.length} stocks)...`);

    // ── Reset all state ──
    scanStates = {};
    candlesCache = {};
    niftyCandles = [];
    niftyOIHistory = [];
    latestNiftyOI = null;
    marketHealth = {
        status: 'UNKNOWN', label: 'Loading NIFTY...', shortFriendly: false,
        gapPercent: null, rsi: null, currentPrice: null, vwap: null
    };

    for (const stock of targetStocks) {
        scanStates[stock.symbol] = {
            symbol: stock.symbol,
            name: stock.name,
            price: null,
            trend: null,
            rsi: null,
            macdHist: null,
            // ── new gap fade fields ──
            gapPercent: null,
            gapStatus: null,   // 'WATCH' | 'SHORT_SETUP' | 'NO_GAP' | 'TOO_BIG'
            gapFadeSignal: null,   // full signal object from detectGapFadeShort
            vwap: null,
            prevDayClose: null,
            prevDayHigh: null,
            dailyRSI: null,
            consecutiveRedDays: null,
            marketAlignment: null,   // 'WITH_MARKET' | 'AGAINST_MARKET' | 'NEUTRAL'
            status: 'Loading 🔵',
            lastSignal: null
        };
    }

    if (onStatusUpdate) onStatusUpdate(scanStates);

    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();

        // ── Start NIFTY health tab first (only for Indian stocks) ──
        if (isIndian) {
            await startNiftyHealthTab(context);
            // Also start futures OI tab (NSE:NIFTY1!) for real OI data
            await startNiftyFuturesOITab(context);
            // Give NIFTY tabs 3 seconds head start before stocks start loading
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // ── Start one tab per stock ──
        for (let i = 0; i < targetStocks.length; i++) {
            const stock = targetStocks[i];

            // Stagger tab loading: 1.5s apart to avoid CPU/network spike
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }

            if (!browser) break; // scanner was stopped mid-load

            const page = await context.newPage();
            activePages.push(page);

            // Block heavy resources for performance
            await page.route('**/*', (route) => {
                const type = route.request().resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });

            const candles = [];
            let lastProcessedGapSignalId = null; // track so we don't re-alert same signal
            let lastProcessedAplusTime = null; // for APLUS_INTRADAY signal dedup

            page.on('websocket', ws => {
                ws.on('framereceived', frame => {
                    if (!browser) return;
                    const payload = frame.payload.toString();
                    const messages = parseTradingViewWS(payload);
                    let stateUpdated = false;

                    // ── Ingest candle data ──
                    for (const msg of messages) {
                        if (msg.m === 'timescale_update' && msg.p && msg.p[1]) {
                            const dataObj = msg.p[1];
                            for (const key in dataObj) {
                                if (dataObj[key].s) {
                                    for (const bar of dataObj[key].s) {
                                        if (bar.v && bar.v.length >= 6) {
                                            candles.push({
                                                time: new Date(bar.v[0] * 1000).toISOString(),
                                                open: bar.v[1], high: bar.v[2],
                                                low: bar.v[3], close: bar.v[4],
                                                volume: bar.v[5]
                                            });
                                            stateUpdated = true;
                                        }
                                    }
                                }
                            }
                        }

                        if (msg.m === 'du' && msg.p && msg.p[1]) {
                            const dataObj = msg.p[1];
                            for (const key in dataObj) {
                                if (dataObj[key].s) {
                                    for (const bar of dataObj[key].s) {
                                        if (bar.v && bar.v.length >= 6) {
                                            const update = {
                                                time: new Date(bar.v[0] * 1000).toISOString(),
                                                open: bar.v[1], high: bar.v[2],
                                                low: bar.v[3], close: bar.v[4],
                                                volume: bar.v[5]
                                            };
                                            const idx = candles.findIndex(c => c.time === update.time);
                                            if (idx !== -1) candles[idx] = update;
                                            else candles.push(update);
                                            stateUpdated = true;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (!stateUpdated || candles.length === 0) return;

                    // ── Cache raw candles & emit for focus-mode SSE reuse ──
                    candlesCache[stock.symbol] = [...candles];
                    scannerEmitter.emit('update', { symbol: stock.symbol, candles: [...candles] });

                    // ── Process with GAP_FADE strategy ──
                    const options = { strategy: 'GAP_FADE' };
                    const state = processCandlesAndGetState(candles, stock.symbol, currentInterval, options);

                    if (!state || !state.latest) return;

                    const cached = scanStates[stock.symbol];
                    const id = state.intradayData;

                    // ── Update basic price/trend data ──
                    cached.price = state.latest.price;
                    cached.trend = state.latest.trend;
                    cached.rsi = state.latest.rsi;
                    cached.macdHist = state.latest.macdHist;
                    cached.status = 'Scanning 🟢';

                    // ── Update intraday computed fields ──
                    cached.vwap = id.vwap;
                    cached.prevDayClose = id.prevDayClose;
                    cached.prevDayHigh = id.prevDayHigh;
                    cached.dailyRSI = id.dailyRSI;
                    cached.consecutiveRedDays = id.consecutiveRedDays;
                    cached.gapPercent = id.gapPercent;
                    cached.todayHigh = id.todayHigh;
                    cached.todayOpen = id.todayOpen;

                    // ── Determine gap status for dashboard badge ──
                    const gap = id.gapPercent;
                    if (gap === null) {
                        cached.gapStatus = 'NO_DATA';
                    } else if (gap < 1.5) {
                        cached.gapStatus = 'NO_GAP';       // gap too small
                    } else if (gap > 3.5) {
                        cached.gapStatus = 'TOO_BIG';      // gap too large, likely news
                    } else {
                        cached.gapStatus = 'WATCH';        // in our zone, monitoring
                    }

                    // ── Market alignment check ──
                    // Tells user if this stock is fading WITH or AGAINST market
                    if (marketHealth.status === 'UNKNOWN' || marketHealth.status === 'NEUTRAL') {
                        cached.marketAlignment = 'NEUTRAL';
                    } else if (marketHealth.shortFriendly) {
                        // Market is weak/bearish — shorting is WITH market
                        cached.marketAlignment = 'WITH_MARKET';
                    } else {
                        // Market is strong — shorting is AGAINST market
                        cached.marketAlignment = 'AGAINST_MARKET';
                    }

                    // ── Gap Fade Short Signal Detection ──
                    const gapFade = id.gapFadeSignal;
                    cached.gapFadeSignal = gapFade; // always update (null if conditions not met)

                    if (gapFade) {
                        // Upgrade gap status if signal is confirmed
                        cached.gapStatus = 'SHORT_SETUP';

                        // Build a unique ID for this signal to avoid duplicate alerts
                        const signalId = `${stock.symbol}_gap_${gapFade.gapPercent}_${gapFade.currentPrice}`;

                        if (signalId !== lastProcessedGapSignalId) {
                            lastProcessedGapSignalId = signalId;

                            // Only alert if NIFTY is not strongly bullish
                            // (still alert even if NEUTRAL, just add a caution label)
                            const marketBlocking = marketHealth.status === 'STRONG';

                            if (!marketBlocking) {
                                const alertObj = {
                                    id: signalId,
                                    symbol: stock.symbol,
                                    name: stock.name,
                                    type: 'GAP_FADE_SHORT',
                                    price: gapFade.currentPrice,
                                    time: new Date().toISOString(),

                                    // Trade levels
                                    gapPercent: gapFade.gapPercent,
                                    entryZoneLow: gapFade.entryZoneLow,
                                    entryZoneHigh: gapFade.entryZoneHigh,
                                    slApprox: gapFade.slApprox,
                                    target1: gapFade.target1,
                                    target2: gapFade.target2,

                                    // Context
                                    vwap: gapFade.vwap,
                                    rsi5min: gapFade.rsi5min,
                                    dailyRSI: gapFade.dailyRSI,
                                    confidence: gapFade.confidence,
                                    bounceRisk: gapFade.bounceRisk,
                                    warnings: gapFade.warnings,
                                    marketHealth: marketHealth.label,
                                    marketFriendly: marketHealth.shortFriendly,
                                    marketAlignment: cached.marketAlignment,
                                    consecutiveRedDays: gapFade.consecutiveRedDays
                                };

                                // Store in active alerts
                                if (!activeAlerts.some(a => a.id === alertObj.id)) {
                                    activeAlerts.unshift(alertObj);
                                    if (activeAlerts.length > 50) activeAlerts.pop();

                                    // Persist to daily ledger
                                    dailyLedger.unshift(alertObj);
                                    if (dailyLedger.length > 1000) dailyLedger.pop();

                                    // Store as last signal on this stock
                                    cached.lastSignal = alertObj;

                                    if (onAlert) onAlert(alertObj);

                                    console.log(`[SIGNAL] GAP_FADE_SHORT: ${stock.symbol} | Gap: ${gapFade.gapPercent}% | Entry: ${gapFade.currentPrice} | SL: ${gapFade.slApprox} | T1: ${gapFade.target1} | Confidence: ${gapFade.confidence} | Market: ${marketHealth.label}`);
                                }
                            } else {
                                console.log(`[SIGNAL BLOCKED] ${stock.symbol} — market is STRONG, skipping short signal`);
                            }
                        }
                    }

                    // ── Broadcast updated scan states to all SSE clients ──
                    if (onStatusUpdate) onStatusUpdate(scanStates);
                });
            });

            // Navigate to TradingView chart
            const tvUrl = `https://www.tradingview.com/chart/?symbol=${stock.symbol}&interval=${currentInterval}`;
            page.goto(tvUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(err => {
                console.error(`[Scanner] Error loading ${stock.symbol}:`, err.message);
                if (scanStates[stock.symbol]) {
                    scanStates[stock.symbol].status = 'Error 🔴';
                    if (onStatusUpdate) onStatusUpdate(scanStates);
                }
            });
        }

    } catch (error) {
        console.error('[Scanner] Critical error:', error);
        await stopIntradayScanner();
    }
}

// ─────────────────────────────────────────────
// STOP SCANNER
// ─────────────────────────────────────────────

async function stopIntradayScanner() {
    console.log('[Scanner] Stopping...');
    activePages = [];
    niftyCandles = [];
    niftyOIHistory = [];
    latestNiftyOI = null;

    if (browser) {
        const activeBrowser = browser;
        browser = null; // mark closed before awaiting to prevent race
        try { await activeBrowser.close(); } catch (e) { }
    }

    for (const key in scanStates) {
        scanStates[key].status = 'Stopped 🔘';
    }
}

// ─────────────────────────────────────────────
// STATE GETTERS
// ─────────────────────────────────────────────

function getScannerState() {
    return {
        assetClass: currentAssetClass,
        interval: currentInterval,
        scanStates,
        activeAlerts,
        marketHealth  // ← now included so frontend always has NIFTY data
    };
}

function getMarketHealth() {
    return marketHealth;
}

function getDailyLedger() {
    return dailyLedger;
}

// ─────────────────────────────────────────────
// HOLD MONITORING HELPER
// Called when user is in a trade and wants
// the app to watch for exit conditions
// Returns an exit alert if conditions are met
// ─────────────────────────────────────────────

function checkExitConditions(symbol, tradeType, entryPrice) {
    const candles = candlesCache[symbol];
    if (!candles || candles.length === 0) return null;

    const sorted = [...candles].sort((a, b) => new Date(a.time) - new Date(b.time));
    const latest = sorted[sorted.length - 1];
    const currentPrice = latest.close;

    const vwap = calculateVWAP(sorted);
    const prevDay = getPrevDayData(sorted);

    const istTimeVal = getISTTimeVal();

    // ── Exit conditions for SHORT trade ──
    if (tradeType === 'SHORT') {
        const reasons = [];

        // Price moved back above today's open — fade failed
        const todaySorted = sorted.filter(c => {
            const ms = new Date(c.time).getTime() + (5.5 * 60 * 60 * 1000);
            const d = new Date(ms);
            return d.toISOString().slice(0, 10) === new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
        });
        if (todaySorted.length > 0) {
            const todayOpen = todaySorted[0].open;
            if (currentPrice > todayOpen) reasons.push('Price reclaimed today\'s open — fade failed');
        }

        // RSI turning back up strongly
        const prices = sorted.map(c => c.close);
        const { calculateRSI: rsiCalc } = require('./scanner');
        // We use the exported one from scanner
        if (latest.rsi && latest.rsi > 62) reasons.push(`RSI ${latest.rsi} turning bullish`);

        // NIFTY suddenly strong
        if (marketHealth.status === 'STRONG') reasons.push('Market (NIFTY) turned strongly bullish');

        // Time-based exit reminder
        if (istTimeVal >= 1430 && istTimeVal <= 1445) reasons.push('Market closing in ~45 minutes — consider booking');
        if (istTimeVal >= 1500) reasons.push('Market closing in ~15 minutes — exit now');

        // Profit lock: price near target 1 (VWAP)
        const profitPct = ((entryPrice - currentPrice) / entryPrice) * 100;
        if (vwap && currentPrice <= vwap * 1.002) reasons.push(`Price near Target 1 (VWAP ₹${vwap?.toFixed(2)}) — consider partial booking`);

        // Full gap fill
        if (prevDay && currentPrice <= prevDay.close * 1.002) reasons.push(`Price near Target 2 (Gap fill ₹${prevDay?.close?.toFixed(2)}) — consider full exit`);

        if (reasons.length > 0) {
            return {
                symbol,
                tradeType,
                currentPrice,
                entryPrice,
                profitPct: parseFloat(profitPct.toFixed(2)),
                vwap,
                reasons,
                urgency: reasons.some(r => r.includes('closing')) ? 'HIGH' : 'MEDIUM'
            };
        }
    }

    return null;
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
    startIntradayScanner,
    stopIntradayScanner,
    getScannerState,
    getMarketHealth,
    getNiftyAnalysis,
    getDailyLedger,
    checkExitConditions,
    STOCK_LISTS,
    NIFTY_SYMBOL,
    scannerEmitter,
    candlesCache
};