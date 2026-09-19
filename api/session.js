import { cors, handleOptions, jsonBody, issueToken } from './_lib.js';
export default async function handler(req,res){
  if(handleOptions(req,res))return;
  cors(res);
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!process.env.APP_ACCESS_PASSWORD||String(process.env.APP_JWT_SECRET||'').length<24)
    return res.status(503).json({error:'Backend non configurato.'});
  const body=await jsonBody(req);
  if(String(body?.password||'')!==String(process.env.APP_ACCESS_PASSWORD))
    return res.status(401).json({error:'Password backend non valida.'});
  return res.status(200).json({token:issueToken(),expires_in:7200});
}
