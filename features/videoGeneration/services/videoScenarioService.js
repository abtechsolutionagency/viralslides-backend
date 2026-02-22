import VideoScenario from '../models/VideoScenario.js';
import videoGenerationPipelineService from './videoGenerationPipelineService.js';
import tiktokAccountService from '../../tiktok/services/tiktokAccountService.js';
import {
  VIDEO_AI_MODELS,
  VIDEO_SCENARIO_ASPECT_RATIOS,
  VIDEO_SCENARIO_PRIVACY,
  VIDEO_SCENARIO_PRIVACY_OPTIONS,
  VIDEO_SCENARIO_SCHEDULE_TYPE_VALUES,
  VIDEO_SCENARIO_SCHEDULE_TYPES,
  VIDEO_SCENARIO_STATUS,
  VIDEO_SCENARIO_STATUSES,
  MAX_VIDEOS_PER_SCENARIO,
  resolveModelById
} from '../constants/videoGenerationConstants.js';
import { Types } from 'mongoose';

const { ObjectId } = Types;

function isValidObjectId (value) {
  return ObjectId.isValid(value);
}

class VideoScenarioService {
  calculateCreditCost ({ videoCount, aiModelId, aiModel }) {
    const count = Number.isFinite(videoCount) ? videoCount : 1;
    const modelConfig = this.normalizeAiModel(aiModel || aiModelId);
    return count * (modelConfig.creditCostPerVideo ?? 1);
  }

  normalizeAiModel (input) {
    if (!input) {
      return resolveModelById();
    }

    if (typeof input === 'string') {
      return resolveModelById(input);
    }

    const base = resolveModelById(input.id);
    return {
      id: input.id || base.id,
      name: input.name || base.name,
      creditCostPerVideo:
        typeof input.creditCostPerVideo === 'number'
          ? input.creditCostPerVideo
          : base.creditCostPerVideo,
      tags: Array.isArray(input.tags) && input.tags.length > 0 ? input.tags : base.tags,
      metadata: input.metadata || base.metadata || {}
    };
  }

  normalizeTargets (targets) {
    if (!Array.isArray(targets)) return [];

    const dedupedTargets = new Map();
    targets
      .map((target) => {
        const accountId = target.account || target.accountId || target.tiktokAccountId;
        if (!accountId || !isValidObjectId(accountId)) {
          return null;
        }

        return {
          account: new ObjectId(accountId),
          privacy: VIDEO_SCENARIO_PRIVACY_OPTIONS.includes(target.privacy)
            ? target.privacy
            : VIDEO_SCENARIO_PRIVACY.PUBLIC,
          autoPost: target.autoPost !== false
        };
      })
      .filter(Boolean)
      .forEach((target) => {
        dedupedTargets.set(target.account.toString(), target);
      });

    return Array.from(dedupedTargets.values());
  }

  normalizeSchedule (schedule) {
    const safeType = schedule?.type && VIDEO_SCENARIO_SCHEDULE_TYPE_VALUES.includes(schedule.type)
      ? schedule.type
      : VIDEO_SCENARIO_SCHEDULE_TYPES.MANUAL;

    const timezone = schedule?.timezone || 'UTC';

    const normalizeWindow = (window) => {
      const hasValidDay =
        typeof window?.dayOfWeek === 'number' && window.dayOfWeek >= 0 && window.dayOfWeek <= 6;
      const hasTime = typeof window?.time === 'string' && window.time.trim().length > 0;
      if (!hasValidDay || !hasTime) return null;
      return { dayOfWeek: window.dayOfWeek, time: window.time.trim() };
    };

    const windows = Array.isArray(schedule?.windows)
      ? schedule.windows.map(normalizeWindow).filter(Boolean)
      : [];

    return {
      type: safeType,
      timezone,
      dailyAt:
        safeType === VIDEO_SCENARIO_SCHEDULE_TYPES.DAILY && typeof schedule?.dailyAt === 'string'
          ? schedule.dailyAt
          : undefined,
      windows
    };
  }

  sanitizeVideoCount (value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(parsed, MAX_VIDEOS_PER_SCENARIO);
  }

  async listScenarios ({ userId, status }) {
    const query = { user: userId };
    if (status && VIDEO_SCENARIO_STATUSES.includes(status)) {
      query.status = status;
    }

    const scenarios = await VideoScenario.find(query).sort({ createdAt: -1 });
    return scenarios.map((scenario) => this.serializeScenario(scenario));
  }

  async getScenario ({ userId, scenarioId }) {
    if (!isValidObjectId(scenarioId)) {
      return null;
    }

    const scenario = await VideoScenario.findOne({ _id: scenarioId, user: userId });
    return this.serializeScenario(scenario);
  }

