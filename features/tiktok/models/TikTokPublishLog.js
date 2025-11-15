import mongoose from 'mongoose';

const { Schema } = mongoose;

const TikTokPublishLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    account: { type: Schema.Types.ObjectId, ref: 'TikTokAccount', required: true, index: true },
    idempotencyKey: { type: String, required: true },
    videoId: { type: String },
    postId: { type: String },
    status: { type: String, enum: ['created', 'published', 'failed'], default: 'created' },
    error: { type: String },
    request: {
      mediaUrl: String,
      caption: String,
      privacy: Schema.Types.Mixed
    },
    response: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

TikTokPublishLogSchema.index({ user: 1, account: 1, idempotencyKey: 1 }, { unique: true });

export default mongoose.model('TikTokPublishLog', TikTokPublishLogSchema);

