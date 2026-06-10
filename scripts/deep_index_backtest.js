const YF = require('yahoo-finance2').default;
const yahooFinance = new YF();
const { processCandlesAndGetState } = require('../scanner');
const { appendMultipleSignalsToHistory } = require('../storage');

// Use NIFTY and SENSEX symbols according to Yahoo Finance
const INDEXES = [
    { symbol: '^NSEI', name: 'NIFTY 50' },
    { symbol: '^BSESN', name: 'SENSEX' }
];

async function runDeepBacktest() {
    console.log("Starting Deep Historical Backtest for Indian Indexes...");
    
    // Fetch 7 days of 5-minute data
    const period1 = new Date();
    period1.setDate(period1.getDate() - 14); // Try 14 days ago for more data
    const period2 = new Date();

    let allHistoricalSignals = [];

    for (const index of INDEXES) {
        console.log(`\nFetching deep historical data for ${index.name} (${index.symbol})...`);
        try {
            const queryOptions = { period1: period1, period2: period2, interval: '5m' };
            const result = await yahooFinance.chart(index.symbol, queryOptions);
            
            if (!result || !result.quotes || result.quotes.length === 0) {
                console.log(`No data found for ${index.symbol}`);
                continue;
            }

            console.log(`Fetched ${result.quotes.length} candles.`);

            // Format to match scanner structure
            const formattedCandles = result.quotes
                .filter(q => q.open !== null && q.close !== null) // filter out empty candles
                .map(q => ({
                    time: new Date(q.date).toISOString(),
                    open: q.open,
                    high: q.high,
                    low: q.low,
                    close: q.close,
                    volume: q.volume || 0
                }));
            
            // ── Group by trading day and process each day separately ──
            // This ensures VWAP resets correctly per session
            const dayMap = {};
            formattedCandles.forEach(c => {
                const dayStr = new Date(new Date(c.time).getTime() + 5.5*60*60*1000).toISOString().slice(0,10);
                if (!dayMap[dayStr]) dayMap[dayStr] = [];
                dayMap[dayStr].push(c);
            });

            const sortedDays = Object.keys(dayMap).sort();
            console.log(`Found ${sortedDays.length} trading days: ${sortedDays.join(', ')}`);

            // Accumulate all trades across all days
            const allDayTrades = [];

            for (const dayStr of sortedDays) {
                const dayCandles = dayMap[dayStr];
                if (dayCandles.length < 10) continue; // skip low-data days

                // Process this day's candles through the strategy
                const state = processCandlesAndGetState(dayCandles, index.symbol, '5', { strategy: 'SMART_MONEY' });
                const dayTrades = (state && state.tradeLog) ? state.tradeLog.filter(t => !t.open) : [];
                if (dayTrades.length > 0) {
                    console.log(`  ${dayStr}: ${dayTrades.length} trades`);
                }
                allDayTrades.push(...dayTrades);
            }

            const signalsForIndex = allDayTrades;

            console.log(`Generated ${signalsForIndex.length} trades for ${index.name}.`);

            // Format for storage
            signalsForIndex.forEach(trade => {
                allHistoricalSignals.push({
                    id: `${index.symbol}_SMART_${trade.entryTime}`,
                    symbol: index.symbol,
                    name: index.name,
                    strategy: 'SMART_MONEY',
                    type: trade.tradeType,
                    entryTime: trade.entryTime,
                    exitTime: trade.exitTime,
                    entryPrice: trade.entryPrice,
                    exitPrice: trade.exitPrice,
                    profitPct: trade.profitPct,
                    result: trade.result,
                    reason: "Deep Backtest (Yahoo Finance)"
                });
            });

        } catch (err) {
            console.error(`Error fetching data for ${index.symbol}:`, err);
        }
    }

    if (allHistoricalSignals.length > 0) {
        // Clear old history before appending new deep history
        try {
            require('fs').unlinkSync('./data/signals_history.json');
        } catch(e) {}
        
        appendMultipleSignalsToHistory(allHistoricalSignals);
        console.log(`\nDeep backtest complete! Saved ${allHistoricalSignals.length} signals.`);
    } else {
        console.log("\nNo signals found in deep historical data.");
    }
}

runDeepBacktest();