  async getScenarioDocument ({ userId, scenarioId }) {
    if (!isValidObjectId(scenarioId)) {
      return null;
    }
    return VideoScenario.findOne({ _id: scenarioId, user: userId });
  }

  async createScenario ({ userId, payload }) {
    const aiModel = this.normalizeAiModel(payload?.aiModel || payload?.aiModelId || payload?.modelId);
    const videoCount = this.sanitizeVideoCount(payload.videoCount);
    const normalizedTargets = this.normalizeTargets(payload.targets);
    const isAutoPostEnabled = payload.isAutoPostEnabled !== false;

    await tiktokAccountService.validateScenarioTargets({
      userId,
      targets: normalizedTargets,
      postsPerRun: videoCount,
      isAutoPostEnabled
    });

    const scenario = await VideoScenario.create({
      user: userId,
      title: payload.title,
      prompt: payload.prompt,
      status: payload.status && VIDEO_SCENARIO_STATUSES.includes(payload.status)
        ? payload.status
        : VIDEO_SCENARIO_STATUS.DRAFT,
      videoCount,
      aspectRatio: VIDEO_SCENARIO_ASPECT_RATIOS.includes(payload.aspectRatio)
        ? payload.aspectRatio
        : '9:16',
      aiModel,
      thumbnailUrl: payload.thumbnailUrl || null,
      targets: normalizedTargets,
      schedule: this.normalizeSchedule(payload.schedule),
      isAutoPostEnabled,
      metadata: payload.metadata || {}
    });

    return this.serializeScenario(scenario);
  }

  async updateScenario ({ userId, scenarioId, payload }) {
    const scenario = await this.getScenarioDocument({ userId, scenarioId });
    if (!scenario) {
      return null;
    }

    const nextVideoCount = payload.videoCount !== undefined
      ? this.sanitizeVideoCount(payload.videoCount)
      : scenario.videoCount;
    const nextTargets = payload.targets
      ? this.normalizeTargets(payload.targets)
      : scenario.targets;
    const nextIsAutoPostEnabled = payload.isAutoPostEnabled !== undefined
      ? Boolean(payload.isAutoPostEnabled)
      : scenario.isAutoPostEnabled;

    await tiktokAccountService.validateScenarioTargets({
      userId,
      targets: nextTargets,
      postsPerRun: nextVideoCount,
      isAutoPostEnabled: nextIsAutoPostEnabled
    });

    if (payload.title) scenario.title = payload.title;
    if (payload.prompt) scenario.prompt = payload.prompt;

    if (payload.status && VIDEO_SCENARIO_STATUSES.includes(payload.status)) {
      scenario.status = payload.status;
    }

    if (payload.videoCount !== undefined) {
      scenario.videoCount = nextVideoCount;
    }

    if (payload.aspectRatio && VIDEO_SCENARIO_ASPECT_RATIOS.includes(payload.aspectRatio)) {
      scenario.aspectRatio = payload.aspectRatio;
    }

    if (payload.thumbnailUrl !== undefined) {
      scenario.thumbnailUrl = payload.thumbnailUrl || null;
    }

    if (payload.aiModel || payload.aiModelId || payload.modelId) {
      scenario.aiModel = this.normalizeAiModel(
        payload.aiModel || payload.aiModelId || payload.modelId
      );
    }

    if (payload.targets) {
      scenario.targets = nextTargets;
    }

    if (payload.schedule) {
      scenario.schedule = this.normalizeSchedule(payload.schedule);
    }

    if (payload.isAutoPostEnabled !== undefined) {
      scenario.isAutoPostEnabled = nextIsAutoPostEnabled;
    }

    if (payload.metadata) {
      scenario.metadata = { ...(scenario.metadata || {}), ...payload.metadata };
    }

    await scenario.save();
    return this.serializeScenario(scenario);
  }

  async deleteScenario ({ userId, scenarioId }) {
    if (!isValidObjectId(scenarioId)) {
      return false;
    }

    const result = await VideoScenario.findOneAndDelete({ _id: scenarioId, user: userId });
    return Boolean(result);
  }

  async triggerRun ({ userId, scenarioId, trigger }) {
    const scenario = await this.getScenarioDocument({ userId, scenarioId });
    if (!scenario) {
      return null;
    }

    const run = await videoGenerationPipelineService.enqueueRun({
      scenario,
      userId,
      trigger
    });

    return run;
  }

  serializeScenario (scenarioDoc) {
    if (!scenarioDoc) return null;
    const doc = scenarioDoc.toObject
      ? scenarioDoc.toObject({ versionKey: false })
      : scenarioDoc;

    return {
      ...doc,
      creditCostPerRun: this.calculateCreditCost({
        videoCount: doc.videoCount,
        aiModel: doc.aiModel
      }),
      availableModels: VIDEO_AI_MODELS
    };
  }
}

export default new VideoScenarioService();
