/**
 * Runs the offline audio checks in Chrome. Web Audio does not exist in Node.
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { chromePath, browserArgs } from './browser.mjs';

const PORT = 5199;
const HARNESS_URL = `http://127.0.0.1:${PORT}/tests/audio/harness.html`;

function startVite() {
  const child = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: fileURLToPath(new globalThis.URL('../..', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    log += chunk.toString();
  });
  return { child, readLog: () => log };
}

async function waitForServer(readLog) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const log = readLog();
    if (log.includes('Local:')) return;
    if (log.includes('already in use') || log.includes('error when starting')) {
      throw new Error(`Vite did not start.\n${log}`);
    }
    await delay(150);
  }
  throw new Error(`Vite did not start.\n${readLog()}`);
}

const server = startVite();
let browser;
try {
  await waitForServer(server.readLog);
  browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: browserArgs(),
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => {
    console.error('pageerror', error);
  });
  await page.goto(HARNESS_URL, { waitUntil: 'networkidle0', timeout: 20000 });
  await page.waitForFunction('window.__audioReport', { timeout: 20000 });
  const report = await page.evaluate(() => window.__audioReport);
  for (const check of report.checks) {
    console.log(`${check.ok ? 'ok ' : 'FAIL'} ${check.name} — ${check.detail}`);
  }
  if (report.error) console.error(report.error);
  if (browser) await browser.close();
  server.child.kill('SIGTERM');
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error(error);
  if (browser) await browser.close().catch(() => {});
  server.child.kill('SIGTERM');
  process.exit(1);
}
