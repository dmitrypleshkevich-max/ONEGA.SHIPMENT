// --- КОНФИГУРАЦИЯ ---

const CONFIG = {
    API_URL: 'https://api.onega.by:8443/buh_test/hs/exchanges',
    packingScheme: {
        "totalLength": { "min": 47, "max": 65 },
        "fields": [
            { "name": "ContainerID", "start": 2, "length": 5 },
            { "name": "GoodId", "start": 10, "length": 13 },
            { "name": "Date", "start": 25, "length": 6 },
            { "name": "batchID", "start": 33, "length": 4 },
            { "name": "Qty", "start": 39, "length": 4 },
            { "name": "BoxQty", "start": 45, "length": 2 }
        ]
    }
};

let activeScheme = { ...CONFIG.packingScheme };
let state = { 
    plan: [], 
    scans: [], 
    currentPallet: null, 
    orderNumber: null,
    totalExpectedQty: 0
};
let bearerToken = null;
let isWaitingForSSCC = false;

// --- УТИЛИТЫ ---
function showError(id, msg) { 
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg;
        el.style.color = '#dc3545';
        el.style.background = '#fff0f0';
        el.style.borderColor = '#ffcdd2';
        el.className = 'error';
    }
}

function showSuccess(id, msg) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg;
        el.style.color = '#155724';
        el.style.background = '#d4edda';
        el.style.borderColor = '#c3e6cb';
        el.className = 'error success';
    }
}

function clearErrors() { 
    document.querySelectorAll('.error').forEach(e => {
        e.textContent = '';
        e.className = 'error';
        e.style.color = '#dc3545';
        e.style.background = '#fff0f0';
        e.style.borderColor = '#ffcdd2';
    });
}

// --- ВОСПРОИЗВЕДЕНИЕ ЗВУКА ---
function playBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
        console.log("Звук не поддерживается");
    }
}

