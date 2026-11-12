/*
 * rating-stats-patch.js — 动态修正顶部四格统计数字
 * 
 * 背景：压缩 bundle 里四格统计数字（81/31/59/241）是硬编码常数，按铁律不许修改。
 * 但 2026-11-04 评级变动（Apple 保持 S 级、农行 C→A）后为 82/31/58；
 * 2026-11-05 小米 B→A（公司普遍每周双休）后，实际数字为 83/31/57。
 * 本补丁在 React 渲染完成后，通过 DOM 操作动态修正这三个数字。
 * 
 * 修正逻辑：
 *   1. 找到四格统计容器（.bg-emerald-50/60 等）
 *   2. 按标签文本定位每个格子（双休红榜/大小周观察/避雷预警）
 *   3. 更新数字节点的 textContent
 * 
 * 挂载时机：
 *   - DOMContentLoaded 后执行一次
 *   - MutationObserver 监听 #root 子树变化（React 重渲染会重置数字）
 * 
 * 2026-11-04 站长线下核实后评级变动：
 *   - Apple 保持 S 级（核实的是授权经销商，非 Apple 官方直营店）
 *   - 农行 C→A（各网点每周关门一天不固定 + 员工轮流双休）
 *   - 红榜(S/A): 81 → 82（+1，农行 C→A）
 *   - 大小周(B): 31 → 31（不变）
 *   - 避雷(C): 59 → 58（-1，农行 C→A）
 *
 * 2026-11-08 新增「陆喜依」S 级（站长指定，依据公开放假通知与媒体采访）：
 *   - 红榜(S/A): 83 → 84（+1）
 *   - 大小周(B)、避雷(C) 不变
 *
 * 2026-11-05 小米 B→A（爱企查公开知识条目：公司普遍每周双休）：
 *   - 红榜(S/A): 82 → 83（+1）
 *   - 大小周(B): 32 → 31（-1）
 *   - 避雷(C): 57 不变
 *
 * 2026-11-11 新增「吉利汽车」C 级（站长指令：比亚迪不改，吉利/理想按本站月休口径评级；
 *   吉利依据：界面新闻披露集团加班打卡制 + 子公司「上六休一」+ 劳动监察在办投诉）：
 *   - 避雷(C): 57 → 58（+1）
 *   - 红榜(S/A)、大小周(B) 不变
 *
 * 2026-11-12 长城汽车 C→B（站长指令：官宣全员双休已落地办公/研发岗，产线仍单双休，属双休不稳；
 *   双休率按 2025 年报岗位人数结构加权换算 51%，平均下班 18:30 招聘口径）：
 *   - 大小周观察(B): 31 → 32（+1）
 *   - 避雷预警(C): 58 → 57（-1）
 *   - 红榜(S/A) 不变
 *
 * 2026-11-12 新增「广发银行」「四川天府银行」两张 A 级卡（站长指令）：
 *   - 红榜(S/A): 84 → 86（+2）
 *   - 大小周(B)、避雷(C) 不变
 */

(function() {
  'use strict';

  const CORRECTIONS = {
    '双休红榜': 86,      // S/A 级卡数（+1 农行 C→A，+1 小米 B→A，+1 陆喜依 S 级，+2 2026-11-12 广发银行/四川天府银行 A 级）
    '大小周观察': 32,    // B 级卡数（+1 Apple S→B，-1 小米 B→A，+1 2026-11-12 长城汽车 C→B）
    '避雷预警': 59,      // C 级卡数（-1 农行 C→A，+1 2026-11-11 吉利 C 级，-1 2026-11-12 长城 C→B，+1 2026-11-12 零跑 C 级）
  };

  function applyCorrections() {
    // 找到所有统计格子
    const statBoxes = document.querySelectorAll('div[class*="bg-"][class*="rounded-xl"][class*="border"]');
    
    statBoxes.forEach(box => {
      // 找到标签元素（如「双休红榜」）
      const labelEl = box.querySelector('div[class*="text-"][class*="text-[11px]"]');
      if (!labelEl) return;
      
      const label = labelEl.textContent.trim();
      if (!(label in CORRECTIONS)) return;
      
      // 找到数字元素（.font-bold）
      const numEl = box.querySelector('div[class*="font-bold"][class*="text-base"]');
      if (!numEl) return;
      
      const currentNum = parseInt(numEl.textContent, 10);
      const correctNum = CORRECTIONS[label];
      
      if (currentNum !== correctNum) {
        numEl.textContent = correctNum;
        console.log(`[rating-stats-patch] 修正「${label}」: ${currentNum} → ${correctNum}`);
      }
    });
  }

  // 首次执行（延迟等待 React 渲染）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(applyCorrections, 100));
  } else {
    setTimeout(applyCorrections, 100);
  }

  // MutationObserver 监听 React 重渲染
  let observer = null;
  function setupObserver() {
    if (observer) return;
    
    const root = document.getElementById('root');
    if (!root) {
      // React 还没挂载，延迟重试
      setTimeout(setupObserver, 50);
      return;
    }
    
    observer = new MutationObserver((mutations) => {
      // 检查是否有统计数字被重置
      let needsCorrection = false;
      for (const mut of mutations) {
        if (mut.type === 'childList' || mut.type === 'characterData') {
          needsCorrection = true;
          break;
        }
      }
      
      if (needsCorrection) {
        // 防抖：等 React 渲染稳定后再修正
        clearTimeout(applyCorrections._timer);
        applyCorrections._timer = setTimeout(applyCorrections, 50);
      }
    });
    
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    
    console.log('[rating-stats-patch] MutationObserver 已挂载');
  }

  setupObserver();
})();
