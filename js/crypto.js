// crypto.js - Input validation helpers (encryption happens on ESP32)

import { MAX_CALLSIGN_LENGTH, KEY_LENGTH } from './config.js';

export function validateEncryptionKey(key) {
    return key && key.length === KEY_LENGTH;
}

export function validateCallsign(callsign) {
    return callsign && callsign.length <= MAX_CALLSIGN_LENGTH;
}

export function validateConfig(user, key, pass) {
    return user && key && pass && 
           validateEncryptionKey(key) && 
           validateCallsign(user);
}
