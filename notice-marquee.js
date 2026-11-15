#!/usr/bin/env node
/**
 * 顶部公告栏单行滚动补丁（notice-marquee.js）
 *
 * 站长 2026-11-15 指令：「算了，滚动起来，别展开折叠了」。
 * 撤掉 2026-11-02 那套 checkbox + label 折叠后，公告栏固定一行：
 * 左边正文横向无缝滚动，右边由 recent-brands.js 注入固定按钮。
 *
 * 铁律：
 *  - 绝不改压缩 bundle（assets/index-YthXZ9eP.js）。
 *  - 正文只有一个真相源：#evidence-notice（scripts/gen-evidence-board.py 托管）。
 *    循环用的副本在这里**运行时克隆 textContent**，不硬编码文案，
 *    也不在静态 HTML 里复制第二份 —— 否则生成器改了数字，副本永远是旧口径。
 *  - 副本 aria-hidden，读屏与爬虫只拿到一份完整原句。
 *  - 只有成功克隆并加上 .is-marquee 才启动 CSS 动画：
 *    脚本挂了就退化成「一行 + 可手动横滑」，不会把唯一一份文本滚成空白。
 *  - prefers-reduced-motion 直接不启动（CSS 里另有运行期切换兜底）。
 *
 * 幂等：轨道里已有 .notice-copy 就跳过，重复执行不会插出第三份、第四份。
 */
(function () {
  'use strict';

  var notice = document.getElementById('site-notice');
  var track = document.getElementById('notice-track');
  var src = document.getElementById('evidence-notice');
  if (!notice || !track || !src) return;
  if (track.querySelector('.notice-copy')) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce && reduce.matches) return;

  var copy = document.createElement('span');
  copy.className = 'notice-copy';
  copy.setAttribute('aria-hidden', 'true');
  copy.textContent = src.textContent;      // 单一真相源：不另写一份句子
  track.appendChild(copy);

  // 一份文本（含 56px 间隔）走完所需时间：按宽度算时长，双端速度一致，
  // 不让宽屏上短短一句话拖成慢动作。CSS 里的 26s 只是没跑到 JS 时的兜底值。
  var oneWidth = track.scrollWidth / 2;
  var seconds = Math.max(14, oneWidth / 55);
  track.style.animationDuration = seconds.toFixed(2) + 's';

  notice.classList.add('is-marquee');
})();
