import rateLimit from 'express-rate-limit';

function buildRateLimiter ({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      req.log?.warn({ path: req.path, ip: req.ip }, 'Rate limit exceeded');
      res.status(429).json({
        success: false,
        message: message || 'Too many requests. Please slow down.'
      });
    }
  });
}

const scenarioWindowMs =
  Number(process.env.IMAGE_SCENARIO_RATE_WINDOW_MS) || 15 * 60 * 1000; // 15 minutes
const scenarioMaxRequests =
  Number(process.env.IMAGE_SCENARIO_RATE_MAX_REQUESTS) || 40;

const scenarioRunWindowMs =
  Number(process.env.IMAGE_SCENARIO_RUN_RATE_WINDOW_MS) || 5 * 60 * 1000; // 5 minutes
const scenarioRunMaxRequests =
  Number(process.env.IMAGE_SCENARIO_RUN_RATE_MAX_REQUESTS) || 12;

const videoScenarioWindowMs =
  Number(process.env.VIDEO_SCENARIO_RATE_WINDOW_MS) || 15 * 60 * 1000; // 15 minutes
const videoScenarioMaxRequests =
  Number(process.env.VIDEO_SCENARIO_RATE_MAX_REQUESTS) || 40;

const videoScenarioRunWindowMs =
  Number(process.env.VIDEO_SCENARIO_RUN_RATE_WINDOW_MS) || 5 * 60 * 1000; // 5 minutes
const videoScenarioRunMaxRequests =
  Number(process.env.VIDEO_SCENARIO_RUN_RATE_MAX_REQUESTS) || 12;

export const imageScenarioWriteLimiter = buildRateLimiter({
  windowMs: scenarioWindowMs,
  max: scenarioMaxRequests,
  message: 'You are creating or updating scenarios too quickly. Please try again shortly.'
});

export const imageScenarioRunLimiter = buildRateLimiter({
  windowMs: scenarioRunWindowMs,
  max: scenarioRunMaxRequests,
  message: 'Too many scenario runs triggered. Please slow down.'
});

export const videoScenarioWriteLimiter = buildRateLimiter({
  windowMs: videoScenarioWindowMs,
  max: videoScenarioMaxRequests,
  message: 'You are creating or updating scenarios too quickly. Please try again shortly.'
});

export const videoScenarioRunLimiter = buildRateLimiter({
  windowMs: videoScenarioRunWindowMs,
  max: videoScenarioRunMaxRequests,
  message: 'Too many scenario runs triggered. Please slow down.'
});

export default buildRateLimiter;
