const { streamSymbol, processCandlesAndGetState, analyzeMarketHealth } = require('../scanner');

async function test() {
    console.log("Fetching Nifty...");
    let niftyState = null;
    const cleanupNifty = await streamSymbol('NSE:NIFTY', '5', { strategy: 'SMART_MONEY' }, (state) => {
        if (!niftyState && state.candles.length > 50) {
            niftyState = state;
        }
    });
    await new Promise(r => setTimeout(r, 4500));
    await cleanupNifty();

    if (!niftyState) {
        console.log("No nifty state fetched.");
        return;
    }

    console.log(`Nifty candles: ${niftyState.candles.length}`);
    
    // Let's test a slice at 11:15 AM
    const targetTimeStr = niftyState.candles.find(c => c.time.includes('T05:45:00'))?.time; // 11:15 AM IST is 05:45:00 UTC
    if (!targetTimeStr) {
        console.log("Could not find 11:15 AM candle");
        return;
    }

    const niftySlice = niftyState.candles.filter(nc => new Date(nc.time) <= new Date(targetTimeStr));
    const health = analyzeMarketHealth(niftySlice);
    console.log(`Health at 11:15 AM:`, health);
}

test().catch(console.error);
