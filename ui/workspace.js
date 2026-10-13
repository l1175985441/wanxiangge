/**
 * 万象阁 · 工作台（**我们自己的整页窗口**）
 *
 * 为什么有它（她拍的）：原来内容只活在两个"别人的地盘"里——酒馆扩展设置区那个窄抽屉、
 * 以及一个 720 宽的浮层面板。窄，且配色必须迁就酒馆主题 ⇒ 怎么做都别扭。
 * 工作台是**自己的地盘**：整屏铺开、左侧竖排导航、自己的配色（可自选，见 ui/theme.js）。
 *
 * 与其他部分的关系：
 *   · 内容与设置区／浮层**同源**（都走 `renderSections`），⛔ 不各写一套；
 *   · 浮层小框（ui/mini.js）是"聊天时瞄一眼"的入口，点它就打开这里。
 */

import { WORKSPACE_ID, MINI_ID, SIDEBAR_ICONS } from '../core/config.js';
import { getSettings, patchSettings } from '../core/settings.js';
import { renderSections } from './sections.js';
import { applyAppearance } from './theme.js';
import { loadState } from '../core/state.js';
import { trimText } from '../core/utils.js';

let wsEl = null;
let sideEl = null;
let hostEl = null;
let activeIndex = 0;

/** 工作台开着吗 */
export function isWorkspaceOpen() {
    return !!(wsEl && wsEl.isConnected);
}

/** 工作台根节点（给自测/诊断用） */
export function workspaceRoot() {
    return wsEl;
}

/** 关掉工作台 */
export function closeWorkspace() {
    if (wsEl) {
        wsEl.remove();
    }
    wsEl = null;
    sideEl = null;
    hostEl = null;
    // 工作台收起来了 ⇒ 把悬浮球放回来
    try {
        const mini = document.getElementById(MINI_ID);
        if (mini) {
            mini.style.display = '';
        }
    } catch (e) {
        // 放不回来也不影响别的
    }
}

/** 打开工作台（已开就只刷新） */
export function openWorkspace() {
    if (isWorkspaceOpen()) {
        refreshWorkspace();
        return wsEl;
    }

    const root = document.createElement('div');
    root.id = WORKSPACE_ID;
    root.className = 'wxg-ws';
    applyAppearance(root, getSettings().appearance || {});

    /* ---- 顶栏 ---- */
    const bar = document.createElement('div');
    bar.className = 'wxg-ws-bar';
    const mark = document.createElement('div');
    mark.className = 'wxg-ws-mark';
    mark.textContent = '万';
    bar.appendChild(mark);
    const titleBox = document.createElement('div');
    titleBox.className = 'wxg-ws-titlebox';
    const name = document.createElement('div');
    name.className = 'wxg-ws-name';
    name.textContent = '万象阁 · 工作台';
    const sub = document.createElement('div');
    sub.className = 'wxg-ws-sub';
    sub.textContent = '世界在后台自己活着 · 正文一个字都不多';
    titleBox.appendChild(name);
    titleBox.appendChild(sub);
    bar.appendChild(titleBox);

    const right = document.createElement('div');
    right.className = 'wxg-ws-right';
    right.id = 'wxg-ws-chips';
    const close = document.createElement('button');
    close.className = 'wxg-ws-x';
    close.type = 'button';
    close.textContent = '✕';
    close.title = '关掉工作台（Esc 也行）';
    close.setAttribute('data-ws-action', 'close');
    right.appendChild(close);
    bar.appendChild(right);
    root.appendChild(bar);

    /* ---- 主体：左栏 ＋ 内容 ---- */
    const body = document.createElement('div');
    body.className = 'wxg-ws-body';
    sideEl = document.createElement('nav');
    sideEl.className = 'wxg-ws-side';
    body.appendChild(sideEl);
    hostEl = document.createElement('main');
    hostEl.className = 'wxg-ws-main wanxiangge';
    hostEl.setAttribute('data-wxg-mode', 'workspace');
    body.appendChild(hostEl);
    root.appendChild(body);

    // 点左栏、点顶栏按钮、点 Esc
    root.addEventListener('click', onWorkspaceClick);
    document.addEventListener('keydown', onKeydown);

    document.body.appendChild(root);
    wsEl = root;
    // ⚠️ 真机上验出来的：悬浮球是 fixed 且层级更高，工作台一开它就**压在工作台上挡着点**，
    //    所以进工作台先把球收起来（关掉工作台再放出来）。
    try {
        const mini = document.getElementById(MINI_ID);
        if (mini) {
            mini.style.display = 'none';
        }
    } catch (e) {
        // 收不收得起来都不影响工作台本身
    }
    refreshWorkspace();
    return root;
}

/** 刷新工作台内容（数据现取） */
export function refreshWorkspace() {
    if (!hostEl) {
        return;
    }
    applyAppearance(wsEl, getSettings().appearance || {});
    const scroll = hostEl.scrollTop;
    renderSections(hostEl, { mode: 'workspace' });
    buildSidebar();
    renderChips();
    // 默认停在上次看的那一段
    const idx = Math.min(Math.max(0, activeIndex), Math.max(0, (sideEl ? sideEl.children.length : 1) - 1));
    showIndex(idx, false);
    hostEl.scrollTop = scroll;
}

