import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(512)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(14).max(512)
});

async function audit(db, request, action, entityType, entityId, before = null, after = null) {
  await db.execute(`
    INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,ip_address)
    VALUES ('staff',?,?,?,?,?,?,?)
  `, [request.user?.sub ? Number(request.user.sub) : null, action, entityType, entityId || null,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, request.ip || null]);
}

export async function registerAuthRoutes(app) {
  app.post('/api/v1/admin/auth/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    if (!app.authConfigured) return reply.code(503).send({ error: 'AUTH_NOT_CONFIGURED' });
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_CREDENTIALS' });

    const db = getDb();
    const [rows] = await db.execute(`
      SELECT id,name,email,password_hash,role,status,must_change_password
        FROM staff_users WHERE email=? LIMIT 1
    `, [parsed.data.email.toLowerCase()]);
    const user = rows[0];
    const valid = user?.status === 'active' && await verifyPassword(parsed.data.password, user?.password_hash);
    if (!valid) {
      await new Promise((resolve) => setTimeout(resolve, 180));
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }

    const jti = crypto.randomUUID();
    const token = app.jwt.sign({
      sub: String(user.id),
      jti,
      role: user.role,
      email: user.email,
      name: user.name
    }, { expiresIn: '8h' });

    await db.execute('UPDATE staff_users SET last_login_at=NOW() WHERE id=?', [user.id]);
    request.user = { sub: String(user.id) };
    await audit(db, request, 'auth.login', 'staff_user', user.id, null, { role: user.role });

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        must_change_password: Boolean(user.must_change_password)
      }
    };
  });

  app.get('/api/v1/admin/auth/me', { preHandler: app.authenticate }, async (request) => ({
    user: {
      id: Number(request.user.sub),
      name: request.user.name,
      email: request.user.email,
      role: request.user.role
    }
  }));

  app.post('/api/v1/admin/auth/logout', { preHandler: app.authenticate }, async (request) => {
    const db = getDb();
    const expiresAt = new Date(Number(request.user.exp || 0) * 1000);
    await db.execute(
      'INSERT IGNORE INTO revoked_tokens (jti,user_id,expires_at) VALUES (?,?,?)',
      [request.user.jti, Number(request.user.sub), expiresAt]
    );
    await audit(db, request, 'auth.logout', 'staff_user', Number(request.user.sub));
    return { ok: true };
  });

  app.post('/api/v1/admin/auth/change-password', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_PASSWORD' });
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return reply.code(400).send({ error: 'PASSWORD_MUST_CHANGE' });
    }

    const db = getDb();
    const userId = Number(request.user.sub);
    const [rows] = await db.execute('SELECT password_hash FROM staff_users WHERE id=? AND status=\'active\' LIMIT 1', [userId]);
    if (!rows[0] || !await verifyPassword(parsed.data.currentPassword, rows[0].password_hash)) {
      return reply.code(401).send({ error: 'CURRENT_PASSWORD_INVALID' });
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await db.execute('UPDATE staff_users SET password_hash=?,must_change_password=0 WHERE id=?', [passwordHash, userId]);
    await db.execute('INSERT IGNORE INTO revoked_tokens (jti,user_id,expires_at) VALUES (?,?,?)', [
      request.user.jti, userId, new Date(Number(request.user.exp || 0) * 1000)
    ]);
    await audit(db, request, 'auth.password.changed', 'staff_user', userId);
    return { ok: true, reauthenticate: true };
  });
}
