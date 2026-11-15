/**
 * Stockbook backend: a Google Sheet that records stock movements from the tap page.
 *
 * Setup (once):
 *   1. Create a Google Sheet. Extensions → Apps Script → paste this file → Save.
 *   2. Choose `setup` in the toolbar → Run → allow access.
 *   3. Deploy → New deployment → type "Web app" → Execute as: Me, Who has access: Anyone → Deploy.
 *   4. Open the Settings tab of the sheet: copy the Web app URL into "Web app URL".
 *      The "Store link" cell then holds the link for the QR code.
 * Products, people and the owner's email are edited in the sheet, not here.
 */

const TZ = 'Africa/Nairobi';
const ACTIONS = ['Took', 'Returned', 'Received', 'Counted'];
const MOVE_HEADERS = ['ID', 'Time', 'Who', 'Product', 'Action', 'Quantity', 'Change', 'Job / note', 'Status', 'Recorded at'];
const PAGE_URL = 'https://kmiringu.github.io/stockbook/';

// ---------- setup ----------

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  const sheet = (name, headers, rows) => {
    let sh = ss.getSheetByName(name);
    if (sh) return sh;
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f1efe8');
    sh.setFrozenRows(1);
    if (rows && rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sh.autoResizeColumns(1, headers.length);
    return sh;
  };

  sheet('Settings', ['Setting', 'Value', 'Notes'], [
    ['Store name', 'Gikambura Office Store', 'Shown at the top of the page'],
    ['Store key', Utilities.getUuid().replace(/-/g, '').slice(0, 10), 'Secret in the QR link. Change it to lock out old links.'],
    ['Owner emails', '', 'Comma-separated. They get a summary every evening.'],
    ['Daily email hour', 18, '24h clock, Nairobi time'],
    ['Web app URL', '', 'Paste after Deploy → Web app'],
    ['Store link', '', 'Filled in automatically: print this as the QR code'],
  ]);
  const prod = sheet('Products',
    ['Product', 'Small unit', 'Big unit', 'Small per big', 'Opening stock (small units)', 'Reorder at (small units)', 'Price per small unit', 'Active'], [
    ['Hero welding rods', 'packet', 'box', 4, 279 * 4, 80, 1200, 'yes'],
    ['Body filler', 'tin', 'carton', '', '', '', '', 'yes'],
    ['Grey primer', 'tin', 'carton', '', '', '', '', 'yes'],
    ['White spirit', 'bottle', 'carton', '', '', '', '', 'yes'],
  ]);
  prod.getRange('D3:G5').setBackground('#fff4c2');
  prod.getRange('A1').setNote('Yellow cells: fill in packing, opening count and prices. ' +
    'Leave "Big unit" empty if it is only handled singly. Set Active to "no" to hide a product.');
  sheet('People', ['Name', 'Active'], [['Miringu', 'yes'], ['Eliud', 'yes']]);
  sheet('Moves', MOVE_HEADERS, [[
    'seed0001', Utilities.parseDate('2026-11-14 09:01', TZ, 'yyyy-MM-dd HH:mm'), 'Fundi Kanga', 'Hero welding rods', 'Took', 8, -8,
    'Self-bought for their project (2 boxes)', '', new Date()]]);
  buildSummary_();
  updateStoreLink_();

  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyEmail').timeBased().everyDays(1).atHour(Number(settings_()['Daily email hour']) || 18).inTimezone(TZ).create();
  ScriptApp.newTrigger('onSettingsEdit').forSpreadsheet(ss).onEdit().create();
}

function buildSummary_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Summary');
  if (!sh) sh = ss.insertSheet('Summary', 0);
  sh.clear();
  const h = ['Product', 'In store (small units)', 'In store', 'Taken out so far', 'Value', 'Status'];
  sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#f1efe8');
  sh.setFrozenRows(1);
  const f = [];
  for (let r = 2; r <= 30; r++) {
    const P = `Products!A${r}`;
    const bal = `(N(Products!E${r})+SUMIFS(Moves!G:G,Moves!D:D,${P},Moves!I:I,"<>void"))`;
    f.push([
      `=IF(${P}="","",${P})`,
      `=IF(${P}="","",${bal})`,
      `=IF(${P}="","",IF(N(Products!D${r})>1,INT(${bal}/Products!D${r})&" "&Products!C${r}&IF(MOD(${bal},Products!D${r})>0," + "&MOD(${bal},Products!D${r})&" "&Products!B${r},""),${bal}&" "&Products!B${r}))`,
      `=IF(${P}="","",-SUMIFS(Moves!G:G,Moves!D:D,${P},Moves!E:E,"Took",Moves!I:I,"<>void")&" "&Products!B${r})`,
      `=IF(${P}="","",${bal}*N(Products!G${r}))`,
      `=IF(${P}="","",IF(N(Products!E${r})=0,"Opening count missing",IF(${bal}<=N(Products!F${r}),"Reorder","OK")))`,
    ]);
  }
  sh.getRange(2, 1, f.length, h.length).setFormulas(f);
  sh.getRange('E2:E30').setNumberFormat('#,##0');
  sh.autoResizeColumns(1, h.length);
}

