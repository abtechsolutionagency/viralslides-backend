export const IMAGE_SCENARIO_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused'
};

export const IMAGE_SCENARIO_STATUSES = Object.values(IMAGE_SCENARIO_STATUS);

export const IMAGE_SCENARIO_PRIVACY = {
  PUBLIC: 'public',
  FRIENDS: 'friends',
  PRIVATE: 'private'
};

export const IMAGE_SCENARIO_PRIVACY_OPTIONS = Object.values(IMAGE_SCENARIO_PRIVACY);

export const IMAGE_SCENARIO_ASPECT_RATIOS = ['16:9', '9:16', '1:1'];

export const IMAGE_SCENARIO_SCHEDULE_TYPES = {
  MANUAL: 'manual',
  DAILY: 'daily',
  WEEKLY: 'weekly'
};
export const IMAGE_SCENARIO_SCHEDULE_TYPE_VALUES = Object.values(IMAGE_SCENARIO_SCHEDULE_TYPES);

export const IMAGE_SCENARIO_RUN_STATUS = {
  PENDING: 'pending',
  GENERATING: 'generating',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

export const IMAGE_SCENARIO_RUN_STATUSES = Object.values(IMAGE_SCENARIO_RUN_STATUS);

export const IMAGE_SCENARIO_RUN_TRIGGER = {
  MANUAL: 'manual',
  SCHEDULE: 'schedule',
  RETRY: 'retry'
};
export const IMAGE_SCENARIO_RUN_TRIGGER_VALUES = Object.values(IMAGE_SCENARIO_RUN_TRIGGER);

export const IMAGE_AI_MODELS = [
  {
    id: 'gpt4o-image',
    name: 'GPT-4o Image',
    creditCostPerImage: 1,
    tags: ['gpt4o', 'default']
  },
  {
    id: 'flux-1-kontext-pro',
    name: 'Flux.1 Kontext Pro',
    creditCostPerImage: 1,
    tags: ['default', 'hot']
  },
  {
    id: 'midjourney-v7',
    name: 'MidJourney v7',
    creditCostPerImage: 1,
    tags: ['fallback']
  },
  {
    id: 'midjourney-niji-6',
    name: 'MidJourney Niji 6',
    creditCostPerImage: 1,
    tags: ['anime']
  }
];

export const MAX_IMAGES_PER_SCENARIO = 20;

export function resolveModelById (modelId) {
  return IMAGE_AI_MODELS.find((model) => model.id === modelId) ?? IMAGE_AI_MODELS[0];
}
