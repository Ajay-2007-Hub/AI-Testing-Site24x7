require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Configuration
const PROVIDER = process.env.LLM_PROVIDER || 'openai';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL;

const DATA_FILE = path.join(__dirname, 'site24x7_compact.json');
const CSV_FILE = path.join(__dirname, 'site24x7_Dataset.csv');

// Delay helper to avoid rate limits
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callLLM(prompt) {
  if (!OPENAI_API_KEY || !OPENAI_BASE_URL) throw new Error("OpenAI credentials not set in .env");
  
  const url = OPENAI_BASE_URL.endsWith('/') ? OPENAI_BASE_URL + 'chat/completions' : OPENAI_BASE_URL + '/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + OPENAI_API_KEY
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    })
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API Error (${response.status}): ${errText}`);
  }
  
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Unexpected OpenAI response structure.");
  return text;
}

function buildPrompt(api) {
  return `
You are an expert IT administrator and developer using the Site24x7 API.
I will give you an API endpoint and its details.
Generate exactly 2 realistic, diverse questions or commands a user might type into a search bar to find this specific endpoint.
Make one query conversational (like a question) and one keyword-heavy or action-oriented (like "fetch", "get", "list").

CRITICAL RULES:
1. NEVER include the literal endpoint URL (e.g. "/app/api/...") in the generated queries.
2. NEVER use the words "API" or "endpoint" in the generated queries. They must sound like a human searching for a report or feature in a dashboard, not navigating a backend codebase.

Endpoint: ${api.method} ${api.endpoint}
Module: ${api.module}
Sub-Module: ${api.subModule}
Description: ${api.description || ''}

Output ONLY a JSON array of strings containing the 2 queries. Do not use markdown blocks, just raw JSON like: ["query 1", "query 2"]
`;
}

function escapeCsv(str) {
  if (str == null) return '';
  const text = String(str);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function main() {
  console.log(`Starting synthetic data generation (Provider: ${PROVIDER})`);
  
  if (!fs.existsSync(DATA_FILE)) {
    console.error("Error: site24x7_compact.json not found.");
    process.exit(1);
  }
  
  const jsonData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const apis = jsonData.apis || [];
  
  // Filter only Reports module endpoints
  const reportsApis = apis.filter(a => a.module === 'Reports');
  console.log(`Found ${reportsApis.length} total endpoints in the Reports module.`);
  
  // Group by subModule
  const grouped = {};
  reportsApis.forEach(api => {
    if (!grouped[api.subModule]) grouped[api.subModule] = [];
    grouped[api.subModule].push(api);
  });
  
  const subModules = Object.keys(grouped);
  console.log(`Found ${subModules.length} unique Reports sub-modules.`);
  
  // Pick 1 random API from each subModule
  const selectedApis = [];
  subModules.forEach(sub => {
    const group = grouped[sub];
    const randomApi = group[Math.floor(Math.random() * group.length)];
    selectedApis.push(randomApi);
  });
  
  console.log(`Selected ${selectedApis.length} endpoints (1 per sub-module) for query generation.\n`);
  
  let newRowsCount = 0;
  
  for (let i = 0; i < selectedApis.length; i++) {
    const api = selectedApis[i];
    console.log(`[${i+1}/${selectedApis.length}] Processing: [${api.subModule}] ${api.method} ${api.endpoint}`);
    
    try {
      const prompt = buildPrompt(api);
      let resText = await callLLM(prompt);
      
      // Clean up response if it wrapped in markdown
      resText = resText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const queries = JSON.parse(resText);
      
      if (!Array.isArray(queries)) throw new Error("Response was not a JSON array.");
      
      const lines = [];
      const timestamp = new Date().toISOString();
      queries.forEach(q => {
        // Schema: Query, Endpoint, Method, Module, SubModule, MarkedCorrect, Timestamp
        lines.push(`${escapeCsv(q)},${escapeCsv(api.endpoint)},${api.method},${escapeCsv(api.module)},${escapeCsv(api.subModule)},True,${timestamp}`);
      });
      
      fs.appendFileSync(CSV_FILE, '\n' + lines.join('\n'));
      newRowsCount += queries.length;
      console.log(`  -> Added ${queries.length} queries to dataset.`);
      
    } catch (err) {
      console.error(`  -> Failed: ${err.message}`);
    }
    
    // Slight delay to respect Azure rate limits (e.g. 1000ms is usually safe for basic limits)
    if (i < selectedApis.length - 1) {
      await sleep(1500);
    }
  }
  
  console.log(`\n✅ Done! Added ${newRowsCount} new synthetic queries to site24x7_Dataset.csv`);
}

main();
