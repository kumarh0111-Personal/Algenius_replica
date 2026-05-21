const path = require('path');
const fs = require('fs');

process.stdout.write('=== Bytecode Extraction Tool ===\n');
process.stdout.write('Node: ' + process.version + '\n');
process.stdout.write('V8: ' + process.versions.v8 + '\n');
process.stdout.write('Platform: ' + process.platform + '\n\n');

require('bytenode');
process.stdout.write('bytenode loaded successfully\n\n');

const jscBase = path.join(__dirname, '..', 'jsc', 'original');
const outputBase = path.join(__dirname, '..', 'extracted-source');

// Create stub dependencies so .jsc modules that require neighbors can load
function ensureStubs() {
  const stubs = {
    '../trading212/t212-client.cjs': 'module.exports = {};\n',
    '../trading212/t212-client.js': 'module.exports = {};\n',
    '../alpaca/alpaca-client.cjs': 'module.exports = {};\n',
    '../alpaca/alpaca-client.js': 'module.exports = {};\n',
    '../oanda/oanda-client.cjs': 'module.exports = {};\n',
    '../oanda/oanda-client.js': 'module.exports = {};\n',
    '../store/trade-store.cjs': 'module.exports = { getState: ()=>null, saveState: ()=>{} };\n',
    '../store/trade-store.js': 'module.exports = { getState: ()=>null, saveState: ()=>{} };\n',
    '../telegram/telegram.cjs': 'module.exports = { send: ()=>{} };\n',
    '../telegram/telegram.js': 'module.exports = { send: ()=>{} };\n',
    '../notifications/notifications.cjs': 'module.exports = { notify: ()=>{} };\n',
    '../notifications/notifications.js': 'module.exports = { notify: ()=>{} };\n',
    '../fyers/fyers-client.cjs': 'module.exports = {};\n',
    '../fyers/fyers-client.js': 'module.exports = {};\n',
  };
  // Stubs must be placed so that require() from autotrader/*.jsc resolves correctly
  // autotrader/auto-trader.jsc does require('../trading212/t212-client.cjs')
  // which resolves from jsc/original/autotrader/ -> jsc/original/trading212/t212-client.cjs
  const stubsDir = jscBase; // jsc/original/ — modules in subdirs use ../ to reach here
  for (const [relPath, content] of Object.entries(stubs)) {
    // '../trading212/t212-client.cjs' -> 'trading212/t212-client.cjs'
    const cleanPath = relPath.replace(/^\.\.\//, '');
    const fullPath = path.resolve(stubsDir, cleanPath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, content);
      process.stdout.write('  stub: ' + path.relative(stubsDir, fullPath) + '\n');
    }
  }
  process.stdout.write('Stub dependencies created\n\n');
}
ensureStubs();

// Collect all .jsc files recursively
function collectFiles(dir, results = [], prefix = '') {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, results, path.join(prefix, entry.name));
    } else if (entry.name.endsWith('.jsc')) {
      results.push({ fullPath, relPath: path.join(prefix, entry.name) });
    }
  }
  return results;
}

const files = collectFiles(jscBase);
process.stdout.write('Found ' + files.length + ' .jsc files\n\n');

// Generate test data variants
function generateCandles(count) {
  const candles = [];
  for (let i = 0; i < count; i++) {
    const base = 100 + Math.sin(i * 0.1) * 5 + Math.sin(i * 0.05) * 2;
    candles.push({
      t: 1700000000000 + i * 3600000,
      o: +(base - 0.2).toFixed(4),
      h: +(base + 1.5 + Math.random() * 1.5).toFixed(4),
      l: +(base - 1.5 - Math.random() * 1.5).toFixed(4),
      c: +(base + Math.random() * 2 - 1).toFixed(4),
      v: Math.floor(1000 + Math.random() * 500)
    });
  }
  return candles;
}

function closes(candles) { return candles.map(c => c.c); }
function highs(candles) { return candles.map(c => c.h); }
function lows(candles) { return candles.map(c => c.l); }
function hl2(candles) { return candles.map(c => (c.h + c.l) / 2); }
function ohlc4(candles) { return candles.map(c => (c.o + c.h + c.l + c.c) / 4); }