function onSettingsEdit(e) {
  if (e && e.range.getSheet().getName() === 'Settings') updateStoreLink_();
}

function updateStoreLink_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Settings');
  const s = settings_();
  const link = s['Web app URL']
    ? `${PAGE_URL}#k=${encodeURIComponent(s['Store key'])}&api=${encodeURIComponent(s['Web app URL'])}`
    : 'Paste the Web app URL above first';
  const row = sh.getRange('A:A').getValues().findIndex(r => r[0] === 'Store link') + 1;
  if (row) sh.getRange(row, 2).setValue(link);
}

// ---------- data access ----------

function settings_() {
  const rows = SpreadsheetApp.getActive().getSheetByName('Settings').getDataRange().getValues().slice(1);
  return Object.fromEntries(rows.map(r => [String(r[0]).trim(), r[1]]));
}

function products_() {
  return SpreadsheetApp.getActive().getSheetByName('Products').getDataRange().getValues().slice(1)
    .filter(r => r[0] && String(r[7]).toLowerCase() !== 'no')
    .map(r => ({
      name: String(r[0]).trim(), unit: r[1] || 'unit', big: r[2] || '', per: Number(r[3]) || 1,
      opening: Number(r[4]) || 0, reorder: Number(r[5]) || 0, price: Number(r[6]) || 0,
      hasOpening: r[4] !== '' && r[4] !== null,
    }));
}

function people_() {
  return SpreadsheetApp.getActive().getSheetByName('People').getDataRange().getValues().slice(1)
    .filter(r => r[0] && String(r[1]).toLowerCase() !== 'no').map(r => String(r[0]).trim());
}

function moves_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Moves');
  return sh.getDataRange().getValues().slice(1).map((r, i) => ({
    row: i + 2, id: String(r[0]), time: r[1], who: r[2], product: r[3], action: r[4],
    qty: Number(r[5]), change: Number(r[6]), note: r[7], status: r[8],
  }));
}

function balances_(products, moves) {
  const bal = {}, out = {};
  products.forEach(p => { bal[p.name] = p.opening; out[p.name] = 0; });
  moves.forEach(m => {
    if (m.status === 'void' || !(m.product in bal)) return;
    bal[m.product] += m.change;
    if (m.action === 'Took') out[m.product] += m.qty;
  });
  return { bal, out };
}

function state_() {
  const s = settings_(), products = products_(), moves = moves_();
  const { bal, out } = balances_(products, moves);
  const fmt = d => Utilities.formatDate(new Date(d), TZ, "yyyy-MM-dd'T'HH:mm");
  return {
    store: s['Store name'] || 'Store',
    people: people_(),
    products: products.map(p => Object.assign(p, { balance: bal[p.name], out: out[p.name] })),
    recent: moves.filter(m => m.status !== 'void').slice(-40).reverse()
      .map(m => ({ id: m.id, time: fmt(m.time), who: m.who, product: m.product, action: m.action, qty: m.qty, change: m.change, note: m.note })),
  };
}

// ---------- web app ----------

function doGet(e) { return json_(handle_(e.parameter || {})); }

function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad-request' }); }
  return json_(handle_(p));
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(p) {
  if (!p.k || String(p.k) !== String(settings_()['Store key'])) return { ok: false, error: 'bad-key' };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (p.op === 'record') return record_(p);
    if (p.op === 'undo') return undo_(p);
    return { ok: true, state: state_() };
  } finally {
    lock.releaseLock();
  }
}

