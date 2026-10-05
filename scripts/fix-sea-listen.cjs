const fs = require('fs');
let t = fs.readFileSync('src/index.js', 'utf8');
const bad = "const { spawn } = await import('node:child_process');";
const good = "const { spawn } = await import('node:child_process'); // sea-open-browser";
if (t.includes(bad)) {
  t = t.replace(
    'const serverInstance = app.listen(options.port, options.host, (error) => {',
    'const serverInstance = app.listen(options.port, options.host, async (error) => {'
  );
  fs.writeFileSync('src/index.js', t);
  console.log('listen callback made async');
} else {
  console.log('pattern not found');
}
