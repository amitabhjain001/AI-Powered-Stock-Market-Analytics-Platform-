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

    const text = await page.locator('body').innerText();

    const openMatch = text.match(/O\s+([\d,]+\.\d+)/);
    const highMatch = text.match(/H\s+([\d,]+\.\d+)/);
    const lowMatch = text.match(/L\s+([\d,]+\.\d+)/);
    const closeMatch = text.match(/C\s+([\d,]+\.\d+)/);

    console.log({
        open: openMatch?.[1],
        high: highMatch?.[1],
        low: lowMatch?.[1],
        close: closeMatch?.[1]
    });

    await browser.close();
})();