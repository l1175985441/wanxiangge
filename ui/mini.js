/**
 * 万象阁 · 悬浮小框（聊天时瞄一眼"世界现在什么样"）
 *
 * 为什么有它（她拍的）：工作台是**整页窗口**——看细节用，但聊天时不能老开着；
 * 所以留一个**小框**常驻：一行字＋状态点，点开就进工作台。
 *
 * 内容只放"一眼要知道的"：世界钟／局面／暗线／编年 ＋ **上次更新失败要亮红**（⛔ 不许静默降级）。
 * 能拖、能收成一个小圆点、能关（关了从面板或魔法棒再叫出来）。
 */

import { MINI_ID } from '../core/config.js';
import { getSettings, patchSettings } from '../core/settings.js';
import { loadState } from '../core/state.js';
import { trimText } from '../core/utils.js';
import { applyAppearance } from './theme.js';
import { openWorkspace } from './workspace.js';

let miniEl = null;

/** 小框在吗 */
export function isMiniOpen() {
    return !!(miniEl && miniEl.isConnected);
}

/** 小框根节点（给自测/诊断用） */
export function miniRoot() {
    return miniEl;
}

export function closeMini() {
    if (miniEl) {
        miniEl.remove();
    }
    miniEl = null;
}

/** 按设置决定显示／隐藏 */
export function mountMini() {
    const s = getSettings();
    const show = !!(s.mini && s.mini.show);
    if (!show) {
        closeMini();
        return null;
    }
    if (isMiniOpen()) {
        refreshMini();
        return miniEl;
    }

    const root = document.createElement('div');
    root.id = MINI_ID;
    root.className = 'wxg-mini';
    applyAppearance(root, s.appearance || {});

    const dot = document.createElement('span');
    dot.className = 'wxg-mini-dot';
    const text = document.createElement('span');
    text.className = 'wxg-mini-text';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'wxg-mini-btn';
    open.textContent = '工作台';
    open.title = '打开万象阁工作台';
    open.setAttribute('data-mini-action', 'open');
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'wxg-mini-btn';
    fold.textContent = '—';
    fold.title = '收成一个小点';
    fold.setAttribute('data-mini-action', 'fold');
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'wxg-mini-btn';
    hide.textContent = '✕';
    hide.title = '藏起来（在「总控」里能再叫出来）';
    hide.setAttribute('data-mini-action', 'hide');

    root.appendChild(dot);
    root.appendChild(text);
    root.appendChild(open);
    root.appendChild(fold);
    root.appendChild(hide);

    const pos = s.mini || {};
    root.style.left = (Number.isFinite(Number(pos.x)) ? Number(pos.x)
        : Math.max(12, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 300)) + 'px';
    root.style.top = (Number.isFinite(Number(pos.y)) ? Number(pos.y)
        : Math.max(12, (typeof window !== 'undefined' ? window.innerHeight : 800) - 120)) + 'px';
    if (pos.collapsed) {
        root.classList.add('is-folded');
    }

    root.addEventListener('click', onMiniClick);
    makeDraggable(root, root);
    document.body.appendChild(root);
    miniEl = root;
    refreshMini();
    return root;
}

/** 刷新一行状态（数据现取） */
export function refreshMini() {
    if (!miniEl) {
        return;
    }
    const app = getSettings().appearance || {};
    applyAppearance(miniEl, app);
    const state = loadState();
    const w = state.world || {};
    const bits = [
        trimText(w.clock) || '世界钟未知',
        '局面 ' + String(Array.isArray(w.situations) ? w.situations.length : 0),
        '暗线 ' + String(Array.isArray(w.hidden) ? w.hidden.length : 0),
    ];
    const p = state.pipeline || {};
    const text = miniEl.querySelector('.wxg-mini-text');
    const dot = miniEl.querySelector('.wxg-mini-dot');
    if (text) {
        text.textContent = p.status === 'failed'
            ? ('更新失败：' + (trimText(p.error) || '看过程报告'))
            : bits.join(' · ');
    }
    if (dot && dot.classList) {
        dot.classList.toggle('is-bad', p.status === 'failed');
        dot.classList.toggle('is-idle', !p.status || p.status === 'idle');
    }
    miniEl.setAttribute('data-status', trimText(p.status) || 'idle');
}

/* ------------------------------ 事件 ------------------------------ */

function onMiniClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-mini-action]') : null;
    if (btn) {
        const action = btn.getAttribute('data-mini-action');
        if (action === 'open') {
            openWorkspace();
            return;
        }
        if (action === 'fold') {
            const folded = miniEl.classList.contains('is-folded');
            toggleFold(!folded);
            return;
        }
        if (action === 'hide') {
            patchSettings({ mini: Object.assign({}, getSettings().mini || {}, { show: false }) });
            closeMini();
            return;
        }
    }
    // 点空白处＝打开工作台（不打扰她，不用双击）
    openWorkspace();
}

function toggleFold(folded) {
    if (!miniEl) {
        return;
    }
    if (miniEl.classList) {
        miniEl.classList.toggle('is-folded', folded);
    }
    patchSettings({ mini: Object.assign({}, getSettings().mini || {}, { collapsed: folded }) });
}

/* ------------------------------ 拖拽 ------------------------------ */

function makeDraggable(root, handle) {
    let dragging = false;
    let moved = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;

    const down = (e) => {
        if (e.target && e.target.closest && e.target.closest('[data-mini-action]')) {
            return;   // 点按钮不算拖
        }
        const pt = e.touches ? e.touches[0] : e;
        dragging = true;
        moved = false;
        sx = pt.clientX;
        sy = pt.clientY;
        ox = parseFloat(root.style.left) || 0;
        oy = parseFloat(root.style.top) || 0;
        if (e.preventDefault) {
            e.preventDefault();
        }
    };
    const move = (e) => {
        if (!dragging) {
            return;
        }
        const pt = e.touches ? e.touches[0] : e;
        const dx = pt.clientX - sx;
        const dy = pt.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) {
            moved = true;
        }
        if (!moved) {
            return;
        }
        root.style.left = Math.max(0, ox + dx) + 'px';
        root.style.top = Math.max(0, oy + dy) + 'px';
    };
    const up = () => {
        if (!dragging) {
            return;
        }
        dragging = false;
        if (moved) {
            patchSettings({
                mini: Object.assign({}, getSettings().mini || {}, {
                    x: parseFloat(root.style.left) || 0,
                    y: parseFloat(root.style.top) || 0,
                }),
            });
        }
    };

    if (typeof handle.addEventListener === 'function') {
        handle.addEventListener('mousedown', down);
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }
}
