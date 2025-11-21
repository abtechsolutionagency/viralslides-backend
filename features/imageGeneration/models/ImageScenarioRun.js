import mongoose from 'mongoose';
import {
  IMAGE_SCENARIO_RUN_STATUSES,
  IMAGE_SCENARIO_RUN_TRIGGER,
  IMAGE_SCENARIO_RUN_TRIGGER_VALUES
} from '../constants/imageGenerationConstants.js';

const { Schema } = mongoose;

const AssetSchema = new Schema(
  {
    url: { type: String, required: true },
    thumbnailUrl: { type: String },
    width: { type: Number },
    height: { type: Number },
    prompt: { type: String },
    metadata: { type: Schema.Types.Mixed },
    localPath: { type: String }
  },
  { _id: false }
);

const ErrorSchema = new Schema(
  {
    code: { type: String },
    message: { type: String },
    details: { type: Schema.Types.Mixed }
  },
  { _id: false }
);

const ImageScenarioRunSchema = new Schema(
  {
    scenario: { type: Schema.Types.ObjectId, ref: 'ImageScenario', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    trigger: {
      type: String,
      enum: IMAGE_SCENARIO_RUN_TRIGGER_VALUES,
      default: IMAGE_SCENARIO_RUN_TRIGGER.SCHEDULE
    },
    status: {
      type: String,
      enum: IMAGE_SCENARIO_RUN_STATUSES,
      default: IMAGE_SCENARIO_RUN_STATUSES[0]
    },
    imageCountRequested: { type: Number },
    imageCountGenerated: { type: Number },
    aiModelId: { type: String },
    creditsCharged: { type: Number, min: 0, default: 0 },
    creditsRefunded: { type: Number, min: 0, default: 0 },
    prompt: { type: String },
    expandedPrompt: { type: String },
    makeExecutionId: { type: String },
    makeWebhookPayload: { type: Schema.Types.Mixed },
    assets: { type: [AssetSchema], default: [] },
    assetsDeletedAt: { type: Date },
    error: { type: ErrorSchema, default: null },
    startedAt: { type: Date },
    completedAt: { type: Date }
  },
  { timestamps: true }
);

ImageScenarioRunSchema.index({ user: 1, status: 1 });
ImageScenarioRunSchema.index({ scenario: 1, createdAt: -1 });
const DEFAULT_RETENTION_SECONDS = Number(process.env.IMAGE_RUN_RETENTION_SECONDS) || 7 * 24 * 60 * 60;
ImageScenarioRunSchema.index({ createdAt: 1 }, { expireAfterSeconds: DEFAULT_RETENTION_SECONDS });

export default mongoose.model('ImageScenarioRun', ImageScenarioRunSchema);
