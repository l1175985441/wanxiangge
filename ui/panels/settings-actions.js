/* 设-1：总控开关事件。从 sections.js 抽出（206 后） */
import { patchSettings } from '../../core/settings.js';
import { stagingOf, stagingMode } from './shared.js';
import { rollbackToSnapshot, rollbackLast } from '../../core/state.js';
import { toast } from '../toast.js';


export const SETTINGS_ACTION_SET = new Set(['set-enabled','set-card','set-show-empty','set-panel-on-start','set-protected','set-strict','set-auto-update','toggle-sec','discard-section','open-workspace-btn','rollback-to','rollback']);


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
    }
}

