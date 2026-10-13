/**
 * 万象阁 · 悬浮球 ＋ 信息面板（聊天时常驻的最小入口）
 *
 * 形态（她拍的）：
 *   · **平时就是一个小球**（拖到哪就在哪，位置记住）；
 *   · **点一下展开**一块小面板：键值**对齐**的信息（世界钟／局势／暗线／人物／任务／本轮召回）；
 *   · 面板上「工作台」进整页窗口；「钉住」让面板常开（不钉＝鼠标离开就收回小球）；
 *   · 失败时**球变红**、面板第一行直接写原因（⛔ 不静默降级）。
 *
 * 数据一律走 `core/summary.js`（与小框、工作台顶栏共用一份，⛔ 不各算一套）。
 */

import { MINI_ID } from '../core/config.js';
import { getSettings, patchSettings } from '../core/settings.js';
import { floorLabel } from '../core/utils.js';
import { buildStateSummary } from '../core/summary.js';
import { applyAppearance } from './theme.js';
import { openWorkspace } from './workspace.js';

let ballEl = null;      // 小球
let panelEl = null;     // 展开后的面板
let wrapEl = null;      // 包一层，方便一起定位

/** 小框在吗 */
export function isMiniOpen() {
    return !!(wrapEl && wrapEl.isConnected);
}

/** 小框根节点（自测/诊断用） */
export function miniRoot() {
    return wrapEl;
}

export function closeMini() {
    if (wrapEl) {
        wrapEl.remove();
    }
    wrapEl = null;
    ballEl = null;
    panelEl = null;
}

/** 按设置决定显示／隐藏 */
export function mountMini() {
    const s = getSettings();
    const cfg = s.mini || {};
    if (!cfg.show) {
        closeMini();
        return null;
    }
    if (isMiniOpen()) {
        refreshMini();
        return wrapEl;
    }

    wrapEl = document.createElement('div');
    wrapEl.id = MINI_ID;
    wrapEl.className = 'wxg-mini';
    applyAppearance(wrapEl, s.appearance || {});

    /* ---- 小球 ---- */
    ballEl = document.createElement('button');
    ballEl.type = 'button';
    ballEl.className = 'wxg-mini-ball';
    ballEl.title = '万象阁 · 点开看当前状态（拖动能挪位置）';
    ballEl.setAttribute('data-mini-action', 'toggle');
    const dot = document.createElement('span');
    dot.className = 'wxg-mini-dot';
    ballEl.appendChild(dot);

    /* ---- 展开面板 ---- */
    panelEl = document.createElement('div');
    panelEl.className = 'wxg-mini-panel';
    const head = document.createElement('div');
    head.className = 'wxg-mini-head';
    head.appendChild(elText('span', 'wxg-mini-name', '万象阁'));
    const actions = document.createElement('div');
    actions.className = 'wxg-mini-actions';
    actions.appendChild(elBtn('工作台', 'open', '打开整页工作台'));
    actions.appendChild(elBtn('钉住', 'pin', '钉住＝鼠标移开也不收回'));
    actions.appendChild(elBtn('✕', 'hide', '藏起来（「总控」里能再叫出来）'));
    head.appendChild(actions);
    panelEl.appendChild(head);
    const body = document.createElement('div');
    body.className = 'wxg-mini-body';
    panelEl.appendChild(body);

    wrapEl.appendChild(ballEl);
    wrapEl.appendChild(panelEl);

    const pos = s.mini || {};
    wrapEl.style.left = (num(pos.x) !== null ? num(pos.x) : Math.max(12, winW() - 96)) + 'px';
    wrapEl.style.top = (num(pos.y) !== null ? num(pos.y) : Math.max(12, winH() - 110)) + 'px';

    wrapEl.addEventListener('click', onMiniClick);
    wrapEl.addEventListener('mouseenter', () => setExpanded(true));
    wrapEl.addEventListener('mouseleave', () => {
        if (!(getSettings().mini || {}).pinned) {
            setExpanded(false);
        }
    });
    makeDraggable(wrapEl, ballEl);

    document.body.appendChild(wrapEl);
    if (pos.pinned) {
        setExpanded(true);
    }
    refreshMini();
    return wrapEl;
}

/** 展开／收回（小球 ↔ 面板） */
export function setExpanded(on) {
    if (!wrapEl) {
        return;
    }
    const want = on === true;
    if (wrapEl.classList) {
        wrapEl.classList.toggle('is-open', want);
    }
    if (panelEl && panelEl.style) {
        panelEl.style.display = want ? 'block' : 'none';
    }
    if (want) {
        keepInView();
        refreshMini();
    }
}

/** 别让面板跑出屏幕（贴右边时往左翻） */
function keepInView() {
    if (!wrapEl || !panelEl) {
        return;
    }
    const left = parseFloat(wrapEl.style.left) || 0;
    if (left + 320 > winW()) {
        wrapEl.style.left = Math.max(12, winW() - 340) + 'px';
    }
    const top = parseFloat(wrapEl.style.top) || 0;
    if (top + 300 > winH()) {
        wrapEl.style.top = Math.max(12, winH() - 320) + 'px';
    }
}

