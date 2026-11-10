// Browser end-to-end regression test for the whole app.
// Needs: node + playwright (npm i playwright) and the server running:
//   python studio.py serve --no-browser --port 8765 --quiet &
//   node tests/e2e_ui.cjs [http://127.0.0.1:8765]
// Exits non-zero on the first failed expectation. Removes everything it creates.
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8765';
let step = 0, failed = 0;
const ok = (cond, msg) => {
  step++;
  if (cond) console.log(`  ok ${step}  ${msg}`);
  else { failed++; console.log(`  FAIL ${step}  ${msg}`); }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE ' + e));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());
  const wait = ms => page.waitForTimeout(ms);
  const api = (path, opts) => page.evaluate(async ([p, o]) => (await fetch(p, o)).json(), [path, opts]);

  console.log('Create tab');
  await page.goto(BASE); await wait(2500);
  ok(await page.$eval('#prev', e => e.naturalWidth > 0), 'preview image renders on load');
  ok((await page.$$('#themes .theme')).length === 7, 'My brand theme + 6 themes shown');
  ok((await page.$$('#strip img')).length >= 3, 'scene thumbnails shown');
  ok((await page.textContent('#qc')).length > 10, 'quality check panel shown');
  await page.fill('#text', 'Quick *test* post'); await wait(1800);
  ok((await page.textContent('#sceneMeta')).includes('scene'), 'scene counter updates while typing');
  await page.fill('#text', 'Big sale \u{1F525} today'); await wait(1800);
  ok((await page.textContent('#genErr')).includes('Removed characters'), 'unsupported emoji is reported, not drawn as a box');
  await page.fill('#text', ''); await wait(900);
  ok(await page.$eval('#exportBtn', b => b.disabled), 'export disabled when there is no text');
  await page.fill('#text', 'Spring sale: *30%* off everything\nCTA: Shop now'); await wait(1800);
  await page.click('#kindSeg button[data-k=image]'); await wait(1500);
  ok((await page.$$eval('#fmt option', o => o.map(x => x.value))).join() === 'png,jpg', 'image mode offers PNG/JPG');
  await page.click('#themes .theme:nth-child(4)'); await wait(1200);
  await page.check('#allThemes'); await page.click('#exportBtn');
  await page.waitForFunction(() => document.querySelectorAll('#jobs .out a.link').length >= 6, null, { timeout: 120000 }).catch(() => {});
  await wait(1200);
  ok((await page.$$('#jobs .out a.link')).length >= 6, 'export + 5 theme variants produced files');

  console.log('Library tab');
  await page.click('nav button[data-tab=library]'); await wait(1500);
  const cards = (await page.$$('#libGrid .item')).length;
  ok(cards >= 6, `library lists the new files (${cards})`);
  ok(parseInt(await page.textContent('#libCount')) >= 6, 'library badge shows the count');
  const [zip] = await Promise.all([page.waitForEvent('download'), page.click('#libAll')]);
  ok(/\.zip$/.test(zip.suggestedFilename()) && require('fs').statSync(await zip.path()).size > 1000, 'download-everything zip works');
  await page.click('#libKind button[data-f=video]'); await wait(300);
  ok((await page.$$('#libGrid .item')).length === 0, 'video filter hides images');
  await page.click('#libKind button[data-f=all]');
  await page.click('#libSelAll'); await wait(200);
  ok(!(await page.$eval('#libZipSel', b => b.disabled)), 'selection enables zip/delete');
  await page.click('#libDel'); await wait(1200);
  ok((await page.$$('#libGrid .item')).length === 0, 'delete removes selected files');

  console.log('Brand tab');
  await page.click('nav button[data-tab=brand]'); await wait(2500);
  ok((await page.$$('#bPrev img')).length === 3, 'live brand preview shows 3 scenes');
  const first = await page.$eval('#bPrev img', i => i.src);
  await page.evaluate(() => { const c = document.querySelector('#bColors input'); c.value = '#00aa66'; c.dispatchEvent(new Event('input')); });
  await wait(2000);
  ok(await page.$eval('#bPrev img', (i, f) => i.src !== f, first), 'changing a colour updates the preview');
  await page.fill('#bName', 'E2E Brand'); await page.fill('#bCta', 'Join now'); await page.click('#bSave'); await wait(1200);
  await wait(1500);   // the notice must survive the live-preview refresh
  ok((await page.textContent('#bOk')).includes('Saved'), 'brand saved notice stays visible');
  const brands = await api('/api/brands');
  ok(brands.brands.includes('E2E-Brand') && brands.active === 'E2E-Brand', 'brand profile active on the server');

  console.log('Bulk tab');
  await page.click('nav button[data-tab=bulk]');
  await page.fill('#csv', 'name,script\none,Hello *world*\ntwo,Second post\n'); await wait(1200);
  ok((await page.textContent('#csvInfo')).includes('2 rows'), 'CSV preview counts rows');
  await page.fill('#csv', 'name,headline\none,x'); await wait(1000);
  // "headline" is an accepted script column, so this is valid; a file with neither must be rejected:
  await page.fill('#csv', 'name,price\none,5'); await wait(1000);
  ok((await page.textContent('#csvErr')).includes('Missing column'), 'missing script column explained');
  await page.fill('#csv', 'name,script\none,Hello *world*\ntwo,Second post\nthree,\n'); await wait(1000);
  await page.selectOption('#bKind', 'image'); await wait(400);
  await page.click('#bulkBtn'); await page.waitForSelector('#bJobs a.link', { timeout: 120000 });
  ok((await page.textContent('#bJobs')).includes('2 files ready'), 'bulk renders 2 files');
  ok((await page.textContent('#bJobs')).includes('Row 4'), 'the empty row is skipped and reported');
  ok((await page.textContent('#bJobs')).includes('Download all (.zip)'), 'bulk offers a zip');

  console.log('Advanced editor hand-off');
  await page.click('nav button[data-tab=create]'); await page.click('#kindSeg button[data-k=video]'); await page.fill('#text', 'Editor hand-off *check*\nSecond scene'); await wait(1800);
  const [pop] = await Promise.all([page.waitForEvent('popup'), page.click('#toEditor')]); await pop.waitForTimeout(2500);
  ok((await pop.$$('#sceneList .item')).length >= 2, 'editor opens the generated project');
  await pop.close();

  // clean up the brand and files this run created
  await api('/api/brands/E2E-Brand', { method: 'DELETE' });
  const lib = await api('/api/library');
  if (lib.items.length) {
    await api('/api/library/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: lib.items.map(i => i.file) }) });
  }

  ok(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} FAILED of ${step}` : `\nAll ${step} browser checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('E2E crashed:', e); process.exit(2); });
