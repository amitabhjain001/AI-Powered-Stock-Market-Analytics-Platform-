const { chromium } = require('playwright');
const fs = require('fs');

const priceHistory = [];

function getMomentum(history) {
    if (history.length < 2) {
        return 0;
    }

    const first = history[0].price;
    const last = history[history.length - 1].price;

    return (last - first).toFixed(2);
}

(async () => {
    const browser = await chromium.launch({
        headless: false
    });

    const page = await browser.newPage();

    await page.goto(
        'https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT'
    );

    console.log("Monitoring BTCUSDT...\n");

    setInterval(async () => {
        try {
            const title = await page.title();

            const parts = title.split(" ");

            const symbol = parts[0];
            const price = parseFloat(parts[1].replace(/,/g, ""));

            const marketData = {
                symbol,
                price,
                timestamp: new Date().toISOString()
            };

            priceHistory.push({
                price,
                timestamp: Date.now()
            });
            fs.writeFileSync(
                'prices.json',
                JSON.stringify(priceHistory, null, 2)
            );

            // Keep only latest 100 prices
            if (priceHistory.length > 100) {
                priceHistory.shift();
            }

            console.clear();

            console.log("=== LIVE MARKET DATA ===");
            console.log(marketData);

            console.log("\n=== STATS ===");
            console.log("Stored Prices:", priceHistory.length);
            console.log("Momentum:", getMomentum(priceHistory));

        } catch (err) {
            console.error(err);
        }
    }, 2000);

})();