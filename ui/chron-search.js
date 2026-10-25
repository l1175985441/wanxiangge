/**
 * 万象阁 · 编年搜索框（阿砚件 3：代码有、屏上没露）
 *
 * 抽出来的原因：`ui/sections.js` 贴着 8200 行硬线；这里只负责**造那个输入框**。
 * ⚠️ 上一版把这坨贴到了文件里**别的函数**里（锚点撞了），所以屏上一直看不见——
 *    现在由调用方在**编年段**里 `box.appendChild(makeChronSearch(...))`。
 */

/**
 * @param {(tag: string, cls?: string, text?: string) => HTMLElement} el 创建元素的工具
 * @param {string} current 当前搜索词
 * @returns {HTMLElement} 包好的搜索框（含放大镜图标）
 */
export function makeChronSearch(el, current) {
    const wrap = el('div', 'wxg-searchwrap');
    wrap.appendChild(el('span', 'wxg-searchico', '⌕'));
    const input = el('input', 'wxg-searchbox');
    input.type = 'search';
    input.placeholder = '搜：编年正文 或 类型';
    input.value = String(current == null ? '' : current);
    input.setAttribute('data-action', 'chron-search');
    wrap.appendChild(input);
    return wrap;
}
