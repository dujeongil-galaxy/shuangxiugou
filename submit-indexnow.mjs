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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ===== 配置区=====
const SITE = 'https://dujeongil-galaxy.github.io/shuangxiugou';
const KEY = process.env.INDEXNOW_KEY || '';// 从环境变量读，或直接在此填入
const HOST = 'https://dujeongil-galaxy.github.io';
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

  // 校验 key 文件是否已放在站点根目录（协议要求）
  const keyFile = `${HOST}/${KEY}.txt`;
  if (!existsSync(new URL(keyFile))) {
    console.warn(`⚠️  提醒：协议要求在 ${keyFile} 存在密钥文件（内容就是 key 本身）。`);
    console.warn('   否则搜索引擎可能拒绝该提交请求。');
    console.log('');
  }

  const body = {
    host: HOST,
    key: KEY,
    keyLocation: `${HOST}/${KEY}.txt`,
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