/**
 * 万象阁 · 界面渲染
 *
 * 两块：
 *   ① 卡片：挂在她每条发言楼后面（折叠着，一行标题＋状态，点开看内容）；
 *   ② 面板：设置区里的中文面板（名册、召回参数、提示词、进度）。
 *
 * 卡片一律用 DOM 接口拼（textContent 赋值），她填的人名原样显示、不当代码执行。
 */

import { APP_NAME, CARD_ATTR, CARD_CLASS, ROOT_ID, ROSTER_PRESET } from '../core/config.js';
import { getChat, getCtx, formatClock, formatStamp } from '../core/adapter.js';
import { getSettings, patchSettings } from '../core/settings.js';
import {
    addCharacter, applyRosterPreset, getRoster, loadState,
    removeCharacter, updateCharacter, describeRoster, getRecallRecord, recentRecallRecords,
} from '../core/state.js';
import { receiptText, ledgerText } from '../core/ledger.js';
import { toList, trimText, asText, countChars } from '../core/utils.js';
import { replanCurrentFloor } from '../core/actions.js';

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

/** 有没有界面可用（电脑上做纯逻辑测试时没有 document，这里兜住，不影响核心账本） */
function hasDom() {
    return typeof document !== 'undefined' && !!document;
}

/** 取当前聊天的消息节点（按楼层号找 .mes） */
function mesNodeByFloor(floor) {
    const nodes = document.querySelectorAll('.mes');
    for (const node of nodes) {
        const raw = node.getAttribute('mesid');
        if (raw !== null && Number(raw) === Number(floor)) {
            return node;
        }
    }
    return null;
}

