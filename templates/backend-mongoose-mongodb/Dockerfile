# Use the latest stable Node.js LTS image
FROM node:22-alpine

# Set working directory inside the container
WORKDIR /usr/src/app

# Copy only package.json and package-lock.json first (layer caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the source code
COPY . .

# Expose the app port
EXPOSE 3000

# Correct way to run the dev server (usually "dev" is a script)
CMD ["npm", "run", "start"]