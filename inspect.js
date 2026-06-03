const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({
        headless: false
    });

    const page = await browser.newPage();

    await page.goto(
        'https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT'
    );

    console.log("Waiting 10 seconds for chart to load...");

    await page.waitForTimeout(10000);

    const text = await page.locator('body').innerText();

    console.log(text);

    await page.waitForTimeout(60000);
})();