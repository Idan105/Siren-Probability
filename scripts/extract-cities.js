const fs = require('fs');
const path = require('path');
const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'history.json'), 'utf8');
const m = raw.match(/"data":"[^"]+"/g);
const uniq = [...new Set((m || []).map(s => s.replace(/"data":"|"/g, '')))];
console.log(uniq.sort().join('\n'));
