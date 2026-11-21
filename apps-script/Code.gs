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
 *
 * Actions in the Moves tab:
 *   Sold      sold straight from the store and paid now        store −qty, money in
 *   Took      taken out to sell (or for a job), paid later       store −qty, the person holds it
 *   Paid      money handed in for stock the person was holding   store unchanged, holding −qty (qty may be 0)
 *   Returned  unsold stock brought back                          store +qty, holding −qty
 *   Received  new delivery                                       store +qty
 *   Counted   stock count                                        store set to the count
 * A "Took" row with money on it (older records) counts as a sale.
 */

const TZ = 'Africa/Nairobi';
const ACTIONS = ['Sold', 'Took', 'Paid', 'Returned', 'Received', 'Counted'];
const MOVE_HEADERS = ['ID', 'Time', 'Who', 'Product', 'Action', 'Quantity', 'Change', 'Job / note', 'Status', 'Recorded at', 'Money in (KES)'];
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
    ['Store name', 'My Store', 'Shown at the top of the page'],
    ['Store key', Utilities.getUuid().replace(/-/g, '').slice(0, 10), 'Secret in the QR link. Change it to lock out old links.'],
    ['Owner emails', '', 'Comma-separated. They get a summary every evening.'],
    ['Daily email hour', 18, '24h clock, Nairobi time'],
    ['Web app URL', '', 'Paste after Deploy → Web app'],
    ['Store link', '', 'Filled in automatically: print this as the QR code'],
  ]);
  const prod = sheet('Products',
    ['Product', 'Small unit', 'Big unit', 'Small per big', 'Opening stock (small units)', 'Reorder at (small units)', 'Price per small unit', 'Active'], [
    ['Example product', 'packet', 'box', 4, '', '', '', 'yes'],
    ['Another product', 'tin', 'carton', 12, '', '', '', 'yes'],
  ]);
  prod.getRange('A2:G3').setBackground('#fff4c2');
  prod.getRange('A1').setNote('Yellow cells: replace the examples with your products, packing, opening count and prices. ' +
    'Leave "Big unit" empty if it is only handled singly. A product appears on the phone page once its opening stock is filled in. ' +
    'Set Active to "no" to hide it.');
  sheet('People', ['Name', 'Active'], [['Your name', 'yes']]);
  sheet('Moves', MOVE_HEADERS, []);
  updateTriggers();
  updateStoreLink_();
}

/** Run this once after pasting a new version of this file (it is safe to run again). */
function updateTriggers() {
  ensureMoveColumns_();
  buildSummary_();
  writePeople_(state_());
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyEmail').timeBased().everyDays(1).atHour(Number(settings_()['Daily email hour']) || 18).inTimezone(TZ).create();
  ScriptApp.newTrigger('weeklyEmail').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone(TZ).create();
  ScriptApp.newTrigger('onSettingsEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
}

/** Adds or renames columns introduced after a sheet was first set up. Safe to run again. */
function ensureMoveColumns_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Moves');
  if (!sh) return;
  const n = MOVE_HEADERS.length;
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  const head = sh.getRange(1, 1, 1, n);
  if (head.getValues()[0][n - 1] !== MOVE_HEADERS[n - 1]) {
    head.setValues([MOVE_HEADERS]).setFontWeight('bold').setBackground('#f1efe8');
    sh.getRange(2, n, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('#,##0');
  }
}

/** Summary tab: stock per product (formulas, columns A–G) and who is holding stock (values, columns I–N). */
function buildSummary_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Summary');
  if (!sh) sh = ss.insertSheet('Summary', 0);
  sh.clear();
  const h = ['Product', 'In store (small units)', 'In store', 'Sold so far', 'Money in (KES)', 'Stock value (KES)', 'Status'];
  sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#f1efe8');
  sh.setFrozenRows(1);
  const live = '"<>void"';
  const f = [];
  for (let r = 2; r <= 30; r++) {
    const P = `Products!A${r}`;
    const show = `AND(${P}<>"",Products!E${r}<>"",LOWER(Products!H${r})<>"no")`;
    const bal = `(N(Products!E${r})+SUMIFS(Moves!G:G,Moves!D:D,${P},Moves!I:I,${live}))`;
    const sold = `(SUMIFS(Moves!F:F,Moves!D:D,${P},Moves!E:E,"Sold",Moves!I:I,${live})` +
      `+SUMIFS(Moves!F:F,Moves!D:D,${P},Moves!E:E,"Paid",Moves!I:I,${live})` +
      `+SUMIFS(Moves!F:F,Moves!D:D,${P},Moves!E:E,"Took",Moves!K:K,"<>",Moves!I:I,${live}))`;
    const words = x => `IF(N(Products!D${r})>1,INT(${x}/Products!D${r})&" "&Products!C${r}&IF(MOD(${x},Products!D${r})>0," + "&MOD(${x},Products!D${r})&" "&Products!B${r},""),${x}&" "&Products!B${r})`;
    f.push([
      `=IF(${show},${P},"")`,
      `=IF(${show},${bal},"")`,
      `=IF(${show},${words(bal)},"")`,
      `=IF(${show},${words(sold)},"")`,
      `=IF(${show},SUMIFS(Moves!K:K,Moves!D:D,${P},Moves!I:I,${live}),"")`,
      `=IF(${show},${bal}*N(Products!G${r}),"")`,
      `=IF(${show},IF(${bal}<=N(Products!F${r}),"Reorder","OK"),"")`,
    ]);
  }
  sh.getRange(2, 1, f.length, h.length).setFormulas(f);
  sh.getRange('E2:F30').setNumberFormat('#,##0');
  sh.autoResizeColumns(1, h.length);
}

