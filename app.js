const CONFIG = {
    API_URL: 'https://api.onega.by:8443/buh_test/hs/exchanges',
    // Сюда добавим схемы парсинга позже
};

class APIClient {
    constructor() { this.token = null; }

    async request(endpoint, method = 'POST', body = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

        const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : null
        });

        if (response.status === 401 && endpoint !== '/auth') {
            // Если токен просрочен, пробуем обновить (логика авторизации должна быть реализована)
            console.warn("Token expired, re-authenticating...");
            return null; 
        }
        return response.json();
    }
}

const api = new APIClient();

// Пример переключения экранов
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(screenId).style.display = 'block';
}

document.getElementById('btn-login').onclick = async () => {
    // Здесь будет вызов api.request('/auth', ...)
    console.log("Авторизация...");
    showScreen('screen-task');
};
