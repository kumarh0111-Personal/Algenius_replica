const path = require('path');
const fs = require('fs');

process.stdout.write('=== Bytecode Extraction Tool ===\n');
process.stdout.write('Node: ' + process.version + '\n');
process.stdout.write('V8: ' + process.versions.v8 + '\n');
process.stdout.write('Platform: ' + process.platform + '\n\n');

// Load bytenode
try {
  require('bytenode');
  process.stdout.write('bytenode loaded successfully\n\n');
} catch(e) {
  process.stdout.write('Failed to load bytenode: ' + e.message + '\n');
  process.exit(1);
}

const jscBase = path.join(__dirname, '..', 'jsc', 'original');
const outputBase = path.join(__dirname, '..', 'extracted-source');

process.stdout.write('JSC base: ' + jscBase + '\n');
process.stdout.write('Output: ' + outputBase + '\n\n');

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

// Generate test candles
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

const testCandles = generateCandles(300);
const shortCandles = generateCandles(60);

// Guess function signatures and try calling them
function tryCallFunction(fn, name, modulePath) {
  const results = [];

  // determineBias likely takes spanA, spanB as numbers
  if (name === 'determineBias') {
    try { results.push({ args: '(0.5, 0.3)', result: fn(0.5, 0.3) }); } catch(e) { results.push({ args: '(0.5, 0.3)', error: e.message }); }
    try { results.push({ args: '(0.3, 0.5)', result: fn(0.3, 0.5) }); } catch(e) { results.push({ args: '(0.3, 0.5)', error: e.message }); }
    return results;
  }

  // getCloudValues likely takes candles array
  if (name === 'getCloudValues') {
    try {
      const r = fn(testCandles);
      results.push({ args: '(candles[300])', resultType: typeof r, keys: r ? Object.keys(r) : null });
    } catch(e) { results.push({ args: '(candles[300])', error: e.message }); }
    return results;
  }

  // CLOUD_PERIOD, DONCHIAN_PERIOD etc are constants
  // (handled by the main loop)

  // Strategy functions: computeXxxSignal(candles, params?)
  if (name.startsWith('compute') || name.startsWith('get')) {
    const variants = [
      { args: '(candles[300])', call: () => fn(testCandles) },
      { args: '(candles[300], {})', call: () => fn(testCandles, {}) },
      { args: '(candles[60], {})', call: () => fn(shortCandles, {}) },
    ];
    for (const v of variants) {
      try { results.push({ args: v.args, result: v.call() }); } catch(e) { results.push({ args: v.args, error: e.message }); }
    }
    return results;
  }

  // Generic: try with candles
  try { results.push({ args: '(candles)', result: fn(testCandles) }); } catch(e) {
    try { results.push({ args: '()', result: fn() }); } catch(e2) { results.push({ args: '()', error: e2.message }); }
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

        // Try to stringify the function
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
