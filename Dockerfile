FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Build the frontend HTML
RUN npm run build

# Expose ports for both frontend and proxy
EXPOSE 3333 3334

# Default command (overridden by docker-compose for the proxy)
CMD ["npm", "run", "serve"]
