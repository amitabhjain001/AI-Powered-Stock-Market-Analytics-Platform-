const { chromium } = require('playwright');

// ─────────────────────────────────────────────
// TIME HELPERS
// ─────────────────────────────────────────────

function getISTTime(isoString) {
    const date = new Date(isoString);
    const localTimeMs = date.getTime() + (5.5 * 60 * 60 * 1000);
    const ist = new Date(localTimeMs);
    return {
        hours: ist.getUTCHours(),
        minutes: ist.getUTCMinutes(),
        timeVal: ist.getUTCHours() * 100 + ist.getUTCMinutes(),
        dateStr: ist.toISOString().slice(0, 10) // "YYYY-MM-DD"
    };
}

// Returns true if the ISO string belongs to today's IST date
function isTodayIST(isoString) {
    const now = getISTTime(new Date().toISOString());
    const candle = getISTTime(isoString);
    return candle.dateStr === now.dateStr;
}

// Returns true if the ISO string belongs to a given IST date string "YYYY-MM-DD"
function isDateIST(isoString, dateStr) {
    const candle = getISTTime(isoString);
    return candle.dateStr === dateStr;
}

// Get previous trading day's date string (skip weekends)
function getPrevTradingDay() {
    const now = new Date();
    // Shift to IST
    const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    const istDate = new Date(istMs);
    let day = istDate.getUTCDay(); // 0=Sun, 6=Sat
    let daysBack = 1;
    if (day === 1) daysBack = 3; // Monday → go back to Friday
    if (day === 0) daysBack = 2; // Sunday  → go back to Friday
    istDate.setUTCDate(istDate.getUTCDate() - daysBack);
    return istDate.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// TRADING TIME GATE (unchanged from original)
// ─────────────────────────────────────────────

function isValidTradingTime(symbol, isoTimeString) {
    const date = new Date(isoTimeString);

    if (symbol.startsWith('NSE:') || symbol.startsWith('BSE:')) {
        const { timeVal } = getISTTime(isoTimeString);
        return timeVal >= 920 && timeVal <= 1230;
    }

    if (symbol.startsWith('NASDAQ:') || symbol.startsWith('NYSE:')) {
        try {
            const estString = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
            const estDate = new Date(estString);
            const timeVal = estDate.getHours() * 100 + estDate.getMinutes();
            return timeVal >= 945 && timeVal <= 1530;
        } catch (e) {
            return true;
        }
    }

    return true; // Crypto is 24/7
}

// ─────────────────────────────────────────────
// INDICATOR CALCULATIONS (all original ones kept)
// ─────────────────────────────────────────────

function calculateWMA(data, period) {
    const wma = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) { wma.push(null); continue; }
        let sum = 0, weightSum = 0, valid = true;
        for (let j = 0; j < period; j++) {
            const price = data[i - j];
            if (price === null) { valid = false; break; }
            const weight = period - j;
            sum += price * weight;
            weightSum += weight;
        }
        wma.push(valid ? sum / weightSum : null);
    }
    return wma;
}

function calculateSMA(data, period) {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) { sma.push(null); continue; }
        let sum = 0, valid = true;
        for (let j = 0; j < period; j++) {
            if (data[i - j] === null || data[i - j] === undefined) { valid = false; break; }
            sum += data[i - j];
        }
        sma.push(valid ? sum / period : null);
    }
    return sma;
}

function calculateHMA(prices, period) {
    const halfPeriod = Math.floor(period / 2);
    const sqrtPeriod = Math.floor(Math.sqrt(period));
    const wmaHalf = calculateWMA(prices, halfPeriod);
    const wmaFull = calculateWMA(prices, period);
    const rawHMA = [];
    for (let i = 0; i < prices.length; i++) {
        if (wmaHalf[i] === null || wmaFull[i] === null) rawHMA.push(null);
        else rawHMA.push(2 * wmaHalf[i] - wmaFull[i]);
    }
    const hma = [];
    for (let i = 0; i < prices.length; i++) {
        if (i < period - 1 + sqrtPeriod - 1) { hma.push(null); continue; }
        let sum = 0, weightSum = 0, valid = true;
        for (let j = 0; j < sqrtPeriod; j++) {
            const val = rawHMA[i - j];
            if (val === null) { valid = false; break; }
            const weight = sqrtPeriod - j;
            sum += val * weight;
            weightSum += weight;
        }
        hma.push(valid ? sum / weightSum : null);
    }
    return hma;
}

