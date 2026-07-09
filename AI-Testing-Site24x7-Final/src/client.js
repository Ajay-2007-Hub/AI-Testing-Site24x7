


(async function() {
  document.getElementById('resultCount').textContent = 'Loading APIs...';
  
  var DB = null;
  var TFIDF_DB = null;
  
  try {
    var resDB = await fetch('site24x7_compact.json');
    if (!resDB.ok) throw new Error('Failed to load API data');
    DB = await resDB.json();
    
    var resTfIdf = await fetch('tfidf_index.json');
    if (resTfIdf.ok) TFIDF_DB = await resTfIdf.json();
    
    // Vector DB is now loaded directly by the Web Worker
  } catch (err) {
    document.getElementById('resultsPane').innerHTML = '<div style="padding:20px;color:#ef4444;">Error loading datasets: ' + err.message + '</div>';
    return;
  }
  
  var aiWorkerReady = true;
  
  async function searchWorker(query) {
    var proxyUrl = localStorage.getItem('s247_proxy_url') || (window.location.protocol + '//' + window.location.hostname + ':3334');
    try {
      var res = await fetch(proxyUrl + '/semantic_search?q=' + encodeURIComponent(query));
      if (!res.ok) throw new Error('Backend vector engine unavailable');
      return await res.json();
    } catch (e) {
      console.error(e);
      showToast('Semantic search requires the Node proxy (npm run proxy).');
      return [];
    }
  }

  var modules = DB.modules;
  var sheetDesc = DB.sheetDescriptions;
  var apis = DB.apis;

  var moduleCounts = {};
  var subModuleCounts = {};
  apis.forEach(function(a) { 
      moduleCounts[a.module] = (moduleCounts[a.module] || 0) + 1; 
      subModuleCounts[a.subModule] = (subModuleCounts[a.subModule] || 0) + 1; 
  });

  var query = '';
  var activeModule = 'ALL';
  var activeSubModule = 'ALL';
  var activeMethods = new Set(['GET','POST','PUT','DELETE','PATCH']);
  var currentPage = 1;
  var PAGE_SIZE = 20;
  var expandedCards = new Set();
  var lastResults = [];
  var activeTab = 'results'; // 'results' | 'history' | 'dataset'

  // ── PERSISTENT STORE ──
  var STORAGE_KEY_DS = 's247_dataset';
  var STORAGE_KEY_HX = 's247_history';

  function loadStore(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch(e){ return []; }
  }
  function saveStore(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch(e){}
  }

  var dataset = loadStore(STORAGE_KEY_DS);   // [{id, query, api, markedCorrect, addedAt}]
  var searchHistory = loadStore(STORAGE_KEY_HX);  // [{query, topResult, resultCount, searchedAt}]

  function updateBadges() {
    var dsBadge = document.getElementById('datasetBadge');
    var hxBadge = document.getElementById('historyBadge');
    if (dsBadge) dsBadge.textContent = dataset.length;
    if (hxBadge) hxBadge.textContent = searchHistory.length;
  }

  function recordHistory(q, results) {
    if (!q) return;
    var top = results.length ? results[0].api : null;
    searchHistory.unshift({ query: q, topResult: top ? top.endpoint : '', resultCount: results.length, searchedAt: new Date().toISOString() });
    if (searchHistory.length > 100) searchHistory = searchHistory.slice(0, 100);
    saveStore(STORAGE_KEY_HX, searchHistory);
    updateBadges();
  }

  function addToDataset(apiId, markedCorrect) {
    var api = apis.find(function(a){ return a.id === apiId; });
    if (!api) return;
    var existing = dataset.findIndex(function(d){ return d.apiId === apiId && d.query === query; });
    if (existing >= 0) {
      if (markedCorrect) dataset[existing].markedCorrect = true;
      showToast(markedCorrect ? 'Marked as correct!' : 'Already in dataset');
    } else {
      dataset.unshift({
        id: Date.now(),
        query: query,
        apiId: apiId,
        endpoint: api.endpoint,
        method: api.method,
        module: api.module,
        subModule: api.subModule,
        description: api.description,
        markedCorrect: !!markedCorrect,
        addedAt: new Date().toISOString()
      });
      showToast(markedCorrect ? '&#10003; Marked correct \u2014 saved to dataset' : '&#43; Added to dataset');
    }
    saveStore(STORAGE_KEY_DS, dataset);
    updateBadges();
  }

  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.innerHTML = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function(){ t.classList.remove('show'); }, 2200);
  }

  var STOPWORDS = new Set(['a','an','the','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should','may','might',
    'shall','can','need','to','in','on','at','by','for','with','about','against',
    'between','into','through','during','before','after','above','below','from','up',
    'down','out','off','over','under','again','further','then','once','here','there',
    'when','where','why','how','all','both','each','few','more','most','other','some',
    'such','no','nor','not','only','own','same','so','than','too','very','just',
    'because','as','until','while','of','and','or','that','this','these','those',
    'it','its','what','which','who','whom','me','my','i','give','tell','please','you']);

  function esc(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function tokenize(text) {
    if (!text) return [];
    return String(text).toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(function(t){ return t.length > 1 && !STOPWORDS.has(t); });
  }

  if (TFIDF_DB) {
    apis.forEach(function(api) {
      var allText = [
        api.endpoint, api.subModule, api.module, api.description, api.summaryText, api.searchText,
        (api.responseFields||[]).join(' '), (api.requestFields||[]).join(' ')
      ].join(' ');
      api._tokens = tokenize(allText);
    });
  }

  function scoreResult(api, tokens) {
    if (!tokens || !tokens.length) return 0;
    var searchType = document.getElementById('searchType');
    var isSemantic = searchType && searchType.value === 'semantic';

    var s = 0;
    var q = tokens.join(' ');

    if (TFIDF_DB && isSemantic && api._tokens) {
      var k1 = 1.5;
      var b = 0.75;
      var dl = api._tokens.length;
      var avgdl = TFIDF_DB.avgdl || 74;

      tokens.forEach(function(tok) {
        var tf = 0;
        for (var i=0; i<api._tokens.length; i++) {
          if (api._tokens[i] === tok || api._tokens[i].indexOf(tok) === 0) tf++; 
        }
        if (tf > 0) {
          var idf = TFIDF_DB.idf[tok] || Math.log(TFIDF_DB.N);
          var bm25 = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl))));
          s += (bm25 * 5); // Scale up BM25 score
        }
      });
      if (api.endpoint.toLowerCase().indexOf(q) >= 0) s += 40;
    }

    tokens.forEach(function(tok) {
      if (api.endpoint && api.endpoint.toLowerCase().indexOf(tok) >= 0) s += 12;
      if (api.subModule && api.subModule.toLowerCase().indexOf(tok) >= 0) s += 10;
      if (api.module && api.module.toLowerCase().indexOf(tok) >= 0) s += 8;
      if (api.description && api.description.toLowerCase().indexOf(tok) >= 0) s += 6;
      if (api.responseFields && api.responseFields.some(function(f){ return f.toLowerCase().indexOf(tok)>=0; })) s += 7;
      if (api.requestFields && api.requestFields.some(function(f){ return f.toLowerCase().indexOf(tok)>=0; })) s += 5;
      if (api.summaryText && api.summaryText.toLowerCase().indexOf(tok)>=0) s += 4;
      if (api.searchText && api.searchText.indexOf(tok)>=0) s += 1;
    });
    if (api.subModule && api.subModule.toLowerCase().indexOf(q)>=0) s += 20;
    if (api.description && api.description.toLowerCase().indexOf(q)>=0) s += 15;
    if (api.endpoint && api.endpoint.toLowerCase().indexOf(q)>=0) s += 18;
    return s;
  }

  function highlight(text, tokens) {
    if (!tokens.length || !text) return esc(text);
    var r = esc(text);
    tokens.forEach(function(tok) {
      var safe = tok.replace(/[-\\/\\^$*+?.()|[\\]{}]/g,'\\$&');
      r = r.replace(new RegExp('('+safe+')', 'gi'), '<mark>$1</mark>');
    });
    return r;
  }

  function getStatusClass(code) {
    if (!code) return 'status-other';
    if (code.indexOf('200')>=0||code.indexOf('201')>=0) return 'status-ok';
    if (code.indexOf('400')>=0||code.indexOf('401')>=0||code.indexOf('403')>=0||code.indexOf('404')>=0) return 'status-err';
    return 'status-warn';
  }

  function buildSidebar() {
    var el = document.getElementById('sidebarSheets');
    el.innerHTML = '';
    var allDiv = document.createElement('div');
    allDiv.className = 'sidebar-item' + (activeModule==='ALL'?' active':'');
    allDiv.innerHTML = '<span class="si-name">All Modules</span><span class="si-count">'+apis.length+'</span><span class="si-caret" style="visibility:hidden;font-size:10px;margin-left:8px;">▶</span>';
    allDiv.addEventListener('click', function(){ setModule('ALL', 'ALL'); });
    el.appendChild(allDiv);

    Object.keys(modules).forEach(function(mod) {
      var d = document.createElement('div');
      var isModActive = activeModule === mod;
      d.className = 'sidebar-item' + (isModActive ? ' active' : '');
      d.innerHTML = '<span class="si-name">'+esc(mod)+'</span><span class="si-count">'+(moduleCounts[mod]||0)+'</span><span class="si-caret" style="font-size:10px;margin-left:8px;color:#9ca3af;transition:transform 0.2s;' + (isModActive ? 'color:#1d4ed8;' : '') + '">' + (isModActive ? '▼' : '▶') + '</span>';
      d.addEventListener('click', function(){ 
          setModule(isModActive && activeSubModule === 'ALL' ? 'ALL' : mod, 'ALL'); 
      });
      el.appendChild(d);

      if (isModActive) {
          modules[mod].forEach(function(sub) {
              var sd = document.createElement('div');
              sd.className = 'sidebar-submodule' + (activeSubModule === sub ? ' active' : '');
              sd.innerHTML = '<span class="ssm-name">'+esc(sub)+'</span><span class="ssm-count">'+(subModuleCounts[sub]||0)+'</span>';
              sd.addEventListener('click', function(e){ e.stopPropagation(); setModule(mod, sub); });
              el.appendChild(sd);
          });
      }
    });
  }

  function setModule(mod, sub) {
    activeModule = mod;
    activeSubModule = sub;
    currentPage = 1;
    buildSidebar();
    var chipsEl = document.getElementById('moduleChips');
    if (chipsEl) {
        chipsEl.querySelectorAll('.mchip').forEach(function(c){
            c.classList.toggle('active', c.dataset.module === mod && c.dataset.sub === sub);
        });
    }
    renderResults();
  }
  window.setModule = setModule;

  function buildModuleChips() {
    var el = document.getElementById('moduleChips');
    if (!el) return;
    el.innerHTML = '';
    var all = document.createElement('span');
    all.className = 'mchip active';
    all.dataset.module = 'ALL';
    all.dataset.sub = 'ALL';
    all.textContent = 'All';
    el.appendChild(all);
    Object.keys(modules).forEach(function(mod) {
      modules[mod].forEach(function(sub) {
          var c = document.createElement('span');
          c.className = 'mchip';
          c.dataset.module = mod;
          c.dataset.sub = sub;
          c.textContent = sub;
          el.appendChild(c);
      });
    });
    
    el.addEventListener('click', function(e){
      var c = e.target.closest('.mchip');
      if (!c) return;
      setModule(c.dataset.module, c.dataset.sub);
    });
  }

  // Method filter
  document.getElementById('methodFilters').addEventListener('click', function(e) {
    var btn = e.target.closest('.method-filter-btn');
    if (!btn) return;
    var m = btn.dataset.method;
    if (activeMethods.has(m)) { activeMethods.delete(m); btn.classList.remove('active'); }
    else { activeMethods.add(m); btn.classList.add('active'); }
    currentPage = 1;
    renderResults();
  });

  async function getResults() {
    var filtered = apis.filter(function(api) {
      if (!activeMethods.has(api.method)) return false;
      if (activeModule !== 'ALL' && api.module !== activeModule) return false;
      if (activeSubModule !== 'ALL' && api.subModule !== activeSubModule) return false;
      return true;
    });
    if (!query) return filtered.map(function(api){ return {api:api, score:0}; });

    var type = document.getElementById('searchType').value;
    if (type === 'semantic') {
      if (!aiWorkerReady) {
        return filtered.map(function(api){ return {api:api, score:0}; });
      }
      
      var workerRes = await searchWorker(query);
      var scoreMap = {};
      workerRes.forEach(function(r) { scoreMap[r.id] = r.score; });
      
      var tokens = tokenize(query);

      return filtered.map(function(api) {
        var score = scoreMap[api.id] || 0;
        
        // Hybrid Intent Boosting: Semantic models often cluster verbs poorly. 
        // We add an absolute boost to the correct HTTP method based on conversational verbs.
        var qLower = query.toLowerCase();
        if ((qLower.indexOf('create')>-1 || qLower.indexOf('add')>-1 || qLower.indexOf('new')>-1 || qLower.indexOf('set up')>-1) && api.method === 'POST') score += 0.20;
        if ((qLower.indexOf('update')>-1 || qLower.indexOf('modify')>-1 || qLower.indexOf('change')>-1) && api.method === 'PUT') score += 0.20;
        if ((qLower.indexOf('delete')>-1 || qLower.indexOf('remove')>-1) && api.method === 'DELETE') score += 0.20;
        if ((qLower.indexOf('get')>-1 || qLower.indexOf('list')>-1 || qLower.indexOf('show')>-1) && api.method === 'GET') score += 0.20;

        // True Hybrid: Incorporate BM25 score to ground the vector search in exact keywords
        var bm25 = scoreResult(api, tokens);
        score += (bm25 * 0.003);

        return { api: api, score: score };
      }).filter(function(r){ return r.score > 0.25; })
        .sort(function(a,b){ return b.score - a.score; });
    }

    var tokens = tokenize(query);
    if (!tokens.length) return filtered.map(function(api){ return {api:api, score:0}; });
    return filtered.map(function(api){ return {api:api, score:scoreResult(api,tokens)}; })
      .filter(function(r){ return r.score > 0; })
      .sort(function(a,b){ return b.score - a.score; });
  }

  function renderPagination(total) {
    var totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages <= 1) return '';
    var btns = '<button class="pg-btn" '+(currentPage===1?'disabled':'')+' onclick="goPage('+(currentPage-1)+')">&#8592; Prev</button>';
    var range = [];
    for (var i=1;i<=totalPages;i++) {
      if (i===1||i===totalPages||(i>=currentPage-2&&i<=currentPage+2)) range.push(i);
    }
    var prev=0;
    range.forEach(function(p) {
      if (prev && p-prev>1) btns += '<span class="pg-dots">…</span>';
      btns += '<button class="pg-btn'+(p===currentPage?' active':'')+'" onclick="goPage('+p+')">'+p+'</button>';
      prev=p;
    });
    btns += '<button class="pg-btn" '+(currentPage===totalPages?'disabled':'')+' onclick="goPage('+(currentPage+1)+')">Next &#8594;</button>';
    return '<div class="pagination">'+btns+'</div>';
  }

  function methodColor(m) {
    var map = {GET:'method-get',POST:'method-post',PUT:'method-put',DELETE:'method-delete',PATCH:'method-patch'};
    return map[m] || 'method-other';
  }

  window.switchSnippet = function(btn, apiId, type, e) {
    e.stopPropagation();
    var parent = btn.parentElement;
    Array.from(parent.children).forEach(function(c) { 
      c.classList.remove('active');
      c.style.background = '#f8fafc';
    });
    btn.classList.add('active');
    btn.style.background = '#fff';
    
    var api = apis.find(function(a) { return a.id === apiId; });
    var box = document.getElementById('snippet-box-' + apiId);
    if (box && api) {
      box.textContent = generateSnippet(api, type);
    }
  };

  function generateSnippet(api, type) {
    var url = "https://www.site24x7.com/api" + api.endpoint;
    var method = api.method.toUpperCase();
    var hasBody = (method === 'POST' || method === 'PUT' || method === 'PATCH') && api.requestFields && api.requestFields.length;
    var bodyObj = {};
    if (hasBody) {
      api.requestFields.forEach(function(f) { bodyObj[f] = "<value>"; });
    }
    
    if (type === 'curl') {
      var s = "curl -X " + method + " " + url + " \\\n";
      s += "  -H \"Accept: application/json; version=2.0\" \\\n";
      s += "  -H \"Authorization: Zoho-oauthtoken <YOUR_ACCESS_TOKEN>\"";
      if (hasBody) {
        s += " \\\n  -H \"Content-Type: application/json;charset=UTF-8\" \\\n";
        s += "  -d '" + JSON.stringify(bodyObj, null, 2) + "'";
      }
      return s;
    } else if (type === 'node') {
      var s = "const fetch = require('node-fetch');\n\n";
      if (hasBody) {
        s += "const payload = " + JSON.stringify(bodyObj, null, 2) + ";\n\n";
      }
      s += "fetch('" + url + "', {\n";
      s += "  method: '" + method + "',\n";
      s += "  headers: {\n";
      s += "    'Accept': 'application/json; version=2.0',\n";
      s += "    'Authorization': 'Zoho-oauthtoken <YOUR_ACCESS_TOKEN>'" + (hasBody ? ",\n    'Content-Type': 'application/json;charset=UTF-8'" : "") + "\n";
      s += "  }" + (hasBody ? ",\n  body: JSON.stringify(payload)" : "") + "\n";
      s += "})\n.then(res => res.json())\n.then(json => console.log(json))\n.catch(err => console.error(err));";
      return s;
    } else if (type === 'python') {
      var s = "import requests\n\n";
      s += "url = '" + url + "'\n";
      s += "headers = {\n";
      s += "    'Accept': 'application/json; version=2.0',\n";
      s += "    'Authorization': 'Zoho-oauthtoken <YOUR_ACCESS_TOKEN>'\n";
      s += "}\n";
      if (hasBody) {
        s += "\npayload = " + JSON.stringify(bodyObj, null, 4).replace(/true/g, 'True').replace(/false/g, 'False') + "\n\n";
        s += "response = requests." + method.toLowerCase() + "(url, headers=headers, json=payload)\n";
      } else {
        s += "\nresponse = requests." + method.toLowerCase() + "(url, headers=headers)\n";
      }
      s += "print(response.json())";
      return s;
    }
    return '';
  }

  function renderCardsHtml(pageResults, tokens, maxScore) {
    if (!pageResults.length) return '';
    var stype = document.getElementById('searchType').value;
    return pageResults.map(function(r) {
      var api = r.api; var score = r.score;
      var pct;
      if (stype === 'semantic') {
        // Absolute percentage, capped at 100%
        pct = Math.round(Math.min(score, 1.0) * 100);
      } else {
        // Relative normalization for unbounded keyword scores
        pct = maxScore && score ? Math.round((score / maxScore) * 100) : 0;
      }
      var isExp = expandedCards.has(api.id);
      var resF = (api.responseFields||[]).slice(0,12);
      var reqF = (api.requestFields||[]).slice(0,8);
      var sc = getStatusClass(api.statusCode);

      // Response fields table rows
      var fieldRows = resF.map(function(f) {
        return '<tr class="field-row">' +
          '<td class="field-name">'+esc(f)+'</td>' +
          '<td><span class="type-badge">string</span></td>' +
          '<td class="field-desc">The <strong>'+esc(f)+'</strong> property from the API response.</td>' +
        '</tr>';
      }).join('');

      return '<div class="result-card'+(isExp?' expanded':'')+'" data-id="'+api.id+'">' +
        '<div class="rc-header">' +
          '<div class="rc-top">' +
            '<span class="method-badge '+methodColor(api.method)+'">'+api.method+'</span>' +
            '<span class="rc-endpoint">'+highlight(api.endpoint, tokens)+'</span>' +
            '<button class="copy-endpoint-btn" onclick="event.stopPropagation(); navigator.clipboard.writeText(\''+esc(api.endpoint)+'\'); this.innerHTML=\'&#10004;\'; setTimeout(()=>this.innerHTML=\'&#128203;\', 2000)" title="Copy Endpoint">&#128203;</button>' +
            '<span class="rc-client-tag">Client</span>' +
            '<span class="rc-module-tag">'+esc(api.module.toUpperCase().replace(/ /g,'_'))+'</span>' +
            (score > 0 ? '<span style="margin-left:auto; font-size:11px; color:#9ca3af; font-family:monospace;">' + pct + '% Match</span>' : '') +
          '</div>' +
          '<div class="rc-desc">'+highlight(api.description, tokens)+'</div>' +
          '<div class="rc-meta">'+esc(api.subFeature)+'</div>' +
          '<div class="rc-actions">' +
            '<button class="action-btn btn-correct" data-apiid="'+api.id+'" onclick="event.stopPropagation();markCorrect('+api.id+')">&#10003; Mark Correct</button>' +
            '<button class="action-btn btn-dataset" data-apiid="'+api.id+'" onclick="event.stopPropagation();addDataset('+api.id+')">&#43; Add to Dataset</button>' +
            '<button class="action-btn btn-try" data-apiid="'+api.id+'" onclick="event.stopPropagation();tryApi('+api.id+')">&#9654; Try API</button>' +
          '</div>' +
        '</div>' +
        '<div class="rc-try-panel" id="try-panel-'+api.id+'" style="display:none"></div>' +
        (resF.length || reqF.length || api.summaryText ? 
        '<div class="rc-detail" style="display:'+(isExp?'block':'none')+'">' +
          (resF.length ? '<div class="detail-section-label">RESPONSE FIELDS</div>' +
          '<table class="fields-table">' +
          '<colgroup><col style="width:180px"><col style="width:90px"><col></colgroup>' +
          fieldRows +
          '</table>' : '') +
          (reqF.length ? '<div class="detail-section-label" style="margin-top:12px">REQUEST FIELDS</div>' +
          '<div class="req-fields">'+reqF.map(function(f){ return '<span class="req-pill">'+esc(f)+'</span>'; }).join('')+'</div>' : '') +
          (api.summaryText ? '<div class="summary-box">'+esc(api.summaryText)+'</div>' : '') +
          '<div class="detail-section-label" style="margin-top:16px;">CODE SNIPPETS</div>' +
          '<div class="snippet-tabs" style="display:flex;gap:4px;margin-bottom:8px;">' +
          '<button class="snippet-tab-btn active" style="padding:4px 12px;font-size:11px;border-radius:4px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;" onclick="switchSnippet(this, '+api.id+', \'curl\', event)">cURL</button>' +
          '<button class="snippet-tab-btn" style="padding:4px 12px;font-size:11px;border-radius:4px;border:1px solid #cbd5e1;background:#f8fafc;cursor:pointer;" onclick="switchSnippet(this, '+api.id+', \'node\', event)">Node.js</button>' +
          '<button class="snippet-tab-btn" style="padding:4px 12px;font-size:11px;border-radius:4px;border:1px solid #cbd5e1;background:#f8fafc;cursor:pointer;" onclick="switchSnippet(this, '+api.id+', \'python\', event)">Python</button>' +
          '</div>' +
          '<pre class="snippet-box" id="snippet-box-'+api.id+'" style="background:#1e293b;color:#e2e8f0;padding:12px;border-radius:6px;font-family:monospace;font-size:11px;overflow-x:auto;">' + esc(generateSnippet(api, 'curl')) + '</pre>' +
        '</div>' : '') +
      '</div>';
    }).join('');
  }

  async function renderResults() {
    var results = await getResults();
    lastResults = results;
    var total = results.length;
    var maxScore = results.length ? results[0].score : 1;
    var pageResults = results.slice((currentPage-1)*PAGE_SIZE, currentPage*PAGE_SIZE);
    var tokens = query ? tokenize(query) : [];
    var html = '';

    // Update result count line
    var countEl = document.getElementById('resultCount');
    if (!window.aiExtractorLoading) {
      var stype = document.getElementById('searchType').value;
      if (!query && activeModule === 'ALL') {
        countEl.textContent = total + ' endpoint(s) — browse all modules';
      } else if (query) {
        countEl.textContent = total + ' result(s) — ' + (stype === 'semantic' ? 'semantic search' : 'keyword search');
      } else {
        countEl.textContent = total + ' endpoint(s) in ' + activeModule + (activeSubModule !== 'ALL' ? ' / ' + activeSubModule : '');
      }
    }

    if (!query && activeModule === 'ALL') {
      // Module overview cards
      html = '<div class="module-grid">';
      Object.keys(modules).forEach(function(mod) {
        html += '<div class="module-card" onclick="setModule(this.dataset.m, \'ALL\')" data-m="'+esc(mod)+'">' +
          '<div class="mc-top"><span class="mc-name">'+esc(mod)+'</span><span class="mc-count">'+(moduleCounts[mod]||0)+'</span></div>' +
          '<p class="mc-desc">Click to browse ' + esc(mod) + ' endpoints.</p>' +
        '</div>';
      });
      html += '</div>';
      html += '<div class="section-divider">All Endpoints</div>';
      html += renderCardsHtml(pageResults, tokens, maxScore);
      html += renderPagination(total);
    } else if (total === 0) {
      html = '<div class="no-results">' +
        '<div class="nr-icon">&#128269;</div>' +
        '<h3>No results found</h3>' +
        '<p>Try different keywords, or browse a module from the sidebar.</p>' +
        '<p style="margin-top:6px;font-size:12px;color:#aaa">Examples: "monitor groups", "webhook", "server template", "tag listing"</p>' +
      '</div>';
    } else {
      html = renderCardsHtml(pageResults, tokens, maxScore);
      html += renderPagination(total);
    }

    document.getElementById('resultsPane').innerHTML = html;

    // Card click = expand/collapse detail
    document.querySelectorAll('.result-card').forEach(function(card) {
      card.addEventListener('click', function(e) {
        if (e.target.closest('.action-btn')) return;
        var id = parseInt(card.dataset.id);
        var detail = card.querySelector('.rc-detail');
        if (!detail) return;
        if (expandedCards.has(id)) { expandedCards.delete(id); card.classList.remove('expanded'); detail.style.display='none'; }
        else { expandedCards.add(id); card.classList.add('expanded'); detail.style.display='block'; }
      });
      var id = parseInt(card.dataset.id);
      if (expandedCards.has(id)) {
        card.classList.add('expanded');
        var d = card.querySelector('.rc-detail');
        if (d) d.style.display='block';
      }
    });
  }

  window.goPage = function(p) {
    var tp = Math.ceil(lastResults.length/PAGE_SIZE);
    if (p<1||p>tp) return;
    currentPage = p;
    renderResults();
    window.scrollTo({top:0,behavior:'smooth'});
  };

  window.markCorrect = function(apiId) {
    if (!query) { showToast('Type a query first to mark a correct answer'); return; }
    addToDataset(apiId, true);
  };

  window.addDataset = function(apiId) {
    if (!query) { showToast('Type a query first before adding to dataset'); return; }
    addToDataset(apiId, false);
  };

  // ── PROXY / TRY API ──
  var PROXY_URL = localStorage.getItem('s247_proxy_url') || (window.location.protocol + '//' + window.location.hostname + ':3334');
  var proxyConnected = false;

  function checkProxyStatus() {
    fetch(PROXY_URL + '/status', { signal: AbortSignal.timeout(1500) })
      .then(function(r){ return r.json(); })
      .then(function(d){
        proxyConnected = d.ok;
        var dot = document.getElementById('proxyDot');
        var lbl = document.getElementById('proxyLabel');
        if (dot) dot.style.background = proxyConnected ? '#16a34a' : '#ef4444';
        if (lbl) lbl.textContent = proxyConnected ? (d.hasCookie ? 'Proxy: Ready' : 'Proxy: No Cookie') : 'Proxy: Off';
        if (proxyConnected && !d.hasCookie) { if (dot) dot.style.background = '#f59e0b'; }
      })
      .catch(function(){
        proxyConnected = false;
        var dot = document.getElementById('proxyDot');
        var lbl = document.getElementById('proxyLabel');
        if (dot) dot.style.background = '#ef4444';
        if (lbl) lbl.textContent = 'Proxy: Off';
      });
  }

  window.tryApi = function(apiId) {
    var api = apis.find(function(a){ return a.id === apiId; });
    if (!api) return;
    var panel = document.getElementById('try-panel-' + apiId);
    if (!panel) return;

    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }

    if (!proxyConnected) {
      panel.style.display = 'block';
      panel.innerHTML = '<div class="try-error">&#9888; Proxy not running. Start it with <code>npm run proxy</code> then refresh.</div>';
      return;
    }

    var rawEp = api.endpoint;
    var method = api.method.toUpperCase();
    var hasBody = (method === 'POST' || method === 'PUT' || method === 'PATCH');
    var pathParams = [];
    var paramRegex = /\{([^}]+)\}/g;
    var match;
    while ((match = paramRegex.exec(rawEp)) !== null) {
      pathParams.push(match[1]);
    }

    panel.style.display = 'block';

    var html = '<div class="try-input-form">';
    html += '<div class="try-input-title">Configure Request</div>';
    
    pathParams.forEach(function(param) {
      html += '<div class="try-input-group">';
      html += '<label>URL Param: <code>' + esc(param) + '</code></label>';
      html += '<input type="text" id="param-' + apiId + '-' + param + '" placeholder="Enter value for ' + esc(param) + '" />';
      html += '</div>';
    });

    html += '<div class="try-input-group">';
    html += '<label>Query String (Optional)</label>';
    
    // Intelligent Tip for Reports
    if (api.module === 'Reports' || rawEp.indexOf('/reports/') > -1) {
      html += '<p style="font-size:11px; color:#6b7280; margin:0 0 6px 0; line-height:1.4;">' +
              '<strong>💡 Tip:</strong> Reports APIs usually require a <code>period</code> parameter.<br>' +
              'Type <code>period=1</code> (Today), <code>period=9</code> (Last 24 Hrs), or <code>period=10</code> (Last 7 Days).' +
              '</p>';
    }
    
    html += '<input type="text" autocomplete="off" id="query-' + apiId + '" placeholder="?period=1&status=up" />';
    html += '</div>';

    if (hasBody) {
      html += '<div class="try-input-group">';
      html += '<label>Request Body (JSON)</label>';
      html += '<textarea id="body-' + apiId + '" rows="4" placeholder="{\n  // Enter JSON payload here\n}"></textarea>';
      html += '</div>';
    }

    html += '<button class="action-btn" onclick="executeApi(' + apiId + ')">&#9654; Execute Request</button>';
    html += '</div>';
    panel.innerHTML = html;
  };

  window.executeApi = function(apiId) {
    var api = apis.find(function(a){ return a.id === apiId; });
    var panel = document.getElementById('try-panel-' + apiId);
    var rawEp = api.endpoint;
    var method = api.method.toUpperCase();
    var hasBody = (method === 'POST' || method === 'PUT' || method === 'PATCH');
    
    // Replace parameters
    var finalEp = rawEp;
    var paramRegex = /\{([^}]+)\}/g;
    var match;
    while ((match = paramRegex.exec(rawEp)) !== null) {
      var param = match[1];
      var input = document.getElementById('param-' + apiId + '-' + param);
      if (input && input.value) {
        finalEp = finalEp.replace('{' + param + '}', input.value.trim());
      }
    }

    var queryInput = document.getElementById('query-' + apiId);
    if (queryInput && queryInput.value.trim()) {
      var qs = queryInput.value.trim();
      if (!qs.startsWith('?')) qs = '?' + qs;
      finalEp += qs;
    }

    var bodyData = null;
    if (hasBody) {
      var bodyInput = document.getElementById('body-' + apiId);
      if (bodyInput && bodyInput.value.trim()) {
        bodyData = bodyInput.value.trim();
      }
    }

    var fullUrl = (finalEp.startsWith('http://') || finalEp.startsWith('https://')) ? finalEp : 'https://www.site24x7.com' + finalEp;
    var proxyTarget = PROXY_URL + '/proxy?url=' + encodeURIComponent(fullUrl);

    panel.innerHTML = '<div class="try-loading">&#9654; Calling ' + esc(api.method) + ' ' + esc(finalEp) + '…</div>';

    var fetchOpts = { method: api.method };
    if (bodyData) {
      fetchOpts.body = bodyData;
      fetchOpts.headers = { 'Content-Type': 'application/json' };
    }

    fetch(proxyTarget, fetchOpts)
      .then(function(r) {
        var status = r.status;
        return r.text().then(function(body) { return { status: status, body: body }; });
      })
      .then(function(result) {
        var pretty = result.body;
        try { pretty = JSON.stringify(JSON.parse(result.body), null, 2); } catch(e){}
        var statusCls = result.status < 300 ? 'try-status-ok' : result.status < 500 ? 'try-status-warn' : 'try-status-err';
        panel.innerHTML =
          '<div class="try-resp-header" style="display:flex; align-items:center;">' +
            '<span class="try-method-badge method-' + api.method.toLowerCase() + '">' + api.method + '</span>' +
            '<code class="try-ep">' + esc(finalEp) + '</code>' +
            '<span class="try-status ' + statusCls + '">' + result.status + '</span>' +
            '<button class="copy-json-btn" onclick="navigator.clipboard.writeText(decodeURIComponent(\'' + encodeURIComponent(pretty) + '\')); this.innerHTML=\'&#10004; Copied!\'; setTimeout(()=>this.innerHTML=\'&#128203; Copy JSON\', 2000)" style="margin-left:auto; background:#3b82f6; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:11px; font-weight:600; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.1);">&#128203; Copy JSON</button>' +
            '<button class="try-close" onclick="document.getElementById(\'try-panel-' + apiId + '\').style.display=\'none\'" title="Close" style="margin-left:8px;">&#10005;</button>' +
          '</div>' +
          '<pre class="try-body">' + esc(pretty) + '</pre>';
      })
      .catch(function(err) {
      panel.innerHTML = '<div class="try-error">&#9888; Request failed: ' + esc(err.message) + '</div>';
      });
  };

  // ── SETTINGS MODAL ──
  window.openSettings = function() {
    var c = localStorage.getItem('s247_cookie') || '';
    var a = localStorage.getItem('s247_auth') || '';
    var g = localStorage.getItem('s247_gemini_key') || '';
    var p = localStorage.getItem('s247_llm_provider') || 'gemini';
    var m = localStorage.getItem('s247_gemini_model') || 'gemini-2.0-flash';
    var pu = localStorage.getItem('s247_proxy_url') || PROXY_URL;
    document.getElementById('cookieInput').value = c;
    document.getElementById('authTokenInput').value = a;
    if (document.getElementById('geminiKeyInput')) document.getElementById('geminiKeyInput').value = g;
    if (document.getElementById('llmProviderSelect')) document.getElementById('llmProviderSelect').value = p;
    if (document.getElementById('geminiModelInput')) document.getElementById('geminiModelInput').value = m;
    if (document.getElementById('proxyUrlInput')) document.getElementById('proxyUrlInput').value = pu;
    document.getElementById('settingsModal').style.display = 'flex';
  };
  window.closeSettings = function() {
    document.getElementById('settingsModal').style.display = 'none';
  };
  window.saveCookie = function() {
    var cookieVal = (document.getElementById('cookieInput') || {}).value || '';
    var authVal = (document.getElementById('authTokenInput') || {}).value || '';
    var proxyUrlVal = (document.getElementById('proxyUrlInput') || {}).value || '';
    
    if (proxyUrlVal) {
      localStorage.setItem('s247_proxy_url', proxyUrlVal.trim());
      PROXY_URL = proxyUrlVal.trim();
    }
    if (!cookieVal.trim() && !authVal.trim() && !proxyUrlVal.trim()) { showToast('Please configure settings first'); return; }
    var btn = document.getElementById('saveCookieBtn');
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    fetch(PROXY_URL + '/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookieVal.trim(), authToken: authVal.trim() })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (btn) { btn.textContent = 'Save Settings'; btn.disabled = false; }
      if (d.ok) {
        showToast('&#10003; Settings saved — proxy is ready!');
        checkProxyStatus();
        closeSettings();
      } else {
        showToast('Error: ' + d.message);
      }
    })
    .catch(function(){
      if (btn) { btn.textContent = 'Save Settings'; btn.disabled = false; }
      showToast('Could not reach proxy. Is it running?');
    });
  };

  var isMouseDownOnOverlay = false;
  document.getElementById('settingsModal').addEventListener('mousedown', function(e){
    isMouseDownOnOverlay = (e.target === this);
  });
  document.getElementById('settingsModal').addEventListener('mouseup', function(e){
    if (isMouseDownOnOverlay && e.target === this) closeSettings();
    isMouseDownOnOverlay = false;
  });

  // Check proxy status on load and every 15s
  checkProxyStatus();
  setInterval(checkProxyStatus, 15000);

  window.removeFromDataset = function(id) {
    dataset = dataset.filter(function(d){ return d.id !== id; });
    saveStore(STORAGE_KEY_DS, dataset);
    updateBadges();
    renderActiveTab();
  };

  window.clearHistory = function() {
    if (!confirm('Clear all Q&A history?')) return;
    searchHistory = [];
    saveStore(STORAGE_KEY_HX, searchHistory);
    updateBadges();
    renderActiveTab();
  };

  window.clearDataset = function() {
    if (!confirm('Clear entire dataset?')) return;
    dataset = [];
    saveStore(STORAGE_KEY_DS, dataset);
    updateBadges();
    renderActiveTab();
  };

  window.exportDataset = function(fmt) {
    if (!dataset.length) { showToast('Dataset is empty'); return; }
    var content, filename, mime;
    if (fmt === 'csv') {
      var rows = ['query,endpoint,method,sheet,subFeature,markedCorrect,addedAt'];
      dataset.forEach(function(d) {
        rows.push([
          '"'+d.query.replace(/"/g,'""')+'"',
          '"'+d.endpoint+'"',
          d.method,
          '"'+d.sheet+'"',
          '"'+d.subFeature.replace(/"/g,'""')+'"',
          d.markedCorrect ? 'true' : 'false',
          d.addedAt
        ].join(','));
      });
      content = rows.join(String.fromCharCode(10));
      filename = 'site24x7_dataset.csv';
      mime = 'text/csv';
    } else {
      content = JSON.stringify(dataset, null, 2);
      filename = 'site24x7_dataset.json';
      mime = 'application/json';
    }
    var blob = new Blob([content], {type: mime});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Downloaded ' + filename);
  };

  window.exportHistory = function() {
    if (!searchHistory.length) { showToast('History is empty'); return; }
    var blob = new Blob([JSON.stringify(searchHistory, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'site24x7_history.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── RECENT SEARCHES & SHORTCUTS ──
  function loadRecentSearches() {
    try { return JSON.parse(localStorage.getItem('site24x7_recent_searches')) || []; }
    catch(e) { return []; }
  }
  function saveRecentSearch(q) {
    if (!q) return;
    var recent = loadRecentSearches();
    recent = recent.filter(function(item) { return item.toLowerCase() !== q.toLowerCase(); });
    recent.unshift(q);
    if (recent.length > 5) recent.pop();
    localStorage.setItem('site24x7_recent_searches', JSON.stringify(recent));
    renderRecentSearches();
  }
  function renderRecentSearches() {
    var list = document.getElementById('recentSearchesList');
    var dropdown = document.getElementById('recentSearchesDropdown');
    if (!list || !dropdown) return;
    var recent = loadRecentSearches();
    if (recent.length === 0) { dropdown.style.display = 'none'; return; }
    list.innerHTML = '';
    recent.forEach(function(item) {
      var li = document.createElement('li');
      li.className = 'rs-item';
      
      var textSpan = document.createElement('span');
      textSpan.textContent = item;
      textSpan.style.flex = '1';
      
      var delBtn = document.createElement('button');
      delBtn.innerHTML = '&#10005;';
      delBtn.className = 'rs-del-btn';
      delBtn.onmousedown = function(e) {
        e.preventDefault();
        e.stopPropagation();
        var newRecent = loadRecentSearches().filter(function(r) { return r !== item; });
        localStorage.setItem('site24x7_recent_searches', JSON.stringify(newRecent));
        renderRecentSearches();
      };
      
      li.appendChild(textSpan);
      li.appendChild(delBtn);
      
      li.onmousedown = function(e) { e.preventDefault(); window.runSuggestedQuery(item); };
      list.appendChild(li);
    });
  }

  var searchInputEl = document.getElementById('searchInput');

  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (searchInputEl) { searchInputEl.focus(); searchInputEl.select(); }
    }
  });

  window.runSuggestedQuery = function(q) {
    if (searchInputEl) {
      searchInputEl.value = q;
      if (typeof window.search === 'function') window.search();
    }
  };

  // Search
  window.search = async function() {
    query = document.getElementById('searchInput').value.trim();
    currentPage = 1;
    document.getElementById('clearBtn').style.visibility = query ? 'visible' : 'hidden';
    await renderResults();
    var results = lastResults;
    recordHistory(query, results);
  };

  document.getElementById('searchBtn').addEventListener('click', search);
  
  document.getElementById('searchInput').addEventListener('input', function(){
    var val = document.getElementById('searchInput').value;
    document.getElementById('clearBtn').style.visibility = val ? 'visible' : 'hidden';
    if (!val.trim()) { query = ''; renderResults(); }
  });
  
  document.getElementById('searchInput').addEventListener('keyup', function(e) { 
    if(e.key === 'Enter') {
      if (document.getElementById('searchInput').value.trim() !== query) search();
    }
  });
  document.getElementById('clearBtn').addEventListener('click', function(){
    document.getElementById('searchInput').value=''; query=''; document.getElementById('clearBtn').style.visibility='hidden'; renderResults();
  });
  document.getElementById('searchType').addEventListener('change', function() { currentPage=1; renderResults(); });

  // ── TABS ──
  function setTabActive(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === tab); });
  }

  function renderDatasetTab() {
    var pane = document.getElementById('resultsPane');
    var countEl = document.getElementById('resultCount');
    countEl.textContent = dataset.length + ' saved Q&A pair(s)';
    if (!dataset.length) {
      pane.innerHTML = '<div class="no-results"><div class="nr-icon">&#128193;</div><h3>Dataset is empty</h3>' +
        '<p>Search for an API, then click <strong>Mark Correct</strong> or <strong>Add to Dataset</strong> on any result.</p></div>';
      return;
    }
    var html = '<div class="ds-toolbar">' +
      '<span class="ds-info">'+dataset.length+' pair(s) &bull; '+dataset.filter(function(d){return d.markedCorrect;}).length+' marked correct</span>' +
      '<div class="ds-btns">' +
        '<button class="ds-btn" onclick="exportDataset(&quot;json&quot;)">&#8615; Export JSON</button>' +
        '<button class="ds-btn" onclick="exportDataset(&quot;csv&quot;)">&#8615; Export CSV</button>' +
        '<button class="ds-btn ds-btn-danger" onclick="clearDataset()">&#128465; Clear All</button>' +
      '</div></div>';
    html += '<table class="ds-table"><thead><tr>' +
      '<th>Query</th><th>Endpoint</th><th>Method</th><th>Module</th><th>Correct?</th><th>Added</th><th></th>' +
    '</tr></thead><tbody>';
    dataset.forEach(function(d) {
      html += '<tr>' +
        '<td class="ds-query">'+esc(d.query)+'</td>' +
        '<td class="ds-ep"><code>'+esc(d.endpoint)+'</code></td>' +
        '<td><span class="method-badge method-'+d.method.toLowerCase()+'">'+d.method+'</span></td>' +
        '<td class="ds-sheet">'+esc(d.sheet)+'</td>' +
        '<td class="ds-correct">'+(d.markedCorrect ? '<span class="correct-yes">&#10003; Yes</span>' : '<span class="correct-no">&#8212;</span>')+'</td>' +
        '<td class="ds-date">'+new Date(d.addedAt).toLocaleDateString()+'</td>' +
        '<td><button class="ds-remove" onclick="removeFromDataset('+d.id+')">&#215;</button></td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    pane.innerHTML = html;
  }

  function renderHistoryTab() {
    var pane = document.getElementById('resultsPane');
    var countEl = document.getElementById('resultCount');
    countEl.textContent = searchHistory.length + ' search(es) in history';
    if (!searchHistory.length) {
      pane.innerHTML = '<div class="no-results"><div class="nr-icon">&#128336;</div><h3>No search history yet</h3>' +
        '<p>Your searches will appear here automatically.</p></div>';
      return;
    }
    var html = '<div class="ds-toolbar">' +
      '<span class="ds-info">'+searchHistory.length+' recent search(es)</span>' +
      '<div class="ds-btns">' +
        '<button class="ds-btn" onclick="exportHistory()">&#8615; Export JSON</button>' +
        '<button class="ds-btn ds-btn-danger" onclick="clearHistory()">&#128465; Clear</button>' +
      '</div></div>';
    html += '<table class="ds-table"><thead><tr>' +
      '<th>Query</th><th>Top Result</th><th>Results</th><th>When</th>' +
    '</tr></thead><tbody>';
    searchHistory.forEach(function(h) {
      html += '<tr class="hx-row" onclick="replaySearch(this.dataset.q)" data-q="'+esc(h.query)+'">' +
        '<td class="ds-query">'+esc(h.query)+'</td>' +
        '<td class="ds-ep"><code>'+esc(h.topResult||'\u2014')+'</code></td>' +
        '<td>'+h.resultCount+'</td>' +
        '<td class="ds-date">'+new Date(h.searchedAt).toLocaleString()+'</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    pane.innerHTML = html;
  }

  var aiChatHistory = loadStore('s247_aichat_history');
  if (aiChatHistory.length === 0) {
    aiChatHistory = [{ role: 'ai', text: 'Hi! I am your AI Agent. What would you like to automate or query today?' }];
  }

  window.clearAiChat = function() {
    if (!confirm('Clear AI Chat history?')) return;
    aiChatHistory = [{ role: 'ai', text: 'Hi! I am your AI Agent. What would you like to automate or query today?' }];
    saveStore('s247_aichat_history', aiChatHistory);
    renderAITab();
  };

  function renderAITab() {
    saveStore('s247_aichat_history', aiChatHistory);
    var pane = document.getElementById('resultsPane');
    var countEl = document.getElementById('resultCount');
    countEl.innerHTML = '<span style="color:#1d4ed8; font-weight:600;">✨ AI Agent Active</span>';
    
    var html = '<div class="ds-toolbar" style="margin-bottom:16px; border:none; padding:0; display:flex; justify-content:flex-end;">' +
                 '<button class="action-btn" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:6px 14px; font-size:12px; border-radius:6px;" onclick="clearAiChat()">&#128465; Clear Chat</button>' +
               '</div>';
    html += '<div class="ai-chat-container">';
    html += '<div class="ai-chat-messages" id="aiChatMessages">';
    aiChatHistory.forEach(function(msg) {
      if (msg.role === 'user') {
        html += '<div class="chat-msg chat-user"><div class="chat-bubble">' + esc(msg.text) + '</div></div>';
      } else {
        var contentHtml = msg.isHtml ? msg.text : (window.marked ? marked.parse(msg.text) : esc(msg.text).replace(/\n/g,'<br>'));
        html += '<div class="chat-msg chat-ai"><div class="chat-bubble markdown-body">' + contentHtml + '</div></div>';
      }
    });
    html += '</div>';
    
    html += '<div class="ai-chat-input-area">' +
              '<input type="text" id="aiChatInput" placeholder="e.g. Change the threshold profile of all my Windows servers" />' +
              '<button class="ai-chat-btn" onclick="sendAiMessage()">Send</button>' +
            '</div>';
    html += '</div>';
    pane.innerHTML = html;
    
    var msgsEl = document.getElementById('aiChatMessages');
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;

    var inputEl = document.getElementById('aiChatInput');
    if (inputEl) {
      inputEl.focus();
      inputEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') sendAiMessage();
      });
    }
  }

  function parseMD(md) {
    if (!md) return '';
    var html = esc(md);
    var b3 = String.fromCharCode(96, 96, 96);
    var b1 = String.fromCharCode(96);
    html = html.replace(new RegExp(b3 + '[a-z]*\\\n([\\\s\\\S]*?)' + b3, 'gi'), function(m, code) {
      return '<pre style="background:#1e293b; color:#e2e8f0; padding:10px; border-radius:6px; overflow-x:auto; margin:8px 0; font-family:monospace; font-size:11px; text-align:left;">' + code + '</pre>';
    });
    html = html.replace(new RegExp(b1 + '([^' + b1 + ']+)' + b1, 'g'), '<code style="background:#e2e8f0; color:#b91c1c; padding:2px 4px; border-radius:3px; font-family:monospace;">$1</code>');
    html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/\n/g, '<br/>');
    return html;
  }

  async function callLLM(messages) {
    var apiKey = window.__OPENAI_API_KEY__;
    var baseUrl = window.__OPENAI_BASE_URL__;
    var model = window.__OPENAI_MODEL__;
    if (!apiKey || !baseUrl) throw new Error("NO_API_KEY");
    
    var url = baseUrl.endsWith('/') ? baseUrl + 'chat/completions' : baseUrl + '/chat/completions';
    
    var res = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey 
      },
      body: JSON.stringify({ model: model, messages: messages, temperature: 0.7 })
    });
    
    if (!res.ok) {
      var text = await res.text();
      if (res.status === 429) throw new Error("Rate limit exceeded. Please wait a moment and try again.");
      if (res.status === 400) throw new Error("Bad Request. The API key might be invalid or the prompt was rejected.");
      if (res.status === 401 || res.status === 403) throw new Error("API Key is invalid or expired.");
      throw new Error("HTTP " + res.status + ": " + text);
    }
    
    return await res.json();
  }

  window.sendAiMessage = async function() {
    var inputEl = document.getElementById('aiChatInput');
    if (!inputEl) return;
    var txt = inputEl.value.trim();
    if (!txt) return;
    
    if (!window.__OPENAI_API_KEY__) {
      showToast('API Key not configured in build.');
      return;
    }
    
    aiChatHistory.push({ role: 'user', text: txt });
    var loadingIndex = aiChatHistory.length;
    aiChatHistory.push({ role: 'ai', text: 'Thinking...' });
    
    inputEl.value = '';
    renderAITab();

    try {
      var tokens = tokenize(txt);
      var allApisScored = [];
      if (aiWorkerReady) {
        var workerRes = await searchWorker(txt);
        var scoreMap = {};
        workerRes.forEach(function(r) { scoreMap[r.id] = r.score; });
        var qLower = txt.toLowerCase();
        allApisScored = apis.map(function(api) {
          var score = scoreMap[api.id] || 0;
          if ((qLower.indexOf('create')>-1 || qLower.indexOf('add')>-1 || qLower.indexOf('new')>-1 || qLower.indexOf('set up')>-1) && api.method === 'POST') score += 0.20;
          if ((qLower.indexOf('update')>-1 || qLower.indexOf('modify')>-1 || qLower.indexOf('change')>-1) && api.method === 'PUT') score += 0.20;
          if ((qLower.indexOf('delete')>-1 || qLower.indexOf('remove')>-1) && api.method === 'DELETE') score += 0.20;
          if ((qLower.indexOf('get')>-1 || qLower.indexOf('list')>-1 || qLower.indexOf('show')>-1) && api.method === 'GET') score += 0.20;
          score += (scoreResult(api, tokens) * 0.003);
          return {api:api, score:score};
        });
      } else {
        allApisScored = apis.map(function(api){ return {api:api, score:scoreResult(api,tokens)}; });
      }
      
      allApisScored = allApisScored
        .filter(function(r){ return r.score > 0.25; })
        .sort(function(a,b){ return b.score - a.score; })
        .slice(0, 5);
        
      var contextStr = allApisScored.map(function(r, idx) {
        var a = r.api;
        return "API " + (idx+1) + ":\n" +
               "Name/Desc: " + a.subFeature + " - " + a.description + "\n" +
               "Endpoint: " + a.method + " " + a.endpoint + "\n" +
               "Request Fields: " + (a.requestFields ? a.requestFields.join(', ') : 'None');
      }).join("\n\n");

      var systemPrompt = "You are an AI Agent for Site24x7 APIs. The user wants to perform an action.\n" +
        "Here are the top relevant Site24x7 API endpoints from our database for their request:\n\n" +
        contextStr + "\n\n" +
        "Instructions:\n" +
        "1. Identify the correct API(s) to use based on the context OR the previous conversation.\n" +
        "2. Generate the JSON payloads required for all necessary actions.\n" +
        "3. You MUST output ONLY a raw JSON object (do not use markdown or backticks) matching this schema:\n" +
        "{ \"explanation\": \"Overall explanation\", \"actions\": [ { \"method\": \"GET\", \"endpoint\": \"/app/api/..\", \"payload\": {}, \"explanation\": \"Why this step.\" } ] }\n" +
        "If the user is asking to modify or update the previous payload, simply output the updated JSON object in the actions array.\n" +
        "If the user is just making conversation (e.g. 'hello', 'thanks'), return: { \"reply\": \"Your conversational response here\" }\n" +
        "If they are asking for an API that doesn't exist and there is no previous context, return: { \"error\": \"No relevant API found.\" }";

      var messages = [
        { role: 'system', content: systemPrompt }
      ];
      aiChatHistory.forEach(function(msg, idx) {
        if (idx === 0) return; // Skip intro message
        if (idx >= loadingIndex - 1) return; // Skip the current user prompt and 'Thinking...' message
        
        var role = msg.role === 'ai' ? 'assistant' : 'user';
        var textContent = msg.rawText || msg.text;
        messages.push({ role: role, content: textContent });
      });
      
      messages.push({
        role: 'user',
        content: txt
      });

      var data = await callLLM(messages);
      
      if (data.error && data.error.message) {
        aiChatHistory[loadingIndex].text = "Error from AI: " + data.error.message;
      } else if (data.choices && data.choices[0].message) {
        var reply = data.choices[0].message.content.trim();
        var b3 = String.fromCharCode(96,96,96);
        if (reply.startsWith(b3 + 'json')) reply = reply.substring(7);
        if (reply.startsWith(b3)) reply = reply.substring(3);
        if (reply.endsWith(b3)) reply = reply.substring(0, reply.length - 3);
        
        try {
          var j = JSON.parse(reply);
          if (j.error) {
            aiChatHistory[loadingIndex] = { role: 'ai', text: j.error, rawText: reply };
          } else if (j.reply) {
            aiChatHistory[loadingIndex] = { role: 'ai', text: j.reply, rawText: reply };
          } else {
            var actions = j.actions || [];
            if (!j.actions && j.method) actions = [j]; // Fallback for single action
            
            if (actions.length === 0) {
              aiChatHistory[loadingIndex] = { role: 'ai', text: "No actions generated.", rawText: reply };
            } else {
              var cardHtml = '<div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">';
              if (j.explanation) {
                cardHtml += '<div class="ai-card-main-desc">' + esc(j.explanation) + '</div>';
              }
              
              actions.forEach(function(act) {
                var payloadStr = typeof act.payload === 'string' ? act.payload : JSON.stringify(act.payload, null, 2);
                var mCls = act.method ? act.method.toLowerCase() : 'other';
                
                var actHtml = '<div class="ai-act-card">';
                actHtml += '<div class="ai-act-header">';
                actHtml += '<span class="try-method-badge method-' + mCls + '">' + esc(act.method) + '</span>';
                actHtml += '<code class="ai-act-ep">' + esc(act.endpoint) + '</code>';
                actHtml += '</div>';
                actHtml += '<pre class="ai-act-payload">' + esc(payloadStr) + '</pre>';
                actHtml += '<div class="ai-act-desc">' + esc(act.explanation) + '</div>';
                
                window.aiExecActions = window.aiExecActions || [];
                var actionId = window.aiExecActions.length;
                window.aiExecActions.push({ method: act.method, endpoint: act.endpoint, payload: payloadStr, index: loadingIndex });
                
                var btnClick = "executeAiAction(" + actionId + ")";
                actHtml += '<div class="ai-act-footer" style="display:flex; flex-direction:column; gap:8px;">';
                actHtml += '<input type="text" autocomplete="off" id="ai-query-' + actionId + '" placeholder="Query String (Optional, e.g. period=1)" style="padding:6px 10px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px; font-family:monospace;" />';
                actHtml += '<button class="ai-chat-btn" style="align-self:flex-start;" onclick="' + btnClick + '">Execute Request &#9654;</button>';
                actHtml += '</div>';
                actHtml += '<div id="ai-exec-result-' + actionId + '"></div>';
                actHtml += '</div>';
                
                cardHtml += actHtml;
              });
              
              cardHtml += '</div>';
              aiChatHistory[loadingIndex] = { role: 'ai', text: cardHtml, isHtml: true, rawText: reply };
            }
          }
        } catch(err) {
          aiChatHistory[loadingIndex] = { role: 'ai', text: "Parse error: " + err.message + "\n\nRaw Output:\n" + reply, rawText: reply };
        }
      }
    } catch (e) {
      if (e.message === "NO_API_KEY") {
        aiChatHistory[loadingIndex] = { 
          role: 'ai', 
          text: "<strong>Hold up!</strong> I need an AI API key to function.<br><br><button class='ai-chat-btn' style='background:#f59e0b;color:#fff;border:none;' onclick='openSettings()'>&#9881; Open Settings</button>", 
          isHtml: true, 
          rawText: "Error" 
        };
      } else {
        aiChatHistory[loadingIndex] = { role: 'ai', text: "&#10071; **API Error:** " + e.message, rawText: "Error" };
      }
    }
    
    renderAITab();
  };

  window.executeAiAction = function(actionId) {
    var action = window.aiExecActions[actionId];
    if (!action) return;
    
    var method = action.method;
    var endpoint = action.endpoint;
    
    var matches = endpoint.match(/\{[^}]+\}|\<[^>]+\>/g);
    if (matches) {
      for (var i = 0; i < matches.length; i++) {
        var placeholder = matches[i];
        var val = prompt("Please provide a value for " + placeholder + " in the URL:");
        if (val === null) return;
        if (val.trim() === "") {
          alert("A value is required for " + placeholder);
          return;
        }
        endpoint = endpoint.replace(placeholder, encodeURIComponent(val.trim()));
      }
    }
    var payloadStr = action.payload;
    var loadingIndex = action.index;
    
    var aiQueryInput = document.getElementById('ai-query-' + actionId);
    if (aiQueryInput && aiQueryInput.value.trim()) {
      var qs = aiQueryInput.value.trim();
      if (!qs.startsWith('?')) qs = '?' + qs;
      endpoint += qs;
    }
    
    var fullUrl = (endpoint.startsWith('http://') || endpoint.startsWith('https://')) ? endpoint : 'https://www.site24x7.com' + endpoint;
    var proxyTarget = PROXY_URL + '/proxy?url=' + encodeURIComponent(fullUrl);

    var resultDiv = document.getElementById('ai-exec-result-' + actionId);
    if (resultDiv) {
      resultDiv.innerHTML = '<div class="try-loading" style="padding:16px; background:#fff; border:1px solid #e5e7eb; border-radius:8px; margin-top:8px;">&#9203; Executing ' + esc(method) + ' ' + esc(endpoint) + '…</div>';
    }
    
    var fetchOpts = { method: method.toUpperCase() };
    if (fetchOpts.method !== 'GET' && payloadStr && payloadStr.trim() !== '' && payloadStr.trim() !== '{}') {
      fetchOpts.body = payloadStr;
      fetchOpts.headers = { 'Content-Type': 'application/json' };
    }

    fetch(proxyTarget, fetchOpts)
      .then(function(r) {
        var status = r.status;
        return r.text().then(function(body) { return { status: status, body: body }; });
      })
      .then(function(result) {
        var pretty = result.body;
        try { pretty = JSON.stringify(JSON.parse(result.body), null, 2); } catch(e){}
        var statusCls = result.status < 300 ? 'try-status-ok' : result.status < 500 ? 'try-status-warn' : 'try-status-err';
        var html = '<div style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; margin-top:8px; background:#0f172a;">' +
            '<div class="try-resp-header" style="display:flex; align-items:center;">' +
              '<span class="try-method-badge method-' + fetchOpts.method.toLowerCase() + '">' + esc(fetchOpts.method) + '</span>' +
              '<code class="try-ep">' + esc(endpoint) + '</code>' +
              '<span class="try-status ' + statusCls + '">' + result.status + '</span>' +
              '<button class="copy-json-btn" onclick="navigator.clipboard.writeText(decodeURIComponent(\'' + encodeURIComponent(pretty) + '\')); this.innerHTML=\'&#10004; Copied!\'; setTimeout(()=>this.innerHTML=\'&#128203; Copy JSON\', 2000)" style="margin-left:auto; background:#3b82f6; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:11px; font-weight:600; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.1);">&#128203; Copy JSON</button>' +
            '</div>' +
            '<pre class="try-body">' + esc(pretty) + '</pre>' +
          '</div>';
        if (resultDiv) resultDiv.innerHTML = html;
        var wrapperId = 'ai-exec-wrapper-' + actionId;
        if (aiChatHistory[loadingIndex] && aiChatHistory[loadingIndex].text) {
           if (aiChatHistory[loadingIndex].text.indexOf('id="' + wrapperId + '"') !== -1) {
               var regex = new RegExp('<div id="' + wrapperId + '">[\\s\\S]*?</div><!--end-' + wrapperId + '-->');
               aiChatHistory[loadingIndex].text = aiChatHistory[loadingIndex].text.replace(regex, '<div id="' + wrapperId + '">' + html.replace(/\\$/g, '$$$$') + '</div><!--end-' + wrapperId + '-->');
           } else {
               aiChatHistory[loadingIndex].text += '<div id="' + wrapperId + '">' + html + '</div><!--end-' + wrapperId + '-->';
           }
        }
        summarizeExecution(actionId, result.body, result.status);
      })
      .catch(function(err) {
        var errHtml = '<div class="try-error" style="margin-top:8px;">&#9888; Proxy Request failed: ' + esc(err.message) + '</div>';
        if (resultDiv) resultDiv.innerHTML = errHtml;
        var wrapperId = 'ai-exec-wrapper-' + actionId;
        if (aiChatHistory[loadingIndex] && aiChatHistory[loadingIndex].text) {
           if (aiChatHistory[loadingIndex].text.indexOf('id="' + wrapperId + '"') !== -1) {
               var regex = new RegExp('<div id="' + wrapperId + '">[\\s\\S]*?</div><!--end-' + wrapperId + '-->');
               aiChatHistory[loadingIndex].text = aiChatHistory[loadingIndex].text.replace(regex, '<div id="' + wrapperId + '">' + errHtml.replace(/\\$/g, '$$$$') + '</div><!--end-' + wrapperId + '-->');
           } else {
               aiChatHistory[loadingIndex].text += '<div id="' + wrapperId + '">' + errHtml + '</div><!--end-' + wrapperId + '-->';
           }
        }
      });
  };

  window.summarizeExecution = async function(actionId, apiResponseRaw, status) {
    var action = window.aiExecActions[actionId];
    if (!action) return;
    
    if (!window.__OPENAI_API_KEY__) return;

    var summaryIndex = aiChatHistory.length;
    aiChatHistory.push({ role: 'ai', text: 'Analyzing response...' });
    renderAITab();

    try {
      var systemPrompt = "You are a Site24x7 AI Agent. You just executed this API endpoint: " + action.method + " " + action.endpoint + "\n" +
        "The HTTP status code was: " + status + "\n" +
        "Here is the raw JSON response from the server:\n" + apiResponseRaw + "\n\n" +
        "Instructions:\n" +
        "1. Write a 1 to 2 sentence plain English summary of whether the action succeeded or failed.\n" +
        "2. If it succeeded, extract and mention 1 or 2 key pieces of data (like the created ID, name, or count).\n" +
        "3. Do NOT output raw JSON or code blocks. Just output a friendly text message to the user.";

      var data = await callLLM([
        { role: 'user', content: systemPrompt }
      ]);
      
      if (data.error && data.error.message) {
        aiChatHistory[summaryIndex] = { role: 'ai', text: "Analysis error: " + data.error.message, rawText: data.error.message };
      } else if (data.choices && data.choices[0].message) {
        var reply = data.choices[0].message.content.trim();
        aiChatHistory[summaryIndex] = { role: 'ai', text: "&#128161; **Summary:** " + reply, rawText: reply };
      } else {
        aiChatHistory[summaryIndex] = { role: 'ai', text: "Could not analyze response.", rawText: "Error" };
      }
    } catch (e) {
      if (e.message === "NO_API_KEY") {
        aiChatHistory[summaryIndex] = { 
          role: 'ai', 
          text: "<em>(Summary skipped - No AI API key configured)</em>", 
          isHtml: true, 
          rawText: "Error" 
        };
      } else {
        aiChatHistory[summaryIndex] = { role: 'ai', text: "&#10071; **Analysis Error:** " + e.message, rawText: "Error" };
      }
    }
    
    renderAITab();
  };

  function renderActiveTab() {
    if (activeTab === 'dataset') renderDatasetTab();
    else if (activeTab === 'history') renderHistoryTab();
    else if (activeTab === 'ai') renderAITab();
    else renderResults();
  }

  window.replaySearch = function(q) {
    document.getElementById('searchInput').value = q;
    query = q;
    currentPage = 1;
    activeTab = 'results';
    setTabActive('results');
    document.getElementById('clearBtn').style.visibility = 'visible';
    renderResults();
  };



  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      setTabActive(btn.dataset.tab);
      renderActiveTab();
    });
  });

  if (document.getElementById('themeToggleBtn')) {
    var themeBtn = document.getElementById('themeToggleBtn');
    themeBtn.addEventListener('click', function() {
      var isDark = document.body.classList.toggle('dark-mode');
      localStorage.setItem('site24x7_theme', isDark ? 'dark' : 'light');
      themeBtn.innerHTML = '<span class="settings-icon">' + (isDark ? '&#9789;' : '&#9728;') + '</span>';
    });
    if (localStorage.getItem('site24x7_theme') === 'dark') {
      document.body.classList.add('dark-mode');
      themeBtn.innerHTML = '<span class="settings-icon">&#9789;</span>';
    }
  }

  buildModuleChips();
  buildSidebar();
  renderResults();
  updateBadges();
  document.getElementById('hTotalCount').textContent = apis.length + ' endpoints';
})();