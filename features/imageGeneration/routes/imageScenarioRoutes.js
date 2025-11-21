import express from 'express';
import imageScenarioController from '../controllers/imageScenarioController.js';
import {
  authenticate,
  requireActiveSubscription,
  requirePlan,
  requireVerifiedEmail
} from '../../auth/middleware/authMiddleware.js';
import { validate } from '../../../shared/middleware/validate.js';
import {
  createImageScenarioValidator,
  runImageScenarioValidator,
  updateImageScenarioValidator
} from '../validators/imageScenarioValidator.js';
import {
  imageScenarioRunLimiter,
  imageScenarioWriteLimiter
} from '../../../shared/middleware/rateLimit.js';

const router = express.Router();

router.use(
  authenticate,
  requireVerifiedEmail,
  requireActiveSubscription,
  requirePlan('creator', 'entrepreneur')
);

router.get('/', imageScenarioController.list.bind(imageScenarioController));
router.get('/:scenarioId', imageScenarioController.get.bind(imageScenarioController));

router.post(
  '/',
  imageScenarioWriteLimiter,
  validate(createImageScenarioValidator),
  imageScenarioController.create.bind(imageScenarioController)
);

router.put(
  '/:scenarioId',
  imageScenarioWriteLimiter,
  validate(updateImageScenarioValidator),
  imageScenarioController.update.bind(imageScenarioController)
);

router.delete(
  '/:scenarioId',
  imageScenarioWriteLimiter,
  imageScenarioController.remove.bind(imageScenarioController)
);

router.post(
  '/:scenarioId/run',
  imageScenarioRunLimiter,
  validate(runImageScenarioValidator),
  imageScenarioController.runOnce.bind(imageScenarioController)
);

export default router;