function calculateEMA(data, period) {
    const ema = [];
    if (data.length === 0) return ema;
    const alpha = 2 / (period + 1);
    let smaSum = 0, count = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i] !== null) {
            smaSum += data[i]; count++;
            if (count === period) break;
        }
    }
    const initialSMA = count > 0 ? smaSum / count : 0;
    let firstValidIndex = data.findIndex(x => x !== null);
    let currentEMA = initialSMA;
    for (let i = 0; i < data.length; i++) {
        if (i < firstValidIndex + period - 1) {
            ema.push(null);
        } else if (i === firstValidIndex + period - 1) {
            ema.push(initialSMA); currentEMA = initialSMA;
        } else {
            if (data[i] === null) ema.push(null);
            else { currentEMA = data[i] * alpha + currentEMA * (1 - alpha); ema.push(currentEMA); }
        }
    }
    return ema;
}

function calculateZLEMA(prices, period) {
    const lag = Math.floor((period - 1) / 2);
    const deLagged = [];
    for (let i = 0; i < prices.length; i++) {
        deLagged.push(i < lag ? prices[i] : 2 * prices[i] - prices[i - lag]);
    }
    return calculateEMA(deLagged, period);
}

function calculateRSI(prices, period = 14) {
    const rsi = [];
    if (prices.length <= period) return new Array(prices.length).fill(null);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) avgGain += diff; else avgLoss -= diff;
    }
    avgGain /= period; avgLoss /= period;
    for (let i = 0; i < prices.length; i++) {
        if (i < period) { rsi.push(null); }
        else if (i === period) {
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

function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEMA = calculateEMA(prices, fastPeriod);
    const slowEMA = calculateEMA(prices, slowPeriod);
    const macdLine = [];
    for (let i = 0; i < prices.length; i++) {
        if (fastEMA[i] === null || slowEMA[i] === null) macdLine.push(null);
        else macdLine.push(fastEMA[i] - slowEMA[i]);
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
    for (let i = 0; i < validSignalLine.length; i++) signalLine[nonNullStartIndex + i] = validSignalLine[i];
    const histogram = [];
    for (let i = 0; i < prices.length; i++) {
        if (macdLine[i] === null || signalLine[i] === null) histogram.push(null);
        else histogram.push(macdLine[i] - signalLine[i]);
    }
    return { macd: macdLine, signal: signalLine, histogram };
}

function convertToHeikinAshi(candles) {
    if (candles.length === 0) return [];
    const haCandles = [];
    let prevOpen = candles[0].open, prevClose = candles[0].close;
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const haClose = (c.open + c.high + c.low + c.close) / 4;
        const haOpen = (prevOpen + prevClose) / 2;
        const haHigh = Math.max(c.high, haOpen, haClose);
        const haLow = Math.min(c.low, haOpen, haClose);
        haCandles.push({ time: c.time, open: haOpen, high: haHigh, low: haLow, close: haClose, volume: c.volume });
        prevOpen = haOpen; prevClose = haClose;
    }
    return haCandles;
}

// ─────────────────────────────────────────────
// NEW: VWAP CALCULATION
// Anchored to today's session (resets each day)
// ─────────────────────────────────────────────

function calculateVWAP(candles) {
    // Only use today's candles for intraday VWAP
    const todayCandles = candles.filter(c => isTodayIST(c.time));
    if (todayCandles.length === 0) return null;

    let cumulativeTPV = 0; // Typical Price × Volume
    let cumulativeVolume = 0;

    for (const c of todayCandles) {
        const typicalPrice = (c.high + c.low + c.close) / 3;
        cumulativeTPV += typicalPrice * c.volume;
        cumulativeVolume += c.volume;
    }

    return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : null;
}

// ─────────────────────────────────────────────
// NEW: ATR CALCULATION (Average True Range)
// Used for approximate SL suggestion
// ─────────────────────────────────────────────

function calculateATR(candles, period = 14) {
    if (candles.length < 2) return null;
    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trValues.push(tr);
    }
    if (trValues.length < period) {
        // Not enough data, return simple average of what we have
        const avg = trValues.reduce((a, b) => a + b, 0) / trValues.length;
        return parseFloat(avg.toFixed(2));
    }
    // Wilder's smoothing (same as RSI)
    let atr = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trValues.length; i++) {
        atr = (atr * (period - 1) + trValues[i]) / period;
    }
    return parseFloat(atr.toFixed(2));
}

// ─────────────────────────────────────────────
// NEW: PREVIOUS DAY DATA EXTRACTION
// Pulls prev day OHLC from the historical candles
// that TradingView sends on initial load
// ─────────────────────────────────────────────

