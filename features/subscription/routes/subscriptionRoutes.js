import express from 'express';
import subscriptionController from '../controllers/subscriptionController.js';
import { authenticate, requireVerifiedEmail } from '../../auth/middleware/authMiddleware.js';
import { validate } from '../../../shared/middleware/validate.js';
import {
  activatePlanValidator,
  cancelSubscriptionValidator,
  purchaseCreditsValidator,
  updatePlanValidator
} from '../validators/subscriptionValidator.js';

const router = express.Router();

router.get('/plans', subscriptionController.listPlans.bind(subscriptionController));
router.get('/credit-packs', subscriptionController.listCreditPacks.bind(subscriptionController));

router.get(
  '/me',
  authenticate,
  requireVerifiedEmail,
  subscriptionController.getMySubscription.bind(subscriptionController)
);

router.post(
  '/activate',
  authenticate,
  requireVerifiedEmail,
  validate(activatePlanValidator),
  subscriptionController.activatePlan.bind(subscriptionController)
);

router.patch(
  '/update',
  authenticate,
  requireVerifiedEmail,
  validate(updatePlanValidator),
  subscriptionController.updateSubscription.bind(subscriptionController)
);

router.post(
  '/cancel',
  authenticate,
  requireVerifiedEmail,
  validate(cancelSubscriptionValidator),
  subscriptionController.cancelSubscription.bind(subscriptionController)
);

router.post(
  '/resume',
  authenticate,
  requireVerifiedEmail,
  subscriptionController.resumeSubscription.bind(subscriptionController)
);

router.post(
  '/credits/purchase',
  authenticate,
  requireVerifiedEmail,
  validate(purchaseCreditsValidator),
  subscriptionController.purchaseCredits.bind(subscriptionController)
);

router.get(
  '/credits/history',
  authenticate,
  requireVerifiedEmail,
  subscriptionController.getCreditHistory.bind(subscriptionController)
);

export default router;
