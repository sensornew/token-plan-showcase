// 当前价格基线数据 — 用于价格变动检测对比
// 每个厂商的当前价格快照，监控脚本会对比实际价格与此基线

export const currentPriceBaseline = {
  lastUpdated: '2026-08-15',
  providers: [
    { name: 'DeepSeek', model: 'V4 Flash', inputRMB: 1.5, outputRMB: 4.5, context: '1M', url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing' },
    { name: 'DeepSeek', model: 'V4 Pro', inputRMB: 4.5, outputRMB: 13.5, context: '1M', url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing' },
    { name: '阿里云 Qwen', model: 'qwen-turbo', inputRMB: 0.3, outputRMB: 0.6, context: '1M', url: 'https://help.aliyun.com/zh/model-studio/getting-started/models' },
    { name: 'OpenAI', model: 'GPT-5.5', inputUSD: 5.0, outputUSD: 30.0, context: '200K', url: 'https://openai.com/api/pricing/' },
    { name: 'Anthropic', model: 'Claude Opus 4.6', inputUSD: 5.0, outputUSD: 25.0, context: '1M', url: 'https://docs.anthropic.com/en/docs/about-claude/models' },
    { name: 'Google', model: 'Gemini 3.7 Flash', inputUSD: 0.75, outputUSD: 3.75, context: '1M', url: 'https://ai.google.dev/gemini-api/docs/pricing' },
    { name: '智谱 GLM', model: 'GLM-4-Flash', inputRMB: 0, outputRMB: 0, context: '128K', url: 'https://open.bigmodel.cn/pricing' },
    { name: 'Mistral', model: 'Ministral 8B', inputUSD: 0.10, outputUSD: 0.10, context: '128K', url: 'https://mistral.ai/products/la-plateforme#pricing' },
    { name: '字节豆包', model: 'doubao-2.0-lite', inputRMB: 0.6, outputRMB: 3.6, context: '32K', url: 'https://www.volcengine.com/product/doubao' },
    { name: 'Groq', model: 'Llama 3.1 8B', inputUSD: 0.05, outputUSD: 0.08, context: '128K', url: 'https://groq.com/pricing/' },
    { name: '百度文心', model: 'ERNIE Speed', inputRMB: 0, outputRMB: 0, context: '8K', url: 'https://cloud.baidu.com/product/wenxinworkshop' },
    { name: '腾讯混元', model: 'hunyuan-lite', inputRMB: 0, outputRMB: 0, context: '256K', url: 'https://cloud.tencent.com/product/hunyuan' },
    { name: 'xAI', model: 'Grok 4.1 Fast', inputUSD: 0.20, outputUSD: 0.50, context: '2M', url: 'https://x.ai/api' },
    { name: 'Moonshot Kimi', model: 'moonshot-v1-8k', inputRMB: 12, outputRMB: 12, context: '8K', url: 'https://platform.moonshot.cn/pricing' },
    { name: 'Cohere', model: 'Command R', inputUSD: 0.15, outputUSD: 0.60, context: '128K', url: 'https://cohere.com/pricing' },
    { name: 'Together AI', model: 'Llama 3.3 70B', inputUSD: 0.59, outputUSD: 0.79, context: '128K', url: 'https://www.together.ai/pricing' },
    { name: 'Perplexity', model: 'sonar-pro', inputUSD: 3.0, outputUSD: 15.0, context: '200K', url: 'https://docs.perplexity.ai/pricing' },
    { name: 'MiniMax', model: 'abab6.5s', inputRMB: 2.5, outputRMB: 2.5, context: '245K', url: 'https://platform.minimaxi.com/document/Price' },
    { name: '百川 Baichuan', model: 'Baichuan4', inputRMB: 10, outputRMB: 10, context: '192K', url: 'https://platform.baichuan-ai.com/price' },
    { name: '零一万物 Yi', model: 'yi-large', inputRMB: 20, outputRMB: 20, context: '16K', url: 'https://platform.lingyiwanwu.com/pricing' },
    { name: '讯飞星火', model: 'spark4.0', inputRMB: 30, outputRMB: 30, context: '8K', url: 'https://www.xfyun.cn/pricing' },
    { name: '商汤 SenseNova', model: 'nova-4.0', inputRMB: 120, outputRMB: 120, context: '8K', url: 'https://platform.sensenova.cn/pricing' },
  ],
};

// 厂商官方定价页 URL — 用于自动抓取检测
export const providerPricingUrls = {
  'DeepSeek': 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
  '阿里云 Qwen': 'https://help.aliyun.com/zh/model-studio/getting-started/models',
  'OpenAI': 'https://openai.com/api/pricing/',
  'Anthropic': 'https://docs.anthropic.com/en/docs/about-claude/models',
  'Google': 'https://ai.google.dev/gemini-api/docs/pricing',
  '智谱 GLM': 'https://open.bigmodel.cn/pricing',
  'Mistral': 'https://mistral.ai/products/la-plateforme#pricing',
  '字节豆包': 'https://www.volcengine.com/product/doubao',
  'Groq': 'https://groq.com/pricing/',
  '百度文心': 'https://cloud.baidu.com/product/wenxinworkshop',
  '腾讯混元': 'https://cloud.tencent.com/product/hunyuan',
  'xAI': 'https://x.ai/api',
  'Moonshot Kimi': 'https://platform.moonshot.cn/pricing',
};