// --- ОБНОВЛЕНИЕ СТАТИСТИКИ ---
function updateStatsUI() {
    console.log("🔄 Обновление статистики...");
    console.log("state.totalExpectedQty:", state.totalExpectedQty);
    console.log("state.scans.length:", state.scans.length);
    console.log("state.scans:", state.scans);
    
    // 1. Общее количество штук (собрано / всего в заказе)
    const totalScannedQty = state.scans.reduce((s, item) => s + parseInt(item.Qty || 0), 0);
    document.getElementById('stat-qty-current').textContent = totalScannedQty;
    document.getElementById('stat-qty-total').textContent = state.totalExpectedQty || 0;
    
    // 2. Статистика по товарам
    const planMap = {};
    state.plan.forEach(planItem => {
        planItem.item_codes.forEach(code => {
            const cleanCode = String(code).replace(/^0+/, '');
            planMap[cleanCode] = {
                name: planItem.item_name,
                totalQty: parseInt(planItem.quantity) || 0,
                planItem: planItem
            };
        });
    });
    
    console.log("📋 planMap:", planMap);
    
    const goodsStats = {};
    state.scans.forEach(scan => {
        const key = scan.cleanGoodId || String(scan.GoodId).replace(/^0+/, '');
        console.log("🔍 Обработка скана:", scan.GoodId, "→ cleanGoodId:", key, "Qty:", scan.Qty);
        
        if (!goodsStats[key]) {
            goodsStats[key] = {
                goodId: scan.GoodId,
                name: scan.item_name || 'Неизвестно',
                pallets: 0,
                qty: 0,
                totalQty: 0
            };
        }
        goodsStats[key].pallets += 1;
        const qtyNum = parseInt(scan.Qty || 0);
        goodsStats[key].qty += qtyNum;
        console.log("  → добавлено паллет:", goodsStats[key].pallets, "шт:", goodsStats[key].qty);
    });
    
    console.log("📊 goodsStats:", goodsStats);
    
    // Заполняем totalQty из плана
    Object.keys(goodsStats).forEach(key => {
        if (planMap[key]) {
            goodsStats[key].totalQty = planMap[key].totalQty;
            goodsStats[key].name = planMap[key].name;
        }
    });
    
    // Отображаем статистику по товарам
    const goodsListEl = document.getElementById('stat-goods-list');
    goodsListEl.innerHTML = '';
    
    state.plan.forEach(planItem => {
        let stat = null;
        let matchedCode = null;
        for (const code of planItem.item_codes) {
            const cleanCode = String(code).replace(/^0+/, '');
            if (goodsStats[cleanCode]) {
                stat = goodsStats[cleanCode];
                matchedCode = cleanCode;
                break;
            }
        }
        
        console.log(`📦 Товар: ${planItem.item_name}, codes: ${planItem.item_codes.join(', ')}, stat:`, stat);
        
        const div = document.createElement('div');
        div.className = 'stat-goods-item';
        
        // ★★★ ОПРЕДЕЛЯЕМ ЦВЕТ ★★★
        let colorStyle = '';
        let progressText = '';
        
        if (stat && stat.qty > 0) {
            const progress = stat.totalQty > 0 ? Math.round((stat.qty / stat.totalQty) * 100) : 0;
            
            if (progress === 100) {
                // ✅ 100% - зеленый
                colorStyle = 'color: #28a745; font-weight: bold;';
                progressText = `${stat.pallets} пал, ${stat.qty} шт из ${stat.totalQty} шт (✅ 100%)`;
            } else {
                // ⚫ 1-99% - обычный
                colorStyle = 'color: #333;';
                progressText = `${stat.pallets} пал, ${stat.qty} шт из ${stat.totalQty} шт (${progress}%)`;
            }
        } else {
            // 🔘 0% - серый
            colorStyle = 'color: #999;';
            progressText = `0 пал, 0 шт из ${planItem.quantity} шт (0%)`;
        }
        
        div.innerHTML = `
            <span class="goods-name" style="${colorStyle}">${planItem.item_name}</span>
            <span class="goods-stats" style="${colorStyle}">
                ${progressText}
            </span>
        `;
        goodsListEl.appendChild(div);
    });
    
    // 3. Итоговые показатели
    document.getElementById('stat-pallets').textContent = state.scans.length;
    
    const ssccSet = new Set();
    state.scans.forEach(scan => {
        if (scan.sscc && scan.sscc.trim()) {
            ssccSet.add(scan.sscc.trim());
        }
    });
    document.getElementById('stat-sscc').textContent = ssccSet.size;
    
    // 4. Обновляем список сканов
    const listEl = document.getElementById('scan-list');
    listEl.innerHTML = '';
    
    const reversedScans = [...state.scans].reverse();
    reversedScans.forEach((scan, index) => {
        const div = document.createElement('div');
        div.className = 'scan-item';
        
        const realIndex = state.scans.length - index;
        const displayCode = scan.cleanRaw || scan.GoodId || scan.raw || 'Код';
        
        div.innerHTML = `
            <div class="scan-item-content">
                <span class="scan-number">#${realIndex}</span>
                <span class="scan-info">
                    <strong>${displayCode}</strong> — ${scan.item_name || 'Товар'}
                    (${scan.Qty} шт.)
                    ${scan.sscc ? `<br><span class="scan-sscc">SSCC: ${scan.sscc}</span>` : ''}
                </span>
                <button class="remove-btn" onclick="removeScan(${state.scans.length - 1 - index})">✕</button>
            </div>
        `;
        listEl.appendChild(div);
    });
    
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.disabled = state.scans.length === 0;
        sendBtn.style.opacity = state.scans.length === 0 ? '0.5' : '1';
    }
}

// --- УДАЛЕНИЕ СКАНА ---
function removeScan(index) {
    if (confirm(`Удалить паллету #${index + 1}?`)) {
        state.scans.splice(index, 1);
        updateStatsUI();
        playBeep();
    }
}

// --- ВСПОМОГАТЕЛЬНЫЕ ---
function cleanCode(code) {
    return code ? code.replace(/^0+/, '') : '';
}

function parseRaw(raw) {
    const cleanRaw = raw.replace(/[\s\u001d]/g, '');
    console.log("Парсинг строки длиной:", cleanRaw.length, "→", cleanRaw);
    
    if (cleanRaw.length < activeScheme.totalLength.min) {
        console.warn("Слишком короткая строка");
        return null;
    }

    let result = {};
    activeScheme.fields.forEach(f => {
        result[f.name] = cleanRaw.substring(f.start, f.start + f.length).trim();
    });

    if (result.GoodId) {
        result.CleanGoodId = cleanCode(result.GoodId);
    }
    console.log("Распарсено:", result);
    return result;
}

