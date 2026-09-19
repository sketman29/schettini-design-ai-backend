import { cors, handleOptions, requireAuth, parseMultipart, fileBuffer, field, cfReady, CF_MODEL } from '../_lib.js';
export const config={api:{bodyParser:false}};

function mimeFromBuffer(buf){
  if(!buf||buf.length<4)return null;
  if(buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4e&&buf[3]===0x47)return 'image/png';
  if(buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff)return 'image/jpeg';
  if(buf.length>=12&&buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP')return 'image/webp';
  return null;
}
function decodeCandidateString(v){
  if(typeof v!=='string'||!v.length)return null;
  let s=v.trim();
  const m=s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);if(m)s=m[2];
  const compact=s.replace(/\s+/g,'').replace(/-/g,'+').replace(/_/g,'/');
  if(/^[A-Za-z0-9+/]*={0,2}$/.test(compact)){
    try{const pad=compact+'='.repeat((4-compact.length%4)%4);const b=Buffer.from(pad,'base64');if(mimeFromBuffer(b))return b}catch{}
  }
  try{const b=Buffer.from(v,'latin1');if(mimeFromBuffer(b))return b}catch{}
  return null;
}
function findImageInJson(data){
  const candidates=[data?.result,data?.result?.image,data?.image,data?.image_base64,data?.result?.image_base64];
  for(const c of candidates){
    if(Array.isArray(c)){const b=Buffer.from(c);if(mimeFromBuffer(b))return b}
    const b=decodeCandidateString(c);if(b)return b;
  }
  return null;
}
function cloudflareError(data,status){
  return data?.errors?.[0]?.message||data?.error||data?.message||`Cloudflare Workers AI ${status}`;
}

export default async function handler(req,res){
  if(handleOptions(req,res))return;
  cors(res);
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireAuth(req,res))return;
  if(!cfReady())return res.status(503).json({error:'Cloudflare Workers AI non configurato.'});
  try{
    const {fields,files}=await parseMultipart(req);
    const image=await fileBuffer(files,'image');
    const mask=await fileBuffer(files,'mask');
    if(!image)return res.status(400).json({error:'Foto mancante.'});
    if(!mask)return res.status(400).json({error:'Per la modalità AI gratuita serve una maschera. Disegna in rosso la cucina da rimuovere e riprova.'});

    const extra=field(fields,'prompt');
    const prompt=[
      'Interior architectural photo restoration.',
      'Remove the masked kitchen cabinetry, appliances, countertop and removable furniture.',
      'Reconstruct realistic wall, floor, skirting, stone, plaster and architectural surfaces hidden behind them.',
      'Preserve all unmasked geometry, windows, doors, niches, outlets, plumbing and camera viewpoint.',
      'No new furniture. No zoom. No crop. Photorealistic.',
      extra
    ].filter(Boolean).join(' ');
    const negative_prompt='new kitchen, cabinets, furniture, altered window, altered door, changed perspective, zoom, crop, distorted architecture, fantasy, illustration';

    const account=process.env.CLOUDFLARE_ACCOUNT_ID;
    const url=`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${CF_MODEL}`;
    const payload={
      prompt,negative_prompt,
      image_b64:image.buffer.toString('base64'),
      mask:Array.from(mask.buffer),
      num_steps:20,strength:0.95,guidance:7.5,
      seed:Math.floor(Math.random()*2147483646)+1
    };
    const rsp=await fetch(url,{
      method:'POST',
      headers:{
        'Authorization':`Bearer ${process.env.CLOUDFLARE_AI_TOKEN}`,
        'Content-Type':'application/json',
        'Accept':'image/png, application/json;q=0.9, */*;q=0.8'
      },
      body:JSON.stringify(payload)
    });

    // Important: read bytes first. Do not call rsp.text() before checking image magic.
    const responseBuffer=Buffer.from(await rsp.arrayBuffer());
    const directMime=mimeFromBuffer(responseBuffer);
    if(rsp.ok&&directMime){
      return res.status(200).json({ok:true,image_base64:responseBuffer.toString('base64'),mime_type:directMime,provider:'cloudflare-workers-ai',model:CF_MODEL,response_format:'binary'});
    }

    let data=null;
    try{data=JSON.parse(responseBuffer.toString('utf8'))}catch{}
    if(!rsp.ok||data?.success===false){
      throw new Error(data?cloudflareError(data,rsp.status):`Cloudflare Workers AI ${rsp.status}: risposta non valida`);
    }
    const img=findImageInJson(data);
    if(!img)throw new Error('Cloudflare ha risposto, ma il payload immagine non è in un formato riconosciuto.');
    const mime=mimeFromBuffer(img)||'image/png';
    return res.status(200).json({ok:true,image_base64:img.toString('base64'),mime_type:mime,provider:'cloudflare-workers-ai',model:CF_MODEL,response_format:'json-normalized'});
  }catch(e){
    const msg=e?.message||String(e);
    const status=/daily free allocation|3036|429|rate limit/i.test(msg)?429:500;
    return res.status(status).json({error:msg});
  }
}
