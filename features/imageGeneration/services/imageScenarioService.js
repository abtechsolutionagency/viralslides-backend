import ImageScenario from '../models/ImageScenario.js';
import imageGenerationPipelineService from './imageGenerationPipelineService.js';
import {
  IMAGE_AI_MODELS,
  IMAGE_SCENARIO_ASPECT_RATIOS,
  IMAGE_SCENARIO_PRIVACY,
  IMAGE_SCENARIO_PRIVACY_OPTIONS,
  IMAGE_SCENARIO_SCHEDULE_TYPE_VALUES,
  IMAGE_SCENARIO_SCHEDULE_TYPES,
  IMAGE_SCENARIO_STATUS,
  IMAGE_SCENARIO_STATUSES,
  MAX_IMAGES_PER_SCENARIO,
  resolveModelById
} from '../constants/imageGenerationConstants.js';
import { Types } from 'mongoose';

const { ObjectId } = Types;

function isValidObjectId (value) {
  return ObjectId.isValid(value);
}

class ImageScenarioService {
  calculateCreditCost ({ imageCount, aiModelId, aiModel }) {
    const count = Number.isFinite(imageCount) ? imageCount : 1;
    const modelConfig = this.normalizeAiModel(aiModel || aiModelId);
    return count * (modelConfig.creditCostPerImage ?? 1);
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
      creditCostPerImage:
        typeof input.creditCostPerImage === 'number'
          ? input.creditCostPerImage
          : base.creditCostPerImage,
      tags: Array.isArray(input.tags) && input.tags.length > 0 ? input.tags : base.tags,
      metadata: input.metadata || base.metadata || {}
    };
  }

  normalizeTargets (targets) {
    if (!Array.isArray(targets)) return [];

    return targets
      .map((target) => {
        const accountId = target.account || target.accountId || target.tiktokAccountId;
        if (!accountId || !isValidObjectId(accountId)) {
          return null;
        }

        return {
          account: new ObjectId(accountId),
          privacy: IMAGE_SCENARIO_PRIVACY_OPTIONS.includes(target.privacy)
            ? target.privacy
            : IMAGE_SCENARIO_PRIVACY.PUBLIC,
          autoPost: target.autoPost !== false
        };
      })
      .filter(Boolean);
  }

  normalizeSchedule (schedule) {
    const safeType = schedule?.type && IMAGE_SCENARIO_SCHEDULE_TYPE_VALUES.includes(schedule.type)
      ? schedule.type
      : IMAGE_SCENARIO_SCHEDULE_TYPES.MANUAL;

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
        safeType === IMAGE_SCENARIO_SCHEDULE_TYPES.DAILY && typeof schedule?.dailyAt === 'string'
          ? schedule.dailyAt
          : undefined,
      windows
    };
  }

  sanitizeImageCount (value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(parsed, MAX_IMAGES_PER_SCENARIO);
  }

  async listScenarios ({ userId, status }) {
    const query = { user: userId };
    if (status && IMAGE_SCENARIO_STATUSES.includes(status)) {
      query.status = status;
    }

    const scenarios = await ImageScenario.find(query).sort({ createdAt: -1 });
    return scenarios.map((scenario) => this.serializeScenario(scenario));
  }

  async getScenario ({ userId, scenarioId }) {
    if (!isValidObjectId(scenarioId)) {
      return null;
    }

    const scenario = await ImageScenario.findOne({ _id: scenarioId, user: userId });
    return this.serializeScenario(scenario);
  }

  async getScenarioDocument ({ userId, scenarioId }) {
    if (!isValidObjectId(scenarioId)) {
      return null;
    }
    return ImageScenario.findOne({ _id: scenarioId, user: userId });
  }

  async createScenario ({ userId, payload }) {
    const aiModel = this.normalizeAiModel(payload?.aiModel || payload?.aiModelId || payload?.modelId);

    const scenario = await ImageScenario.create({
      user: userId,
      title: payload.title,
      prompt: payload.prompt,
      status: payload.status && IMAGE_SCENARIO_STATUSES.includes(payload.status)
        ? payload.status
        : IMAGE_SCENARIO_STATUS.DRAFT,
      imageCount: this.sanitizeImageCount(payload.imageCount),
      aspectRatio: IMAGE_SCENARIO_ASPECT_RATIOS.includes(payload.aspectRatio)
        ? payload.aspectRatio
        : '9:16',
      aiModel,
      thumbnailUrl: payload.thumbnailUrl || null,
      targets: this.normalizeTargets(payload.targets),
      schedule: this.normalizeSchedule(payload.schedule),
      isAutoPostEnabled: payload.isAutoPostEnabled !== false,
      metadata: payload.metadata || {}
    });

    return this.serializeScenario(scenario);
  }

  async updateScenario ({ userId, scenarioId, payload }) {
    const scenario = await this.getScenarioDocument({ userId, scenarioId });
    if (!scenario) {
      return null;
    }

    if (payload.title) scenario.title = payload.title;
    if (payload.prompt) scenario.prompt = payload.prompt;

    if (payload.status && IMAGE_SCENARIO_STATUSES.includes(payload.status)) {
      scenario.status = payload.status;
    }

    if (payload.imageCount !== undefined) {
      scenario.imageCount = this.sanitizeImageCount(payload.imageCount);
    }

    if (payload.aspectRatio && IMAGE_SCENARIO_ASPECT_RATIOS.includes(payload.aspectRatio)) {
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
      scenario.targets = this.normalizeTargets(payload.targets);
    }

    if (payload.schedule) {
      scenario.schedule = this.normalizeSchedule(payload.schedule);
    }

    if (payload.isAutoPostEnabled !== undefined) {
      scenario.isAutoPostEnabled = Boolean(payload.isAutoPostEnabled);
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

    const result = await ImageScenario.findOneAndDelete({ _id: scenarioId, user: userId });
    return Boolean(result);
  }

  async triggerRun ({ userId, scenarioId, trigger }) {
    const scenario = await this.getScenarioDocument({ userId, scenarioId });
    if (!scenario) {
      return null;
    }

    const run = await imageGenerationPipelineService.enqueueRun({
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
        imageCount: doc.imageCount,
        aiModel: doc.aiModel
      }),
      availableModels: IMAGE_AI_MODELS
    };
  }
}

export default new ImageScenarioService();
