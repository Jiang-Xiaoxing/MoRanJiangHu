/**
 * 规划 ↔ 社交 一致性校准。
 *
 * 背景（玩家反馈）：规划由规划分析 AI 周期性再生成，生成时会把已退场/
 * 从未入档的角色从剧情上下文里「带回来」，正文模型读到这些关联人物后
 * 让角色凭空出现。回档/读档链路本身对规划与社交是同步恢复的，缺的是
 * 「规划里的关联人物是否仍在社交档案中」这一层确定性校验。
 *
 * 策略：只做幂等标记，不做剔除——规划里未在档的人物也可能是「尚未出场」
 * 的合法未来规划，直接删会误伤。在条目的 当前状态 上追加/刷新
 * 【人物核对】标记，正文模型与下一轮规划分析都会读到该提示，自行决定
 * 入场安排或清理条目。
 */

// 标记总是由本工具追加在 当前状态 末尾；剥离时只认末尾的完整标记段，
// 避免误吞标记后面的普通文本。
const 人物核对标记正则 = /\s*【人物核对】[^【]*$/;

const 规范化人物名 = (value: unknown): string => (
    typeof value === 'string' ? value.trim().replace(/\s+/g, '').toLowerCase() : ''
);

/** 从社交列表收集在档人物名（含别名/称号），玩家名一并算在档。 */
export const 收集在档人物名集合 = (social: unknown, 玩家名?: unknown): Set<string> => {
    const names = new Set<string>();
    const 记入 = (value: unknown): void => {
        const normalized = 规范化人物名(value);
        if (normalized) names.add(normalized);
    };
    记入(玩家名);
    if (Array.isArray(social)) {
        social.forEach((npc) => {
            if (!npc || typeof npc !== 'object') return;
            记入((npc as any).姓名);
            const 别名 = (npc as any).别名;
            if (typeof 别名 === 'string') 记入(别名);
            if (Array.isArray(别名)) 别名.forEach(记入);
            const 称号 = (npc as any).称号;
            if (typeof 称号 === 'string') 记入(称号);
        });
    }
    return names;
};

const 追加核对标记 = (当前状态: unknown, missing: string[]): string => {
    const base = typeof 当前状态 === 'string' ? 当前状态.replace(人物核对标记正则, '').trim() : '';
    const note = `【人物核对】关联人物 ${missing.map((name) => `「${name}」`).join('')}不在当前社交档案中（可能已退场或尚未出场），安排其登场前需先确认去向或补写入场。`;
    return base ? `${base} ${note}` : note;
};

/** 校准单个条目（带 关联人物/当前状态 字段），返回是否有变更。 */
const 校准条目 = (entry: unknown, 在档名单: Set<string>): boolean => {
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as { 关联人物?: unknown; 当前状态?: unknown };
    if (!Array.isArray(record.关联人物)) return false;
    const missing = Array.from(new Set(
        record.关联人物
            .map((name) => (typeof name === 'string' ? name.trim() : ''))
            .filter((name) => name && !在档名单.has(规范化人物名(name)))
    ));
    if (missing.length === 0) {
        // 人物已全部回档时清掉旧标记，避免提示残留。
        if (typeof record.当前状态 === 'string' && 人物核对标记正则.test(record.当前状态)) {
            record.当前状态 = record.当前状态.replace(人物核对标记正则, '').trim();
            return true;
        }
        return false;
    }
    const next = 追加核对标记(record.当前状态, missing);
    if (next === record.当前状态) return false;
    record.当前状态 = next;
    return true;
};

/**
 * 校准一份规划（剧情规划 / 同人剧情规划通用：都含 当前章任务 + 镜头规划）。
 * 原地修改并返回同一对象与变更条目数，便于调用方记诊断日志。
 */
export const 校准规划关联人物一致性 = <T>(
    plan: T | undefined | null,
    在档名单: Set<string>
): { plan: T | undefined | null; 变更条目数: number } => {
    if (!plan || typeof plan !== 'object') return { plan, 变更条目数: 0 };
    let 变更条目数 = 0;
    const 列表字段: string[] = ['当前章任务', '镜头规划'];
    列表字段.forEach((field) => {
        const list = (plan as any)[field];
        if (!Array.isArray(list)) return;
        list.forEach((entry) => {
            if (校准条目(entry, 在档名单)) 变更条目数 += 1;
        });
    });
    return { plan, 变更条目数 };
};
