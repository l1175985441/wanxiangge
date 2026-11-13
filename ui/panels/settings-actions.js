/* 设-1：总控开关事件。从 sections.js 抽出（206 后） */
import { getSettings, patchSettings } from '../../core/settings.js';
import { stagingOf, stagingMode, modeForSection, WXG_DBG } from './shared.js';
import { pickBook } from './locks.js';
import { API_KEYS, syncApiFromDom } from './api-sync.js';
import { asText, trimText } from '../../core/utils.js';
import { rollbackToSnapshot, rollbackLast } from '../../core/state.js';
import { toast } from '../toast.js';
import { refreshMini } from '../mini.js';


export const SETTINGS_ACTION_SET = new Set(['set-enabled','set-card','set-show-empty','set-panel-on-start','set-protected','set-strict','set-auto-update','toggle-sec','discard-section','save-section', 'stage-recent-turns', 'use-cap-people-12', 'stage-cap-people', 'stage-max-events', 'stage-cap-past', 'stage-cap-events', 'stage-cap-hidden', 'stage-cap-chronicle', 'stage-past-floor-cut', 'stage-inject-cap', 'set-extract-tags', 'set-exclude-tags', 'set-extract-books', 'set-exclude-books', 'set-affinity-source','open-workspace-btn','rollback-to','rollback']);