const testCandles = generateCandles(300);
const shortCandles = generateCandles(60);
const testCloses = closes(testCandles);
const shortCloses = closes(shortCandles);
const testHL2 = hl2(testCandles);
const shortHL2 = hl2(shortCandles);
const testOHLC4 = ohlc4(testCandles);

// Known indicator function patterns: try with prices arrays
function tryCallFunction(fn, name, modulePath) {
  const results = [];

  // Constants object
  if (typeof fn !== 'function') return results;

  // BacktestEngine: try with new and params
  if (name === 'BacktestEngine') {
    try {
      const instance = new fn({ capital: 10000 });
      const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(instance));
      results.push({ args: '(new {capital:10000})', instanceType: typeof instance, methods: keys });
    } catch(e) { results.push({ args: '(new)', error: e.message }); }
    try {
      const r = fn({ capital: 10000 });
      results.push({ args: '({capital:10000})', result: typeof r });
    } catch(e) { results.push({ args: '({capital:10000})', error: e.message }); }
    return results;
  }

  // AutoTrader: try with new 
  if (name === 'AutoTrader' || name === 'autoTrader') {
    try {
      const instance = new fn({});
      results.push({ args: '(new {})', instanceType: typeof instance });
    } catch(e) { results.push({ args: '(new {})', error: e.message }); }
    return results;
  }

  // determineBias — original is length=1, takes candles (spanA,spanB internally)
  if (name === 'determineBias') {
    // Maybe it takes a cloud values object
    try { results.push({ args: '(candles)', result: fn(testCandles) }); } catch(e) { results.push({ args: '(candles)', error: e.message }); }
    try { results.push({ args: '(closes)', result: fn(testCloses) }); } catch(e) { results.push({ args: '(closes)', error: e.message }); }
    try { results.push({ args: '({spanA: 0.5, spanB: 0.3})', result: fn({spanA: 0.5, spanB: 0.3}) }); } catch(e) { results.push({ args: '({spanA,spanB})', error: e.message }); }
    return results;
  }

  // getCloudValues
  if (name === 'getCloudValues') {
    try {
      const r = fn(testCandles);
      const info = { resultType: typeof r };
      if (r) {
        if (Array.isArray(r)) info.arrayLength = r.length;
        else info.keys = Object.keys(r);
        info.sample = JSON.stringify(r[0] || r).slice(0, 200);
      }
      results.push({ args: '(candles[300])', ...info });
    } catch(e) { results.push({ args: '(candles[300])', error: e.message }); }
    try {
      const r = fn(testCloses);
      const info = { resultType: typeof r };
      if (r) {
        if (Array.isArray(r)) info.arrayLength = r.length;
        else info.keys = Object.keys(r);
        info.sample = JSON.stringify(r[0] || r).slice(0, 200);
      }
      results.push({ args: '(closes[300])', ...info });
    } catch(e) { results.push({ args: '(closes[300])', error: e.message }); }
    return results;
  }

  // calcSMA, calcEMA, calcWMA, calcATR — need (closes, period)
  if (/^calc(SMA|EMA|WMA|ATR)$/.test(name)) {
    try { results.push({ args: '(closes, 14)', result: fn(testCloses, 14) }); } catch(e) { results.push({ args: '(closes, 14)', error: e.message }); }
    try { results.push({ args: '(closes, 20)', result: fn(testCloses, 20) }); } catch(e) { results.push({ args: '(closes, 20)', error: e.message }); }
    try { results.push({ args: '(candles, 14)', result: fn(testCandles, 14) }); } catch(e) { results.push({ args: '(candles, 14)', error: e.message }); }
    return results;
  }

  // calcRSI — takes (closes, period?) — length=1 in original
  if (name === 'calcRSI') {
    try { results.push({ args: '(closes)', result: fn(testCloses) }); } catch(e) { results.push({ args: '(closes)', error: e.message }); }
    try { results.push({ args: '(closes, 14)', result: fn(testCloses, 14) }); } catch(e) { results.push({ args: '(closes, 14)', error: e.message }); }
    try { results.push({ args: '(candles)', result: fn(testCandles) }); } catch(e) { results.push({ args: '(candles)', error: e.message }); }
    return results;
  }

  // calcSMASeries, calcEMASeries, calcWMASeries, calcATRSeries — (closes, period)
  if (/^calc(SMA|EMA|WMA|ATR)Series$/.test(name)) {
    try { results.push({ args: '(closes, 14)', result: fn(testCloses, 14).slice(0, 5) + '...' }); } catch(e) { results.push({ args: '(closes, 14)', error: e.message }); }
    try { results.push({ args: '(closes, 20)', result: fn(testCloses, 20).slice(0, 5) + '...' }); } catch(e) { results.push({ args: '(closes, 20)', error: e.message }); }
    return results;
  }

  // calcDonchian, calcPrevDonchian — (closes, period) or (highs, lows, period)
  if (/^calc(Prev)?Donchian$/.test(name)) {
    try { results.push({ args: '(closes, 20)', result: fn(testCloses, 20) }); } catch(e) { results.push({ args: '(closes, 20)', error: e.message }); }
    try { results.push({ args: '(highs, lows, 20)', result: fn(highs(testCandles), lows(testCandles), 20) }); } catch(e) { results.push({ args: '(highs, lows, 20)', error: e.message }); }
    try { results.push({ args: '(candles, 20)', result: fn(testCandles, 20) }); } catch(e) { results.push({ args: '(candles, 20)', error: e.message }); }
    return results;
  }

  // calcBollingerBands — (closes, period, stddev)
  if (name === 'calcBollingerBands') {
    try { results.push({ args: '(closes, 20, 2)', result: fn(testCloses, 20, 2) }); } catch(e) { results.push({ args: '(closes, 20, 2)', error: e.message }); }
    try { results.push({ args: '(candles, 20, 2)', result: fn(testCandles, 20, 2) }); } catch(e) { results.push({ args: '(candles, 20, 2)', error: e.message }); }
    return results;
  }

  // calcSupertrend — (candles, atrPeriod, multiplier)
  if (name === 'calcSupertrend') {
    try { results.push({ args: '(candles, 10, 3)', result: fn(testCandles, 10, 3) }); } catch(e) { results.push({ args: '(candles, 10, 3)', error: e.message }); }
    try { results.push({ args: '(closes, 10, 3)', result: fn(testCloses, 10, 3) }); } catch(e) { results.push({ args: '(closes, 10, 3)', error: e.message }); }
    try { results.push({ args: '(hl2, 10, 3)', result: fn(testHL2, 10, 3) }); } catch(e) { results.push({ args: '(hl2, 10, 3)', error: e.message }); }
    try { results.push({ args: '(candles)', result: fn(testCandles) }); } catch(e) { results.push({ args: '(candles)', error: e.message }); }
    return results;
  }

  // calcSupertrendSeries — (candles, atrPeriod, multiplier)
  if (name === 'calcSupertrendSeries') {
    try { const r = fn(testCandles, 10, 3); results.push({ args: '(candles, 10, 3)', sample: JSON.stringify(r[300]) }); } catch(e) { results.push({ args: '(candles, 10, 3)', error: e.message }); }
    try { const r = fn(testCloses, 10, 3); results.push({ args: '(closes, 10, 3)', sample: JSON.stringify(r[300]) }); } catch(e) { results.push({ args: '(closes, 10, 3)', error: e.message }); }
    return results;
  }

  // detectSwingPoints — (closes, window) or (candles, window)
  if (name === 'detectSwingPoints') {
    try { results.push({ args: '(closes, 5)', result: fn(testCloses, 5).slice(0, 5) }); } catch(e) { results.push({ args: '(closes, 5)', error: e.message }); }
    try { results.push({ args: '(candles, 5)', result: fn(testCandles, 5).slice(0, 5) }); } catch(e) { results.push({ args: '(candles, 5)', error: e.message }); }
    try { results.push({ args: '(hl2, 5)', result: fn(testHL2, 5).slice(0, 5) }); } catch(e) { results.push({ args: '(hl2, 5)', error: e.message }); }
    try { results.push({ args: '(candles)', result: fn(testCandles).slice(0, 5) }); } catch(e) { results.push({ args: '(candles)', error: e.message }); }
    return results;
  }

  // computePivotMatrix, computeWavePivotScanner — (candles, params?)
  if (/^compute|^scan|^get[A-Z]/.test(name)) {
    const variants = [
      { args: '(candles[300])', call: () => fn(testCandles) },
      { args: '(candles[300], {})', call: () => fn(testCandles, {}) },
      { args: '(closes[300])', call: () => fn(testCloses) },
      { args: '(hl2[300])', call: () => fn(testHL2) },
      { args: '(ohlc4[300])', call: () => fn(testOHLC4) },
    ];
    for (const v of variants) {
      try { results.push({ args: v.args, result: v.call() }); } catch(e) { results.push({ args: v.args, error: e.message }); }
    }
    return results;
  }

  // computeEdgeData — (candles, params)
  if (name === 'computeEdgeData') {
    const variants = [
      { args: '(candles[300], {})', call: () => fn(testCandles, {}) },
      { args: '(closes[300], {})', call: () => fn(testCloses, {}) },
      { args: '([], {capital:10000})', call: () => fn([], {capital:10000}) },
    ];
    for (const v of variants) {
      try { results.push({ args: v.args, result: v.call() }); } catch(e) { results.push({ args: v.args, error: e.message }); }
    }
    return results;
  }

  // Generic: try with closes, candles, hl2
  const genericVariants = [
    { args: '(closes)', call: () => fn(testCloses) },
    { args: '(candles)', call: () => fn(testCandles) },
    { args: '(hl2)', call: () => fn(testHL2) },
  ];
  let anySuccess = false;
  for (const v of genericVariants) {
    try { results.push({ args: v.args, result: v.call() }); anySuccess = true; break; } catch(e) { /* continue */ }
  }
  if (!anySuccess) {
    try { results.push({ args: '()', result: fn() }); } catch(e) { results.push({ args: '()', error: e.message }); }
  }
  return results;
}

