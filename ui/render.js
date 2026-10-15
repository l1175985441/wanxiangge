/**
 * 万象阁 · 卡片与面板挂载
 *
 * 两块：
 *   ① 卡片：挂在她每条发言楼后面（折叠着：一行标题＋状态，点开才看内容）；
 *   ② 扩展设置区里的那一块（内容由 ui/sections.js 统一提供，与独立面板同源）。
 *
 * 卡片一律用 DOM 接口拼（textContent 赋值），她填的人名原样显示、⛔ 不当代码执行。
 */

import { APP_NAME, CARD_ATTR, CARD_CLASS, ROOT_ID, PANEL_ID } from '../core/config.js';
import { getChat, getCtx } from '../core/adapter.js';
import { getSettings } from '../core/settings.js';
import { loadState, saveState, getRecallRecord } from '../core/state.js';
import { receiptText } from '../core/ledger.js';
import { trimText, asText, asArray } from '../core/utils.js';
import { renderSections, bindSectionEvents } from './sections.js';

/** 造元素的小助手 */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined && text !== null) {
        node.textContent = asText(text);
    }
    return node;
}

/** 有没有界面可用（电脑上做纯逻辑测试时没有 document，这里兜住） */
function hasDom() {
    return typeof document !== 'undefined' && !!document;
}

/* ------------------------------ 卡片 ------------------------------ */

/** 取消息节点（按楼层号找 .mes；⛔ 只认"有编号、确实是用户发言"的那种） */
function mesNodeByFloor(floor) {
    const wanted = Number(floor);
    if (!Number.isFinite(wanted)) {
        return null;
    }
    const nodes = document.querySelectorAll('.mes');
    for (const node of nodes) {
        const raw = node.getAttribute('mesid');
        if (raw === null || String(raw).trim() === '') {
            continue;   // 还在生成／还没入列的占位楼，不认
        }
        if (Number(raw) !== wanted) {
            continue;
        }
        // ⚠️ 酒馆的楼元素上 is_user 是**属性**（不是 class）
        const isUserRaw = node.getAttribute('is_user');
        const isUser = isUserRaw === 'true' || isUserRaw === '' || node.classList.contains('is_user');
        if (!isUser) {
            continue;
        }
        return node;
    }
    return null;
}