export function handleSettingsAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'set-enabled': patchSettings({ enabled: target.checked }); rerender(); break;
                case 'set-card': patchSettings({ cardEnabled: target.checked }); rerender(); break;
                case 'set-show-empty': patchSettings({ showEmptyCard: target.checked }); rerender(); break;
                case 'set-panel-on-start': patchSettings({ showPanelOnStart: target.checked }); break;
                case 'set-protected': patchSettings({ protectedBypass: target.checked }); break;
                case 'set-strict': patchSettings({ strictMention: target.checked }); break;
                case 'set-auto-update': patchSettings({ autoUpdate: target.checked }); break;
                case 'open-workspace-btn': {
                    /* ★ 依据＝阿砚 17 号 §一-1：抽屉里那颗入口 ⇒ 打开工作台 */
                    Promise.resolve()
                        .then(() => import('./workspace.js'))
                        .then((m) => { if (m && typeof m.openWorkspace === 'function') { m.openWorkspace(); } })
                        .catch(() => { });
                    break;
                }
                case 'rollback-to': {
                    const okRb = rollbackToSnapshot(Number(id));
                    if (okRb && okRb.ok) {
                        toast.info('已恢复到：' + String(okRb.label || '那份快照'));
                        rerender();
                    } else {
                        toast.warn('这份快照恢复不了');
                    }
                    break;
                }
                case 'rollback': {
                    const snap = rollbackLast();
                    toast.ok(snap ? '已撤回上一次更新（撤回前那一版也留着，能再撤回来）' : '没有可撤回的版本');
                    rerender();
                    break;
                }
                case 'toggle-sec': {
                    /*
                     * ⭐ 目标核对 2②：**我们自己的开合**。
                     *   切 `data-wxg-open`（CSS 靠它决定显隐）～同时把行内 display 也跟上，
                     *   免得旧的行内样式（以前 ST 写进去的）把它压住。
                     */
                    const sec = target.closest ? target.closest('.wxg-sec') : null;
                    if (sec) {
                        const openNow = sec.getAttribute('data-wxg-open') === '1';
                        const bodyEl = sec.querySelector('.wxg-sec-body');
                        if (openNow) {
                            sec.removeAttribute('data-wxg-open');
                            if (bodyEl && bodyEl.style) { bodyEl.style.display = 'none'; }
                        } else {
                            sec.setAttribute('data-wxg-open', '1');
                            if (bodyEl && bodyEl.style) { bodyEl.style.display = ''; }
                        }
                    }
                    break;
                }

                case 'discard-section': {
                    delete stagingOf(stagingMode)[id];
                    toast.info('这一段没保存的改动丢掉了（回到已存的）');
                    rerender();
                    break;
                }
                case 'save-section': {
                    syncApiFromDom(host);
                    const n = commitSection(id);
                    /*
         * ⭐ ST8（材料 11·设置层）：**切「打开方式」保存后要当场换形态** ✓
         *   旧：在工作台里改成「浮层面板」并点保存 ✗ ⇒ **当前开着的工作台不动** ✗
         *     ⇒ 得手动关掉工作台、再去点魔法棒才生效 ✗
         *   现在：保存「外观」段后看一眼当前形态 ✓
         *     形态**不对** ⇒ 关一个开另一个 ✓；形态**已经对了** ⇒ **什么都不做** ✓（⛔ 无事重开打断她 ✗）
         */
        if (id === 'appearance') {
            /* ⭐ ST4-A：小框两个开关现在走草稿 ⇒ **保存后**才取到新值 ✓ */
            import('./mini.js').then((mm) => { if (mm && typeof mm.refreshMini === 'function') { mm.refreshMini(); } }).catch(() => {});
            import('./workspace.js').then((wsm) => import('./shell.js').then((shm) => {
                const want = getSettings().layoutMode === 'panel' ? 'panel' : 'workspace';
                const wsOpen = (wsm && typeof wsm.isWorkspaceOpen === 'function') ? wsm.isWorkspaceOpen() : false;
                const pnOpen = (shm && typeof shm.isPanelOpen === 'function') ? shm.isPanelOpen() : false;
                if (want === 'panel' && !pnOpen) {
                    if (wsm && typeof wsm.closeWorkspace === 'function') { wsm.closeWorkspace(); }
                    if (shm && typeof shm.openPanel === 'function') { shm.openPanel(); }
                } else if (want === 'workspace' && !wsOpen) {
                    if (shm && typeof shm.closePanel === 'function') { shm.closePanel(); }
                    if (wsm && typeof wsm.openWorkspace === 'function') { wsm.openWorkspace(); }
                }
            })).catch(() => {});
        }
        refreshToastSection(id, n);
        /*
         * ⭐ RD7（材料 11·渲染层）：**关掉召回卡片开关并保存后，聊天里已挂着的卡片要当场刷** ✓
         *   旧：只重画了设置面板 ✗ ⇒ 聊天流里的卡片**纹丝不动** ✗
         *   现在：保存「召回」段后补一次 mountAllCards ✓（动态 import，⛔ 加静态依赖 ✗）
         */
        if (id === 'recall') {
            import('./render.js').then((m) => {
                if (m && typeof m.mountAllCards === 'function') {
                    m.mountAllCards(2, 900);
                }
            }).catch(() => {});
        }
                    /*
                     * ⭐⭐ 谷歌方案 A（她 2026-10-17 选定）：保存按钮＝**确定性回执** ✓
                     *   病根：她填完去点保存，而值已经（失焦）落盘 ⇒ 旧行为只弹
                     *   “这一段没有未保存的改动” ✗ ⇒ 她根本不知道到底存上没存上 ✗（＝“好绕”）
                     *   ⇒ 现在：API 这一段保存后弹**带当前值**的回执 ✓（她一眼就知道存的是哪一套 ✓）
                     */
                    if (id === 'api') {
                        try {
                            const aSaved = getSettings().api || {};
                            const modeLabel = aSaved.mode === 'direct' ? '直连' : '经酒馆转发';
                            const modelLabel = trimText(aSaved.model) || '（没填）';
                            const say = (typeof toast.ok === 'function') ? toast.ok : toast.info;
                            say.call(toast, 'API 设置已保存 ✓（当前：' + modeLabel + '｜模型：' + modelLabel + '）');
                        } catch (eSaveTip) { /* ⛔ 影响保存 */ }
                    }
                    rerender();
                    break;
                }
                case 'set-extract-tags': if (isChange) { patchSettings({ extractTags: target.value }); toast.ok('提取标签已保存'); } break;
                case 'set-exclude-tags': if (isChange) { patchSettings({ excludeTags: target.value }); toast.ok('排除标签已保存'); } break;
                case 'set-extract-books': if (isChange) { patchSettings({ extractBooks: target.value }); toast.ok('提取世界书已保存'); } break;
                case 'set-exclude-books': if (isChange) { patchSettings({ excludeBooks: target.value }); toast.ok('排除世界书已保存'); } break;
                case 'set-affinity-source': if (isChange) { patchSettings({ affinitySource: target.value }); toast.ok('好感数据源已保存'); } break;
                case 'stage-recent-turns': if (isChange) { patchSettings({ recentTurns: target.value }); rerender(); } break;
                case 'use-cap-people-12': {
                    /* 渲染层 #10：一键改到建议值（她点了才改） */
                    patchSettings({ capPeople: 12 });
                    toast.ok('已把人物封顶改成 12');
                    rerender();
                    break;
                }
                case 'stage-cap-people': if (isChange) { patchSettings({ capPeople: target.value }); rerender(); } break;
                case 'stage-max-events': if (isChange) { patchSettings({ maxEvents: target.value }); rerender(); } break;
                case 'stage-cap-past': if (isChange) { patchSettings({ capPast: target.value }); rerender(); } break;
                case 'stage-cap-events': if (isChange) { patchSettings({ capEvents: target.value }); rerender(); } break;
                case 'stage-cap-hidden': if (isChange) { patchSettings({ capHidden: target.value }); rerender(); } break;
                case 'stage-cap-chronicle': if (isChange) { patchSettings({ capChronicle: target.value }); rerender(); } break;
                case 'stage-past-floor-cut': if (isChange) { patchSettings({ pastFloorCut: target.value }); rerender(); } break;
                case 'stage-inject-cap': if (isChange) { patchSettings({ injectCharCap: target.value }); rerender(); } break;   /* ★ 同上 */
                /* ---- 外观（我们自己的配色） ---- */
    }
}

