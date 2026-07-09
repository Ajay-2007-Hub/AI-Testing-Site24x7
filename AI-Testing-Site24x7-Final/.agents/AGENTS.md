# Security Rules

- **NEVER expose API keys, credentials, or internal IPs** in source code, template files, or version control.
- Ensure all environment files (e.g., `.env`) and artifacts containing secrets (e.g., `index.html` after build injection) are strictly ignored in `.gitignore`.
- Always replace real credentials with placeholders (like `your_api_key_here`) in example files (e.g., `.env.example`).
- This project is strictly for internal use, so maintain strict security hygiene to ensure no sensitive configurations are ever visible on GitHub.
