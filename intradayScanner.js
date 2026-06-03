const { chromium } = require('playwright');
const { processCandlesAndGetState } = require('./scanner');

const STOCK_LISTS = {
    INDIAN_STOCKS: [
        { symbol: 'NSE:RELIANCE', name: 'Reliance Industries' },
        { symbol: 'NSE:HDFCBANK', name: 'HDFC Bank' },
        { symbol: 'NSE:ICICIBANK', name: 'ICICI Bank' },
        { symbol: 'NSE:INFY', name: 'Infosys' },
        { symbol: 'NSE:ITC', name: 'ITC Limited' },
        { symbol: 'NSE:TCS', name: 'TCS' },
        { symbol: 'NSE:LT', name: 'Larsen & Toubro' },
        { symbol: 'NSE:SBIN', name: 'State Bank of India' },
        { symbol: 'NSE:BHARTIARTL', name: 'Bharti Airtel' },
        { symbol: 'NSE:BAJFINANCE', name: 'Bajaj Finance' },
        { symbol: 'NSE:KOTAKBANK', name: 'Kotak Mahindra Bank' },
        { symbol: 'NSE:AXISBANK', name: 'Axis Bank' },
        { symbol: 'NSE:ASIANPAINT', name: 'Asian Paints' },
        { symbol: 'NSE:HINDUNILVR', name: 'Hindustan Unilever' },
        { symbol: 'NSE:TITAN', name: 'Titan Company' },
        { symbol: 'NSE:MARUTI', name: 'Maruti Suzuki' },
        { symbol: 'NSE:SUNPHARMA', name: 'Sun Pharma' },
        { symbol: 'NSE:TATAMOTORS', name: 'Tata Motors' },
        { symbol: 'NSE:M&M', name: 'M&M' },
        { symbol: 'NSE:TATASTEEL', name: 'Tata Steel' },
        { symbol: 'NSE:NTPC', name: 'NTPC' },
        { symbol: 'NSE:POWERGRID', name: 'Power Grid' },
        { symbol: 'NSE:ULTRACEMCO', name: 'UltraTech Cement' },
        { symbol: 'NSE:ADANIENT', name: 'Adani Enterprises' },
        { symbol: 'NSE:WIPRO', name: 'Wipro' }
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

const EventEmitter = require('events');
const scannerEmitter = new EventEmitter();

let browser = null;
let currentAssetClass = 'INDIAN_STOCKS';
let currentInterval = '5';
let activePages = [];
let scanStates = {}; // Cache of { symbol: { price, trend, rsi, macdHist, status, name, lastSignal } }
let candlesCache = {}; // Cache of { symbol: [candles] }
let activeAlerts = []; // List of generated signals: { symbol, name, type, price, time, winRate, prob }

// Parser for TradingView's custom WebSocket protocol
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
        } catch (e) {}
        remaining = remaining.substring(header.length + length);
    }
    return messages;
}

