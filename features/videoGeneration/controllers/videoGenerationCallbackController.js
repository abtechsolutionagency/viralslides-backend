import videoGenerationPipelineService from '../services/videoGenerationPipelineService.js';
import videoStorageService from '../services/videoStorageService.js';
import { VIDEO_SCENARIO_RUN_STATUS } from '../constants/videoGenerationConstants.js';
import VideoScenario from '../models/VideoScenario.js';
import tiktokPublishService from '../../tiktok/services/tiktokPublishService.js';

function mapKieResultUrls (payload = {}) {
  const candidates = [
    payload?.data?.resultUrls,
    payload?.data?.result_urls,
    payload?.data?.info?.result_urls,
    payload?.data?.response?.result_urls,
    payload?.resultUrls,
    payload?.result_urls
  ].find((c) => Array.isArray(c) && c.length > 0);

  if (!candidates) return null;

  const mapped = candidates
    .map((item, index) => {
      if (typeof item === 'string') {
        return { url: item, promptIndex: index };
      }
      if (item && typeof item === 'object') {
        const url = item.resultUrl || item.result_url || item.url;
        if (!url) return null;
        const promptIndex =
          typeof item.index === 'number'
            ? item.index
            : typeof item.promptIndex === 'number'
              ? item.promptIndex
              : index;
        return { url, promptIndex };
      }
      return null;
    })
    .filter(Boolean);

  return mapped.length ? mapped : null;
}

function mapPiapiOutputUrls (payload = {}) {
  const output = payload?.data?.output || payload?.output;
  if (!output || typeof output !== 'object') return null;

  const mapped = [];
  const seen = new Set();

  const add = (url, index = 0, extra = {}) => {
    if (typeof url !== 'string' || !url.trim()) return;
    const normalized = url.trim();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    mapped.push({
      url: normalized,
      promptIndex: index,
      ...extra
    });
  };

  if (Array.isArray(output.works)) {
    output.works.forEach((work, index) => {
      const video = work?.video || {};
      const cover = work?.cover || {};
      add(
        video.resource_without_watermark || video.resource || video.url,
        index,
        {
          thumbnailUrl:
            cover.resource_without_watermark || cover.resource || cover.url || undefined,
          width: typeof video.width === 'number' ? video.width : undefined,
          height: typeof video.height === 'number' ? video.height : undefined
        }
      );
    });
  }

  const listCandidates = [output.result_urls, output.resultUrls].find(
    (candidate) => Array.isArray(candidate) && candidate.length > 0
  );
  if (Array.isArray(listCandidates)) {
    listCandidates.forEach((item, index) => {
      if (typeof item === 'string') {
        add(item, index);
        return;
      }
      if (item && typeof item === 'object') {
        add(item.url || item.result_url || item.resultUrl, index);
      }
    });
  }

  add(output.video_url || output.videoUrl, 0);
  add(output?.video?.resource_without_watermark || output?.video?.resource || output?.video?.url, 0);
  add(output?.generation?.video?.url_no_watermark || output?.generation?.video?.url, 0);

  return mapped.length ? mapped : null;
}

function mapResultJsonUrls (payload = {}) {
  const resultJson = payload?.data?.resultJson || payload?.data?.result_json;
  if (typeof resultJson !== 'string' || !resultJson.trim()) return null;
  try {
    const parsed = JSON.parse(resultJson);
    return mapKieResultUrls(parsed);
  } catch {
    return null;
  }
}

function extractExpandedPrompt (payload = {}) {
  const promptJson = payload?.data?.promptJson || payload?.data?.paramJson || payload?.paramJson;
  if (!promptJson || typeof promptJson !== 'string') return null;
  try {
    const parsed = JSON.parse(promptJson);
    return parsed?.prompt || null;
  } catch {
    return null;
  }
}

function normalizeStatusFromProvider (rawStatus) {
  if (typeof rawStatus !== 'string') return null;
  const normalized = rawStatus.trim().toLowerCase();
  if (!normalized) return null;

  if (
    normalized.includes('failed') ||
    normalized.includes('fail') ||
    normalized.includes('error') ||
    normalized.includes('cancel')
  ) {
    return VIDEO_SCENARIO_RUN_STATUS.FAILED;
  }

  if (
    normalized.includes('completed') ||
    normalized.includes('success') ||
    normalized.includes('finished') ||
    normalized.includes('done')
  ) {
    return VIDEO_SCENARIO_RUN_STATUS.COMPLETED;
  }

  if (
    normalized.includes('pending') ||
    normalized.includes('queue') ||
    normalized.includes('processing') ||
    normalized.includes('running') ||
    normalized.includes('generating')
  ) {
    return VIDEO_SCENARIO_RUN_STATUS.GENERATING;
  }

  return null;
}

class VideoGenerationCallbackController {
  buildCaption ({ scenario, run }) {
    const text = (run?.expandedPrompt || scenario?.prompt || '').trim();
    if (!text) return '';
    return text.slice(0, 2200);
  }