/* ------------------------------- 卡片 ------------------------------- */

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

            if (trimText(c.affinity)) {
                row.appendChild(el('div', 'wxg-fact', '好感：' + trimText(c.affinity)));
            } else {
                row.appendChild(el('div', 'wxg-fact wxg-fact-missing', '好感：未接数据源（不显示数值）'));
            }
            if (trimText(c.faction)) {
                row.appendChild(el('div', 'wxg-fact', '所在势力：' + trimText(c.faction)));
            }
            if (trimText(c.current)) {
                row.appendChild(el('div', 'wxg-fact', '正在经历：' + trimText(c.current)));
            }
            const past = Array.isArray(c.past) ? c.past : [];
            if (past.length && trimText(past[0].text)) {
                row.appendChild(el('div', 'wxg-fact', '过去经历：' + trimText(past[0].text)));
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
        colWorld.appendChild(el('div', 'wxg-unit', '（世界局势与暗线在做，第 3 步接上）'));
    } else {
        for (const ev of rec.events) {
            const row = el('div', 'wxg-rowitem');
            row.appendChild(el('div', 'wxg-rowname', trimText(ev && ev.title) || '（未记名）'));
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
    foot.appendChild(el('div', 'wxg-notes', '卡片只给你看：不落正文、不进聊天记录，模型看到的是同一份内容的文字版本。'));
    body.appendChild(foot);

    details.appendChild(body);
    card.appendChild(details);

    // 她手动展开／收起过的话，记住了，下次刷新保持原样
    details.addEventListener('toggle', () => {
        const state = loadState();
        const target = state.recallRecords.find((r) => r && r.floor === rec.floor);
        if (target) {
            target.shown = details.open;
        }
    });

    return card;
}

/** 有卡片就刷、没有就挂（同一楼只留一张；顺手清掉重复和挂错楼的） */
export function refreshCardOnFloor(floor) {
    if (!hasDom()) {
        return;
    }
    const settings = getSettings();
    const node = mesNodeByFloor(floor);
    if (!node) {
        return;
    }

    // ⚠️ 先把这一楼里所有自家卡片摘干净（含嵌套、含重复挂的）——
    //    之前只找直接子元素，重复挂的时候会越挂越多（实测同一楼挂了 3 张）
    const stale = Array.from(node.querySelectorAll('.' + CARD_CLASS));
    for (const old of stale) {
        old.remove();
    }

    const rec = getRecallRecord(floor);
    if (!settings.cardEnabled || !rec) {
        return;
    }
    if (!settings.showEmptyCard && rec.injectStatus === 'empty') {
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

/** 把挂错地方的自家卡片清掉（对应的那一楼已经没有账了） */
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
        const isValid = floor >= 0
            && floors.has(floor)
            && msg
            && msg.is_user === true
            && !msg.is_system;
        if (!isValid) {
            card.remove();
        }
    }
}

/** 按账本把现有聊天的卡片都挂回去（重开酒馆、切聊天后走这里） */
export function mountAllCards() {
    if (!hasDom()) {
        return;
    }
    const chat = getChat();
    if (!Array.isArray(chat) || !chat.length) {
        return;
    }
    for (let floor = 0; floor < chat.length; floor += 1) {
        const m = chat[floor];
        if (!m || !m.is_user || m.is_system) {
            continue;
        }
        refreshCardOnFloor(floor);
    }
    sweepOrphanCards();
}

/* ------------------------------- 面板 ------------------------------- */

/** 「过程报告」：每轮到底注入了什么，内容层面看得见（可回看、可复制） */
function renderProcessReport(container) {
    container.replaceChildren();

    const list = recentRecallRecords(20);
    if (!list.length) {
        container.appendChild(el('div', 'wxg-empty', '还没有记录：你发一条消息、正文生成之后，这里就会出现那一轮的详细过程。'));
        return;
    }

    // 新的在最上面：一眼看到刚才那轮
    for (const rec of list) {
        const box = document.createElement('details');
        box.className = 'wxg-report';

        const summary = document.createElement('summary');
        // 字数与回执用**同一个来源**（都现数存下来的那段内容），免得两个数对不上
        const shownChars = countChars(rec.injectedText);
        const statusText = rec.injectStatus === 'ok'
            ? '已注入 ' + String(shownChars) + ' 字'
            : (rec.injectStatus === 'empty' ? '未注入' : (rec.injectStatus === 'error' ? '注入失败' : '待送'));
        summary.appendChild(el('span', 'wxg-report-time', formatStamp(rec.at)));
        summary.appendChild(el('span', 'wxg-report-floor', '第 ' + String((rec.floor || 0) + 1) + ' 楼'));
        summary.appendChild(el('span', 'wxg-report-status', statusText));
        summary.appendChild(el('span', 'wxg-report-who', rec.chars && rec.chars.length ? rec.chars.join('、') : '—'));
        box.appendChild(summary);

        const body = el('div', 'wxg-report-body');

        /* ① 怎么挑的 */
        body.appendChild(el('div', 'wxg-report-h', '① 怎么挑的'));
        const lead = trimText(rec.lead);
        body.appendChild(el('div', 'wxg-fact', '你这条发言：' + (lead ? (lead.length > 80 ? lead.slice(0, 80) + '…' : lead) : '（没记到）')));
        if (Array.isArray(rec.items) && rec.items.length) {
            for (const item of rec.items) {
                const c = item && item.character ? item.character : {};
                const bits = [trimText(c.name) || '（未记名）', '理由：' + (trimText(item.reason) || '—')];
                const has = [];
                if (trimText(c.affinity)) {
                    has.push('好感 ' + trimText(c.affinity));
                } else {
                    has.push('好感未接入数据源');
                }
                if (trimText(c.identity)) {
                    has.push('身份 ' + trimText(c.identity));
                }
                if (trimText(c.current)) {
                    has.push('正在经历');
                }
                if (Array.isArray(c.past) && c.past.length) {
                    has.push('过去经历 ' + String(c.past.length) + ' 条');
                }
                bits.push('带了：' + has.join('、'));
                if (item.protected) {
                    bits.push('现场保护（不重复推演）');
                }
                body.appendChild(el('div', 'wxg-fact', '· ' + bits.join(' ｜ ')));
            }
        } else {
            body.appendChild(el('div', 'wxg-empty', '本轮没有召回任何人'));
        }
        if (Array.isArray(rec.notes) && rec.notes.length) {
            body.appendChild(el('div', 'wxg-notes', '说明：' + rec.notes.join('；')));
        }

        /* ② 到底送进去了什么（内容层面，一字不差） */
        body.appendChild(el('div', 'wxg-report-h', '② 实际送进请求的内容'));
        const text = trimText(rec.injectedText);
        if (text) {
            const pre = el('pre', 'wxg-report-text', text);
            body.appendChild(pre);
            const bar = el('div', 'wxg-row');
            const copyBtn = el('button', 'menu_button wxg-mini', '复制这段');
            copyBtn.addEventListener('click', () => {
                const done = () => {
                    copyBtn.textContent = '已复制';
                    setTimeout(() => { copyBtn.textContent = '复制这段'; }, 1500);
                };
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(done).catch(() => {});
                        return;
                    }
                } catch (e) {
                    // 落到下面的兜底
                }
                try {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    ta.remove();
                    done();
                } catch (e) {
                    console.warn('[万象阁] 复制失败：', e);
                }
            });
            bar.appendChild(copyBtn);
            bar.appendChild(el('span', 'wxg-note', '这段只进请求、不落正文；「注入给谁看」＝写正文的模型。'));
            body.appendChild(bar);
        } else {
            body.appendChild(el('div', 'wxg-empty', '本轮没有内容送进去'));
        }

        /* ③ 回执 */
        body.appendChild(el('div', 'wxg-report-h', '③ 回执'));
        body.appendChild(el('div', 'wxg-fact', receiptText(rec)));
        if (trimText(rec.injectType)) {
            body.appendChild(el('div', 'wxg-notes', '触发方式：' + trimText(rec.injectType)));
        }

        box.appendChild(body);
        container.appendChild(box);
    }
}

