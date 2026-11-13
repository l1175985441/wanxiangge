/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { PALETTE_KEYS, PALETTE_NAMES, applyAppearance, resolveAppearance } from '../theme.js'; import { getSettings } from '../../core/settings.js';  import { effectiveAppearance } from './shared.js'; import { saveBar, stage, stagedValue } from './shared.js'; import { button, card, checkbox, colorInput, el, field, row, section, select } from './shared.js';

export function secAppearance(host, intoBox) {
    const SECID = 'appearance';
    const s = getSettings();
    const app = resolveAppearance(s.appearance || {});
    const box = intoBox || section(
        '外观（工作台配色）',
        '工作台是**我们自己的整页窗口**，配色自己定，不用迁就酒馆主题；'
        + '设置抽屉那边仍跟随酒馆主题。文字色留空＝按底面亮度自动算（浅底深字／深底浅字）。',
        { open: false, summary: PALETTE_NAMES[app.palette] || '', five: true });
    const cTheme = card('色板与颜色槽');
    row(cTheme, field('色板', select('wxg-app-palette',
        PALETTE_KEYS.map((k) => ({ value: k, label: PALETTE_NAMES[k] })),
        app.palette, 'stage-appearance')));
    row(cTheme,
        field('强调色', colorInput('wxg-app-accent', app.accent, 'stage-appearance')),
        field('底面', colorInput('wxg-app-surface', app.surface, 'stage-appearance')),
        field('页面底色', colorInput('wxg-app-bg', app.bg, 'stage-appearance')));
    row(cTheme,
        field('描边', colorInput('wxg-app-border', app.border, 'stage-appearance')),
        /*
         * ⭐ ST6（材料 11·设置层）：**文字色要真的能留空** ✓
         *   旧：`<input type="color">` ✗ —— 规范强制它的值**永远不可能是空串** ✗
         *     ⇒ 说明写着“留空＝自动”却永远留不了空 ✗ ⇒ 点过一次就锁死 ✗
         *   现在：**文本框** ✓＋一颗「自动」按钮 ✓。槽位认法不变（仍看 `target.id` 的 `wxg-app-` 后缀 ✓）
         */
        field('文字（可留空）', (() => {
            const wrapT = el('div', 'wxg-row');
            const txT = document.createElement('input');
            txT.type = 'text';
            txT.id = 'wxg-app-text';
            txT.className = 'wxg-colortext';
            txT.placeholder = '留空＝自动（浅底深字／深底浅字）';
            txT.value = (app.text == null ? '' : String(app.text));
            txT.setAttribute('data-action', 'stage-appearance');
            wrapT.appendChild(txT);
            const autoBtn = button('自动', 'app-text-auto', 'wxg-btn-sm');
            autoBtn.title = '清空文字色 ⇒ 按底面亮度自动算';
            wrapT.appendChild(autoBtn);
            return wrapT;
        })()));
    row(cTheme,
        button('恢复这个色板', 'reset-appearance'),
        el('span', 'wxg-note', '（只把四个槽位退回所选色板；你手改的颜色会被覆盖）'));
    cTheme.appendChild(checkbox('wxg-app-to-panel', '浮层面板与悬浮小框也用这套配色（不勾＝它们跟随酒馆主题）',
        app.applyToPanel, 'stage-app-to-panel'));
    /*
     * ⭐ ST2（材料 11·设置层）：**悬浮球那两个行为终于有开关了** ✓
     *   旧：`pinned`（挂载就展开）与 `hoverOpen`（鼠标移入展开）在代码里写了逻辑 ✗
     *     但界面上**一个开关都没给** ✗ ⇒ 她只能被鼠标路过就弹开，关不掉 ✗
     *   现在：两个勾选框 ✓（立即落盘 ✓ ⛔ 走草稿 ✗ —— mini 不在暂存表里）
     */
    /*
     * ⭐⭐ 真机自查抳回：**两个勾选框恒为真** ✗
     *   旧：`getSettings().mini || {}.hoverOpen === true` ✗
     *     优先级：`===` 先结合 ⇒ `mini || (undefined === true)` ⇒ **mini 对象本身（恒为真）** ✗
     *     ⇒ 她不管怎么取消，重开面板两个勾**又都是勾上的** ✗
     *   现在：先合并出生效值（已存＋草稿），再考量它是不是 `=== true` ✓
     */
    const miniEff = Object.assign({}, getSettings().mini || {}, stagedValue(SECID, 'mini', null) || {});
    /* 渲染层 #9：两个开关已移到「总控 → 入口与启动」，这里只留指路（⛔ 两边各一份） */
    cTheme.appendChild(el('div', 'wxg-note', '悬浮球的「悬停展开」「钉住」已并到「总控 → 入口与启动」（一个概念只留一个界面）。'));
    const pv = el('div', 'wxg-app-preview');
    pv.setAttribute('data-role', 'app-preview');
    applyAppearance(pv, effectiveAppearance());
    pv.appendChild(el('div', 'wxg-app-pv-name', '万象阁 · 预览'));
    const pvRow = el('div', 'wxg-row');
    pvRow.appendChild(el('span', 'wxg-badge', '强调色'));
    pvRow.appendChild(el('span', 'wxg-badge wxg-badge-soft', '淡底'));
    const pvBtn = el('button', 'menu_button', '按钮长这样');
    pvBtn.type = 'button';
    pvRow.appendChild(pvBtn);
    pv.appendChild(pvRow);
    pv.appendChild(el('div', 'wxg-fact', '这一块用的是你选的配色——不用打开工作台就能看出效果。'));
    cTheme.appendChild(pv);
    box.appendChild(cTheme);
    const cMode = card('打开方式');
    row(cMode, field('打开方式', select('wxg-layout-mode', [
        { value: 'workspace', label: '整页工作台（推荐：自己的配色＋左栏导航）' },
        { value: 'panel', label: '浮层面板（老样子，能拖能缩放）' },
    ], s.layoutMode, 'stage-layout-mode')));
    cMode.appendChild(el('div', 'wxg-note', '悬浮小框的开关在「总控」里；它在聊天时常驻，点一下就进工作台。'));
    box.appendChild(cMode);
    box.appendChild(saveBar('appearance'));
    if (!intoBox) { host.appendChild(box); }



}
