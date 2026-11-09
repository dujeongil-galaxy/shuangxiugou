/* ==========================================================================
   广告位预留补丁（2026-11-09 站长指令）
   --------------------------------------------------------------------------
   删掉原来的黑色打卡统计卡片，替换成广告位
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
