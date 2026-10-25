import { numOr } from './utils.js';   /* A11：两份 num 收成一份 */
/**
 * 万象阁 · 世界书条目**形状转换层**（新族 ↔ 我们内部用的形状）
 *
 * 为什么要有这一层
 * ----------------
 * TavernWeave 的 `sillytavern-api-reference` 要求：用新一代 `WorldbookEntry` 那族
 * （`getWorldbook`／`replaceWorldbook`／`updateWorldbookWith`／`createWorldbookEntries`／
 *  `deleteWorldbookEntries`），⛔ 别在新代码里用已弃用的 lorebook-entry API。
 *
 * ⚠️ 但这两族**不是同一个形状**（照抄自装好的声明，⛔ 不是凭记忆写的）：
 *   · 旧 `LorebookEntry`：**平铺一层** —— `comment`／`keys`／`type`／`position:'at_depth_as_system'`／
 *     `depth`／`logic`／`exclude_recursion`／`sticky`／`group`…
 *   · 新 `WorldbookEntry`：**嵌套** —— `name`／`strategy:{type,keys,keys_secondary,scan_depth}`／
 *     `position:{type,role,depth,order}`／`recursion:{prevent_incoming,prevent_outgoing,delay_until}`／
 *     `effect:{sticky,cooldown,delay}`／`extra`
 *   ⇒ 换族＝**双向转换**，不是改个函数名。
 *
 * 这一层的规矩
 * ------------
 * 1. **⛔ 一个字段都不许丢**：没被映射到的键**原样收进 `extra`**（新族本来就是为这个留的口子）。
 * 2. **⛔ 不接线**：这一版只提供纯函数，⛔ 任何地方都不调它（阶段 1 的退出条件就是这个）。
 * 3. 位置那串枚举有**语义对不齐**的地方（旧族把"插到深度"和"以什么身份"揉在一个字符串里，
 *    新族拆成了 `type` ＋ `role`）⇒ 来回转换要能还原成原来那个字符串。
 */

/** 位置：旧族的一串枚举 ⇄ 新族的 {type, role} */
const POSITION_TO_NEW = {
    before_character_definition: { type: 'before_character_definition', role: 'system' },
    after_character_definition: { type: 'after_character_definition', role: 'system' },
    before_example_messages: { type: 'before_example_messages', role: 'system' },
    after_example_messages: { type: 'after_example_messages', role: 'system' },
    before_author_note: { type: 'before_author_note', role: 'system' },
    after_author_note: { type: 'after_author_note', role: 'system' },
    at_depth_as_system: { type: 'at_depth', role: 'system' },
    at_depth_as_assistant: { type: 'at_depth', role: 'assistant' },
    at_depth_as_user: { type: 'at_depth', role: 'user' },
};

const POSITION_FROM_NEW = (() => {
    const back = {};
    for (const [oldName, v] of Object.entries(POSITION_TO_NEW)) {
        back[v.type + '|' + v.role] = oldName;
    }
    // `at_depth` ＋ 认不出的身份：退到 system（旧族只有那三种写法）
    back['at_depth|undefined'] = 'at_depth_as_system';
    return back;
})();

/** 被映射走的键（剩下的统统进 extra，⛔ 一个不丢） */
const MAPPED_NATIVE = [
    'uid', 'display_index', 'comment', 'enabled', 'type', 'position', 'depth', 'order',
    'probability', 'keys', 'logic', 'filters', 'scan_depth',
    'case_sensitive', 'match_whole_words', 'use_group_scoring', 'automation_id',
    'exclude_recursion', 'prevent_recursion', 'delay_until_recursion',
    'content', 'group', 'group_prioritized', 'group_weight',
    'sticky', 'cooldown', 'delay',
];

function isNil(v) {
    return v === undefined || v === null;
}

/**
 * 新族 `WorldbookEntry` → 我们内部用的（平铺）形状。
 * ⛔ 纯函数：不改入参。
 */
