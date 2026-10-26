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

import { WORKSPACE_ID, MINI_ID, SIDEBAR_ICONS, SIDEBAR_SHORT, groupOfSection } from '../core/config.js';
import { tidyText, parenText, stripParen } from './tidy-heads.js';   /* 78：左栏导航名词去括号 */
import { getSettings, patchSettings } from '../core/settings.js';
import { agoText } from '../core/timefmt.js';   /* A9：状态带要人话时间 */
import { renderSections, bindSectionEvents, fillText, hasUnsavedDraft } from './sections.js';
import { toast } from './toast.js';
import { applyAppearance } from './theme.js';
import { iconSvg } from './icons.js';
import { loadState, snapshotCount } from '../core/state.js';   /* 渲染层 #3：可撤回数并进顶栏第五格 */
import { trimText, asArray } from '../core/utils.js';

let wsEl = null;
/** 挂在 document 上的 Esc 处理（关工作台时得摘掉） */
let wsKeydownHandler = null;
let sideEl = null;
let hostEl = null;
/** 页级大标题那两个节点（在 hostEl 外面，⛔ 不参与 renderSections 的清空） */
let pageHeadEl = null;
/** A9：每页顶那条全局状态带（在 hostEl 外面，⛔ 被 renderSections 清掉） */
let statusBandEl = null;
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
    // ⭐ 补掃漏：把挂在 document 上的 keydown 摘掉（⛔ 它会跟着 root 一起消失——它压根不在 root 上）
    if (wsKeydownHandler) {
        try {
            document.removeEventListener('keydown', wsKeydownHandler);
        } catch (e) {
            // 摘不掉也不能把关闭流程带崩
        }
        wsKeydownHandler = null;
    }
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
    /*
     * ⭐ 材料 10 · 第 2 组裁定（她 10-17 授权代拍）：**「读取控制」要有一个顶层快捷入口** ✓
     *   旧：只在左栏「调设置 → 读取控制（四格）」里 ✗ ⇒ 藏得深（她与谷歌审都点过“找不到” ✗）
     *   现在：页头右上**常驻一颗「读取控制」** ✓（在哪一页都看得见 ✓），点它直达那一页 ✓
     *   ⛔ 写死页码：按左栏条目名**现找** ✓（顺序变了也不会点错页 ✓）
     */
    const quickRead = document.createElement('button');
    quickRead.className = 'wxg-ws-quick';
    quickRead.type = 'button';
    quickRead.textContent = '读取控制';
    quickRead.title = '直达「读取控制（四格）」那一页';
    quickRead.setAttribute('data-ws-action', 'goto-readctl');
    right.appendChild(quickRead);
    /*
     * 阿砚 71 号：说明文字默认不显示 ⇒ 顶栏给一颗「ⓘ 说明」，点一下才把它们放出来。
     *   ⛔ 每张卡各自一个开关（那又是一堆小字）。
     */
    const notesBtn = document.createElement('button');
    notesBtn.className = 'wxg-ws-quick wxg-notes-btn';
    notesBtn.type = 'button';
    notesBtn.textContent = 'ⓘ 说明';
    notesBtn.title = '显示／隐藏页面里的说明与提示';
    notesBtn.setAttribute('data-ws-action', 'toggle-notes');
    right.appendChild(notesBtn);
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

    /*
     * ⭐ 页级大标题 ＋ 一行副题（参照 Anima「API 连接配置」、观棋「世界参数」）。
     * ⚠️ 它必须在 `hostEl` **外面**：`renderSections` 会 `replaceChildren` 清空 hostEl，
     *    放里面会被一起清掉（这一条我写之前就想清楚了，别搬进去）。
     */
    const page = document.createElement('div');
    page.className = 'wxg-ws-page';
    pageHeadEl = document.createElement('header');
    pageHeadEl.className = 'wxg-ws-pagehead';
    const h1 = document.createElement('h2');
    h1.className = 'wxg-ws-h1';
    h1.id = 'wxg-ws-h1';
    const h1sub = document.createElement('p');
    h1sub.className = 'wxg-ws-h1sub';
    h1sub.id = 'wxg-ws-h1sub';
    pageHeadEl.appendChild(h1);
    pageHeadEl.appendChild(h1sub);
    page.appendChild(pageHeadEl);

    /*
     * 依据＝阿砚第三批 质感 A9（每页没有一条全局状态带）：
     *   每页顶都要能看到「世界钟 · 当前地点 · 上次更新」；⛔ 要翻回主窗口才知道现在几点。
     *   放在 hostEl **外面**（和页头一个道理：renderSections 会清空 hostEl）。
     */
    statusBandEl = document.createElement('div');
    statusBandEl.className = 'wxg-ws-statusband';
    statusBandEl.setAttribute('data-wxg-statusband', '1');
    page.appendChild(statusBandEl);

    hostEl = document.createElement('main');
    hostEl.className = 'wxg-ws-main wanxiangge';
    hostEl.setAttribute('data-wxg-mode', 'workspace');
    page.appendChild(hostEl);
    body.appendChild(page);
    root.appendChild(body);

    // 点左栏、点顶栏按钮、点 Esc
    root.addEventListener('click', onWorkspaceClick);
    /*
     * ⚠️ 补扫漏（技能那条「每个监听都要有成对的清理」）：
     *   `keydown` 挂在 **document** 上（不是挂在我们自己的 root 上），
     *   而 `closeWorkspace()` 只会 `root.remove()` —— **关不掉它**
     *   ⇒ 每关一次再开，document 上就多一个旧的 onKeydown（拿着已经删掉的那个 root）。
     *   ⇒ 挂的时候记下来，关的时候摘掉；顺手防重复挂。
     */
    if (wsKeydownHandler) {
        try {
            document.removeEventListener('keydown', wsKeydownHandler);
        } catch (e) {
            // 摘不掉也不能把开工作台带崩
        }
    }
    wsKeydownHandler = onKeydown;
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

