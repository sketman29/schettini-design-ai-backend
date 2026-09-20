import sharp from 'sharp';
import { cors, handleOptions, requireAuth, parseMultipart, fileBuffer, cfReady, CF_MODEL } from '../_lib.js';
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
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function expandToMinimum(left,top,right,bottom,w,h,minW=320,minH=320){
  let cw=right-left+1,ch=bottom-top+1;
  if(cw<minW){const d=minW-cw,l=Math.floor(d/2),r=d-l;left-=l;right+=r}
  if(ch<minH){const d=minH-ch,t=Math.floor(d/2),b=d-t;top-=t;bottom+=b}
  if(left<0){right-=left;left=0} if(top<0){bottom-=top;top=0}
  if(right>=w){const d=right-w+1;left-=d;right=w-1} if(bottom>=h){const d=bottom-h+1;top-=d;bottom=h-1}
  left=clamp(left,0,w-1);top=clamp(top,0,h-1);right=clamp(right,left,w-1);bottom=clamp(bottom,top,h-1);
  return {left,top,width:right-left+1,height:bottom-top+1};
}
async function normalizeInputs(imageBuf,maskBuf){
  const meta=await sharp(imageBuf).metadata();
  const width=meta.width,height=meta.height;
  if(!width||!height)throw new Error('Dimensioni foto non leggibili.');
  const maskNormalized=await sharp(maskBuf).resize(width,height,{fit:'fill'}).grayscale().threshold(128).png().toBuffer();
  const {data:raw,info}=await sharp(maskNormalized).grayscale().raw().toBuffer({resolveWithObject:true});
  let minX=width,minY=height,maxX=-1,maxY=-1,count=0;
  const channels=info.channels||1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const v=raw[(y*width+x)*channels];
    if(v>127){count++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}
  }
  if(!count)throw new Error('Maschera vuota. Copri in rosso tutta la cucina da eliminare.');
  const coverage=count/(width*height);
  const bw=maxX-minX+1,bh=maxY-minY+1;
  const padX=Math.max(72,Math.round(bw*.28)),padY=Math.max(72,Math.round(bh*.28));
  const rect=expandToMinimum(minX-padX,minY-padY,maxX+padX,maxY+padY,width,height,320,320);
  const imageCrop=await sharp(imageBuf).extract(rect).jpeg({quality:94,mozjpeg:true}).toBuffer();
  // Blur+low threshold slightly expands the white edit area so old cabinet edges do not survive.
  const sigma=Math.max(2,Math.min(7,Math.min(rect.width,rect.height)*.012));
  const maskCrop=await sharp(maskNormalized).extract(rect).grayscale().blur(sigma).threshold(28).png().toBuffer();
  return {width,height,coverage,rect,imageCrop,maskCrop};
}
async function compositeResult(originalBuf,generatedBuf,maskCrop,rect){
  const generated=await sharp(generatedBuf).resize(rect.width,rect.height,{fit:'fill'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const alpha=await sharp(maskCrop).resize(rect.width,rect.height,{fit:'fill'}).grayscale().blur(1.2).raw().toBuffer({resolveWithObject:true});
  const rgba=Buffer.alloc(rect.width*rect.height*4);
  const gc=generated.info.channels;
  const ac=alpha.info.channels;
  for(let i=0;i<rect.width*rect.height;i++){
    rgba[i*4]=generated.data[i*gc];
    rgba[i*4+1]=generated.data[i*gc+1]??generated.data[i*gc];
    rgba[i*4+2]=generated.data[i*gc+2]??generated.data[i*gc];
    rgba[i*4+3]=alpha.data[i*ac];
  }
  const overlay=await sharp(rgba,{raw:{width:rect.width,height:rect.height,channels:4}}).png().toBuffer();
  return await sharp(originalBuf).composite([{input:overlay,left:rect.left,top:rect.top}]).png().toBuffer();
}

export default async function handler(req,res){
  if(handleOptions(req,res))return;
  cors(res);
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireAuth(req,res))return;
  if(!cfReady())return res.status(503).json({error:'Cloudflare Workers AI non configurato.'});
  try{
    const {files}=await parseMultipart(req);
    const image=await fileBuffer(files,'image');
    const mask=await fileBuffer(files,'mask');
    if(!image)return res.status(400).json({error:'Foto mancante.'});
    if(!mask)return res.status(400).json({error:'Disegna prima la maschera sulla cucina da rimuovere.'});

    const prep=await normalizeInputs(image.buffer,mask.buffer);
    if(prep.coverage<0.003) return res.status(400).json({error:'La maschera è troppo piccola. Copri in rosso tutta la superficie della cucina, non solo una linea.'});

    // IMPORTANT: this is an inpainting model, not an instruction-following editor.
    // Describe ONLY what must exist inside the masked zone. Never send future kitchen design requirements here.
    const prompt=[
      'Photorealistic empty interior after furniture removal.',
      'Inside the masked area generate only a natural continuation of the existing architectural surfaces visible around it.',
      'Continue the same wall material, stone or plaster texture, floor, skirting and shadows seamlessly.',
      'The masked area is completely empty: bare wall and bare floor only.',
      'Preserve perspective, lighting, camera viewpoint and permanent architectural elements.'
    ].join(' ');
    const negative_prompt=[
      'kitchen','kitchen cabinet','cabinetry','cupboard','countertop','worktop','sink','faucet','cooktop','hob','oven','fridge','refrigerator','appliance','furniture','shelf','table','chair','new object','distorted wall','changed window','changed door','changed perspective','zoom','crop','illustration'
    ].join(', ');

    const account=process.env.CLOUDFLARE_ACCOUNT_ID;
    const url=`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${CF_MODEL}`;
    const payload={
      prompt,negative_prompt,
      image_b64:prep.imageCrop.toString('base64'),
      mask:Array.from(prep.maskCrop),
      num_steps:20,strength:1,guidance:11,
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
    const responseBuffer=Buffer.from(await rsp.arrayBuffer());
    let generated=null;
    const directMime=mimeFromBuffer(responseBuffer);
    if(rsp.ok&&directMime) generated=responseBuffer;
    else{
      let data=null;try{data=JSON.parse(responseBuffer.toString('utf8'))}catch{}
      if(!rsp.ok||data?.success===false)throw new Error(data?cloudflareError(data,rsp.status):`Cloudflare Workers AI ${rsp.status}: risposta non valida`);
      generated=findImageInJson(data);
      if(!generated)throw new Error('Cloudflare ha risposto, ma il payload immagine non è riconosciuto.');
    }
    const finalImage=await compositeResult(image.buffer,generated,prep.maskCrop,prep.rect);
    return res.status(200).json({
      ok:true,image_base64:finalImage.toString('base64'),mime_type:'image/png',provider:'cloudflare-workers-ai',model:CF_MODEL,
      mode:'masked-crop-inpaint-v3',mask_coverage_percent:Number((prep.coverage*100).toFixed(2)),crop:prep.rect
    });
  }catch(e){
    const msg=e?.message||String(e);
    const status=/daily free allocation|3036|429|rate limit/i.test(msg)?429:500;
    return res.status(status).json({error:msg});
  }
}