function getPrevDayData(candles) {
    const prevDate = getPrevTradingDay();

    // For 5-min candles: filter all candles from prev trading day
    const prevDayCandles = candles.filter(c => isDateIST(c.time, prevDate));

    if (prevDayCandles.length === 0) {
        // Fallback: use the oldest day's candles that aren't today
        const todayStr = getISTTime(new Date().toISOString()).dateStr;
        const notToday = candles.filter(c => getISTTime(c.time).dateStr !== todayStr);
        if (notToday.length === 0) return null;
        // Group by date
        const dates = [...new Set(notToday.map(c => getISTTime(c.time).dateStr))].sort();
        const lastDate = dates[dates.length - 1];
        const lastDayCandles = notToday.filter(c => getISTTime(c.time).dateStr === lastDate);
        if (lastDayCandles.length === 0) return null;
        return {
            date: lastDate,
            open: lastDayCandles[0].open,
            high: Math.max(...lastDayCandles.map(c => c.high)),
            low: Math.min(...lastDayCandles.map(c => c.low)),
            close: lastDayCandles[lastDayCandles.length - 1].close,
            volume: lastDayCandles.reduce((sum, c) => sum + c.volume, 0)
        };
    }

    return {
        date: prevDate,
        open: prevDayCandles[0].open,
        high: Math.max(...prevDayCandles.map(c => c.high)),
        low: Math.min(...prevDayCandles.map(c => c.low)),
        close: prevDayCandles[prevDayCandles.length - 1].close,
        volume: prevDayCandles.reduce((sum, c) => sum + c.volume, 0)
    };
}

// ─────────────────────────────────────────────
// NEW: DAILY RSI CALCULATION
// Builds daily candles from intraday candles
// and calculates RSI on daily closes
// ─────────────────────────────────────────────

