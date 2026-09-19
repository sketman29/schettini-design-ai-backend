import jwt from 'jsonwebtoken';
import formidable from 'formidable';
import { readFile } from 'node:fs/promises';

export const CF_MODEL = process.env.CLOUDFLARE_IMAGE_MODEL || '@cf/runwayml/stable-diffusion-v1-5-inpainting';

export function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
}
export function handleOptions(req,res){
  cors(res);
  if(req.method==='OPTIONS'){res.status(204).end();return true}
  return false;
}
export async function jsonBody(req){
  if(req.body && typeof req.body==='object' && !Buffer.isBuffer(req.body)) return req.body;
  if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{return {}}}
  const chunks=[]; for await(const c of req) chunks.push(c);
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{return {}}
}
export function issueToken(){
  const secret=String(process.env.APP_JWT_SECRET||'');
  if(secret.length<24) throw new Error('APP_JWT_SECRET non configurato correttamente.');
  return jwt.sign({scope:'schettini-ai'},secret,{expiresIn:'2h',issuer:'schettini-design-ai'});
}
export function requireAuth(req,res){
  const secret=String(process.env.APP_JWT_SECRET||'');
  const h=String(req.headers.authorization||'');
  const token=h.startsWith('Bearer ')?h.slice(7):'';
  if(secret.length<24){res.status(503).json({error:'APP_JWT_SECRET non configurato.'});return false}
  try{
    const d=jwt.verify(token,secret,{issuer:'schettini-design-ai'});
    if(d?.scope!=='schettini-ai') throw new Error('scope');
    return true;
  }catch{
    res.status(401).json({error:'Sessione backend AI non valida o scaduta.'});return false;
  }
}
export async function parseMultipart(req){
  const form=formidable({multiples:false,maxFileSize:18*1024*1024,allowEmptyFiles:false});
  return await new Promise((resolve,reject)=>form.parse(req,(err,fields,files)=>err?reject(err):resolve({fields,files})));
}
function one(v){return Array.isArray(v)?v[0]:v}
export function field(fields,name){const v=one(fields?.[name]);return v==null?'':String(v)}
export async function fileBuffer(files,name){
  const f=one(files?.[name]);
  if(!f)return null;
  return {buffer:await readFile(f.filepath),type:f.mimetype||'image/png',name:f.originalFilename||name};
}
export function cfReady(){return !!(process.env.CLOUDFLARE_ACCOUNT_ID&&process.env.CLOUDFLARE_AI_TOKEN)}
