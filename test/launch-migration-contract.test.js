import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const sql=fs.readFileSync(path.join(__dirname,'..','migrations','009_launch_finalization.sql'),'utf8');

test('launch migration creates reversible run model and external attestations',()=>{
  for(const marker of ['CREATE TABLE IF NOT EXISTS launch_runs','CREATE TABLE IF NOT EXISTS launch_changes','CREATE TABLE IF NOT EXISTS launch_attestations'])assert.match(sql,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for(const key of ['payment','shipping','email','mobile'])assert.match(sql,new RegExp(`'${key}'`));
});

test('launch migration does not contain destructive catalog statements',()=>{
  assert.doesNotMatch(sql,/\bDROP\s+(TABLE|DATABASE)\b/i);
  assert.doesNotMatch(sql,/\bDELETE\s+FROM\s+products\b/i);
  assert.doesNotMatch(sql,/\bTRUNCATE\s+TABLE\s+products\b/i);
});
