import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector4 } from '@babylonjs/core/Maths/math.vector';
import { CASINO_ANCHORS, BLACKJACK_SEAT_OFFSETS, type Card, type CasinoState, type CasinoPrivateState, type SlotSymbol } from '../../shared/casino';

/** Draw the same four recognisable symbols on the physical cabinet's reel texture. */
export function drawSlotSymbol(ctx: CanvasRenderingContext2D, symbol: SlotSymbol, x: number) {
  ctx.save();ctx.translate(x,130);ctx.scale(1.8,1.8);
  if(symbol==='cherry') {
    ctx.strokeStyle='#486145';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-22,12);ctx.bezierCurveTo(-22,-20,10,-12,12,-42);ctx.moveTo(12,-42);ctx.quadraticCurveTo(10,-15,22,14);ctx.stroke();
    ctx.fillStyle='#697b43';ctx.beginPath();ctx.ellipse(3,-34,14,7,.5,0,Math.PI*2);ctx.fill();
    for(const [cx,cy] of [[-22,23],[22,25]]) {ctx.fillStyle='#a33f3c';ctx.beginPath();ctx.arc(cx,cy,17,0,Math.PI*2);ctx.fill();ctx.fillStyle='#e5957c';ctx.beginPath();ctx.ellipse(cx-5,cy-7,3,5,.6,0,Math.PI*2);ctx.fill();}
  } else if(symbol==='lemon') {
    ctx.fillStyle='#e0bc58';ctx.strokeStyle='#ba933b';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,2,32,22,-.5,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.strokeStyle='#f7e3a3';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-17,-2);ctx.quadraticCurveTo(-6,-14,8,-13);ctx.stroke();ctx.fillStyle='#64784a';ctx.beginPath();ctx.ellipse(23,-24,14,7,-.6,0,Math.PI*2);ctx.fill();
  } else if(symbol==='bar') {
    ctx.fillStyle='#253e34';ctx.fillRect(-51,-24,102,48);ctx.strokeStyle='#cbb781';ctx.lineWidth=2;ctx.strokeRect(-47,-20,94,40);ctx.fillStyle='#f1e5bc';ctx.font='bold 31px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('BAR',0,2);
  } else {ctx.fillStyle='#a4483d';ctx.font='bold 89px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('7',0,5);}
  ctx.restore();
}

