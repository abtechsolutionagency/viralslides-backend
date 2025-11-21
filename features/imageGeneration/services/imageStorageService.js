import { promises as fs } from 'fs';
import path from 'path';

const STORAGE_ROOT = process.env.IMAGE_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.IMAGE_STORAGE_DIR)
  : path.resolve(process.cwd(), 'storage', 'image-generation');

async function ensureDir (dir) {
  await fs.mkdir(dir, { recursive: true });
}

function resolveExtension (url = '') {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname);
    if (ext) return ext;
  } catch (_) {}
  return '.jpg';
}

async function downloadBuffer (url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to download asset (${response.status}): ${body}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

class ImageStorageService {
  constructor () {
    this.root = STORAGE_ROOT;
  }

  async saveAssets ({ runId, assets }) {
    if (!Array.isArray(assets) || assets.length === 0) return [];
    const runDir = path.join(this.root, runId.toString());
    await ensureDir(runDir);

    const stored = [];
    let index = 0;
    for (const asset of assets) {
      if (!asset?.url) continue;
      const buffer = await downloadBuffer(asset.url);
      const extension = asset.extension || resolveExtension(asset.url);
      const filename = `${Date.now()}-${index}${extension}`;
      const fullPath = path.join(runDir, filename);
      await fs.writeFile(fullPath, buffer);

      stored.push({
        ...asset,
        localPath: fullPath
      });
      index += 1;
    }

    return stored;
  }

  async removeAssets (assets = []) {
    for (const asset of assets) {
      if (!asset?.localPath) continue;
      try {
        await fs.rm(asset.localPath, { force: true });
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn('[ImageStorageService] Failed to remove asset', error);
        }
      }
    }
  }
}

export default new ImageStorageService();
export { STORAGE_ROOT };