function findPlanItem(goodId) {
    const target = Number(goodId);
    return state.plan.find(row => 
        row.item_codes.some(code => Number(code) === target)
    );
}

function isPalletCodeUnique(code) {
    const cleanCode = code.replace(/\s/g, '');
    return !state.scans.some(scan => scan.cleanRaw === cleanCode);
}

// --- АВТОРИЗАЦИЯ ---
async function auth() {
    clearErrors();
    const username = document.getElementById('login').value.trim();
    const password = document.getElementById('password').value.trim();
    
    if (!username || !password) {
        return showError('auth-error', 'Введите логин и пароль');
    }

    try {
        const response = await fetch(`${CONFIG.API_URL}/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            bearerToken = result.token;
            console.log("✅ Успешная авторизация, токен получен");
            document.getElementById('screen-auth').style.display = 'none';
            document.getElementById('screen-task').style.display = 'block';
            document.getElementById('order-number').focus();
        } else {
            showError('auth-error', result.error || 'Ошибка авторизации');
        }
    } catch (e) {
        console.error("Ошибка сети:", e);
        showError('auth-error', 'Нет связи с сервером');
    }
}

// --- ЗАГРУЗКА СХЕМЫ ---
async function loadScheme() {
    try {
        const response = await fetch('packing.json');
        if (response.ok) {
            const ext = await response.json();
            if (ext.fields) {
                activeScheme.fields = activeScheme.fields.map(def => {
                    const ov = ext.fields.find(f => f.name === def.name);
                    return ov ? { ...def, ...ov } : def;
                });
            }
        }
    } catch (e) {
        console.warn("Используем встроенную схему packing");
    }
}

// --- СКАНИРОВАНИЕ ---
function addScan() {
    clearErrors();
    
    if (isWaitingForSSCC) {
        return showError('scan-error', 'Сначала завершите ввод SSCC для текущей паллеты');
    }
    
    let raw = document.getElementById('pallet-input').value.trim();
    if (!raw) return;

    // ========== ТЕСТОВАЯ ЗАМЕНА ==========
    const TEST_MODE = true;
    if (TEST_MODE) {
        raw = raw.replace(/ /g, '\u001d');
        console.log("🔧 Тестовый режим: пробелы заменены на \\u001d");
        console.log("📝 Новая строка:", raw);
    }
    // =====================================

    if (!isPalletCodeUnique(raw)) {
        showError('scan-error', 'Этот код паллеты уже отсканирован!');
        document.getElementById('pallet-input').value = '';
        document.getElementById('pallet-input').focus();
        return;
    }

    const parsed = parseRaw(raw);
    if (!parsed) {
        showError('scan-error', 'Неверный формат штрих-кода! Проверьте код паллеты.');
        document.getElementById('pallet-input').value = '';
        document.getElementById('pallet-input').focus();
        return;
    }

    const foundPlanItem = findPlanItem(parsed.GoodId);
    if (!foundPlanItem) {
        console.warn("Товар не найден в плане:", parsed.GoodId);
        showError('scan-error', `Товар ${parsed.GoodId} не найден в плане заказа!`);
        document.getElementById('pallet-input').value = '';
        document.getElementById('pallet-input').focus();
        return;
    }

    console.log("✅ Товар найден в плане:", foundPlanItem.item_name);
    
    const qty = parseInt(parsed.Qty);
    if (isNaN(qty) || qty <= 0) {
        showError('scan-error', 'Некорректное количество в штрих-коде');
        document.getElementById('pallet-input').value = '';
        document.getElementById('pallet-input').focus();
        return;
    }

    // ★★★ ПРОВЕРКА НА ПРЕВЫШЕНИЕ ПЛАНА ★★★
    // Считаем, сколько уже собрано по этому товару
    const cleanGoodId = String(parsed.GoodId).replace(/^0+/, '');
    let alreadyScannedQty = 0;
    state.scans.forEach(scan => {
        const scanCleanId = String(scan.GoodId).replace(/^0+/, '');
        if (scanCleanId === cleanGoodId) {
            alreadyScannedQty += parseInt(scan.Qty || 0);
        }
    });
    
    const planQty = parseInt(foundPlanItem.quantity) || 0;
    const totalAfterAdd = alreadyScannedQty + qty;
    
    if (totalAfterAdd > planQty) {
        const remaining = planQty - alreadyScannedQty;
        showError('scan-error', `❌ Нельзя добавить! По товару "${foundPlanItem.item_name}" осталось собрать только ${remaining} шт. (уже собрано ${alreadyScannedQty} из ${planQty})`);
        document.getElementById('pallet-input').value = '';
        document.getElementById('pallet-input').focus();
        return;
    }
    
    console.log(`📊 Проверка по товару: уже собрано ${alreadyScannedQty} из ${planQty}, добавляем ${qty}, итого ${totalAfterAdd}`);

    state.currentPallet = { 
        ...parsed, 
        raw: raw,
        cleanRaw: raw.replace(/\s/g, '')
    };

    document.getElementById('item-name').innerHTML = `
        ✅ Товар: <strong>${foundPlanItem.item_name}</strong>
        <span class="item-code">(${parsed.GoodId})</span>
        <span style="font-size: 14px; color: #666; margin-left: 10px;">
            (${alreadyScannedQty + qty}/${planQty} шт.)
        </span>
    `;

    if (foundPlanItem.sscc === true) {
        isWaitingForSSCC = true;
        const ssccInput = document.getElementById('sscc-input');
        ssccInput.style.display = 'block';
        ssccInput.value = '';
        ssccInput.focus();
        document.getElementById('pallet-input').disabled = true;
        document.getElementById('pallet-input').style.opacity = '0.5';
        showError('scan-error', 'Введите SSCC код для этой паллеты');
    } else {
        saveScan('');
    }
}

// --- СОХРАНЕНИЕ СКАНА ---
function saveScan(sscc = '') {
    if (!state.currentPallet) {
        console.error("Нет currentPallet для сохранения");
        return;
    }

    if (sscc && sscc.trim()) {
        const cleanSSCC = sscc.replace(/\s/g, '');
        if (!/^\d{20}$/.test(cleanSSCC)) {
            showError('scan-error', 'SSCC должен содержать 20 цифр!');
            document.getElementById('sscc-input').value = '';
            document.getElementById('sscc-input').focus();
            return;
        }
        sscc = cleanSSCC;
    } else {
        sscc = '';
    }

    const planItem = findPlanItem(state.currentPallet.GoodId);
    
    const cleanGoodId = String(state.currentPallet.GoodId).replace(/^0+/, '');
    console.log("🔍 saveScan - cleanGoodId:", cleanGoodId);
    
    const scanData = {
        ...state.currentPallet,
        cleanGoodId: cleanGoodId,
        sscc: sscc,
        item_name: planItem ? planItem.item_name : 'Неизвестно'
    };
    
    console.log("📦 scanData:", scanData);
    console.log("📦 scanData.cleanGoodId:", scanData.cleanGoodId);
    
    state.scans.unshift(scanData);

    console.log("✅ Паллета добавлена:", state.scans[0]);
    console.log("📊 Все сканы:", state.scans.map(s => ({ 
        GoodId: s.GoodId, 
        cleanGoodId: s.cleanGoodId,
        Qty: s.Qty
    })));
    
    playBeep();
    updateStatsUI();

    document.getElementById('pallet-input').value = '';
    document.getElementById('pallet-input').disabled = false;
    document.getElementById('pallet-input').style.opacity = '1';
    document.getElementById('sscc-input').value = '';
    document.getElementById('sscc-input').style.display = 'none';
    document.getElementById('pallet-input').focus();
    document.getElementById('item-name').innerHTML = 'Сканируйте следующую паллету';
    state.currentPallet = null;
    isWaitingForSSCC = false;
    clearErrors();
    
    showSuccess('scan-error', `✅ Паллета добавлена! ${planItem ? planItem.item_name : ''}`);
    setTimeout(() => clearErrors(), 2000);
}

// Enter на полях
document.addEventListener('DOMContentLoaded', function() {
    const palletInput = document.getElementById('pallet-input');
    if (palletInput) {
        palletInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                addScan();
            }
        });
    }

    const ssccInput = document.getElementById('sscc-input');
    if (ssccInput) {
        ssccInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const sscc = e.target.value.trim();
                if (sscc) {
                    saveScan(sscc);
                } else {
                    showError('scan-error', 'Введите SSCC код');
                }
            }
        });
    }
});

// --- API ---
async function getTask() {
    clearErrors();
    const orderNumber = document.getElementById('order-number').value.trim();

    if (!orderNumber) return showError('task-error', 'Введите номер заказа');
    if (!bearerToken) return showError('task-error', 'Токен отсутствует');

    try {
        const response = await fetch(`${CONFIG.API_URL}/shipmentplan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${bearerToken}`
            },
            body: JSON.stringify({ order_number: orderNumber })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            state.plan = result.data;
            state.orderNumber = result.order_number;
            
            state.totalExpectedQty = state.plan.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);

            console.log("📋 План загружен:", state.plan);
            console.log("📊 Общее количество в заказе:", state.totalExpectedQty);

            document.getElementById('screen-task').style.display = 'none';
            document.getElementById('screen-scan').style.display = 'block';

            document.getElementById('item-name').innerHTML = `
                Заказ №${result.order_number} на отбор 
                <strong>${result.total_lines}</strong> наименований
            `;
            
            updateStatsUI();
            document.getElementById('pallet-input').focus();
        } else {
            showError('task-error', result.error || 'Ошибка получения плана');
        }
    } catch (e) {
        console.error("Ошибка сети:", e);
        showError('task-error', 'Нет связи с сервером');
    }
}

async function confirmShipment() {
    clearErrors();
    if (!bearerToken) return showError('scan-error', 'Токен отсутствует');
    if (!state.orderNumber) return showError('scan-error', 'Номер заказа неизвестен');
    if (state.scans.length === 0) return showError('scan-error', 'Нет данных для отправки');
    
    if (isWaitingForSSCC) {
        return showError('scan-error', 'Сначала завершите ввод SSCC для текущей паллеты');
    }

    // ★★★ ПРОВЕРКА: ВСЕ ЛИ СОБРАНО? ★★★
    const totalScannedQty = state.scans.reduce((s, item) => s + parseInt(item.Qty || 0), 0);
    const totalExpectedQty = state.totalExpectedQty || 0;
    
    if (totalScannedQty < totalExpectedQty) {
        // Неполная сборка - спрашиваем подтверждение
        const confirmed = confirm(
            `⚠️ Внимание!\n\n` +
            `Заказ собран не полностью:\n` +
            `Собрано: ${totalScannedQty} шт.\n` +
            `Ожидается: ${totalExpectedQty} шт.\n` +
            `Осталось: ${totalExpectedQty - totalScannedQty} шт.\n\n` +
            `Действительно отправить неполный отчет о сборке?`
        );
        
        if (!confirmed) {
            // Пользователь отказался - возвращаемся к сканированию
            document.getElementById('pallet-input').focus();
            showError('scan-error', 'ℹ️ Сборка продолжается. Отсканируйте остальные паллеты.');
            return;
        }
    } else if (totalScannedQty === totalExpectedQty) {
        // Все собрано - показываем сообщение
        showSuccess('scan-error', `✅ Заказ собран полностью! ${totalScannedQty} из ${totalExpectedQty} шт. Отправляем...`);
    } else {
        // Перебор (не должно произойти из-за проверки в addScan, но на всякий случай)
        const confirmed = confirm(
            `⚠️ Внимание!\n\n` +
            `Собрано больше, чем в заказе:\n` +
            `Собрано: ${totalScannedQty} шт.\n` +
            `Ожидается: ${totalExpectedQty} шт.\n` +
            `Превышение: ${totalScannedQty - totalExpectedQty} шт.\n\n` +
            `Действительно отправить?`
        );
        if (!confirmed) {
            document.getElementById('pallet-input').focus();
            return;
        }
    }

    const palletsMap = {};
    state.scans.forEach(scan => {
        const key = scan.sscc || ''; 
        if (!palletsMap[key]) palletsMap[key] = [];
        palletsMap[key].push(scan.raw);
    });

    const palletsPayload = Object.keys(palletsMap).map(sscc => ({
        sscc: sscc || '',
        scans: palletsMap[sscc]
    }));

    const payload = {
        order_number: state.orderNumber,
        pallets: palletsPayload
    };

    console.log("📤 Отправка данных:", JSON.stringify(payload, null, 2));

    try {
        const response = await fetch(`${CONFIG.API_URL}/shipmentconfirm`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${bearerToken}`
            },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        console.log("📥 Ответ сервера (raw):", responseText);
        
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            console.error("Не удалось распарсить JSON:", e);
            throw new Error(`Сервер вернул: ${responseText}`);
        }

        if (response.ok && result.success) {
            state.scans = [];
            state.totalExpectedQty = 0;
            updateStatsUI();
            showShipmentResult(result);
        } else {
            const errorMsg = result.error || result.message || 'Ошибка подтверждения';
            showError('scan-error', `❌ ${errorMsg}`);
            console.error("Ошибка сервера:", result);
        }
    } catch (e) {
        console.error("Ошибка сети:", e);
        showError('scan-error', `Нет связи с сервером: ${e.message}`);
    }
}

