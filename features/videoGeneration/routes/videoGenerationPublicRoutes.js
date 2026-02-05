import express from 'express';
import videoGenerationCallbackController from '../controllers/videoGenerationCallbackController.js';

const router = express.Router();

router.post(
  '/callback',
  express.json({ limit: '5mb' }),
  videoGenerationCallbackController.handle.bind(videoGenerationCallbackController)
);

export default router;
