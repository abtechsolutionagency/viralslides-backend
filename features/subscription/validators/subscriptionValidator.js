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
    })
});

export const cancelSubscriptionValidator = Joi.object({
  cancelAtPeriodEnd: Joi.boolean().default(true)
});

export const purchaseCreditsValidator = Joi.object({
  credits: Joi.number()
    .integer()
    .min(1)
    .max(10000)
    .required()
    .messages({
      'number.base': 'credits must be a number',
      'number.min': 'You must purchase at least 1 credit',
      'number.max': 'Credit purchase exceeds maximum allowed',
      'any.required': 'credits is required'
    })
});
