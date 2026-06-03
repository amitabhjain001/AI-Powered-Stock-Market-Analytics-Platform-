const { chromium } = require('playwright');

// Helper to check if a signal falls within active liquid intraday trading hours
function isValidTradingTime(symbol, isoTimeString) {
    const date = new Date(isoTimeString);
    
    // Indian Stocks (IST = UTC + 5:30)
    if (symbol.startsWith('NSE:') || symbol.startsWith('BSE:')) {
        const localTimeMs = date.getTime() + (5.5 * 60 * 60 * 1000);
        const istDate = new Date(localTimeMs);
        const hours = istDate.getUTCHours();
        const minutes = istDate.getUTCMinutes();
        const timeVal = hours * 100 + minutes; // e.g. 1230 for 12:30 PM
        
        // Restrict signals to morning session only: 9:20 AM - 12:30 PM IST
        return timeVal >= 920 && timeVal <= 1230;
    }
    
    // US Stocks (EST/EDT = America/New_York timezone)
    if (symbol.startsWith('NASDAQ:') || symbol.startsWith('NYSE:')) {
        try {
            const estString = date.toLocaleString("en-US", { timeZone: "America/New_York" });
            const estDate = new Date(estString);
            const hours = estDate.getHours();
            const minutes = estDate.getMinutes();
            const timeVal = hours * 100 + minutes;
            
            // Restrict signals to 9:45 AM - 3:30 PM (15:30) EST
            return timeVal >= 945 && timeVal <= 1530;
        } catch (e) {
            return true;
        }
    }
    
    // Cryptocurrencies are open 24/7
    return true;
}

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
        let valid = true;
        for (let j = 0; j < period; j++) {
            const price = data[i - j];
            if (price === null) {
                valid = false;
                break;
            }
            const weight = period - j;
            sum += price * weight;
            weightSum += weight;
        }
        wma.push(valid ? sum / weightSum : null);
    }
    return wma;
}

// Helper to calculate Simple Moving Average (SMA)
function calculateSMA(data, period) {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            sma.push(null);
            continue;
        }
        let sum = 0;
        let valid = true;
        for (let j = 0; j < period; j++) {
            if (data[i - j] === null || data[i - j] === undefined) {
                valid = false;
                break;
            }
            sum += data[i - j];
        }
        sma.push(valid ? sum / period : null);
    }
    return sma;
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

// Helper to calculate EMA
function calculateEMA(data, period) {
    const ema = [];
    if (data.length === 0) return ema;
    const alpha = 2 / (period + 1);
    
    let smaSum = 0;
    let count = 0;
    // Find initial SMA on first non-null values
    for (let i = 0; i < data.length; i++) {
        if (data[i] !== null) {
            smaSum += data[i];
            count++;
            if (count === period) {
                break;
            }
        }
    }
    
    const initialSMA = count > 0 ? smaSum / count : 0;
    let firstValidIndex = data.findIndex(x => x !== null);
    let currentEMA = initialSMA;
    
    for (let i = 0; i < data.length; i++) {
        if (i < firstValidIndex + period - 1) {
            ema.push(null);
        } else if (i === firstValidIndex + period - 1) {
            ema.push(initialSMA);
            currentEMA = initialSMA;
        } else {
            if (data[i] === null) {
                ema.push(null);
            } else {
                currentEMA = data[i] * alpha + currentEMA * (1 - alpha);
                ema.push(currentEMA);
            }
        }
    }
    return ema;
}

// Calculate Zero-Lag EMA (ZLEMA)
function calculateZLEMA(prices, period) {
    const lag = Math.floor((period - 1) / 2);
    const deLagged = [];
    for (let i = 0; i < prices.length; i++) {
        if (i < lag) {
            deLagged.push(prices[i]);
        } else {
            deLagged.push(2 * prices[i] - prices[i - lag]);
        }
    }
    return calculateEMA(deLagged, period);
}

