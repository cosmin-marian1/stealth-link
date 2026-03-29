// connection.js - USB and BLE connection handling

import { BLE_SERVICE, BLE_RX, BLE_TX, BAUD_RATE } from './config.js';

export class ConnectionManager {
    constructor() {
        this.port = null;
        this.writer = null;
        this.reader = null;
        this.bleDevice = null;
        this.bleRx = null;
        this.bleTx = null;
        this.connType = null;
        this.isConnected = false;
        this.onDataCallback = null;
        this.onDisconnectCallback = null;
    }

    async connectUSB() {
        try {
            this.port = await navigator.serial.requestPort();
            await this.port.open({ baudRate: BAUD_RATE });
            
            const enc = new TextEncoderStream();
            enc.readable.pipeTo(this.port.writable);
            this.writer = enc.writable.getWriter();
            
            const dec = new TextDecoderStream();
            this.port.readable.pipeTo(dec.writable);
            this.reader = dec.readable.getReader();
            
            this.connType = "USB";
            this.isConnected = true;
            
            this.startReadLoop();
            return true;
        } catch (e) {
            console.error('USB Connection Error:', e);
            throw e;
        }
    }

    async connectBLE() {
        try {
            this.bleDevice = await navigator.bluetooth.requestDevice({ 
                acceptAllDevices: true, 
                optionalServices: [BLE_SERVICE] 
            });
            
            this.bleDevice.addEventListener('gattserverdisconnected', 
                () => this.handleDisconnect());
            
            const server = await this.bleDevice.gatt.connect();
            const service = await server.getPrimaryService(BLE_SERVICE);
            this.bleRx = await service.getCharacteristic(BLE_RX);
            this.bleTx = await service.getCharacteristic(BLE_TX);
            
            await this.bleTx.startNotifications();
            this.bleTx.addEventListener('characteristicvaluechanged', 
                e => this.handleBLEData(e));
            
            this.connType = "BLE";
            this.isConnected = true;
            
            return true;
        } catch (e) {
            console.error('BLE Connection Error:', e);
            throw e;
        }
    }

    handleBLEData(e) {
        const text = new TextDecoder().decode(e.target.value);
        if (this.onDataCallback) {
            this.onDataCallback(text);
        }
    }

    async startReadLoop() {
        try {
            while (this.isConnected && this.reader) {
                const { value, done } = await this.reader.read();
                if (done) break;
                if (this.onDataCallback) {
                    this.onDataCallback(value);
                }
            }
        } catch (e) {
            this.handleDisconnect();
        }
    }

    async send(data) {
        try {
            if (this.connType === "USB" && this.writer) {
                await this.writer.write(data + "\n");
            } else if (this.connType === "BLE" && this.bleRx) {
                await this.bleRx.writeValue(new TextEncoder().encode(data));
            }
            return true;
        } catch (e) {
            this.handleDisconnect();
            throw e;
        }
    }

    handleDisconnect() {
        this.isConnected = false;
        if (this.onDisconnectCallback) {
            this.onDisconnectCallback();
        }
    }

    setOnDataCallback(callback) {
        this.onDataCallback = callback;
    }

    setOnDisconnectCallback(callback) {
        this.onDisconnectCallback = callback;
    }

    getConnectionType() {
        return this.connType;
    }

    isConnected() {
        return this.isConnected;
    }

    async disconnect() {
        if (this.reader) {
            await this.reader.cancel();
        }
        if (this.writer) {
            await this.writer.close();
        }
        if (this.port) {
            await this.port.close();
        }
        if (this.bleDevice && this.bleDevice.gatt.connected) {
            this.bleDevice.gatt.disconnect();
        }
        this.isConnected = false;
        this.connType = null;
    }
}