// ========== ПОКАЗ РЕЗУЛЬТАТА ==========
function showShipmentResult(result) {
    const elementsToHide = ['pallet-input', 'sscc-input', 'add-btn', 'stats', 'scan-list', 'send-btn'];
    elementsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    
    let statusColor = '#155724';
    let statusBg = '#d4edda';
    let statusIcon = '✅';
    let statusText = 'Новые позиции добавлены!';
    
    if (result.added_count > 0 && result.already_count === 0) {
        statusColor = '#155724';
        statusBg = '#d4edda';
        statusIcon = '✅';
        statusText = 'Новые позиции добавлены!';
    } else if (result.added_count === 0 && result.already_count > 0) {
        statusColor = '#856404';
        statusBg = '#fff3cd';
        statusIcon = 'ℹ️';
        statusText = 'Данные уже были переданы ранее';
    } else if (result.added_count > 0 && result.already_count > 0) {
        statusColor = '#856404';
        statusBg = '#fff3cd';
        statusIcon = '⚠️';
        statusText = 'Часть данных добавлена, часть уже была передана';
    } else {
        statusColor = '#155724';
        statusBg = '#d4edda';
        statusIcon = '✅';
        statusText = 'Операция выполнена';
    }
    
    let palletsHtml = '';
    if (result.pallets && result.pallets.length > 0) {
        result.pallets.forEach(pallet => {
            if (!pallet.sscc && !pallet.added_items && !pallet.already_recorded) return;
            
            const statusTextPallet = pallet.status === 'added' ? '✅ Добавлено' : 
                                     pallet.status === 'already_recorded' ? 'ℹ️ Уже было' : 
                                     pallet.status === 'partial' ? '⚠️ Частично' : '❓ Неизвестно';
            
            palletsHtml += `
                <div style="margin: 8px 0; padding: 10px; background: #f8f9fa; border-radius: 6px; border-left: 4px solid ${pallet.status === 'added' ? '#28a745' : '#ffc107'};">
                    <div style="font-weight: 500;">
                        SSCC: ${pallet.sscc || 'Не указан'} 
                        <span style="color: ${pallet.status === 'added' ? '#28a745' : '#ffc107'}; margin-left: 10px;">
                            ${statusTextPallet}
                        </span>
                    </div>
                    ${pallet.added_count > 0 ? `<div style="font-size: 13px; color: #28a745;">➕ Добавлено: ${pallet.added_count} позиций</div>` : ''}
                    ${pallet.already_count > 0 ? `<div style="font-size: 13px; color: #856404;">🔄 Уже было: ${pallet.already_count} позиций</div>` : ''}
                    
                    ${pallet.added_items && pallet.added_items.length > 0 ? `
                        <div style="margin-top: 5px; padding-left: 15px; font-size: 13px; color: #28a745;">
                            ${pallet.added_items.map(item => `✅ ${item.item_name} (${item.qty_added} шт.)`).join('<br>')}
                        </div>
                    ` : ''}
                    
                    ${pallet.already_recorded && pallet.already_recorded.length > 0 ? `
                        <div style="margin-top: 5px; padding-left: 15px; font-size: 13px; color: #856404;">
                            ${pallet.already_recorded.map(item => `ℹ️ ${item.item_name} (${item.qty_in_base || item.qty_request || '?'} шт.)`).join('<br>')}
                        </div>
                    ` : ''}
                </div>
            `;
        });
    }
    
    const resultBlock = document.createElement('div');
    resultBlock.id = 'shipment-result';
    resultBlock.style.cssText = `
        padding: 20px;
        background: ${statusBg};
        border-radius: 12px;
        border: 2px solid ${statusColor};
        margin: 15px 0;
    `;
    
    resultBlock.innerHTML = `
        <div style="text-align: center; margin-bottom: 15px;">
            <div style="font-size: 24px; color: ${statusColor}; font-weight: bold;">
                ${statusIcon} ${statusText}
            </div>
            <div style="font-size: 14px; color: #666; margin-top: 5px;">
                Заказ №${result.order_number || state.orderNumber}
            </div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin: 15px 0; padding: 15px; background: white; border-radius: 8px;">
            <div style="text-align: center;">
                <div style="font-size: 12px; color: #666;">Паллет</div>
                <div style="font-size: 20px; font-weight: bold; color: #007bff;">${result.processed_pallets || 0}</div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 12px; color: #666;">Добавлено</div>
                <div style="font-size: 20px; font-weight: bold; color: #28a745;">${result.added_count || 0}</div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 12px; color: #666;">Существ.</div>
                <div style="font-size: 20px; font-weight: bold; color: #ffc107;">${result.already_count || 0}</div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 12px; color: #666;">Всего</div>
                <div style="font-size: 20px; font-weight: bold; color: #6c757d;">${result.processed_lines || 0}</div>
            </div>
        </div>
        
        ${palletsHtml ? `<div style="margin-top: 10px; max-height: 200px; overflow-y: auto;">${palletsHtml}</div>` : ''}
        
        ${result.message ? `<div style="margin-top: 10px; font-size: 14px; color: #666; font-style: italic; text-align: center; padding: 8px; background: white; border-radius: 6px;">${result.message}</div>` : ''}
        
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button onclick="nextOrder()" style="flex: 1; padding: 14px; background: #28a745; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; font-weight: bold;">
                ✅ Следующий заказ
            </button>
            <button onclick="continueScanning()" style="flex: 1; padding: 14px; background: #6c757d; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; font-weight: bold;">
                📋 Сканировать еще
            </button>
        </div>
    `;
    
    const screenScan = document.getElementById('screen-scan');
    const itemName = document.getElementById('item-name');
    if (itemName) itemName.innerHTML = '📊 Результат отправки';
    
    const palletInput = document.getElementById('pallet-input');
    if (palletInput && palletInput.parentNode) {
        palletInput.parentNode.insertBefore(resultBlock, palletInput);
    } else {
        screenScan.appendChild(resultBlock);
    }
}

