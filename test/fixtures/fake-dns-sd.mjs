#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const statePath = process.env.FAKE_ADB_STATE;
const state = JSON.parse(readFileSync(statePath, 'utf8'));
appendFileSync(`${statePath}.bonjour`, `${JSON.stringify(args)}\n`);
appendFileSync(`${statePath}.bonjour-pids`, `${process.pid}\n`);
if (args[0] === '-L') {
  for (const s of state.bonjour?.[args[1]] ?? []) {
    console.log(`12:00:00.000  ${s.name ?? args[1]}._adb-tls-connect._tcp.local. can be reached at ${s.host}:${s.port} (interface 14)`);
  }
} else if (args[0] === '-G') {
  for (const address of state.addresses?.[args[2]] ?? []) {
    console.log(`12:00:00.000  Add  2  14  ${args[2]}  ${address}  120`);
  }
}
if (state.bonjourHang) setInterval(() => {}, 1000);
