/* ==========================================================================
   广告位预留补丁（2026-11-09 站长指令）
   --------------------------------------------------------------------------
   精准替换打卡统计卡片，不影响其他内容
   ========================================================================== */
(function () {
  'use strict';

  function buildAdSlot() {
    if (document.getElementById('sxg-ad-slot')) return; // 已经加过了

    // 找所有按钮，从"打卡并生成小票"按钮往上找父元素
    const buttons = document.querySelectorAll('button');
    let checkBtn = null;
    
    for (const btn of buttons) {
      if (btn.textContent.includes('打卡并生成小票')) {
        checkBtn = btn;
        break;
      }
    }

    if (!checkBtn) return;

    // 往上找 3 层父元素，就是那个黑色卡片
    let statsCard = checkBtn.parentElement;
    for (let i = 0; i < 3; i++) {
      if (statsCard.parentElement) statsCard = statsCard.parentElement;
    }

    // 确认一下这个卡片里有没有"全网打工人已转移消费额"
    if (!statsCard.textContent.includes('全网打工人已转移消费额')) return;

    // 创建广告位容器，替换原来的黑色卡片
    const adContainer = document.createElement('div');
    adContainer.id = 'sxg-ad-slot';
    adContainer.style.cssText = 'margin: 16px 0; padding: 24px; background: #f8fafc; border-radius: 12px; border: 1px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; min-height: 100px; color: #94a3b8; font-size: 14px;';
    adContainer.textContent = '广告位预留（1200x100）';

    // 用广告位替换原来的黑色卡片
    statsCard.parentNode.replaceChild(adContainer, statsCard);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildAdSlot);
  } else {
    buildAdSlot();
  }

  // 等 React 渲染完再加
  setTimeout(buildAdSlot, 1500);
  setTimeout(buildAdSlot, 3000);
})();
