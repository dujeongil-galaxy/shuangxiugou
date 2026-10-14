#!/usr/bin/env node
/**
 * IndexNow URL 提交脚本（IndexNow 协议）
 *
 * 作用：主动通知 Bing / Yandex / Google 等支持 IndexNow 的搜索引擎，
 *      "我刚更新了页面，请来抓取"。相比等爬虫自然回访，能显著加快收录速度。
 *      这是 Google、Bing 官方都支持的标准协议。
 *
 * 官方文档：https://www.indexnow.org/documentation
 *
 * 用法：
 *   1. 先到 https://www.bing.com/webmasters/ 添加站点并申请 API Key
 *      （Bing Webmaster Tools → 站点管理 → 索引 API → 提交 URL）
 *   2. 把 key 填到下方 KEY 常量，或用环境变量：
 *      set INDEXNOW_KEY=你的key && node submit-indexnow.mjs
 *   3. 执行：node submit-indexnow.mjs
 *
 * 注意：API Key 必须放在站点根目录的 <key>.txt 文件中，
 *      本脚本会提示确认该文件是否已就位。
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 脚本在仓库根目录，所以 ROOT 就是脚本所在目录本身。
// 早先写成 '..' 会指到仓库的上一级，导致 sitemap.xml 找不到、
// URL 列表为空（提交会被 Bing 接受但没有任何 URL）。
const ROOT = dirname(fileURLToPath(import.meta.url));

// ===== 配置区=====
const SITE = 'https://dujeongil-galaxy.github.io/shuangxiugou';
const KEY = process.env.INDEXNOW_KEY || '';// 从环境变量读，或直接在此填入

// IndexNow 的 host 必须是 URL 所属的**域名**（不含路径）。
//本站所有页面都在 dujeongil-galaxy.github.io 这个 host 下，
// 其中一部分带 /shuangxiugou/ 前缀，host 字段不能带路径。
const HOST = 'https://dujeongil-galaxy.github.io';

// 密钥文件位置。
//
// IndexNow 官方文档说「放在站点根目录」，但那是针对自定义域名的说法。
// 本站用 GitHub Pages 默认域名，仓库只能部署到 /shuangxiugou/ 前缀下，
// 无法往 dujeongil-galaxy.github.io 域名根写文件（那是 GitHub 用户主页）。
//
// 协议本身支持用 keyLocation 参数指定任意 URL ——— Bing 会 GET 该地址
// 并比对内容，只要返回的文本等于 key 即可，不要求路径固定。
// 所以这里指向上下文里真实可访问的那个地址。
const KEY_FILE = `${SITE}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';

// 待提交的 URL。
// 只提交 sitemap 里的公开页面，不要提交 noindex 页（如 sponsor.html / 404.html）——
// 推给搜索引擎一个声明了 noindex 的 URL 是自相矛盾的。
//
// 默认从 sitemap.xml 读取全部 URL，保证 sitemap 改了这里自动跟着变，
// 不会出现「sitemap 里有的页面没推给搜索引擎」的遗漏。
// 改动内容后可用环境变量只推指定的页面：INDEXNOW_URLS=/,/projects.html
function urlsFromSitemap() {
  const f = join(ROOT, 'sitemap.xml');
  if (!existsSync(f)) return [];
  const xml = readFileSync(f, 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

const URLS = process.env.INDEXNOW_URLS
  ? process.env.INDEXNOW_URLS.split(',').map((u) => u.trim()).filter(Boolean)
  : urlsFromSitemap();

// =================

async function main() {
  if (!KEY) {
    console.error('❌ 缺少 API Key');
    console.error('');
    console.error('获取步骤：');
    console.error('  1. 打开 https://www.bing.com/webmasters/');
    console.error('  2. 添加并验证站点 https://dujeongil-galaxy.github.io/shuangxiugou');
    console.error('  3. 进入「站点管理」→「 索引 API / IndexNow」');
    console.error('  4. 创建并复制 API Key');
    console.error('');
    console.error('然后执行： set INDEXNOW_KEY=<你的key> && node submit-indexnow.mjs');
    process.exit(1);
  }

  // 校验 key 文件是否已放在 host 根目录（协议要求）。
  // 早先写成 existsSync(new URL(keyFile)) —— existsSync 只接受路径字符串，
  // 传 URL 对象会静默返回 false，等于这个检查从来没生效过。
  // 这里改成实际发起 HTTP 请求，因为真正要确认的是「线上能否访问」。
  try {
    const probe = await fetch(KEY_FILE);
    const text = (await probe.text()).trim();
    if (!probe.ok) {
      console.warn(`⚠️ 密钥文件返回 ${probe.status}：${KEY_FILE}`);
      console.warn('   Bing 会拒绝密钥校验失败的提交请求，请确认该文件已部署。');
    } else if (text !== KEY) {
      console.warn(`⚠️ 密钥文件内容与 API Key 不一致：${KEY_FILE}`);
      console.warn(`   文件里是「${text.slice(0, 12)}…」，应为「${KEY.slice(0, 12)}…」`);
    } else {
      console.log(`✓ 密钥文件校验通过：${KEY_FILE}`);
    }
  } catch (e) {
    console.warn(`⚠️ 无法访问密钥文件：${KEY_FILE}（${e.message}）`);
  }
  console.log('');

  const body = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_FILE,
    urlList: URLS,
  };

  console.log('提交 IndexNow 通知…');
  console.log(`  站点: ${SITE}`);
  console.log(`  URL数: ${URLS.length}`);
  console.log('');

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`HTTP ${res.status} ${res.statusText}`);
    if (res.ok) {
      console.log('✅ 提交成功。搜索引擎将在数分钟至数小时内抓取。');
    } else {
      console.error(`❌ 提交失败：${text}`);
      console.error('常见原因：key 与 keyLocation 不匹配、key 未验证、URL 不属于该 host。');
    }
  } catch (err) {
    console.error('❌ 请求异常：', err.message);
  }
}

main();