/** Reuses meshes and at most 53 card materials; only receives the safe public projection. */
export class CasinoTableArt {
  private reducedMotion=false;
  setReducedMotion(reduced:boolean){this.reducedMotion=reduced;if(reduced)this.update(1);}
  private cards=new Map<string,Mesh>();
  private materials=new Map<string,StandardMaterial>();
  private targets=new Map<string,{x:number;z:number;startX:number;startZ:number;age:number}>();
  private chips=new Map<string,Mesh>();
  private highlights=new Map<number,Mesh>();
  private privateState:CasinoPrivateState={rouletteBets:[]};
  private state:CasinoState|null=null;
  private chipMaterial:StandardMaterial;
  private highlightMaterial:StandardMaterial;
  constructor(private scene:Scene) {
    this.chipMaterial=new StandardMaterial('Casino burgundy chips',scene);this.chipMaterial.specularColor=new Color3(.15,.15,.15);
    const chipTexture=new DynamicTexture('Ivory inlaid chip',{width:256,height:256},scene,false),ctx=chipTexture.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle='#a4483d';ctx.fillRect(0,0,256,256);ctx.strokeStyle='#f1e4be';ctx.lineWidth=7;ctx.beginPath();ctx.arc(128,128,87,0,Math.PI*2);ctx.stroke();
    for(let i=0;i<8;i++){const angle=i/8*Math.PI*2;ctx.lineWidth=17;ctx.beginPath();ctx.moveTo(128+Math.cos(angle)*108,128+Math.sin(angle)*108);ctx.lineTo(128+Math.cos(angle)*127,128+Math.sin(angle)*127);ctx.stroke();}
    ctx.fillStyle='#f1e4be';ctx.font='italic 96px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('M',128,135);chipTexture.update();this.chipMaterial.diffuseTexture=chipTexture;
    this.highlightMaterial=new StandardMaterial('Your roulette coverage',scene);this.highlightMaterial.diffuseColor=Color3.FromHexString('#d9bd75');this.highlightMaterial.emissiveColor=new Color3(.2,.15,.04);this.highlightMaterial.alpha=.38;
  }
  syncPrivate(value:CasinoPrivateState){this.privateState=value;if(this.state)this.sync(this.state);}
  update(seconds:number) {
    for(const[key,target]of this.targets){const mesh=this.cards.get(key)!;if(!mesh.isEnabled()||target.age>=.35)continue;
      target.age=Math.min(.35,target.age+(this.reducedMotion?1:seconds));const t=1-(1-target.age/.35)**3;
      mesh.position.x=target.startX+(target.x-target.startX)*t;mesh.position.z=target.startZ+(target.z-target.startZ)*t;
    }
  }
  private chip(key:string,x:number,z:number,stake:number,active:Set<string>) {
    active.add(key);let mesh=this.chips.get(key);
    if(!mesh){mesh=MeshBuilder.CreateCylinder(`casino-chip-${key}`,{diameter:.14,height:.035,tessellation:24,faceUV:[new Vector4(0,0,1,1),new Vector4(0,.45,.015,.55),new Vector4(0,0,1,1)]},this.scene);mesh.material=this.chipMaterial;this.chips.set(key,mesh);}
    mesh.scaling.y=Math.min(6,Math.max(1,stake/10));mesh.position.set(x,(key.startsWith('roulette')?1.225:1.155)+mesh.scaling.y*.0175,z);mesh.setEnabled(true);
  }
  private material(card:Card|null) {
    const key=card?`${card.rank}-${card.suit}`:'back';const existing=this.materials.get(key);if(existing)return existing;
    const texture=new DynamicTexture(`card-${key}`,{width:192,height:288},this.scene,false);
    const ctx=texture.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle=card?'#f4eedc':'#254535';ctx.fillRect(0,0,192,288);ctx.strokeStyle='#c2ad78';ctx.lineWidth=5;ctx.strokeRect(9,9,174,270);
    ctx.textAlign='center';ctx.textBaseline='middle';
    if(card) {
      const glyph={clubs:'♣',diamonds:'♦',hearts:'♥',spades:'♠'}[card.suit];ctx.fillStyle=card.suit==='diamonds'||card.suit==='hearts'?'#a33f3c':'#243a2e';
      ctx.font='bold 46px Georgia';ctx.fillText(card.rank,43,45);ctx.font='31px Georgia';ctx.fillText(glyph,43,88);ctx.font='100px Georgia';ctx.fillText(glyph,100,166);
    } else {ctx.strokeStyle='#9f935e';ctx.lineWidth=1;for(let i=-288;i<192;i+=18){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i+288,288);ctx.stroke();}ctx.fillStyle='#e5d9aa';ctx.font='italic 88px Georgia';ctx.fillText('M',96,145);}
    texture.update();const material=new StandardMaterial(`card-${key}`,this.scene);material.diffuseTexture=texture;material.specularColor=Color3.Black();material.emissiveColor=new Color3(.2,.2,.2);this.materials.set(key,material);return material;
  }
  sync(state:CasinoState) {
    this.state=state;const active=new Set<string>(),activeChips=new Set<string>();
    const put=(key:string,card:Card|null,x:number,z:number,order:number,dealX:number,dealZ:number)=>{
      active.add(key);let mesh=this.cards.get(key);
      if(!mesh){mesh=MeshBuilder.CreatePlane(`casino-card-${key}`,{width:.26,height:.38,sideOrientation:Mesh.DOUBLESIDE},this.scene);mesh.rotation.x=Math.PI/2;this.cards.set(key,mesh);}
      const material=this.material(card),target=this.targets.get(key);
      const changed=!mesh.isEnabled()||mesh.material!==material;
      if(changed||!target||target.x!==x||target.z!==z){
        const startX=changed?dealX:mesh.position.x,startZ=changed?dealZ:mesh.position.z;
        this.targets.set(key,{x,z,startX,startZ,age:this.reducedMotion?.35:0});mesh.position.set(this.reducedMotion?x:startX,1.17+order*.003,this.reducedMotion?z:startZ);
      }
      mesh.material=material;mesh.setEnabled(true);
    };
    for(const table of state.tables)if(table.game==='blackjack') {
      const anchor=CASINO_ANCHORS.find(a=>a.id===table.id)!;
      table.dealer.forEach((card,index)=>put(`${table.id}-dealer-${index}`,card,anchor.x+(index-(table.dealer.length-1)/2)*.21,anchor.z+.10,index,anchor.x,anchor.z+.24));
      for(const seat of table.seats){const offset=BLACKJACK_SEAT_OFFSETS[seat.seat];
        seat.hands.forEach((hand,hi)=>hand.cards.forEach((card,ci)=>put(`${table.id}-${seat.seat}-${hi}-${ci}`,card,anchor.x+offset.x*.74+(hi-(seat.hands.length-1)/2)*.45+(ci-(hand.cards.length-1)/2)*.11,anchor.z+offset.z*.48,ci,anchor.x,anchor.z+.24)));
        seat.hands.forEach((hand,hi)=>this.chip(`${table.id}-${seat.seat}-${hi}`,anchor.x+offset.x*.66+(hi-(seat.hands.length-1)/2)*.22,anchor.z+offset.z*.62,hand.stake,activeChips));
      }
    }
    const roulette=state.tables.find(table=>table.game==='roulette');
    const covered=new Set<number>();
    if(roulette){
      const bets=this.privateState.rouletteBets.filter(bet=>bet.roundId===roulette.roundId);
      const point=(number:number)=>number===0?{x:-7.055,z:19.005}:{x:-7.58+(number-1)%3*.53,z:19.175+Math.floor((number-1)/3)*.15};
      bets.forEach(({bet},index)=>{let x=0,z=0;for(const number of bet.numbers){covered.add(number);const p=point(number);x+=p.x;z+=p.z;}
        this.chip(`roulette-own-${index}`,x/bet.numbers.length+(index%3-1)*.04,z/bet.numbers.length,bet.stake,activeChips);
      });
      if(roulette.game==='roulette'&&roulette.betCount>bets.length)this.chip('roulette-others',-8.16,19.24,(roulette.betCount-bets.length)*10,activeChips);
      for(const number of covered){let mesh=this.highlights.get(number);if(!mesh){mesh=MeshBuilder.CreateGround(`roulette-coverage-${number}`,{width:number===0?1.55:.49,height:.135},this.scene);mesh.material=this.highlightMaterial;this.highlights.set(number,mesh);}const p=point(number);mesh.position.set(p.x,1.229,p.z);mesh.setEnabled(true);}
    }
    for(const[key,mesh]of this.chips)if(!activeChips.has(key))mesh.setEnabled(false);
    for(const[number,mesh]of this.highlights)if(!covered.has(number))mesh.setEnabled(false);
    for(const [key,mesh]of this.cards)if(!active.has(key))mesh.setEnabled(false);
  }
}
