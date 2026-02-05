import mongoose from 'mongoose';
import {
  VIDEO_SCENARIO_RUN_STATUSES,
  VIDEO_SCENARIO_RUN_TRIGGER,
  VIDEO_SCENARIO_RUN_TRIGGER_VALUES
} from '../constants/videoGenerationConstants.js';

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

const VideoScenarioRunSchema = new Schema(
  {
    scenario: { type: Schema.Types.ObjectId, ref: 'VideoScenario', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    trigger: {
      type: String,
      enum: VIDEO_SCENARIO_RUN_TRIGGER_VALUES,
      default: VIDEO_SCENARIO_RUN_TRIGGER.SCHEDULE
    },
    status: {
      type: String,
      enum: VIDEO_SCENARIO_RUN_STATUSES,
      default: VIDEO_SCENARIO_RUN_STATUSES[0]
    },
    videoCountRequested: { type: Number },
    videoCountGenerated: { type: Number },
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

VideoScenarioRunSchema.index({ user: 1, status: 1 });
VideoScenarioRunSchema.index({ scenario: 1, createdAt: -1 });
const DEFAULT_RETENTION_SECONDS = Number(process.env.VIDEO_RUN_RETENTION_SECONDS) || 7 * 24 * 60 * 60;
VideoScenarioRunSchema.index({ createdAt: 1 }, { expireAfterSeconds: DEFAULT_RETENTION_SECONDS });

export default mongoose.model('VideoScenarioRun', VideoScenarioRunSchema);