/** Rewrites the "With people" table on the Summary tab. */
function writePeople_(st) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Summary');
  if (!sh) return;
  const byName = Object.fromEntries(st.products.map(p => [p.name, p]));
  const h = ['With people', 'Product', 'Holding now', 'Taken to sell', 'Sold (handed in)', 'Brought back', 'Money handed in (KES)'];
  sh.getRange(1, 9, 200, h.length).clearContent();
  sh.getRange(1, 9, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#f1efe8');
  const rows = st.holdings.map(g => {
    const p = byName[g.product] || { unit: '' };
    return [g.who, g.product, g.holding ? qtyText_(p, g.holding) : 'nothing', qtyText_(p, g.took), qtyText_(p, g.sold), qtyText_(p, g.returned), g.money];
  });
  if (rows.length) sh.getRange(2, 9, rows.length, h.length).setValues(rows);
  sh.getRange(2, 15, 199, 1).setNumberFormat('#,##0');
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

/** Active products. Products without an opening count are kept for checks but hidden from the page and emails. */
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
    amount: r[10] === '' || r[10] == null ? null : Number(r[10]),
  }));
}

const isSale_ = m => m.action === 'Sold' || m.action === 'Paid' || (m.action === 'Took' && m.amount != null);

function balances_(products, moves) {
  const bal = {}, sold = {}, money = {};
  products.forEach(p => { bal[p.name] = p.opening; sold[p.name] = 0; money[p.name] = 0; });
  moves.forEach(m => {
    if (m.status === 'void' || !(m.product in bal)) return;
    bal[m.product] += m.change;
    if (isSale_(m)) sold[m.product] += m.qty;
    money[m.product] += m.amount || 0;
  });
  return { bal, sold, money };
}

/** Stock each person has taken out to sell, and what they have settled. */
function holdings_(moves) {
  const h = {};
  moves.forEach(m => {
    if (m.status === 'void') return;
    const k = m.who + '|' + m.product;
    const g = h[k] || (h[k] = { who: m.who, product: m.product, took: 0, sold: 0, returned: 0, money: 0 });
    if (m.action === 'Took' && m.amount == null) g.took += m.qty;
    else if (m.action === 'Paid') { g.sold += m.qty; g.money += m.amount || 0; }
    else if (m.action === 'Returned') g.returned += m.qty;
  });
  return Object.values(h).filter(g => g.took > 0)
    .map(g => Object.assign(g, { holding: Math.max(0, g.took - g.sold - g.returned) }));
}

