/* 公-1 片段：选中书 + 只读锁。从 shared.js 分出（保持 900 行硬线） */
import { asArray } from '../../core/utils.js';

export let pickBook = '';
export function setPickBook(v) { pickBook = v; }

export function applyLocks(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
        return;
    }
    for (const cardEl of asArray(root.querySelectorAll('.wxg-card[data-lock-key]'))) {
        const locked = cardEl.classList && cardEl.classList.contains('is-locked');
        for (const f of asArray(cardEl.querySelectorAll('input, textarea, select'))) {
            if (!f || !f.setAttribute) {
                continue;
            }
            if (f.type === 'color' || f.type === 'checkbox') {
                continue;
            }
            let noLock = typeof f.closest === 'function' && !!f.closest('[data-no-lock]');
            if (!noLock) {
                for (let p = f.parentNode; p && p !== cardEl; p = p.parentNode) {
                    if (typeof p.getAttribute === 'function' && p.getAttribute('data-no-lock')) {
                        noLock = true;
                        break;
                    }
                }
            }
            if (noLock) {
                f.removeAttribute('readonly');
                f.removeAttribute('tabindex');
                continue;
            }
            if (locked) {
                f.setAttribute('readonly', 'readonly');
                f.setAttribute('tabindex', '-1');
            } else {
                f.removeAttribute('readonly');
                f.removeAttribute('tabindex');
            }
        }
    }
}

/** 从 URL 里取主机名，只用于显示（⛔ 不泄露整条密钥） */

/**
 * 提示词：**折叠条 ＋ 当前用的那份直接预览**。
 *
 * 体检结论点名这里最重："世界推演／角色状态／破限词三个大空框叠着，像没做完的草稿"。
 * 改法：一套提示词一块卡 —— 先给她看**当前实际会用的那份**（留空就是内置的，直接摊开读），
 * 想改才点「改这套」展开输入框。⛔ 空框不再当主角。
 */

/**
 * 每轮记录（原「过程报告」）。同上：给了容器就摆进去，自己不开页。
 */

/**
 * 进度那一整块。
 * @param {object} host 宿主（只在需要自开一页时用）
 * @param {object} [intoBox] 给了就往这个盒子里摆（（三页并一页就是走这条），⏐ 不再开新页
 */

/* ------------------------------ 渲染与事件 ------------------------------ */

/** 把整套分节画进宿主 */
/* ------------------------------ ⭐ 浮层人物卡（② 名册点开详情） ------------------------------ */

