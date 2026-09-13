import 'dotenv/config';
import { getDb } from '../lib/db.js';
import { hashPassword } from '../lib/passwords.js';

const email=String(process.env.CP_ADMIN_EMAIL||'admin@grafica.belastock.com.br').trim().toLowerCase();
const password=String(process.env.CP_ADMIN_PASSWORD||'');
if(password.length<14)throw new Error('CP_ADMIN_PASSWORD_REQUIRED_MIN_14');
const db=getDb();
try{
  const hash=await hashPassword(password);
  const [rows]=await db.execute('SELECT id FROM staff_users WHERE email=? LIMIT 1',[email]);
  if(rows[0]) await db.execute("UPDATE staff_users SET password_hash=?,role='super_admin',status='active',must_change_password=1,updated_at=NOW() WHERE id=?",[hash,rows[0].id]);
  else await db.execute("INSERT INTO staff_users (name,email,password_hash,role,status,must_change_password) VALUES (?,?,?,'super_admin','active',1)",['Super Admin Central Prints',email,hash]);
  console.log(JSON.stringify({ok:true,email,must_change_password:true}));
}finally{await db.end();}