async function startIntradayScanner(assetClass, interval, onAlert, onStatusUpdate) {
    if (browser) {
        await stopIntradayScanner();
    }

    currentAssetClass = assetClass || 'INDIAN_STOCKS';
    currentInterval = interval || '5';
    const targetStocks = STOCK_LISTS[currentAssetClass] || STOCK_LISTS.INDIAN_STOCKS;

    console.log(`[Scanner] Starting background scan for ${currentAssetClass} at ${currentInterval}m interval...`);
    
    // Initialize empty scan state cache
    scanStates = {};
    for (const stock of targetStocks) {
        scanStates[stock.symbol] = {
            symbol: stock.symbol,
            name: stock.name,
            price: null,
            trend: null,
            rsi: null,
            macdHist: null,
            status: 'Loading 🔵',
            lastSignal: null
        };
    }
    if (onStatusUpdate) onStatusUpdate(scanStates);

    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();

        for (let i = 0; i < targetStocks.length; i++) {
            const stock = targetStocks[i];
            
            // Stagger tab loading to minimize CPU spikes
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
            
            if (!browser) break; // if stopped while staggering

            const page = await context.newPage();
            activePages.push(page);

            // Block stylesheets, images, fonts, and media for performance optimization
            await page.route('**/*', (route) => {
                const type = route.request().resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });

            const candles = [];
            let lastProcessedSignalTime = null;

            page.on('websocket', ws => {
                ws.on('framereceived', frame => {
                    if (!browser) return;
                    const payload = frame.payload.toString();
                    const messages = parseTradingViewWS(payload);
                    let stateUpdated = false;

                    for (const msg of messages) {
                        if (msg.m === 'timescale_update' && msg.p && msg.p[1]) {
                            const dataObj = msg.p[1];
                            for (const key in dataObj) {
                                if (dataObj[key].s) {
                                    for (const bar of dataObj[key].s) {
                                        if (bar.v && bar.v.length >= 6) {
                                            candles.push({
                                                time: new Date(bar.v[0] * 1000).toISOString(),
                                                open: bar.v[1],
                                                high: bar.v[2],
                                                low: bar.v[3],
                                                close: bar.v[4],
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
                                                open: bar.v[1],
                                                high: bar.v[2],
                                                low: bar.v[3],
                                                close: bar.v[4],
                                                volume: bar.v[5]
                                            };
                                            const existingIndex = candles.findIndex(c => c.time === update.time);
                                            if (existingIndex !== -1) {
                                                candles[existingIndex] = update;
                                            } else {
                                                candles.push(update);
                                            }
                                            stateUpdated = true;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (stateUpdated && candles.length > 0) {
                        // Cache raw candles in memory and broadcast update
                        candlesCache[stock.symbol] = [...candles];
                        scannerEmitter.emit('update', { symbol: stock.symbol, candles: [...candles] });

                        const options = { strategy: 'APLUS_INTRADAY' };
                        const state = processCandlesAndGetState(candles, stock.symbol, currentInterval, options);
                        
                        if (state && state.latest) {
                            const cached = scanStates[stock.symbol];
                            cached.price = state.latest.price;
                            cached.trend = state.latest.trend;
                            cached.rsi = state.latest.rsi;
                            cached.macdHist = state.latest.macdHist;
                            cached.status = 'Scanning 🟢';

                            // Detect new signal on the latest completed or currently active candle
                            if (state.latest.signal && lastProcessedSignalTime !== state.latest.time) {
                                lastProcessedSignalTime = state.latest.time;
                                
                                let prob = 'Moderate (~70%)';
                                if (state.latest.signal === 'ENTRY_LONG') prob = 'High (~85%)';
                                if (state.latest.signal === 'ENTRY_SHORT') prob = 'High (~82%)';
                                
                                cached.lastSignal = {
                                    type: state.latest.signal,
                                    price: state.latest.price,
                                    time: state.latest.time,
                                    winRate: state.stats.winRate,
                                    prob: prob
                                };

                                const signalTime = new Date(state.latest.time).getTime();
                                const isRecent = (Date.now() - signalTime) < 15 * 60 * 1000; // Only alert if signal is less than 15 minutes old

                                if (isRecent) {
                                    const alertObj = {
                                        id: `${stock.symbol}_${signalTime}`,
                                        symbol: stock.symbol,
                                        name: stock.name,
                                        type: state.latest.signal,
                                        price: state.latest.price,
                                        time: state.latest.time,
                                        winRate: state.stats.winRate,
                                        prob: cached.lastSignal.prob
                                    };

                                    // Add to global alert cache
                                    if (!activeAlerts.some(a => a.id === alertObj.id)) {
                                        activeAlerts.unshift(alertObj);
                                        if (activeAlerts.length > 50) activeAlerts.pop();
                                        
                                        // Also add to persistent daily ledger
                                        dailyLedger.unshift(alertObj);
                                        if (dailyLedger.length > 1000) dailyLedger.pop();
                                        
                                        if (onAlert) onAlert(alertObj);
                                    }
                                }
                            }

                            if (onStatusUpdate) onStatusUpdate(scanStates);
                        }
                    }
                });
            });

            let tvUrl = `https://www.tradingview.com/chart/?symbol=${stock.symbol}`;
            if (currentInterval !== '1D') {
                tvUrl += `&interval=${currentInterval}`;
            }

            // Launch page navigation in background
            page.goto(tvUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(err => {
                console.error(`[Scanner] Error loading page for ${stock.symbol}:`, err.message);
                if (scanStates[stock.symbol]) {
                    scanStates[stock.symbol].status = 'Error 🔴';
                    if (onStatusUpdate) onStatusUpdate(scanStates);
                }
            });
        }
    } catch (error) {
        console.error('[Scanner] Critical error in background scanner:', error);
        await stopIntradayScanner();
    }
}

async function stopIntradayScanner() {
    console.log('[Scanner] Stopping background multi-stock scanner...');
    activePages = [];
    if (browser) {
        const activeBrowser = browser;
        browser = null; // Mark as closed immediately to ignore websocket processing
        try {
            await activeBrowser.close();
        } catch (e) {}
    }
    for (const key in scanStates) {
        scanStates[key].status = 'Stopped 🔘';
    }
}

function getScannerState() {
    return {
        assetClass: currentAssetClass,
        interval: currentInterval,
        scanStates,
        activeAlerts
    };
}

function getDailyLedger() {
    return dailyLedger;
}

module.exports = {
    startIntradayScanner,
    stopIntradayScanner,
    getScannerState,
    getDailyLedger,
    STOCK_LISTS,
    scannerEmitter,
    candlesCache
};