/** 名册列表 */
function renderRosterList(container) {
    const roster = getRoster();
    container.replaceChildren();

    if (!roster.length) {
        container.appendChild(el('div', 'wxg-empty', '名册还是空的：上面加人、批量导入，或按预设一键立起十几个角色。'));
        return;
    }

    for (const c of roster) {
        const row = el('div', 'wxg-char');

        const left = el('div', 'wxg-char-main');
        left.appendChild(el('div', 'wxg-char-name', c.name));
        if (c.isPlayer) {
            left.appendChild(el('span', 'wxg-badge wxg-badge-warn', '玩家棋子'));
        }
        if (c.isNew) {
            left.appendChild(el('span', 'wxg-badge wxg-badge-soft', '新认的人'));
        }
        if (c.manual) {
            left.appendChild(el('span', 'wxg-badge wxg-badge-soft', '已手动修改'));
        }
        row.appendChild(left);

        const fields = el('div', 'wxg-char-fields');

        const aliasInput = document.createElement('input');
        aliasInput.type = 'text';
        aliasInput.className = 'text_pole wxg-alias';
        aliasInput.placeholder = '别名／昵称（用顿号或逗号分开）';
        aliasInput.value = Array.isArray(c.aliases) ? c.aliases.join('、') : '';
        aliasInput.addEventListener('change', () => {
            updateCharacter(c.id, { aliases: toList(aliasInput.value), manual: true });
            renderPanel();
        });
        fields.appendChild(aliasInput);

        const affInput = document.createElement('input');
        affInput.type = 'text';
        affInput.className = 'text_pole wxg-affinity';
        affInput.placeholder = '好感（读自"手机"的数据源，未接入前先空着）';
        affInput.value = asText(c.affinity);
        affInput.addEventListener('change', () => {
            updateCharacter(c.id, { affinity: trimText(affInput.value), manual: true });
            renderPanel();
        });
        fields.appendChild(affInput);

        row.appendChild(fields);

        const actions = el('div', 'wxg-char-actions');
        const playerLabel = document.createElement('label');
        playerLabel.className = 'checkbox_label wxg-mini';
        const playerBox = document.createElement('input');
        playerBox.type = 'checkbox';
        playerBox.checked = c.isPlayer === true;
        playerBox.addEventListener('change', () => {
            updateCharacter(c.id, { isPlayer: playerBox.checked, manual: true });
            renderPanel();
        });
        playerLabel.appendChild(playerBox);
        playerLabel.appendChild(el('span', null, '玩家棋子'));
        actions.appendChild(playerLabel);

        const delBtn = el('button', 'menu_button wxg-mini', '删除');
        delBtn.addEventListener('click', () => {
            removeCharacter(c.id);
            renderPanel();
        });
        actions.appendChild(delBtn);
        row.appendChild(actions);

        container.appendChild(row);
    }
}

