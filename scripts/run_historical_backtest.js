const { streamSymbol, processCandlesAndGetState } = require('../scanner');
const { appendMultipleSignalsToHistory } = require('../storage');
const { chromium } = require('playwright');
const fs = require('fs');

const STOCK_LISTS = {
    INDIAN_STOCKS: [
        { symbol: 'NSE:NIFTY', name: 'NIFTY 50' },
        { symbol: 'NSE:BANKNIFTY', name: 'NIFTY BANK' },
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
    ]
};

async function runBacktest() {
    console.log("Starting Historical Backtest for Indian Stocks...");
    const symbols = STOCK_LISTS.INDIAN_STOCKS;
    let allHistoricalSignals = [];
    let niftyCandles = null;

    // ── Pre-fetch Nifty candles to build market health trend map ──
    const niftyStock = symbols.find(s => s.symbol === 'NSE:NIFTY');
    if (niftyStock) {
        console.log(`Pre-fetching market health index data from ${niftyStock.symbol}...`);
        let fetchedNiftyState = null;
        const cleanupNifty = await streamSymbol(niftyStock.symbol, '5', { strategy: 'SMART_MONEY' }, (state) => {
            if (!fetchedNiftyState && state.candles.length > 50) {
                fetchedNiftyState = state;
            }
        });
        await new Promise(r => setTimeout(r, 4500));
        await cleanupNifty();
        if (fetchedNiftyState) {
            niftyCandles = fetchedNiftyState.candles;
            console.log(`Market health index context populated with ${niftyCandles.length} candles.`);
        }
    }
    
    for (const stock of symbols) {
        console.log(`Fetching historical data for ${stock.symbol}...`);
        
        let fetchedStateSmartMoney = null;
        
        const cleanupSmartMoney = await streamSymbol(stock.symbol, '5', { 
            strategy: 'SMART_MONEY',
            niftyCandles: niftyCandles 
        }, (state) => {
            if (!fetchedStateSmartMoney && state.candles.length > 50) {
                fetchedStateSmartMoney = state;
            }
        });
        
        // Wait a bit to let websockets populate the initial historical data
        await new Promise(r => setTimeout(r, 4500));
        await cleanupSmartMoney();
        
        if (fetchedStateSmartMoney) {
            // Process SMART_MONEY signals
            const tradeLog = fetchedStateSmartMoney.tradeLog || [];
            tradeLog.forEach((trade, i) => {
                // Determine reason
                let reason = null;
                if (trade.result.includes('LOSS')) {
                    reason = "BOS invalidation or opposite structural break.";
                } else {
                    reason = "BOS breakout or Support/Resistance bounce.";
                }
                
                allHistoricalSignals.push({
                    id: `${stock.symbol}_SMART_${trade.entryTime}`,
                    symbol: stock.symbol,
                    name: stock.name,
                    strategy: 'SMART_MONEY',
                    type: trade.tradeType, // 'LONG' or 'SHORT'
                    entryTime: trade.entryTime,
                    exitTime: trade.exitTime,
                    entryPrice: trade.entryPrice,
                    exitPrice: trade.exitPrice,
                    profitPct: trade.profitPct,
                    result: trade.result,
                    reason: reason
                });
            });
        }
    }

    if (allHistoricalSignals.length > 0) {
        appendMultipleSignalsToHistory(allHistoricalSignals);
        console.log(`Backtest complete! Saved ${allHistoricalSignals.length} signals.`);
    } else {
        console.log("No signals found in historical data.");
    }
    
    process.exit(0);
}

runBacktest().catch(err => {
    console.error("Backtest Error:", err);
    process.exit(1);
});
