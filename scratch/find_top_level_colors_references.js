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

    // Skip colors.js and ThemeContext.js
    if (relative === 'theme/colors.js' || relative === 'context/ThemeContext.js') {
      return;
    }

    // Check if colors. is referenced in the file
    if (content.includes('colors.')) {
      // Find where "colors" is imported or declared
      const hasImport = content.includes("import { colors }") || content.includes("import colors");
      
      // If it doesn't import colors, let's find any occurrences of colors. that are outside function scopes
      if (!hasImport) {
        const lines = content.split('\n');
        let insideFunction = 0;
        
        lines.forEach((line, idx) => {
          if (line.includes('function ') || line.includes('=> {') || line.includes('=> (')) {
            insideFunction++;
          }
          
          if (insideFunction === 0 && line.includes('colors.')) {
            console.log(`[SUSPECT TOP-LEVEL COLOR REF] ${relative}:${idx + 1}: ${line.trim()}`);
          }
          
          if (line.includes('}') && insideFunction > 0) {
            if (!line.includes('{') || line.indexOf('}') > line.indexOf('{')) {
              insideFunction--;
            }
          }
        });
      }
    }
  });
  console.log('Top-level color reference scan complete.');
});
