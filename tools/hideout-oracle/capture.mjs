import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const stage = process.argv[2] ?? 'before';
const out = `.codex-run/hideout-${stage}`;
mkdirSync(out, {recursive:true});
const cameras = JSON.parse(readFileSync('.codex-run/hideout-reference/cameras.json'));
const browser = await chromium.launch({ channel:'msedge', headless:true, args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({viewport:{width:720,height:720},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,500));});
  const modeIndex = process.argv.indexOf('--mode');
  const mode = modeIndex < 0 ? 'post' : process.argv[modeIndex + 1];
  await page.goto(`http://127.0.0.1:5196/tools/hideout-oracle/viewer.html?mode=${encodeURIComponent(mode)}`);
  await page.waitForFunction(()=>['ready','failed'].includes(window.__hideout?.status?.kind),null,{timeout:240000});
  const result=await page.evaluate(()=>{
    const hiddenMaterials=new Set();
    window.__hideout.state.scene.traverse(object=>{
      if(!object.isMesh)return;
      for(const material of Array.isArray(object.material)?object.material:[object.material])if(!material.visible)hiddenMaterials.add(material.name);
    });
    return {status:window.__hideout.status,loadMs:window.__hideout.loadMs,hiddenMaterials:[...hiddenMaterials]};
  });
  if(result.status.kind!=='ready')throw new Error(JSON.stringify({result,errors}));
  if (mode === 'post') await page.waitForFunction(() => window.__hideout.state.scene.userData.source2MapPostReady, null, {timeout:30000});
  for(let i=0;i<cameras.captures.length;i++) {
    await page.evaluate(({camera:fixed})=>{
      const {camera,scene,gl}=window.__hideout.state;
      // The scene reports the anchor it placed the map at (moved to center the hero).
      const anchor=window.__hideout.info.anchor;
      const heading=-window.__hideout.info.heading*Math.PI/180;
      const convert=([x,y,z])=>{
        x-=anchor[0];y-=anchor[1];z-=anchor[2];
        return [.0254*(y*Math.cos(heading)+x*Math.sin(heading)),.0254*z,.0254*(-y*Math.sin(heading)+x*Math.cos(heading))];
      };
      camera.position.set(...convert(fixed.position));camera.fov=fixed.fov*180/Math.PI;
      camera.lookAt(...convert(fixed.target));camera.updateProjectionMatrix();
      // The post fixture renders through the production composer on its frame.
      if (scene.userData.sourcePostSettings) window.__hideout.state.advance(performance.now());
      else gl.render(scene,camera);
      gl.getContext().finish();
      window.__hideout.firstFrameMs ??= performance.now();
    },{camera:cameras.captures[i]});
    await page.waitForTimeout(300);
    await page.locator('canvas').screenshot({path:`${out}/ours-${i}.png`});
    const rays=await page.evaluate(async()=>{
      const THREE=window.__hideout.THREE;
      const {scene,camera}=window.__hideout.state;const ray=new THREE.Raycaster();const hits=[];
      for(const y of [.75,.4,0,-.4])for(const x of [-.6,0,.6]){
        ray.setFromCamera(new THREE.Vector2(x,y),camera);
        hits.push({x,y,hits:ray.intersectObjects(scene.children,true).filter(h=>h.object.isMesh).slice(0,3).map(h=>{
          const object=h.object,geometry=object.geometry,material=Array.isArray(object.material)?object.material[0]:object.material;
          let lightmapSample=null;
          const uv=geometry.getAttribute('uv3'),positions=geometry.getAttribute('position');
          if(uv&&material.lightMap&&h.face){
            const local=object.worldToLocal(h.point.clone());
            const a=new THREE.Vector3().fromBufferAttribute(positions,h.face.a),b=new THREE.Vector3().fromBufferAttribute(positions,h.face.b),c=new THREE.Vector3().fromBufferAttribute(positions,h.face.c);
            const bary=THREE.Triangle.getBarycoord(local,a,b,c,new THREE.Vector3());
            const sample=new THREE.Vector2(uv.getX(h.face.a),uv.getY(h.face.a)).multiplyScalar(bary.x)
              .addScaledVector(new THREE.Vector2(uv.getX(h.face.b),uv.getY(h.face.b)),bary.y)
              .addScaledVector(new THREE.Vector2(uv.getX(h.face.c),uv.getY(h.face.c)),bary.z);
            const image=material.lightMap.image;
            const sx=Math.min(image.width-1,Math.max(0,Math.floor(sample.x*material.lightMap.repeat.x*image.width)));
            const sy=Math.min(image.height-1,Math.max(0,Math.floor(sample.y*material.lightMap.repeat.y*image.height)));
            lightmapSample={uv:sample.toArray(),dc:Array.from(image.data.slice((sy*image.width+sx)*4,(sy*image.width+sx)*4+3))};
          }
          return {distance:h.distance,name:object.name,material:material.name,primitive:object.userData.hideoutPrimitive,point:h.point.toArray(),lightmapSample};
        })});
      }return hits;
    });
    writeFileSync(`${out}/rays-${i}.json`,JSON.stringify(rays,null,2));
  }
  const endToEndMs=await page.evaluate(()=>window.__hideout.firstFrameMs);
  const rendererToFrameMs=await page.evaluate(()=>window.__hideout.firstFrameMs-window.__hideout.started);
  const resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/@scene/')).map(entry=>({name:entry.name.split('/').at(-1),ms:entry.duration,bytes:entry.decodedBodySize})));
  const gpu = await page.evaluate(() => {
    const { gl } = window.__hideout.state, context = gl.getContext();
    const debug = context.getExtension('WEBGL_debug_renderer_info');
    return { programs: gl.info.programs.length, maxTextures: gl.capabilities.maxTextures, extensions: context.getSupportedExtensions(),
      renderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER) };
  });
  writeFileSync(`${out}/result.json`,JSON.stringify({loadMs:result.loadMs,rendererToFrameMs,endToEndMs,failedLoads:result.status.failedLoads,hiddenMaterials:result.hiddenMaterials,resources,gpu,errors},null,2));
  if(process.argv.includes('--orbit')) {
    mkdirSync(`${out}/orbit`,{recursive:true});
    for(let frame=0;frame<96;frame++) {
      await page.evaluate(({angle,anchor})=>{
        const {camera,scene,gl}=window.__hideout.state;
        const heading=-window.__hideout.info.heading*Math.PI/180;
        const x=Math.cos(angle)*180,y=Math.sin(angle)*180;
        camera.position.set(.0254*(y*Math.cos(heading)+x*Math.sin(heading)),62*.0254,.0254*(-y*Math.sin(heading)+x*Math.cos(heading)));
        camera.lookAt(0,42*.0254,0);camera.updateProjectionMatrix();
        if (scene.userData.sourcePostSettings) window.__hideout.state.advance(performance.now());
        else gl.render(scene,camera);
      },{angle:frame/96*Math.PI*2,anchor:cameras.anchor});
      await page.locator('canvas').screenshot({path:`${out}/orbit/${String(frame).padStart(4,'0')}.png`});
    }
  }
  console.log({stage,loadMs:result.loadMs,failedLoads:result.status.failedLoads,errors});
}finally{await browser.close();}
