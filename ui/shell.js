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
// ⭐ 修复单 #25：浮层面板也要能套她选的配色（原来从未应用过）
import { syncPanelAppearance } from './theme.js';
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
    /*
     * ⭐ 修复单 #24：**先摘监听再删节点**。
     *   拖拽／缩放是挂在 `document` 上的（⛔ 面板上），
     *   只 `panelEl.remove()` 的话它们**永远留着**——每开关一次多 8 个。
     */
    if (panelEl && typeof panelEl.__wxgCleanup === 'function') {
        try {
            panelEl.__wxgCleanup();
        } catch (e) {
            // 摘不掉也⛔ 把关面板带崩
        }
    }
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
    refreshBtn.className = 'wxg-btn is-panel';
    refreshBtn.title = '刷新面板';
    refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    refreshBtn.addEventListener('click', () => refreshPanel());
    actions.appendChild(refreshBtn);
    const closeBtn = document.createElement('div');
    closeBtn.className = 'wxg-btn is-panel';
    closeBtn.title = '关闭';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', () => closePanel());
    actions.appendChild(closeBtn);
    bar.appendChild(actions);
    root.appendChild(bar);

    // 内容区
    sectionsHost = document.createElement('div');
    /*
     * ⭐ LY2（材料 11·布局层）：**浮层面板也要吃工作台那套布局规则** ✓
     *   旧：面板体只有 `wxg-panel-body` ✗ 而大量布局规则前缀写死了 `.wxg-ws-main` ✗
     *     ⇒ 切到「浮层面板」时：名册 4 列表格/状态页双栏/搜索框右对齐/五页标题居中 ✗
     *     **全部坍塌** ✗
     *   现在：给它补上 `wxg-ws-main`（布局子类 ✓）与 `wanxiangge`（视觉作用域 ✓）
     *   ⛔ 补 `wxg-ws`：那个类是 `position:fixed; inset:0` 的**整窗**，借过来会把面板撞碎 ✗
     */
    sectionsHost.className = 'wxg-panel-body wxg-ws-main wanxiangge';
    root.appendChild(sectionsHost);

    // 缩放把手
    const grip = document.createElement('div');
    grip.className = 'wxg-panel-grip';
    grip.title = '拖动改大小';
    root.appendChild(grip);

    document.body.appendChild(root);
    panelEl = root;

    /*
     * ⭐ 修复单 #25：面板也要套她选的配色（`applyToPanel` 为真时）。
     *   原来 shell.js 里 `applyAppearance`/**一次都没调过** ⇒ 开关在面板这头彻底失灵。
     */
    try {
        // ⭐ 复审追加 A3：走统一口径（不勾时**真清除**，⛔ 把白底写死）
        syncPanelAppearance(root, getSettings().appearance || {});
    } catch (e) {
        console.warn('[万象阁] 面板配色没套上：', e);
    }
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
    /*
     * ⭐ 复审追加 A3：**外壳的配色也跟着同步**。
     *   原来这里只重画（面板开着改色板 ⇒ 外壳不变）。
     */
    if (panelEl) {
        try {
            syncPanelAppearance(panelEl, getSettings().appearance || {});
        } catch (e) {
            console.warn('[万象阁] 面板外壳配色同步失败：', e);
        }
    }
}

/* ------------------------------ 拖拽 ------------------------------ */

/*
 * ⭐ 修复单 #24：把"要摘掉的监听"登记到 root 上（关面板时统一摘）。
 *
 *   为什么：拖拽与缩放都是在 **document** 上挂的（各 4 个＝**8 个/次**），
 *   而 `closePanel()` 只会 `panelEl.remove()` —— 那些监听**不在面板上**，⛔ 会跟着消失，
 *   于是每开关一次就漏 8 个（闭包还攥着已经删掉的旧面板）。
 *   ⚠️ 跟 `ui/mini.js` 的 `__wxgDragCleanup` 是同一套做法（他那边早就对了）。
 */
function addDocListener(root, type, fn, opts) {
    document.addEventListener(type, fn, opts);
    if (!root.__wxgCleanupList) {
        root.__wxgCleanupList = [];
    }
    root.__wxgCleanupList.push(() => document.removeEventListener(type, fn, opts));
    if (typeof root.__wxgCleanup !== 'function') {
        root.__wxgCleanup = () => {
            const list = root.__wxgCleanupList || [];
            root.__wxgCleanupList = [];
            for (const off of list) {
                try {
                    off();
                } catch (e) {
                    // 摘不掉也⛔ 把关面板带崩
                }
            }
        };
    }
}

function makeDraggable(root, handle) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    const onDown = (e) => {
        if (e.target.closest('.wxg-btn is-panel')) {
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
    // ⭐ #24：这四个要登记（关面板时摘）
    addDocListener(root, 'mousemove', onMove);
    addDocListener(root, 'touchmove', onMove, { passive: false });
    addDocListener(root, 'mouseup', onUp);
    addDocListener(root, 'touchend', onUp);
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
    // ⭐ #24：同上（缩放这四个也要登记）
    addDocListener(root, 'mousemove', onMove);
    addDocListener(root, 'touchmove', onMove, { passive: false });
    addDocListener(root, 'mouseup', onUp);
    addDocListener(root, 'touchend', onUp);
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
