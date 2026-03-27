// Mock browser globals for Medplum PKCE + JWT flow in Node.js 22

// sessionStorage mock for PKCE state/verifier storage
const sessionData = new Map();
global.sessionStorage = {
  getItem: (key) => sessionData.get(key) ?? null,
  setItem: (key, value) => sessionData.set(key, String(value)),
  removeItem: (key) => sessionData.delete(key),
  clear: () => sessionData.clear(),
  get length() { return sessionData.size; },
  key: (index) => Array.from(sessionData.keys())[index] ?? null,
};

// window proxy — forwards unknown properties to globalThis so Node.js built-ins
// (TextDecoder, TextEncoder, crypto, btoa, atob, etc.) are available as window.*
const windowOverrides = {
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  crypto: globalThis.crypto,
  location: {
    protocol: 'http:',
    host: 'localhost:3000',
    hostname: 'localhost',
    port: '3000',
    href: 'http://localhost:3000/',
    origin: 'http://localhost:3000',
  },
};

global.window = new Proxy(windowOverrides, {
  get(target, key) {
    return key in target ? target[key] : globalThis[key];
  },
});
