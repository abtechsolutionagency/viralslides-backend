import tiktokPublishService from '../services/tiktokPublishService.js';

class TikTokPostController {
  async create (req, res) {
    try {
      const { accountId, mediaType, mediaUrl, caption, privacy } = req.body;
      const idempotencyKey = req.headers['x-idempotency-key'];

      if ((mediaType || 'video') !== 'video') {
        return res.status(400).json({ success: false, message: 'Only video posts are supported at this time' });
      }

      if (!req.file && !mediaUrl) {
        return res.status(400).json({ success: false, message: 'Provide mediaUrl or upload a video file' });
      }

      let result;
      if (req.file) {
        result = await tiktokPublishService.publishFromBuffer({
          userId: req.user._id,
          accountId,
          buffer: req.file.buffer,
          contentType: req.file.mimetype || 'video/mp4',
          caption,
          privacy,
          idempotencyKey
        });
      } else {
        result = await tiktokPublishService.publishFromUrl({
          userId: req.user._id,
          accountId,
          mediaUrl,
          caption,
          privacy,
          idempotencyKey
        });
      }

      return res.status(201).json({
        success: true,
        message: 'TikTok video published',
        data: result
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to publish TikTok video');
      const status = String(error.message || '').toLowerCase().includes('limit') ? 429 : 400;
      return res.status(status).json({ success: false, message: error.message || 'Publish failed' });
    }
  }
}

export default new TikTokPostController();
