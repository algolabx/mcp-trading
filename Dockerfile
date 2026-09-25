# Chạy MCP server qua stdio trong container — cho Glama/trình kiểm tra MCP liệt kê công cụ.
# Chưa liên kết CTCK vẫn khởi động và liệt kê đủ 9 công cụ; gọi công cụ tài khoản sẽ trả hướng dẫn liên kết.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENTRYPOINT ["node", "src/index.js"]
