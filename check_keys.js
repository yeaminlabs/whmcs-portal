const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, 'views');
const I18N_DIR = path.join(__dirname, 'src', 'i18n');

function loadDict(filePath) {
  delete require.cache[require.resolve(filePath)];
  return require(filePath);
}

const enDict = require(path.join(I18N_DIR, 'en.js'));
const bnDict = require(path.join(I18N_DIR, 'bn.js'));
const servicesEnDict = require(path.join(I18N_DIR, 'services.en.js'));
const servicesBnDict = require(path.join(I18N_DIR, 'services.bn.js'));

const allEn = { ...enDict, ...servicesEnDict };
const allBn = { ...bnDict, ...servicesBnDict };

function extractKeysFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const keys = new Set();
  const regex = /t\(['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match[1].length > 0) keys.add(match[1]);
  }
  return keys;
}

function findEjsFiles(dir) {
  const files = [];
  function scan(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name.endsWith('.ejs')) {
        files.push(fullPath);
      }
    }
  }
  scan(dir);
  return files;
}

const allKeys = new Set();
const ejsFiles = findEjsFiles(VIEWS_DIR);

for (const file of ejsFiles) {
  const keys = extractKeysFromFile(file);
  for (const key of keys) {
    allKeys.add(key);
  }
}

console.log('Total keys extracted:', allKeys.size);

const missingInEn = [];
const missingInBn = [];

for (const key of allKeys) {
  if (key === "") continue;
  if (!(key in allEn)) missingInEn.push(key);
  if (!(key in allBn)) missingInBn.push(key);
}

console.log('Missing in EN:', missingInEn.length);
console.log('Missing in BN:', missingInBn.length);

if (missingInEn.length > 0) console.log('Missing EN:', missingInEn.slice(0, 5));
if (missingInBn.length > 0) console.log('Missing BN:', missingInBn.slice(0, 5));
