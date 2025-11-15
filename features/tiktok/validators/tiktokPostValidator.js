import Joi from 'joi';

export const createPostValidator = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'TikTok account ID is required' }),
  mediaType: Joi.string().valid('video').default('video'),
  mediaUrl: Joi.string().uri().optional().messages({ 'string.uri': 'mediaUrl must be a valid URL' }),
  caption: Joi.string().allow('').max(2200).default(''),
  privacy: Joi.alternatives().try(
    Joi.string().valid('public', 'friends', 'private'),
    Joi.number().valid(0, 1, 2)
  ).default('public')
});
