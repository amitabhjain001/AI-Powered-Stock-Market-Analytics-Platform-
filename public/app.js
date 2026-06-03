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
        if (strategy === 'APLUS_INTRADAY') {
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
        strategySelect.value = 'APLUS_INTRADAY';
        
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
        if (rsiConfirm.checked && strategy !== 'APLUS_INTRADAY') confirmations.push('RSI');
        if (macdConfirm.checked && strategy !== 'APLUS_INTRADAY') confirmations.push('MACD');

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
        if (latest.signal === 'ENTRY_LONG') {
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
            document.getElementById('toggleTradeLog').addEventListener('click', function() {
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
            const isLongish = sig.type === 'ENTRY_LONG' || sig.type === 'EXIT_SHORT' || sig.type === 'BUY';
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
            if (c.signal === 'ENTRY_LONG' || c.signal === 'EXIT_SHORT' || c.signal === 'BUY') {
                const x = getX(i);
                const y = getY(c.low) + 14;
                
                ctx.fillStyle = c.signal === 'EXIT_SHORT' ? '#94a3b8' : '#10b981';
                ctx.beginPath();
                ctx.moveTo(x, y - 6);
                ctx.lineTo(x - 5, y + 2);
                ctx.lineTo(x + 5, y + 2);
                ctx.fill();
                
                ctx.font = 'bold 8px Inter';
                ctx.textAlign = 'center';
                ctx.fillText(c.signal.replace('_', ' '), x, y + 10);
            } else if (c.signal === 'ENTRY_SHORT' || c.signal === 'EXIT_LONG' || c.signal === 'SELL') {
                const x = getX(i);
                const y = getY(c.high) - 14;
                
                ctx.fillStyle = c.signal === 'EXIT_LONG' ? '#94a3b8' : '#ef4444';
                ctx.beginPath();
                ctx.moveTo(x, y + 6);
                ctx.lineTo(x - 5, y - 2);
                ctx.lineTo(x + 5, y - 2);
                ctx.fill();
                
                ctx.font = 'bold 8px Inter';
                ctx.textAlign = 'center';
                ctx.fillText(c.signal.replace('_', ' '), x, y - 7);
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

            item.innerHTML = `
                <div class="alert-item-header">
                    <span class="alert-asset-name">${alert.name}</span>
                    <span class="alert-badge ${alert.type.toLowerCase()}">${alert.type.replace('_', ' ')}</span>
                </div>
                <div class="alert-item-details">
                    <div>Trigger Price: <span class="alert-detail-val">${assetSign}${alert.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    <div>Est. Win Rate: <span class="alert-detail-val">${alert.winRate}%</span></div>
                    <div>Profit Chance: <span class="alert-detail-val">${alert.prob}</span></div>
                    <div>Timeframe: <span class="alert-detail-val">${multiIntervalSelect.value} Min</span></div>
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

            // Active Alert String
            let alertHtml = '<span class="stock-card-alert-text">No Signals Yet</span>';
            if (stock.lastSignal) {
                const isLongish = stock.lastSignal.type === 'ENTRY_LONG' || stock.lastSignal.type === 'EXIT_SHORT' || stock.lastSignal.type === 'BUY';
                const alertTypeClass = isLongish ? 'buy-text' : 'sell-text';
                const displayType = stock.lastSignal.type.replace('_', ' ');
                const timeStr = new Date(stock.lastSignal.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                alertHtml = `
                    <span class="stock-card-alert-text ${alertTypeClass}">${displayType} @ ${cSign}${stock.lastSignal.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    <span class="stock-card-alert-time">${timeStr} (${stock.lastSignal.winRate}% WR)</span>
                `;
            }

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
                        <span class="ind-val">${stock.rsi !== null ? stock.rsi : '--'}</span>
                    </div>
                    <div class="ind-item">
                        <span class="ind-label">MACD Hist</span>
                        <span class="ind-val">${stock.macdHist !== null ? stock.macdHist : '--'}</span>
                    </div>
                </div>
                <div class="stock-card-alert-row">
                    <span class="stock-card-alert-label">Last Call</span>
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

    // Startup initializations
    connectIntradayScanner();
});
