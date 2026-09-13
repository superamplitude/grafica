import { readFile } from 'node:fs/promises';
import path from 'node:path';

const RELEASE_FILE = path.join(process.cwd(), 'runtime', 'deploy-status.json');

export async function readReleaseStatus() {
  try {
    const raw = await readFile(RELEASE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return {
      commit: typeof data.commit === 'string' ? data.commit : null,
      deployedAt: typeof data.deployedAt === 'string' ? data.deployedAt : null,
      port: Number.isInteger(Number(data.port)) ? Number(data.port) : null,
      health: data.health === 200 ? 200 : null,
      ready: data.ready === 200 ? 200 : null,
      public: data.public === 200 ? 200 : null,
      catalog: data.catalog === 200 ? 200 : null
    };
  } catch {
    return { commit:null,deployedAt:null,port:null,health:null,ready:null,public:null,catalog:null };
  }
}
