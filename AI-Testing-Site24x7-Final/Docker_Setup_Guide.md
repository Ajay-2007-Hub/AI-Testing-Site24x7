# Docker Setup & Migration Log

This document tracks the changes made to containerize the AI-Testing-Site24x7 application and resolve the Redis vector database setup issues.

## 1. Codebase Modifications
- **`proxy.js`**: Updated the Redis client initialization (`createClient()`) to accept a connection URL via the `REDIS_URL` environment variable. This allows the Node.js server inside the Docker container to connect to the separate Redis container rather than looking for a local instance.
- **`migrate_to_redis.js`**: Similarly updated the Redis client to use the `REDIS_URL` environment variable.
- **`package.json`**: Downgraded the `redis` dependency from `^6.1.0` to `^4.6.14`. Version 6 of the Redis Node client introduced breaking changes (e.g., renaming `SchemaFieldTypes` to `SCHEMA_FIELD_TYPE`), which was causing the migration script to crash.

## 2. Docker Files Added
- **`Dockerfile`**: Defines the Node.js environment (`node:18-alpine`), installs dependencies, copies the source code, and sets up port exposures (`3333` for frontend, `3334` for the proxy server).
- **`docker-compose.yml`**: Wires three services together:
  1. **`redis`**: Uses `redis/redis-stack-server:latest` to ensure the RediSearch and RedisJSON modules are available for vector storage.
  2. **`proxy`**: Runs the backend semantic search proxy and connects to the Redis container.
  3. **`frontend`**: Serves the `index.html` frontend UI.
- **`.dockerignore`**: Added to exclude `node_modules` and hidden directories (like `.git`) from being transferred to the Docker engine during builds, drastically reducing the build time from minutes down to seconds.

## 3. How to Run the Application
Because we are using Docker Compose, the application runs entirely in the background. You do not need to run `npm start` manually!

1. **Start the containers**:
   ```bash
   docker-compose up -d --build
   ```
2. **Access the Frontend Application**:
   Open your browser and navigate to: [http://localhost:3333](http://localhost:3333)

### Useful Docker Commands
- **View logs for the proxy server**: `docker-compose logs -f proxy`
- **Stop all services**: `docker-compose down`
