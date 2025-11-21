import imageGenerationPipelineService from '../services/imageGenerationPipelineService.js';
import imageStorageService from '../services/imageStorageService.js';
import { IMAGE_SCENARIO_RUN_STATUS } from '../constants/imageGenerationConstants.js';

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

function extractExpandedPrompt (payload = {}) {
  const promptJson = payload?.data?.promptJson || payload?.data?.paramJson || payload?.paramJson;
  if (!promptJson || typeof promptJson !== 'string') return null;
  try {
    const parsed = JSON.parse(promptJson);
    return parsed?.prompt || null;
  } catch (_) {}
  return null;
}

class ImageGenerationCallbackController {
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

      const mappedAssets = mapKieResultUrls(payload) || assets;
      const filteredAssets = imageGenerationPipelineService.selectFirstAssetPerPrompt(mappedAssets);
      const storedAssets = await imageStorageService.saveAssets({ runId, assets: filteredAssets });

      await imageGenerationPipelineService.handleMakeCallback({
        runId,
        assets: storedAssets,
        expandedPrompt: expandedPrompt || extractExpandedPrompt(payload),
        status: (() => {
          if (status) return status;
          const successFlag = payload?.data?.successFlag;
          if (successFlag === 2 || successFlag === 3) return IMAGE_SCENARIO_RUN_STATUS.FAILED;
          if (successFlag === 1) return IMAGE_SCENARIO_RUN_STATUS.COMPLETED;
          if (typeof payload.code === 'number') {
            return payload.code === 200
              ? IMAGE_SCENARIO_RUN_STATUS.COMPLETED
              : IMAGE_SCENARIO_RUN_STATUS.FAILED;
          }
          return undefined;
        })(),
        error: (() => {
          if (error) return error;
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
          return undefined;
        })(),
        creditsCharged,
        creditsRefunded,
        preFiltered: true
      });

      res.status(200).json({ success: true });
    } catch (err) {
      req.log?.error({ err }, 'Image generation callback failed');
      res.status(400).json({
        success: false,
        message: err.message || 'Failed to process image generation callback'
      });
    }
  }
}

export default new ImageGenerationCallbackController();