function getDailyRSI(candles) {
    // Group 5-min candles by IST date → build daily OHLC
    const dailyMap = {};
    for (const c of candles) {
        const dateStr = getISTTime(c.time).dateStr;
        if (!dailyMap[dateStr]) {
            dailyMap[dateStr] = { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
        } else {
            dailyMap[dateStr].high = Math.max(dailyMap[dateStr].high, c.high);
            dailyMap[dateStr].low = Math.min(dailyMap[dateStr].low, c.low);
            dailyMap[dateStr].close = c.close; // last candle of day = daily close
            dailyMap[dateStr].volume += c.volume;
        }
    }

    const sortedDates = Object.keys(dailyMap).sort();
    if (sortedDates.length < 15) return null; // Need at least 15 days for RSI-14

    const dailyCloses = sortedDates.map(d => dailyMap[d].close);
    const rsiValues = calculateRSI(dailyCloses, 14);
    const latestRSI = rsiValues[rsiValues.length - 1];
    return latestRSI !== null ? parseFloat(latestRSI.toFixed(1)) : null;
}

// ─────────────────────────────────────────────
// NEW: CONSECUTIVE RED DAYS CHECK
// Bounce risk protection
// ─────────────────────────────────────────────

function getConsecutiveRedDays(candles) {
    const dailyMap = {};
    for (const c of candles) {
        const dateStr = getISTTime(c.time).dateStr;
        if (!dailyMap[dateStr]) {
            dailyMap[dateStr] = { open: c.open, close: c.close };
        } else {
            dailyMap[dateStr].close = c.close;
        }
    }
    const sortedDates = Object.keys(dailyMap).sort();
    // Exclude today from this check
    const todayStr = getISTTime(new Date().toISOString()).dateStr;
    const pastDates = sortedDates.filter(d => d !== todayStr);
    if (pastDates.length === 0) return 0;

    let count = 0;
    for (let i = pastDates.length - 1; i >= 0; i--) {
        const day = dailyMap[pastDates[i]];
        if (day.close < day.open) count++;
        else break;
    }
    return count;
}

// ─────────────────────────────────────────────
// NEW: GAP & FADE SHORT DETECTOR
// Core signal logic for your strategy
// ─────────────────────────────────────────────

function detectGapFadeShort(candles, symbol) {
    if (candles.length < 10) return null;

    // Get IST time right now
    const nowIST = getISTTime(new Date().toISOString());
    // Only run this during the morning window 9:15 AM - 10:30 AM IST
    if (nowIST.timeVal < 915 || nowIST.timeVal > 1030) return null;

    // ── Step 1: Get previous day data ──
    const prevDay = getPrevDayData(candles);
    if (!prevDay || prevDay.close <= 0) return null;

    // ── Step 2: Get today's candles only ──
    const todayCandles = candles.filter(c => isTodayIST(c.time));
    if (todayCandles.length === 0) return null;

    const todayOpen = todayCandles[0].open;
    const todayHigh = Math.max(...todayCandles.map(c => c.high));
    const currentCandle = todayCandles[todayCandles.length - 1];
    const currentPrice = currentCandle.close;

    // ── Step 3: Calculate gap % ──
    const gapPercent = ((todayOpen - prevDay.close) / prevDay.close) * 100;

    // Only proceed if gap is 1.5% to 3.5% up
    if (gapPercent < 1.5 || gapPercent > 3.5) return null;

    // ── Step 4: Check price is fading (below today's open) ──
    const isFading = currentPrice < todayOpen;
    // Also allow early fade detection: price below open OR
    // forming a bearish first candle (close < open on first candle)
    const firstCandleBearish = todayCandles[0].close < todayCandles[0].open;
    if (!isFading && !firstCandleBearish) return null;

    // ── Step 5: VWAP check — price should be above VWAP (room to fall) ──
    const vwap = calculateVWAP(candles);
    if (!vwap) return null;
    const aboveVWAP = currentPrice > vwap;
    // If price is already below VWAP, the move may be done
    if (!aboveVWAP) return null;

    // ── Step 6: RSI on 5-min ── should be 52-75, not already crashed
    const prices = candles.map(c => c.close);
    const rsiArr = calculateRSI(prices, 14);
    const currentRSI = rsiArr[rsiArr.length - 1];
    if (currentRSI === null) return null;
    const rsiOk = currentRSI >= 50 && currentRSI <= 76;
    if (!rsiOk) return null;

    // ── Step 7: Volume picking up (selling pressure) ──
    const volumes = candles.map(c => c.volume);
    const volSMA = calculateSMA(volumes, 20);
    const latestVolSMA = volSMA[volSMA.length - 1];
    const currentVolume = currentCandle.volume;
    const volumeOk = latestVolSMA === null || currentVolume >= latestVolSMA * 0.9; // relaxed to 0.9x

    // ── Step 8: Daily RSI check — not oversold on daily ──
    const dailyRSI = getDailyRSI(candles);
    const dailyRSIOk = dailyRSI === null || dailyRSI >= 40; // skip if daily oversold
    if (!dailyRSIOk) return null;

    // ── Step 9: Bounce risk — how many consecutive red days ──
    const redDays = getConsecutiveRedDays(candles);
    const bounceRisk = redDays >= 4; // 4+ consecutive red days = bounce risk

    // ── Step 10: ATR for SL suggestion ──
    const atr = calculateATR(candles, 14);

    // ── Step 11: Build signal ──
    const slLevel = todayHigh + (atr ? atr * 0.5 : currentPrice * 0.005);
    const target1 = vwap;                   // First target: fill to VWAP
    const target2 = prevDay.close;           // Full gap fill target

    // Confidence scoring
    let confidence = 'MEDIUM';
    let score = 0;
    if (isFading) score++;
    if (firstCandleBearish) score++;
    if (currentRSI >= 58 && currentRSI <= 72) score++; // ideal RSI zone for short
    if (volumeOk) score++;
    if (gapPercent >= 1.8) score++; // bigger gap = more room to fade
    if (redDays === 0) score++; // fresh stock, not exhausted
    if (score >= 5) confidence = 'HIGH';
    else if (score >= 3) confidence = 'MEDIUM';
    else confidence = 'LOW';

    return {
        type: 'GAP_FADE_SHORT',
        gapPercent: parseFloat(gapPercent.toFixed(2)),
        todayOpen: parseFloat(todayOpen.toFixed(2)),
        prevDayClose: parseFloat(prevDay.close.toFixed(2)),
        prevDayHigh: parseFloat(prevDay.high.toFixed(2)),
        prevDayLow: parseFloat(prevDay.low.toFixed(2)),
        currentPrice: parseFloat(currentPrice.toFixed(2)),
        todayHigh: parseFloat(todayHigh.toFixed(2)),
        vwap: parseFloat(vwap.toFixed(2)),
        rsi5min: parseFloat(currentRSI.toFixed(1)),
        dailyRSI: dailyRSI,
        atr: atr,
        entryZoneLow: parseFloat((currentPrice - (atr ? atr * 0.2 : 0)).toFixed(2)),
        entryZoneHigh: parseFloat(currentPrice.toFixed(2)),
        slApprox: parseFloat(slLevel.toFixed(2)),
        target1: parseFloat(target1.toFixed(2)),   // VWAP
        target2: parseFloat(target2.toFixed(2)),   // Full gap fill
        isFading,
        firstCandleBearish,
        bounceRisk,
        consecutiveRedDays: redDays,
        volumeConfirmed: volumeOk,
        confidence,
        score,
        warnings: [
            bounceRisk ? `⚠️ ${redDays} consecutive red days — bounce risk` : null,
            dailyRSI && dailyRSI < 45 ? `⚠️ Daily RSI ${dailyRSI} — stock is weak, may bounce` : null,
            gapPercent > 3.0 ? '⚠️ Large gap — verify no news driving this' : null,
        ].filter(Boolean)
    };
}

// ─────────────────────────────────────────────
// NEW: NIFTY MARKET HEALTH ANALYSIS
// Called separately with NIFTY candles
// Returns overall market direction
// ─────────────────────────────────────────────

function analyzeMarketHealth(niftyCandles) {
    if (!niftyCandles || niftyCandles.length < 5) {
        return { status: 'UNKNOWN', label: 'Loading...', rsi: null, gapPercent: null, isFading: null };
    }

    const prevDay = getPrevDayData(niftyCandles);
    const todayCandles = niftyCandles.filter(c => isTodayIST(c.time));

    if (todayCandles.length === 0 || !prevDay) {
        return { status: 'UNKNOWN', label: 'Waiting for data', rsi: null, gapPercent: null, isFading: null };
    }

    const todayOpen = todayCandles[0].open;
    const currentPrice = todayCandles[todayCandles.length - 1].close;
    const gapPercent = parseFloat(((todayOpen - prevDay.close) / prevDay.close * 100).toFixed(2));

    const prices = niftyCandles.map(c => c.close);
    const rsiArr = calculateRSI(prices, 14);
    const currentRSI = rsiArr[rsiArr.length - 1];

    // Is NIFTY itself fading from its open?
    const isFading = currentPrice < todayOpen;

    // VWAP for NIFTY
    const vwap = calculateVWAP(niftyCandles);
    const belowVWAP = vwap ? currentPrice < vwap : false;

    // Determine health status
    let status = 'NEUTRAL';
    let label = 'Market Neutral';
    let shortFriendly = false;

    if (gapPercent > 0.3 && isFading && (currentRSI === null || currentRSI < 55)) {
        status = 'WEAKENING';
        label = 'Market Weakening ↓';
        shortFriendly = true;
    } else if (gapPercent > 0.3 && !isFading && currentRSI !== null && currentRSI > 58) {
        status = 'STRONG';
        label = 'Market Strong ↑';
        shortFriendly = false;
    } else if (gapPercent < -0.3) {
        status = 'BEARISH';
        label = 'Market Bearish ↓';
        shortFriendly = true;
    } else if (belowVWAP && isFading) {
        status = 'WEAK';
        label = 'Market Weak ↓';
        shortFriendly = true;
    } else {
        status = 'NEUTRAL';
        label = 'Market Neutral →';
        shortFriendly = false;
    }

    return {
        status,               // 'STRONG' | 'WEAKENING' | 'NEUTRAL' | 'WEAK' | 'BEARISH'
        label,                // Human readable
        shortFriendly,        // true = good env for shorts
        gapPercent,           // NIFTY gap today
        currentPrice: parseFloat(currentPrice.toFixed(2)),
        todayOpen: parseFloat(todayOpen.toFixed(2)),
        prevClose: parseFloat(prevDay.close.toFixed(2)),
        rsi: currentRSI !== null ? parseFloat(currentRSI.toFixed(1)) : null,
        vwap: vwap ? parseFloat(vwap.toFixed(2)) : null,
        isFading,
        belowVWAP
    };
}

// ─────────────────────────────────────────────
// BACKTEST (unchanged from original)
// ─────────────────────────────────────────────

const BROKERAGE_PER_ROUNDTRIP = 60;
const ASSUMED_CAPITAL = 10000;

function backtestSignals(signals, latestPrice, symbol) {
    const BROKERAGE = BROKERAGE_PER_ROUNDTRIP;
    const isCrypto = symbol && (symbol.includes('BINANCE') || symbol.includes('USD') || symbol.includes('BTC'));
    let totalTrades = 0, winningTrades = 0, losingTrades = 0;
    let netProfitPct = 0, grossProfitRs = 0, totalBrokerage = 0;
    const tradeLog = [];
    const sorted = [...signals].sort((a, b) => new Date(a.time) - new Date(b.time));
    let activeTrade = null;

    for (const sig of sorted) {
        if (!activeTrade) {
            if (sig.type === 'ENTRY_LONG') activeTrade = { type: 'LONG', entryPrice: sig.price, time: sig.time };
            else if (sig.type === 'ENTRY_SHORT') activeTrade = { type: 'SHORT', entryPrice: sig.price, time: sig.time };
        } else {
            if ((activeTrade.type === 'LONG' && sig.type === 'EXIT_LONG') ||
                (activeTrade.type === 'SHORT' && sig.type === 'EXIT_SHORT') ||
                (activeTrade.type === 'LONG' && sig.type === 'ENTRY_SHORT') ||
                (activeTrade.type === 'SHORT' && sig.type === 'ENTRY_LONG')) {
                totalTrades++;
                const isLong = activeTrade.type === 'LONG';
                const profitPct = isLong
                    ? ((sig.price - activeTrade.entryPrice) / activeTrade.entryPrice) * 100
                    : ((activeTrade.entryPrice - sig.price) / activeTrade.entryPrice) * 100;
                const qty = isCrypto ? (ASSUMED_CAPITAL / activeTrade.entryPrice) : Math.floor(ASSUMED_CAPITAL / activeTrade.entryPrice);
                const grossRs = isLong ? (sig.price - activeTrade.entryPrice) * qty : (activeTrade.entryPrice - sig.price) * qty;
                const brokerageRs = isCrypto ? 0 : BROKERAGE;
                const netRs = grossRs - brokerageRs;
                const isWin = netRs > 0;
                netProfitPct += profitPct; grossProfitRs += grossRs; totalBrokerage += brokerageRs;
                if (isWin) winningTrades++; else losingTrades++;
                tradeLog.push({
                    entryTime: activeTrade.time, exitTime: sig.time,
                    entryPrice: parseFloat(activeTrade.entryPrice.toFixed(2)),
                    exitPrice: parseFloat(sig.price.toFixed(2)),
                    profitPct: parseFloat(profitPct.toFixed(2)),
                    grossRs: parseFloat(grossRs.toFixed(2)),
                    brokerageRs: parseFloat(brokerageRs.toFixed(2)),
                    netRs: parseFloat(netRs.toFixed(2)),
                    result: isWin ? 'WIN' : 'LOSS', open: false, tradeType: activeTrade.type
                });
                if (sig.type === 'ENTRY_SHORT') activeTrade = { type: 'SHORT', entryPrice: sig.price, time: sig.time };
                else if (sig.type === 'ENTRY_LONG') activeTrade = { type: 'LONG', entryPrice: sig.price, time: sig.time };
                else activeTrade = null;
            }
        }
    }

    if (activeTrade && latestPrice) {
        totalTrades++;
        const isLong = activeTrade.type === 'LONG';
        const profitPct = isLong
            ? ((latestPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100
            : ((activeTrade.entryPrice - latestPrice) / activeTrade.entryPrice) * 100;
        const qty = isCrypto ? (ASSUMED_CAPITAL / activeTrade.entryPrice) : Math.floor(ASSUMED_CAPITAL / activeTrade.entryPrice);
        const grossRs = isLong ? (latestPrice - activeTrade.entryPrice) * qty : (activeTrade.entryPrice - latestPrice) * qty;
        const brokerageRs = isCrypto ? 0 : BROKERAGE;
        const netRs = grossRs - brokerageRs;
        const isWin = netRs > 0;
        netProfitPct += profitPct; grossProfitRs += grossRs; totalBrokerage += brokerageRs;
        if (isWin) winningTrades++; else losingTrades++;
        tradeLog.push({
            entryTime: activeTrade.time, exitTime: null,
            entryPrice: parseFloat(activeTrade.entryPrice.toFixed(2)),
            exitPrice: parseFloat(latestPrice.toFixed(2)),
            profitPct: parseFloat(profitPct.toFixed(2)),
            grossRs: parseFloat(grossRs.toFixed(2)),
            brokerageRs: parseFloat(brokerageRs.toFixed(2)),
            netRs: parseFloat(netRs.toFixed(2)),
            result: isWin ? 'WIN (Open)' : 'LOSS (Open)', open: true, tradeType: activeTrade.type
        });
    }

    const winRate = totalTrades > 0 ? Math.round((winningTrades / totalTrades) * 100) : 0;
    const netProfitRs = parseFloat((grossProfitRs - totalBrokerage).toFixed(2));
    return {
        totalTrades, winRate, winningTrades, losingTrades,
        netProfit: parseFloat(netProfitPct.toFixed(2)),
        avgProfit: totalTrades > 0 ? parseFloat((netProfitPct / totalTrades).toFixed(2)) : 0,
        netProfitRs, totalBrokerage: parseFloat(totalBrokerage.toFixed(2)),
        grossProfitRs: parseFloat(grossProfitRs.toFixed(2)), tradeLog
    };
}

// ─────────────────────────────────────────────
// PARSER (unchanged)
// ─────────────────────────────────────────────

function parseTradingViewWS(payload) {
    const messages = [];
    let remaining = payload;
    while (remaining) {
        const match = remaining.match(/^~m~(\d+)~m~/);
        if (!match) break;
        const header = match[0];
        const length = parseInt(match[1], 10);
        const jsonStr = remaining.substring(header.length, header.length + length);
        try { messages.push(JSON.parse(jsonStr)); } catch (e) { }
        remaining = remaining.substring(header.length + length);
    }
    return messages;
}

// ─────────────────────────────────────────────
// MAIN PROCESS FUNCTION (original strategies kept + new intraday data added)
// ─────────────────────────────────────────────

function processCandlesAndGetState(candles, symbol, interval, options = {}) {
    if (candles.length === 0) return null;

    candles.sort((a, b) => new Date(a.time) - new Date(b.time));

    const strategy = options.strategy || 'HMA_SLOPE';
    const period = options.period || 16;
    const fastPeriod = options.fastPeriod || 9;
    const slowPeriod = options.slowPeriod || 21;
    const useHeikinAshi = options.useHeikinAshi || false;
    const confirmations = options.confirmations || [];

    let calcCandles = candles;
    if (useHeikinAshi) calcCandles = convertToHeikinAshi(candles);

    const prices = calcCandles.map(c => c.close);

    let fastIndicator = [];
    let slowIndicator = [];

    if (strategy === 'HMA_SLOPE') {
        fastIndicator = calculateHMA(prices, period);
        slowIndicator = new Array(prices.length).fill(null);
    } else if (strategy === 'HMA_CROSS') {
        fastIndicator = calculateHMA(prices, fastPeriod);
        slowIndicator = calculateHMA(prices, slowPeriod);
    } else if (strategy === 'ZLEMA_CROSS') {
        fastIndicator = calculateZLEMA(prices, fastPeriod);
        slowIndicator = calculateEMA(prices, slowPeriod);
    } else if (strategy === 'APLUS_INTRADAY' || strategy === 'GAP_FADE') {
        fastIndicator = calculateEMA(prices, 9);
        slowIndicator = calculateEMA(prices, 21);
    }

    const ema50 = calculateEMA(prices, 50);
    const rsiValues = calculateRSI(prices, 14);
    const macdData = calculateMACD(prices, 12, 26, 9);
    const volumes = calcCandles.map(c => c.volume || 0);
    const volSMA10 = calculateSMA(volumes, 10);

    // ── NEW: compute intraday extras ──
    const vwap = calculateVWAP(candles);
    const atr = calculateATR(candles, 14);
    const prevDay = getPrevDayData(candles);
    const dailyRSI = getDailyRSI(candles);
    const gapFadeSignal = (strategy === 'GAP_FADE') ? detectGapFadeShort(candles, symbol) : null;

    // Today's data summary
    const todayCandles = candles.filter(c => isTodayIST(c.time));
    const todayHigh = todayCandles.length > 0 ? Math.max(...todayCandles.map(c => c.high)) : null;
    const todayLow = todayCandles.length > 0 ? Math.min(...todayCandles.map(c => c.low)) : null;
    const todayOpen = todayCandles.length > 0 ? todayCandles[0].open : null;
    const gapPercent = (prevDay && todayOpen && prevDay.close > 0)
        ? parseFloat(((todayOpen - prevDay.close) / prevDay.close * 100).toFixed(2))
        : null;

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
            if (i > 0 && fastVal !== null && slowVal !== null && ema50[i] !== null &&
                rsiValues[i] !== null && macdData.histogram[i] !== null && volSMA10[i] !== null) {

                const isCrossoverBuy = fastVal > slowVal && fastIndicator[i - 1] <= slowIndicator[i - 1];
                const isCrossoverSell = fastVal < slowVal && fastIndicator[i - 1] >= slowIndicator[i - 1];
                const isTrendBullish = prices[i] > ema50[i] && ema50[i] > ema50[i - 1];
                const isRsiBullish = rsiValues[i] >= 48 && rsiValues[i] <= 68;
                const isMacdBullish = macdData.histogram[i] > 0 && macdData.histogram[i] > macdData.histogram[i - 1];
                const isVolBullish = volumes[i] > volSMA10[i] * 1.0;
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
                    candles[i].signal = 'EXIT_LONG';
                    signals.push({ time: candles[i].time, price: candles[i].close, type: 'EXIT_LONG', indicatorVal: fastVal });
                } else if (isCrossoverBuy) {
                    candles[i].signal = 'EXIT_SHORT';
                    signals.push({ time: candles[i].time, price: candles[i].close, type: 'EXIT_SHORT', indicatorVal: fastVal });
                }
            } else if (fastVal !== null && slowVal !== null) {
                candles[i].trend = fastVal > slowVal ? 'GREEN' : 'RED';
            }
        } else if (strategy === 'GAP_FADE') {
            // For GAP_FADE strategy, trend is just EMA direction
            if (fastVal !== null && slowVal !== null) {
                candles[i].trend = fastVal > slowVal ? 'GREEN' : 'RED';
            }
            // Actual signal is computed once via detectGapFadeShort above
        } else {
            // STANDARD STRATEGIES (HMA_SLOPE, HMA_CROSS, ZLEMA_CROSS)
            if (fastVal !== null) {
                let currentTrend = null;
                if (strategy === 'HMA_SLOPE') {
                    if (i > 0 && fastIndicator[i - 1] !== null) {
                        currentTrend = fastVal > fastIndicator[i - 1] ? 'GREEN' : 'RED';
                    }
                } else {
                    if (slowVal !== null) currentTrend = fastVal > slowVal ? 'GREEN' : 'RED';
                }
                candles[i].trend = currentTrend;
                if (currentTrend && prevTrend && currentTrend !== prevTrend) {
                    let potentialSignal = currentTrend === 'GREEN' ? 'BUY' : 'SELL';
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
                        signals.push({ time: candles[i].time, price: candles[i].close, type: potentialSignal, indicatorVal: fastVal });
                    }
                }
                if (currentTrend) prevTrend = currentTrend;
            }
        }
    }

    const latest = candles[candles.length - 1];
    const sliceIndex = Math.max(0, candles.length - 100);
    const displayCandles = candles.slice(sliceIndex);
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
        // ── intraday extras (new) ──
        intradayData: {
            vwap: vwap ? parseFloat(vwap.toFixed(2)) : null,
            atr: atr,
            gapPercent,
            todayOpen: todayOpen ? parseFloat(todayOpen.toFixed(2)) : null,
            todayHigh: todayHigh ? parseFloat(todayHigh.toFixed(2)) : null,
            todayLow: todayLow ? parseFloat(todayLow.toFixed(2)) : null,
            prevDayClose: prevDay ? parseFloat(prevDay.close.toFixed(2)) : null,
            prevDayHigh: prevDay ? parseFloat(prevDay.high.toFixed(2)) : null,
            prevDayLow: prevDay ? parseFloat(prevDay.low.toFixed(2)) : null,
            dailyRSI,
            consecutiveRedDays: getConsecutiveRedDays(candles),
            gapFadeSignal  // null unless strategy === 'GAP_FADE'
        },
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

