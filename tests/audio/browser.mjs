import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/local/bin/google-chrome',
  ].filter(Boolean);
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new Error('Chrome was not found. Install Google Chrome, or set CHROME_PATH to its executable.');
  return path;
}
export function browserArgs() {
  return process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
}
