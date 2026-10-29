import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const stage = process.argv[2] ?? 'before';
const decode = (path) => execFileSync('ffmpeg', ['-v','error','-threads','1','-i',path,'-f','rawvideo','-pix_fmt','rgb24','-'], { maxBuffer: 4*720*720 });
const results=[];
for (let camera=0;camera<4;camera++) {
  const ref=decode(`.codex-run/hideout-reference/reference-${camera}.png`);
  const ours=decode(`.codex-run/hideout-${stage}/ours-${camera}.png`);
  const regions={whole:[0,0,720,720],floor:[0,400,720,320],upper:[0,0,720,360]};
  if(camera===1)regions.desk=[0,180,330,260];
  const scores={};
  for(const [name,[left,top,width,height]] of Object.entries(regions)) {
    let sq=0,abs=0,n=0;
    for(let y=top;y<top+height;y++)for(let x=left;x<left+width;x++){
      // VRF renders an unsupported world UI panel as a solid cyan square here.
      if(camera===0&&x>=350&&x<545&&y>=40&&y<235)continue;
      for(let c=0;c<3;c++){const d=ours[(y*720+x)*3+c]-ref[(y*720+x)*3+c];sq+=d*d;abs+=Math.abs(d);n++;}
    }
    scores[name]={rmse8:Math.sqrt(sq/n),mae8:abs/n,samples:n};
  }
  results.push({camera,...scores});
}
const load=JSON.parse(readFileSync(`.codex-run/hideout-${stage}/result.json`));
writeFileSync(`.codex-run/hideout-${stage}/scores.json`,JSON.stringify({stage,...load,results},null,2));
console.log(JSON.stringify(results,null,2));
