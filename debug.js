const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({
        headless: false
    });

    const page = await browser.newPage();

    await page.goto(
        'https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT'
    );

    await page.waitForTimeout(10000);

    const keys = await page.evaluate(() => {
        return Object.keys(window).filter(key =>
            key.toLowerCase().includes('chart') ||
            key.toLowerCase().includes('tv') ||
            key.toLowerCase().includes('trading')
        );
    });

    console.log(keys);

    await page.waitForTimeout(30000);
})();
