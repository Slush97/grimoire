import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const stage=process.argv[4]??'r2';
if(!/^[a-z0-9-]+$/.test(stage))throw new Error('Invalid capture stage');
const out=`.codex-run/hideout-heroes-${stage}`;mkdirSync(out,{recursive:true});
const heroes=(process.argv[2]??'viscous,infernus,paige,abrams').split(',');
const scenes=(process.argv[3]??'studio,hideout').split(',');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
try{for(const hero of heroes)for(const sceneName of scenes){
 const page=await browser.newPage({viewport:{width:720,height:980},deviceScaleFactor:1});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,800))});
 await page.addInitScript(()=>{
  for(const name of ['animated','cloth','autoRotate'])localStorage.setItem('grimoire.preview.presentation.'+name,'0');
  let now=0,id=0,queue=[],auto=true;const frame=requestAnimationFrame.bind(window);
  performance.now=()=>now;window.requestAnimationFrame=fn=>{queue.push({id:++id,fn});return id};
  window.cancelAnimationFrame=cancel=>{queue=queue.filter(entry=>entry.id!==cancel)};
  const step=()=>{now+=1000/60;const due=queue;queue=[];due.forEach(({fn})=>fn(now))};
  const loop=()=>{if(auto)step();frame(loop)};frame(loop);
  window.__clock={manual(){auto=false},advance(n){for(let i=0;i<n;i++)step()}};
 });
 await page.goto(`http://127.0.0.1:5197/hero-preview.html?source=cache&case=${hero}_vanilla&particles=off&scene=${sceneName}&backdrop=none`);
 await page.waitForSelector('#hero-viewer canvas',{timeout:180000});
 await page.waitForFunction(()=>document.querySelector('[data-animation-availability]')?.dataset.animationAvailability!=='pending',null,{timeout:180000});
 await page.waitForFunction(sceneName=>document.querySelector('[data-lighting-probe]')?.dataset.lightingProbe===(sceneName==='hideout'?'map':'ready'),sceneName,{timeout:180000});
 if(sceneName==='hideout')await page.waitForFunction(async()=>{const{viewerState}=await import('/src/dev/heroFidelityCapture.ts');return viewerState().scene.userData.source2MapPostReady},null,{timeout:30000});
 await page.waitForTimeout(1500);
 await page.evaluate(async()=>{window.__clock.manual();const{viewerState}=await import('/src/dev/heroFidelityCapture.ts');viewerState().clock.elapsedTime=0;window.__clock.advance(121)});
 await page.waitForTimeout(100);
 const state=await page.evaluate(async()=>{
 const{viewerState}=await import('/src/dev/heroFidelityCapture.ts');const{scene,camera,gl,clock}=viewerState();const materials=[],lights=[];scene.traverse(o=>{if(o.isLight)lights.push({type:o.type,intensity:o.intensity,position:o.position.toArray()});if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.uniforms?.uCitadelExposure)materials.push({name:m.name,exposure:m.uniforms.uCitadelExposure.value,ambient:m.uniforms.uNprAmbientCubeOn.value,key:m.uniforms.uKeyDir.value.toArray(),mapShader:m.onBeforeCompile.toString().includes('source2')})});
 const canvas=document.querySelector('#hero-viewer canvas');for(const node of document.querySelectorAll('#hero-viewer *'))if(!node.contains(canvas))node.style.visibility='hidden';
 return{camera:camera.position.toArray(),home:camera.userData.previewHome,shaderTime:clock.elapsedTime,materials,lights,post:scene.userData.sourcePostSettings,renderer:gl.info.render,programCount:gl.info.programs.length};});
 await page.locator('#hero-viewer canvas').screenshot({path:`${out}/${hero}-${sceneName}.png`});writeFileSync(`${out}/${hero}-${sceneName}.json`,JSON.stringify({hero,scene:sceneName,...state,errors},null,2));console.log(hero,sceneName,errors);
 if(hero==='abrams'&&sceneName==='hideout'){
  await page.setViewportSize({width:960,height:640});
  await page.evaluate(async()=>{const{viewerState}=await import('/src/dev/heroFidelityCapture.ts');const{camera}=viewerState();const home=camera.userData.previewHome;camera.position.set(...home.position).multiplyScalar(1.8);window.__clock.advance(1)});
  await page.waitForTimeout(150);await page.locator('#hero-viewer canvas').screenshot({path:`${out}/abrams-hideout-wide.png`});
  if(stage.includes('r3'))for(const [name,x]of[['left',-3.2],['center',0],['right',3.2]]){
   const cameraState=await page.evaluate(async x=>{const{viewerState}=await import('/src/dev/heroFidelityCapture.ts');const{camera}=viewerState();camera.position.set(x,-0.3,7);camera.fov=50;camera.lookAt(0,0.4,0);camera.updateProjectionMatrix();window.__clock.advance(1);return{position:camera.position.toArray(),fov:camera.fov,target:[0,0.4,0]};},x);
   await page.waitForTimeout(150);await page.locator('#hero-viewer canvas').screenshot({path:`${out}/abrams-game-camera-${name}.png`});
   writeFileSync(`${out}/abrams-game-camera-${name}.json`,JSON.stringify(cameraState,null,2));
  }
 }
 await page.close();
}}finally{await browser.close()}
