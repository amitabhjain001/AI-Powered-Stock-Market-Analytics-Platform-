document.addEventListener('DOMContentLoaded', () => {
    // Tab Navigation Elements
    const tabSingle = document.getElementById('tabSingle');
    const tabMulti = document.getElementById('tabMulti');
    const tabLedger = document.getElementById('tabLedger');
    const singleStockView = document.getElementById('singleStockView');
    const multiStockView = document.getElementById('multiStockView');
    const dailyLedgerView = document.getElementById('dailyLedgerView');

    // Single Analysis Form Elements
    const analyzeBtn = document.getElementById('analyzeBtn');
    const symbolSelect = document.getElementById('symbolSelect');
    const intervalSelect = document.getElementById('intervalSelect');
    const strategySelect = document.getElementById('strategySelect');

    // Period inputs
    const singlePeriodGroup = document.getElementById('singlePeriodGroup');
    const fastPeriodGroup = document.getElementById('fastPeriodGroup');
    const slowPeriodGroup = document.getElementById('slowPeriodGroup');
    const confirmationsCheckboxes = document.getElementById('confirmationsCheckboxes');

    const periodInput = document.getElementById('periodInput');
    const fastPeriodInput = document.getElementById('fastPeriodInput');
    const slowPeriodInput = document.getElementById('slowPeriodInput');

    // Checkboxes
    const heikinAshiCheck = document.getElementById('heikinAshiCheck');
    const rsiConfirm = document.getElementById('rsiConfirm');
    const macdConfirm = document.getElementById('macdConfirm');

    const loader = document.getElementById('loader');
    const dashboard = document.getElementById('dashboard');

    const signalAlert = document.getElementById('signalAlert');
    const alertText = document.getElementById('alertText');
    const alertSubtext = document.getElementById('alertSubtext');

    // Voice controls
    const muteBtn = document.getElementById('muteBtn');
    const volumeRange = document.getElementById('volumeRange');

    // Dashboard Value Holders
    const priceVal = document.getElementById('priceVal');
    const hmaVal = document.getElementById('hmaVal');
    const slowVal = document.getElementById('slowVal');
    const slowIndRow = document.getElementById('slowIndRow');
    const trendVal = document.getElementById('trendVal');
    const timeVal = document.getElementById('timeVal');
    const signalsTableBody = document.querySelector('#signalsTable tbody');

    // Notification Elements
    const notificationBellBtn = document.getElementById('notificationBellBtn');
    const bellBadge = document.getElementById('bellBadge');
    const notificationDropdown = document.getElementById('notificationDropdown');
    const alertsList = document.getElementById('alertsList');
    const clearAlertsBtn = document.getElementById('clearAlertsBtn');

    // Multi-Stock View Control Elements
    const multiAssetSelect = document.getElementById('multiAssetSelect');
    const multiIntervalSelect = document.getElementById('multiIntervalSelect');
    const scannerStatusDot = document.getElementById('scannerStatusDot');
    const scannerStatusText = document.getElementById('scannerStatusText');
    const scannerGrid = document.getElementById('scannerGrid');

    let currentEventSource = null;
    let intradayEventSource = null;
    let lastSpokenSignalTime = null;
    let isMuted = false;
    let voiceVolume = 0.8;

    let localAlertsList = []; // Keeps track of active alerts in memory

    // Sound chime synthesizer using Web Audio API
    function playChime() {
        if (isMuted) return;
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const playTone = (freq, time, duration) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, time);

                gain.gain.setValueAtTime(0, time);
                gain.gain.linearRampToValueAtTime(0.15, time + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

                osc.start(time);
                osc.stop(time + duration);
            };

            const now = audioCtx.currentTime;
            playTone(587.33, now, 0.35); // D5
            playTone(880, now + 0.12, 0.55); // A5
        } catch (e) {
            console.error('Audio synthesis failed:', e);
        }
    }

    // Toggle strategy period fields
    function updateStrategyInputsVisibility() {
        const strategy = strategySelect.value;
        if (strategy === 'APLUS_INTRADAY' || strategy === 'GAP_FADE') {
            singlePeriodGroup.classList.add('hidden');
            fastPeriodGroup.classList.add('hidden');
            slowPeriodGroup.classList.add('hidden');
            confirmationsCheckboxes.classList.add('hidden');
        } else if (strategy === 'HMA_SLOPE') {
            singlePeriodGroup.classList.remove('hidden');
            fastPeriodGroup.classList.add('hidden');
            slowPeriodGroup.classList.add('hidden');
            confirmationsCheckboxes.classList.remove('hidden');
        } else {
            singlePeriodGroup.classList.add('hidden');
            fastPeriodGroup.classList.remove('hidden');
            slowPeriodGroup.classList.remove('hidden');
            confirmationsCheckboxes.classList.remove('hidden');
        }
    }

    strategySelect.addEventListener('change', updateStrategyInputsVisibility);
    updateStrategyInputsVisibility(); // Run on startup

    async function fetchDailyLedger() {
        const tableBody = document.getElementById('dailyLedgerTableBody');
        try {
            const res = await fetch('/api/daily-ledger');
            const data = await res.json();

            if (data.success) {
                if (data.ledger.length === 0) {
                    tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8;">No trades executed today yet.</td></tr>';
                    return;
                }

                tableBody.innerHTML = '';
                data.ledger.forEach(trade => {
                    const row = document.createElement('tr');
                    const timeStr = new Date(trade.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const priceStr = trade.symbol.includes('USD') || trade.symbol.includes('BTC') ? `$${trade.price.toFixed(2)}` : `₹${trade.price.toFixed(2)}`;

                    const badgeClass = trade.type.toLowerCase();

                    row.innerHTML = `
                        <td>${timeStr}</td>
                        <td style="font-weight: 600;">${trade.symbol}</td>
                        <td><span class="alert-badge ${badgeClass}">${trade.type.replace('_', ' ')}</span></td>
                        <td>${priceStr}</td>
                        <td>${trade.prob}</td>
                        <td><button class="btn-primary btn-sm btn-view-ledger" data-symbol="${trade.symbol}">View Chart</button></td>
                    `;

                    row.querySelector('.btn-view-ledger').addEventListener('click', () => {
                        loadAssetInChart(trade.symbol, '5'); // Default back to 5min chart which scanner uses
                    });

                    tableBody.appendChild(row);
                });
            }
        } catch (e) {
            console.error('Failed to fetch daily ledger', e);
        }
    }

    document.getElementById('refreshLedgerBtn').addEventListener('click', fetchDailyLedger);

    // Tab toggles
    function activateTab(tabId) {
        tabSingle.classList.remove('active');
        tabMulti.classList.remove('active');
        tabLedger.classList.remove('active');
        singleStockView.classList.add('hidden');
        multiStockView.classList.add('hidden');
        dailyLedgerView.classList.add('hidden');

        if (tabId === 'single') {
            tabSingle.classList.add('active');
            singleStockView.classList.remove('hidden');
        } else if (tabId === 'multi') {
            tabMulti.classList.add('active');
            multiStockView.classList.remove('hidden');
        } else if (tabId === 'ledger') {
            tabLedger.classList.add('active');
            dailyLedgerView.classList.remove('hidden');
            fetchDailyLedger();
        }
    }

    tabSingle.addEventListener('click', () => activateTab('single'));
    tabMulti.addEventListener('click', () => activateTab('multi'));
    tabLedger.addEventListener('click', () => activateTab('ledger'));

    // Voice control event listeners
    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        if (isMuted) {
            muteBtn.textContent = '🔇 Muted';
            muteBtn.classList.add('muted');
        } else {
            muteBtn.textContent = '🔊 Sound On';
            muteBtn.classList.remove('muted');
        }
    });

    volumeRange.addEventListener('input', (e) => {
        voiceVolume = parseFloat(e.target.value);
    });

    function speakAlert(text) {
        if (isMuted) return;
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.0;
            utterance.pitch = 1.1;
            utterance.volume = voiceVolume;
            window.speechSynthesis.speak(utterance);
        }
    }

    // Toggle Notifications dropdown
    notificationBellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notificationDropdown.classList.toggle('hidden');

        // Hide badge count once dropdown is open
        if (!notificationDropdown.classList.contains('hidden')) {
            bellBadge.classList.add('hidden');
            bellBadge.textContent = '0';
        }
    });

    document.addEventListener('click', () => {
        notificationDropdown.classList.add('hidden');
    });

    notificationDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    clearAlertsBtn.addEventListener('click', () => {
        localAlertsList = [];
        renderAlertsDropdown();
    });

    // Load a symbol and interval in the main dashboard view
    function loadAssetInChart(symbol, interval) {
        // Dynamically add option if it doesn't exist in the dropdown
        let exists = false;
        for (let i = 0; i < symbolSelect.options.length; i++) {
            if (symbolSelect.options[i].value === symbol) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            const newOpt = document.createElement('option');
            newOpt.value = symbol;
            newOpt.text = symbol.split(':')[1] || symbol;
            symbolSelect.appendChild(newOpt);
        }

        // Find select options
        symbolSelect.value = symbol;
        intervalSelect.value = interval;
        strategySelect.value = 'GAP_FADE';

        updateStrategyInputsVisibility();

        // Switch to single view
        tabSingle.click();

        // Trigger analysis
        analyzeBtn.click();
    }

    // Connect to single stock analyzer
    analyzeBtn.addEventListener('click', () => {
        const symbol = symbolSelect.value;
        const interval = intervalSelect.value;
        const strategy = strategySelect.value;
        const assetName = symbolSelect.options[symbolSelect.selectedIndex].text;

        const period = periodInput.value;
        const fastPeriod = fastPeriodInput.value;
        const slowPeriod = slowPeriodInput.value;
        const useHeikinAshi = heikinAshiCheck.checked;

        const confirmations = [];
        if (rsiConfirm.checked && strategy !== 'APLUS_INTRADAY' && strategy !== 'GAP_FADE') confirmations.push('RSI');
        if (macdConfirm.checked && strategy !== 'APLUS_INTRADAY' && strategy !== 'GAP_FADE') confirmations.push('MACD');

        // Clean up previous stream if exists
        if (currentEventSource) {
            currentEventSource.close();
            currentEventSource = null;
        }

        // Show loader, hide dashboard
        loader.classList.remove('hidden');
        dashboard.classList.add('hidden');
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Connecting Live Stream...';

        // Build SSE URL with all parameters
        let sseUrl = `/api/stream?symbol=${encodeURIComponent(symbol)}&interval=${interval}&strategy=${strategy}&useHeikinAshi=${useHeikinAshi}`;
        if (strategy === 'HMA_SLOPE') {
            sseUrl += `&period=${period}`;
        } else if (strategy !== 'APLUS_INTRADAY') {
            sseUrl += `&fastPeriod=${fastPeriod}&slowPeriod=${slowPeriod}`;
        }
        if (confirmations.length > 0) {
            sseUrl += `&confirmations=${confirmations.join(',')}`;
        }

        // Connect to SSE stream
        currentEventSource = new EventSource(sseUrl);

        currentEventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.error) {
                console.error('Stream Error:', data.error);
                alert(`Stream Error: ${data.error}`);
                currentEventSource.close();
                analyzeBtn.disabled = false;
                analyzeBtn.textContent = 'Analyze Market';
                loader.classList.add('hidden');
                return;
            }

            updateDashboard(data, assetName);

            // Show dashboard, hide loader if it's the first data received
            if (loader.classList.contains('hidden') === false) {
                loader.classList.add('hidden');
                dashboard.classList.remove('hidden');
                analyzeBtn.disabled = false;
                analyzeBtn.textContent = 'Streaming Live Data...';
                analyzeBtn.classList.add('live-btn');
            }
        };

        currentEventSource.onerror = (error) => {
            console.error('EventSource failed:', error);
            currentEventSource.close();
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Analyze Market';
            analyzeBtn.classList.remove('live-btn');
        };
    });

    function updateDashboard(data, assetName) {
        const latest = data.latest;
        const isCrypto = data.symbol.includes('USD') || data.symbol.includes('BTC');
        const cSign = isCrypto ? '$' : '₹ ';

        // Update Current State
        priceVal.textContent = `${cSign}${latest.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        if (data.strategy === 'HMA_SLOPE') {
            document.getElementById('fastIndLabel').textContent = 'HMA:';
            hmaVal.textContent = latest.fastVal !== null ? `${cSign}${latest.fastVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
            slowIndRow.classList.add('hidden');
        } else if (data.strategy === 'HMA_CROSS') {
            document.getElementById('fastIndLabel').textContent = 'Fast HMA:';
            hmaVal.textContent = latest.fastVal !== null ? `${cSign}${latest.fastVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
            slowIndRow.classList.remove('hidden');
            slowVal.textContent = latest.slowVal !== null ? `${cSign}${latest.slowVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
        } else if (data.strategy === 'ZLEMA_CROSS') {
            document.getElementById('fastIndLabel').textContent = 'Fast ZLEMA:';
            hmaVal.textContent = latest.fastVal !== null ? `${cSign}${latest.fastVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
            slowIndRow.classList.remove('hidden');
            slowVal.textContent = latest.slowVal !== null ? `${cSign}${latest.slowVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
        } else if (data.strategy === 'APLUS_INTRADAY') {
            document.getElementById('fastIndLabel').textContent = '9 EMA (Fast):';
            hmaVal.textContent = latest.fastVal !== null ? `${cSign}${latest.fastVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
            slowIndRow.classList.remove('hidden');
            document.getElementById('slowIndRow').querySelector('span').textContent = '21 EMA (Slow):';
            slowVal.textContent = latest.slowVal !== null ? `${cSign}${latest.slowVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
        } else if (data.strategy === 'GAP_FADE') {
            document.getElementById('fastIndLabel').textContent = '9 EMA:';
            hmaVal.textContent = latest.fastVal !== null ? `${cSign}${latest.fastVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
            slowIndRow.classList.remove('hidden');
            document.getElementById('slowIndRow').querySelector('span').textContent = '21 EMA:';
            slowVal.textContent = latest.slowVal !== null ? `${cSign}${latest.slowVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
        }

        // ── Show / hide intraday context panels ──
        const intradayContextCard = document.getElementById('intradayContextCard');
        const gapFadeCard = document.getElementById('gapFadeCard');
        const id = data.intradayData || {};
        const isIntradayStrategy = data.strategy === 'GAP_FADE' || data.strategy === 'APLUS_INTRADAY';

        if (isIntradayStrategy && intradayContextCard) {
            intradayContextCard.classList.remove('hidden');
            document.getElementById('todayOpenVal').textContent = id.todayOpen ? `${cSign}${id.todayOpen.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
            document.getElementById('todayHighVal').textContent = id.todayHigh ? `${cSign}${id.todayHigh.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
            document.getElementById('prevCloseVal').textContent = id.prevDayClose ? `${cSign}${id.prevDayClose.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
            const gapEl = document.getElementById('gapPctVal');
            if (id.gapPercent !== null && id.gapPercent !== undefined) {
                gapEl.textContent = `${id.gapPercent >= 0 ? '+' : ''}${id.gapPercent.toFixed(2)}%`;
                gapEl.className = id.gapPercent > 0 ? 'pnl-positive' : id.gapPercent < 0 ? 'pnl-negative' : '';
            } else { gapEl.textContent = '--'; }
            document.getElementById('vwapVal').textContent = id.vwap ? `${cSign}${id.vwap.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--';
            document.getElementById('atrVal').textContent = id.atr !== null && id.atr !== undefined ? id.atr : '--';
            document.getElementById('dailyRsiVal').textContent = id.dailyRSI !== null && id.dailyRSI !== undefined ? id.dailyRSI : '--';
            document.getElementById('redDaysVal').textContent = id.consecutiveRedDays !== null && id.consecutiveRedDays !== undefined ? id.consecutiveRedDays : '--';
        } else if (intradayContextCard) {
            intradayContextCard.classList.add('hidden');
        }

        // ── Gap Fade signal panel ──
        if (data.strategy === 'GAP_FADE' && id.gapFadeSignal && gapFadeCard) {
            const gf = id.gapFadeSignal;
            gapFadeCard.classList.remove('hidden');
            const confBadge = document.getElementById('gapFadeConfidenceBadge');
            confBadge.textContent = gf.confidence;
            confBadge.className = `result-badge ${gf.confidence === 'HIGH' ? 'win' : gf.confidence === 'MEDIUM' ? 'open' : 'loss'}`;
            document.getElementById('gfGapPct').textContent = `+${gf.gapPercent}% (Open: ${cSign}${gf.todayOpen} | Prev: ${cSign}${gf.prevDayClose})`;
            document.getElementById('gfEntry').textContent = `${cSign}${gf.entryZoneLow} – ${cSign}${gf.entryZoneHigh}`;
            document.getElementById('gfSL').textContent = `${cSign}${gf.slApprox}`;
            document.getElementById('gfT1').textContent = `${cSign}${gf.target1} (VWAP)`;
            document.getElementById('gfT2').textContent = `${cSign}${gf.target2} (Gap Fill)`;
            const warnDiv = document.getElementById('gfWarnings');
            warnDiv.innerHTML = gf.warnings && gf.warnings.length > 0
                ? gf.warnings.map(w => `<div class="gf-warning-item">${w}</div>`).join('')
                : '';
        } else if (gapFadeCard) {
            gapFadeCard.classList.add('hidden');
        }

        if (latest.trend === 'GREEN') {
            trendVal.innerHTML = '<span class="buy-text">🟢 BULLISH (Upward)</span>';
        } else {
            trendVal.innerHTML = '<span class="sell-text">🔴 BEARISH (Downward)</span>';
        }

        const dateObj = new Date(latest.time);
        timeVal.textContent = dateObj.toLocaleString();

        // Update Alert Box and Voice Alert
        signalAlert.className = 'alert-box'; // reset classes
        if (data.strategy === 'GAP_FADE') {
            const gf = (data.intradayData || {}).gapFadeSignal;
            if (gf) {
                signalAlert.classList.add('sell-alert');
                alertText.textContent = `🎯 GAP FADE SHORT — ${gf.confidence} CONFIDENCE`;
                alertSubtext.textContent = `Gap: +${gf.gapPercent}% | Entry: ₹${gf.entryZoneLow}–${gf.entryZoneHigh} | SL: ₹${gf.slApprox} | T1: ₹${gf.target1} | T2: ₹${gf.target2}`;
                const signalKey = `gapfade_${gf.currentPrice}`;
                if (lastSpokenSignalTime !== signalKey) {
                    speakAlert(`Gap Fade Short signal on ${assetName}. ${gf.confidence} confidence. Gap ${gf.gapPercent} percent.`);
                    lastSpokenSignalTime = signalKey;
                }
            } else {
                alertText.textContent = 'Scanning for Gap Fade Setup...';
                const id2 = data.intradayData || {};
                const gapStatus = id2.gapPercent !== null && id2.gapPercent !== undefined
                    ? `Gap today: ${id2.gapPercent >= 0 ? '+' : ''}${id2.gapPercent?.toFixed(2)}% (need 1.5%–3.5%)`
                    : 'Waiting for today\'s open data...';
                alertSubtext.textContent = gapStatus;
            }
        } else if (latest.signal === 'ENTRY_LONG') {
            signalAlert.classList.add('buy-alert');
            alertText.textContent = '🚨 ENTRY LONG 🚨';
            alertSubtext.textContent = `A+ setup detected long entry! RSI: ${latest.rsi}, MACD Hist: ${latest.macdHist}.`;

            if (lastSpokenSignalTime !== latest.time) {
                speakAlert(`A+ Setup alert! Entry Long on ${assetName}. Buy signal triggered.`);
                lastSpokenSignalTime = latest.time;
            }
        } else if (latest.signal === 'ENTRY_SHORT') {
            signalAlert.classList.add('sell-alert');
            alertText.textContent = '🚨 ENTRY SHORT 🚨';
            alertSubtext.textContent = `A+ setup detected short entry! RSI: ${latest.rsi}, MACD Hist: ${latest.macdHist}.`;

            if (lastSpokenSignalTime !== latest.time) {
                speakAlert(`A+ Setup alert! Entry Short on ${assetName}. Sell first signal triggered.`);
                lastSpokenSignalTime = latest.time;
            }
        } else if (latest.signal === 'EXIT_LONG') {
            signalAlert.classList.add('sell-alert');
            alertText.textContent = '⚠️ EXIT LONG ⚠️';
            alertSubtext.textContent = `Momentum shifted. Exit your long position on ${assetName}. RSI: ${latest.rsi}.`;

            if (lastSpokenSignalTime !== latest.time) {
                speakAlert(`Exit alert! Close your long position on ${assetName}.`);
                lastSpokenSignalTime = latest.time;
            }
        } else if (latest.signal === 'EXIT_SHORT') {
            signalAlert.classList.add('buy-alert');
            alertText.textContent = '⚠️ EXIT SHORT ⚠️';
            alertSubtext.textContent = `Momentum shifted. Exit your short position on ${assetName}. RSI: ${latest.rsi}.`;

            if (lastSpokenSignalTime !== latest.time) {
                speakAlert(`Exit alert! Close your short position on ${assetName}.`);
                lastSpokenSignalTime = latest.time;
            }
        } else if (latest.signal === 'PRE_ALERT_LONG') {
            signalAlert.classList.add('buy-alert');
            alertText.textContent = '⏳ PRE-ALERT LONG ⏳';
            alertSubtext.textContent = `Price is approaching Support zone. Get ready for a Long entry on ${assetName}.`;

            if (lastSpokenSignalTime !== latest.time + '_preL') {
                speakAlert(`10 Second Warning! Approaching Support on ${assetName}. Get ready for Long.`);
                lastSpokenSignalTime = latest.time + '_preL';
            }
        } else if (latest.signal === 'PRE_ALERT_SHORT') {
            signalAlert.classList.add('sell-alert');
            alertText.textContent = '⏳ PRE-ALERT SHORT ⏳';
            alertSubtext.textContent = `Price is approaching Resistance zone. Get ready for a Short entry on ${assetName}.`;

            if (lastSpokenSignalTime !== latest.time + '_preS') {
                speakAlert(`10 Second Warning! Approaching Resistance on ${assetName}. Get ready for Short.`);
                lastSpokenSignalTime = latest.time + '_preS';
            }
        } else {
            alertText.textContent = 'Tracking Trend...';
            alertSubtext.textContent = `Currently in a ${latest.trend === 'GREEN' ? 'Bullish' : 'Bearish'} trend. Waiting for next reversal.`;
        }

        // ── Update Backtest Stats (6 cells) ───────────────────────
        const s = data.stats || {};
        document.getElementById('winRateVal').textContent = `${s.winRate ?? 0}%`;
        document.getElementById('winLossVal').textContent = `${s.winningTrades ?? 0}W / ${s.losingTrades ?? 0}L`;
        document.getElementById('totalTradesVal').textContent = s.totalTrades ?? 0;

        const netRsEl = document.getElementById('netProfitRsVal');
        const nr = s.netProfitRs ?? 0;
        netRsEl.textContent = `${nr >= 0 ? '+' : ''}₹${nr.toLocaleString()}`;
        netRsEl.className = `stat-val ${nr > 0 ? 'pnl-positive' : nr < 0 ? 'pnl-negative' : 'pnl-neutral'}`;

        const brokerageEl = document.getElementById('brokerageVal');
        brokerageEl.textContent = `₹${(s.totalBrokerage ?? 0).toLocaleString()}`;
        brokerageEl.className = 'stat-val pnl-negative';

        const netPctEl = document.getElementById('netProfitVal');
        const np = s.netProfit ?? 0;
        netPctEl.textContent = `${np >= 0 ? '+' : ''}${np}%`;
        netPctEl.className = `stat-val ${np > 0 ? 'pnl-positive' : np < 0 ? 'pnl-negative' : 'pnl-neutral'}`;

        // ── Render Full Trade Log ──────────────────────────────────
        const tradeLog = data.tradeLog || [];
        const tradeLogBody = document.getElementById('tradeLogBody');
        tradeLogBody.innerHTML = '';

        if (tradeLog.length === 0) {
            tradeLogBody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:1rem">No completed trades yet</td></tr>';
        } else {
            // Show newest trades first
            [...tradeLog].reverse().forEach(t => {
                const tr = document.createElement('tr');
                const isWin = t.result.startsWith('WIN');
                const isOpen = t.open;
                tr.className = isOpen ? 'open-row' : (isWin ? 'win-row' : 'loss-row');

                const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '(open)';
                const fmtP = v => v >= 0 ? `+${v}` : `${v}`;
                const pnlCls = v => v > 0 ? 'pnl-positive' : v < 0 ? 'pnl-negative' : 'pnl-neutral';
                const badge = isOpen ? '<span class="result-badge open">OPEN</span>'
                    : isWin ? '<span class="result-badge win">WIN</span>'
                        : '<span class="result-badge loss">LOSS</span>';

                const typeBadge = t.tradeType === 'SHORT' ? '<span class="result-badge loss">SHORT</span>' : '<span class="result-badge win">LONG</span>';

                tr.innerHTML = `
                    <td>${typeBadge}</td>
                    <td>${fmtTime(t.entryTime)}</td>
                    <td>${cSign}${t.entryPrice.toLocaleString()}</td>
                    <td>${fmtTime(t.exitTime)}</td>
                    <td>${cSign}${t.exitPrice.toLocaleString()}</td>
                    <td class="${pnlCls(t.grossRs)}">${fmtP(t.grossRs)}</td>
                    <td style="color:var(--text-muted)">-${t.brokerageRs}</td>
                    <td class="${pnlCls(t.netRs)}"><strong>${fmtP(t.netRs)}</strong></td>
                    <td class="${pnlCls(t.profitPct)}">${fmtP(t.profitPct)}%</td>
                    <td>${badge}</td>`;
                tradeLogBody.appendChild(tr);
            });
        }

        // Wire toggle button (only once)
        if (!document.getElementById('toggleTradeLog')._wired) {
            document.getElementById('toggleTradeLog').addEventListener('click', function () {
                const container = document.getElementById('tradeLogContainer');
                const isHidden = container.classList.toggle('hidden');
                this.textContent = isHidden ? 'Show Log ▼' : 'Hide Log ▲';
            });
            document.getElementById('toggleTradeLog')._wired = true;
        }

        // Render Canvas Chart
        const tradingChart = document.getElementById('tradingChart');
        drawChart(tradingChart, data.candles, data.strategy);

        // Update Recent Signals Table
        signalsTableBody.innerHTML = '';
        const recentSignals = [...data.recentSignals].reverse();

        if (recentSignals.length === 0) {
            signalsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center;">No recent signals found</td></tr>';
            return;
        }

        recentSignals.forEach(sig => {
            const tr = document.createElement('tr');

            const timeTd = document.createElement('td');
            timeTd.textContent = new Date(sig.time).toLocaleString();

            const priceTd = document.createElement('td');
            priceTd.textContent = `${cSign}${sig.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

            const typeTd = document.createElement('td');
            typeTd.textContent = sig.type.replace('_', ' ');
            const isLongish = sig.type === 'ENTRY_LONG' || sig.type === 'EXIT_SHORT' || sig.type === 'BUY' || sig.type === 'PRE_ALERT_LONG';
            typeTd.className = isLongish ? 'buy-text' : 'sell-text';

            tr.appendChild(timeTd);
            tr.appendChild(priceTd);
            tr.appendChild(typeTd);
            signalsTableBody.appendChild(tr);
        });
    }


    function drawChart(canvas, candles, strategy) {
        const ctx = canvas.getContext('2d');
        const rect = canvas.parentElement.getBoundingClientRect();

        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = 350 * window.devicePixelRatio;
        canvas.style.width = '100%';
        canvas.style.height = '350px';
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        const width = rect.width;
        const height = 350;

        ctx.clearRect(0, 0, width, height);

        if (candles.length === 0) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '14px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', width / 2, height / 2);
            return;
        }

        const paddingRight = 75;
        const paddingBottom = 30;
        const paddingTop = 25;
        const paddingLeft = 15;

        const chartWidth = width - paddingLeft - paddingRight;
        const chartHeight = height - paddingTop - paddingBottom;

        // Find min and max prices to scale the y-axis
        let minPrice = Infinity;
        let maxPrice = -Infinity;

        candles.forEach(c => {
            minPrice = Math.min(minPrice, c.low);
            maxPrice = Math.max(maxPrice, c.high);
            if (c.fastVal !== null) {
                minPrice = Math.min(minPrice, c.fastVal);
                maxPrice = Math.max(maxPrice, c.fastVal);
            }
            if (c.slowVal !== null) {
                minPrice = Math.min(minPrice, c.slowVal);
                maxPrice = Math.max(maxPrice, c.slowVal);
            }
            if (c.ema50 !== null) {
                minPrice = Math.min(minPrice, c.ema50);
                maxPrice = Math.max(maxPrice, c.ema50);
            }
        });

        const priceRange = maxPrice - minPrice;
        minPrice -= priceRange * 0.05;
        maxPrice += priceRange * 0.05;

        function getX(index) {
            if (candles.length <= 1) return paddingLeft;
            return paddingLeft + (index / (candles.length - 1)) * chartWidth;
        }

        function getY(price) {
            if (priceRange === 0) return paddingTop + chartHeight / 2;
            return paddingTop + (1 - (price - minPrice) / (maxPrice - minPrice)) * chartHeight;
        }

        // Draw Grid Lines (Horizontal)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px Inter';
        ctx.textAlign = 'left';

        const gridLinesCount = 5;
        for (let i = 0; i <= gridLinesCount; i++) {
            const price = minPrice + (i / gridLinesCount) * (maxPrice - minPrice);
            const y = getY(price);

            ctx.beginPath();
            ctx.moveTo(paddingLeft, y);
            ctx.lineTo(width - paddingRight, y);
            ctx.stroke();

            ctx.fillText(price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), width - paddingRight + 6, y + 3);
        }

        // Draw Candles
        const candleSpacingWidth = chartWidth / candles.length;
        const candleWidth = Math.max(2, candleSpacingWidth * 0.65);

        candles.forEach((c, i) => {
            const x = getX(i);
            const yOpen = getY(c.open);
            const yClose = getY(c.close);
            const yHigh = getY(c.high);
            const yLow = getY(c.low);

            const isBullish = c.close >= c.open;
            const color = isBullish ? '#10b981' : '#ef4444';

            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 1.2;

            // Wick
            ctx.beginPath();
            ctx.moveTo(x, yHigh);
            ctx.lineTo(x, yLow);
            ctx.stroke();

            // Body
            const bodyHeight = Math.max(1.2, Math.abs(yClose - yOpen));
            const bodyY = Math.min(yOpen, yClose);
            ctx.fillRect(x - candleWidth / 2, bodyY, candleWidth, bodyHeight);
        });

        // Draw Indicator Lines
        // 1. EMA 50 Line (Trend Line)
        if (strategy === 'APLUS_INTRADAY') {
            ctx.strokeStyle = '#a855f7'; // Purple line for EMA 50
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let started = false;
            candles.forEach((c, i) => {
                if (c.ema50 !== null) {
                    const x = getX(i);
                    const y = getY(c.ema50);
                    if (!started) {
                        ctx.moveTo(x, y);
                        started = true;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
            });
            ctx.stroke();
        }

        // 2. Slow Line (e.g. 21 EMA or Slow HMA)
        if (strategy !== 'HMA_SLOPE') {
            ctx.strokeStyle = '#f59e0b'; // Amber
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            let started = false;
            candles.forEach((c, i) => {
                if (c.slowVal !== null) {
                    const x = getX(i);
                    const y = getY(c.slowVal);
                    if (!started) {
                        ctx.moveTo(x, y);
                        started = true;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
            });
            ctx.stroke();
        }

        // 3. Fast Line (e.g. 9 EMA or Fast HMA)
        ctx.strokeStyle = '#3b82f6'; // Blue
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        let started = false;
        candles.forEach((c, i) => {
            if (c.fastVal !== null) {
                const x = getX(i);
                const y = getY(c.fastVal);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
        });
        ctx.stroke();

        // Draw Signals on the chart
        candles.forEach((c, i) => {
            if (c.signal === 'ENTRY_LONG' || c.signal === 'EXIT_SHORT' || c.signal === 'BUY' || c.signal === 'PRE_ALERT_LONG') {
                const x = getX(i);
                const y = getY(c.low) + 14;

                ctx.fillStyle = c.signal === 'EXIT_SHORT' ? '#94a3b8' : (c.signal === 'PRE_ALERT_LONG' ? '#f59e0b' : '#10b981');
                ctx.beginPath();
                ctx.moveTo(x, y - 6);
                ctx.lineTo(x - 5, y + 2);
                ctx.lineTo(x + 5, y + 2);
                ctx.fill();

                ctx.font = '10px Inter';
                ctx.textAlign = 'center';
                ctx.fillText(c.signal.replace('_', ' '), x, y + 14);
            } else if (c.signal === 'ENTRY_SHORT' || c.signal === 'EXIT_LONG' || c.signal === 'SELL' || c.signal === 'PRE_ALERT_SHORT') {
                const x = getX(i);
                const y = getY(c.high) - 14;

                ctx.fillStyle = c.signal === 'EXIT_LONG' ? '#94a3b8' : (c.signal === 'PRE_ALERT_SHORT' ? '#f59e0b' : '#ef4444');
                ctx.beginPath();
                ctx.moveTo(x, y + 6);
                ctx.lineTo(x - 5, y - 2);
                ctx.lineTo(x + 5, y - 2);
                ctx.fill();

                ctx.font = '10px Inter';
                ctx.textAlign = 'center';
                ctx.fillText(c.signal.replace('_', ' '), x, y - 10);
            }
        });

        // Draw dates/times along horizontal axis
        ctx.fillStyle = '#94a3b8';
        ctx.font = '8px Inter';
        ctx.textAlign = 'center';

        const labelStep = Math.max(5, Math.floor(candles.length / 5));
        candles.forEach((c, i) => {
            if (i % labelStep === 0 || i === candles.length - 1) {
                const x = getX(i);
                const dateObj = new Date(c.time);
                const labelStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                ctx.fillText(labelStr, x, height - 10);
            }
        });
    }

    // Connect to background Intraday Scanner SSE
    function connectIntradayScanner() {
        if (intradayEventSource) {
            intradayEventSource.close();
        }

        intradayEventSource = new EventSource('/api/intraday-stream');

        intradayEventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.states) {
                updateScannerGrid(data.states);
            }

            if (data.marketHealth) {
                updateMarketHealthBanner(data.marketHealth);
            }

            if (data.alerts) {
                // Bulk load active alerts list on first connection
                localAlertsList = data.alerts;
                renderAlertsDropdown();
            }

            if (data.alert) {
                const alertObj = data.alert;
                // Add alert to memory list
                if (!localAlertsList.some(a => a.id === alertObj.id)) {
                    localAlertsList.unshift(alertObj);
                    if (localAlertsList.length > 50) localAlertsList.pop();

                    renderAlertsDropdown();

                    // Visual/Audio alerts
                    triggerBellNotification(alertObj);
                }
            }
        };

        intradayEventSource.onerror = (error) => {
            console.error('[SSE-Intraday] Stream connection error:', error);
            scannerStatusDot.className = 'status-dot pulsing-red';
            scannerStatusText.textContent = 'Scanner Offline';
        };
    }

    // Set configuration for background scanner
    async function updateIntradayConfig() {
        const assetClass = multiAssetSelect.value;
        const interval = multiIntervalSelect.value;

        scannerStatusDot.className = 'status-dot pulsing-blue';
        scannerStatusText.textContent = 'Changing Config...';

        try {
            const res = await fetch('/api/intraday-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assetClass, interval })
            });
            const data = await res.json();
            if (data.success) {
                updateScannerGrid(data.state.scanStates);
            }
        } catch (e) {
            console.error('Failed to change intraday config:', e);
        }
    }

    multiAssetSelect.addEventListener('change', updateIntradayConfig);
    multiIntervalSelect.addEventListener('change', updateIntradayConfig);

    // Triggered when a new alert arrives in real time
    function triggerBellNotification(alertObj) {
        // Shake the bell icon
        notificationBellBtn.classList.remove('shake-animation');
        void notificationBellBtn.offsetWidth; // Trigger reflow to restart animation
        notificationBellBtn.classList.add('shake-animation');

        // Play alert audio chime
        playChime();

        // Voice Alert Readout
        const typeLabel = alertObj.type.replace('_', ' ').toLowerCase();
        speakAlert(`Alert! ${typeLabel} call for ${alertObj.name} at price ${alertObj.price.toFixed(2)}.`);

        // Update badge count
        if (notificationDropdown.classList.contains('hidden')) {
            const currentBadgeVal = parseInt(bellBadge.textContent) || 0;
            const newVal = currentBadgeVal + 1;
            bellBadge.textContent = newVal;
            bellBadge.classList.remove('hidden');
        }
    }

    function renderAlertsDropdown() {
        alertsList.innerHTML = '';

        if (localAlertsList.length === 0) {
            alertsList.innerHTML = '<p class="no-alerts-msg">No alerts triggered yet. Active scanner is running.</p>';
            return;
        }

        localAlertsList.forEach(alert => {
            const item = document.createElement('div');
            item.className = 'alert-item-card';

            const assetSign = alert.symbol.includes('USD') || alert.symbol.includes('BTC') ? '$' : '₹ ';
            const isGapFade = alert.type === 'GAP_FADE_SHORT';

            item.innerHTML = `
                <div class="alert-item-header">
                    <span class="alert-asset-name">${alert.name}</span>
                    <span class="alert-badge ${isGapFade ? 'entry_short' : alert.type.toLowerCase()}">${isGapFade ? 'GAP FADE SHORT' : alert.type.replace(/_/g, ' ')}</span>
                </div>
                <div class="alert-item-details">
                    <div>Trigger Price: <span class="alert-detail-val">${assetSign}${alert.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    ${isGapFade ? `
                    <div>Gap %: <span class="alert-detail-val">+${alert.gapPercent}%</span></div>
                    <div>Stop Loss: <span class="alert-detail-val">${assetSign}${alert.slApprox}</span></div>
                    <div>Target 1: <span class="alert-detail-val">${assetSign}${alert.target1}</span></div>
                    <div>Target 2: <span class="alert-detail-val">${assetSign}${alert.target2}</span></div>
                    <div>Confidence: <span class="alert-detail-val">${alert.confidence}</span></div>
                    <div>Market: <span class="alert-detail-val">${alert.marketHealth || '--'}</span></div>
                    ` : `
                    <div>Est. Win Rate: <span class="alert-detail-val">${alert.winRate || '--'}%</span></div>
                    <div>Profit Chance: <span class="alert-detail-val">${alert.prob || '--'}</span></div>
                    <div>Timeframe: <span class="alert-detail-val">${multiIntervalSelect.value} Min</span></div>
                    `}
                </div>
                <div class="alert-item-actions">
                    <span class="alert-time-lbl">${new Date(alert.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <button class="btn-view-alert" data-symbol="${alert.symbol}">View Chart</button>
                </div>
            `;

            // Setup view chart action
            item.querySelector('.btn-view-alert').addEventListener('click', (e) => {
                e.stopPropagation();
                notificationDropdown.classList.add('hidden');
                loadAssetInChart(alert.symbol, multiIntervalSelect.value);
            });

            alertsList.appendChild(item);
        });
    }

    function updateMarketHealthBanner(health) {
        const banner = document.getElementById('marketHealthBanner');
        const mhLabel = document.getElementById('mhLabel');
        const mhDetails = document.getElementById('mhDetails');
        if (!banner || !health) return;
        banner.classList.remove('hidden');
        mhLabel.textContent = health.label || 'Unknown';
        mhLabel.className = `mh-label mh-${(health.status || 'unknown').toLowerCase()}`;
        const details = [];
        if (health.gapPercent !== null && health.gapPercent !== undefined) details.push(`Gap: ${health.gapPercent >= 0 ? '+' : ''}${health.gapPercent}%`);
        if (health.rsi !== null && health.rsi !== undefined) details.push(`RSI: ${health.rsi}`);
        if (health.currentPrice) details.push(`₹${health.currentPrice.toLocaleString()}`);
        mhDetails.textContent = details.join(' · ');
    }

    function updateScannerGrid(states) {
        scannerGrid.innerHTML = '';
        let isAnyActive = false;
        let isAnyLoading = false;

        for (const sym in states) {
            const stock = states[sym];

            if (stock.status.includes('Scanning')) isAnyActive = true;
            if (stock.status.includes('Loading')) isAnyLoading = true;

            const card = document.createElement('div');
            card.className = 'stock-card';
            card.setAttribute('data-symbol', stock.symbol);

            const isCrypto = stock.symbol.includes('USD') || stock.symbol.includes('BTC');
            const cSign = isCrypto ? '$' : '₹ ';

            const livePriceStr = stock.price !== null ? `${cSign}${stock.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--';
            const trendText = stock.trend === 'GREEN' ? 'BULLISH' : stock.trend === 'RED' ? 'BEARISH' : '--';
            const trendClass = stock.trend === 'GREEN' ? 'green' : stock.trend === 'RED' ? 'red' : 'hidden';

            const dotClass = stock.status.includes('Scanning') ? 'pulsing-green' : stock.status.includes('Loading') ? 'pulsing-blue' : 'pulsing-red';

            // Active Alert String — updated for GAP_FADE
            let alertHtml = '<span class="stock-card-alert-text">No Signals Yet</span>';
            if (stock.lastSignal) {
                const isGapFade = stock.lastSignal.type === 'GAP_FADE_SHORT';
                const alertTypeClass = isGapFade ? 'sell-text' : (stock.lastSignal.type === 'ENTRY_LONG' || stock.lastSignal.type === 'EXIT_SHORT' || stock.lastSignal.type === 'BUY') ? 'buy-text' : 'sell-text';
                const displayType = isGapFade ? `GAP FADE SHORT (${stock.lastSignal.confidence || ''})` : stock.lastSignal.type.replace(/_/g, ' ');
                const timeStr = new Date(stock.lastSignal.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const extraInfo = isGapFade ? ` | SL:${cSign}${stock.lastSignal.slApprox} T1:${cSign}${stock.lastSignal.target1}` : '';
                alertHtml = `
                    <span class="stock-card-alert-text ${alertTypeClass}">${displayType} @ ${cSign}${stock.lastSignal.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    <span class="stock-card-alert-time">${timeStr}${extraInfo}</span>
                `;
            }

            // Gap status badge colour
            const gapStatusClass = stock.gapStatus === 'SHORT_SETUP' ? 'pnl-negative' : stock.gapStatus === 'WATCH' ? 'pnl-neutral' : '';
            const marketAlignClass = stock.marketAlignment === 'WITH_MARKET' ? 'pnl-positive' : stock.marketAlignment === 'AGAINST_MARKET' ? 'pnl-negative' : '';

            card.innerHTML = `
                <div class="stock-card-header">
                    <div class="stock-info">
                        <h4>${stock.name}</h4>
                        <span>${stock.symbol}</span>
                    </div>
                    <div class="stock-status-cell">
                        <span class="status-dot ${dotClass}"></span>
                        <span>${stock.status.split(' ')[0]}</span>
                    </div>
                </div>
                <div class="stock-card-price-row">
                    <span class="stock-card-price">${livePriceStr}</span>
                    <span class="stock-card-trend-badge ${trendClass}">${trendText}</span>
                </div>
                <div class="stock-card-indicators">
                    <div class="ind-item">
                        <span class="ind-label">RSI 14</span>
                        <span class="ind-val">${stock.rsi !== null && stock.rsi !== undefined ? stock.rsi : '--'}</span>
                    </div>
                    <div class="ind-item">
                        <span class="ind-label">Gap %</span>
                        <span class="ind-val ${gapStatusClass}">${stock.gapPercent !== null && stock.gapPercent !== undefined ? (stock.gapPercent >= 0 ? '+' : '') + stock.gapPercent.toFixed(2) + '%' : '--'}</span>
                    </div>
                    <div class="ind-item">
                        <span class="ind-label">VWAP</span>
                        <span class="ind-val">${stock.vwap ? cSign + stock.vwap.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '--'}</span>
                    </div>
                    <div class="ind-item">
                        <span class="ind-label">Mkt Align</span>
                        <span class="ind-val ${marketAlignClass}">${stock.marketAlignment || '--'}</span>
                    </div>
                </div>
                <div class="stock-card-alert-row">
                    <span class="stock-card-alert-label">Last Signal</span>
                    <div class="stock-card-alert-content">
                        ${alertHtml}
                    </div>
                </div>
            `;

            // Clicking card loads chart
            card.addEventListener('click', () => {
                loadAssetInChart(stock.symbol, multiIntervalSelect.value);
            });

            scannerGrid.appendChild(card);
        }

        // Update overall status dot
        if (isAnyActive) {
            scannerStatusDot.className = 'status-dot pulsing-green';
            scannerStatusText.textContent = 'Active Scanning';
        } else if (isAnyLoading) {
            scannerStatusDot.className = 'status-dot pulsing-blue';
            scannerStatusText.textContent = 'Loading Data Taps...';
        } else {
            scannerStatusDot.className = 'status-dot pulsing-red';
            scannerStatusText.textContent = 'Scanner Idle';
        }
    }

    // ─────────────────────────────────────────────
    // NIFTY DEEP ANALYSIS PANEL
    // Polls /api/nifty-analysis every 5s and
    // updates the panel in the multi-stock view
    // ─────────────────────────────────────────────

    let niftyAnalysisInterval = null;

    async function fetchNiftyAnalysis() {
        try {
            const res = await fetch('/api/nifty-analysis');
            const data = await res.json();
            if (!data.success || !data.analysis) return;
            renderNiftyAnalysisPanel(data.analysis);
        } catch (e) {
            console.error('[NiftyPanel] fetch error:', e);
        }
    }

    function renderNiftyAnalysisPanel(analysis) {
        const panel = document.getElementById('niftyAnalysisPanel');
        if (!panel) return;
        panel.classList.remove('hidden');

        const { health, oiTrend, latestOI, supportResistance: sr, bos } = analysis;

        // Status badge
        const statusEl = document.getElementById('niftyPanelStatus');
        statusEl.textContent = health.label || 'Loading...';
        statusEl.className = `nifty-status-badge mh-${(health.status || 'unknown').toLowerCase()}`;

        // OI trend
        const oiTrendEl = document.getElementById('niftyOITrend');
        oiTrendEl.textContent = oiTrend.label || '—';
        oiTrendEl.style.color = oiTrend.bullish === true ? 'var(--neon-green)'
            : oiTrend.bullish === false ? 'var(--neon-red)' : '#fbbf24';

        const oiValEl = document.getElementById('niftyOIValue');
        if (latestOI && latestOI.oi) {
            const oiFormatted = (latestOI.oi / 1e6).toFixed(2) + 'M';
            oiValEl.textContent = `OI: ${oiFormatted}`;
        } else {
            oiValEl.textContent = 'OI: waiting for futures data...';
        }

        // Support / Resistance
        const resEl = document.getElementById('niftyResistance');
        const supEl = document.getElementById('niftySupport');
        if (sr && sr.resistance) {
            resEl.textContent = `R: ₹${sr.resistance.toLocaleString()}`;
            supEl.textContent = `S: ₹${sr.support.toLocaleString()}`;
        } else {
            resEl.textContent = 'R: —';
            supEl.textContent = 'S: —';
        }

        // BOS
        const bosEl = document.getElementById('niftyBOS');
        const bosSubEl = document.getElementById('niftyBOSSub');
        if (bos) {
            bosEl.textContent = bos.label || '—';
            bosEl.style.color = bos.bos === 'BULLISH' ? 'var(--neon-green)'
                : bos.bos === 'BEARISH' ? 'var(--neon-red)' : '#94a3b8';
            if (bos.swingHigh && bos.swingLow) {
                bosSubEl.textContent = `Swing: ₹${bos.swingLow?.toFixed(0)} – ₹${bos.swingHigh?.toFixed(0)}`;
            } else if (bos.level) {
                bosSubEl.textContent = `Break level: ₹${bos.level?.toFixed(0)}`;
            } else {
                bosSubEl.textContent = '';
            }
        }

        // Price vs VWAP
        const priceEl = document.getElementById('niftyPrice');
        const vwapEl = document.getElementById('niftyVWAP');
        if (health.currentPrice) {
            priceEl.textContent = `₹${health.currentPrice.toLocaleString()}`;
            priceEl.style.color = health.belowVWAP ? 'var(--neon-red)' : 'var(--neon-green)';
        }
        if (health.vwap) {
            vwapEl.textContent = `VWAP: ₹${health.vwap.toLocaleString()}`;
        }

        // Gap + RSI
        const gapEl = document.getElementById('niftyGap');
        const rsiEl = document.getElementById('niftyRSI');
        if (health.gapPercent !== null && health.gapPercent !== undefined) {
            const sign = health.gapPercent >= 0 ? '+' : '';
            gapEl.textContent = `${sign}${health.gapPercent}%`;
            gapEl.style.color = health.gapPercent > 0 ? 'var(--neon-red)' : 'var(--neon-green)';
        }
        if (health.rsi !== null && health.rsi !== undefined) {
            rsiEl.textContent = `RSI: ${health.rsi}`;
        }

        // Short environment
        const shortEl = document.getElementById('niftyShortEnv');
        const shortSubEl = document.getElementById('niftyShortSub');
        if (health.shortFriendly) {
            shortEl.textContent = '✅ Favourable for Shorts';
            shortEl.style.color = 'var(--neon-green)';
            shortSubEl.textContent = 'Market is weak/bearish';
        } else if (health.status === 'STRONG') {
            shortEl.textContent = '🚫 Unfavourable — Market Strong';
            shortEl.style.color = 'var(--neon-red)';
            shortSubEl.textContent = 'Avoid new shorts';
        } else {
            shortEl.textContent = '⚠️ Neutral — Use Caution';
            shortEl.style.color = '#fbbf24';
            shortSubEl.textContent = 'Wait for confirmation';
        }
    }

    function startNiftyAnalysisPolling() {
        fetchNiftyAnalysis(); // immediate fetch
        if (niftyAnalysisInterval) clearInterval(niftyAnalysisInterval);
        niftyAnalysisInterval = setInterval(fetchNiftyAnalysis, 5000);
    }

    // Startup initializations
    connectIntradayScanner();
    startNiftyAnalysisPolling();
});