/** 重画整个面板（数据全从账本现取） */
export function renderPanel() {
    if (!hasDom()) {
        return;
    }
    const root = document.getElementById(ROOT_ID);
    if (!root) {
        return;
    }
    const settings = getSettings();

    const ledgerLine = root.querySelector('#wxg-ledger-line');
    if (ledgerLine) {
        ledgerLine.textContent = '上次更新：' + ledgerText();
    }

    const enabled = root.querySelector('#wxg-enabled');
    if (enabled) {
        enabled.checked = settings.enabled === true;
    }
    const cardEnabled = root.querySelector('#wxg-card-enabled');
    if (cardEnabled) {
        cardEnabled.checked = settings.cardEnabled === true;
    }
    const showEmpty = root.querySelector('#wxg-show-empty');
    if (showEmpty) {
        showEmpty.checked = settings.showEmptyCard === true;
    }
    const protectedBox = root.querySelector('#wxg-protected');
    if (protectedBox) {
        protectedBox.checked = settings.protectedBypass === true;
    }
    const strictBox = root.querySelector('#wxg-strict');
    if (strictBox) {
        strictBox.checked = settings.strictMention === true;
    }

    const recentTurns = root.querySelector('#wxg-recent-turns');
    if (recentTurns && document.activeElement !== recentTurns) {
        recentTurns.value = String(settings.recentTurns);
    }
    const maxChars = root.querySelector('#wxg-max-chars');
    if (maxChars && document.activeElement !== maxChars) {
        maxChars.value = String(settings.maxChars);
    }
    const sortMode = root.querySelector('#wxg-sort-mode');
    if (sortMode && document.activeElement !== sortMode) {
        sortMode.value = settings.sortMode;
    }
    const headerBox = root.querySelector('#wxg-inject-header');
    if (headerBox && document.activeElement !== headerBox) {
        headerBox.value = asText(settings.injectHeader);
    }

    const rosterCount = root.querySelector('#wxg-roster-count');
    if (rosterCount) {
        const d = describeRoster();
        rosterCount.textContent = d.total
            ? ('现有 ' + String(d.total) + ' 人' + (d.players ? '（其中玩家棋子 ' + String(d.players) + ' 人）' : ''))
            : '还没有人物。';
    }

    const rosterBox = root.querySelector('#wxg-roster');
    if (rosterBox) {
        renderRosterList(rosterBox);
    }

    const reportBox = root.querySelector('#wxg-report-list');
    if (reportBox) {
        renderProcessReport(reportBox);
    }
}