/** 刷新信息（键值对齐的那些行） */
export function refreshMini() {
    if (!panelEl) {
        return;
    }
    applyAppearance(wrapEl, getSettings().appearance || {});
    const s = buildStateSummary({});
    const q = s.quests || {};
    const body = panelEl.querySelector('.wxg-mini-body');
    if (!body) {
        return;
    }
    while (body.firstChild) {
        body.removeChild(body.firstChild);
    }

    // 失败要第一条就说（⛔ 不静默）
    if (s.lastUpdate.status === 'failed') {
        const bad = elText('div', 'wxg-mini-row wxg-mini-bad', '⚠ 上次更新失败：' + (s.lastUpdate.error || '看过程报告'));
        body.appendChild(bad);
    }

    const rows = [
        ['世界钟', s.clock + (s.place ? ' · ' + s.place : '')],
        ['局势', String(s.situations) + ' 条' + (s.hiddenDue ? '（有 ' + String(s.hiddenDue) + ' 条到点）' : '')],
        ['暗线', String(s.hiddenLive) + ' 条在走' + (s.hidden ? '（共 ' + String(s.hidden) + '）' : '')],
        ['人物', String(s.people) + ' 人' + (s.players ? '（玩家棋子 ' + String(s.players) + '）' : '')
            + (s.peopleBlank ? '，' + String(s.peopleBlank) + ' 人还没建档' : '')],
        ['任务', '主线 ' + String(q.main) + ' · 支线 ' + String(q.side)
            + (q.over ? '（已完成/搁置 ' + String(q.over) + '）' : '')],
        ['本轮召回', String(s.recall.people) + ' 人 · ' + String(s.recall.events) + ' 条事'
            + (s.recall.floor >= 0 ? ' · 来自 ' + floorLabel(s.recall.floor) : '')],
        ['上次更新', s.lastUpdate.floor >= 0 ? floorLabel(s.lastUpdate.floor) : '还没更新过'],
        ['编年', String(s.chronicle) + ' 条'],
    ];
    for (const [k, v] of rows) {
        const row = document.createElement('div');
        row.className = 'wxg-mini-row';
        row.appendChild(elText('span', 'wxg-mini-k', k));
        row.appendChild(elText('span', 'wxg-mini-v', v));
        body.appendChild(row);
    }
    // 球的颜色：失败红、没跑过灰、其余强调色
    const dot = ballEl && ballEl.querySelector('.wxg-mini-dot');
    if (dot && dot.classList) {
        dot.classList.toggle('is-bad', s.lastUpdate.status === 'failed');
        dot.classList.toggle('is-idle', s.lastUpdate.status === 'idle' || !s.lastUpdate.status);
    }
    wrapEl.setAttribute('data-status', s.lastUpdate.status || 'idle');
}

/* ------------------------------ 小工具 ------------------------------ */

function num(v) {
    return Number.isFinite(Number(v)) ? Number(v) : null;
}

function winW() {
    return typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1200;
}

function winH() {
    return typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800;
}

function elText(tag, cls, text) {
    const n = document.createElement(tag);
    n.className = cls;
    n.textContent = text;
    return n;
}

function elBtn(text, action, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wxg-mini-btn';
    b.textContent = text;
    b.title = title;
    b.setAttribute('data-mini-action', action);
    return b;
}

/* ------------------------------ 事件 ------------------------------ */

function onMiniClick(e) {
    // 自己往上找目标（⛔ 不赌 closest 在环境里可用）
    let node = e && e.target ? e.target : null;
    let action = null;
    for (let i = 0; i < 5 && node; i += 1) {
        if (typeof node.getAttribute === 'function' && node.getAttribute('data-mini-action') !== null) {
            action = node.getAttribute('data-mini-action');
            break;
        }
        node = node.parentNode;
    }
    if (action === 'open') {
        openWorkspace();
        return;
    }
    if (action === 'pin') {
        const cfg = getSettings().mini || {};
        const pinned = !cfg.pinned;
        patchSettings({ mini: Object.assign({}, cfg, { pinned, collapsed: !pinned }) });
        setExpanded(pinned);
        return;
    }
    if (action === 'hide') {
        patchSettings({ mini: Object.assign({}, getSettings().mini || {}, { show: false }) });
        closeMini();
        return;
    }
    if (action === 'toggle') {
        const open = wrapEl.classList && wrapEl.classList.contains ? wrapEl.classList.contains('is-open') : false;
        setExpanded(!open);
    }
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
        const pt = e.touches ? e.touches[0] : e;
        dragging = true;
        moved = false;
        sx = pt.clientX;
        sy = pt.clientY;
        ox = parseFloat(root.style.left) || 0;
        oy = parseFloat(root.style.top) || 0;
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
        root.style.left = Math.max(0, Math.min(winW() - 40, ox + dx)) + 'px';
        root.style.top = Math.max(0, Math.min(winH() - 40, oy + dy)) + 'px';
        if (e.preventDefault) {
            e.preventDefault();
        }
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

    if (handle && typeof handle.addEventListener === 'function') {
        handle.addEventListener('mousedown', down);
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }
}
