const CONFIG = {
    API_URL: 'https://api.onega.by:8443/buh_test/hs/exchanges',
    // Схема парсинга
    packingScheme: {
        fields: [
            { name: "ContainerID", start: 3, length: 5 },
            { name: "GoodId", start: 15, length: 13 }
        ]
    }
};

let state = { token: '', plan: [], scans: [], currentPallet: null };

async function apiRequest(endpoint, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const res = await fetch(CONFIG.API_URL + endpoint, { 
        method: body ? 'POST' : 'GET', headers, body: JSON.stringify(body) 
    });
    return res.json();
}

function parseRaw(raw) {
    if (raw.length !== 59) return null;
    return {
        container: raw.substring(2, 7), // start 3
        goodId: raw.substring(14, 27)   // start 15
    };
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
        const item = state.plan.find(i => i.good_id === parsed.goodId);
        
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
