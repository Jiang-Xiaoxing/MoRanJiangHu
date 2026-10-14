import { describe, expect, it, vi } from 'vitest';
import { 执行NPC生图工作流, 构建词组转化性别硬约束 } from '../hooks/useGame/npcImageWorkflow';

const 构建NPC生图依赖 = (socialList: any[]) => {
    const 创建NPC生图任务 = vi.fn((params: any) => ({ id: 'task_1', ...params }));
    const 追加NPC生图任务 = vi.fn();
    return {
        deps: {
            apiConfig: {} as any,
            获取NPC唯一标识: (npc: any, index?: number) => {
                const id = typeof npc?.id === 'string' ? npc.id.trim() : '';
                if (id) return `id:${id}`;
                const name = typeof npc?.姓名 === 'string' ? npc.姓名.trim() : '';
                if (name) return `name:${name}`;
                return `index:${index ?? -1}`;
            },
            获取社交列表: () => socialList,
            获取文生图接口配置: () => ({ 图片后端类型: 'openai', model: 'image-model' }) as any,
            获取生图词组转化器接口配置: () => null,
            获取生图画师串预设: () => null,
            获取当前PNG画风预设: () => null,
            获取NPC角色锚点: () => null,
            获取词组转化器预设提示词: () => '',
            接口配置是否可用: () => true,
            读取文生图功能配置: () => ({ 总开关: true, NPC开关: true, 使用词组转化器: false, NPC画风: '写实' }),
            NPC符合自动生图条件: () => true,
            NPC生图进行中集合: new Set<string>(),
            提取NPC生图基础数据: (npc: any) => npc,
            创建NPC生图任务,
            生成NPC生图记录ID: () => 'record_1',
            追加NPC生图任务,
            更新NPC生图任务: vi.fn(),
            更新NPC最近生图结果: vi.fn()
        },
        创建NPC生图任务,
        追加NPC生图任务
    };
};

describe('npc image workflow auto generation guard', () => {
    it('skips automatic generation when the latest social NPC already has a successful image', async () => {
        const staleNpc = { id: 'npc_su_wanqing', 姓名: '苏晚晴', 性别: '女' };
        const latestNpc = {
            ...staleNpc,
            图片档案: {
                最近生图结果: {
                    id: 'img_avatar_1',
                    状态: 'success',
                    构图: '头像',
                    图片URL: 'https://example.com/avatar.png'
                }
            }
        };
        const { deps, 创建NPC生图任务, 追加NPC生图任务 } = 构建NPC生图依赖([latestNpc]);

        await 执行NPC生图工作流(staleNpc, { 构图: '头像' }, deps as any);

        expect(创建NPC生图任务).not.toHaveBeenCalled();
        expect(追加NPC生图任务).not.toHaveBeenCalled();
        expect(deps.NPC生图进行中集合.size).toBe(0);
    });

    it('skips automatic generation when a name-key snapshot matches an id-backed NPC with a successful avatar', async () => {
        const staleNpc = { 姓名: '俞月荷', 性别: '女' };
        const latestNpc = {
            id: 'npc_yuyuehe',
            姓名: '俞月荷',
            性别: '女',
            图片档案: {
                最近生图结果: {
                    id: 'img_avatar_1',
                    状态: 'success',
                    构图: '头像',
                    图片URL: 'https://example.com/avatar.png'
                }
            }
        };
        const { deps, 创建NPC生图任务, 追加NPC生图任务 } = 构建NPC生图依赖([latestNpc]);

        await 执行NPC生图工作流(staleNpc, { 构图: '头像' }, deps as any);

        expect(创建NPC生图任务).not.toHaveBeenCalled();
        expect(追加NPC生图任务).not.toHaveBeenCalled();
        expect(deps.NPC生图进行中集合.size).toBe(0);
    });
});

describe('npc image workflow age constraints', () => {
    it('does not force cultivation longevity characters to look old', async () => {
        const constraint = 构建词组转化性别硬约束('女', 1000, {
            性别: '女',
            年龄: 1000,
            题材模式: '仙侠',
            境界层级: 24,
            身份: '元婴女修',
            境界: '元婴境',
            简介: '修行多年，驻颜有术，看起来依旧年轻。',
            外貌: '容貌清艳，神情沉静。'
        });

        expect(constraint).toContain('真实年龄只代表经历；外貌按成熟成年人描写');
        expect(constraint).toContain('不得仅因真实年龄称为老妇、老妪或老太婆');
        expect(constraint).not.toContain('85 years old');
    });

    it('uses four-base-gender constraints for femboy characters', async () => {
        const constraint = 构建词组转化性别硬约束('男娘', 22, {
            性别: '男娘',
            年龄: 22,
            身份: '戏班名伶',
            简介: '男身女相，台上常作闺秀装束。'
        });

        expect(constraint).toContain('输入资料中的性别是“男娘”');
        expect(constraint).toContain('不要改成普通壮汉');
        expect(constraint).toContain('femboy');
        expect(constraint).toContain('extremely feminine face');
        expect(constraint).toContain('youthful appearance');
    });

    it('keeps futanari defaults youthful and female-led', () => {
        const constraint = 构建词组转化性别硬约束('扶她', 28, {
            性别: '扶她',
            年龄: 28,
            身份: '女将军',
            简介: '英气逼人，却仍以美貌示人。'
        });

        expect(constraint).toContain('futanari');
        expect(constraint).toContain('youthful beautiful appearance');
        expect(constraint).toContain('heroic beauty');
        expect(constraint).toContain('女性主体');
        expect(constraint).toContain('日常默认不应主动露出');
    });
});

describe('npc image workflow young age prefix regression', () => {
    // 玩家反馈：18/20/32 岁年轻女性角色的提示词有时被加上 elderly appearance, aged face。
    // 根因：首次判定 young_adult 生成“不得仅因真实年龄称为老妇、老妪或老太婆”约束，
    // 二次判断把约束放回人物描述后，老态关键词匹配读到“老妇”却没识别“不得”，误入 elderly 分支。
    for (const 年龄 of [18, 20, 32]) {
        it(`keeps a ${年龄}-year-old female NPC young when the derived constraint is fed back`, () => {
            const baseData = {
                性别: '女',
                年龄,
                视觉年龄约束: '真实年龄只代表经历；外貌按青年成年人描写。；不得仅因真实年龄称为老妇、老妪或老太婆。',
                视觉年龄正向提示词: 'adult, young adult, youthful adult face'
            };
            const constraint = 构建词组转化性别硬约束('女', 年龄, baseData);

            // 正向区必须是青年/成熟成年，不能出现 elderly 分支的“elderly appearance, aged face”组合
            expect(constraint).toContain('开头必须包含：1woman, female, adult woman, feminine face, female body');
            expect(constraint).not.toContain('elderly appearance, aged face');
            expect(constraint).not.toContain('adult, elderly');
            // 约束原文仍会下发给词组转化器
            expect(constraint).toContain('不得仅因真实年龄称为老妇');
        });
    }

    it('uses the custom fixed gender prefix when configured', () => {
        const constraint = 构建词组转化性别硬约束('女', 20, { 性别: '女', 年龄: 20 }, '1woman, female, solo, woman');

        expect(constraint).toContain('1woman, female, solo, woman');
        expect(constraint).not.toContain('adult woman');
    });

    it('keeps built-in fixed gender prefix when no custom prefix is configured', () => {
        const constraint = 构建词组转化性别硬约束('女', 20, { 性别: '女', 年龄: 20 });

        expect(constraint).toContain('1woman, female, adult woman, feminine face, female body');
    });
});
