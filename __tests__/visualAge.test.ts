import { describe, expect, it } from 'vitest';
import { 自动角色锚点视觉年龄是否过期, 构建视觉年龄签名, 解析视觉年龄 } from '../utils/visualAge';

describe('visualAge', () => {
    it('keeps a high-realm xianxia elder visually mature instead of elderly', () => {
        const result = 解析视觉年龄({
            actualAge: 85,
            topicMode: '仙侠',
            realmLevel: 17,
            realmText: '金丹四层',
            identity: '玉仙宗巡查使',
            appearance: '容貌清寒，体态挺拔。',
            bio: '修行多年，无明显老态。'
        });

        expect(result.visualAgeBand).toBe('mature_adult');
        expect(result.isAdultSafetyApproved).toBe(true);
        expect(result.positiveTags).not.toContain('85 years old');
        expect(result.negativeTags).toContain('elderly appearance');
    });

    it('keeps realistic elders in the elderly band', () => {
        const result = 解析视觉年龄({
            actualAge: 85,
            topicMode: '现代都市',
            identity: '退休老人'
        });

        expect(result.visualAgeBand).toBe('elderly');
        expect(result.positiveTags).toContain('85 years old');
        expect(result.positiveTags).toContain('elderly appearance');
    });

    it('does not treat negated old-age mentions as elderly evidence', () => {
        // 典型场景：程序生成的约束“不得仅因真实年龄称为老妇、老妪或老太婆”被回灌进人物描述，
        // 字面匹配不能把被否认的老态词当证据。
        const result = 解析视觉年龄({
            actualAge: 20,
            appearance: '年方二十，不得仅因真实年龄称为老妇、老妪或老太婆，容貌清秀。'
        });

        expect(result.visualAgeBand).toBe('young_adult');
        expect(result.positiveTags).not.toContain('elderly appearance');
        expect(result.positiveTags).not.toContain('aged face');
    });

    it('does not treat common no-wrinkle wording as elderly evidence', () => {
        const result = 解析视觉年龄({
            actualAge: 20,
            appearance: '没有皱纹，容貌清秀，肌肤饱满。'
        });

        expect(result.visualAgeBand).toBe('young_adult');
        expect(result.positiveTags).not.toContain('elderly appearance');
    });

    it('keeps affirmative old-age descriptions after a contrast', () => {
        // “不是少女，而是老妇”：否定词后出现转折，老妇是肯定描述。
        const result = 解析视觉年龄({
            actualAge: 70,
            appearance: '她不是少女，而是老妇。'
        });

        expect(result.visualAgeBand).toBe('elderly');
        expect(result.positiveTags).toContain('elderly appearance');
    });

    it('keeps real elderly evidence introduced by 不得不', () => {
        // “不得不”是“只能”之意，后面的老态是肯定描述。
        const result = 解析视觉年龄({
            actualAge: 80,
            appearance: '众人不得不承认自己已白发苍苍。'
        });

        expect(result.visualAgeBand).toBe('elderly');
        expect(result.positiveTags).toContain('elderly appearance');
    });

    it('does not upgrade young characters when the derived age constraint is fed back', () => {
        const result = 解析视觉年龄({
            actualAge: 32,
            bio: '真实年龄只代表经历；外貌按青年成年人描写。；不得仅因真实年龄称为老妇、老妪或老太婆。'
        });

        expect(result.visualAgeBand).toBe('mature_adult');
        expect(result.positiveTags).not.toContain('elderly appearance');
        expect(result.positiveTags).not.toContain('aged face');
    });

    it('keeps real elderly evidence in the elderly band', () => {
        const result = 解析视觉年龄({
            actualAge: 72,
            appearance: '白发苍苍，皱纹深重，俨然一个老妇。'
        });

        expect(result.visualAgeBand).toBe('elderly');
        expect(result.positiveTags).toContain('elderly appearance');
        expect(result.positiveTags).toContain('aged face');
    });

    it('does not treat negated decline wording as elderly evidence', () => {
        const result = 解析视觉年龄({
            actualAge: 45,
            appearance: '虽修道多年，并未寿元枯竭，气血依旧充沛。'
        });

        expect(result.visualAgeBand).not.toBe('elderly');
    });

    it('never upgrades a real minor into an adult visual age', () => {
        const result = 解析视觉年龄({
            actualAge: 16,
            topicMode: '仙侠',
            realmLevel: 30,
            realmText: '元婴境',
            identity: '天才弟子'
        });

        expect(result.visualAgeBand).toBe('late_teen');
        expect(result.isAdultSafetyApproved).toBe(false);
    });

    it('treats explicit childlike appearance as unsafe for adult nsfw', () => {
        const result = 解析视觉年龄({
            actualAge: 200,
            topicMode: '仙侠',
            realmLevel: 24,
            explicitVisualAge: '幼童外貌'
        });

        expect(result.visualAgeBand).toBe('child');
        expect(result.isAdultSafetyApproved).toBe(false);
    });

    it('invalidates stale automatic anchors when visual age changed bands', () => {
        const current = 解析视觉年龄({
            actualAge: 85,
            topicMode: '仙侠',
            realmLevel: 17,
            realmText: '金丹四层'
        });

        expect(自动角色锚点视觉年龄是否过期({
            来源: 'ai_extract',
            视觉年龄签名: 'v2:elderly:85:actual:adult',
            正面提示词: 'elderly woman, wrinkles',
            负面提示词: ''
        }, current)).toBe(true);

        expect(自动角色锚点视觉年龄是否过期({
            来源: 'ai_extract',
            视觉年龄签名: 构建视觉年龄签名(current),
            正面提示词: 'adult woman, mature youthful face',
            负面提示词: 'elderly appearance'
        }, current)).toBe(false);
    });
});
