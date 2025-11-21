import express from 'express';
import imageGenerationCallbackController from '../controllers/imageGenerationCallbackController.js';

const router = express.Router();

router.post(
  '/callback',
  express.json({ limit: '5mb' }),
  imageGenerationCallbackController.handle.bind(imageGenerationCallbackController)
);

export default router;