function record_(p) {
  const products = products_(), moves = moves_();
  const prod = products.find(x => x.name === p.product);
  const qty = Number(p.qty);
  if (!prod) return { ok: false, error: 'Unknown product' };
  if (!people_().includes(p.who)) return { ok: false, error: 'Unknown name' };
  if (!ACTIONS.includes(p.action)) return { ok: false, error: 'Unknown action' };
  if (!(qty >= 0) || (qty === 0 && p.action !== 'Counted') || qty > 100000) return { ok: false, error: 'Check the amount' };
  // Offline phones resend the same record; the client-made ID makes that harmless.
  if (p.id && moves.some(m => m.id === String(p.id))) return { ok: true, duplicate: true, state: state_() };

  const { bal } = balances_(products, moves);
  const change = p.action === 'Took' ? -qty : p.action === 'Counted' ? qty - bal[prod.name] : qty;
  let when = new Date(p.time);
  const now = new Date();
  if (isNaN(when) || when > now || now - when > 7 * 864e5) when = now;
  const id = String(p.id || Utilities.getUuid().slice(0, 8)).slice(0, 20);
  SpreadsheetApp.getActive().getSheetByName('Moves').appendRow(
    [id, when, p.who, prod.name, p.action, qty, change, String(p.note || '').slice(0, 120), '', now]);
  return { ok: true, id, state: state_() };
}

function undo_(p) {
  const m = moves_().find(x => x.id === String(p.id));
  if (!m) return { ok: false, error: 'Not found' };
  if (m.who !== p.who) return { ok: false, error: 'Only the same person can undo' };
  const sh = SpreadsheetApp.getActive().getSheetByName('Moves');
  const recordedAt = sh.getRange(m.row, 10).getValue();
  if (new Date() - new Date(recordedAt) > 30 * 60 * 1000) return { ok: false, error: 'Too late to undo. Ask the storekeeper.' };
  sh.getRange(m.row, 9).setValue('void');
  return { ok: true, state: state_() };
}

// ---------- daily email to the owner ----------

function qtyText_(p, n) {
  const a = Math.abs(n), plural = (w, k) => (k === 1 ? w : w + (/(x|s|ch|sh)$/.test(w) ? 'es' : 's'));
  if (p.big && p.per > 1 && a >= p.per) {
    const whole = Math.floor(a / p.per), part = a - whole * p.per;
    return `${whole.toLocaleString()} ${plural(p.big, whole)}` + (part ? ` and ${part} ${plural(p.unit, part)}` : '');
  }
  return `${a.toLocaleString()} ${plural(p.unit, a)}`;
}

function dailyEmail() {
  const s = settings_();
  const to = String(s['Owner emails'] || '').trim();
  if (!to) return;
  const st = state_();
  const byName = Object.fromEntries(st.products.map(p => [p.name, p]));
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const todays = st.recent.filter(m => m.time.startsWith(today)).reverse();
  const verb = { Took: 'took', Returned: 'returned', Received: 'received', Counted: 'counted' };
  const rows = st.products.map(p => {
    const status = !p.hasOpening ? ['Opening count missing', '#92400e'] : p.balance <= p.reorder ? ['Reorder', '#b91c1c'] : ['OK', '#15803d'];
    return `<tr><td>${p.name}</td><td style="text-align:right"><b>${p.hasOpening ? qtyText_(p, p.balance) : '–'}</b></td>` +
      `<td style="color:${status[1]}">${status[0]}</td></tr>`;
  }).join('');
  const moves = todays.length ? todays.map(m => `<li>${m.time.slice(11)}: ${m.who} ${verb[m.action]} ` +
    `${qtyText_(byName[m.product] || { unit: '' }, m.action === 'Counted' ? m.change : m.qty)} ${m.action === 'Counted' ? '(difference)' : ''} of ${m.product}` +
    `${m.note ? ` (${m.note})` : ''}</li>`).join('') : '<li>No movements today.</li>';
  MailApp.sendEmail({
    to,
    subject: `${st.store} stock, ${Utilities.formatDate(new Date(), TZ, 'EEE d MMM')}`,
    htmlBody: `<div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2 style="margin:0 0 8px">${st.store}</h2>
      <h3>In the store now</h3><table cellpadding="6" style="border-collapse:collapse">${rows}</table>
      <h3>Today</h3><ul>${moves}</ul>
      <p style="color:#666">The full record is in the Google Sheet.</p></div>`,
  });
}
