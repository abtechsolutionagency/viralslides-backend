import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import pinoHttp from 'pino-http';
import mongoose from 'mongoose';

// ---- env (no dotenv; using --env-file)
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT) || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/viralslides';
const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'info' : 'debug');
const COOKIE_SECRET = process.env.COOKIE_SECRET || undefined;

// comma-separated list: http://localhost:3000,https://app.example.com
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ---- logger (pretty in non-prod)
const logger = pino({
  level: LOG_LEVEL,
  transport:
    NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } }
});

// ---- app
const app = express();
app.set('trust proxy', 1);

// request logging
app.use(pinoHttp({ logger }));

// security + cors
app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || CORS_ORIGIN.length === 0 || CORS_ORIGIN.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  })
);

// Stripe webhook needs raw body for signature verification (must be before express.json)
import { handleStripeWebhook } from './features/subscription/controllers/stripeWebhookController.js';
app.post(
  '/api/subscriptions/webhook',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
);

// parsers
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(COOKIE_SECRET));

// ---- mount feature routers here (keep server.js slim)
import authRoutes from './features/auth/routes/authRoutes.js';
import subscriptionRoutes from './features/subscription/routes/subscriptionRoutes.js';
import tiktokRoutes from './features/tiktok/routes/tiktokRoutes.js';
import imageScenarioRoutes from './features/imageGeneration/routes/imageScenarioRoutes.js';
import imageGenerationPublicRoutes from './features/imageGeneration/routes/imageGenerationPublicRoutes.js';
import imageAssetCleanupService from './features/imageGeneration/services/imageAssetCleanupService.js';

app.use('/api/auth', authRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/tiktok', tiktokRoutes);
app.use('/api/image-generation', imageGenerationPublicRoutes);
app.use('/api/image-scenarios', imageScenarioRoutes);

// ---- health & root
app.get('/', (_req, res) => {
  res.json({ name: 'ViralSlides API', env: NODE_ENV, status: 'ok', time: new Date().toISOString() });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ---- 404
app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));

// ---- error handler (Express 5 handles rejected promises -> format here)
app.use((err, req, res, _next) => {
  req.log?.error({ err }, 'Unhandled error');
  const status = err.status || 500;
  res.status(status).json({ error: NODE_ENV === 'production' ? 'Internal Server Error' : err.message });
});

// ---- bootstrap
async function start () {
  try {
    await mongoose.connect(MONGO_URI, { autoIndex: NODE_ENV !== 'production' });
    logger.info('MongoDB connected');
    app.listen(PORT, () => logger.info(`API listening on http://localhost:${PORT} (${NODE_ENV})`));
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
imageAssetCleanupService.start();

export default app;
