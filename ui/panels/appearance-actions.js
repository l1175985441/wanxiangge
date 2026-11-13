/* 设-8 外观：refreshAppearancePreview＋八条事件。从 sections.js 抽出（206 后） */
import { getSettings, patchSettings } from '../../core/settings.js';
import { palettePatch, applyAppearance } from '../theme.js';
import { effectiveAppearance, stage } from './shared.js';
import { refreshSaveBar } from './savebar.js';
import { toast } from '../toast.js';
import { trimText } from '../../core/utils.js';
import { mountMini, closeMini } from '../mini.js';


export function refreshAppearancePreview() {
    try {
        const nodes = document.querySelectorAll('[data-role="app-preview"]');
        for (const node of Array.from(nodes)) {
            applyAppearance(node, effectiveAppearance());
        }
    } catch (e) {
        console.warn('[万象阁] 预览盒没刷新：', e);
    }
}

/**
 * ⭐ ST4-A：走草稿的同时，**少数几个开关仍要给一句反馈** ✓
 *   （p3 字面要求：剥壳两个开关“也有反馈” ✓；其余格子靠保存条变色就够 ✓）
 *   ⛔ 每个格子都弹一句（那样弹得没完没了 ✗）
 */

export const APPEARANCE_ACTION_SET = new Set(['set-appearance', 'app-text-auto', 'mini-hover-toggle', 'mini-pin-toggle', 'reset-appearance', 'set-app-to-panel', 'set-layout-mode','toggle-mini-show']);

export function handleAppearanceAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'set-appearance': {
                    if (!isChange) {
                        break;
                    }
                    const key = target.id;   // wxg-app-xxx → 槽位名
                    const slot = key.replace('wxg-app-', '');
                    const patch = {};
                    if (slot === 'palette') {
                        Object.assign(patch, palettePatch(trimText(target.value)));
                    } else {
                        patch[slot] = trimText(target.value);
                        patch.palette = 'custom';
                    }
                    patchSettings({ appearance: Object.assign({}, getSettings().appearance || {}, patch) });
                    toast.ok('配色已更新' + (slot === 'palette' ? '' : '（已标为「自定义」）'));
                    rerender();
                    break;
                }
                case 'app-text-auto': {
                    /* ⭐ ST6：把文字色清回“自动” ✓（清空 ⇒ theme.js 按底面亮度算 ✓） */
                    /* ⭐ ST4-A：也走草稿 ✓（旧：patchSettings 立即落盘 ✗） */
                    stage('appearance', 'appearance', Object.assign({}, effectiveAppearance(), { text: '', palette: 'custom' }));
                    refreshAppearancePreview();
                    refreshSaveBar(host, 'appearance');
                    toast.info('文字色改成“自动”了（点段底「保存」生效；浅底深字／深底浅字）');
                    break;
                }
                case 'mini-hover-toggle': {
                    /* ⭐ ST4-A：走草稿 ✓（旧：立即落盘 ✗） */
                    const hv = target.checked === true;
                    const miniBase = Object.assign({}, getSettings().mini || {}, stagedValue('appearance', 'mini', null) || {});
                    stage('appearance', 'mini', Object.assign({}, miniBase, { hoverOpen: hv }));
                    refreshSaveBar(host, 'appearance');
                    toast.info(hv ? '已勾上：鼠标移入就展开（点段底「保存」生效）' : '已取消（点段底「保存」生效）');
                    break;
                }
                case 'mini-pin-toggle': {
                    /* ⭐ ST4-A：走草稿 ✓ */
                    const pn = target.checked === true;
                    const miniBase2 = Object.assign({}, getSettings().mini || {}, stagedValue('appearance', 'mini', null) || {});
                    stage('appearance', 'mini', Object.assign({}, miniBase2, { pinned: pn }));
                    refreshSaveBar(host, 'appearance');
                    toast.info(pn ? '已勾上：下次挂上就是展开的（点段底「保存」生效）' : '已取消（点段底「保存」生效）');
                    break;
                }
                case 'reset-appearance': {
                    /*
                     * ⭐ 复审追加 A4：两个子：
                     *   ① **先清草稿**：显示与预览走的是 `effectiveAppearance()`（**草稿优先**）
                     *     ⇒ 她改过任一槽再点“恢复”，草稿还在 ⇒ **预览盒与颜色框纹丝不动**；
                     *   ② 色板键按**当前生效值**取：已存色板是 `custom` 时 `palettePatch('custom')` 只返回 `{palette:'custom'}`（四槽一个都不恢复）
                     *     ⇒ custom 时退回 `'ink'`。
                     */
                    const curEff = effectiveAppearance();
                    const palKey = (curEff.palette && curEff.palette !== 'custom') ? curEff.palette : 'ink';
                    /*
                     * ⭐ ST4-A（她定案 A：统一走草稿＋段底保存）✓
                     *   旧：先清草稿、再 `patchSettings` **立即落盘** ✗
                     *     ⇒ 同一张「外观」卡里：颜色框需要点保存，「恢复色板」反而点完就生效 ✗
                     *   现在：把这一笔写进 appearance 草稿 ✓（覆盖她之前改的槽 —— 这正是“恢复”的语义 ✓）
                     */
                    stage('appearance', 'appearance', Object.assign({}, curEff, palettePatch(palKey), { text: '' }));
                    refreshAppearancePreview();
                    refreshSaveBar(host, 'appearance');
                    toast.info('已退回所选色板（点段底「保存」生效）');
                    break;
                }
                case 'set-app-to-panel':
                    patchSettings({ appearance: Object.assign({}, getSettings().appearance || {}, { applyToPanel: target.checked }) });
                    toast.ok(target.checked ? '浮层与小框也跟着这套配色' : '浮层与小框改为跟随酒馆主题');
                    rerender();
                    break;
                case 'set-layout-mode':
                    patchSettings({ layoutMode: trimText(target.value) === 'panel' ? 'panel' : 'workspace' });
                    toast.ok(trimText(target.value) === 'panel' ? '以后点入口＝开浮层面板' : '以后点入口＝开整页工作台');
                    rerender();
                    break;
                case 'toggle-mini-show': {
                    if (!isChange) { break; }   /* R6（材料 05）：⛔ 让 click 与 change 各跑一遍 ✗ */
                    /*
                     * ⭐ 悬浮小框的显隐：**勾了立刻挂载、取消立刻收起**（⛔ 不等"保存"）——
                     *    她是看着球在不在来判断勾没勾上的，要等保存才生效会以为没反应。
                     */
                    const on = target.checked === true;
                    patchSettings({ mini: Object.assign({}, getSettings().mini || {}, { show: on }) });
                    if (on) {
                        mountMini();
                    } else {
                        closeMini();
                    }
                    toast.ok(on ? '悬浮小框已叫出来' : '悬浮小框已收起（随时能在这儿再叫出来）');
                    rerender();
                    break;
                }
    }
}

