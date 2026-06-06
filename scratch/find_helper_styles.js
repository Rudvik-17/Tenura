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
    if (relative.includes('colors.js') || relative.includes('ThemeContext.js')) {
      return;
    }

    // Split content by default export to separate main component from helpers
    const parts = content.split(/export\s+default\s+function/);
    if (parts.length > 1) {
      const helperPart = parts[1];
      // Find any function definitions inside the helper part
      const functionRegex = /function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{([^}]+)\}/g;
      let match;
      while ((match = functionRegex.exec(helperPart)) !== null) {
        const funcName = match[1];
        const funcBody = match[2];
        if (funcBody.includes('styles.')) {
          // Verify if it destructures or declares styles inside it
          if (!funcBody.includes('const styles') && !funcBody.includes('let styles')) {
            console.log(`[HELPER STYLE ISSUE] ${relative}: helper function '${funcName}' references 'styles.' but doesn't define it!`);
          }
        }
      }
    }
  });
  console.log('Helper component scan complete.');
});
