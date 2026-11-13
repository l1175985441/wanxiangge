/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { getSettings } from '../../core/settings.js'; import { humanStamp } from '../../core/timefmt.js'; import { ledgerClearPreview, listSnapshots, loadState } from '../../core/state.js'; import { mountLayerLimits } from '../layer-limits.js'; import { sanitizeTech } from '../tidy-heads.js'; import { stateLine } from '../controls-note.js'; import { toast } from '../toast.js'; import { trimText } from '../../core/utils.js'; import { CLEAR_WORD, clearWorldOpen } from '../sections.js'; import { saveBar, stage, stagedValue } from './shared.js'; import { button, card, checkbox, el, field, numberInput, row, section, textInput } from './shared.js';
export function secGeneral(host, intoBox) {
    const SECID = 'general';
    const s = getSettings();
    const box = intoBox || section(
        '总控', '整台怎么跑：自动更新、频率、启动行为。'
        + '（要停用整个插件 ⇒ 去酒馆的扩展列表里关它，这里不再放第二个总闸）',
        { open: true });
    const cRun = card('更新与节流');
    cRun.appendChild(checkbox('wxg-auto-update', '新楼生成后自动更新（关掉＝只手动更新）', s.autoUpdate, 'stage-auto-update'));
    cRun.appendChild(stateLine({ el: el, on: s.autoUpdate, onText: '每产生新楼就会自动推一轮，你会看到状态自己变。', offText: '发消息不会自动推；要推请按「立刻更新」或工作台顶部的更新键。' }));
    row(cRun,
        field('更新频率', numberInput('wxg-update-every', s.updateEvery, 1, 10, 'stage-update-every')),
        field('晚几层再更新', numberInput('wxg-update-lag', Number.isFinite(Number(s.updateLag)) ? Number(s.updateLag) : 0, 0, 5, 'stage-update-lag')),
        el('span', 'wxg-note', '她的话：0（默认）＝生成第 N 层时更新第 N-2 层（最新那层还在被刷，先不动）；填 1＝在这之上再往前退一层（第 N-3 层）；频率＝楼推进一次（1回合＝2楼）'));
    /*
     * ⭐ 自动 + 频率 1 ⇒ 明确提示"建议停在上一轮"（复核方问的就是这个）。
     *    为什么建议：新楼一出现就算它，可那时你还能改／能重 roll／能撤回，
     *    引擎先算一遍是**白烧额度**，算出来的状态还可能对应一版不存在的正文。
     *    ⛔ 不偷偷改她存的值——把话说明白＋给一颗一键改的按钮，改不改她定。
     */
    if (s.autoUpdate && Number(s.updateEvery) <= 1) {
        const tip = el('div', 'wxg-note wxg-advice');
        tip.appendChild(el('span', null, '⚠ 自动更新 + 频率 1 ⇒ 你刚发出去那楼会被**立刻**算一遍；'
            + '但那时你还能改、能重 roll、能撤回，引擎这一趟会白烧额度。建议改成 2（停在上一轮，只算落定的楼）。'));
        tip.appendChild(button('改成 2（推荐）', 'use-hold-one', 'wxg-btn-xs'));
        cRun.appendChild(tip);
    }
    cRun.appendChild(checkbox('wxg-protected', '现场保护：正文刚演过的人，本轮只带状态、不重复推演', s.protectedBypass, 'stage-protected'));
    cRun.appendChild(stateLine({ el: el, on: s.protectedBypass, onText: '正文里刚演过的人只带状态，引擎不会替他们再推一遍。', offText: '引擎可能替刚演过的人也推一遍（容易跟正文打架）。' }));
    cRun.appendChild(checkbox('wxg-strict', '严格模式：只带本轮点名的人', s.strictMention, 'stage-strict'));
    cRun.appendChild(stateLine({ el: el, on: s.strictMention, onText: '只把本轮点名的人放进注入；没点到的人不会出现。', offText: '没点到的人也可能被带进来（上下文更全，但更占篇幅）。' }));
    box.appendChild(cRun);
    mountLayerLimits(cRun);
    const cUi = card('入口与启动');
    /* 渲染层 #9：悬浮球的三个开关都在这张卡上；这里取生效值（已存＋还没保存的草稿） */
    const miniEffEarly = Object.assign({}, s.mini || {});
    cUi.appendChild(checkbox('wxg-panel-open', '打开酒馆时自动弹出工作台／面板', s.showPanelOnStart, 'stage-panel-on-start'));
    /*
     * ⭐「把悬浮小框叫回来」——补一个**早就该有**的开关：
     *    小框上那颗 ✕ 的提示一直写着"藏起来（「总控」里能再叫出来）"，
     *    但总控里根本没这个控件 ⇒ 藏了就再也回不来，
     *    连带"手动更新"也失去了唯一的就近入口（复核方问的正是这个）。
     * ⚠️ 它不在 saveBar 那一批里：勾了要**立刻挂载/收起**，⛔ 不等"保存"。
     */
    cUi.appendChild(checkbox('wxg-ball-show', '显示悬浮小框（聊天时常驻，点一下进工作台；手动更新也在它上面）',
        (s.mini && s.mini.show) === true, 'toggle-mini-show'));
    /*
     * 依据＝阿砚 3 件任务 · 渲染层 #9（悬浮球三开关收到一处）：
     *   原来「显示」在这张卡、「悬停展开／钉住」藏在「色板与颜色槽」卡里 —— 同一件事跨两页。
     *   现在三个都在这里；色板卡那边只留一行指路（⛔ 两边各一份，那正是 4-g 的根病）。
     */
    cUi.appendChild(checkbox('wxg-hover-open', '鼠标移入悬浮球就自动展开（不勾＝扫过不会弹开）',
        miniEffEarly.hoverOpen === true, 'mini-hover-toggle'));
    cUi.appendChild(checkbox('wxg-pin-ball', '钉住悬浮球（一挂上就展开）',
        miniEffEarly.pinned === true, 'mini-pin-toggle'));
    box.appendChild(cUi);
    /*
     * ⭐ ③ 操作（目标包「总控页」第三张卡）。
     *   她 2026-10-15 00:45 令：「设置加操作，悬浮球也加上，**双重保险**」——本卡＝双重保险的一半。
     *   ⚠️ 这 7 钮＝**从状态页移出的那一组**：先在本页**接住**，
     *     等悬浮球也接上了，才能把状态页那张卡撕掉（⛔ 先撕＝她就摸不到了）。
     */
    const cOps = card('操作');
    const opsRow = el('div', 'wxg-card-actions');
    /*
     * ★ 20261023（阿砚 16 号）：这颗就是“从快照恢复”——名字改成人话，动作名不动 ✓
     *   原名「撤回上一次」她不一定知道它就是回到最近一次留快照时的账。
     */
    row(opsRow, button('立刻更新', 'update-now', 'wxg-primary'), button('从快照恢复', 'rollback'),
        button('重算本楼', 'replan'));
    opsRow.appendChild(el('span', 'wxg-note', '（快照：每次更新、合并、删楼、换版前都会先留一份；这颗回到**最近一次**那份 —— 连点两次会又回到刚才那份（它自己也会先留一手））'));
    /*
     * ★ 20261023（阿砘 16 号）：快照**列表**——她可以挑一份回去，⛔ 只能撤最近一次 ✗
     */
    try {
const snaps = listSnapshots();
        if (snaps.length) {
            const cSnap = card('快照（可回退）');
            cSnap.appendChild(el('div', 'wxg-note', '每次更新／合并／删楼／换版前都会先留一份。选一份点右边那颗，账就回到那时候。'));
            for (const sp of snaps.slice(0, 6)) {
                const r2 = el('div', 'wxg-card-actions');
                r2.appendChild(el('span', 'wxg-name', sp.label));
                r2.appendChild(el('span', 'wxg-note', '  ' + humanStamp(sp.at) + '  · ' + String(sp.chars) + ' 人物 / ' + String(sp.events) + ' 事件'));
                const b2 = button('恢复这一份', 'rollback-to', 'wxg-btn-sm', String(sp.index));
                r2.appendChild(b2);
                cSnap.appendChild(r2);
            }
            box.appendChild(cSnap);
        }
    } catch (eSnap) { /* 列不出来也不影响主面板 */ }
    /*
     * ⭐ 首夜实测单第 3 条：补推前给**范围**（留空＝全部，向后兼容）。
     *   她原话：「我也不知道他补齐了多少楼？这旁边也没有自己设定的，我可以自己设定要补齐多少楼层。」
     */
    const bfRow = el('div', 'wxg-card-actions');
    bfRow.appendChild(el('span', 'wxg-note', '补推范围：'));
    const bfN = textInput('wxg-backfill-n', stagedValue(SECID, 'backfillN', getSettings().backfillN || ''),
        '补最近几楼（留空＝全部）', 'stage-backfill-n', 'wxg-short');
    bfN.setAttribute('title', '例：填 5 ⇒ 只补最近 5 层你的发言；留空 ⇒ 从最早补到现在（老行为）');
    bfRow.appendChild(bfN);
    opsRow.appendChild(bfRow);
    /*
     * 依据＝阿砚 53 号 M22：补推的进度/结果以前只在状态页顶栏（pipeline.text），她得翻页才看得见。
     *   这里把它**贴到操作卡旁**（同一个 opsRow，⛔ 不另起飘窗）；没有进度时这一行不出现。
     */
    {
        const pText2 = trimText(((loadState() || {}).pipeline || {}).text);
        if (pText2) {
            opsRow.appendChild(el('span', 'wxg-note', '\u8fdb\u5c55\uff1a' + pText2));
        }
    }
    row(opsRow, button('对账（账与楼对齐）', 'reconcile'), button('写入世界书', 'publish-book'),
        button('补推历史', 'backfill'));
    /* 依据＝阿砚 A 组 E4：账本导出／导入（带验签）；⛔ 碰她的书与设置，只搬这一本账 */
    row(opsRow,
        button('导出这本账', 'export-bundle'),
        button('导入账本', 'import-bundle'),
        el('span', 'wxg-note', '（包里自带摘要；被改过一个字就会拒收）'));
    /*
     * ⭐ 首夜实测单第 2 条（她原话：「我们取消的按钮都没有见到……想按个取消也没有见到」）：
     *   `cancel-update` 的 handler 一直**在**（本文件 ~L5278），但**按钮从来没被创建过**（孤儿）——
     *   而「补推」的 toast 却承诺"可随时取消" ⇒ **说了有、实际没有**。
     *   ⇒ 这里接上：**跑中就地出现**（就在这些操作钮旁边），跑完自动收起。
     *   ⚠️ 只在跑中渲染（她不用对着一个永远点不动的"取消"发呆）。
     */
    {
        const pipe = (loadState() && loadState().pipeline) || {};
        const pText = trimText(pipe.text);
        const pFail = /没成|失败|出错|不兼容/.test(pText) || /fail|error/i.test(trimText(pipe.step));
        /* ⭐ 真机抓到的卡死标记：只认“**本会话真的在跑**”（内存态 ✓），⛔ 只认持久化的 step ✗ */
        const liveRun = !!(typeof window !== 'undefined' && window.__wxgLiveRun);
        const running = !pFail && liveRun && !!pipe.step && pipe.step !== 'done' && pipe.step !== 'idle';
        if (running) {
            row(opsRow, button('取消（正在跑）', 'cancel-update', 'wxg-del'));
            /*
             * ⭐ 首夜实测单第 5 条（她 06:09「**立即更新说到了点**」＝认可"点完没有在跑的样子"）：
             *   跑中得有**样子** —— 这里挂一个「⏳ 更新中」胶囊，并把重活按钮**禁用**（点不动、也不吞连点）；
             *   跑完（running 为假）自然恢复 ⇒ 下次重绘时按钮就没有 disabled 了 ✓
             */
            const pill = el('span', 'wxg-busy-pill', '⏳ 更新中…');
            pill.id = 'wxg-ops-busy';
            pill.setAttribute('title', pText || '正在后台跑；想停就点旁边的「取消（正在跑）」');
            opsRow.appendChild(pill);
            const heavy = ['update-now', 'backfill', 'reconcile', 'publish-book', 'replan', 'rollback'];
            for (const a of heavy) {
                const b = opsRow.querySelector('[data-action="' + a + '"]');
                if (b) {
                    b.setAttribute('disabled', 'disabled');
                    b.setAttribute('title', '正在跑（上面的胶囊能看到进度）——想停就点「取消（正在跑）」');
                }
            }
        }
    }
    row(opsRow, button('清空这个世界', 'clear-world-open', 'wxg-del'));
    /*
     * ⭐ 首夜实测单第 7 条（她原话：「（总控那些操作设置）**纠结半天到底是什么意思，我也没搞懂**」）：
     *   每个操作钮给**一句人话**（鼠标悬上去就能看）—— ⛔ 再堆黑话。
     */
    {
        const HINT = {
            'update-now': '立刻把“刚落定的那一楼”算一遍（世界状态＋角色八格）。后台跑，不挡你聊天。',
            rollback: '撑回上一次更新之前的样子（撑回前那一版也留着，能再撑回来）。',
            replan: '把当前这一楼重算一遍（比如你改了字、想重算）；⛔ 重新跑整本账。',
            reconcile: '把“账”和“楼”对齐（看看哪几楼还没入账）。⛔ 改内容，只对账。',
            'publish-book': '把现在的名册／世界状态／编年／**世界状态摘要**，**另写一份**到世界书《万象阁 · 世界后台》（⛔ 动你原来的书；摘要槽常驻启用，其余备份条仍禁用）。',
            backfill: '把之前没算过的楼补算一遍；旁边可以先填“只补最近几楼”（留空＝全部）。跑中可随时取消。',
            'clear-world-open': '清空这个聊天里的世界账（会先问你一次，⛔ 直接清）。',
        };
        for (const a of Object.keys(HINT)) {
            const b = opsRow.querySelector('[data-action="' + a + '"]');
            if (b && !b.getAttribute('title')) {
                b.setAttribute('title', HINT[a]);
            }
        }
    }
    /*
     * ⭐ 首夜实测单第 4 条（她原话：「我也不知道他更新到什么东西了，**还得翻到总空那里去看看**」
     *   ＋「第一次点了一下推了八成……第二次按完才推完，还是翻到那个地方才看到他推了多少」）：
     *   progress 文案**早就存在**（`pipeline.js` 的「准备补推 N 个楼层」／「补推中：第X楼（n/total）」／
     *   「补推中断：…（已完成 X 楼）」），但**只渲在【状态】页** ⇒ 操作在总控、进度在状态，中间隔一次翻页 ✗
     *   ⇒ 这里把进度**搬到操作钮旁边就地显示**（同一个数据源 `loadState().pipeline`），
     *     并**自带一个小自刷**：跑中就每 700ms 刷一次；元素一离开 DOM 就自停（⛔ 不挂全局定时器）。
     */
    const progRow = el('div', 'wxg-note', '');
    progRow.id = 'wxg-ops-progress';
    opsRow.appendChild(progRow);
    {
        const readPipe = () => {
            try {
                return (loadState() && loadState().pipeline) || {};
            } catch (e) {
                return {};
            }
        };
        const draw = () => {
            let p2 = {};
            try {
                p2 = readPipe();
            } catch (e) {
                p2 = {};
            }
            const step = trimText(p2.step);
            const text = trimText(p2.text);
            /*
             * ⚠️ 真机上抓到：**失败/没配好**的旧消息也带着非 done/idle 的 step ⇒ 被我显示成"⏳ 正在跑" ✗
             *   ⇒ 先把"没成/失败"这类**排除出"跑中"**，单独报（她要知道"上次没成、为什么"）。
             */
            const failed = /没成|失败|出错|不兼容/.test(text) || /fail|error/i.test(step);
            /* 同上：只认本会话真在跑 ✓（卡死的旧标记会被当“上次”报出来 ✓） */
            const liveRun2 = !!(typeof window !== 'undefined' && window.__wxgLiveRun);
            const running2 = !failed && liveRun2 && !!step && step !== 'done' && step !== 'idle';
            if (failed) {
                progRow.textContent = '⚠ 上次：' + sanitizeTech(text);
        progRow.title = text;
            } else if (running2) {
                progRow.textContent = '⏳ ' + (text || '正在跑…');
            } else if (text && /补推中断|已取消/.test(text)) {
                /*
                 * 断点续跑要**露出**（她那次"推了八成→再点→推完"的静默中断，屏上根本没说过）：
                 * 留着上次那句话，并告诉她**再点一次「补推历史」就能接着补**。
                 */
                progRow.textContent = '⏸ ' + sanitizeTech(text) + '（再点「补推历史」接着补；填了范围就按范围补）';
            } else if (text) {
                progRow.textContent = '上次：' + sanitizeTech(text);   /* 83 */
            } else {
                progRow.textContent = '（还没跑过；点「补推历史」按范围补，跑中这里会显示 n/N）';
            }
            /*
             * ⭐ RD4（材料 11·渲染层）：**这个轮询不能只改文字** ✓
             *   旧：只 `progRow.textContent = ...` ✗ ⇒ 后台在你停在总控页时开始／结束，
             *     文字变了，但 6 颗操作按钮**该灰的没灰、该恢复的没恢复** ✗
             *   现在：同一个 tick 里把按钮禁用态与「取消」钮也刷一遍 ✓（只动 DOM 属性 ✓）
             */
            try {
                const opActs = ['update-now', 'rollback', 'reconcile', 'publish-book', 'backfill'];
                for (const act of opActs) {
                    const b2 = opsRow.querySelector('[data-action="' + act + '"]');
                    if (!b2) {
                        continue;
                    }
                    if (running2) {
                        b2.setAttribute('disabled', 'disabled');
                        if (b2.style) { b2.style.opacity = '0.5'; }
                    } else {
                        b2.removeAttribute('disabled');
                        if (b2.style) { b2.style.opacity = ''; }
                    }
                }
                const cxl2 = opsRow.querySelector('[data-action^="cancel"]');
                if (cxl2 && cxl2.style) {
                    cxl2.style.display = running2 ? '' : 'none';
                }
            } catch (eRD4) { /* 同步不了也不能把进度搞挂 ✓ */ }
        };
        draw();
        let n = 0;
        const timer = setInterval(() => {
            n += 1;
            if (n > 1200 || !progRow.isConnected) {   // 元素离屏就自停（⛔ 不留全局定时器）
                clearInterval(timer);
                return;
            }
            try {
                draw();
            } catch (e) {
                clearInterval(timer);
            }
        }, 700);
    }
    cOps.appendChild(opsRow);
    if (clearWorldOpen) {
        const prevG = ledgerClearPreview();
        const dangerG = el('div', 'wxg-danger-box wanxiangge');
        dangerG.appendChild(el('div', null, '⚠ 这一步**回不来**。将清掉**这个聊天的世界**：'));
        const listG = el('div', 'wxg-danger-list');
        for (const k of Object.keys(prevG)) {
            listG.appendChild(el('div', null, '· ' + k + '：' + String(prevG[k]) + ' 条'));
        }
        listG.appendChild(el('div', null, '· 世界书《万象阁 · 世界后台》：**不动**'));
        dangerG.appendChild(listG);
        const typeRowG = el('div', 'wxg-card-actions');
        typeRowG.appendChild(el('span', 'wxg-note', '把下面这四个字打进去才能点：'));
        const inpG = el('input', 'wxg-danger-typing');
        inpG.type = 'text';
        // ⚠️ ⛔ 跟状态页那份撞 id（撞了就读到错的那个输入框）
        inpG.id = 'wxg-clear-typing-general';
        inpG.placeholder = CLEAR_WORD;
        inpG.setAttribute('autocomplete', 'off');
        typeRowG.appendChild(inpG);
        typeRowG.appendChild(button('确认清空', 'clear-world-do', 'wxg-del'));
        typeRowG.appendChild(button('算了', 'clear-world-cancel'));
        dangerG.appendChild(typeRowG);
        cOps.appendChild(dangerG);
    }
    cOps.appendChild(el('div', 'wxg-note', '这些操作在悬浮球上也有（聊天时不用进工作台）。'));
    box.appendChild(cOps);
    box.appendChild(saveBar('general'));
    if (!intoBox) { host.appendChild(box); }



}
