const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'signals_history.json');

function initStorage() {
    if (!fs.existsSync(path.dirname(DATA_FILE))) {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify([]));
    }
}

function appendSignalToHistory(signal) {
    try {
        initStorage();
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        
        // check if signal ID already exists to prevent duplicates
        if (!data.some(s => s.id === signal.id)) {
            data.push(signal);
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        }
    } catch (e) {
        console.error('[Storage] Error saving signal to history:', e.message);
    }
}

function appendMultipleSignalsToHistory(signals) {
    try {
        initStorage();
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        let added = 0;
        
        for (const signal of signals) {
            if (!data.some(s => s.id === signal.id)) {
                data.push(signal);
                added++;
            }
        }
        
        if (added > 0) {
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
            console.log(`[Storage] Appended ${added} historical signals.`);
        }
    } catch (e) {
        console.error('[Storage] Error saving multiple signals:', e.message);
    }
}

function getSignalHistory() {
    try {
        initStorage();
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        console.error('[Storage] Error reading signals history:', e.message);
        return [];
    }
}

module.exports = {
    appendSignalToHistory,
    appendMultipleSignalsToHistory,
    getSignalHistory
};
