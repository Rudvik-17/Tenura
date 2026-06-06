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

    // If file still contains "StyleSheet.create"
    if (content.includes('StyleSheet.create')) {
      // Find the block starting with StyleSheet.create and see if it uses "colors"
      const lines = content.split('\n');
      let insideStyleSheet = false;
      let lineNum = 0;

      lines.forEach((line, idx) => {
        if (line.includes('StyleSheet.create')) {
          insideStyleSheet = true;
          lineNum = idx + 1;
        }

        if (insideStyleSheet) {
          if (line.includes('colors.')) {
            console.log(`[UNREFACTORED STYLE] ${relative}:${idx + 1}: ${line.trim()} (in StyleSheet.create at line ${lineNum})`);
          }
          if (line.includes('});')) {
            insideStyleSheet = false;
          }
        }
      });
    }
  });
  console.log('Unrefactored stylesheet scan complete.');
});
