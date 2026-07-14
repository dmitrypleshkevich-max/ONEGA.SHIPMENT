const CONFIG = {
    ///API_URL: 'https://api.onega.by:8443/buh_test/hs/exchanges',
    API_URL: 'https://192.168.0.3:443/buh_test/hs/exchanges',
    // Дефолтная схема
    packingScheme: {
        "totalLength": { "min": 59, "max": 59 },
        "fields": [
            { "name": "ContainerID", "start": 3, "length": 5 },
            { "name": "GoodId", "start": 15, "length": 13 },
            { "name": "Date", "start": 4, "length": 6 },
            { "name": "batchID", "start": 38, "length": 4 },
            { "name": "Qty", "start": 48, "length": 4 }
        ]
    }
};

let activeScheme = { ...CONFIG.packingScheme };

async function loadScheme() {
    try {
        const response = await fetch('packing.json');
        if (!response.ok) throw new Error("Файл не найден");
        const externalScheme = await response.json();
        
        // Мерджинг: перезаписываем поля, если они есть во внешнем файле
        if (externalScheme.fields) {
            activeScheme.fields = activeScheme.fields.map(defaultField => {
                const override = externalScheme.fields.find(f => f.name === defaultField.name);
                return override ? { ...defaultField, ...override } : defaultField;
            });
        }
        console.log("Актуальная схема:", activeScheme);
    } catch (err) {
        console.warn("Используем дефолтную схему:", err.message);
    }
}

let state = { token: '', plan: [], scans: [], currentPallet: null };

async function apiRequest(endpoint, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const res = await fetch(CONFIG.API_URL + endpoint, { 
        method: body ? 'POST' : 'GET', headers, body: JSON.stringify(body) 
    });
    return res.json();
}

// Динамический парсинг на основе activeScheme
function parseRaw(raw) {
    if (raw.length < activeScheme.totalLength.min) return null;
    
    let result = {};
    activeScheme.fields.forEach(f => {
        // start в схеме считаем 1-индексированным, как в вашем примере (3-1=2)
        result[f.name] = raw.substring(f.start - 1, f.start - 1 + f.length).trim();
    });
    return result;
}

async function auth() {
    const data = await apiRequest('/auth', { username: document.getElementById('login').value, password: document.getElementById('password').value });
    if (data.token) { state.token = data.token; document.getElementById('screen-auth').style.display = 'none'; document.getElementById('screen-task').style.display = 'block'; }
}

async function getTask() {
    const order = document.getElementById('order-number').value;
    const data = await apiRequest('/shipmentplan', { order_number: order });
    state.plan = data.plan; 
    document.getElementById('screen-task').style.display = 'none'; document.getElementById('screen-scan').style.display = 'block';
}

document.getElementById('pallet-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        const raw = this.value;
        const parsed = parseRaw(raw);
        if (!parsed) return alert("Ошибка длины штрих-кода!");
        
        // Обратите внимание: goodId теперь берется из поля "GoodId" динамической схемы
        const item = state.plan.find(i => i.good_id === parsed.GoodId);
        
        if (!item) return alert("Товар не найден в плане!");
        
        state.currentPallet = { ...parsed, raw, askSSCC: item.sscc };
        if (item.sscc) {
            document.getElementById('sscc-input').style.display = 'block';
            document.getElementById('sscc-input').focus();
        } else {
            saveScan();
        }
    }
});

function saveScan(sscc = null) {
    state.scans.push({ ...state.currentPallet, sscc });
    document.getElementById('stat-count').innerText = state.scans.length;
    document.getElementById('pallet-input').value = '';
    document.getElementById('sscc-input').style.display = 'none';
    document.getElementById('pallet-input').focus();
}

document.getElementById('sscc-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') saveScan(this.value);
});

async function confirmShipment() {
    await apiRequest('/shipmentconfirm', { scans: state.scans });
    alert("Данные отправлены!");
}

// Инициализация
window.onload = async () => {
    await loadScheme();
};
