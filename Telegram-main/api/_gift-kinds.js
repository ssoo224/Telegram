/* api/_gift-kinds.js — يقرأ أنواع الهدايا وأوزان الندرة من نفس ملفات الموقع (gifts/*.js + manifest.json)
   حتى يبقى الخادم والتطبيق متطابقين بدون نسخ يدوي. */
const vm = require('vm');
let cache = { t: 0, v: null };

async function getText(origin, path, optional) {
  const r = await fetch(origin + path, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) { if (optional) return null; throw new Error('fetch ' + path + ' ' + r.status); }
  return r.text();
}
const clone = x => JSON.parse(JSON.stringify(x));
function evalIn(code, expr) {
  const ctx = vm.createContext({ document: { currentScript: { src: '' } } });
  return clone(vm.runInContext(code + '\n;(' + expr + ')', ctx, { timeout: 2000 }));
}
function parseKinds(modelsJs, catJs, giftsJs, manifest) {
  const pepeP = evalIn(modelsJs, 'PEPE_MODELS.map(x=>x.p)');
  const catP = evalIn(catJs, 'CAT_MODELS.map(x=>x.p)');
  const m = /const PEPE_BGS=\[[\s\S]*?\];\s*const PEPE_SYMS=\[[\s\S]*?\n\];/.exec(giftsJs);
  if (!m) throw new Error('bgs/syms not found');
  const bs = evalIn(m[0], '({bgs:PEPE_BGS.map(x=>x.p),syms:PEPE_SYMS.map(x=>x.p)})');
  const kinds = {
    pepe: { key: 'pepe', name: 'Plush Pepe', coll: 'pepes', sales: 'pepeSales', gen: false, max: 30, price: 1000, models: pepeP },
    cat: { key: 'cat', name: 'Scared Cat', coll: 'cats', sales: 'catSales', gen: false, max: 30, price: 500, models: catP }
  };
  ((manifest && manifest.gifts) || []).forEach(g => {
    const key = String(g.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!key || kinds[key] || /^plush pepe$|^scared cat$/i.test(g.name) || !g.models || !g.models.length) return;
    const names = g.models.filter(n => n !== 'Original');
    if (!names.length) return;
    kinds[key] = { key, name: g.name, coll: 'gifts', sales: 'giftSales', gen: true, max: g.max || 30, price: g.price || 500, models: names.map(() => 1) };
  });
  return { kinds, bgs: bs.bgs, syms: bs.syms };
}
async function loadKinds(origin) {
  if (cache.v && Date.now() - cache.t < 300000) return cache.v;
  const [m, c, g] = await Promise.all([getText(origin, '/gifts/models.js'), getText(origin, '/gifts/cat-models.js'), getText(origin, '/gifts/gifts.js')]);
  let manifest = null;
  for (const p of ['/gifts/manifest.json', '/manifest.json']) {
    try { const t = await getText(origin, p, true); if (t) { manifest = JSON.parse(t); if (manifest && manifest.gifts) break; } } catch (e) {}
  }
  cache = { t: Date.now(), v: parseKinds(m, c, g, manifest) };
  return cache.v;
}
module.exports = { loadKinds, parseKinds };
