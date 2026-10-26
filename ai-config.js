/* ==========================================================================
   ai-config.js —— AI 挂件的开关与接入点（唯一需要站长手填的文件）
   --------------------------------------------------------------------------
   做什么
   ------
   给 ai-chat.js 提供 endpoint（Cloudflare Worker URL）。Worker 部署
   见 ai-worker/README.md（两分钟：wrangler login → deploy）。

   未配置时（endpoint 为空 / 文件原样）：ai-chat.js 判定功能关闭，
   挂件完全不渲染——先推前端代码也不出半截 UI，部署完 Worker 填上
   这一行即可上线。

   ⚠️ 为什么 endpoint 可以公开而 API key 不行
   -------------------------------------------
   Worker URL 只是「我家门口」：所有防刷措施（CORS 白名单、限流、
   输入校验、token 上限）都在 Worker 层，见 ai-worker/src/worker.js。
   任何人拿这个 URL 直接刷，撞的是 Worker 的限流墙，不是计费 key。
   ========================================================================== */
window.SXG_AI_CONFIG = {
  // 部署 ai-worker 后，把下面引号里换成你的 Worker URL（含 https://）。
  // 例：'https://shuangxiugou-ai-worker.your-subdomain.workers.dev'
  endpoint: ''
};