// ─────────────────────────────────────────────
// STREAM SYMBOL (unchanged from original)
// ─────────────────────────────────────────────

async function streamSymbol(symbol, interval = '1D', options = {}, onUpdate) {
    const intervalMap = { '1': '1', '5': '5', '10': '10', '15': '15', '1D': '1D' };
    const mappedInterval = intervalMap[interval] || '1D';
    let url = `https://www.tradingview.com/chart/?symbol=${symbol}`;
    if (mappedInterval !== '1D') url += `&interval=${mappedInterval}`;

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
                                        open: bar.v[1], high: bar.v[2],
                                        low: bar.v[3], close: bar.v[4], volume: bar.v[5]
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
                                        low: bar.v[3], close: bar.v[4], volume: bar.v[5]
                                    };
                                    const existingIndex = candles.findIndex(c => c.time === update.time);
                                    if (existingIndex !== -1) candles[existingIndex] = update;
                                    else candles.push(update);
                                    stateUpdated = true;
                                }
                            }
                        }
                    }
                }
            }

            if (stateUpdated) {
                const state = processCandlesAndGetState(candles, symbol, interval, options);
                if (state) onUpdate(state);
            }
        });
    });

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (err) {
        if (!isClosed) { await browser.close(); throw new Error('Failed to load chart data'); }
    }

    return async () => { isClosed = true; await browser.close(); };
}

module.exports = {
    streamSymbol,
    processCandlesAndGetState,
    // ── new exports ──
    detectGapFadeShort,
    analyzeMarketHealth,
    calculateVWAP,
    calculateATR,
    getPrevDayData,
    getDailyRSI,
    getConsecutiveRedDays,
    parseTradingViewWS
};