const fs = require('fs');
require('dotenv').config();

console.log('Loading database...');
const dbHelper = require('./db');
const data = {
  sheetDescriptions: dbHelper.getSheetDescriptions(),
  apis: dbHelper.getAllApis()
};
const dataJson = JSON.stringify(data);

let tfidfJson = "null";
try { tfidfJson = fs.readFileSync('tfidf_index.json', 'utf8'); } catch(e){}

let vectorJson = "null";
try { vectorJson = fs.readFileSync('site24x7_vector.json', 'utf8'); } catch(e){}

console.log('Reading src files...');
const template = fs.readFileSync('./src/template.html', 'utf8');

console.log('Building index.html...');
let html = template;

const openaiKey = process.env.OPENAI_API_KEY || '';
const openaiBase = process.env.OPENAI_BASE_URL || '';
const openaiModel = process.env.OPENAI_MODEL || '';

const scriptInjection = `<script>
  window.__OPENAI_API_KEY__ = "${openaiKey}";
  window.__OPENAI_BASE_URL__ = "${openaiBase}";
  window.__OPENAI_MODEL__ = "${openaiModel}";
</script>`;

if (html.includes('</head>')) {
  html = html.replace('</head>', `${scriptInjection}\n</head>`);
} else {
  html = scriptInjection + '\n' + html;
}

fs.writeFileSync('index.html', html, 'utf8');
console.log('index.html generated. Size:', Math.round(fs.statSync('index.html').size / 1024), 'KB');
