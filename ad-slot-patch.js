/* ==========================================================================
   广告位预留补丁（2026-11-09 站长指令）
   --------------------------------------------------------------------------
   在打卡统计卡片旁边预留广告位，不影响原有功能
   ========================================================================== */
(function () {
  'use strict';

  function buildAdSlot() {
    // 找到包含"打卡并生成小票"的黑色卡片
    const allElements = document.querySelectorAll('div');
    let statsCard = null;
    
    for (const el of allElements) {
      if (el.textContent.includes('打卡并生成小票') && el.textContent.includes('全网打工人已转移消费额')) {
        statsCard = el;
        break;
      }
    }

    if (!statsCard) return;
    if (document.getElementById('sxg-ad-slot')) return; // 已经加过了

    // 创建广告位容器
    const adContainer = document.createElement('div');
    adContainer.id = 'sxg-ad-slot';
    adContainer.style.cssText = 'margin: 16px 0; padding: 16px; background: #f8fafc; border-radius: 12px; border: 1px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; min-height: 80px; color: #94a3b8; font-size: 14px;';
    adContainer.textContent = '广告位预留（1200x90）';

    // 把广告位插到统计卡片前面
    statsCard.parentNode.insertBefore(adContainer, statsCard);
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