function buildCard(rec) {
    const card = el('div', CARD_CLASS);
    card.setAttribute(CARD_ATTR, String(rec.floor));

    const people = Array.isArray(rec.items) ? rec.items.length : 0;
    const events = Array.isArray(rec.events) ? rec.events.length : 0;

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.appendChild(el('span', 'wxg-card-title', APP_NAME + ' · 本轮召回'));
    summary.appendChild(el('span', 'wxg-card-count', '人 ' + String(people) + ' · 事 ' + String(events)));
    summary.appendChild(el('span', 'wxg-card-chevron', '▾'));
    details.appendChild(summary);

    const body = el('div', 'wxg-card-body');

    /* 左栏：人 */
    const colPeople = el('div', 'wxg-col');
    colPeople.appendChild(el('div', 'wxg-col-title', '人 · 各人各自的东西'));
    if (!people) {
        colPeople.appendChild(el('div', 'wxg-empty', '未记录本轮召回'));
    } else {
        for (const item of rec.items) {
            const c = item && item.character ? item.character : {};
            const row = el('div', 'wxg-rowitem');
            const head = el('div', 'wxg-rowname');
            head.appendChild(el('span', 'wxg-name', trimText(c.name) || '（未记名）'));
            if (item && item.reason) {
                head.appendChild(el('span', 'wxg-badge wxg-badge-soft', item.reason));
            }
            if (item && item.protected) {
                head.appendChild(el('span', 'wxg-badge wxg-badge-warn', '现场保护'));
            }
            if (c.isPlayer) {
                head.appendChild(el('span', 'wxg-badge wxg-badge-warn', '玩家棋子'));
            }
            if (c.isNew) {
                head.appendChild(el('span', 'wxg-badge wxg-badge-soft', '新认的人'));
            }
            row.appendChild(head);

            row.appendChild(el('div', 'wxg-fact' + (trimText(c.affinity) ? '' : ' wxg-fact-missing'),
                trimText(c.affinity) ? '好感：' + trimText(c.affinity) : '好感：未接数据源（不显示数值）'));
            if (trimText(c.identity)) {
                row.appendChild(el('div', 'wxg-fact', '身份：' + trimText(c.identity)));
            }
            if (trimText(c.faction)) {
                row.appendChild(el('div', 'wxg-fact', '所在势力：' + trimText(c.faction)));
            }
            if (trimText(c.current)) {
                row.appendChild(el('div', 'wxg-fact', '正在经历：' + trimText(c.current)));
            }
            /*
             * ⭐ 修复单 #30：卡片这边也要**遵守「楼层裁」（pastFloorCut）**，跟注入侧**同一口径**
             *   （`core/recall.js` 的 `keepByFloor`）——原来直接拿 `past[0]`，
             *   于是**卡片上写着、引擎实际没端**（被裁掉了）⇒ 她会以为引擎端了。
             *   · 端过的（`injected`）不显示；
             *   · 来源在最近 N 楼内的不显示（主模型上下文里本来就有）；
             *   · 老数据没有来源楼层 ⇒ 当"很老"、照显示（⏔ 因缺字段丢内容）。
             */
            const past = Array.isArray(c.past) ? c.past : [];
            const pastCut = Number.isFinite(Number(getSettings().pastFloorCut)) ? Number(getSettings().pastFloorCut) : 0;
            const pastAnchor = Number(rec && rec.floor);
            const keepPast = (pp) => {
                /*
                 * ⭐ 复审追加 B1：**去掉 `|| pp.injected`**。
                 *   上一轮我多加了它 ⇒ 注入一完成（那一刻就把端出去的标了 injected）
                 *   ⇒ 卡片上的「过去经历」**当场消失**（本轮的全被标了）。
                 *   修复单只要求**楼层裁**同口径（`keepByFloor` 不碰 injected）。
                 */
                if (!pp || !trimText(pp.text)) {
                    return false;
                }
                if (!pastCut || !Number.isFinite(pastAnchor)) {
                    return true;
                }
                const from = Number(pp.fromFloor);
                if (!Number.isFinite(from)) {
                    return true;   // 老数据：当很老
                }
                return (pastAnchor - from) >= pastCut;
            };
            const pastShown = past.filter(keepPast);
            if (pastShown.length) {
                row.appendChild(el('div', 'wxg-fact', '过去经历：' + trimText(pastShown[0].text)));
            }
            if (trimText(c.timePlace)) {
                row.appendChild(el('div', 'wxg-fact', '时间·地点：' + trimText(c.timePlace)));
            }
            colPeople.appendChild(row);
        }
    }
    body.appendChild(colPeople);

    /* 右栏：事 */
    const colWorld = el('div', 'wxg-col');
    colWorld.appendChild(el('div', 'wxg-col-title', '事 · 世界的事'));
    if (!events) {
        colWorld.appendChild(el('div', 'wxg-empty', '未记录本轮召回'));
    } else {
        for (const ev of rec.events) {
            const row = el('div', 'wxg-rowitem');
            const head = el('div', 'wxg-rowname');
            head.appendChild(el('span', null, trimText(ev && ev.title) || '（未记名）'));
            if (ev && ev.kind === 'hidden') {
                head.appendChild(el('span', 'wxg-badge wxg-badge-soft', '暗线'));
            }
            if (ev && trimText(ev.stage)) {
                head.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(ev.stage)));
            }
            if (ev && trimText(ev.tier)) {
                head.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(ev.tier)));
            }
            row.appendChild(head);
            if (ev && trimText(ev.text)) {
                row.appendChild(el('div', 'wxg-fact', trimText(ev.text)));
            }
            colWorld.appendChild(row);
        }
    }
    body.appendChild(colWorld);

    /* 回执＋说明 */
    const foot = el('div', 'wxg-card-foot');
    foot.appendChild(el('div', 'wxg-receipt', '回执：' + receiptText(rec)));
    if (Array.isArray(rec.notes) && rec.notes.length) {
        foot.appendChild(el('div', 'wxg-notes', '说明：' + rec.notes.join('；')));
    }
    const world = loadState().world || {};
    if (trimText(world.clock)) {
        foot.appendChild(el('div', 'wxg-notes', '世界钟：' + trimText(world.clock) + (trimText(world.place) ? ' · ' + trimText(world.place) : '')));
    }
    foot.appendChild(el('div', 'wxg-notes', '卡片只给你看：不落正文、不进聊天记录。想看这一轮到底送进去什么，去面板「过程报告」。'));
    body.appendChild(foot);

    details.appendChild(body);
    card.appendChild(details);

    details.addEventListener('toggle', () => {
        const want = details.open === true;
        const target = getRecallRecord(rec.floor);
        if (target && Boolean(target.shown) !== want) {
            target.shown = want;
            scheduleCardToggleSave();
        }
    });

    return card;
}

