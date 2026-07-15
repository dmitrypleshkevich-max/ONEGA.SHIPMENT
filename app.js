// --- КОНФИГУРАЦИЯ ---
const CONFIG = {
    //API_URL: 'https://192.168.0.3:443/buh_test/hs/exchanges',
    API_URL: 'https://api.onega.by:8443/buh_test/hs/exchanges',
    packingScheme: {
    "totalLength": { "min": 59, "max": 59 },
    "fields": [
        { "name": "ContainerID", "start": 2, "length": 5 },
        { "name": "Date",        "start": 7, "length": 6 },
        { "name": "GoodId",      "start": 13, "length": 13 },
        { "name": "batchID",     "start": 37, "length": 4 },
        { "name": "Qty",         "start": 47, "length": 4 }
    ]
}
};



let activeScheme = { ...CONFIG.packingScheme };
let state = {
    plan: [],
    scans: [],
    currentPallet: null,
    user: null
};
// Глобальная переменная для хранения токена
let bearerToken = null;

async function auth() {
    const username = document.getElementById('login').value;
    const password = document.getElementById('password').value;
    
    try {
        const response = await fetch(`${CONFIG.API_URL}/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }) // Формат из документации
        });

        const result = await response.json();

        if (response.ok && result.success) {
            bearerToken = result.token; // Сохраняем токен
            console.log("Успешная авторизация, токен получен");
            
            // Переход к экрану задания
            document.getElementById('screen-auth').style.display = 'none';
            document.getElementById('screen-task').style.display = 'block';
        } else {
            alert(`Ошибка авторизации: ${result.error || "Неверные данные"}`);
        }
    } catch (e) {
        console.error("Ошибка сети:", e);
        alert("Нет связи с сервером");
    }
}

// --- ОСНОВНАЯ ЛОГИКА ---

async function loadScheme() {
    try {
        const response = await fetch('packing.json');
        if (response.ok) {
            const externalScheme = await response.json();
            if (externalScheme.fields) {
                activeScheme.fields = activeScheme.fields.map(defaultField => {
                    const override = externalScheme.fields.find(f => f.name === defaultField.name);
                    return override ? { ...defaultField, ...override } : defaultField;
                });
            }
        }
    } catch (e) {
        console.warn("Файл packing.json не найден, используем дефолтную схему.");
    }
}

function parseRaw(raw) {
    if (raw.length < activeScheme.totalLength.min) return null;
    let result = {};
    activeScheme.fields.forEach(f => {
        result[f.name] = raw.substring(f.start, f.start + f.length).trim();
    });
    return result;
}

// --- ОБРАБОТКА СКАНА ---

// --- ОБРАБОТКА СКАНА ---

document.getElementById('pallet-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        const raw = this.value;
        const parsed = parseRaw(raw);
        
        // --- ДОБАВЛЯЕМ ОТЛАДКУ ---
        console.log("=== Результат парсинга пак-листа ===");
        console.log("Сырая строка:", raw);
        console.log("Длина строки:", raw.length);
        console.log("Распарсенные данные:", parsed);
        // -------------------------

        if (!parsed) {
            console.error("Ошибка парсинга: формат не соответствует схеме.");
            return alert("Ошибка: неверный формат штрих-кода!");
        }

        // Далее ваша логика поиска товара...
        const foundPlanItem = state.plan.find(row => row.item_codes.includes(parsed.GoodId));
        
        if (!foundPlanItem) {
            console.warn("Товар с GoodId", parsed.GoodId, "не найден в плане.");
            // ... остальная логика ...
        }
    }
});

function saveScan(sscc = null) {
    state.scans.push({ ...state.currentPallet, sscc });
    
    // Обновляем статистику
    document.getElementById('stat-count').innerText = state.scans.length;
    
    // Очистка полей
    document.getElementById('pallet-input').value = '';
    document.getElementById('sscc-input').value = '';
    document.getElementById('sscc-input').style.display = 'none';
    document.getElementById('pallet-input').focus();
}

document.getElementById('sscc-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') saveScan(this.value);
});

// --- API И СВЯЗЬ ---

async function getTask() {
    const orderNumber = document.getElementById('order-number').value;

    if (!orderNumber) {
        return alert("Ошибка: введите номер заказа.");
    }

    if (!bearerToken) {
        return alert("Ошибка: токен отсутствует. Авторизуйтесь снова.");
    }

    try {
        const response = await fetch(`${CONFIG.API_URL}/shipmentplan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${bearerToken}` // Передача токена согласно спецификации
            },
            body: JSON.stringify({ order_number: orderNumber })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // Сохраняем план в глобальный state
            state.plan = result.data;
            state.orderNumber = result.order_number; // Сохраняем для подтверждения отгрузки

            console.log("План загружен:", state.plan);

            // Переключаем интерфейс
            // В getTask() при успешном ответе:
                document.getElementById('screen-task').style.display = 'none';
                document.getElementById('screen-scan').style.display = 'block';
                document.getElementById('item-name').innerText = "Ожидание сканирования..."; // Просто начальное состояние
            
            // Если в плане есть наименование товара, можно вывести его на экран
            if (state.plan.length > 0) {
                //document.getElementById('item-name').innerText = state.plan[0].item_name;
            }
        } else {
            // Обработка ошибок (400, 401, 404, 500)
            alert(`Ошибка при получении плана: ${result.error || 'Неизвестная ошибка'}`);
        }
    } catch (e) {
        console.error("Ошибка сети:", e);
        alert("Нет связи с сервером при попытке получения плана.");
    }
}

async function confirmShipment() {
    // 1. Проверяем наличие токена авторизации
    if (!bearerToken) {
        return alert("Ошибка: нет токена авторизации. Пожалуйста, авторизуйтесь заново.");
    }

    // 2. Получаем номер заказа (берем из инпута на экране заданий)
    const orderNumber = document.getElementById('order-number').value;
    if (!orderNumber) {
        return alert("Ошибка: не указан номер заказа.");
    }

    if (state.scans.length === 0) {
        return alert("Нет данных для отправки.");
    }

    // 3. Группируем сканы по SSCC для соответствия формату API
    const palletsMap = {};
    state.scans.forEach(scanItem => {
        const ssccKey = scanItem.sscc || ""; // Если SSCC нет, используем пустую строку
        if (!palletsMap[ssccKey]) {
            palletsMap[ssccKey] = [];
        }
        // В массив scans складываем оригинальный штрих-код (raw)
        palletsMap[ssccKey].push(scanItem.raw); 
    });

    // Формируем итоговый массив pallets по спецификации
    const palletsPayload = Object.keys(palletsMap).map(sscc => ({
        sscc: sscc,
        scans: palletsMap[sscc]
    }));

    try {
        // 4. Отправляем запрос на сервер
        const response = await fetch(`${CONFIG.API_URL}/shipmentconfirm`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${bearerToken}` // Передаем токен
            },
            body: JSON.stringify({ 
                order_number: orderNumber,
                pallets: palletsPayload
            })
        });

        const result = await response.json();

        // 5. Обрабатываем ответ согласно спецификации API
        if (response.ok && result.success) {
            alert(`Отгрузка успешно подтверждена!\n${result.message || ''}`);
            
            // Очищаем состояние и счетчик на экране
            state.scans = [];
            document.getElementById('stat-count').innerText = '0';
        } else {
            // Обрабатываем ошибки сервера (например, 400 или 404)
            alert(`Ошибка при отправке: ${result.error || 'Неизвестная ошибка сервера'}`);
        }
    } catch (e) {
        console.error("Ошибка отправки данных:", e);
        alert("Нет связи с сервером");
    }
}

// Инициализация
loadScheme();
