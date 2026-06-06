const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '../src');

function walk(dir, filter, done) {
  let results = [];
  fs.readdir(dir, (err, list) => {
    if (err) return done(err);
    let pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(file => {
      file = path.resolve(dir, file);
      fs.stat(file, (err, stat) => {
        if (stat && stat.isDirectory()) {
          walk(file, filter, (err, res) => {
            results = results.concat(res);
            if (!--pending) done(null, results);
          });
        } else {
          if (!filter || filter(file)) {
            results.push(file);
          }
          if (!--pending) done(null, results);
        }
      });
    });
  });
}

walk(SRC_DIR, (file) => file.endsWith('.js'), (err, files) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const relative = path.relative(SRC_DIR, file);

    // Scan lines
    const lines = content.split('\n');
    let insideFunction = 0; // nesting level of curly braces inside functions

    lines.forEach((line, idx) => {
      // Very simple brace counter
      if (line.includes('function ') || line.includes('=> {')) {
        insideFunction++;
      }
      
      // If we see "colors." at the top level (insideFunction === 0)
      if (insideFunction === 0 && line.includes('colors.')) {
        console.log(`[TOP-LEVEL REF] ${relative}:${idx + 1}: ${line.trim()}`);
      }

      if (line.includes('}') && insideFunction > 0) {
        // Simple decrement on closing brace (rough estimate)
        if (!line.includes('{') || line.indexOf('}') > line.indexOf('{')) {
          insideFunction--;
        }
      }
    });
  });
});
