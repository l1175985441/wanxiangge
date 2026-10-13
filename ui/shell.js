/**
 * 万象阁 · 面板壳（独立窗口：自己的标题、能关、能拖、能缩放）
 *
 * 形态要点（对齐生态公共形态）：
 *   · 自己的标题栏写自己的名字；右上角一个关闭按钮；
 *   · 标题栏拖拽移动（8px 内算点击，不算拖）；
 *   · 右下角一个缩放把手；也可以按窗口大小自适应；
 *   · 位置与大小记在酒馆的扩展设置里 ⇒ 刷新、重开都在；
 *   · 面板内容由 ui/sections.js 提供（与扩展设置区那份同源，不各写一套）。
 */

import { PANEL_ID } from '../core/config.js';
import { getSettings, patchSettings } from '../core/settings.js';
import { renderSections, bindSectionEvents } from './sections.js';

const MIN_W = 360;
const MIN_H = 260;

let panelEl = null;
let sectionsHost = null;

/** 面板开着吗 */
export function isPanelOpen() {
    return !!(panelEl && panelEl.isConnected);
}

/** 关掉面板 */
export function closePanel() {
    if (panelEl) {
        panelEl.remove();
    }
    panelEl = null;
    sectionsHost = null;
}

/** 打开面板（已开就只刷新内容） */
export function openPanel() {
    if (isPanelOpen()) {
        refreshPanel();
        return panelEl;
    }
    const s = getSettings();
    const pos = s.panel && typeof s.panel === 'object' ? s.panel : {};
    const width = Number.isFinite(Number(pos.w)) ? Number(pos.w) : 720;
    const height = Number.isFinite(Number(pos.h)) ? Number(pos.h) : 560;

    const root = document.createElement('div');
    root.id = PANEL_ID;
    root.className = 'wxg-panel';
    root.style.width = Math.max(MIN_W, width) + 'px';
    root.style.height = Math.max(MIN_H, height) + 'px';
    root.style.left = (Number.isFinite(Number(pos.x)) ? Number(pos.x) : Math.max(12, Math.round((window.innerWidth - Math.max(MIN_W, width)) / 2))) + 'px';
    root.style.top = (Number.isFinite(Number(pos.y)) ? Number(pos.y) : Math.max(12, Math.round((window.innerHeight - Math.max(MIN_H, height)) / 3))) + 'px';

    // 标题栏
    const bar = document.createElement('div');
    bar.className = 'wxg-panel-bar';
    const title = document.createElement('div');
    title.className = 'wxg-panel-title';
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-book-atlas';
    title.appendChild(icon);
    const name = document.createElement('span');
    name.textContent = '万象阁';
    title.appendChild(name);
    bar.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'wxg-panel-actions';
    const refreshBtn = document.createElement('div');
    refreshBtn.className = 'wxg-panel-btn';
    refreshBtn.title = '刷新面板';
    refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    refreshBtn.addEventListener('click', () => refreshPanel());
    actions.appendChild(refreshBtn);
    const closeBtn = document.createElement('div');
    closeBtn.className = 'wxg-panel-btn';
    closeBtn.title = '关闭';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', () => closePanel());
    actions.appendChild(closeBtn);
    bar.appendChild(actions);
    root.appendChild(bar);

    // 内容区
    sectionsHost = document.createElement('div');
    sectionsHost.className = 'wxg-panel-body';
    root.appendChild(sectionsHost);

    // 缩放把手
    const grip = document.createElement('div');
    grip.className = 'wxg-panel-grip';
    grip.title = '拖动改大小';
    root.appendChild(grip);

    document.body.appendChild(root);
    panelEl = root;

    makeDraggable(root, bar);
    makeResizable(root, grip);
    bindSectionEvents(sectionsHost, refreshPanel);
    refreshPanel();
    return root;
}

/** 刷新面板内容（数据全从账本现取） */
export function refreshPanel() {
    if (!sectionsHost) {
        return;
    }
    const scroll = sectionsHost.scrollTop;
    renderSections(sectionsHost, { mode: 'panel' });
    sectionsHost.scrollTop = scroll;
}

/* ------------------------------ 拖拽 ------------------------------ */

function makeDraggable(root, handle) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    const onDown = (e) => {
        if (e.target.closest('.wxg-panel-btn')) {
            return;   // 点按钮不算拖
        }
        const pt = pointOf(e);
        if (!pt) {
            return;
        }
        dragging = true;
        moved = false;
        startX = pt.x;
        startY = pt.y;
        originX = root.offsetLeft;
        originY = root.offsetTop;
        document.body.classList.add('wxg-dragging');
        e.preventDefault();
    };

    const onMove = (e) => {
        if (!dragging) {
            return;
        }
        const pt = pointOf(e);
        if (!pt) {
            return;
        }
        const dx = pt.x - startX;
        const dy = pt.y - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            moved = true;
        }
        root.style.left = clamp(originX + dx, 0, window.innerWidth - 80) + 'px';
        root.style.top = clamp(originY + dy, 0, window.innerHeight - 40) + 'px';
    };

    const onUp = () => {
        if (!dragging) {
            return;
        }
        dragging = false;
        document.body.classList.remove('wxg-dragging');
        if (moved) {
            saveGeometry(root);
        }
    };

    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
}

/* ------------------------------ 缩放 ------------------------------ */

function makeResizable(root, grip) {
    let resizing = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    const onDown = (e) => {
        const pt = pointOf(e);
        if (!pt) {
            return;
        }
        resizing = true;
        startX = pt.x;
        startY = pt.y;
        startW = root.offsetWidth;
        startH = root.offsetHeight;
        document.body.classList.add('wxg-dragging');
        e.preventDefault();
        e.stopPropagation();
    };

    const onMove = (e) => {
        if (!resizing) {
            return;
        }
        const pt = pointOf(e);
        if (!pt) {
            return;
        }
        root.style.width = Math.max(MIN_W, startW + (pt.x - startX)) + 'px';
        root.style.height = Math.max(MIN_H, startH + (pt.y - startY)) + 'px';
    };

    const onUp = () => {
        if (!resizing) {
            return;
        }
        resizing = false;
        document.body.classList.remove('wxg-dragging');
        saveGeometry(root);
    };

    grip.addEventListener('mousedown', onDown);
    grip.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
}

function pointOf(e) {
    if (e.touches && e.touches.length) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length && e.type === 'touchend') {
        return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    if (typeof e.clientX === 'number') {
        return { x: e.clientX, y: e.clientY };
    }
    return null;
}

function clamp(v, min, max) {
    return Math.min(Math.max(v, min), Math.max(min, max));
}

/** 位置与大小记进设置（刷新、重开都在） */
function saveGeometry(root) {
    patchSettings({
        panel: {
            x: Math.round(root.offsetLeft),
            y: Math.round(root.offsetTop),
            w: Math.round(root.offsetWidth),
            h: Math.round(root.offsetHeight),
        },
    });
}
