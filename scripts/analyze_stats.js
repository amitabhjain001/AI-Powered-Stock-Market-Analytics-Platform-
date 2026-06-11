const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, '../data/signals_history.json');
if (!fs.existsSync(dataFile)) {
    console.log("No data file found.");
    process.exit();
}

const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

let wins = 0;
let losses = 0;
let totalProfitPct = 0;

for (const signal of data) {
    if (signal.profitPct > 0) wins++;
    else if (signal.profitPct <= 0) losses++;
    
    totalProfitPct += signal.profitPct;
    
    console.log(`Trade: ${signal.symbol} | Type: ${signal.type} | Profit %: ${signal.profitPct}% | Net Rs: ${signal.result}`);
}

const totalClosed = wins + losses;
const winRate = totalClosed > 0 ? (wins / totalClosed * 100).toFixed(2) : 0;

console.log(`\nTotal Trades: ${data.length}`);
console.log(`Closed Trades: ${totalClosed}`);
console.log(`Wins (by %): ${wins}`);
console.log(`Losses (by %): ${losses}`);
console.log(`Win Rate (by %): ${winRate}%`);
console.log(`Estimated ITM Options P&L: ${totalProfitPct.toFixed(2)}%`);
