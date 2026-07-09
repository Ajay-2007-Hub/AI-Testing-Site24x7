# Site24x7 AI Directory: Complete Project Report

![Main UI](assets/hero_ui.png)

An AI-powered search interface and development testing tool for exploring, executing, and testing all **2,528 API endpoints** across the **Admin** and **Reports** modules of the [Site24x7 API](https://www.site24x7.com/app/demo). 

### 🔌 Live API Execution
The secure Node.js proxy server tunnels requests to Site24x7, completely bypassing CORS and allowing you to perform live REST mutations seamlessly from the UI.
![Live API Testing](assets/live_testing.png) 

### 🤖 Generative AI Agent
The embedded AI Chat Agent uses conversational memory to understand vague queries and instantly generate executable API JSON payloads right in the browser.
![AI Agent](assets/ai_agent.png)

This document outlines the entire development lifecycle of the Site24x7 AI Directory, broken down across distinct implementation phases. The architecture utilizes a local Node.js proxy and build pipeline coupled with a vanilla, zero-dependency (almost) client-side frontend to achieve a lightning-fast, offline-capable search engine and execution layer.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v16 or later

### Install dependencies
```bash
npm install
```

### Build & Run
```bash
npm start
```
This builds `index.html` from the source data and serves it at **http://localhost:3333**.

---

## 📁 Project Structure

```
├── reports_subsections_list.txt      ← Source of truth for Reports hierarchy
├── site24x7_compact.json             ← Minified JSON database of all 2,528 endpoints
├── site24x7_Dataset.csv              ← 7,148 synthetically generated semantic queries
├── site24x7_vector.json              ← 78 MB HuggingFace dense vector database
├── generate_html.js                  ← Builds the frontend application
├── proxy.js                          ← Secure local CORS proxy for live API testing
├── build_embeddings.js               ← Generates vector embeddings for semantic search
├── generate_synthetic_dataset.js     ← Autonomous Azure OpenAI baseline data generator
├── generate_massive_dataset.js       ← Autonomous massive-scale dataset generator
├── map_endpoints.js                  ← Maps raw HAR logs to modular categories
├── evaluate_vectors.js               ← Mathematical evaluation script for search precision
├── Final_Project_Evaluation.txt      ← Consolidated log of all mathematical accuracy tests
├── Project_Report.md                 ← The complete 18-phase development lifecycle journal
├── src/
│   ├── template.html                 ← Application HTML structure
│   ├── styles.css                    ← Application CSS styles
│   └── client.js                     ← Core application logic & UI handlers
└── index.html                        ← The generated frontend search app
```

## 📈 Deep Technical Architecture

This project was engineered from the ground up to minimize external dependencies, maximize client-side rendering speed, and completely circumvent browser security restrictions (CORS) during live API mutation testing.

### 1. Hybrid Semantic Search Engine
The core discovery mechanism utilizes a heavily customized hybrid search algorithm, natively blending dense vector search with sparse keyword fallback:
- **Dense Vector Embedding (`Transformers.js`)**: The Node.js proxy server (`proxy.js`) autonomously loads a 78 MB dense vector database into a V8 heap map upon startup. It utilizes the `Xenova/all-MiniLM-L6-v2` transformer model to convert arbitrary natural language search queries into 384-dimensional floating-point arrays. It then computes the **Cosine Similarity** (`(A·B) / (||A||*||B||)`) against 7,148 pre-calculated vectors in real-time, yielding instantaneous semantic matches regardless of exact phrasing.
- **Sparse BM25 Fallback**: For technical nomenclature (e.g., specific resource IDs or exact field names), the system implements a lightweight TF-IDF / BM25 probabilistic model to boost exact string matches.
- **Intent Boosting Engine**: A custom weighting layer parses HTTP verbs from the query (e.g., "delete", "create", "fetch") and mathematically amplifies the ranking of corresponding `DELETE`, `POST`, or `GET` endpoints, preventing catastrophic UI hallucinations.

### 2. Live Node.js Tunneling (CORS Proxy)
Browsers strictly prohibit cross-origin `fetch` calls to `site24x7.com` without proper `Access-Control-Allow-Origin` headers. To bypass this, the frontend routes all live API executions to `http://localhost:3334/proxy`.
- **Header Injection**: The proxy safely extracts the user's `JSESSIONID` and OAuth tokens and securely injects them into the HTTP Request headers. 
- **CSRF Token Extraction**: The proxy runs a RegEx parser over the session cookie to dynamically extract the `CT_CSRF_TOKEN` and passes it as a strict security header, circumventing Zoho's internal Cross-Site Request Forgery defenses.

### 3. Contextual RAG Chat Agent
The floating AI Agent utilizes an Azure OpenAI schema to orchestrate complex JSON mutations:
- **Conversational Memory Buffer**: The UI stores the `role: "user"` and `role: "assistant"` messaging history locally.
- **RAG Context Window**: The Semantic Search Engine automatically extracts the Top 3 most mathematically relevant API schemas and forces them into the `system` prompt block, anchoring the LLM's reality to the specific endpoints required to fulfill the user's request.

### 4. Zero-Dependency SPA Rendering
The frontend UI (`index.html`) is built using raw Vanilla JS and HTML5.
- The `generate_html.js` build script statically compiles the massive dataset into memory during the `npm run build` phase, producing a highly optimized 8 KB footprint.
- DOM nodes for the 2,500+ endpoints are lazily rendered into virtual document fragments before paint, completely eliminating main-thread blocking and ensuring a solid 60 FPS scrolling experience.

> **Note:** For a full, detailed breakdown of the 18-phase development lifecycle of this project, please refer to the `Project_Report.md` file.

---

## 💾 Data Source Engineering
The foundational dataset was reverse-engineered through a dual-pronged approach:
1. **Static Analysis**: Extracting core configuration metadata from the provided `site24x7_Admin_API.xlsx` sheet (now scrubbed for security).
2. **Network Protocol Analysis**: Capturing massive `HAR` (HTTP Archive) network traces directly from the Site24x7 Web Client. Custom Node.js parsers (`parse_har.js`, `map_endpoints.js`) were built to algorithmically traverse the HAR blobs, isolate unique API endpoints, strip out telemetry noise, and map the remaining endpoints to their respective parent modules based on structural URL similarity.