function state_() {
  const s = settings_(), all = products_(), moves = moves_();
  const products = all.filter(p => p.hasOpening);
  const shown = new Set(products.map(p => p.name));
  const { bal, sold, money } = balances_(products, moves);
  const fmt = d => Utilities.formatDate(new Date(d), TZ, "yyyy-MM-dd'T'HH:mm");
  return {
    store: s['Store name'] || 'Store',
    people: people_(),
    products: products.map(p => Object.assign(p, { balance: bal[p.name], sold: sold[p.name], money: money[p.name] })),
    holdings: holdings_(moves).filter(g => shown.has(g.product)),
    recent: moves.filter(m => m.status !== 'void' && shown.has(m.product)).slice(-40).reverse()
      .map(m => ({ id: m.id, time: fmt(m.time), who: m.who, product: m.product, action: m.action, qty: m.qty, change: m.change, note: m.note, amount: m.amount })),
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
  const amount = p.amount === '' || p.amount == null ? null : Number(p.amount);
  if (!prod) return { ok: false, error: 'Unknown product' };
  if (!people_().includes(p.who)) return { ok: false, error: 'Unknown name' };
  if (!ACTIONS.includes(p.action)) return { ok: false, error: 'Unknown action' };
  const zeroOk = p.action === 'Counted' || p.action === 'Paid';
  if (!(qty >= 0) || (qty === 0 && !zeroOk) || qty > 100000) return { ok: false, error: 'Check the amount' };
  if (amount !== null && (!(amount >= 0) || amount > 1e8 || !['Sold', 'Paid', 'Took'].includes(p.action))) return { ok: false, error: 'Check the money' };
  if ((p.action === 'Sold' || p.action === 'Paid') && !(amount > 0)) return { ok: false, error: 'Enter the money received' };
  // Offline phones resend the same record; the client-made ID makes that harmless.
  if (p.id && moves.some(m => m.id === String(p.id))) return { ok: true, duplicate: true, state: state_() };

  const { bal } = balances_(products, moves);
  const change = { Sold: -qty, Took: -qty, Paid: 0, Returned: qty, Received: qty, Counted: qty - bal[prod.name] }[p.action];
  let when = new Date(p.time);
  const now = new Date();
  if (isNaN(when) || when > now || now - when > 7 * 864e5) when = now;
  const id = String(p.id || Utilities.getUuid().slice(0, 8)).slice(0, 20);
  ensureMoveColumns_();
  SpreadsheetApp.getActive().getSheetByName('Moves').appendRow(
    [id, when, p.who, prod.name, p.action, qty, change, String(p.note || '').slice(0, 120), '', now, amount === null ? '' : amount]);
  const st = state_();
  writePeople_(st);
  return { ok: true, id, state: st };
}

function undo_(p) {
  const m = moves_().find(x => x.id === String(p.id));
  if (!m) return { ok: false, error: 'Not found' };
  if (m.who !== p.who) return { ok: false, error: 'Only the same person can undo' };
  const sh = SpreadsheetApp.getActive().getSheetByName('Moves');
  const recordedAt = sh.getRange(m.row, 10).getValue();
  if (new Date() - new Date(recordedAt) > 30 * 60 * 1000) return { ok: false, error: 'Too late to undo. Ask the storekeeper.' };
  sh.getRange(m.row, 9).setValue('void');
  const st = state_();
  writePeople_(st);
  return { ok: true, state: st };
}

// ---------- emails to the owner ----------

function qtyText_(p, n) {
  const a = Math.abs(n), plural = (w, k) => (k === 1 ? w : w + (/(x|s|ch|sh)$/.test(w) ? 'es' : 's'));
  if (a === 0 && p.big && p.per > 1) return `0 ${plural(p.big, 0)}`;
  if (p.big && p.per > 1 && a >= p.per) {
    const whole = Math.floor(a / p.per), part = a - whole * p.per;
    return `${whole.toLocaleString()} ${plural(p.big, whole)}` + (part ? ` and ${part} ${plural(p.unit, part)}` : '');
  }
  return `${a.toLocaleString()} ${plural(p.unit, a)}`;
}

const kes_ = n => `KES ${Math.round(n).toLocaleString()}`;

function stockRows_(st) {
  return st.products.map(p => {
    const status = p.balance <= p.reorder ? ['Reorder', '#b91c1c'] : ['OK', '#15803d'];
    return `<tr><td>${p.name}</td><td style="text-align:right"><b>${qtyText_(p, p.balance)}</b></td>` +
      `<td style="color:${status[1]}">${status[0]}</td></tr>`;
  }).join('');
}

function peopleBlock_(st) {
  const byName = Object.fromEntries(st.products.map(p => [p.name, p]));
  const out = st.holdings.filter(g => g.holding > 0);
  if (!out.length) return '<h3>With people</h3><p>Nobody is holding stock.</p>';
  return '<h3>With people (taken to sell, not yet settled)</h3><ul>' + out.map(g =>
    `<li><b>${g.who}</b> is holding ${qtyText_(byName[g.product], g.holding)} of ${g.product}` +
    ` (handed in so far: ${kes_(g.money)})</li>`).join('') + '</ul>';
}

function moveLine_(m, byName) {
  const p = byName[m.product] || { unit: '' };
  const q = qtyText_(p, m.action === 'Counted' ? m.change : m.qty);
  const money = m.amount != null ? kes_(m.amount) : '';
  const what = {
    Sold: `sold ${q} of ${m.product} for ${money}`,
    Took: `took ${q} of ${m.product}` + (money ? ` and paid ${money}` : ' to sell'),
    Paid: `handed in ${money}` + (m.qty ? ` for ${q} sold` : ''),
    Returned: `brought back ${q} of ${m.product}`,
    Received: `received ${q} of ${m.product}`,
    Counted: `counted ${m.product}: ${m.change >= 0 ? '+' : '−'}${q} difference`,
  }[m.action] || `${m.action} ${q}`;
  return `<li>${m.time.slice(5, 10).split('-').reverse().join('/')} ${m.time.slice(11)}: ${m.who} ${what}${m.note ? ` (${m.note})` : ''}</li>`;
}

function moneyLine_(list) {
  const total = list.reduce((t, m) => t + (m.amount || 0), 0);
  return total ? `<p style="font-size:18px">Money in: <b>${kes_(total)}</b></p>` : '';
}

function send_(subject, body) {
  const to = String(settings_()['Owner emails'] || '').trim();
  if (!to) return;
  MailApp.sendEmail({ to, subject, htmlBody: `<div style="font-family:system-ui,sans-serif;max-width:560px">${body}` +
    `<p style="color:#666">The full record is in the Google Sheet.</p></div>` });
}

/** Evening email: only on days when stock moved or money came in. */
function dailyEmail() {
  const st = state_();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const todays = st.recent.filter(m => m.time.startsWith(today)).reverse();
  if (!todays.length) return;
  const byName = Object.fromEntries(st.products.map(p => [p.name, p]));
  send_(`${st.store}: ${todays.length} record${todays.length > 1 ? 's' : ''} today`,
    `<h2 style="margin:0 0 8px">${st.store}</h2>${moneyLine_(todays)}<h3>Today</h3><ul>${todays.map(m => moveLine_(m, byName)).join('')}</ul>` +
    `<h3>In the store now</h3><table cellpadding="6" style="border-collapse:collapse">${stockRows_(st)}</table>` + peopleBlock_(st));
}

/** Monday morning: the week in one email. */
function weeklyEmail() {
  const st = state_();
  const byName = Object.fromEntries(st.products.map(p => [p.name, p]));
  const weekAgo = Utilities.formatDate(new Date(Date.now() - 7 * 864e5), TZ, "yyyy-MM-dd'T'HH:mm");
  const fmt = d => Utilities.formatDate(new Date(d), TZ, "yyyy-MM-dd'T'HH:mm");
  const all = moves_().filter(m => m.status !== 'void' && byName[m.product]);
  const week = all.filter(m => fmt(m.time) >= weekAgo).map(m => Object.assign({}, m, { time: fmt(m.time) }));
  const value = st.products.reduce((t, p) => t + Math.max(0, p.balance) * p.price, 0);
  const pace = st.products.map(p => {
    const last = all.filter(m => m.product === p.name && isSale_(m)).pop();
    const days = last ? Math.floor((Date.now() - new Date(last.time)) / 864e5) : null;
    return `<li>${p.name}: sold so far ${qtyText_(p, p.sold)} for ${kes_(p.money)} · ` +
      `${days === null ? 'no sales yet' : days === 0 ? 'last sale today' : `last sale ${days} day${days > 1 ? 's' : ''} ago`}</li>`;
  }).join('');
  const noPrice = st.products.filter(p => !p.price).map(p => p.name);
  send_(`${st.store}: weekly report`,
    `<h2 style="margin:0 0 8px">${st.store}: this week</h2>` + moneyLine_(week) +
    `<p>Stock value in the store: <b>${kes_(value)}</b></p>` +
    `<h3>In the store now</h3><table cellpadding="6" style="border-collapse:collapse">${stockRows_(st)}</table>` +
    peopleBlock_(st) +
    `<h3>Sales</h3><ul>${pace}</ul>` +
    `<h3>Records in the last 7 days (${week.length})</h3><ul>${week.length ? week.map(m => moveLine_(m, byName)).join('') : '<li>None.</li>'}</ul>` +
    (noPrice.length ? `<p style="color:#92400e">Price missing for: ${noPrice.join(', ')}.</p>` : ''));
}
