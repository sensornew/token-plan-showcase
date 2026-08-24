# TokenPlan 价格预警后端服务

## 快速开始

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 配置邮件服务

复制配置模板并填写你的邮件信息：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填写以下任一邮件方案：

**方案 A：SMTP（推荐 QQ 邮箱）**
```
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your_email@qq.com
SMTP_PASS=your_smtp_authorization_code
MAIL_FROM_ADDRESS=your_email@qq.com
```
> QQ 邮箱授权码获取：设置 → 账户 → POP3/SMTP 服务 → 开启 → 获取授权码

**方案 B：Resend API**
```
RESEND_API_KEY=re_xxxxxxxx
RESEND_FROM=onboarding@resend.dev
```

**不配置？** 开发模式自动使用 Ethereal 测试邮箱，邮件预览链接输出到控制台。

### 3. 启动服务

```bash
npm start
```

服务启动在 `http://localhost:3210`

### 4. 启动价格监控（可选）

```bash
npm run monitor          # 持续监控模式（每小时检查一次）
node price-monitor.js --once  # 单次检查
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/health` | 健康检查 + 统计信息 |
| POST | `/api/subscribe` | 订阅价格预警 |
| GET  | `/api/unsubscribe?token=xxx` | 退订 |
| GET  | `/api/price-history` | 获取价格变动历史 |
| POST | `/api/price-change` | 添加价格变动（触发通知邮件） |
| POST | `/api/test-email` | 发送测试邮件 |
| GET  | `/api/stats` | 获取统计信息 |

### 订阅示例

```bash
curl -X POST http://localhost:3210/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","providers":["DeepSeek","OpenAI"],"alertTypes":["price-drop","new-model"]}'
```

### 触发价格变动通知示例

```bash
curl -X POST http://localhost:3210/api/price-change \
  -H "Content-Type: application/json" \
  -d '{"provider":"DeepSeek","model":"V4 Flash","type":"drop","change":"输入 ¥1.5 → ¥1.2","note":"非高峰时段降价"}'
```

## 数据存储

- 订阅数据：`server/data/subscriptions.json`
- 无需数据库，JSON 文件持久化

## 邮件模板

- 欢迎确认邮件：订阅成功后自动发送
- 价格变动通知：检测到价格变动时自动发送给匹配的订阅用户
- 邮件包含退订链接，用户可随时退订