/**
 * A9：把「世界钟 · 当前地点 · 上次更新」刷到状态带上。
 *   取不到就写「未设定」（⛔ 编一个“早上”和她的世界对不上）。
 */
function paintStatusBand() {
    if (!statusBandEl) {
        return;
    }
    let clock = '未设定';
    let place = '未设定';
    let update = '还没更新过';
    try {
        const st = loadState();
        const world = (st && st.world) || {};
        clock = trimText(world.clock) || '未设定';
        place = trimText(world.place) || '未设定';
        const pipe = (st && st.pipeline) || {};
        const ago = agoText(pipe.endedAt || pipe.startedAt);
        update = ago ? ('上次更新：' + ago) : '还没更新过';
    } catch (e) {
        /* 读不到账也得有一条带子（⛔ 空白） */
    }
    while (statusBandEl.firstChild) {
        statusBandEl.removeChild(statusBandEl.firstChild);
    }
    const mk = (label, value) => {
        const span = document.createElement('span');
        span.className = 'wxg-ws-statusband-cell';
        const l = document.createElement('span');
        l.className = 'wxg-ws-statusband-k';
        l.textContent = label;
        const v = document.createElement('span');
        v.className = 'wxg-ws-statusband-v';
        v.textContent = value;
        span.appendChild(l);
        span.appendChild(v);
        return span;
    };
    statusBandEl.appendChild(mk('世界钟', clock));
    statusBandEl.appendChild(mk('当前地点', place));
    statusBandEl.appendChild(mk('进度', update));
}

