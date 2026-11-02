/**
 * 万象阁 · 前台／后台判定（96 号 · 2026-10-27 阿砚）
 *
 * 她的原话：「前台后台一定要分开提示词，因为两个不一样…这样的话就是我们两个提示词就是一个管前台，
 * 一个管后台，这样就不会打架了。」
 *
 * 判定照工作流 Step 3.1–3.4（⛔ 不是我们自己拍的）：
 *   · 前台＝正文结束时**仍在场**（排除 <user>）
 *   · 后台＝**空间隔离／视线隔绝／无法立即现实互动**；「转身离去」「消失在街角」⇒ **当场转后台**
 *   · 三类排除：死亡／昏迷／被封印 ⇒ 不算人，不做后台推演
 *   · 驱动力校验 A（命定羁绊）／B（剧情关联）／C（局势关联）⇒ 都没有＝静滞，不推演
 *   · 后台人数上限由配置 `backstageNpcBudget` 控制（⛔ 不写死）
 */
/*
 * 【待接回：在场判定判据清单】原实现见 0.3.599，删于 133 单号 1。
 *   1) 玩家排除（isPlayer／playerName）⇒ 两侧都不进；
 *   2) 不可用（死亡／昏迷）⇒ excluded；
 *   3) 在场：正文里有名字 且 !justLeft ⇒ front；
 *   4) 无驱动力（hasDrive A／B／C）⇒ stagnant；
 *   5) 否则 ⇒ back（记 _drive），按 lastUpdatedAt 降序截到
 *      settings.backstageNpcBudget（默认 6），多出的进 stalledByCap。
 */

const DEAD_WORDS = /死亡|已死|尸体|亡故|殒命/;
const COMA_WORDS = /昏迷|不省人事|濒死|重伤昏迷/;
const SEALED_WORDS = /被封印|封印中|封在/;
const EXIT_WORDS = /转身离去|消失在街角|转身离开|拂袖而去|推门出去|走出门|离开了?这里|掉头就走/;

function t(v) {
    return String(v == null ? '' : v).trim();
}

/** 三类排除：死亡／昏迷／被封印（照 Step 3.3） */
export function isUnavailable(c) {
    const blob = [c && c.current, c && c.timePlace, c && c.identity, c && c.status, c && c.condition]
        .map(t).join(' ');
    return DEAD_WORDS.test(blob) || COMA_WORDS.test(blob) || SEALED_WORDS.test(blob);
}

/** 刚刚离场：正文里他把“离开”写出来了 ⇒ 当场转后台（照 Step 3.3 原文） */
export function justLeft(bodyText, name) {
    const body = t(bodyText);
    const nm = t(name);
    if (!body || !nm || body.indexOf(nm) < 0) {
        return false;
    }
    const at = body.lastIndexOf(nm);
    /* 只看“名字所在那一句”：⛔ 拿 60 字窗口（会把下一句“乙转身离去”算到甲头上） */
    const windowText = body.slice(at, at + 60).split('。')[0];
    return EXIT_WORDS.test(windowText);
}

/** 时间跨度（上轮最后更新时间 → 当前世界钟）——前台「正在经历」的写入格式（判据 5） */
export function timeSpanOf(c, nowClock) {
    const last = t(c && (c.lastClock || c.timePlace));
    const now = t(nowClock) || '未知';
    return last ? (last + ' → ' + now) : ('未知 → ' + now);
}

/**
 * 驱动力 A/B/C（照 Step 3.4）
 * A 命定羁绊：c.contract === true（或 contractTier 非空）
 * B 剧情关联：该角色是某任务的 goal/委托者，或名字与主线人物同场
 * C 局势关联：名字出现在世界局势里
 */
export function hasDrive(c, ctx) {
    const name = t(c && c.name);
    if (!name) {
        return false;
    }
    if (c.contract === true || t(c.contractTier)) {
        return 'A';
    }
    const quests = Array.isArray(ctx && ctx.quests) ? ctx.quests : [];
    for (const q of quests) {
        const blob = [q && q.title, q && q.goal, q && q.owner, q && q.who, q && q.target].map(t).join(' ');
        if (blob.indexOf(name) >= 0) {
            return 'B';
        }
    }
    const sits = Array.isArray(ctx && ctx.situations) ? ctx.situations : [];
    for (const s of sits) {
        const blob = [s && s.title, s && s.sides && JSON.stringify(s.sides)].map(t).join(' ');
        if (blob.indexOf(name) >= 0) {
            return 'C';
        }
    }
    return '';
}

