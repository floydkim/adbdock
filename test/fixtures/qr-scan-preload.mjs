// Simulate a phone scanning the real encoder's payload; never used with real ADB.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const qr = require('qrcode-terminal');
const generate = qr.generate;
qr.generate = (payload, options, callback) => {
  const match = /^WIFI:T:ADB;S:([^;]+);P:([^;]+);;$/.exec(payload);
  if (!match) throw new Error('Invalid Android QR payload');
  const file = process.env.FAKE_ADB_STATE;
  const state = JSON.parse(readFileSync(file, 'utf8'));
  state.qrScan = { service: match[1], password: match[2] };
  writeFileSync(file, JSON.stringify(state));
  generate.call(qr, payload, options, callback);
};
