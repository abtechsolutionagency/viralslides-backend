import Joi from 'joi';
import { TIKTOK_DAILY_POST_LIMIT } from '../constants/tiktokConstants.js';

export const startOAuthValidator = Joi.object({
  redirectUri: Joi.string()
    .uri()
    .optional()
    .messages({
      'string.uri': 'Redirect URI must be a valid URL'
    }),
  state: Joi.string().allow('').optional()
});

export const oauthCallbackValidator = Joi.object({
  code: Joi.string()
    .required()
    .messages({
      'any.required': 'Authorization code is required'
    }),
  codeVerifier: Joi.string()
    .required()
    .messages({
      'any.required': 'Code verifier is required'
    }),
  state: Joi.string().allow('').optional(),
  redirectUri: Joi.string()
    .uri()
    .required()
    .messages({
      'string.uri': 'Redirect URI must be a valid URL',
      'any.required': 'Redirect URI is required'
    })
});

export const tokenRefreshValidator = Joi.object({
  accountId: Joi.string()
    .required()
    .messages({
      'any.required': 'TikTok account ID is required'
    }),
  force: Joi.boolean().optional()
});

export const recordUsageValidator = Joi.object({
  posts: Joi.number()
    .integer()
    .min(1)
    .max(TIKTOK_DAILY_POST_LIMIT)
    .default(1)
    .messages({
      'number.base': 'Posts must be a number',
      'number.integer': 'Posts must be a whole number',
      'number.min': 'At least one post must be recorded',
      'number.max': `Posts cannot exceed the daily limit of ${TIKTOK_DAILY_POST_LIMIT}`
    })
});
