/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { asText, trimText } from '../../core/utils.js'; import { foldCard, statusCardLine } from '../card-fold.js'; import { foldReport, foldStore } from '../status-folds.js'; import { getChronicle, loadState } from '../../core/state.js'; import { ledgerText } from '../../core/ledger.js'; import { runWarning } from '../../core/runwarn.js'; import { sanitizeTech } from '../tidy-heads.js'; import { statusHero } from '../status-hero.js'; import { storageReport } from '../../core/adapter.js'; import { secReport } from './report.js'; import { secSteps } from './steps.js'; import {  } from '../sections.js'; import { button, card, el, line, section } from './shared.js';
export function secStatus(host, intoSelf) {
    /*
     * ⭐ 三页并一页（复核方："这三个是不是应该坐到一个地方？"）
     *    账本状态／现在的进度／过程报告 —— 原来分三页，其实是同一件事的三个切面：
     *    存没存、跑到哪楼、每轮到底送进去什么。
     *    ⏐ 内容一样不少，只是不再各占一个屏。
     */
    const box = section('状态',
        '账本存没存、引擎跑到哪楼、每轮到底送进去什么——'
        + '原来分三页，其实是同一件事。',
        { open: true });
    box.appendChild(statusHero({ el: el, state: loadState() }));   /* 71 号：一屏一句 H 档人话 */
    /* 85#11：满数据下状态页不能全空 ⇒ 给最近发生的 3 条 */
    try {
        const recent = getChronicle().slice(-3).reverse();
        if (recent.length) {
            const rc = card('最近发生');
            for (const c of recent) {
                const line = (trimText(c.who) ? trimText(c.who) + '：' : '') + (trimText(c.text) || '暂无');
            rc.appendChild(el('div', 'wxg-recent-line', line.slice(0, 30)));
            }
            box.appendChild(rc);
        }
    } catch (eRecent) { /* 拿不到编年就不印 */ }
    /*
     * ⭐ 「现在怎么样」这张卡**壳撕了**（照状态页目标态的 ⛔ 清单：
     *   它的信息＝每轮记录最新一条，重复）。
     *   ⚠️ 但里面那几行**一条都没丢**：
     *     · 存档行（✓ 已存进聊天档…）—— 目标包要它并进「进度」框的框底（下一步做）
     *     · 世界四值（局势／暗线／编年／可撤回）—— 将来是「世界」那个框
     *   ⇒ 先只把**外壳**去掉（不再是一张叫「现在怎么样」的卡），行原地留着。
     */
    /*
     * ⭐ 两框布局（照目标包：上排两框「进度｜世界」，下排整条「每轮记录」）。
     *   ⛔ 再一堆竖着摆（原来就是一堆，看不出"两件事"）。
     *   ⭐ 存档行与「上次更新」按包里要求**并进左框的框底**。
     */
    /*
     * ⭐ 右上「功能 ⋮」（照目标包：状态页页头右上也有一个）。
     *   跟名册页那颗**同一个做法**（⛔ 两套）。
     */
    const sTop = el('div', 'wxg-roster-topbar');
    const sFunc = button('功能 ⋮', 'status-func', 'wxg-btn is-func');
    sFunc.title = '导出与统计／可撤回的版本（入口位；包里就是这么标的）';
    sFunc.style.height = '28px';
    sFunc.style.minHeight = '28px';
    sFunc.style.lineHeight = '26px';
    sFunc.style.padding = '0 12px';
    sFunc.style.whiteSpace = 'nowrap';
    sTop.appendChild(sFunc);
    // ⭐ 补⑤：「体检」入口（点一下出一份自检）
    const sHeal = button('体检', 'health-open', 'wxg-btn is-func');
    sHeal.title = '出一份自检：版本／开关／条数／最近失败分类（⛔ 不含正文与钥匙）';
    sHeal.style.height = '28px';
    sHeal.style.minHeight = '28px';
    sHeal.style.lineHeight = '26px';
    sHeal.style.padding = '0 12px';
    sHeal.style.whiteSpace = 'nowrap';
    sHeal.style.marginRight = '6px';
    sTop.insertBefore(sHeal, sFunc);
    box.appendChild(sTop);
    const two = el('div', 'wxg-two');
    const colProg = el('div', 'wxg-col');
    const report = storageReport();
    const line = el('div', 'wxg-store', report.text);
    line.setAttribute('data-tone', report.tone);
    const ledgerRaw = '上次更新：' + ledgerText();
    const ledgerLine = el('div', 'wxg-ledger', sanitizeTech(ledgerRaw));
    ledgerLine.title = ledgerRaw;
        /*
         * 依据＝阿砚 3 件任务 · 渲染层 #3：这行“世界四值”已并进**顶栏第五格**（不再单占一张卡）。
         *   去向：ui/workspace.js 的 renderChips → ['可撤回', ...]（同一份数据，⛔ 再渲染一遍）。
         */
    /*
     * ⚠️ 这段原来是「现在怎么样」卡里那组操作钮（`cAct`）——**已经没人挂它了**
     *   （操作改挂总控页操作卡 ＋ 悬浮球）⇒ 留着就是**死代码**（每次重画白拼一遍）。删掉。
     */
    /*
     * ⭐ 修复单 #31(b)：这里原来还有**一份重复的「清空确认盒」**（id `wxg-clear-typing`）——
     *   但它的**入口只在总控页**（`clear-world-open` 全库只有那一处）
     *   ⇒ 状态页这份**永远没有人能点出来**（死代码），
     *   而且它那个写死的 id 还把事件处理的 fallback **引到了旧份**上（已一并修）。
     *   ⇒ 整块撕掉；她要的那份在**总控页**（输入框 id = `wxg-clear-typing-general`）。
     */
    /*
     * ⭐ 「操作」卡**撕了**（照状态页目标态的 ⛔ 清单：「操作卡」✔️ 已移出）。
     *   它改挂到**两处**，两处合起来就是原来那 7 钮、**一处不差**：
     *     · 总控页 →「操作」卡（v0.2.71）
     *     · 悬浮球 → 头部「更新」＋操作区 6 钮（v0.2.72）
     *   她 2026-10-15 00:45「设置加操作，悬浮球也加上，**双重保险**」——
     *   ⚠️ **先接住、再撕**：那两处都做好了才能撕这里（⛔ 先撕＝她摸不到）。
     */
    /*
     * ⭐ 进度（原「现在的进度」那一整块）⇒ 摆进**左框**；
     *   世界四值 ⇒ 摆进**右框**；两框并排（照目标包：上排两框）。
     */
    secSteps(host, colProg);
    /*
     * ⭐ 存档行／上次更新 ⇒ 收进**进度卡里面**（包里要的是「框底一行」，
     *   ⛔ 只是"跟在卡下面"）。
     *   做法：`secSteps` 已经把卡挂进 colProg 了 ⇒ 把这两行**挪进那张卡**。
     *   拿不到卡就退回原样（⛔ 为了排版把信息弄丢）。
     */
    const progCard = colProg.querySelector ? colProg.querySelector('.wxg-card') : null;
    (progCard || colProg).appendChild(foldStore({ el: el, doc: document, line: line, ledgerLine: ledgerLine }));
    if (progCard) { foldCard({ card: progCard, doc: document, line: statusCardLine(loadState(), runWarning(loadState())) }); }   /* 75：带一句话 */
    box.appendChild(colProg);
    const p = loadState().pipeline || {};
    /*
     * ⭐⭐「更新流水」**整块删了**（2026-10-15 她亲口定的：「那个每轮记录那里也能体现出失败的那个呀，
     *   更新流水的确重复了」）。
     *
     * ⚠️ 我上一轮多虑了：我以为它"报的是正在跑／失败／与手改冲突"、删了就违反"失败必须可见"。
     *   查证结果——**每轮记录本来就报失败**：
     *     · `statusOf()` 里就有「失败」这一档（`injectStatus === 'error'`）
     *     · 筛选胶囊里也摆着「失败」
     *   ⇒ 失败**在两处可见**，这里确实是重复的。以她的话为准。
     *
     * ⭐ 只留一样东西：**与她的手改冲突那几句**——那不是"流水"，
     *   那是"你手改的版本被保住了"的提醒，删了才是真丢信息。
     */
    /* 129-B：在场／后台位置与理由——只在已有进度卡里加一行纯文本 */
    if (Array.isArray(p.screenOn) && p.screenOn.length) {
        const onTxt = p.screenOn.map((x) => String(x.name) + '·' + String(x.place || '')).join('／');
        const offArr = Array.isArray(p.screenOff) ? p.screenOff : [];
        const offTxt = offArr.map((x) => String(x.name) + '·' + String(x.place || '') + (x.reason ? '·' + String(x.reason) : '')).join('／');
        box.appendChild(el('div', 'wxg-plain', '在场 ' + String(p.screenOn.length) + ' 人（' + onTxt + '）'
            + (offArr.length ? '｜后台 ' + String(offArr.length) + ' 人（' + offTxt + '）' : '')));
    }
    if (Array.isArray(p.conflicts) && p.conflicts.length) {
        const cWarn = el('div', 'wxg-plain');
        const warn = el('div', 'wxg-store', '与你的手改冲突（引擎**按你的版本保留**，内容没被冲掉）：');
        warn.setAttribute('data-tone', 'bad');
        cWarn.appendChild(warn);
        for (const c of p.conflicts) {
            cWarn.appendChild(el('div', 'wxg-fact', '· ' + asText(c)));
        }
        box.appendChild(cWarn);
    }
    /*
     * ⭐「每轮记录」（原「过程报告」）也并进这一页——它就是"一行一楼"那张表，
     *    跟上面的进度是同一件事的两面：一个看数量，一个看**到底送了什么**进去。
     *    ⛔ 不删内容，只是不再单占一个屏。
     */
    /* 71 号：「每轮记录」整卡默认折起（调模块） */
    const repFold = foldReport({ el: el, doc: document });
    box.appendChild(repFold.wrap);
    secReport(host, repFold.body);
    if (!intoSelf) {
        host.appendChild(box);
    }

}