let cardToggleTimer = null;
function scheduleCardToggleSave() {
    if (cardToggleTimer) {
        clearTimeout(cardToggleTimer);
    }
    cardToggleTimer = setTimeout(() => {
        cardToggleTimer = null;
        saveState();
    }, 300);
}

/** 有卡片就刷、没有就挂（同一楼只留一张；顺手清掉重复与挂错楼的） */
export function refreshCardOnFloor(floor) {
    if (!hasDom()) {
        return;
    }
    const settings = getSettings();
    const node = mesNodeByFloor(floor);
    if (!node) {
        return;
    }
    // 先把这一楼里所有自家卡片摘干净（含嵌套、含重复挂的）
    const stale = asArray(node.querySelectorAll('.' + CARD_CLASS));
    for (const old of stale) {
        old.remove();
    }

    const rec = getRecallRecord(floor);
    if (!settings.cardEnabled || !rec) {
        return;
    }
    if (!settings.showEmptyCard && rec.injectStatus === 'empty' && !(rec.events && rec.events.length)) {
        return;
    }

    const fresh = buildCard(rec);
    if (rec.shown) {
        const d = fresh.querySelector('details');
        if (d) {
            d.open = true;
        }
    }
    node.appendChild(fresh);
}

/** 清掉"对应楼层已经没有账／不是她的发言"的卡片 */
function sweepOrphanCards() {
    if (!hasDom()) {
        return;
    }
    const chat = getChat();
    const state = loadState();
    const floors = new Set(
        (Array.isArray(state.recallRecords) ? state.recallRecords : [])
            .filter((r) => r && Number.isFinite(r.floor))
            .map((r) => Number(r.floor)),
    );
    const cards = document.querySelectorAll('.' + CARD_CLASS);
    for (const card of cards) {
        const raw = card.getAttribute(CARD_ATTR);
        const floor = raw === null ? -1 : Number(raw);
        const msg = chat[floor];
        const host = card.closest('.mes');
        const hostId = host && host.getAttribute('mesid') !== null ? Number(host.getAttribute('mesid')) : NaN;
        const isValid = floor >= 0 && floors.has(floor) && msg && msg.is_user === true && !msg.is_system && hostId === floor;
        if (!isValid) {
            card.remove();
        }
    }
    for (const floor of floors) {
        const node = mesNodeByFloor(floor);
        if (!node) {
            continue;
        }
        const mine = node.querySelectorAll('.' + CARD_CLASS);
        if (mine.length > 1) {
            for (let i = 0; i < mine.length - 1; i += 1) {
                mine[i].remove();
            }
        }
    }
}

/** 按账本把卡片挂回去（刷新后消息是分几拍画出来的，所以默认再补一轮） */
export function mountAllCards(tries, delay) {
    if (!hasDom()) {
        return;
    }
    const list = getChat();
    const chat = Array.isArray(list) ? list : [];
    // 不给参数时也补一轮：⛔ 别因为"画得慢"漏挂卡片
    const rounds = tries === undefined || tries === null ? 1 : Math.max(0, Math.trunc(Number(tries) || 0));
    const wait = Number.isFinite(Number(delay)) ? Number(delay) : 1200;

    if (chat.length) {
        for (let floor = 0; floor < chat.length; floor += 1) {
            const m = chat[floor];
            if (!m || !m.is_user || m.is_system) {
                continue;
            }
            refreshCardOnFloor(floor);
        }
        sweepOrphanCards();
    }

    if (rounds > 0) {
        setTimeout(() => mountAllCards(rounds - 1, wait), wait);
    }
}

/* ------------------------------ 面板（扩展设置区那一块） ------------------------------ */

/** 扩展设置区里的那一片内容的宿主 */
function settingsHost() {
    const root = document.getElementById(ROOT_ID);
    if (!root) {
        return null;
    }
    let host = root.querySelector('.wxg-settings-host');
    if (!host) {
        host = el('div', 'wxg-settings-host');
        root.appendChild(host);
    }
    return host;
}