export function worldbookToNative(w) {
    const src = w && typeof w === 'object' ? w : {};
    const st = src.strategy && typeof src.strategy === 'object' ? src.strategy : {};
    const pos = src.position && typeof src.position === 'object' ? src.position : {};
    const rec = src.recursion && typeof src.recursion === 'object' ? src.recursion : {};
    const eff = src.effect && typeof src.effect === 'object' ? src.effect : {};

    const out = {
        uid: numOr(src.uid, undefined),
        name: src.name !== undefined ? src.name : '',
        comment: src.name !== undefined ? src.name : '',
        enabled: src.enabled !== false,
        /*
         * ⭐ 复审追加 A2：**读函数这边也得给 `disable`**。
         *   上一轮我把 `disable` 加到了**写**函数（nativeToWorldbook）上，
         *   而三处消费者（book-wiki / worldbook ×2）查的是**读出来的那份** ⇒
         *   TavernHelper 通道下「只读开启着的条目」**永远为假**（disable 恒 undefined）。
         */
        disable: src.enabled === false,
        type: st.type || 'selective',
        keys: Array.isArray(st.keys) ? st.keys.slice() : [],
        logic: (st.keys_secondary && st.keys_secondary.logic) || 'and_any',
        filters: (st.keys_secondary && Array.isArray(st.keys_secondary.keys))
            ? st.keys_secondary.keys.slice() : [],
        scan_depth: isNil(st.scan_depth) ? 'same_as_global' : st.scan_depth,
        position: POSITION_FROM_NEW[(pos.type || '') + '|' + (pos.role || 'system')]
            || POSITION_FROM_NEW[(pos.type || '') + '|undefined']
            || 'before_character_definition',
        depth: isNil(pos.depth) ? null : pos.depth,
        order: numOr(pos.order, 100),
        probability: numOr(src.probability, 100),
        exclude_recursion: rec.prevent_incoming === true,
        prevent_recursion: rec.prevent_outgoing === true,
        delay_until_recursion: isNil(rec.delay_until) ? false : rec.delay_until,
        content: src.content !== undefined ? src.content : '',
        sticky: isNil(eff.sticky) ? null : eff.sticky,
        cooldown: isNil(eff.cooldown) ? null : eff.cooldown,
        delay: isNil(eff.delay) ? null : eff.delay,
        // 新族特有：原样带回来，⛔ 不许丢
        extra: src.extra && typeof src.extra === 'object' ? Object.assign({}, src.extra) : {},
    };
    /*
     * ⭐ 兜底：万一上游给了我们没列进映射表的键，也⛔ 不许丢 —— 塞进 extra。
     *    （这正是需求书"格式要稳：自己后一版能读懂上一版"那条的精神。）
     */
    for (const k of Object.keys(src)) {
        if (k === 'uid' || k === 'name' || k === 'enabled' || k === 'content'
            || k === 'strategy' || k === 'position' || k === 'recursion' || k === 'effect'
            || k === 'probability' || k === 'extra') {
            continue;
        }
        out.extra[k] = src[k];
    }
    return out;
}

/**
 * 我们内部（平铺）形状 → 新族要的 `PartialDeep<WorldbookEntry>`。
 * ⛔ 纯函数：不改入参。
 */
export function nativeToWorldbook(n) {
    const src = n && typeof n === 'object' ? n : {};
    const extraIn = src.extra && typeof src.extra === 'object' ? src.extra : {};
    const name = src.comment !== undefined ? src.comment : (src.name !== undefined ? src.name : '');

    // 位置：旧族那串枚举 → {type, role}
    const p = POSITION_TO_NEW[src.position] || POSITION_TO_NEW.before_character_definition;

    /*
     * ⭐ 修复单 #10：**兼容旧族的六个字段**。
     *   为什么：`core/book.js:126-133` 建条目时传的正是旧族叫法
     *   （`key`／`keysecondary`／`selective`／`constant`／`disable`），
     *   而这里原来只读新族的复数 `keys` ⇒ **这几个全被丢掉** ——
     *   新建出来的条目于是"**没有关键词、也不是常驻**"，很可能永远不触发
     *   （她那边看着就是"写进世界书了、但没生效"）。
     *   ⛔ 两套叫法都要认（新族的优先）。
     */
    const asList = (v) => (Array.isArray(v)
        ? v.filter(Boolean).map((x) => String(x))
        : (v === undefined || v === null || String(v).trim() === '' ? [] : [String(v)]));
    const legacyKeys = asList(src.key);
    const legacySec = asList(src.keysecondary);
    const enabledNow = src.enabled !== false && src.disable !== true;

    const out = {
        name,
        enabled: enabledNow,
        disable: !enabledNow,
        content: src.content !== undefined ? src.content : '',
        strategy: {
            // 旧族 `constant: true` ⇒ 常驻（新族 type='constant'）；否则按关键词触发
            type: src.type || (src.constant === true ? 'constant' : 'selective'),
            keys: Array.isArray(src.keys) && src.keys.length ? src.keys.slice() : legacyKeys,
            keys_secondary: {
                logic: src.logic || 'and_any',
                keys: Array.isArray(src.filters) ? src.filters.slice() : legacySec,
            },
            scan_depth: isNil(src.scan_depth) ? 'same_as_global' : src.scan_depth,
        },
        position: {
            type: p.type,
            role: p.role,
            depth: isNil(src.depth) ? 4 : src.depth,
            order: numOr(src.order, 100),
        },
        probability: numOr(src.probability, 100),
        recursion: {
            prevent_incoming: src.exclude_recursion === true,
            prevent_outgoing: src.prevent_recursion === true,
            delay_until: (src.delay_until_recursion === false || isNil(src.delay_until_recursion))
                ? null : src.delay_until_recursion,
        },
        effect: {
            sticky: isNil(src.sticky) ? null : src.sticky,
            cooldown: isNil(src.cooldown) ? null : src.cooldown,
            delay: isNil(src.delay) ? null : src.delay,
        },
    };
    if (Number.isFinite(Number(src.uid))) {
        out.uid = Number(src.uid);
    }
    /*
     * 没被映射走的旧键 + 进来的 extra：一起进 extra。
     * ⚠️ 这里**故意**把 `ui_*` 之类的酒馆内部键也留住 —— 丢了她世界书里那些设置就没了。
     */
    const extra = Object.assign({}, extraIn);
    for (const k of Object.keys(src)) {
        if (MAPPED_NATIVE.includes(k) || k === 'extra' || k === 'name') {
            continue;
        }
        extra[k] = src[k];
    }
    if (Object.keys(extra).length) {
        out.extra = extra;
    }
    return out;
}

/** 转换层用到的映射表（给用例和自检查引用） */
export const WB_SHAPE_INFO = {
    mappedNative: MAPPED_NATIVE.slice(),
    positions: Object.keys(POSITION_TO_NEW),
};
