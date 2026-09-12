import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../lib/db.js';
import { generateTemporaryPassword, hashPassword } from '../lib/passwords.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = String(arg('email') || process.env.CP_ADMIN_EMAIL || 'admin@grafica.belastock.com.br').trim().toLowerCase();
const name = String(arg('name') || process.env.CP_ADMIN_NAME || 'Super Admin Central Prints').trim();
const suppliedPassword = arg('password') || process.env.CP_ADMIN_PASSWORD;
const password = suppliedPassword || generateTemporaryPassword();
const outputPath = String(arg('output') || process.env.CP_ADMIN_OUTPUT || (process.getuid?.() === 0 ? '/root/central-prints-initial-admin.txt' : path.join(os.homedir(), 'central-prints-initial-admin.txt')));

if (!email.includes('@')) throw new Error('CP_ADMIN_EMAIL_INVALIDO');

const db = getDb();
const [existing] = await db.execute('SELECT id,email,role,status FROM staff_users WHERE email=? LIMIT 1', [email]);
if (existing.length) {
  console.log(`[ADMIN] Usuario ja existe: id=${existing[0].id} email=${existing[0].email} role=${existing[0].role} status=${existing[0].status}`);
  process.exit(0);
}

const passwordHash = await hashPassword(password);
const [result] = await db.execute(`
  INSERT INTO staff_users (name,email,password_hash,role,status,must_change_password)
  VALUES (?,?,'${'__HASH_PLACEHOLDER__'}','super_admin','active',1)
`.replace("'__HASH_PLACEHOLDER__'", '?'), [name, email, passwordHash]);

if (!suppliedPassword) {
  const payload = [
    'CENTRAL PRINTS - CREDENCIAL INICIAL',
    `URL: ${process.env.APP_URL || 'https://grafica.belastock.com.br'}/admin/`,
    `EMAIL: ${email}`,
    `SENHA_TEMPORARIA: ${password}`,
    'TROCA_OBRIGATORIA: sim',
    ''
  ].join('\n');
  await fs.writeFile(outputPath, payload, { mode: 0o600 });
  await fs.chmod(outputPath, 0o600);
  console.log(`[ADMIN] Super Admin criado. Credencial temporaria salva com permissao 600 em: ${outputPath}`);
} else {
  console.log(`[ADMIN] Super Admin criado: id=${result.insertId} email=${email}. Senha fornecida externamente; nada foi gravado em arquivo.`);
}
