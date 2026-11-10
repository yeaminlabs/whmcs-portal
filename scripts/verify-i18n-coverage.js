#!/usr/bin/env node

/**
 * i18n Key Coverage Checker
 * Scans all EJS templates for t('...') calls and verifies keys exist in both EN and BN dictionaries.
 */

const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', 'views');
const I18N_DIR = path.join(__dirname, '..', 'src', 'i18n');

// Load dictionaries using require
function loadDict(filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    return require(filePath);
  } catch (e) {
    console.error(`Failed to load ${filePath}:`, e.message);
    return {};
  }
}

const enDict = loadDict(path.join(I18N_DIR, 'en.js'));
const bnDict = loadDict(path.join(I18N_DIR, 'bn.js'));
const servicesEnDict = loadDict(path.join(I18N_DIR, 'services.en.js'));
const servicesBnDict = loadDict(path.join(I18N_DIR, 'services.bn.js'));

// Merge dicts
const allEn = { ...enDict, ...servicesEnDict };
const allBn = { ...bnDict, ...servicesBnDict };

// Extract all t('...') calls from EJS files
function extractKeysFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const keys = new Set();
  
  // Match t('key'), t("key"), t(`key`), t('key', vars), t("key", vars), t(`key`, vars)
  const regex = /t\(['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match[1].length > 0) keys.add(match[1]);
  }
  
  return keys;
}

// Find all .ejs files
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

console.log('🔍 Scanning for i18n keys in EJS templates...\n');

const allKeys = new Set();
const ejsFiles = findEjsFiles(VIEWS_DIR);

for (const file of ejsFiles) {
  const keys = extractKeysFromFile(file);
  for (const key of keys) {
    allKeys.add(key);
  }
}

console.log(`Found ${allKeys.size} unique i18n keys across ${ejsFiles.length} EJS files.\n`);

// Check coverage
const missingInEn = [];
const missingInBn = [];

for (const key of allKeys) {
    if (key === "") continue; // Skip empty key
  if (!(key in allEn)) missingInEn.push(key);
  if (!(key in allBn)) missingInBn.push(key);
}

let hasErrors = false;

if (missingInEn.length > 0) {
  console.log(`❌ Missing in English (${missingInEn.length}):`);
  for (const key of missingInEn.sort()) {
    console.log(`  - ${key}`);
  }
  console.log('');
  hasErrors = true;
} else {
  console.log('✅ All keys present in English dictionary');
}

if (missingInBn.length > 0) {
  console.log(`❌ Missing in Bangla (${missingInBn.length}):`);
  for (const key of missingInBn.sort()) {
    console.log(`  - ${key}`);
  }
  console.log('');
  hasErrors = true;
} else {
  console.log('✅ All keys present in Bangla dictionary');
}

// Also check for unused keys (in dict but not used in templates)
const allUsedKeys = allKeys;
const unusedEn = Object.keys(allEn).filter(k => !allUsedKeys.has(k));
const unusedBn = Object.keys(allBn).filter(k => !allUsedKeys.has(k));

if (unusedEn.length > 0) {
  console.log(`\n⚠️  Unused keys in English (${unusedEn.length}):`);
  for (const key of unusedEn.sort()) {
    console.log(`  - ${key}`);
  }
}

if (unusedBn.length > 0) {
  console.log(`\n⚠️  Unused keys in Bangla (${unusedBn.length}):`);
  for (const key of unusedBn.sort()) {
    console.log(`  - ${key}`);
  }
}

console.log('\n📊 Summary:');
console.log(`  Templates scanned: ${ejsFiles.length}`);
console.log(`  Unique keys used: ${allKeys.size}`);
console.log(`  EN dict size: ${Object.keys(allEn).length}`);
console.log(`  BN dict size: ${Object.keys(allBn).length}`);
console.log(`  Missing in EN: ${missingInEn.length}`);
console.log(`  Missing in BN: ${missingInBn.length}`);

if (hasErrors) {
  console.log('\n❌ Coverage check FAILED');
  process.exit(1);
} else {
  console.log('\n✅ Coverage check PASSED');
  process.exit(0);
}
