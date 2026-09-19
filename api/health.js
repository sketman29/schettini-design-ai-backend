import { cors, handleOptions, cfReady, CF_MODEL } from './_lib.js';
export default async function handler(req,res){
  if(handleOptions(req,res))return;
  cors(res);
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const config={
    cloudflare:cfReady(),
    accessPassword:!!process.env.APP_ACCESS_PASSWORD,
    jwtSecret:String(process.env.APP_JWT_SECRET||'').length>=24
  };
  return res.status(200).json({
    ok:true,
    ai_ready:config.cloudflare&&config.accessPassword&&config.jwtSecret,
    provider:'cloudflare-workers-ai',
    image_model:CF_MODEL,
    free_mode:true,
    config
  });
}