/** 左栏：12 段 + 图标 */
function buildSidebar() {
    if (!sideEl) {
        return;
    }
    while (sideEl.firstChild) {
        sideEl.removeChild(sideEl.firstChild);
    }
    const secs = Array.from(hostEl.querySelectorAll('.wxg-sec'));
    secs.forEach((sec, i) => {
        const titleEl = sec.querySelector('.wxg-sec-title');
        const name = trimText(titleEl && titleEl.textContent) || ('第 ' + String(i + 1) + ' 段');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wxg-ws-side-item';
        btn.setAttribute('data-ws-go', String(i));
        const ico = document.createElement('span');
        ico.className = 'wxg-ws-side-ico';
        ico.textContent = SIDEBAR_ICONS[i] || '•';
        const txt = document.createElement('span');
        txt.className = 'wxg-ws-side-txt';
        txt.textContent = name;
        btn.appendChild(ico);
        btn.appendChild(txt);
        sideEl.appendChild(btn);
    });
}

/** 顶栏那几个状态小胶囊：一眼看"世界活着没" */
function renderChips() {
    const box = wsEl && wsEl.querySelector('#wxg-ws-chips');
    if (!box) {
        return;
    }
    const state = loadState();
    const w = state.world || {};
    const hidden = Array.isArray(w.hidden) ? w.hidden.length : 0;
    const sit = Array.isArray(w.situations) ? w.situations.length : 0;
    const items = [
        ['世界钟', trimText(w.clock) || '未知'],
        ['局面', String(sit)],
        ['暗线', String(hidden)],
        ['编年', String(Array.isArray(state.chronicle) ? state.chronicle.length : 0)],
    ];
    // 失败要看得见（⛔ 不许静默降级）：更新失败就在顶栏亮一条
    const p = state.pipeline || {};
    if (p.status === 'failed') {
        items.push(['⚠ 上次更新失败', trimText(p.error) || '看「过程报告」']);
    }
    const close = box.querySelector('[data-ws-action="close"]');
    while (box.firstChild) {
        box.removeChild(box.firstChild);
    }
    for (const [k, v] of items) {
        const chip = document.createElement('span');
        chip.className = 'wxg-ws-chip';
        if (k.startsWith('⚠')) {
            chip.className += ' wxg-ws-chip-bad';
        }
        chip.textContent = k + '：' + v;
        box.appendChild(chip);
    }
    if (close) {
        box.appendChild(close);   // 关闭按钮始终在最后
    }
}

/** 切到第 i 段 */
export function showIndex(i, scroll) {
    if (!sideEl || !hostEl) {
        return;
    }
    const n = Number(i);
    activeIndex = Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
    const items = Array.from(sideEl.children);
    items.forEach((b, k) => {
        if (b.classList) {
            b.classList.toggle('is-on', k === activeIndex);
        }
    });
    // 内容区只显示当前那一段（其余藏起来）——像页签一样，一屏只说一件事
    const secs = Array.from(hostEl.querySelectorAll('.wxg-sec'));
    secs.forEach((sec, k) => {
        const on = k === activeIndex;
        sec.style.display = on ? '' : 'none';
        sec.setAttribute('data-wxg-hidden', on ? '' : '1');
        if (on) {
            const body = sec.querySelector('.wxg-sec-body');
            if (body && body.style) {
                body.style.display = 'block';   // 工作台里当前段一定展开
            }
        }
    });
    // 顶部跳转条在工作台里不需要（左栏就是导航）
    const nav = hostEl.querySelector('.wxg-nav');
    if (nav) {
        nav.style.display = 'none';
    }
    if (scroll && typeof hostEl.scrollTo === 'function') {
        hostEl.scrollTo(0, 0);
    }
}

/* ------------------------------ 事件 ------------------------------ */

function onWorkspaceClick(e) {
    // ⚠️ 自己往上找目标（不依赖 closest：真机上有，但别赌环境 —— 自审里就吃过 this 的亏）
    let node = e && e.target ? e.target : null;
    let go = null;
    let action = null;
    for (let i = 0; i < 6 && node; i += 1) {
        if (typeof node.getAttribute === 'function') {
            if (go === null && node.getAttribute('data-ws-go') !== null) {
                go = node.getAttribute('data-ws-go');
            }
            if (action === null && node.getAttribute('data-ws-action') !== null) {
                action = node.getAttribute('data-ws-action');
            }
        }
        if (go !== null || action !== null) {
            break;
        }
        node = node.parentNode;
    }
    if (go !== null) {
        showIndex(go, true);
        return;
    }
    if (action === 'close') {
        closeWorkspace();
    }
}

function onKeydown(e) {
    if (e && e.key === 'Escape' && isWorkspaceOpen()) {
        closeWorkspace();
    }
}

/** 让她能一键切"工作台 / 浮层面板"（浮层小框右键或面板按钮都能调） */
export function setLayoutMode(mode) {
    patchSettings({ layoutMode: mode === 'panel' ? 'panel' : 'workspace' });
}
