import ImageScenario from '../models/ImageScenario.js';
import ImageScenarioRun from '../models/ImageScenarioRun.js';
import {
  IMAGE_SCENARIO_RUN_STATUS,
  IMAGE_SCENARIO_RUN_STATUSES,
  IMAGE_SCENARIO_RUN_TRIGGER,
  IMAGE_SCENARIO_RUN_TRIGGER_VALUES
} from '../constants/imageGenerationConstants.js';

const DEFAULT_MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/wihjtcouqksbfugqar6r7cjc1mh704la';
const MAKE_WEBHOOK_URL =
  process.env.MAKE_IMAGE_GENERATION_WEBHOOK_URL || DEFAULT_MAKE_WEBHOOK_URL;
const ASSET_HOST = process.env.IMAGE_ASSET_HOST || process.env.ASSET_HOST || '';
const CALLBACK_URL = process.env.MAKE_IMAGE_CALLBACK_URL || '';
const RESOLUTION_MAP = {
  '9:16': process.env.IMAGE_RESOLUTION_9_16 || '1080x1920',
  '16:9': process.env.IMAGE_RESOLUTION_16_9 || '1920x1080',
  '1:1': process.env.IMAGE_RESOLUTION_1_1 || '1024x1024'
};
const DEFAULT_RESOLUTION =
  process.env.IMAGE_DEFAULT_RESOLUTION || RESOLUTION_MAP['9:16'] || '1080x1920';

function toPlain (doc) {
  return doc?.toObject ? doc.toObject({ versionKey: false }) : doc;
}

class ImageGenerationPipelineService {
  constructor () {
    if (!MAKE_WEBHOOK_URL) {
      throw new Error('Missing Make.com webhook URL for image generation');
    }
    if (!ASSET_HOST) {
      console.warn('[ImageGenerationPipelineService] IMAGE_ASSET_HOST is not configured');
    }
    if (!CALLBACK_URL) {
      console.warn('[ImageGenerationPipelineService] MAKE_IMAGE_CALLBACK_URL is not configured');
    }
  }

  buildTargetsPayload (scenario) {
    if (!Array.isArray(scenario.targets)) return [];
    return scenario.targets.map((target) => ({
      accountId:
        typeof target.account === 'object' && target.account !== null
          ? target.account.toString()
          : target.account?.toString?.() || target.account,
      privacy: target.privacy,
      autoPost: target.autoPost
    }));
  }

  buildWebhookPayload ({ scenario, run }) {
    return {
      user_id: scenario.user.toString(),
      content_id: scenario._id.toString(),
      prompt: scenario.prompt,
      image_count: scenario.imageCount,
      model: scenario.aiModel?.id,
      publish_option: scenario.isAutoPostEnabled ? 'auto' : 'draft',
      thumbnail_url: scenario.thumbnailUrl || null,
      targets_json: JSON.stringify(this.buildTargetsPayload(scenario)),
      metadata: {
        scenario_id: scenario._id.toString(),
        run_id: run._id.toString(),
        aspect_ratio: scenario.aspectRatio
      },
      asset_host: ASSET_HOST || undefined,
      callback_url: CALLBACK_URL || undefined,
      resolution: this.resolveResolution(scenario.aspectRatio)
    };
  }

  resolveResolution (aspectRatio) {
    return RESOLUTION_MAP[aspectRatio] || DEFAULT_RESOLUTION;
  }

  async enqueueRun ({ scenario, userId, trigger = IMAGE_SCENARIO_RUN_TRIGGER.MANUAL }) {
    if (!IMAGE_SCENARIO_RUN_TRIGGER_VALUES.includes(trigger)) {
      trigger = IMAGE_SCENARIO_RUN_TRIGGER.MANUAL;
    }

    const run = await ImageScenarioRun.create({
      scenario: scenario._id,
      user: userId,
      trigger,
      status: IMAGE_SCENARIO_RUN_STATUS.PENDING,
      imageCountRequested: scenario.imageCount,
      aiModelId: scenario.aiModel?.id,
      prompt: scenario.prompt,
      startedAt: new Date()
    });

    try {
      const payload = this.buildWebhookPayload({ scenario: toPlain(scenario), run: toPlain(run) });
      const response = await fetch(MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(`Make.com webhook failed (${response.status}): ${bodyText}`);
      }

      let body = {};
      try {
        body = await response.json();
      } catch (_) {
        body = {};
      }

      run.status = IMAGE_SCENARIO_RUN_STATUS.GENERATING;
      run.makeExecutionId = body?.execution_id || body?.id || null;
      run.makeWebhookPayload = payload;
      await run.save();

      await ImageScenario.updateOne(
        { _id: scenario._id },
        { $set: { lastRunAt: new Date(), lastError: null } }
      );

      return run;
    } catch (error) {
      run.status = IMAGE_SCENARIO_RUN_STATUS.FAILED;
      run.error = { message: error.message };
      run.completedAt = new Date();
      await run.save();

      await ImageScenario.updateOne(
        { _id: scenario._id },
        { $set: { lastError: error.message } }
      );

      throw error;
    }
  }

  selectFirstAssetPerPrompt (assets) {
    if (!Array.isArray(assets)) return [];

    const grouped = new Map();
    const normalized = assets.map((asset) => {
      const promptIndex =
        typeof asset?.promptIndex === 'number'
          ? asset.promptIndex
          : typeof asset?.batch === 'number'
            ? asset.batch
            : undefined;

      return {
        ...asset,
        promptIndex,
        promptLabel: asset?.promptLabel
      };
    });

    for (const asset of normalized) {
      const key = asset.promptIndex ?? asset.promptLabel ?? 0;
      if (!grouped.has(key)) {
        grouped.set(key, asset);
      }
    }

    const deduped = Array.from(grouped.keys())
      .sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a).localeCompare(String(b));
      })
      .map((key) => grouped.get(key));

    return deduped;
  }

  async handleMakeCallback ({
    runId,
    assets = [],
    expandedPrompt,
    status,
    error,
    creditsCharged,
    creditsRefunded,
    preFiltered = false
  }) {
    const run = await ImageScenarioRun.findById(runId);
    if (!run) {
      return null;
    }

    const assetPayload = preFiltered ? assets : this.selectFirstAssetPerPrompt(assets);

    if (status === IMAGE_SCENARIO_RUN_STATUS.FAILED) {
      run.status = IMAGE_SCENARIO_RUN_STATUS.FAILED;
      run.error = error || { message: 'Generation failed' };
      run.completedAt = new Date();
    } else {
      run.status = IMAGE_SCENARIO_RUN_STATUS.COMPLETED;
      run.assets = assetPayload;
      run.imageCountGenerated = assetPayload.length;
      run.expandedPrompt = expandedPrompt || run.expandedPrompt;
      run.creditsCharged = creditsCharged ?? run.creditsCharged;
      run.creditsRefunded = creditsRefunded ?? run.creditsRefunded;
      run.completedAt = new Date();
    }

    await run.save();
    return run;
  }

  async listRuns ({ userId, scenarioId, limit = 50 }) {
    const query = { user: userId };
    if (scenarioId) {
      query.scenario = scenarioId;
    }
    const runs = await ImageScenarioRun.find(query)
      .sort({ createdAt: -1 })
      .limit(limit);
    return runs;
  }
}

export default new ImageGenerationPipelineService();
