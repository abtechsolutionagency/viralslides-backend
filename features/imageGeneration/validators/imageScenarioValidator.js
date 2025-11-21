import Joi from 'joi';
import {
  IMAGE_AI_MODELS,
  IMAGE_SCENARIO_ASPECT_RATIOS,
  IMAGE_SCENARIO_PRIVACY_OPTIONS,
  IMAGE_SCENARIO_RUN_TRIGGER_VALUES,
  IMAGE_SCENARIO_SCHEDULE_TYPE_VALUES,
  IMAGE_SCENARIO_STATUSES,
  MAX_IMAGES_PER_SCENARIO
} from '../constants/imageGenerationConstants.js';

const objectIdSchema = Joi.string().hex().length(24);
const modelIds = IMAGE_AI_MODELS.map((model) => model.id);
const timeStringSchema = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/);

const aiModelSchema = Joi.object({
  id: Joi.string().valid(...modelIds).required(),
  name: Joi.string().optional(),
  creditCostPerImage: Joi.number().min(0).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  metadata: Joi.object().unknown(true).optional()
});

const targetSchema = Joi.object({
  account: objectIdSchema.required(),
  privacy: Joi.string().valid(...IMAGE_SCENARIO_PRIVACY_OPTIONS).default('public'),
  autoPost: Joi.boolean().default(true)
});

const scheduleWindowSchema = Joi.object({
  dayOfWeek: Joi.number().integer().min(0).max(6).required(),
  time: timeStringSchema.required()
});

const scheduleSchema = Joi.object({
  type: Joi.string().valid(...IMAGE_SCENARIO_SCHEDULE_TYPE_VALUES).default('manual'),
  timezone: Joi.string().trim().default('UTC'),
  dailyAt: timeStringSchema.optional(),
  windows: Joi.array().items(scheduleWindowSchema).default([])
});

const baseFields = {
  title: Joi.string().trim().min(3).max(120),
  prompt: Joi.string().trim().min(3),
  aspectRatio: Joi.string().valid(...IMAGE_SCENARIO_ASPECT_RATIOS),
  imageCount: Joi.number().integer().min(1).max(MAX_IMAGES_PER_SCENARIO),
  aiModelId: Joi.string().valid(...modelIds),
  modelId: Joi.string().valid(...modelIds),
  aiModel: aiModelSchema,
  thumbnailUrl: Joi.string().uri(),
  schedule: scheduleSchema,
  targets: Joi.array().items(targetSchema),
  isAutoPostEnabled: Joi.boolean(),
  status: Joi.string().valid(...IMAGE_SCENARIO_STATUSES),
  metadata: Joi.object().unknown(true)
};

export const createImageScenarioValidator = Joi.object({
  ...baseFields,
  title: baseFields.title.required(),
  prompt: baseFields.prompt.required(),
  aspectRatio: baseFields.aspectRatio.default('9:16'),
  imageCount: baseFields.imageCount.default(4),
  targets: baseFields.targets.default([]),
  schedule: scheduleSchema.default({}),
  isAutoPostEnabled: baseFields.isAutoPostEnabled.default(true)
});

export const updateImageScenarioValidator = Joi.object({
  ...baseFields
}).min(1);

export const runImageScenarioValidator = Joi.object({
  trigger: Joi.string().valid(...IMAGE_SCENARIO_RUN_TRIGGER_VALUES).optional()
}).default({});