  async autoPublishCompletedRun ({ run, assets, req }) {
    if (!run?.scenario || !run?.user) return null;
    if (!Array.isArray(assets) || assets.length === 0) return null;

    const scenario = await VideoScenario.findOne({ _id: run.scenario, user: run.user });
    if (!scenario || !scenario.isAutoPostEnabled) {
      return null;
    }

    const targets = Array.isArray(scenario.targets)
      ? scenario.targets.filter((target) => target?.autoPost !== false)
      : [];
    if (targets.length === 0) {
      return null;
    }

    const caption = this.buildCaption({ scenario, run });
    const publishJobs = [];

    for (const target of targets) {
      const accountId = target.account?.toString?.() || target.account;
      const privacy = target.privacy || 'public';

      for (let assetIndex = 0; assetIndex < assets.length; assetIndex += 1) {
        const asset = assets[assetIndex];
        if (!asset?.url) continue;

        const idempotencyKey = `video-run:${run._id}:account:${accountId}:asset:${assetIndex}`;

        publishJobs.push(
          tiktokPublishService.publishFromUrl({
            userId: run.user,
            accountId,
            mediaUrl: asset.url,
            caption,
            privacy,
            idempotencyKey
          })
            .then((result) => ({
              success: true,
              accountId,
              assetIndex,
              postId: result.postId
            }))
            .catch((error) => ({
              success: false,
              accountId,
              assetIndex,
              error: error.message || 'TikTok publish failed'
            }))
        );
      }
    }

    const results = await Promise.all(publishJobs);
    const successCount = results.filter((result) => result.success).length;
    const failCount = results.length - successCount;

    await VideoScenario.updateOne(
      { _id: scenario._id },
      {
        $set: {
          lastRunSummary: {
            runId: run._id,
            autoPostAttempted: true,
            attemptedCount: results.length,
            successCount,
            failCount,
            publishedAt: new Date(),
            errors: results
              .filter((result) => !result.success)
              .map(({ accountId, assetIndex, error }) => ({ accountId, assetIndex, error }))
          }
        }
      }
    );

    if (failCount > 0) {
      req.log?.warn(
        { runId: run._id, failCount, successCount },
        'Video auto-post completed with partial failures'
      );
    }

    return { successCount, failCount, attemptedCount: results.length };
  }

  async handle (req, res) {
    try {
      const payload = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const runId =
        payload.runId ||
        payload.run_id ||
        payload.metadata?.run_id ||
        payload.data?.runId ||
        payload.data?.run_id ||
        req.query?.runId;
      const {
        assets = [],
        expandedPrompt,
        status,
        error,
        creditsCharged,
        creditsRefunded
      } = payload;

      if (!runId) {
        return res.status(400).json({ success: false, message: 'runId is required' });
      }

      const mappedAssets =
        mapPiapiOutputUrls(payload) ||
        mapKieResultUrls(payload) ||
        mapResultJsonUrls(payload) ||
        assets;
      const filteredAssets = videoGenerationPipelineService.selectFirstAssetPerPrompt(mappedAssets);
      const storedAssets = await videoStorageService.saveAssets({ runId, assets: filteredAssets });

      const providerStatus = normalizeStatusFromProvider(
        payload?.data?.status ||
          payload?.data?.state ||
          payload?.data?.output?.state ||
          payload?.data?.output?.generation?.state ||
          payload?.state
      );

      const derivedStatus = (() => {
        if (status) return status;
        if (providerStatus) return providerStatus;
        const successFlag = payload?.data?.successFlag;
        if (successFlag === 2 || successFlag === 3) return VIDEO_SCENARIO_RUN_STATUS.FAILED;
        if (successFlag === 1) return VIDEO_SCENARIO_RUN_STATUS.COMPLETED;
        if (typeof payload.code === 'number') {
          if (payload.code >= 400) return VIDEO_SCENARIO_RUN_STATUS.FAILED;
          return storedAssets.length > 0
            ? VIDEO_SCENARIO_RUN_STATUS.COMPLETED
            : VIDEO_SCENARIO_RUN_STATUS.GENERATING;
        }
        return storedAssets.length > 0
          ? VIDEO_SCENARIO_RUN_STATUS.COMPLETED
          : VIDEO_SCENARIO_RUN_STATUS.GENERATING;
      })();

      const run = await videoGenerationPipelineService.handleMakeCallback({
        runId,
        assets: storedAssets,
        expandedPrompt: expandedPrompt || extractExpandedPrompt(payload),
        status: derivedStatus,
        error: (() => {
          if (error) return error;
          const providerError = payload?.data?.error || payload?.error;
          if (providerError && typeof providerError === 'object') {
            const message = providerError.message || providerError.raw_message;
            const code = providerError.code;
            if (message || code) {
              return {
                code: code !== undefined ? String(code) : 'error',
                message: message || 'Generation failed'
              };
            }
          }
          const successFlag = payload?.data?.successFlag;
          if (successFlag === 2 || successFlag === 3) {
            return {
              code: String(payload?.data?.errorCode || payload?.code || 'error'),
              message: payload?.data?.errorMessage || payload?.msg || 'Generation failed'
            };
          }
          if (typeof payload.code === 'number' && payload.code !== 200) {
            return { code: String(payload.code), message: payload.msg || 'Generation failed' };
          }
          if (derivedStatus === VIDEO_SCENARIO_RUN_STATUS.FAILED) {
            return { code: 'error', message: 'Generation failed' };
          }
          return undefined;
        })(),
        creditsCharged,
        creditsRefunded,
        preFiltered: true
      });

      if (
        derivedStatus === VIDEO_SCENARIO_RUN_STATUS.COMPLETED &&
        storedAssets.length > 0
      ) {
        await this.autoPublishCompletedRun({ run, assets: storedAssets, req });
      }

      if (derivedStatus === VIDEO_SCENARIO_RUN_STATUS.COMPLETED && storedAssets.length === 0) {
        req.log?.warn(
          {
            runId,
            payloadCode: payload?.code,
            dataStatus: payload?.data?.status,
            outputKeys: Object.keys(payload?.data?.output || {})
          },
          'Video callback completed with no mapped assets'
        );
      }

      res.status(200).json({ success: true });
    } catch (err) {
      req.log?.error({ err }, 'Video generation callback failed');
      res.status(400).json({
        success: false,
        message: err.message || 'Failed to process video generation callback'
      });
    }
  }
}

export default new VideoGenerationCallbackController();
