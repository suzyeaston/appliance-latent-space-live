/**
 * Headed Chrome pass over the production preview. Screenshots only.
 * This does not listen to the audio.
 */
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { chromePath, browserArgs } from './browser.mjs';

const OUT = process.env.SCREENSHOT_DIR || '/tmp/als-ui';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: process.env.HEADLESS === '1',
  defaultViewport: { width: 1440, height: 900 },
  args: [...browserArgs(), '--window-size=1440,900'],
});

const page = await browser.newPage();
const notes = [];
const note = (label, ok, detail) => {
  notes.push({ label, ok, detail });
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label} — ${detail}`);
};

try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: `${OUT}/01-loaded.png`, fullPage: true });

  const heading = await page.$eval('h1', (el) => el.textContent.trim());
  const status = await page.$eval('#audio-status', (el) => el.textContent.trim());
  const editor = await page.$eval('#editor', (el) => el.value);
  note('title', heading.includes('Appliance Latent Space'), heading);
  note('silent until start', /not running|until you press Start/i.test(status), status);
  note('example loaded', /Service Elevator/.test(editor) && /tempo 104/.test(editor), editor.slice(0, 40));

  const disabled = await page.$$eval('[data-state="unimplemented"]', (rows) =>
    rows.map((row) => row.getAttribute('data-control-row')),
  );
  note('latent controls disabled', ['latent_x', 'latent_y', 'neural_mix'].every((id) => disabled.includes(id)), disabled.join(','));
  const killDisabled = await page.$eval('#kill', (el) => el.disabled);
  note('kill disabled before start', killDisabled, String(killDisabled));

  await page.click('#start');
  await new Promise((r) => setTimeout(r, 1800));
  const live = await page.$eval('#audio-status', (el) => el.textContent.trim());
  const tag = await page.$eval('#pattern-state', (el) => el.textContent.trim());
  const canvas = await page.$eval('#stage', (el) => {
    const ctx = el.getContext('2d');
    const data = ctx.getImageData(0, 0, el.width, el.height).data;
    let colored = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (b > r + 15 || r > 40) colored += 1;
    }
    return { colored, width: el.width, height: el.height };
  });
  note('audio running after start', /running/i.test(live), live);
  note('pattern marked playing', /playing/i.test(tag), tag);
  note('canvas shows musical marks', canvas.colored > 30, JSON.stringify(canvas));
  await page.screenshot({ path: `${OUT}/02-playing.png` });

  await page.click('#editor');
  await page.keyboard.down('Control');
  await page.keyboard.press('Home');
  await page.keyboard.up('Control');
  await page.keyboard.type('nope 1\n');
  await new Promise((r) => setTimeout(r, 900));
  const diag = await page.$eval('#diagnostics', (el) => el.textContent.trim());
  const tagAfter = await page.$eval('#pattern-state', (el) => el.textContent.trim());
  note('invalid edit is located', /unknown instruction/i.test(diag), diag.slice(0, 180));
  note('last valid pattern keeps playing', /still playing/i.test(tagAfter), tagAfter);
  await page.screenshot({ path: `${OUT}/03-invalid-edit.png` });

  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 700));

  await page.click('#kill');
  await new Promise((r) => setTimeout(r, 300));
  const killed = await page.$eval('#audio-status', (el) => el.textContent.trim());
  const startEnabled = await page.$eval('#start', (el) => !el.disabled);
  note('kill silences', /kill/i.test(killed), killed);
  note('start available after kill', startEnabled, String(startEnabled));
  await page.screenshot({ path: `${OUT}/04-killed.png` });

  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#examples button:nth-of-type(2)');
  await new Promise((r) => setTimeout(r, 400));
  const cold = await page.$eval('#editor', (el) => el.value);
  note('cold start example', /Cold Start/.test(cold) && /tempo 58/.test(cold), cold.slice(0, 48));
  await page.screenshot({ path: `${OUT}/05-cold-start.png` });
} finally {
  await browser.close();
}

const failed = notes.filter((item) => !item.ok);
if (failed.length) process.exit(1);