export function commitSection(secId) {
    const box = stagingOf(modeForSection(secId))[secId];
    if (WXG_DBG) {
        try {
            console.info('[wanxiangge][commit] sec=' + String(secId) + ' mode=' + String(stagingMode)
                + ' keys=' + JSON.stringify(box ? Object.keys(box) : [])
                + ' vals=' + JSON.stringify(box ? Object.keys(box).reduce((o, k) => { o[k] = String(box[k] == null ? '' : box[k]).slice(0, 30); return o; }, {}) : {}));
        } catch (eDbg2) { /* 日志不影响保存 */ }
    }
    if (!box || !Object.keys(box).length) {
        return 0;
    }
    const patch = {};
    for (const k of Object.keys(box)) {
        if (k === 'appearance' && box[k] && typeof box[k] === 'object') {
            /*
             * ⭐ 复审追加 3①：**这里得用 `patch.appearance` 打底**，而且**关键序**。
             *   病根：同一轮草稿里**先取消勾选、再改色板**时，循环先走 `applyToPanel` 分支
             *   （折好了 `patch.appearance.applyToPanel=false`），紧接着走这个分支——
             *   原来直接 `getSettings().appearance` 做底 ⇒ **把刚折好的那一笔盖回去**；
             *   而 `box[k]`（改色板时的基底）里还带着旧的 `applyToPanel: true`。
             *   ⇒ 用 `patch.appearance ||` 打底，并**只要 box 里有 `applyToPanel` 就再校正一次**（⛔ 论键序）。
             */
            patch.appearance = Object.assign({},
                patch.appearance || getSettings().appearance || {},
                box[k]);
            if (Object.prototype.hasOwnProperty.call(box, 'applyToPanel')) {
                patch.appearance.applyToPanel = box.applyToPanel === true;
            }
            continue;
        }
        /*
         * ⭐ 复审追加 2（A3 写入层）：**`applyToPanel` 要折进 `appearance` 里**，⛔ 落顶层。
         *   根因：读侧 `theme.resolveAppearance()` 读的是 **`settings.appearance.applyToPanel`**，
         *   而这里原来走 `patch[k] = box[k]` ⇒ 写进了**顶层** `settings.applyToPanel`（**没人读的那格**）
         *   ⇒ 她「取消勾选 + 保存」后，读侧那格**仍是 true** ⇒ 小框照样被染色（"跟随酒馆主题"实际不生效）。
         *   ⚠️ 正因为读不到，我 A3 那次修的"清除"**根本没被触发**——两轮人工复核都漏了这一格，
         *     最后是**真机 playwright 实点**才抓出来的（所以"假机全绿"不等于"真机对"）。
         *   ⛔ 不动顶层那个历史遗留字段（留着无副作用，属清单外）。
         */
        if (k === 'applyToPanel') {
            patch.appearance = Object.assign({},
                patch.appearance || getSettings().appearance || {},
                { applyToPanel: box[k] === true });
            continue;
        }
        if (k === 'api' && box[k] && typeof box[k] === 'object') {
            patch.api = Object.assign({}, getSettings().api || {}, box[k], patch.api || {});
            continue;
        }
        /*
         * ⭐ B10（材料 14 · 代拍 A）：**「不读」表落盘时写进「当前这本书」那一格** ✓
         *   随点随存会串味：换过书之后行为不对，几乎想不到是上一本的不读表还在 ✗
         *   同时把老的共用表清空 ✓（迁移已在 worldbook.migrateExcludeToPerBook 做过 ✓）
         */
        if (k === 'excludeEntries' && secId === 'extract') {
            const bookNow = trimText(pickBook);
            if (bookNow) {
                const byBookOld = (getSettings().excludeEntriesByBook && typeof getSettings().excludeEntriesByBook === 'object')
                    ? getSettings().excludeEntriesByBook : {};
                patch.excludeEntriesByBook = Object.assign({}, byBookOld, { [bookNow]: asText(box[k]) });
                patch.excludeEntries = '';
            } else {
                patch[k] = box[k];
            }
            continue;
        }
        if (API_KEYS.includes(k)) {
            patch.api = Object.assign({}, getSettings().api || {}, patch.api || {}, { [k]: box[k] });
        } else {
            patch[k] = box[k];
        }
    }
    delete stagingOf(modeForSection(secId))[secId];
    patchSettings(patch);
    /*
     * ⭐ 复审追加 3②：**外观段存完立刻刷小框**。
     *   病根：这里只 `patchSettings`（重画走的是工作台／设置区那条路），而 `closeWorkspace()`
     *   也只把 `mini.style.display` 放回来——**两边都没人碰小框** ⇒ 她「取消勾选 + 保存」后
     *   **不动任何东西**读小框，`--wxg-surface` 还是旧的（要等下次切档／发消息才清）。
     *   ⇒ 这一段存完就补一次（⛔ 不是每个段都刷：别的段跟小框无关，白刷一遍）。
     */
    if (secId === 'appearance') {
        try {
            refreshMini();
        } catch (e) {
            console.warn('[万象阁] 存完外观没刷上小框：', e);
        }
    }
    return Object.keys(box).length;
}

/** 走 api 那一格的键（保存时归到 api 下面） */

function refreshToastSection(secId, n) {
    if (!n) {
        toast.info('这一段没有未保存的改动');
        return;
    }
    toast.ok('存好了：这一段改了 ' + String(n) + ' 处');
}