// Calculate Relative Strength Index (RSI)
function calculateRSI(prices, period = 14) {
    const rsi = [];
    if (prices.length <= period) {
        return new Array(prices.length).fill(null);
    }
    
    let avgGain = 0;
    let avgLoss = 0;
    
    // First calculate simple average for the first period
    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) {
            avgGain += diff;
        } else {
            avgLoss -= diff;
        }
    }
    avgGain /= period;
    avgLoss /= period;
    
    for (let i = 0; i < prices.length; i++) {
        if (i < period) {
            rsi.push(null);
        } else if (i === period) {
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            rsi.push(100 - (100 / (1 + rs)));
        } else {
            const diff = prices[i] - prices[i - 1];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            rsi.push(100 - (100 / (1 + rs)));
        }
    }
    return rsi;
}

// Calculate MACD
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEMA = calculateEMA(prices, fastPeriod);
    const slowEMA = calculateEMA(prices, slowPeriod);
    
    const macdLine = [];
    for (let i = 0; i < prices.length; i++) {
        if (fastEMA[i] === null || slowEMA[i] === null) {
            macdLine.push(null);
        } else {
            macdLine.push(fastEMA[i] - slowEMA[i]);
        }
    }
    
    const nonNullStartIndex = macdLine.findIndex(x => x !== null);
    if (nonNullStartIndex === -1 || macdLine.length - nonNullStartIndex < signalPeriod) {
        return {
            macd: new Array(prices.length).fill(null),
            signal: new Array(prices.length).fill(null),
            histogram: new Array(prices.length).fill(null)
        };
    }
    
    const validMacdLine = macdLine.slice(nonNullStartIndex);
    const validSignalLine = calculateEMA(validMacdLine, signalPeriod);
    
    const signalLine = new Array(prices.length).fill(null);
    for (let i = 0; i < validSignalLine.length; i++) {
        signalLine[nonNullStartIndex + i] = validSignalLine[i];
    }
    
    const histogram = [];
    for (let i = 0; i < prices.length; i++) {
        if (macdLine[i] === null || signalLine[i] === null) {
            histogram.push(null);
        } else {
            histogram.push(macdLine[i] - signalLine[i]);
        }
    }
    
    return {
        macd: macdLine,
        signal: signalLine,
        histogram: histogram
    };
}

// Convert Candles to Heikin Ashi
function convertToHeikinAshi(candles) {
    if (candles.length === 0) return [];
    const haCandles = [];
    
    let prevOpen = candles[0].open;
    let prevClose = candles[0].close;
    
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const haClose = (c.open + c.high + c.low + c.close) / 4;
        const haOpen = i === 0 ? (prevOpen + prevClose) / 2 : (prevOpen + prevClose) / 2;
        const haHigh = Math.max(c.high, haOpen, haClose);
        const haLow = Math.min(c.low, haOpen, haClose);
        
        haCandles.push({
            time: c.time,
            open: haOpen,
            high: haHigh,
            low: haLow,
            close: haClose,
            volume: c.volume
        });
        
        prevOpen = haOpen;
        prevClose = haClose;
    }
    return haCandles;
}

// Helper to backtest signals with full per-trade log and realistic brokerage costs
// BROKERAGE: ₹60 per round-trip (buy + sell) as per Indian market standard
// CAPITAL: ₹10,000 assumed per trade to calculate realistic quantities
const BROKERAGE_PER_ROUNDTRIP = 60; // ₹
const ASSUMED_CAPITAL = 10000; // ₹

