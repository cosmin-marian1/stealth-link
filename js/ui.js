// ui.js - UI state management and rendering

export class UIManager {
    constructor() {
        this.elements = {};
    }

    cacheElements() {
        this.elements = {
            overlay: document.getElementById('overlay-screen'),
            connectBtn: document.getElementById('btnUsb'),
            bleBtn: document.getElementById('btnBle'),
            statusText: document.getElementById('statusText'),
            usbAlert: document.getElementById('usb-alert'),
            inputArea: document.getElementById('input-area'),
            connDot: document.getElementById('connDot'),
            partnerName: document.getElementById('partnerName'),
            myIdentity: document.getElementById('myIdentity'),
            setupForm: document.getElementById('setupForm'),
            loginForm: document.getElementById('loginForm'),
            chatWindow: document.getElementById('chat-window'),
            msgInput: document.getElementById('msgInput'),
            sendBtn: document.getElementById('sendBtn'),
            lockBtn: document.getElementById('lockBtn'),
            wipeBtn: document.getElementById('wipeBtn')
        };
    }

    showOverlay() {
        this.elements.overlay.style.display = 'flex';
    }

    hideOverlay() {
        this.elements.overlay.style.display = 'none';
    }

    showSetupForm() {
        this.elements.setupForm.classList.add('active');
        this.elements.connectBtn.parentElement.style.display = 'none';
        this.elements.bleBtn.parentElement.style.display = 'none';
    }

    showLoginForm() {
        this.elements.loginForm.classList.add('active');
        this.elements.connectBtn.parentElement.style.display = 'none';
        this.elements.bleBtn.parentElement.style.display = 'none';
    }

    enterChat() {
        this.hideOverlay();
        this.elements.loginForm.classList.remove('active');
        this.elements.inputArea.classList.remove('disabled');
        this.elements.myIdentity.innerText = this.myName + " (YOU)";
        this.updatePartnerStatus('waiting', 'Waiting...');
    }

    updateStatus(text) {
        this.elements.statusText.innerText = text;
    }

    updatePartnerStatus(status, partnerName) {
        const dot = this.elements.connDot;
        dot.className = 'dot';
        
        if (status === 'online') {
            dot.classList.add('online');
        } else if (status === 'waiting') {
            dot.classList.add('waiting');
        }
        
        this.elements.partnerName.innerText = "Target: " + partnerName;
    }

    showUsbAlert(show) {
        this.elements.usbAlert.style.display = show ? 'block' : 'none';
    }

    setInputEnabled(enabled) {
        if (enabled) {
            this.elements.inputArea.classList.remove('disabled');
        } else {
            this.elements.inputArea.classList.add('disabled');
        }
    }

    addMessage(text, type, sender, pending = false, id = null) {
        const div = document.createElement('div');
        div.className = `msg ${type}`;
        
        const time = new Date().toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        let statusHtml = '';
        if (type === 'me') {
            statusHtml = pending
                ? `<span id="st-${id}" class="status-sending">Sending...</span>`
                : `<span class="status-sent">✓</span>`;
        }
        
        div.innerHTML = `
            <div class="msg-sender">${text.replace(/</g, '&lt;')}</div>
            <div class="msg-text">${text.replace(/</g, '&lt;')}</div>
            <div class="msg-footer">
                <span>${time}</span>
                ${statusHtml}
            </div>
        `;
        
        this.elements.chatWindow.appendChild(div);
        this.elements.chatWindow.scrollTop = this.elements.chatWindow.scrollHeight;
    }

    resolveMessage(id, success) {
        const el = document.getElementById(`st-${id}`);
        if (el) {
            el.className = success ? "status-sent" : "status-fail";
            el.innerText = success ? "✓" : "✕";
        }
    }

    shake(element) {
        element.style.transform = "translateX(10px)";
        setTimeout(() => element.style.transform = "translateX(-10px)", 100);
        setTimeout(() => element.style.transform = "translateX(0)", 200);
    }

    showError(elementId, show) {
        const el = document.getElementById(elementId);
        if (el) {
            el.style.display = show ? 'block' : 'none';
        }
    }

    setMyName(name) {
        this.myName = name;
    }
}
