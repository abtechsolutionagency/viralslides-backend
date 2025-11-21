import ImageScenarioRun from '../models/ImageScenarioRun.js';
import imageStorageService from './imageStorageService.js';

const DEFAULT_RETENTION_MS =
  Number(process.env.IMAGE_ASSET_RETENTION_MS) || 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS =
  Number(process.env.IMAGE_ASSET_CLEANUP_INTERVAL_MS) || 6 * 60 * 60 * 1000; // every 6 hours

class ImageAssetCleanupService {
  constructor () {
    this.webhookUrl = process.env.IMAGE_ASSET_CLEANUP_WEBHOOK_URL || '';
    this.cleanupTimer = null;
    this.isRunning = false;
    this.logger = console;
  }

  start () {
    if (this.cleanupTimer) return;
    this.scheduleNextRun(10 * 1000); // wait 10s after boot
  }

  stop () {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  scheduleNextRun (delay = DEFAULT_CLEANUP_INTERVAL_MS) {
    this.cleanupTimer = setTimeout(async () => {
      try {
        await this.runCleanup();
      } catch (error) {
        this.logger.error('[ImageAssetCleanupService] Cleanup failed', error);
      } finally {
        this.scheduleNextRun();
      }
    }, delay);
    this.cleanupTimer.unref?.();
  }

  async runCleanup () {
    if (this.isRunning) return;
    this.isRunning = true;
    const cutoff = new Date(Date.now() - DEFAULT_RETENTION_MS);

    try {
      const runs = await ImageScenarioRun.find({
        completedAt: { $lte: cutoff },
        assetsDeletedAt: { $exists: false },
        assets: { $exists: true, $ne: [] }
      })
        .limit(50)
        .lean();

      if (!runs.length) {
        return;
      }

      for (const run of runs) {
        try {
          await this.deleteAssetsForRun(run);
          await ImageScenarioRun.updateOne(
            { _id: run._id },
            {
              $set: {
                assetsDeletedAt: new Date(),
                assets: []
              }
            }
          );
        } catch (error) {
          this.logger.error('[ImageAssetCleanupService] Failed to cleanup run assets', {
            runId: run._id,
            error
          });
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  async deleteAssetsForRun (run) {
    const payload = {
      runId: run._id.toString(),
      scenarioId: run.scenario?.toString(),
      assets: run.assets || []
    };

    if (this.webhookUrl) {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch((error) => {
        this.logger.error('[ImageAssetCleanupService] Remote cleanup failed', error);
      });
    }

    await imageStorageService.removeAssets(payload.assets);
  }
}

export default new ImageAssetCleanupService();
