/* ==========================================================================
   ai-config.js —— AI 挂件的开关与接入点（唯一需要站长手填的文件）
   --------------------------------------------------------------------------
   做什么
   ------
   给 ai-chat.js 提供**两条线路**的接入点：

     ① endpoint   —— 线路 cf：Cloudflare Worker（ai-worker/）
     ② endpointCN —— 线路 cn：阿里云函数计算 FC（ai-worker-aliyun/）

   分流规则（见 ai-chat.js，2026-11-13 站长指令）
   ----------------------------------------------
   - 形象 A / B / C（索引 0-2）→ 走 endpoint（Cloudflare）
   - 形象 D / E / F（索引 3-5）→ 走 endpointCN（阿里云）
   - **空则回落**：endpointCN 还是空串时，D/E/F 自动回落走 Cloudflare，
     面板里会明说「阿里云未配置，本次已回落」，不静默、不报错、不装死。
   - 两条线路都为空 → 才算「AI 未开通」（stub 态：按钮照常显示 + 提示开通中）。

   为什么分两条线路
   ----------------
   Cloudflare Workers 在国内网络常年需要 VPN；阿里云函数计算是境内直连，
   配好后 D/E/F 三个形象无需任何代理。阿里云侧的部署步骤（开通百炼 /
   DashScope 拿 API Key → 建函数 → 配环境变量 → 拿公网地址）见
   ai-worker-aliyun/README.md，拿到地址后只改下面 endpointCN 一行即可上线。

   ⚠️ 为什么两个地址都可以公开而 API key 不行
   -------------------------------------------
   线路地址只是「我家门口」：所有防刷措施（CORS 白名单、限流、
   输入校验、token 上限）都在服务端那一层——Cloudflare 侧见
   ai-worker/src/worker.js，阿里云侧见 ai-worker-aliyun/index.mjs。
   任何人拿地址直接刷，撞的是限流墙，不是计费 key。真正的 key 只存在于
   阿里云函数的环境变量里（DASHSCOPE_API_KEY），前端与仓库都不出现。
   ========================================================================== */
window.SXG_AI_CONFIG = {
  // 线路 cf（Cloudflare Worker）：形象 A / B / C 走这里。
  // 例：'https://shuangxiugou-ai-worker.your-subdomain.workers.dev'
  endpoint: 'https://shuangxiugou-ai-worker.ovpj01-hk.workers.dev',

  // 线路 cn（阿里云函数计算 FC）：形象 D / E / F 走这里。
  // 部署 ai-worker-aliyun/ 后把公网地址填进引号（含 https://）。
  // 例：'https://shuangxiugou-ai.cn-hangzhou.fcapp.run'
  // **留空 = 自动回落**：D/E/F 继续走上面的 Cloudflare 线路，面板会提示已回落。
  endpointCN: ''
};
