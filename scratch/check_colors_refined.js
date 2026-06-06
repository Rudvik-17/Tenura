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

    // Skip colors.js, ThemeContext.js, and index.js theme file
    if (relative === 'theme/colors.js' || relative === 'context/ThemeContext.js' || relative === 'theme/index.js') {
      return;
    }

    // Check if the word "colors" is used in the file
    const colorsRegex = /\bcolors\b/g;
    if (colorsRegex.test(content)) {
      // Check for proper import or destructuring
      const hasDirectImport = content.includes("import { colors }") || content.includes("import colors");
      const hasUseTheme = content.includes("useTheme()") || content.includes("useTheme (") || content.includes("const { colors");
      const isDeclaringColors = content.includes("const colors =") || content.includes("let colors =") || content.includes("var colors =") || content.includes("colors = {");

      if (!hasDirectImport && !hasUseTheme && !isDeclaringColors) {
        console.log(`[VERIFIED PROBLEM] ${relative}`);
      }
    }
  });
  console.log('Scan complete.');
});