export function refreshWorkspace() {
    if (!hostEl) {
        return;
    }
    applyAppearance(wsEl, getSettings().appearance || {});
    const scroll = hostEl.scrollTop;
    renderSections(hostEl, { mode: 'workspace' });
    paintStatusBand();   /* A9：每页顶那条全局状态带 */
    /*
     * ⚠️⚠️ 致命遗漏（真机与自审一起抓到的）：工作台**从来没绑过事件**！
     *    `renderSections` 只画 DOM；点击／改动的处理在 `bindSectionEvents` 里，
     *    而这里一直没调它 ⇒ **工作台里的按钮和输入框全都点了没反应**
     *    （自审里"加一个人"加了 0 个、勾选存不住，全是这个原因）。
     *    `bindSectionEvents` 自带 `__wxgBound` 防重复，所以在这儿调是安全的。
     */
    bindSectionEvents(hostEl, refreshWorkspace);
    buildSidebar();
    renderChips();
    // 默认停在上次看的那一段
    // ⚠️ 同样只数**条目**（children 里还有组标题，见 showIndex 里的说明）
    const itemCount = asArray(sideEl ? sideEl.querySelectorAll('.wxg-ws-side-item') : []).length;
    const idx = Math.min(Math.max(0, activeIndex), Math.max(0, itemCount - 1));
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
    const secs = asArray(hostEl.querySelectorAll('.wxg-sec'));
    /*
     * ⭐ 左栏**分组**（自家面板参考里点名的做法）：13 段平铺太长 ⇒ 分"看数据／调设置"两堆。
     *    ⚠️ 组按**关键词**配（见 config.SIDEBAR_GROUPS），⛔ 不按序号——段名改字也不会错位。
     */
    let lastGroupKey = null;
    secs.forEach((sec, i) => {
        const titleEl = sec.querySelector('.wxg-sec-title');
        /* 81：段标题已去括号（屏上只留名词）⇒ 原名从 data-wxg-title 取（⛔ 拿被去掉的那份） */
    const name = trimText(sec.getAttribute ? sec.getAttribute('data-wxg-title') : '')
        || trimText(titleEl && titleEl.textContent) || ('第 ' + String(i + 1) + ' 段');
        // ⭐ 侧栏用**简称**（全名会折成两行）；页头那行仍用全名（见 showIndex 里的 data-wxg-sec）。
        const brief = SIDEBAR_SHORT[name] || name;
        const group = groupOfSection(name);
        if (group && group.key !== lastGroupKey) {
            lastGroupKey = group.key;
            const head = document.createElement('div');
            head.className = 'wxg-ws-side-group';
            const lab = document.createElement('span');
            lab.className = 'wxg-ws-side-group-k';
            lab.textContent = group.label;
            /*
             * ⚠️ ⛔ 不加副题：第一版加了（"看数据"＋"世界现在什么样"），真机上看两根挤成
             *    一句"看数据世界现在什么样"——参照里分组就**只有组名**，照它。
             */
            head.appendChild(lab);
            sideEl.appendChild(head);
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wxg-ws-side-item';
        btn.setAttribute('data-ws-go', String(i));
        const ico = document.createElement('span');
        /*
         * ⭐ 图标走本地内联单色线条 SVG（ui/icons.js，零外网依赖）：
         *    保留原类名兼容自测，由 CSS 屏蔽字体伪元素，统一 1.75px 圆角描边跟主色/灰度走。
         */
        const iconKey = SIDEBAR_ICONS[i] || 'fa-circle';
        ico.className = 'wxg-ws-side-ico fa-solid ' + iconKey;
        ico.setAttribute('aria-hidden', 'true');
    /* 依据＝阿砚 B2-4：左侧十项全是细线小图标、识别度低 ⇒ 把图标名带到项上，CSS 按名分色、放大、加粗描边 */
    btn.setAttribute('data-ico', iconKey);
        ico.innerHTML = iconSvg(iconKey);
        const txt = document.createElement('span');
        txt.className = 'wxg-ws-side-txt';
        txt.textContent = stripParen(String(brief));   // ⭐ 侧栏用简称；81 号：括号不上屏
    /*
     * 78 号：左栏也走同一条规矩——**屏上只留名词**，括号里的解释进 `title=`。
     *   导航越短越好扫；悬停仍能看到原文。
     */
    tidyText(txt);
    {
        /*
         * 标题优先取**全名**里的括注（更说得清楚）：
         *   「读取控制」全名括注是「提取／排除四格」，简称里只剩「四格」。
         */
        const paren = parenText(name) || parenText(brief);
        if (paren && !btn.getAttribute('title')) {
            btn.setAttribute('title', paren);
        }
    }
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
        /* 依据＝渲染层 #3：原「世界四值」卡里的“可撤回 N 版”并到这里（第五格） */
        ['可撤回', String(snapshotCount())],
    ];
    // 失败要看得见（⛔ 不许静默降级）：更新失败就在顶栏亮一条
    const p = state.pipeline || {};
    if (p.status === 'failed') {
        items.push(['⚠ 上次更新失败', trimText(p.error) || '看「过程报告」']);
    }
    /*
     * ⭐⭐ 真机抳回来的大坑（材料 10 第 2 组的后续）：**快捷入口会被这里抹掉** ✗
     *   旧：这里只救回 `close` 一颗 ✗ ⇒ 页头那颗「读取控制」默默消失 ✗
     *   真机上就是：刚打开时有 ✓，一刷新（renderChips）就没了 ✗
     *   现在：两颗都先救下、重建后按原顺序放回 ✓
     */
    const close = box.querySelector('[data-ws-action="close"]');
    const keepQuick = box.querySelector('[data-ws-action="goto-readctl"]');
    /* 71 号实机 bug：这里重建顶栏时没救「ⓘ 说明」⇒ 按钮被抹掉、说明再也打不开（她量到 DOM 里 0 个） */
    const keepNotes = box.querySelector('[data-ws-action="toggle-notes"]');
    while (box.firstChild) {
        box.removeChild(box.firstChild);
    }
    for (const [k, v] of items) {
        const chip = document.createElement('span');
        chip.className = 'wxg-ws-chip';
        if (k.startsWith('⚠')) {
            /*
             * 73 号：失败不再把技术串摆在顶栏上——**只留一颗红点**，
             *   原因（HTTP 530、#0 这类）进 `title`，鼠标悬停才看；点开去「每轮记录」看全文。
             */
            chip.className += ' wxg-ws-chip-bad wxg-ws-chip-dot';
            chip.title = k + '：' + v;
            chip.textContent = '';
            chip.setAttribute('aria-label', '上次更新失败（悬停看原因）');
            box.appendChild(chip);
            continue;
        }
        chip.textContent = k + '：' + v;
        box.appendChild(chip);
    }
    if (keepQuick) {
        box.appendChild(keepQuick);
    }
    if (keepNotes) {
        box.appendChild(keepNotes);
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
    /*
     * ⚠️⚠️ 只数**条目**，⛔ 不能数 `sideEl.children`：
     *    加左栏分组之后，children 里混进了组标题（`.wxg-ws-side-group`），
     *    按 children 序号取 ⇒ 第 k 个可能是个组标题（不是按钮）⇒ **高亮全丢**
     *    （自审当场抓到："同时只该有一条高亮，实际 0"）。
     */
    const items = asArray(sideEl.querySelectorAll('.wxg-ws-side-item'));
    items.forEach((b, k) => {
        /*
         * ⚠️ `b` 本身可能是空的（重画时左栏会有空槽位 ⇒ 读 undefined 的 classList 会抛）。
         *    这一抛会让**整个工作台重画中断**，看着就是"点了没反应"。
         */
        if (b && b.classList) {
            b.classList.toggle('is-on', k === activeIndex);
        }
    });
    /*
     * ⭐ 给页头盖一个"当前是哪一页"的钩子（`data-wxg-sec`）。
     *   为什么：工作台页头是**一个共用的**（每页换字），
     *   而目标包要“**名册页的标题居中**”——没这个钩子就只能让**所有页**都居中
     *   （或都不居中）。CSS 里用 `.wxg-ws-pagehead[data-wxg-sec="人物名册"]` 就能**只**管那一页。
     */
    if (pageHeadEl && pageHeadEl.setAttribute && items[activeIndex]) {
        /*
         * ⭐ 修复单 #28（**根修**）：这里要取**全名**，⛔ 不取侧栏简称。
         *   侧栏为了不折行用了简称（`SIDEBAR_SHORT`：读取控制（四格）／自定义 API／提示词），
         *   而 CSS 里那三页的选择器写的是**全名** ⇒ 拿简称去盖这个钩子就**永远匹配不上**
         *   ⇒ 那三页标题不居中（真机截图 08/09/10 实锤）。
         *   ⇒ 从**对应那一段的 `.wxg-sec-title`** 读全名；读不到再退回侧栏文字（老行为）。
         */
        const secNow = asArray(hostEl.querySelectorAll('.wxg-sec'))[activeIndex];
        const titleNow = secNow ? trimText((secNow.querySelector('.wxg-sec-title') || {}).textContent) : '';
        pageHeadEl.setAttribute('data-wxg-sec', titleNow || String(items[activeIndex].textContent || '').trim());
    }
    // 内容区只显示当前那一段（其余藏起来）——像页签一样，一屏只说一件事
    const secs = asArray(hostEl.querySelectorAll('.wxg-sec'));
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
    /* ⭐ 页级大标题：跟着当前段走（标题在 hostEl 外面，所以每切一次都要自己更新） */
    const cur = secs[activeIndex];
    if (pageHeadEl) {
        const h1 = pageHeadEl.querySelector('#wxg-ws-h1');
        const h1sub = pageHeadEl.querySelector('#wxg-ws-h1sub');
        const t = cur && cur.querySelector('.wxg-sec-title');
        if (h1) {
            h1.textContent = trimText(t && t.textContent) || '';
        }
        if (h1sub) {
            // ⚠️ 副题也要走 fillText（`**粗体**` 得渲染成真粗体，⛔ 不能直接 textContent）
            fillText(h1sub, trimText(cur && cur.getAttribute('data-wxg-sub')) || '');
        }
    }
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
        /* ⭐ ST4：切页前提一句 “有没存的改动” ✓（⛔ 拦她切页，不改保存语义 ✗） */
        try {
            if (hasUnsavedDraft()) {
                toast.info('这一段还有没保存的改动（点段底「保存」才生效）');
            }
        } catch (eDr) { /* 提醒不了也不能拦着切页 ✓ */ }
        showIndex(go, true);
        return;
    }
    if (action === 'goto-readctl') {
        /* 按左栏条目名现找那一页 ✓（⛔ 写死页码 ✗） */
        const items = asArray(sideEl ? sideEl.querySelectorAll('.wxg-ws-side-item') : []);
        const hit = items.findIndex((b) => String(b && b.textContent || '').indexOf('读取控制') >= 0);
        if (hit >= 0) {
            showIndex(hit, true);
        }
        return;
    }
    if (action === 'toggle-notes') {
        /*
         * 73 号实机：点了不动。真因＝这里引用了 `root`，但 `root` 不是本函数作用域里的名字
         *   ⇒ 每次点击都抛 `ReferenceError: root is not defined`（被外层 try 吞掉，表现成"点了没反应"）。
         *   现在从 `hostEl` 往上找工作台根（⛔ 再赌一个未定义的变量）。
         */
        const rootEl = (hostEl && typeof hostEl.closest === 'function') ? hostEl.closest('.wxg-ws') : null;
        const main = (rootEl || document).querySelector('.wxg-ws-main');
        if (main) {
            main.classList.toggle('is-notes');
            const on = main.classList.contains('is-notes');
            const btn = (rootEl || document).querySelector('[data-ws-action="toggle-notes"]');
            if (btn) {
                btn.textContent = on ? 'ⓘ 收起' : 'ⓘ 说明';
            }
        }
        return;
    }
    if (action === 'close') {
        closeWorkspace();
    }
}

function onKeydown(e) {
    if (!(e && e.key === 'Escape' && isWorkspaceOpen())) {
        return;
    }
    /*
     * ⭐ 材料 06【6】①：**Esc 要吞掉，⛔ 把酒馆自己的弹窗一并关掉** ✓
     *   （她同时开着其他插件；原来没调 stopPropagation ✗
     *    ⇒ 她想关的是万象阁子浮层，结果酒馆自己的抽屉／弹窗也跟着关了 ✗）
     *   ⛔ preventDefault：酒馆自己也要用 Esc ✓ ⇒ 只止传播、⛔ 拦默认行为 ✗
     */
    if (typeof e.stopPropagation === 'function') {
        e.stopPropagation();
    }
    /*
     * ⭐ 修复单 #29：**先把开着的子浮层关掉**，⛔ 别一按 Esc 就把整个工作台关了。
     *   原来无条件 `closeWorkspace()` ⇒ 她在人物卡／世界条目／记录卡／体检报告里按 Esc，
     *   想关的是**那一张卡**，结果**整页工作台没了**（得重开一遍）。
     *   ⚠️ 选择器用**实名**（核对件点名的四个）：
     *      `card-close`（人物卡）／`we-close`（世界条目）／`record-close`（记录卡）／`health-close`（体检）。
     *   ⛔ 别改成一堆猜的名字——那四个是代码里真实的 `data-action`。
     */
    const closers = ['card-close', 'we-close', 'record-close', 'health-close'];
    for (const act of closers) {
        const btn = document.querySelector('[data-action="' + act + '"]');
        if (btn && typeof btn.click === 'function') {
            btn.click();
            return;   // 一次 Esc 只关一层
        }
    }
    closeWorkspace();
}

/** 让她能一键切"工作台 / 浮层面板"（浮层小框右键或面板按钮都能调） */
export function setLayoutMode(mode) {
    patchSettings({ layoutMode: mode === 'panel' ? 'panel' : 'workspace' });
}