/** 重画设置区那一块 */
export function renderPanel() {
    if (!hasDom()) {
        return;
    }
    const host = settingsHost();
    if (!host) {
        return;
    }
    /*
     * ⭐ 目标核对 2(a)：**设置区不再全量渲染工作台**。
     *   她原话："谁在魔法棒已经有工作台的情况下这个上面还搞一堆面板？"——
     *   原来这里把整套 10 段画进设置区（**展开总高 9303px**）⇒ 她判了：不行。
     *   照她给的参照（屏蔽词净化助手）：收敛成**一行说明 + 一个「打开工作台」按钮**。
     *   ⚠️ ⏔ 再把内容画回来（她就是为这个报的）；工作台自己那份照旧。
     */
    while (host.firstChild) {
        host.removeChild(host.firstChild);
    }
    const rowEl = el('div', 'wxg-set-openrow');
    rowEl.appendChild(el('span', 'wxg-note', '界面在「工作台」里（左侧栏切页）。'));
    const btn = el('button', 'menu_button wxg-set-openbtn', '打开工作台');
    btn.type = 'button';
    btn.addEventListener('click', () => {
        // ⏔ 静态 import（免得跟 workspace/sections 绕成环）
        import('./workspace.js').then((m) => {
            m.openWorkspace();
        }).catch((e) => {
            console.warn('[万象阁] 打开工作台失败：', e);
        });
    });
    rowEl.appendChild(btn);
    host.appendChild(rowEl);
}

/**
 * 把设置区那一块挂进酒馆扩展设置区。
 *
 * ⚠️ 实测（真机冒烟时偶发失败）：`#extensions_settings2` 是酒馆**后来才建**的容器，
 *    比扩展启动晚 ⇒ 只试一次会直接放弃、那块就永远不出现（"设置区没挂上"）。
 *    ⇒ 这里自带**重试窗口**（和魔法棒入口一个路子），容器一出现就挂上。
 */
const MOUNT_TRIES = 100;
const MOUNT_INTERVAL_MS = 300;

export async function mountPanel(version) {
    if (!hasDom()) {
        return;
    }
    for (let i = 0; i < MOUNT_TRIES; i += 1) {
        if (document.getElementById(ROOT_ID)) {
            return;
        }
        // eslint-disable-next-line no-await-in-loop
        const ok = await tryMountPanel(version);
        if (ok) {
            return;
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, MOUNT_INTERVAL_MS));
    }
    console.warn('[万象阁] 等了 ' + String(Math.round(MOUNT_TRIES * MOUNT_INTERVAL_MS / 1000))
        + ' 秒也没等到扩展设置区的容器，那一块没挂上（不影响聊天与注入）');
}

/** 试一次；挂上了返回 true，容器还没出现返回 false */
async function tryMountPanel(version) {
    const ctx = getCtx();
    const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!container) {
        return false;
    }

    let html = '';
    try {
        if (ctx && typeof ctx.renderExtensionTemplateAsync === 'function') {
            // ⚠️ 模板 id 要带子目录（官方函数是直接拼路径）
            html = await ctx.renderExtensionTemplateAsync('third-party/万象阁', 'ui/template', {
                rootId: ROOT_ID,
                version: 'v' + asText(version),
            });
        }
    } catch (e) {
        console.warn('[万象阁] 模板渲染失败，改用内置文案：', e);
    }

    if (!trimText(html)) {
        html = '<div id="' + ROOT_ID + '" class="wanxiangge"><div class="inline-drawer">'
            + '<div class="inline-drawer-toggle inline-drawer-header"><b>万象阁</b>'
            + '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>'
            + '<div class="inline-drawer-content"></div></div></div>';
    }

    container.insertAdjacentHTML('beforeend', html);
    const root = document.getElementById(ROOT_ID);
    if (!root) {
        return false;
    }
    const host = settingsHost();
    if (host) {
        bindSectionEvents(host, renderPanel);
        renderSections(host, { mode: 'settings' });
    }
    return true;
}

/** 面板开着吗（给入口做高亮） */
export function isPanelElementOpen() {
    const el2 = document.getElementById(PANEL_ID);
    return !!(el2 && el2.isConnected);
}
