FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts && npm rebuild
COPY . .
CMD ["npm", "run", "dev", "--", "--host"]