// ========== КНОПКИ НАВИГАЦИИ ==========
function nextOrder() {
    const resultBlock = document.getElementById('shipment-result');
    if (resultBlock) resultBlock.remove();
    
    const elementsToShow = ['pallet-input', 'add-btn', 'stats', 'scan-list', 'send-btn'];
    elementsToShow.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
    });
    const ssccInput = document.getElementById('sscc-input');
    if (ssccInput) ssccInput.style.display = 'none';
    
    document.getElementById('screen-scan').style.display = 'none';
    document.getElementById('screen-task').style.display = 'block';
    const orderInput = document.getElementById('order-number');
    if (orderInput) {
        orderInput.value = '';
        orderInput.focus();
    }
    
    state.orderNumber = null;
    state.plan = [];
    state.scans = [];
    state.totalExpectedQty = 0;
    state.currentPallet = null;
    isWaitingForSSCC = false;
    updateStatsUI();
}

function continueScanning() {
    const resultBlock = document.getElementById('shipment-result');
    if (resultBlock) resultBlock.remove();
    
    const elementsToShow = ['pallet-input', 'add-btn', 'stats', 'scan-list', 'send-btn'];
    elementsToShow.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
    });
    const ssccInput = document.getElementById('sscc-input');
    if (ssccInput) ssccInput.style.display = 'none';
    
    state.plan = [];
    state.scans = [];
    state.totalExpectedQty = 0;
    state.currentPallet = null;
    isWaitingForSSCC = false;
    
    const itemName = document.getElementById('item-name');
    if (itemName) itemName.innerHTML = 'Сканируйте новую паллету';
    
    const palletInput = document.getElementById('pallet-input');
    if (palletInput) {
        palletInput.value = '';
        palletInput.focus();
    }
    updateStatsUI();
}

// Инициализация
loadScheme();
