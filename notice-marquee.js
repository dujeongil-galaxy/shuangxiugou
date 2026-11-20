#!/usr/bin/env node
/**
 * 顶部公告栏单行滚动补丁（notice-marquee.js）
 *
 * 站长 2026-11-15 指令：「算了，滚动起来，别展开折叠了」。
 * 撤掉 2026-11-02 那套 checkbox + label 折叠后，公告栏固定一行：
 * 左边正文横向无缝滚动，右边由 recent-brands.js 注入固定按钮。
 *
 * 铁律：
 *  - 绝不改压缩 bundle（assets/index-YXthXZ9eP.js 之类）。
 *  - 正文真相源在 DOM 里，不在这里硬编码文案：#evidence-notice（生成器托管）
 *    + #sxg-vote-notice + #sxg-360-notice（手写段）。循环用的副本**深克隆**轨道里
 *    这几段 span，段数改了也不用动本文件。
 *  - 副本 aria-hidden，读屏与爬虫只拿到一份完整原文。
 *  - 只有成功克隆并加上 .is-marquee 才启动 CSS 动画：
 *    脚本挂了就退化成「一行 + 可手动横滑」，不会把唯一一份文本滚成空白。
 *  - prefers-reduced-motion 直接不启动（CSS 里另有运行期切换兜底）。
 *
 * 幂等：轨道里已有 .notice-copy 就跳过，重复执行不会插出第三份、第四份。
 *
 * 2026-11-20 变更（v3）：
 *   公告从「一句话」扩成三段（证据链 / 用脚投票 / 360 说明），原实现
 *   `copy.textContent = src.textContent` 只会复制第一段，滚一圈就会出现
 *   「证据链 + 用脚投票 … 证据链」的错位接缝。改为深克隆轨道全部子节点。
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
  Array.prototype.forEach.call(track.children, function (node) {
    if (node === copy) return;
    if (node.classList && node.classList.contains('notice-copy')) return;
    copy.appendChild(node.cloneNode(true));
  });
  track.appendChild(copy);

  // 一份文本（含每段 56px 间隔）走完所需时间：按宽度算时长，双端速度一致，
  // 不让宽屏上短短一句话拖成慢动作。CSS 里的 26s 只是没跑到 JS 时的兜底值。
  // 三段合起来比原先长很多，这里把速度从 55px/s 提到 62px/s，
  // 免得一整圈要等 70 秒才回到开头。
  var oneWidth = track.scrollWidth / 2;
  var seconds = Math.max(14, oneWidth / 62);
  track.style.animationDuration = seconds.toFixed(2) + 's';

  notice.classList.add('is-marquee');
})();
