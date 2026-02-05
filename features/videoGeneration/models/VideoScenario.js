import mongoose from 'mongoose';
import {
  VIDEO_SCENARIO_ASPECT_RATIOS,
  VIDEO_SCENARIO_PRIVACY,
  VIDEO_SCENARIO_PRIVACY_OPTIONS,
  VIDEO_SCENARIO_SCHEDULE_TYPE_VALUES,
  VIDEO_SCENARIO_SCHEDULE_TYPES,
  VIDEO_SCENARIO_STATUS,
  VIDEO_SCENARIO_STATUSES,
  MAX_VIDEOS_PER_SCENARIO
} from '../constants/videoGenerationConstants.js';

const { Schema } = mongoose;

const ScheduleWindowSchema = new Schema(
  {
    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    time: { type: String, required: true } // HH:mm in 24h format
  },
  { _id: false }
);

const ScheduleSchema = new Schema(
  {
    type: {
      type: String,
      enum: VIDEO_SCENARIO_SCHEDULE_TYPE_VALUES,
      default: VIDEO_SCENARIO_SCHEDULE_TYPES.MANUAL
    },
    timezone: { type: String, default: 'UTC' },
    dailyAt: { type: String }, // HH:mm
    windows: { type: [ScheduleWindowSchema], default: [] }
  },
  { _id: false }
);

const AiModelSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String },
    creditCostPerVideo: { type: Number, min: 0, default: 1 },
    tags: { type: [String], default: [] },
    metadata: { type: Schema.Types.Mixed }
  },
  { _id: false }
);

const TargetSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: 'TikTokAccount', required: true },
    privacy: {
      type: String,
      enum: VIDEO_SCENARIO_PRIVACY_OPTIONS,
      default: VIDEO_SCENARIO_PRIVACY.PUBLIC
    },
    autoPost: { type: Boolean, default: true }
  },
  { _id: false }
);

const VideoScenarioSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    prompt: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: VIDEO_SCENARIO_STATUSES,
      default: VIDEO_SCENARIO_STATUS.DRAFT
    },
    videoCount: {
      type: Number,
      min: 1,
      max: MAX_VIDEOS_PER_SCENARIO,
      default: 4
    },
    aspectRatio: {
      type: String,
      enum: VIDEO_SCENARIO_ASPECT_RATIOS,
      default: '9:16'
    },
    aiModel: { type: AiModelSchema, required: true },
    thumbnailUrl: { type: String },
    targets: { type: [TargetSchema], default: [] },
    schedule: {
      type: ScheduleSchema,
      default: () => ({ type: VIDEO_SCENARIO_SCHEDULE_TYPES.MANUAL, timezone: 'UTC', windows: [] })
    },
    isAutoPostEnabled: { type: Boolean, default: true },
    nextRunAt: { type: Date },
    lastRunAt: { type: Date },
    lastRunSummary: { type: Schema.Types.Mixed },
    metadata: { type: Schema.Types.Mixed, default: {} },
    lastError: { type: String }
  },
  { timestamps: true }
);

VideoScenarioSchema.index({ user: 1, status: 1 });
VideoScenarioSchema.index({ user: 1, 'schedule.type': 1 });

export default mongoose.model('VideoScenario', VideoScenarioSchema);
