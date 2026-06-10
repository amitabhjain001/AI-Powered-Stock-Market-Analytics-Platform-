/**
 * Debug script: Shows every signal that fires per stock so we can understand
 * what the strategy is actually doing.
 */
const { streamSymbol } = require('../scanner');

const STOCKS = [
    { symbol: 'NSE:NIFTY', name: 'NIFTY 50' },
    { symbol: 'NSE:BANKNIFTY', name: 'NIFTY BANK' },
    { symbol: 'NSE:HDFCBANK', name: 'HDFC Bank' },
    { symbol: 'NSE:TCS', name: 'TCS' },
    { symbol: 'NSE:SBIN', name: 'SBI' },
];

async function debugStock(stock) {
    let result = null;
    const cleanup = await streamSymbol(stock.symbol, '5', { strategy: 'SMART_MONEY' }, (state) => {
        if (!result && state.candles.length > 50) {
            result = state;
        }
    });
    await new Promise(r => setTimeout(r, 4000));
    await cleanup();

    if (!result) {
        console.log(`\n[${stock.symbol}] No data received`);
        return;
    }

    const candles = result.candles;
    const signals = candles.filter(c => c.signal);
    
    console.log(`\n====== ${stock.symbol} (${candles.length} candles) ======`);
    console.log(`Signals found: ${signals.length}`);
    
    // Print last 5 candles with all indicator values
    console.log('\nLast 5 candles with indicators:');
    candles.slice(-5).forEach(c => {
        const t = new Date(c.time);
        const ist = new Date(t.getTime() + 5.5 * 60 * 60 * 1000);
        console.log(`  ${ist.toISOString().slice(11,16)} | Close: ${c.close} | VWAP: ${c.vwap || 'N/A'} | EMA50: ${c.ema50 || 'N/A'} | RSI: ${c.rsi || 'N/A'} | Vol: ${c.volume || 0} | Signal: ${c.signal || '-'}`);
    });

    // Print all signals
    if (signals.length > 0) {
        console.log('\nAll signals:');
        signals.forEach(c => {
            const t = new Date(c.time);
            const ist = new Date(t.getTime() + 5.5 * 60 * 60 * 1000);
            console.log(`  [${c.signal}] at ${ist.toISOString().slice(11,16)} IST | Price: ${c.close} | RSI: ${c.rsi}`);
        });
    }
    
    // Check EMA9 vs EMA21 crossovers
    let crossovers = 0;
    let vwapReclaims = 0;
    let vwapRejections = 0;
    
    for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        if (curr.fastVal !== null && curr.slowVal !== null && prev.fastVal !== null && prev.slowVal !== null) {
            if (prev.fastVal <= prev.slowVal && curr.fastVal > curr.slowVal) crossovers++;
            if (prev.fastVal >= prev.slowVal && curr.fastVal < curr.slowVal) crossovers++;
        }
    }
    console.log(`\nEMA crossovers total: ${crossovers}`);
}

async function main() {
    console.log('Debugging SMART_MONEY strategy signals...\n');
    for (const stock of STOCKS) {
        await debugStock(stock);
    }
    console.log('\nDone!');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
