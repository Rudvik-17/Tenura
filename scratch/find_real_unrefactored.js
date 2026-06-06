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

    if (content.includes('StyleSheet.create') && !content.includes('getStyles')) {
      // Check if it uses the word colors
      if (content.includes('colors.')) {
        console.log(`[REAL UNREFACTORED FILE] ${relative}`);
      }
    }
  });
  console.log('Unrefactored file check complete.');
});
