import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbStatus } from './lib/db.js';
import { r2Status } from './lib/storage.js';
import { readReleaseStatus } from './lib/release.js';
import { registerAuth } from './plugins/auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerPriceTableRoutes } from './routes/price-table.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerCommerceRoutes } from './routes/commerce.js';
import { registerSiteHeroRoutes } from './routes/site-hero.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAdminOrderRoutes } from './routes/admin-orders.js';
import { registerAdminPrepressRoutes } from './routes/admin-prepress.js';
import { registerAdminLaunchRoutes } from './routes/admin-launch.js';
import { registerAdminCatalogRoutes } from './routes/admin-catalog.js';
import { registerAdminSiteRoutes } from './routes/admin-site.js';
import { registerAdminAssetRoutes } from './routes/admin-assets.js';
import { registerAdminProductMediaRoutes } from './routes/admin-product-media.js';
import { registerAdminSupplierPriceRoutes } from './routes/admin-supplier-prices.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerArtworkRoutes } from './routes/artworks.js';
import { registerProofRoutes } from './routes/proofs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VERSION = '3.0.0-alpha.1';

export async function buildApp() {
  const app = Fastify({ logger: true, trustProxy: true });
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','https:'],connectSrc:["'self'",'https:'],fontSrc:["'self'",'data:'],objectSrc:["'none'"],baseUri:["'self'"],frameAncestors:["'none'"] } }, crossOriginResourcePolicy:{policy:'cross-origin'} });
  await app.register(fastifyStatic, { root:path.join(__dirname,'..','public'),prefix:'/',wildcard:false });
  await registerAuth(app);

  app.get('/api/health',async()=>({
    ok:true,
    service:'central-prints-node',
    version:VERSION,
    database:await dbStatus(),
    storage:await r2Status(),
    auth:app.authConfigured?'configured':'unconfigured',
    timestamp:new Date().toISOString()
  }));

  app.get('/api/ready',async(_request,reply)=>{
    const database=await dbStatus();
    const storage=await r2Status();
    const dbRequired=String(process.env.DB_REQUIRED??'true').toLowerCase()!=='false';
    const r2Required=String(process.env.R2_REQUIRED??'false').toLowerCase()==='true';
    const ready=(!dbRequired||database==='ok')&&(!r2Required||storage==='ok')&&app.authConfigured;
    return reply.code(ready?200:503).send({
      ok:ready,
      service:'central-prints-node',
      version:VERSION,
      database,
      storage,
      auth:app.authConfigured?'configured':'unconfigured',
      dbRequired,
      r2Required,
      timestamp:new Date().toISOString()
    });
  });

  app.get('/api/release', async () => ({
    service:'central-prints-node',
    version:VERSION,
    release:await readReleaseStatus()
  }));
  app.get('/api',async()=>({name:'Central Prints API',version:VERSION}));

  await registerPublicRoutes(app);
  await registerPriceTableRoutes(app);
  await registerTemplateRoutes(app);
  await registerCommerceRoutes(app);
  await registerSiteHeroRoutes(app);
  await registerOrderRoutes(app);
  await registerArtworkRoutes(app);
  await registerProofRoutes(app);
  await registerAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerAdminOrderRoutes(app);
  await registerAdminPrepressRoutes(app);
  await registerAdminLaunchRoutes(app);
  await registerAdminCatalogRoutes(app);
  await registerAdminSiteRoutes(app);
  await registerAdminAssetRoutes(app);
  await registerAdminProductMediaRoutes(app);
  await registerAdminSupplierPriceRoutes(app);
  await registerMediaRoutes(app);

  app.setErrorHandler((error,request,reply)=>{request.log.error(error);if(error?.message==='DATABASE_NOT_CONFIGURED')return reply.code(503).send({error:'DATABASE_NOT_READY'});if(error?.message==='R2_NOT_CONFIGURED')return reply.code(503).send({error:'R2_NOT_READY'});if(error?.code==='ECONNREFUSED'||error?.code==='ER_ACCESS_DENIED_ERROR'||error?.code==='ER_BAD_DB_ERROR')return reply.code(503).send({error:'DATABASE_NOT_READY'});const statusCode=Number(error?.statusCode||500);return reply.code(statusCode>=400&&statusCode<600?statusCode:500).send({error:statusCode>=500?'INTERNAL_ERROR':(error?.code||'REQUEST_ERROR')})});
  return app;
}
