// app.js - Main application logic and coordination

import { BLE_SERVICE, BLE_RX, BLE_TX, HANDSHAKE_INTERVAL_MS, MESSAGE_TIMEOUT_MS } from './config.js';
import { validateEncryptionKey, validateCallsign, validateConfig } from './crypto.js';
import { UIManager } from './ui.js';
import { ConnectionManager } from './connection.js';

// Application State
const state = {
    myName: "",
    incomingBuffer: "",
    handshakeInterval: null,
    watchdog: null,
    pendingMsgId: null,
    pendingTimeout: null,
    isConnected: false
};

// Initialize managers
const ui = new UIManager();
const connection = new ConnectionManager();

// JSON Processing
function processChunk(chunk) {
    // Clean non-printable characters
    chunk = chunk.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
    state.incomingBuffer += chunk;
    
    // Find JSON objects in buffer
    let start = state.incomingBuffer.indexOf('{');
    if (start === -1 && state.incomingBuffer.length > 500) {
        state.incomingBuffer = "";
        return;
    }
    
    while (start !== -1) {
        let end = state.incomingBuffer.indexOf('}', start);
        if (end !== -1) {
            let jsonStr = state.incomingBuffer.substring(start, end + 1);
            try {
                const data = JSON.parse(jsonStr);
                handleJson(data);
                state.incomingBuffer = state.incomingBuffer.substring(end + 1);
                start = state.incomingBuffer.indexOf('{');
            } catch (e) {
                start = state.incomingBuffer.indexOf('{', start + 1);
            }
        } else {
            break;
        }
    }
}

function handleJson(data) {
    switch (data.type) {
        case 'login':
            handleLogin(data);
            break;
        case 'unlock_success':
            ui.enterChat();
            break;
        case 'unlock_fail':
            ui.showError('loginError', true);
            ui.shake(ui.elements.loginForm);
            break;
        case 'rx':
            ui.addMessage(data.msg, 'partner', data.name);
            break;
        case 'status':
            handleStatus(data);
            break;
        case 'tx_ok':
            resolveMessage(true);
            break;
        case 'tx_fail':
            resolveMessage(false);
            break;
    }
}

function handleLogin(data) {
    if (state.handshakeInterval) {
        clearInterval(state.handshakeInterval);
        state.handshakeInterval = null;
    }
    
    if (data.configured) {
        state.myName = data.name;
        ui.setMyName(data.name);
        if (data.locked) {
            ui.showLoginForm();
        } else {
            ui.enterChat();
        }
    } else {
        ui.showSetupForm();
    }
}

function handleStatus(data) {
    if (data.msg === 'online') {
        ui.updatePartnerStatus('online', data.partner || "Online");
        if (state.watchdog) clearTimeout(state.watchdog);
        state.watchdog = setTimeout(() => {
            ui.updatePartnerStatus('waiting', 'Silent');
        }, 10000);
    }
}

// Connection Handlers
function onConnected() {
    ui.showUsbAlert(false);
    ui.elements.connectBtn.parentElement.style.display = 'none';
    ui.elements.bleBtn.parentElement.style.display = 'none';
    ui.updateStatus("Handshaking... (Wait)");
    
    state.handshakeInterval = setInterval(() => {
        connection.send("GET_INFO");
    }, HANDSHAKE_INTERVAL_MS);
}

function onDisconnect() {
    state.isConnected = false;
    ui.showUsbAlert(true);
    ui.setInputEnabled(false);
    ui.showOverlay();
    ui.elements.setupForm.classList.remove('active');
    ui.elements.loginForm.classList.remove('active');
    ui.elements.connectBtn.parentElement.style.display = 'flex';
    ui.elements.bleBtn.parentElement.style.display = 'flex';
    ui.updateStatus("Connection lost.");
    
    if (state.handshakeInterval) {
        clearInterval(state.handshakeInterval);
    }
}

// Button Event Handlers
function setupEventListeners() {
    // USB Connect
    ui.elements.connectBtn.addEventListener('click', async () => {
        try {
            await connection.connectUSB();
            onConnected();
        } catch (e) {
            ui.updateStatus("USB Error: " + e.message);
        }
    });

    // BLE Connect
    ui.elements.bleBtn.addEventListener('click', async () => {
        try {
            await connection.connectBLE();
            onConnected();
        } catch (e) {
            ui.updateStatus("BLE Error: " + e.message);
        }
    });

    // Save Configuration
    document.getElementById('saveConfigBtn').addEventListener('click', () => {
        const user = document.getElementById('setupUser').value;
        const key = document.getElementById('setupKey').value;
        const pass = document.getElementById('setupPass').value;
        const role = document.getElementById('setupRole').value;
        
        if (!validateEncryptionKey(key)) {
            alert("Key must be 16 chars!");
            return;
        }
        if (!validateCallsign(user)) {
            alert("Callsign max 7 chars!");
            return;
        }
        if (validateConfig(user, key, pass)) {
            connection.send(`CFG,${role},${key},${user},${pass}`);
        } else {
            alert("Fill all fields!");
        }
    });

    // Unlock/Login
    document.getElementById('unlockBtn').addEventListener('click', () => {
        const pass = document.getElementById('loginPass').value;
        connection.send("UNLOCK," + pass);
    });

    // Send Message
    ui.elements.sendBtn.addEventListener('click', sendMessage);
    ui.elements.msgInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // Lock Session
    ui.elements.lockBtn.addEventListener('click', () => {
        location.reload();
    });

    // Wipe Data
    ui.elements.wipeBtn.addEventListener('click', async () => {
        if (confirm("Reset?")) {
            await connection.send("RESET");
            location.reload();
        }
    });
}

// Messaging
async function sendMessage() {
    if (!state.isConnected) return;
    
    const txt = ui.elements.msgInput.value.trim();
    if (!txt) return;
    
    if (state.pendingMsgId) {
        resolveMessage(false);
    }
    
    state.pendingMsgId = Date.now();
    ui.addMessage(txt, 'me', state.myName, true, state.pendingMsgId);
    
    await connection.send(txt);
    ui.elements.msgInput.value = '';
    
    state.pendingTimeout = setTimeout(() => {
        resolveMessage(false);
    }, MESSAGE_TIMEOUT_MS);
}

function resolveMessage(success) {
    if (!state.pendingMsgId) return;
    
    ui.resolveMessage(state.pendingMsgId, success);
    state.pendingMsgId = null;
    
    if (state.pendingTimeout) {
        clearTimeout(state.pendingTimeout);
    }
}

// Initialize Application
function init() {
    ui.cacheElements();
    
    // Set up connection callbacks
    connection.setOnDataCallback(processChunk);
    connection.setOnDisconnectCallback(onDisconnect);
    
    // Set up event listeners
    setupEventListeners();
    
    state.isConnected = true;
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