function backtestSignals(signals, latestPrice, symbol) {
    const BROKERAGE = BROKERAGE_PER_ROUNDTRIP;
    const isCrypto = symbol && (symbol.includes('BINANCE') || symbol.includes('USD') || symbol.includes('BTC'));
    
    let totalTrades = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let netProfitPct = 0;
    let grossProfitRs = 0;
    let totalBrokerage = 0;
    const tradeLog = [];
    
    const sorted = [...signals].sort((a, b) => new Date(a.time) - new Date(b.time));
    let activeTrade = null; // { type: 'LONG'|'SHORT', entryPrice, time }
    
    for (const sig of sorted) {
        if (!activeTrade) {
            if (sig.type === 'ENTRY_LONG') activeTrade = { type: 'LONG', entryPrice: sig.price, time: sig.time };
            else if (sig.type === 'ENTRY_SHORT') activeTrade = { type: 'SHORT', entryPrice: sig.price, time: sig.time };
            // Ignore EXITs if no active trade
        } else {
            if ((activeTrade.type === 'LONG' && sig.type === 'EXIT_LONG') || 
                (activeTrade.type === 'SHORT' && sig.type === 'EXIT_SHORT') ||
                (activeTrade.type === 'LONG' && sig.type === 'ENTRY_SHORT') ||
                (activeTrade.type === 'SHORT' && sig.type === 'ENTRY_LONG')) {
                
                // Close the trade
                totalTrades++;
                const isLong = activeTrade.type === 'LONG';
                const profitPct = isLong ? ((sig.price - activeTrade.entryPrice) / activeTrade.entryPrice) * 100 : ((activeTrade.entryPrice - sig.price) / activeTrade.entryPrice) * 100;
                
                const qty = isCrypto ? (ASSUMED_CAPITAL / activeTrade.entryPrice) : Math.floor(ASSUMED_CAPITAL / activeTrade.entryPrice);
                const grossRs = isLong ? (sig.price - activeTrade.entryPrice) * qty : (activeTrade.entryPrice - sig.price) * qty;
                const brokerageRs = isCrypto ? 0 : BROKERAGE;
                const netRs = grossRs - brokerageRs;
                const isWin = netRs > 0;
                
                netProfitPct += profitPct;
                grossProfitRs += grossRs;
                totalBrokerage += brokerageRs;
                if (isWin) winningTrades++;
                else losingTrades++;
                
                tradeLog.push({
                    entryTime: activeTrade.time,
                    exitTime: sig.time,
                    entryPrice: parseFloat(activeTrade.entryPrice.toFixed(2)),
                    exitPrice: parseFloat(sig.price.toFixed(2)),
                    profitPct: parseFloat(profitPct.toFixed(2)),
                    grossRs: parseFloat(grossRs.toFixed(2)),
                    brokerageRs: parseFloat(brokerageRs.toFixed(2)),
                    netRs: parseFloat(netRs.toFixed(2)),
                    result: isWin ? 'WIN' : 'LOSS',
                    open: false,
                    tradeType: activeTrade.type
                });
                
                // If it was a reversal signal, immediately open the new trade
                if (sig.type === 'ENTRY_SHORT') activeTrade = { type: 'SHORT', entryPrice: sig.price, time: sig.time };
                else if (sig.type === 'ENTRY_LONG') activeTrade = { type: 'LONG', entryPrice: sig.price, time: sig.time };
                else activeTrade = null;
            }
        }
    }
    
    // Simulate closing active open trade at latest price
    if (activeTrade && latestPrice) {
        totalTrades++;
        const isLong = activeTrade.type === 'LONG';
        const profitPct = isLong ? ((latestPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100 : ((activeTrade.entryPrice - latestPrice) / activeTrade.entryPrice) * 100;
        
        const qty = isCrypto ? (ASSUMED_CAPITAL / activeTrade.entryPrice) : Math.floor(ASSUMED_CAPITAL / activeTrade.entryPrice);
        const grossRs = isLong ? (latestPrice - activeTrade.entryPrice) * qty : (activeTrade.entryPrice - latestPrice) * qty;
        const brokerageRs = isCrypto ? 0 : BROKERAGE;
        const netRs = grossRs - brokerageRs;
        const isWin = netRs > 0;
        
        netProfitPct += profitPct;
        grossProfitRs += grossRs;
        totalBrokerage += brokerageRs;
        if (isWin) winningTrades++;
        else losingTrades++;
        
        tradeLog.push({
            entryTime: activeTrade.time,
            exitTime: null,
            entryPrice: parseFloat(activeTrade.entryPrice.toFixed(2)),
            exitPrice: parseFloat(latestPrice.toFixed(2)),
            profitPct: parseFloat(profitPct.toFixed(2)),
            grossRs: parseFloat(grossRs.toFixed(2)),
            brokerageRs: parseFloat(brokerageRs.toFixed(2)),
            netRs: parseFloat(netRs.toFixed(2)),
            result: isWin ? 'WIN (Open)' : 'LOSS (Open)',
            open: true,
            tradeType: activeTrade.type
        });
    }
    
    const winRate = totalTrades > 0 ? Math.round((winningTrades / totalTrades) * 100) : 0;
    const netProfitRs = parseFloat((grossProfitRs - totalBrokerage).toFixed(2));
    
    return {
        totalTrades,
        winRate,
        winningTrades,
        losingTrades,
        netProfit: parseFloat(netProfitPct.toFixed(2)),
        avgProfit: totalTrades > 0 ? parseFloat((netProfitPct / totalTrades).toFixed(2)) : 0,
        netProfitRs,
        totalBrokerage: parseFloat(totalBrokerage.toFixed(2)),
        grossProfitRs: parseFloat(grossProfitRs.toFixed(2)),
        tradeLog
    };
}

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

function processCandlesAndGetState(candles, symbol, interval, options = {}) {
    if (candles.length === 0) return null;
    
    // Sort chronologically
    candles.sort((a, b) => new Date(a.time) - new Date(b.time));
    
    const strategy = options.strategy || 'HMA_SLOPE';
    const period = options.period || 16;
    const fastPeriod = options.fastPeriod || 9;
    const slowPeriod = options.slowPeriod || 21;
    const useHeikinAshi = options.useHeikinAshi || false;
    const confirmations = options.confirmations || [];
    
    // Convert to HA if requested
    let calcCandles = candles;
    if (useHeikinAshi) {
        calcCandles = convertToHeikinAshi(candles);
    }
    
    const prices = calcCandles.map(c => c.close);
    
    let fastIndicator = [];
    let slowIndicator = [];
    
    // Calculate indicators based on selected strategy
    if (strategy === 'HMA_SLOPE') {
        fastIndicator = calculateHMA(prices, period);
        slowIndicator = new Array(prices.length).fill(null);
    } else if (strategy === 'HMA_CROSS') {
        fastIndicator = calculateHMA(prices, fastPeriod);
        slowIndicator = calculateHMA(prices, slowPeriod);
    } else if (strategy === 'ZLEMA_CROSS') {
        fastIndicator = calculateZLEMA(prices, fastPeriod);
        slowIndicator = calculateEMA(prices, slowPeriod);
    } else if (strategy === 'APLUS_INTRADAY') {
        // A+ Setup uses 9 EMA and 21 EMA as crossover lines
        fastIndicator = calculateEMA(prices, 9);
        slowIndicator = calculateEMA(prices, 21);
    }
    
    // Additional technical indicators for confirmation & A+ Setup
    const ema50 = calculateEMA(prices, 50);
    const rsiValues = calculateRSI(prices, 14);
    const macdData = calculateMACD(prices, 12, 26, 9);
    const volumes = calcCandles.map(c => c.volume || 0);
    const volSMA10 = calculateSMA(volumes, 10);
    
    let prevTrend = null;
    const signals = [];
    
    for (let i = 0; i < candles.length; i++) {
        const fastVal = fastIndicator[i];
        const slowVal = slowIndicator[i];
        
        candles[i].fastVal = fastVal !== null ? parseFloat(fastVal.toFixed(2)) : null;
        candles[i].slowVal = slowVal !== null ? parseFloat(slowVal.toFixed(2)) : null;
        candles[i].ema50 = ema50[i] !== null ? parseFloat(ema50[i].toFixed(2)) : null;
        candles[i].rsi = rsiValues[i] !== null ? parseFloat(rsiValues[i].toFixed(2)) : null;
        candles[i].macd = macdData.macd[i] !== null ? parseFloat(macdData.macd[i].toFixed(2)) : null;
        candles[i].macdHist = macdData.histogram[i] !== null ? parseFloat(macdData.histogram[i].toFixed(2)) : null;
        
        candles[i].trend = null;
        candles[i].signal = null;
        
        if (strategy === 'APLUS_INTRADAY') {
            // A+ INTRADAY STRATEGY LOGIC
            if (i > 0 && fastVal !== null && slowVal !== null && ema50[i] !== null && rsiValues[i] !== null && macdData.histogram[i] !== null && volSMA10[i] !== null) {
                const isCrossoverBuy = fastVal > slowVal && fastIndicator[i - 1] <= slowIndicator[i - 1];
                const isCrossoverSell = fastVal < slowVal && fastIndicator[i - 1] >= slowIndicator[i - 1];
                
                const isTrendBullish = prices[i] > ema50[i] && ema50[i] > ema50[i - 1];
                const isRsiBullish = rsiValues[i] >= 48 && rsiValues[i] <= 68;
                const isMacdBullish = macdData.histogram[i] > 0 && macdData.histogram[i] > macdData.histogram[i - 1];
                const isVolBullish = volumes[i] > volSMA10[i] * 1.0; // 1.0x volume expansion (relaxed)
                
                const isTrendBearish = prices[i] < ema50[i] && ema50[i] < ema50[i - 1];
                const isRsiBearish = rsiValues[i] >= 32 && rsiValues[i] <= 52;
                const isMacdBearish = macdData.histogram[i] < 0 && macdData.histogram[i] < macdData.histogram[i - 1];
                const isVolBearish = volumes[i] > volSMA10[i] * 1.0;
                
                let trend = fastVal > slowVal ? 'GREEN' : 'RED';
                candles[i].trend = trend;
                
                const isWithinTradingHours = isValidTradingTime(symbol, candles[i].time);
                
                if (isCrossoverBuy && isTrendBullish && isRsiBullish && isMacdBullish && isVolBullish && isWithinTradingHours) {
                    candles[i].signal = 'ENTRY_LONG';
                    signals.push({ time: candles[i].time, price: candles[i].close, type: 'ENTRY_LONG', indicatorVal: fastVal });
                } else if (isCrossoverSell && isTrendBearish && isRsiBearish && isMacdBearish && isVolBearish && isWithinTradingHours) {
                    candles[i].signal = 'ENTRY_SHORT';
                    signals.push({ time: candles[i].time, price: candles[i].close, type: 'ENTRY_SHORT', indicatorVal: fastVal });
                } else if (isCrossoverSell) {
                    // Momentum shifted down, exit any open long position
                    candles[i].signal = 'EXIT_LONG';
                    signals.push({ time: candles[i].time, price: candles[i].close, type: 'EXIT_LONG', indicatorVal: fastVal });
                } else if (isCrossoverBuy) {
                    // Momentum shifted up, exit any open short position
                    candles[i].signal = 'EXIT_SHORT';
                    signals.push({ time: candles[i].time, price: candles[i].close, type: 'EXIT_SHORT', indicatorVal: fastVal });
                }
            } else if (fastVal !== null && slowVal !== null) {
                candles[i].trend = fastVal > slowVal ? 'GREEN' : 'RED';
            }
        } else {
            // STANDARD STRATEGIES
            if (fastVal !== null) {
                let currentTrend = null;
                if (strategy === 'HMA_SLOPE') {
                    if (i > 0 && fastIndicator[i - 1] !== null) {
                        currentTrend = fastVal > fastIndicator[i - 1] ? 'GREEN' : 'RED';
                    }
                } else {
                    if (slowVal !== null) {
                        currentTrend = fastVal > slowVal ? 'GREEN' : 'RED';
                    }
                }
                
                candles[i].trend = currentTrend;
                
                if (currentTrend && prevTrend && currentTrend !== prevTrend) {
                    let potentialSignal = currentTrend === 'GREEN' ? 'BUY' : 'SELL';
                    
                    // Confirmations Check
                    let isConfirmed = true;
                    if (confirmations.includes('RSI') && rsiValues[i] !== null) {
                        if (potentialSignal === 'BUY' && rsiValues[i] >= 65) isConfirmed = false;
                        if (potentialSignal === 'SELL' && rsiValues[i] <= 35) isConfirmed = false;
                    }
                    if (confirmations.includes('MACD') && macdData.histogram[i] !== null) {
                        const hist = macdData.histogram[i];
                        if (i > 0 && macdData.histogram[i - 1] !== null) {
                            const prevHist = macdData.histogram[i - 1];
                            if (potentialSignal === 'BUY' && hist <= prevHist) isConfirmed = false;
                            if (potentialSignal === 'SELL' && hist >= prevHist) isConfirmed = false;
                        }
                    }
                    
                    if (isConfirmed) {
                        candles[i].signal = potentialSignal;
                        signals.push({
                            time: candles[i].time,
                            price: candles[i].close,
                            type: potentialSignal,
                            indicatorVal: fastVal
                        });
                    }
                }
                if (currentTrend) {
                    prevTrend = currentTrend;
                }
            }
        }
    }
    
    const latest = candles[candles.length - 1];
    
    // Slice to the last 100 candles for chart display & local backtesting
    const sliceIndex = Math.max(0, candles.length - 100);
    const displayCandles = candles.slice(sliceIndex);
    
    // Filter signals to only those within the displayed 100 candles
    const sliceTime = displayCandles[0] ? new Date(displayCandles[0].time).getTime() : 0;
    const visibleSignals = signals.filter(sig => new Date(sig.time).getTime() >= sliceTime);
    const stats = backtestSignals(visibleSignals, latest.close, symbol);
    
    return {
        symbol,
        interval,
        strategy,
        useHeikinAshi,
        totalCandles: candles.length,
        candles: displayCandles,
        latest: {
            time: latest.time,
            price: latest.close,
            trend: latest.trend,
            signal: latest.signal,
            fastVal: latest.fastVal,
            slowVal: latest.slowVal,
            ema50: latest.ema50,
            rsi: latest.rsi,
            macdHist: latest.macdHist
        },
        recentSignals: visibleSignals.slice(-5),
        stats,
        tradeLog: stats.tradeLog || []
    };
}

async function streamSymbol(symbol, interval = '1D', options = {}, onUpdate) {
    const intervalMap = {
        '1': '1',
        '5': '5',
        '10': '10',
        '15': '15',
        '1D': '1D'
    };
    
    const mappedInterval = intervalMap[interval] || '1D';
    let url = `https://www.tradingview.com/chart/?symbol=${symbol}`;
    if (mappedInterval !== '1D') {
        url += `&interval=${mappedInterval}`;
    }

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const candles = [];

    let isClosed = false;

    page.on('websocket', ws => {
        ws.on('framereceived', frame => {
            if (isClosed) return;
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

            if (stateUpdated) {
                const state = processCandlesAndGetState(candles, symbol, interval, options);
                if (state) {
                    onUpdate(state);
                }
            }
        });
    });

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (err) {
        if (!isClosed) {
            await browser.close();
            throw new Error("Failed to load chart data");
        }
    }

    // Return a cleanup function
    return async () => {
        isClosed = true;
        await browser.close();
    };
}

module.exports = { streamSymbol, processCandlesAndGetState };
