import Joi from 'joi';
import { SUBSCRIPTION_PLANS } from '../constants/plans.js';

const planIds = Object.keys(SUBSCRIPTION_PLANS);

export const activatePlanValidator = Joi.object({
  planId: Joi.string()
    .valid(...planIds)
    .required()
    .messages({
      'any.only': `Plan must be one of: ${planIds.join(', ')}`,
      'any.required': 'planId is required'
    }),
  successPath: Joi.string().optional(),
  cancelPath: Joi.string().optional()
});

export const cancelSubscriptionValidator = Joi.object({
  cancelAtPeriodEnd: Joi.boolean().default(true)
});

export const purchaseCreditsValidator = Joi.object({
  credits: Joi.number().integer().min(1).max(10000).messages({
    'number.base': 'credits must be a number',
    'number.min': 'You must purchase at least 1 credit',
    'number.max': 'Credit purchase exceeds maximum allowed'
  }),
  stripePriceId: Joi.string().optional(),
  successPath: Joi.string().optional(),
  cancelPath: Joi.string().optional()
}).or('credits', 'stripePriceId');