/** 面板上的按钮与开关：事件只绑一次 */
function bindPanelEvents(root) {
    const on = (selector, event, handler) => {
        const node = root.querySelector(selector);
        if (node) {
            node.addEventListener(event, handler);
        }
    };

    on('#wxg-enabled', 'change', (e) => {
        patchSettings({ enabled: e.target.checked });
        mountAllCards();
        renderPanel();
    });
    on('#wxg-card-enabled', 'change', (e) => {
        patchSettings({ cardEnabled: e.target.checked });
        mountAllCards();
        renderPanel();
    });
    on('#wxg-show-empty', 'change', (e) => {
        patchSettings({ showEmptyCard: e.target.checked });
        mountAllCards();
        renderPanel();
    });
    on('#wxg-protected', 'change', (e) => {
        patchSettings({ protectedBypass: e.target.checked });
        renderPanel();
    });
    on('#wxg-strict', 'change', (e) => {
        patchSettings({ strictMention: e.target.checked });
        renderPanel();
    });
    on('#wxg-recent-turns', 'change', (e) => {
        patchSettings({ recentTurns: e.target.value });
        renderPanel();
    });
    on('#wxg-max-chars', 'change', (e) => {
        patchSettings({ maxChars: e.target.value });
        renderPanel();
    });
    on('#wxg-sort-mode', 'change', (e) => {
        patchSettings({ sortMode: e.target.value });
        renderPanel();
    });
    on('#wxg-inject-header', 'change', (e) => {
        patchSettings({ injectHeader: e.target.value });
        renderPanel();
    });

    on('#wxg-add-char', 'click', () => {
        const input = root.querySelector('#wxg-new-name');
        const name = trimText(input && input.value);
        if (!name) {
            return;
        }
        addCharacter(name, { manual: true });
        if (input) {
            input.value = '';
        }
        renderPanel();
    });

    on('#wxg-import-roster', 'click', () => {
        const input = root.querySelector('#wxg-roster-import');
        const names = toList(input && input.value);
        const existing = new Set(getRoster().map((c) => c.name));
        let added = 0;
        for (const name of names) {
            if (existing.has(name)) {
                continue;
            }
            addCharacter(name, { manual: true });
            existing.add(name);
            added += 1;
        }
        if (input) {
            input.value = '';
        }
        renderPanel();
        if (!added && names.length) {
            console.info('[万象阁] 批量导入：这些名字名册里已经有了');
        }
    });

    on('#wxg-preset-roster', 'click', () => {
        applyRosterPreset();
        renderPanel();
    });

    on('#wxg-replan', 'click', () => {
        replanCurrentFloor();
    });
}

/* --------------------------- 挂载与卸载 --------------------------- */

/** 把面板挂进扩展设置区（失败也不影响酒馆运行） */
export async function mountPanel(version) {
    if (!hasDom()) {
        return;
    }
    if (document.getElementById(ROOT_ID)) {
        return;
    }
    const ctx = getCtx();
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) {
        console.warn('[万象阁] 没找到扩展设置区，面板没挂上（不影响聊天与注入）');
        return;
    }

    let html = '';
    try {
        if (ctx && typeof ctx.renderExtensionTemplateAsync === 'function') {
            // ⚠️ 模板 id 要带子目录：官方函数是直接拼 `scripts/extensions/<扩展名>/<模板id>.html`，
            //    本文件在 ui/ 里，所以必须写 'ui/template'（写成 'template' 会 404）。
            html = await ctx.renderExtensionTemplateAsync('third-party/万象阁', 'ui/template', {
                rootId: ROOT_ID,
                version: 'v' + asText(version),
            });
        }
    } catch (e) {
        console.warn('[万象阁] 模板渲染失败，改用内置文案：', e);
    }

    if (!trimText(html)) {
        // 兜底：模板拿不到也要能用
        html = '<div id="' + ROOT_ID + '" class="wanxiangge">'
            + '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header">'
            + '<b>万象阁</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>'
            + '<div class="inline-drawer-content"><div class="wxg-ledger" id="wxg-ledger-line"></div>'
            + '<div class="wxg-note">面板模板没读到，但引擎照常工作（注入与卡片不受影响）。</div></div></div></div>';
    }

    host.insertAdjacentHTML('beforeend', html);
    const root = document.getElementById(ROOT_ID);
    if (!root) {
        return;
    }
    bindPanelEvents(root);
    renderPanel();
}