// Process each file
let successCount = 0;
let failCount = 0;

for (const { fullPath, relPath } of files) {
  const name = relPath.replace(/\.jsc$/, '');
  const outDir = path.join(outputBase, path.dirname(name));
  fs.mkdirSync(outDir, { recursive: true });

  process.stdout.write('[' + (successCount + failCount + 1) + '/' + files.length + '] ' + name + '... ');

  try {
    const mod = require(fullPath);
    const data = { file: relPath, exports: [] };

    for (const key of Object.keys(mod)) {
      const val = mod[key];
      const entry = { name: key, type: typeof val };

      if (typeof val === 'function') {
        entry.length = val.length;
        const callResults = tryCallFunction(val, key, relPath);
        if (callResults.length > 0) entry.calls = callResults;

        try {
          const src = val.toString();
          entry.sourceLength = src.length;
          entry.sourcePreview = src.slice(0, 300) + (src.length > 300 ? '...' : '');
        } catch(e) {
          entry.toStringError = e.message;
        }
      } else {
        entry.value = val;
      }

      data.exports.push(entry);
    }

    const outFile = path.join(outputBase, name + '.json');
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
    process.stdout.write('OK (' + data.exports.length + ' exports)\n');
    successCount++;
  } catch(e) {
    const errFile = path.join(outputBase, name + '.error');
    fs.writeFileSync(errFile, e.message + '\n' + (e.stack || ''));
    process.stdout.write('FAILED: ' + e.message.slice(0, 80) + '\n');
    failCount++;
  }
}

process.stdout.write('\n=== Summary: ' + successCount + ' succeeded, ' + failCount + ' failed ===\n');

// Cleanup stubs
process.stdout.write('\nCleaning up stub dependencies...\n');
// (optional)
process.stdout.write('Done.\n');
