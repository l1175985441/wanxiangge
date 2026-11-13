/* 公-4 片段：更新/取消/重算/对账/overlay/补推/复制。从 sections.js 抽出（206 后） */
import { getSettings } from '../../core/settings.js';
import { runUpdate, cancelUpdate, runReconcile } from '../../core/pipeline.js';
import { replanCurrentFloor } from '../../core/actions.js';
import { acceptOverlay, dismissOverlay } from '../../core/state.js';

import { byId, copyToClipboard } from './render.js';
import { toast } from '../toast.js';
import { trimText } from '../../core/utils.js';


export const ACTION_ACTION_SET = new Set(['update-now', 'cancel-update', 'replan', 'reconcile', 'accept-overlay', 'dismiss-overlay', 'backfill', 'copy-text']);


export async function handleActionAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'update-now': {
                    /*
                     * ⭐ 首夜实测单第 6 条：连点第二下被**静默吞掉**（防重返回 {ok:false,reason:'已经在跑了'}，
                     *   而 handler 把返回值丢了）⇒ 这里把话说出来（轻提示，不弹多次）。
                     */
                    const r1 = runUpdate({ manual: true });
                    if (r1 && typeof r1.then === 'function') {
                        r1.then((res) => {
                            if (res && res.ok === false) {
                                toast.warn(res.reason || '正在跑，别急');
                                /*
                                 * ⭐⭐ 她的链路＝“机场＋免费公益站” ⇒ **时好时坏** ✓
                                 *   ⇒ 失败了不用她守着点：**自己等 20 秒再试一次**（最多 2 次 ✓）
                                 *   ⛔ 参数级的错**不**自动重试（那是白试 ✗ 分层已经做在 pipeline 里 ✓）
                                 */
                                if (/ECONNRESET|Failed to fetch|ETIMEDOUT|socket hang up|超时|没回|null|怪东西/i.test(String(res.reason || ''))) {
                                    /* ⭐ 她可调：链路掉线后自己再试几次（默认 2 ✓） */
                                    let autoMax = 2;
                                    try { const an = Number((getSettings().api || {}).autoRetryMax); if (Number.isFinite(an)) { autoMax = Math.max(0, Math.min(5, Math.round(an))); } } catch (eAm) { /* ⛔ 影响她 */ }
                                    window.__wxgAutoRetry = (window.__wxgAutoRetry || 0) + 1;
                                    if (window.__wxgAutoRetry <= autoMax) {
                                        /* ⭐ 越等越久：链路“过一会儿就好”⇒ 第1次 20 秒、第2次 45 秒 ✓ */
                                        const waitSec = window.__wxgAutoRetry === 1 ? 20 : 45;
                                        toast.info('链路掉线 —— ' + String(waitSec) + ' 秒后自己再试一次（第 ' + String(window.__wxgAutoRetry) + '/2 次）✓');
                                        setTimeout(() => { try { runUpdate({ manual: false }); } catch (eAuto) { /* ⛔ 影响她 */ } }, waitSec * 1000);
                                    }
                                }
                            } else {
                                window.__wxgAutoRetry = 0;
                            }
                        }).catch(() => {});
                    } else if (r1 && r1.ok === false) {
                        toast.warn(r1.reason || '正在跑，别急');
                    } else {
                        toast.info('开始更新世界与角色状态（后台跑，不挡你聊天）');
                    }
                    rerender();
                    break;
                }
                case 'cancel-update':
                    cancelUpdate();
                    toast.warn('已请求取消：跑完当前这一小步就停');
                    rerender();
                    break;
                case 'replan':
                    replanCurrentFloor();
                    toast.info('本楼重新算好了');
                    break;
                case 'reconcile': {
                    const res = runReconcile();
                    toast.ok('对账完成：清了 ' + String(res.removed) + ' 条对不上的账' + (res.note ? '（' + res.note + '）' : ''));
                    rerender();
                    break;
                }
                case 'accept-overlay': {
                    /* 硬-6：采用引擎那一版（锁不解除） */
                    const partsA = String(id).split('|');
                    const rA = acceptOverlay(partsA[0], partsA[1]);
                    if (rA.ok) {
                        toast.ok('已采用：' + String(rA.field) + ' → ' + String(rA.value).slice(0, 40));
                        rerender();
                    } else {
                        toast.bad('没采用成：' + String(rA.reason || '没有这条待定'));
                    }
                    break;
                }
                case 'dismiss-overlay': {
                    const partsD = String(id).split('|');
                    const rD = dismissOverlay(partsD[0], partsD[1]);
                    if (rD.ok) {
                        toast.info('已丢掉这条待定（锁照旧）');
                        rerender();
                    } else {
                        toast.bad('丢不掉：可能已经不在了');
                    }
                    break;
                }
                case 'backfill': {
                    const { runBackfill } = await import('../core/pipeline.js');
                    /*
                     * ⭐ 第 3 条：把"补最近几楼"读出来传进去；留空＝全部（老行为）。
                     *   ⭐ 第 4 条：toast 里**直接说清这次补的范围**（不用她再翻到状态页）。
                     */
                    const rawN = trimText((byId(host, 'wxg-backfill-n') || {}).value || '');
                    const lim = Number.parseInt(rawN, 10);
                    const useLim = Number.isFinite(lim) && lim > 0 ? lim : 0;
                    const rB = runBackfill(useLim ? { limit: useLim } : {});
                    if (rB && typeof rB.then === 'function') {
                        rB.then((res) => {
                            if (res && res.ok === false) {
                                toast.warn(res.reason || '正在跑，别急');
                                /*
                                 * ⭐她最实用的那条路（少量多次）也该会自救 ✓
                                 *   链路级失败 ⇒ **自己再接着补**（20 秒、45 秒 ✓）⛔ 她守着点 ✗
                                 */
                                if (/ECONNRESET|Failed to fetch|ETIMEDOUT|socket hang up|超时|没回|null|怪东西/i.test(String(res.reason || ''))) {
                                    /* ⭐ 她可调：链路掉线后自己再试几次（默认 2 ✓） */
                                    let autoMax = 2;
                                    try { const an = Number((getSettings().api || {}).autoRetryMax); if (Number.isFinite(an)) { autoMax = Math.max(0, Math.min(5, Math.round(an))); } } catch (eAm) { /* ⛔ 影响她 */ }
                                    window.__wxgAutoRetryB = (window.__wxgAutoRetryB || 0) + 1;
                                    if (window.__wxgAutoRetryB <= autoMax) {
                                        const wSec = window.__wxgAutoRetryB === 1 ? 20 : 45;
                                        toast.info('链路掉线 —— ' + String(wSec) + ' 秒后自己接着补（第 ' + String(window.__wxgAutoRetryB) + '/2 次）✓');
                                        setTimeout(() => {
                                            try { runBackfill(useLim ? { limit: useLim } : {}); } catch (eAutoB) { /* ⛔ 影响她 */ }
                                        }, wSec * 1000);
                                    }
                                }
                            } else {
                                window.__wxgAutoRetryB = 0;
                            }
                        }).catch(() => {});
                    } else if (rB && rB.ok === false) {
                        toast.warn(rB.reason || '正在跑，别急');
                        break;
                    }
                    toast.info(useLim
                        ? ('开始补推历史：只补**最近 ' + String(useLim) + ' 楼**（分批跑，可随时取消）')
                        : '开始补推历史：**全部楼层**（分批跑，可随时取消）');
                    rerender();
                    break;
                }
                case 'copy-text': {
                    const holderId = target.getAttribute('data-id');
                    const holder = holderId ? byId(host, 'wxg-text-' + holderId) : null;
                    if (holder) {
                        copyToClipboard(holder.textContent, target);
                    }
                    break;
                }
    }
}

