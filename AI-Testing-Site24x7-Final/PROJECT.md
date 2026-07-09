# Site24x7 AI API Search — Project Documentation

## Overview

This project is an **AI-powered search and testing tool** for Site24x7 Admin APIs. It allows engineers to search across 9,600+ API endpoints using either traditional **keyword search** or a state-of-the-art **semantic (AI) search** engine — entirely in a self-contained, Dockerized environment.

The primary goal was to enable a manager to use this tool via a shared URL without needing to install Node.js, Redis, or any other tool locally.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose Stack                      │
│                                                             │
│  ┌──────────────────┐     ┌────────────────────────────┐   │
│  │   frontend-1     │     │        proxy-1             │   │
│  │  (Port 3333)     │────▶│      (Port 3334)           │   │
│  │  Static HTML/JS  │     │  Node.js Semantic Engine   │   │
│  │  index.html      │     │  + API Proxy to site24x7   │   │
│  └──────────────────┘     └────────────────────────────┘   │
│                                         │                   │
│                                  site24x7_vector.json       │
│                               (77MB in-memory vector DB)    │
└─────────────────────────────────────────────────────────────┘
```

> **Note on Redis:** Redis (`redis/redis-stack-server`) is still listed in `docker-compose.yml` as a service but is **no longer used** by the semantic search engine. It was originally planned for vector storage, but was replaced by a pure JavaScript in-memory cosine similarity engine to eliminate RediSearch syntax errors that caused 0 results.

---

## How the Semantic Search Works

The AI search engine is powered by the **`Xenova/all-MiniLM-L6-v2`** model — a compact, fast sentence-embedding transformer model that runs 100% locally on Node.js (no API keys or internet required at runtime).

### Pipeline

1. **Data Collection** → `extracted_api_endpoints.json` (raw HAR parse of Site24x7 network traffic)
2. **Data Processing** → `build_data.js`, `compact_data.js`, `map_endpoints.js`
3. **Embedding Generation** → `build_embeddings.js` → produces **`site24x7_vector.json`** (77MB)
4. **Runtime Search** → `proxy.js` loads all 9,600 vectors into memory on startup and computes **cosine similarity** between the query and every stored vector

### Why Semantic > Keyword

| | Keyword Search | Semantic Search |
|---|---|---|
| **How it works** | Matches exact words via TF-IDF | Understands meaning via AI embeddings |
| **Query: "website broken"** | Returns 294 results (matches any word) | Returns top 50 most *contextually relevant* APIs |
| **Noise level** | Very high — lots of irrelevant results | Very low — AI filters by meaning |
| **Speed** | Instant | ~1-2 seconds (model warm-up on first query) |

---

## Key Files

| File | Purpose |
|---|---|
| `index.html` | Frontend UI — search interface for all APIs |
| `proxy.js` | Node.js backend — semantic search engine + API proxy to site24x7.com |
| `Dockerfile` | Docker image definition (Node 18 slim) |
| `docker-compose.yml` | Orchestrates frontend + proxy + (legacy) Redis containers |
| `site24x7_vector.json` | 77MB pre-computed AI vector database for all 9,600+ APIs |
| `tfidf_index.json` | TF-IDF index powering the keyword search |
| `build_embeddings.js` | One-time script used to generate `site24x7_vector.json` |
| `migrate_to_redis.js` | Legacy script — no longer needed (Redis not used for search) |
| `evaluate_search.js` | Script to evaluate and benchmark search quality |

---

## Proxy Server Endpoints

The `proxy.js` server listens on **port 3334** and exposes these endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/status` | Health check — confirms proxy is alive |
| `POST` | `/settings` | Saves the Site24x7 session cookie for API forwarding |
| `GET` | `/semantic_search?q=<query>` | Returns top 50 semantically matched API IDs + similarity scores |
| `*` | `/proxy?url=<url>` | Forwards authenticated requests to `www.site24x7.com` |

---

## Running Locally (Docker)

Make sure Docker Desktop is running, then:

```bash
# First time — build and start all services
docker-compose up -d --build

# After code changes — rebuild only the proxy
docker-compose up -d --build proxy

# View proxy logs in real-time
docker-compose logs -f proxy

# Stop everything
docker-compose down
```

- **Frontend UI:** http://localhost:3333
- **Proxy API:** http://localhost:3334

---

## Data & Vector Database

The `site24x7_vector.json` file (77MB) is the pre-computed AI vector database. It was generated **once** using `build_embeddings.js` and does not need to be regenerated unless the API dataset changes.

Each entry in the file maps an `api_id` (integer) to one or more embedding vectors (arrays of 384 floats). At runtime, the proxy loads the entire file into RAM and runs brute-force cosine similarity against the query embedding.

> **The file is large (77MB) and is excluded from Git** via `.gitignore`. It must be present in the project root for semantic search to work.

---

## Current Status

| Feature | Status |
|---|---|
| Keyword Search | ✅ Working |
| Semantic Search | ✅ Working (in-memory cosine similarity) |
| API Proxy to site24x7.com | ✅ Working |
| Dockerized setup | ✅ Working |
| Redis Vector Search | ❌ Abandoned (replaced by in-memory JS) |
| Deployment to Render | ⏳ Planned — next step |

---

## Next Step: Deploy to Render

To allow your manager to access this tool via a public URL without any local setup, the app needs to be deployed to **Render.com** as a Web Service. This requires:

1. Adding a `render.yaml` config file to the repo
2. Pushing to GitHub
3. Linking the repo on render.com → 1-click deploy
