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
import { floorLabel, numOr } from '../core/utils.js';
import { buildStateSummary } from '../core/summary.js';
import { runUpdate, runReconcile } from '../core/pipeline.js';
// ⭐ 操作组（目标包「悬浮球」）——跟总控操作卡**同一套函数**，⛔ 各算一套
import { rollbackLast } from '../core/state.js';
import { replanCurrentFloor } from '../core/actions.js';
import { publishToBook } from '../core/book.js';
import { syncPanelAppearance } from './theme.js';
// ⭐ 修复单 #26：清空那颗要能切到「总控」页并在**工作台根里**找按钮
import { openWorkspace, showIndex, workspaceRoot, refreshWorkspace } from './workspace.js';
import { toast } from './toast.js';

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
        if (typeof wrapEl.__wxgDragCleanup === 'function') {
            wrapEl.__wxgDragCleanup();
        }
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
    /*
     * ⭐ 修复单 #25：听开关。
     *   原来两处都是**无条件** `applyAppearance` ⇒
     *   她把「配色也用在悬浮小框上」取消了也没用（照样被染色）。
     *   ⭐ 关掉时要**清除**（不是"不管"）——否则上一次染上的颜色会留在身上。
     */
    // ⭐ 复审追加 A3：走统一口径（不勾时**真清除**，⛔ 再写 `{}` 把白底写死）
    syncPanelAppearance(wrapEl, s.appearance || {});

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
    // 头部整条都能点（她点了名字或空白处也能开合，⛔ 不逼她非点那颗小球）
    panelEl = document.createElement('div');
    panelEl.className = 'wxg-mini-panel';
    const head = document.createElement('div');
    head.className = 'wxg-mini-head';
    head.setAttribute('data-mini-action', 'toggle');
    head.appendChild(elText('span', 'wxg-mini-name', '万象阁'));
    const actions = document.createElement('div');
    actions.className = 'wxg-mini-actions';
    actions.appendChild(elBtn('工作台', 'open', '打开整页工作台'));
    /*
     * ⭐ 「更新」就在球上（复核方："选了手动更新，小球是不是得加上手动更新的东西？"）
     *    —— 手动模式下这是**唯一**的更新入口，必须在这儿。
     *    自动模式也留着：想催一次就催一次（不会重复跑，pipeline 自己有在跑判定）。
     */
    actions.appendChild(elBtn('更新', 'update', '立刻更新世界与角色状态（后台跑，不挡你聊天）'));
    actions.appendChild(elBtn('收起', 'collapse', '收回小球（再点球也能开）'));
    actions.appendChild(elBtn('✕', 'hide', '藏起来（「总控」里能再叫出来）'));
    head.appendChild(actions);
    panelEl.appendChild(head);
    const body = document.createElement('div');
    body.className = 'wxg-mini-body';
    panelEl.appendChild(body);

    wrapEl.appendChild(ballEl);
    wrapEl.appendChild(panelEl);

    const pos = s.mini || {};
    wrapEl.style.left = (numOr(pos.x, null) !== null ? numOr(pos.x, null) : Math.max(12, winW() - 96)) + 'px';
    wrapEl.style.top = (numOr(pos.y, null) !== null ? numOr(pos.y, null) : Math.max(12, winH() - 110)) + 'px';

    wrapEl.addEventListener('click', onMiniClick);
    // ⭐ 展开后**不自动收回**（原来鼠标一移开就缩回去 ⇒ 真机上想点面板里的东西会被它躲开，
    //    真人用也会烦）。收起方式：再点一下球／点面板右上角 ✕「收起」／Esc。
    /*
     * ⭐ 材料 06【4】（悬浮球）：**别让鼠标扫过就弹开** ✓
     *   旧：`hoverOpen !== false` ✗ 而默认设置里**根本没有 hoverOpen**（undefined ✗）
     *     ⇒ `undefined !== false` 成立 ⇒ **在聊天界面不小心扫过就啪一下弹开** ✗✗
     *   现在：改成**需要她显式开启**（`=== true` ✓）⇒ 默认不会被扫开 ✓
     *   ⛔ 动“展开后不自动收回”：那是下面注释里写明的**故意设计** ✓ ⇒ 照旧保留 ✓
     */
    wrapEl.addEventListener('mouseenter', () => {
        if ((getSettings().mini || {}).hoverOpen === true && !isExpanded()) {
            setExpanded(true, { auto: true });
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

/** 现在展开着吗 */
export function isExpanded() {
    return !!(wrapEl && wrapEl.classList && typeof wrapEl.classList.contains === 'function'
        && wrapEl.classList.contains('is-open'));
}

/** 展开／收回（小球 ↔ 面板） */
export function setExpanded(on) {
    if (!wrapEl) {
        return;
    }
    const want = on === true;
    wrapEl.setAttribute('data-open', want ? '1' : '0');
    if (panelEl && panelEl.style) {
        panelEl.style.display = want ? 'block' : 'none';
    }
    if (wrapEl.classList && typeof wrapEl.classList.toggle === 'function') {
        wrapEl.classList.toggle('is-open', want);
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
    // ⭐ #25（同上，第二处）
    // ⭐ 复审追加 A3（第二处）
    syncPanelAppearance(wrapEl, getSettings().appearance || {});
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
        /*
         * ⭐ 第一行就说清"现在是自动还是手动"（复核方问的正是这个）：
         *    手动模式下球上那颗「更新」就是唯一入口，得让她一眼知道该不该点它。
         */
        ['更新方式', (getSettings().autoUpdate
            ? '自动（每 ' + String(getSettings().updateEvery || 1) + ' 回合）'
            : '手动（点上面的「更新」）')],
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

    /*
     * ⭐「操作」区（目标包「悬浮球」：6 钮两列）。
     *   她 2026-10-15 00:45：「设置加操作，悬浮球也加上，**双重保险**」。
     *   本区 ＋ 总控操作卡 ＋ 头部那颗「更新」＝ 包里那 7 钮**一处不差**。
     */
    body.appendChild(elText('div', 'wxg-mini-sech', '操作'));
    const ops = document.createElement('div');
    ops.className = 'wxg-mini-ops';
    const mkOp = (text, action, title) => {
        const b = elBtn(text, action, title);
        b.classList.add('wxg-mini-op');
        ops.appendChild(b);
    };
    mkOp('撤回上一次', 'op-rollback', '撤回上一次更新');
    mkOp('重算本楼', 'op-replan', '重算本楼');
    mkOp('对账（账与楼对齐）', 'op-reconcile', '把账与楼对齐');
    mkOp('写入世界书', 'op-publish', '把账写进世界书');
    mkOp('补推历史', 'op-backfill', '补推历史（分批跑）');
    mkOp('取消', 'op-cancel', '取消正在跑的更新／补推');
    mkOp('清空这个世界', 'op-clear', '清空这个聊天的世界（会开工作台让你确认）');
    body.appendChild(ops);
    // 球的颜色：失败红、没跑过灰、其余强调色
    const dot = ballEl && ballEl.querySelector('.wxg-mini-dot');
    if (dot && dot.classList) {
        dot.classList.toggle('is-bad', s.lastUpdate.status === 'failed');
        dot.classList.toggle('is-idle', s.lastUpdate.status === 'idle' || !s.lastUpdate.status);
    }
    wrapEl.setAttribute('data-status', s.lastUpdate.status || 'idle');
}

/* ------------------------------ 小工具 ------------------------------ */

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
    b.className = 'wxg-btn is-mini';
    b.textContent = text;
    b.title = title;
    b.setAttribute('data-mini-action', action);
    return b;
}

/* ------------------------------ 事件 ------------------------------ */

/* ⭐ 材料 06【4】（悬浮球）：**拖完松手那一下不能当点击** ✓
 *   （原来 mouseup 后紧跟的 click 会误视一次展开／收起 ✗）
 *   ⚠️ 这个标志必须在**模块级**（⛔ 在 makeDraggable 里声明——两个函数看不到彼此 ✗） */
let miniJustDragged = false;

function onMiniClick(e) {
    if (miniJustDragged) {
        miniJustDragged = false;
        return;
    }
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
    /*
     * ⭐ 手动更新（复核方点名要的："选了手动更新，悬浮小球是不是得加上手动更新的东西？"）
     *    —— 对：选了手动模式却只能钻进工作台按，等于把唯一的入口藏起来了。
     *    这里跟「账本状态」那颗「立刻更新」**走同一个函数**（⛔ 不复制一份实现，
     *    免得两边行为分叉）。
     */
    if (action === 'update') {
        /*
         * ⭐ 修复单 #26：**跑完了要再刷一次**。
         *   原来只在"开始"时刷一下 ⇒ 它跑完了小框里还是**旧数据**（要手动点一下才变）。
         */
        runUpdate({ manual: true }).then(() => {
            refreshMini();
            if (typeof refreshWorkspace === 'function') {
                try { refreshWorkspace(); } catch (e) { /* 工作台没开就算了 */ }
            }
        }).catch(() => {});
        toast.info('开始更新世界与角色状态（后台跑，不挡你聊天）');
        refreshMini();
        return;
    }
    /*
     * ⭐ 操作组（跟工作台走同一套函数 ⛔ 另写实现）。
     *   「清空这个世界」刻意**不在小框里直接清**：它是不可逆的，
     *   而工作台那份会**先铺开各多少条、再要她手打「确认清空」**；
     *   ⇒ 小框这颗把她**带到工作台并把确认盒打开**，⛔ 在这里绕过那道门。
     */
    if (action === 'op-rollback') {
        const snap = rollbackLast();
        toast.ok(snap ? '已撤回上一次更新（撤回前那一版也留着，能再撤回来）' : '没有可撤回的版本');
        refreshMini();
        return;
    }
    if (action === 'op-replan') {
        replanCurrentFloor();
        toast.info('本楼重新算好了');
        refreshMini();
        return;
    }
    if (action === 'op-reconcile') {
        const res = runReconcile();
        toast.ok('对账完成：清了 ' + String(res.removed) + ' 条对不上的账');
        refreshMini();
        return;
    }
    if (action === 'op-publish') {
        publishToBook({ force: true }).then((res) => {
            if (res && res.ok) {
                toast.ok('已写进世界书《' + res.book + '》：' + String(res.entries) + ' 条');
            } else {
                toast.fail('世界书没写成：' + ((res && res.reason) || '未知原因'));
            }
        });
        return;
    }
    if (action === 'op-backfill') {
        import('../core/pipeline.js').then(({ runBackfill }) => {
            /*
             * ⭐ 材料 06【4】（悬浮球）：**别假报“开始补推”** ✓
             *   旧：不管被防重拦下与否，都先 toast 一句“开始补推历史” ✗
             *     ⇒ 她以为跑上了，实际上上一轮还在跑 ✗
             *   现在：**看结果再报** ✓（ok === false ⇒ 如实说为什么没跑 ✓）
             */
            Promise.resolve(runBackfill()).then((r) => {
                refreshMini();
                try { refreshWorkspace(); } catch (eWs3) { /* 工作台没开就算了 ✓ */ }
                if (r && r.ok === false) {
                    toast.info('没开始：' + (r.reason || '上一轮还在跑'));
                } else {
                    toast.info('开始补推历史（分批跑，可随时取消）');
                }
            }).catch((eBf) => {
                refreshMini();
                toast.fail('补推没跑成：' + ((eBf && eBf.message) || String(eBf)));
            });
        });
        return;
    }
    if (action === 'op-cancel') {
        /* ⭐ 材料 06【4】：**悬浮球上也要有「取消」** ✓（走工作台同一个 cancelUpdate ✓） */
        import('../core/pipeline.js').then(({ cancelUpdate }) => {
            cancelUpdate();
            toast.info('已请求取消（正在跑的那一步跑完就停 ✓）');
            refreshMini();
        });
        return;
    }
    if (action === 'op-clear') {
        openWorkspace();
        // 等工作台挂上了，再把「清空」的确认盒点开（她在那里看数量、手打确认）
        setTimeout(() => {
            /*
             * ⭐ 修复单 #26：**先切到「总控」页**。
             *   为什么：那个 `clear-world-open` 入口**只在总控页**上（sections 里只有那一处），
             *   她停在别的页（名册／状态／世界状态…）时 `querySelector` **什么都找不到**
             *   ⇒ 点了没反应（她报的正是这个）。
             *   ⚠️ 也⛔ 在整份 document 里找：只在**她工作台根**里找（⛔ 抓到抽屉里那份旧副本）。
             */
            try {
                showIndex(4, true);   // 4 = 总控页（跟工作台左栏同一份顺序）
            } catch (e) {
                console.warn('[万象阁] 切总控页没成：', e);
            }
            setTimeout(() => {
                const root = workspaceRoot() || document;
                const btn = root.querySelector('[data-action="clear-world-open"]');
                if (btn) {
                    btn.click();
                } else {
                    toast.info('工作台里的「清空这个世界」在「总控」页，你点一下就能看到');
                }
            }, 250);
        }, 600);
        return;
    }
    if (action === 'collapse') {
        setExpanded(false);
        return;
    }
    if (action === 'hide') {
        patchSettings({ mini: Object.assign({}, getSettings().mini || {}, { show: false }) });
        closeMini();
        return;
    }
    if (action === 'toggle') {
        setExpanded(!isExpanded());
    }
    /*
     * ⭐ 材料 06【4】（悬浮球）：**通用动作也要刷小框与工作台** ✓
     *   旧：只有 `update` 那条路刷了 ✗
     *     ⇒ 她点「撤回上一次／对账／重算本楼」后 ✗
     *     ⇒ **工作台还是旧的**（得手动再开一次才看得到变化 ✗）
     *   现在：这些动作跑完也刷一次 ✓（⛔ 去动展开／收起／隐藏 ✗）
     */
    if (action && action !== 'toggle' && action !== 'collapse' && action !== 'hide') {
        refreshMini();
        try { refreshWorkspace(); } catch (eWs2) { /* 工作台没开就算了 ✓ */ }
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
        const pt = (e && e.touches && e.touches[0]) || (e && e.changedTouches && e.changedTouches[0]) || e;
        if (!pt) {
            return;
        }
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
        const pt = (e && e.touches && e.touches[0]) || (e && e.changedTouches && e.changedTouches[0]) || e;
        if (!pt) {
            return;
        }
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
        /* 真拖过 ⇒ 给紧跟的那次 click 留个标记 ✓（她松手时不会被弹开／收起 ✓） */
        if (moved) {
            miniJustDragged = true;
            setTimeout(() => { miniJustDragged = false; }, 400);   /* 安全网：万一没来 click 也不能一直吞 ✓ */
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
        handle.addEventListener('touchstart', down, { passive: true });
        document.addEventListener('mousemove', move);
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('mouseup', up);
        document.addEventListener('touchend', up);
        root.__wxgDragCleanup = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('touchmove', move);
            document.removeEventListener('mouseup', up);
            document.removeEventListener('touchend', up);
        };
    }
}
