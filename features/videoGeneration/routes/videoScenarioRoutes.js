import express from 'express';
import videoScenarioController from '../controllers/videoScenarioController.js';
import {
  authenticate,
  requireActiveSubscription,
  requirePlan,
  requireVerifiedEmail
} from '../../auth/middleware/authMiddleware.js';
import { validate } from '../../../shared/middleware/validate.js';
import {
  createVideoScenarioValidator,
  runVideoScenarioValidator,
  updateVideoScenarioValidator
} from '../validators/videoScenarioValidator.js';
import {
  videoScenarioRunLimiter,
  videoScenarioWriteLimiter
} from '../../../shared/middleware/rateLimit.js';

const router = express.Router();

router.use(
  authenticate,
  requireVerifiedEmail,
  requireActiveSubscription,
  requirePlan('creator', 'entrepreneur')
);

router.get('/', videoScenarioController.list.bind(videoScenarioController));
router.get('/:scenarioId', videoScenarioController.get.bind(videoScenarioController));

router.post(
  '/',
  videoScenarioWriteLimiter,
  validate(createVideoScenarioValidator),
  videoScenarioController.create.bind(videoScenarioController)
);

router.put(
  '/:scenarioId',
  videoScenarioWriteLimiter,
  validate(updateVideoScenarioValidator),
  videoScenarioController.update.bind(videoScenarioController)
);

router.delete(
  '/:scenarioId',
  videoScenarioWriteLimiter,
  videoScenarioController.remove.bind(videoScenarioController)
);

router.post(
  '/:scenarioId/run',
  videoScenarioRunLimiter,
  validate(runVideoScenarioValidator),
  videoScenarioController.runOnce.bind(videoScenarioController)
);

export default router;
