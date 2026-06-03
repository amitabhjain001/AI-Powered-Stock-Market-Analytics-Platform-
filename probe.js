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

    const result = await page.evaluate(() => {
        const api = window.ChartApiInstance;

        const sessions = api._sessions || {};
        const firstKey = Object.keys(sessions)[0];
        const session = sessions[firstKey];

        return {
            firstSession: firstKey,
            symbolResolveMapKeys: session._symbolResolveMap
                ? Object.keys(session._symbolResolveMap)
                : [],
            lastSymbolResolveInfoMapKeys: session._lastSymbolResolveInfoMap
                ? Object.keys(session._lastSymbolResolveInfoMap)
                : []
        };
    });

    console.log(JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));

    await page.waitForTimeout(10000);

    await browser.close();
})();