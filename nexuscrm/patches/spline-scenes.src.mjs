// ════════════════════════════════════════════════════════════════════
// SPLINE COMMUNITY SCENES — 50 professional WebGL 3D scenes.
// Each rebuilds the aesthetic of a top Spline community design
// (the collections the owner approved: Interactive Design +
// Brand & Marketing) as real-time three.js running inside generated
// sites. No external scene files are embedded — these are original
// WebGL implementations in the same style families:
//   particles · liquid glass · liquid-gold typography · reactive orbs ·
//   cloner/boxes · scroll floating objects · retrofuturism · web3 cores ·
//   holographic earth.
// Scenes marked text:true render words (window.NX_SCENE_TEXT) with the
// SAME animation in any language — the site builder lets the owner type
// the words. All scenes are mouse-interactive, phone-scaled (Q factor,
// DPR already clamped by the boot head) and reduced-motion safe (the
// boot head exits early for prefers-reduced-motion users).
// Build: node patches/build-spline-scenes.mjs  (injects backend+frontend)
// ════════════════════════════════════════════════════════════════════

// shared snippets composed into bodies at build time
const MOUSE = `var MX=0,MY=0,TX=0,TY=0;addEventListener('pointermove',function(e){TX=(e.clientX/Math.max(1,innerWidth))*2-1;TY=(e.clientY/Math.max(1,innerHeight))*2-1;},{passive:true});`;
const Q = `var Q=(Math.min(innerWidth||1920,innerHeight||1080)<620)?0.55:1;`;
const TXTQ = `var TXT=String(window.NX_SCENE_TEXT||'__NXTX__');if(TXT==='__NXTX__')TXT='NEXUS';TXT=TXT.slice(0,30)||'NEXUS';`;
const SAMPLER = `function sampleText(s){var c=document.createElement('canvas');c.width=680;c.height=150;var g=c.getContext('2d');g.fillStyle='#fff';g.font='bold 92px system-ui,-apple-system,Segoe UI,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(s,340,78);var d=g.getImageData(0,0,680,150).data,p=[];for(var y=0;y<150;y+=2)for(var x=0;x<680;x+=2){if(d[(y*680+x)*4+3]>110)p.push([(x-340)/30,(75-y)/30]);}return p;}`;
const SCROLL = `var SCR=0;addEventListener('scroll',function(){var h=Math.max(1,document.body.scrollHeight-innerHeight);SCR=Math.min(1,Math.max(0,(window.scrollY||0)/h));},{passive:true});`;
const S = (parts) => parts.join('\n');

const SPLINE_SCENES = {

// ── A. PARTICLES (after "Particles 🌑" — the most-liked Spline community scene: 265K views · 9,495 likes · 73,714 remixes) ──
sp1:{name:'Particles Orbit (Spline)',theme:'space',desc:"The community's most-liked scene, rebuilt: a breathing particle sphere that reacts to your cursor.",body:S([Q,MOUSE,`var N=Math.round(5200*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),base=[];
for(var i=0;i<N;i++){var th=Math.random()*6.283,ph=Math.acos(2*Math.random()-1),r=13;var x=r*Math.sin(ph)*Math.cos(th),y=r*Math.cos(ph),z=r*Math.sin(ph)*Math.sin(th);base.push([x,y,z]);pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=z;var c=ac.clone().lerp(a2,Math.random());col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.16,vertexColors:true,transparent:true,opacity:0.95,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);
var core=new THREE.Mesh(new THREE.SphereGeometry(4.6,24,24),new THREE.MeshBasicMaterial({color:ac,transparent:true,opacity:0.14,blending:THREE.AdditiveBlending}));scene.add(core);
cam.position.set(0,0,38);`]),
tick:`MX+=(TX-MX)*0.06;MY+=(TY-MY)*0.06;pts.rotation.y+=0.0016;pts.rotation.x=MY*0.35;core.scale.setScalar(1+Math.sin(t*1.4)*0.07);
var p=geo.attributes.position.array;for(var i=0;i<base.length;i++){var b=base[i],w=1+Math.sin(t*1.6+b[1]*0.35)*0.035;p[i*3]=b[0]*w;p[i*3+1]=b[1]*w;p[i*3+2]=b[2]*w;}
geo.attributes.position.needsUpdate=true;cam.position.x=MX*4;cam.position.y=-MY*2.5;cam.lookAt(0,0,0);`},

sp2:{name:'Particle Wave Field',theme:'cyberpunk',desc:'A rippling field of light points — waves chase your cursor across the grid.',body:S([Q,MOUSE,`var NX=34,NZ=34,N=NX*NZ,geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3);
for(var i=0;i<N;i++){var gx=(i%NX)-NX/2,gz=Math.floor(i/NX)-NZ/2;pos[i*3]=gx*1.5;pos[i*3+1]=0;pos[i*3+2]=gz*1.5;var c=ac.clone().lerp(t3,Math.random());col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.28,vertexColors:true,transparent:true,opacity:0.9,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);cam.position.set(0,20,34);cam.lookAt(0,0,0);`]),
tick:`MX+=(TX-MX)*0.08;MY+=(TY-MY)*0.08;var wx=MX*24,wz=-MY*14,p=geo.attributes.position.array;
for(var i=0;i<N;i++){var gx=(i%NX)-NX/2,gz=Math.floor(i/NX)-NZ/2;var dx=gx*1.5-wx,dz=gz*1.5-wz,d=Math.sqrt(dx*dx+dz*dz);var w=Math.sin(t*2.2-d*0.55)*1.7*Math.max(0,1-d/22);p[i*3+1]=Math.sin(t*1.1+gx*0.28+gz*0.22)*1.15+w;}
geo.attributes.position.needsUpdate=true;cam.position.x=MX*5;cam.lookAt(0,0,0);`},

sp3:{name:'Particle Vortex',theme:'midnight-violet',desc:'A swirling particle tornado with a glowing core — premium dark motion.',body:S([Q,MOUSE,`var N=Math.round(3800*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),seed=[];
for(var i=0;i<N;i++){var h=Math.random();seed.push([h,Math.random()*6.283,2+h*15]);var c=a2.clone().lerp(ac,h);col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.2,vertexColors:true,transparent:true,opacity:0.85,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);
var core=new THREE.Mesh(new THREE.SphereGeometry(1.6,20,20),new THREE.MeshBasicMaterial({color:a2,transparent:true,opacity:0.5,blending:THREE.AdditiveBlending}));scene.add(core);cam.position.set(0,7,30);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var s=seed[i];var a=s[1]+t*(1.8+s[0]*2.2);p[i*3]=Math.cos(a)*s[2];p[i*3+1]=(s[0]-0.5)*26+Math.sin(t*0.7)*1.2;p[i*3+2]=Math.sin(a)*s[2];}
geo.attributes.position.needsUpdate=true;core.scale.setScalar(1+Math.sin(t*3)*0.25);pts.rotation.y=MX*0.5;cam.position.y=7+MY*4;cam.lookAt(0,0,0);`},

sp4:{name:'Particle Nebula Drift',theme:'midnight-violet',desc:'Layered nebula clouds drifting in deep space, parallaxing with your cursor.',body:S([Q,MOUSE,`function spriteTex(c1,c2){var c=document.createElement('canvas');c.width=c.height=128;var g=c.getContext('2d');var r=g.createRadialGradient(64,64,4,64,64,64);r.addColorStop(0,c1);r.addColorStop(0.5,c2);r.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=r;g.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);}
var tex=spriteTex('rgba(255,255,255,0.9)','rgba(180,150,255,0.28)'),tex2=spriteTex('rgba(255,255,255,0.85)','rgba(80,200,255,0.22)');
var layers=[];for(var L=0;L<3;L++){var n=Math.round((26-L*6)*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(n*3);
for(var i=0;i<n;i++){pos[i*3]=(Math.random()-0.5)*90;pos[i*3+1]=(Math.random()-0.5)*46;pos[i*3+2]=-L*26-(Math.random()*18);}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
var m=new THREE.Points(geo,new THREE.PointsMaterial({size:34-L*8,map:L===1?tex2:tex,transparent:true,opacity:0.34,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(m);layers.push(m);}
var stars=new THREE.BufferGeometry(),sp=new Float32Array(Math.round(500*Q)*3);for(var i=0;i<sp.length;i+=3){sp[i]=(Math.random()-0.5)*160;sp[i+1]=(Math.random()-0.5)*90;sp[i+2]=-30-Math.random()*120;}
stars.setAttribute('position',new THREE.BufferAttribute(sp,3));scene.add(new THREE.Points(stars,new THREE.PointsMaterial({size:0.5,color:0xffffff,transparent:true,opacity:0.8,depthWrite:false})));
cam.position.set(0,0,34);`]),
tick:`MX+=(TX-MX)*0.04;MY+=(TY-MY)*0.04;for(var L=0;L<layers.length;L++){layers[L].position.x=MX*(4+L*3);layers[L].position.y=-MY*(2+L*1.5);layers[L].rotation.z=Math.sin(t*0.05+L)*0.05;}`},

sp5:{name:'Particle Helix Flow',theme:'teal-aqua',desc:'Two intertwined particle streams flowing as a DNA-like helix of light.',body:S([Q,MOUSE,`var N=Math.round(2400*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),ph=[];
for(var i=0;i<N;i++){ph.push(Math.random());var c=(i%2===0)?ac:t3;col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.19,vertexColors:true,transparent:true,opacity:0.9,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);cam.position.set(0,0,36);`]),
tick:`MX+=(TX-MX)*0.06;MY+=(TY-MY)*0.06;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var u=ph[i];var a=u*22+t*(1.1+(u>0.5?0.12:0));var strand=i%2;var ang=a+strand*Math.PI;
p[i*3]=Math.cos(ang)*(9+Math.sin(u*12+t)*1.4);p[i*3+1]=(u-0.5)*46;p[i*3+2]=Math.sin(ang)*(9+Math.sin(u*12+t*0.8)*1.4);}
geo.attributes.position.needsUpdate=true;pts.rotation.y=MX*0.6;cam.position.y=MY*6;cam.lookAt(0,0,0);`},

sp6:{name:'Particle Network',theme:'cyberpunk',desc:"After the community's 'Particle AI Brain': glowing nodes with pulsing synapse links.",body:S([Q,MOUSE,`var n=Math.round(120*Q)+40,nodes=[],group=new THREE.Group();scene.add(group);
for(var i=0;i<n;i++){var v=new THREE.Vector3((Math.random()-0.5)*44,(Math.random()-0.5)*26,(Math.random()-0.5)*30);nodes.push({v,ph:Math.random()*6.283});
var s=new THREE.Mesh(new THREE.SphereGeometry(0.16+Math.random()*0.22,10,10),new THREE.MeshBasicMaterial({color:Math.random()<0.75?ac:t3}));s.position.copy(v);group.add(s);}
var lgeo=new THREE.BufferGeometry(),lpos=new Float32Array(n*n*3),lcol=new THREE.Float32BufferAttribute(new Array(n*n*3).fill(0),3);lgeo.setAttribute('position',new THREE.BufferAttribute(lpos,3));lgeo.setAttribute('color',lcol);
var lines=new THREE.LineSegments(lgeo,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:0.34,blending:THREE.AdditiveBlending}));group.add(lines);cam.position.set(0,0,40);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=lgeo.attributes.position.array,c=lgeo.attributes.color.array,k=0;
for(var i=0;i<nodes.length;i++){var a=nodes[i].v;a.x+=Math.sin(t*0.5+i)*0.006;a.y+=Math.cos(t*0.4+i*1.3)*0.006;}
for(var i=0;i<nodes.length;i++)for(var j=i+1;j<nodes.length;j++){var d=nodes[i].v.distanceTo(nodes[j].v);
if(d<9){var pu=0.4+0.6*Math.abs(Math.sin(t*2+i*0.7+j));p[k*3]=nodes[i].v.x;p[k*3+1]=nodes[i].v.y;p[k*3+2]=nodes[i].v.z;p[k*3+3]=nodes[j].v.x;p[k*3+4]=nodes[j].v.y;p[k*3+5]=nodes[j].v.z;
c[k*3]=c[k*3+1]=c[k*3+2]=0;c[k*3+3]=c[k*3+4]=c[k*3+5]=0;
var f=pu*(1-d/9);c[k*3]=ac.r*f;c[k*3+1]=ac.g*f;c[k*3+2]=ac.b*f;c[k*3+3]=t3.r*f;c[k*3+4]=t3.g*f;c[k*3+5]=t3.b*f;k+=2;}}
lgeo.setDrawRange(0,k*2);lgeo.attributes.position.needsUpdate=true;lgeo.attributes.color.needsUpdate=true;
group.rotation.y=MX*0.4;group.rotation.x=MY*0.25;`},

sp7:{name:'Particle Galaxy Disc',theme:'space',desc:'A flat spiral galaxy of 7,000 stars — tilt it with your cursor.',body:S([Q,MOUSE,`var N=Math.round(7000*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3);
for(var i=0;i<N;i++){var arm=i%3,a=(i/N)*10+arm*2.094,r=Math.pow(Math.random(),0.72)*52;
var x=Math.cos(a+ r*0.13)*r,z=Math.sin(a+r*0.13)*r,y=(Math.random()-0.5)*(4.5-r*0.05);
pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=z;var c=a2.clone().lerp(ac,r/52);col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var g=new THREE.Points(geo,new THREE.PointsMaterial({size:0.26,vertexColors:true,transparent:true,opacity:0.95,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(g);
var core=new THREE.Mesh(new THREE.SphereGeometry(3.2,20,20),new THREE.MeshBasicMaterial({color:0xfff2cc,transparent:true,opacity:0.35,blending:THREE.AdditiveBlending}));scene.add(core);cam.position.set(0,30,44);cam.lookAt(0,0,0);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;g.rotation.z+=0.0011;cam.position.x=MX*10;cam.position.y=30+MY*-8;cam.lookAt(0,0,0);core.scale.setScalar(1+Math.sin(t*2)*0.08);`},

sp8:{name:'Particle Rise',theme:'glass-dark',desc:'Columns of light particles rising like reversed rain — cursor bends them.',body:S([Q,MOUSE,`var N=Math.round(2600*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),seed=[];
for(var i=0;i<N;i++){seed.push([Math.random(),Math.random()]);var c=ac.clone().lerp(a2,Math.random());col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.2,vertexColors:true,transparent:true,opacity:0.8,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);cam.position.set(0,0,34);`]),
tick:`MX+=(TX-MX)*0.06;MY+=(TY-MY)*0.06;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var s=seed[i];var y=((s[0]+t*(0.03+s[1]*0.05))%1);p[i*3]=(s[1]-0.5)*56+Math.sin(t*0.8+i)*0.7+MX*10*y;p[i*3+1]=(y-0.5)*36;p[i*3+2]=(Math.sin(s[0]*6.28)*8);}
geo.attributes.position.needsUpdate=true;cam.position.y=MY*-4;cam.lookAt(0,0,0);`},

// ── B. LIQUID / GLASS / STREAMS (after "Reeded liquid glass — Prism hero" 143K views, "Liquid Glass" 51K, "Glass Knot Vortex" 16K, "Clarity Stream" 85K, "Motion Trails" 34K) ──
sp9:{name:'Liquid Gradient Mesh',theme:'lavender',desc:'The approved liquid-gradient hero: a flowing mesh of blended color that breathes.',body:S([Q,MOUSE,`var W=64,Hg=36,geo=new THREE.PlaneGeometry(120,62,W,Hg),colors=[];
geo.attributes.position&&0;
var colAttr=new Float32Array(geo.attributes.position.count*3);
for(var i=0;i<geo.attributes.position.count;i++)colors.push(Math.random());
geo.setAttribute('color',new THREE.BufferAttribute(colAttr,3));
var mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:0.85,side:THREE.DoubleSide}));scene.add(mesh);
cam.position.set(0,16,46);cam.lookAt(0,0,0);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=geo.attributes.position.array,c=geo.attributes.color.array,n=geo.attributes.position.count;
for(var i=0;i<n;i++){var ix=i%(W+1),iz=Math.floor(i/(W+1));var x=ix/W-0.5,z=iz/Hg-0.5;
p[i*3+2]=Math.sin(x*9+t*1.1)*2.6+Math.cos(z*7-t*0.9)*2.2+Math.sin((x+z)*12+t*0.6)*1.1;
var m=(Math.sin(x*5+t*0.7)+1)/2;var cc=a2.clone().lerp(ac,m).lerp(t3,(Math.cos(z*4+t*0.5)+1)/2*0.5);
c[i*3]=cc.r;c[i*3+1]=cc.g;c[i*3+2]=cc.b;}
geo.attributes.position.needsUpdate=true;geo.attributes.color.needsUpdate=true;
mesh.rotation.x=-0.35+MY*0.12;mesh.rotation.y=MX*0.18;`},

sp10:{name:'Glass Prism Bars',theme:'glass-dark',desc:"Reeded liquid-glass prisms (the community's 143K-view Prism hero), waving in light.",body:S([Q,MOUSE,`var bars=[],n=15;
for(var i=0;i<n;i++){var b=new THREE.Mesh(new THREE.BoxGeometry(1.5,40,1.5),new THREE.MeshPhysicalMaterial({color:0xffffff,transmission:0.86,roughness:0.12,thickness:2.4,transparent:true,opacity:0.9}));
b.position.x=(i-n/2)*2.35;scene.add(b);bars.push(b);}
scene.add(new THREE.DirectionalLight(0xffffff,2.2).translateX(12).translateY(14));
scene.add(new THREE.DirectionalLight(ac.getHex(),1.6).translateX(-16).translateY(-6));
var glow=new THREE.Mesh(new THREE.PlaneGeometry(70,50),new THREE.MeshBasicMaterial({color:ac,transparent:true,opacity:0.07,blending:THREE.AdditiveBlending}));glow.position.z=-9;scene.add(glow);
cam.position.set(0,0,34);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;for(var i=0;i<bars.length;i++){var b=bars[i];var ph=i*0.5;
b.scale.y=1+Math.sin(t*1.2+ph)*0.16;b.position.y=Math.sin(t*0.9+ph)*1.5;b.rotation.z=Math.sin(t*0.7+ph)*0.05;
b.position.z=Math.sin(t*0.6+ph*1.3)*1.4;}
glow.material.opacity=0.06+Math.sin(t*1.5)*0.02;cam.position.x=MX*5;cam.position.y=-MY*3;cam.lookAt(0,0,0);`},

sp11:{name:'Glass Knot Vortex',theme:'midnight-violet',desc:'A liquid-glass torus knot slowly turning around a glowing heart.',body:S([Q,MOUSE,`var knot=new THREE.Mesh(new THREE.TorusKnotGeometry(9,2.6,220,32),new THREE.MeshPhysicalMaterial({color:0xffffff,transmission:0.8,roughness:0.08,thickness:3,transparent:true,opacity:0.92}));
scene.add(knot);
var heart=new THREE.Mesh(new THREE.SphereGeometry(3,24,24),new THREE.MeshBasicMaterial({color:ac,transparent:true,opacity:0.35,blending:THREE.AdditiveBlending}));scene.add(heart);
scene.add(new THREE.DirectionalLight(0xffffff,2).translateX(14).translateY(10));
scene.add(new THREE.DirectionalLight(a2.getHex(),1.8).translateX(-12).translateY(-8));
cam.position.set(0,0,40);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;knot.rotation.y=t*0.22+MX*0.7;knot.rotation.x=0.5+MY*0.4;heart.scale.setScalar(1+Math.sin(t*2.1)*0.12);`},

sp12:{name:'Liquid Metal Blob',theme:'sunset',desc:'A molten metallic blob deforming forever — liquid metal in zero gravity.',body:S([Q,MOUSE,`var geo=new THREE.IcosahedronGeometry(9,5),pos=geo.attributes.position,orig=pos.array.slice();
var blob=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:ac.getHex(),metalness:1,roughness:0.24,flatShading:false}));
scene.add(blob);
var l1=new THREE.PointLight(0xffffff,140,120);l1.position.set(18,14,20);scene.add(l1);
var l2=new THREE.PointLight(a2.getHex(),110,120);l2.position.set(-18,-10,14);scene.add(l2);
var l3=new THREE.PointLight(t3.getHex(),80,120);l3.position.set(0,18,-16);scene.add(l3);
cam.position.set(0,0,32);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var a=pos.array;
for(var i=0;i<a.length;i+=3){var x=orig[i],y=orig[i+1],z=orig[i+2];var d=1+Math.sin(x*0.7+t*1.5)*0.12+Math.sin(y*0.9-t*1.1)*0.1+Math.cos(z*0.8+t*0.9)*0.1;
a[i]=x*d;a[i+1]=y*d;a[i+2]=z*d;}
pos.needsUpdate=true;blob.rotation.y=t*0.24+MX*0.8;blob.rotation.x=Math.sin(t*0.3)*0.3+MY*0.5;`},

sp13:{name:'Glass Orbs Cluster',theme:'teal-aqua',desc:'A float of glass spheres with glowing cores, drifting around your cursor.',body:S([Q,MOUSE,`var orbs=[];
for(var i=0;i<14;i++){var g=new THREE.Group();
var shell=new THREE.Mesh(new THREE.SphereGeometry(1.6+Math.random()*1.8,28,28),new THREE.MeshPhysicalMaterial({color:0xffffff,transmission:0.9,roughness:0.05,thickness:1.5,transparent:true}));
var core=new THREE.Mesh(new THREE.SphereGeometry(0.5,14,14),new THREE.MeshBasicMaterial({color:Math.random()<0.5?ac:t3,transparent:true,opacity:0.85,blending:THREE.AdditiveBlending}));
g.add(shell);g.add(core);g.position.set((Math.random()-0.5)*40,(Math.random()-0.5)*22,(Math.random()-0.5)*18);
g.userData={ph:Math.random()*6.283,r:2+Math.random()*4};scene.add(g);orbs.push(g);}
scene.add(new THREE.DirectionalLight(0xffffff,2).translateX(10).translateY(12).translateZ(8));
cam.position.set(0,0,36);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;for(var i=0;i<orbs.length;i++){var o=orbs[i],u=o.userData;
o.position.x+=Math.cos(t*0.4+u.ph)*0.012+(MX*10-o.position.x)*0.004;o.position.y+=Math.sin(t*0.5+u.ph)*0.012+(-MY*6-o.position.y)*0.004;
o.children[1].scale.setScalar(1+Math.sin(t*2+u.ph)*0.3);o.rotation.y+=0.004;}`},

sp14:{name:'Clarity Stream',theme:'teal-aqua',desc:"After the community's 'Clarity Stream' (85K views): ribbons of light flowing through space.",body:S([Q,MOUSE,`var N=Math.round(3200*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),seed=[];
for(var i=0;i<N;i++){seed.push([Math.random(),Math.random()]);var c=ac.clone().lerp(t3,Math.random());col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.17,vertexColors:true,transparent:true,opacity:0.75,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);cam.position.set(0,0,38);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var s=seed[i];var u=(s[0]+t*0.05*(0.5+s[1]))%1;var lane=Math.floor(s[1]*5)-2;
var x=(u-0.5)*90;var y=lane*2.6+Math.sin(u*14+s[1]*6.28)*1.8;var z=lane*3+Math.cos(u*10+s[0]*6.28)*2.4;
p[i*3]=x;p[i*3+1]=y;p[i*3+2]=z;}
geo.attributes.position.needsUpdate=true;pts.rotation.z=MX*0.1;cam.position.y=MY*-4;cam.lookAt(0,0,0);`},

sp15:{name:'Motion Trails',theme:'cyberpunk',desc:"After 'Motion Trails' (34K views): orbiting comets drawing fading light tails.",body:S([Q,MOUSE,`var comets=[];var TRAIL=90;
for(var c=0;c<5;c++){var geo=new THREE.BufferGeometry(),pos=new Float32Array(TRAIL*3),col=new Float32Array(TRAIL*3);
var cc=[ac,a2,t3,ac,a2][c];for(var i=0;i<TRAIL;i++){var f=1-i/TRAIL;col[i*3]=cc.r*f;col[i*3+1]=cc.g*f;col[i*3+2]=cc.b*f;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var trail=new THREE.Points(geo,new THREE.PointsMaterial({size:0.5,vertexColors:true,transparent:true,opacity:0.85,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(trail);
var head=new THREE.Mesh(new THREE.SphereGeometry(0.42,12,12),new THREE.MeshBasicMaterial({color:cc}));scene.add(head);
comets.push({trail,head,geo,a:Math.random()*6.283,sp:0.5+Math.random()*0.7,r:8+Math.random()*13,y:(Math.random()-0.5)*16,ph:Math.random()*6.283});}
cam.position.set(0,0,38);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;for(var c=0;c<comets.length;c++){var K=comets[c];K.a+=0.012*K.sp;
var hx=Math.cos(K.a)*K.r,hy=K.y+Math.sin(t*0.8+K.ph)*2,hz=Math.sin(K.a)*K.r;K.head.position.set(hx,hy,hz);
var p=K.geo.attributes.position.array;for(var i=TRAIL-1;i>0;i--){p[i*3]=p[(i-1)*3];p[i*3+1]=p[(i-1)*3+1];p[i*3+2]=p[(i-1)*3+2];}
p[0]=hx;p[1]=hy;p[2]=hz;K.geo.attributes.position.needsUpdate=true;}
cam.position.x=MX*5;cam.position.y=-MY*3;cam.lookAt(0,0,0);`},

sp16:{name:'Aurora Silk',theme:'lavender',desc:'Silky aurora ribbons flowing in the dark — calm premium motion.',body:S([Q,MOUSE,`var ribbons=[];
for(var r=0;r<6;r++){var geo=new THREE.PlaneGeometry(90,7,90,1);
var tex=(function(){var c=document.createElement('canvas');c.width=64;c.height=8;var g=c.getContext('2d');var gr=g.createLinearGradient(0,0,0,8);gr.addColorStop(0,'rgba(255,255,255,0)');gr.addColorStop(0.5,'rgba(255,255,255,0.9)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,8);return new THREE.CanvasTexture(c);})();
var m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:tex,color:[ac,a2,t3][r%3].getHex(),transparent:true,opacity:0.3,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,depthWrite:false}));
m.position.y=(r-2.5)*3.4;m.position.z=-r*3;scene.add(m);ribbons.push({m,geo,ph:r*1.1});}
cam.position.set(0,0,40);`]),
tick:`MX+=(TX-MX)*0.04;MY+=(TY-MY)*0.04;for(var r=0;r<ribbons.length;r++){var R=ribbons[r],p=R.geo.attributes.position.array;
for(var i=0;i<p.length;i+=3){var ix=(i/3)%91;p[i*1+1]=Math.sin(ix*0.16+t*0.9+R.ph)*2.6+Math.cos(ix*0.07-t*0.6+R.ph)*2.0;}
R.geo.attributes.position.needsUpdate=true;R.m.rotation.z=Math.sin(t*0.2+R.ph)*0.06+MX*0.08;R.m.position.y+=(-MY*3-R.m.position.y)*0.02;}`},

// ── C. TYPOGRAPHY — text:true scenes render YOUR words with the same animation (after "Distorting Typography" 177K views, "Hello Liquid Text", "Flying Text", "3D Text Animation Loop", plus the owner's #1 pick: liquid gold text) ──
sp17:{name:'Liquid Gold Text',theme:'sunset',text:true,desc:'⭐ Your #1 pick: words in flowing molten gold particles. Type any words — same animation.',body:S([Q,MOUSE,TXTQ,SAMPLER,`var pts2=sampleText(TXT),N=pts2.length*Math.round(2.2*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),base=[];
var g1=new THREE.Color('#fff3c4'),g2=new THREE.Color('#f5b942'),g3=new THREE.Color('#9a5b0a');
for(var i=0;i<N;i++){var s=pts2[i%pts2.length];base.push([s[0],s[1],(Math.random()-0.5)*1.6]);
var m=Math.random();var c=m<0.6?g2.clone().lerp(g1,m/0.6):g2.clone().lerp(g3,(m-0.6)/0.4);
col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.34,vertexColors:true,transparent:true,opacity:0.95,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);
var shine=new THREE.Mesh(new THREE.PlaneGeometry(80,40),new THREE.MeshBasicMaterial({color:0xf5b942,transparent:true,opacity:0.05,blending:THREE.AdditiveBlending}));shine.position.z=-10;scene.add(shine);
cam.position.set(0,0,30);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var b=base[i];var w=1+Math.sin(t*2+b[0]*1.2)*0.10+Math.sin(t*1.3+b[1]*2)*0.07;
p[i*3]=b[0]*w;p[i*3+1]=b[1]*w+Math.sin(t*1.8+b[0]*0.9)*0.14;p[i*3+2]=b[2]+Math.sin(t*2.4+b[0]*1.7)*0.4;}
geo.attributes.position.needsUpdate=true;pts.rotation.y=Math.sin(t*0.4)*0.12+MX*0.22;pts.rotation.x=MY*0.12;shine.material.opacity=0.04+Math.sin(t*1.2)*0.02;`},

sp18:{name:'Liquid Chrome Text',theme:'slate-blue',text:true,desc:'Words in flowing liquid chrome — cool silver-blue with specular sparkles.',body:S([Q,MOUSE,TXTQ,SAMPLER,`var pts2=sampleText(TXT),N=pts2.length*Math.round(2.2*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),base=[],spark=[];
var c1=new THREE.Color('#ffffff'),c2=new THREE.Color('#9fc5e8'),c3=new THREE.Color('#2c5aa0');
for(var i=0;i<N;i++){var s=pts2[i%pts2.length];base.push([s[0],s[1],(Math.random()-0.5)*1.5]);
var m=Math.random();var c=m<0.5?c2.clone().lerp(c1,m/0.5):c2.clone().lerp(c3,(m-0.5)/0.5);
if(Math.random()<0.03){c=c1.clone();spark.push(i);}
col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.32,vertexColors:true,transparent:true,opacity:0.95,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);
cam.position.set(0,0,30);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var b=base[i];var w=1+Math.sin(t*1.6+b[1]*2.4)*0.08;
p[i*3]=b[0]*w;p[i*3+1]=b[1]+Math.cos(t*2+b[0]*1.3)*0.12;p[i*3+2]=b[2]+Math.sin(t*2.8+b[0]*2.1)*0.3;}
for(var k=0;k<spark.length;k++){var i2=spark[k];p[i2*3]+=Math.sin(t*7+k)*0.05;p[i2*3+1]+=Math.cos(t*6+k*1.3)*0.05;}
geo.attributes.position.needsUpdate=true;pts.rotation.y=Math.sin(t*0.5)*0.15+MX*0.25;pts.rotation.x=MY*0.12;`},

sp19:{name:'Distorting Text Wave',theme:'midnight-violet',text:true,desc:"After the 177K-view 'Distorting Typography': words rippling through a wave field.",body:S([Q,MOUSE,TXTQ,SAMPLER,`var pts2=sampleText(TXT),N=pts2.length*Math.round(2*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),base=[];
for(var i=0;i<N;i++){var s=pts2[i%pts2.length];base.push([s[0],s[1],0]);
var c=ac.clone().lerp(a2,Math.random());col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.3,vertexColors:true,transparent:true,opacity:0.9,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);
cam.position.set(0,0,28);`]),
tick:`MX+=(TX-MX)*0.06;MY+=(TY-MY)*0.06;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var b=base[i];var wv=Math.sin(b[0]*0.55-t*2.4);
p[i*3]=b[0]+wv*1.5;p[i*3+1]=b[1]+Math.sin(b[0]*0.8-t*2)*0.8;p[i*3+2]=wv*3.4;}
geo.attributes.position.needsUpdate=true;pts.rotation.y=MX*0.3;pts.rotation.x=MY*0.15;`},

sp20:{name:'Flying Text Orbit',theme:'space',text:true,desc:"After 'Flying Text': your words orbiting through space on an endless loop.",body:S([Q,MOUSE,TXTQ,SAMPLER,`var pts2=sampleText(TXT),N=pts2.length*Math.round(1.6*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),base=[];
for(var i=0;i<N;i++){var s=pts2[i%pts2.length];var a=Math.random()*6.283,r=15+Math.random()*7;
base.push([Math.cos(a)*r,s[0]*0.9,Math.sin(a)*r]);
var c=a2.clone().lerp(ac,Math.random());col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.3,vertexColors:true,transparent:true,opacity:0.85,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);
cam.position.set(0,0,44);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var b=base[i];var yy=b[1];var rot=t*0.5;var ca=Math.cos(rot),sa=Math.sin(rot);
p[i*3]=b[0]*ca-b[2]*sa;p[i*3+1]=yy+Math.sin(t*1.2+i*0.05)*0.5;p[i*3+2]=b[0]*sa+b[2]*ca;}
geo.attributes.position.needsUpdate=true;cam.position.x=MX*7;cam.position.y=-MY*4;cam.lookAt(0,0,0);`},

sp21:{name:'Neon Text Grid',theme:'cyberpunk',text:true,desc:'Your words in glowing neon particles above an infinite grid floor.',body:S([Q,MOUSE,TXTQ,SAMPLER,`var pts2=sampleText(TXT),N=pts2.length*Math.round(2*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),base=[];
for(var i=0;i<N;i++){var s=pts2[i%pts2.length];base.push([s[0],s[1]+6,0]);
var c=Math.random()<0.7?ac:t3;col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.3,vertexColors:true,transparent:true,opacity:0.95,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);
var grid=new THREE.GridHelper(160,60,ac.getHex(),0x223344);grid.position.y=-7;scene.add(grid);
var glow=new THREE.Mesh(new THREE.PlaneGeometry(70,26),new THREE.MeshBasicMaterial({color:ac,transparent:true,opacity:0.06,blending:THREE.AdditiveBlending}));glow.position.set(0,6,-4);scene.add(glow);
cam.position.set(0,2,30);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var b=base[i];p[i*3]=b[0];p[i*3+1]=b[1]+Math.sin(t*2.2+b[0]*1.1)*0.22+0.06*Math.sin(t*9+i);p[i*3+2]=b[2];}
geo.attributes.position.needsUpdate=true;grid.position.z=(t*4)%2.6-1.3;pts.rotation.y=MX*0.15;cam.position.y=2+MY*2;cam.lookAt(0,4,0);`},

sp22:{name:'Text Rain',theme:'glass-dark',text:true,desc:'Your words falling as gentle luminous rain, looping forever.',body:S([Q,MOUSE,TXTQ,SAMPLER,`var pts2=sampleText(TXT),cols=Math.round(10*Q)+5,geo=new THREE.BufferGeometry(),N=pts2.length*cols,pos=new Float32Array(N*3),col=new Float32Array(N*3),seed=[];
for(var c=0;c<cols;c++)for(var i=0;i<pts2.length;i++){var s=pts2[i];var cx=(c/(cols-1)-0.5)*70;
seed.push([s[0]+cx,s[1],Math.random()]);
var cc=ac.clone().lerp(a2,Math.random());col[seed.length*3-3]=cc.r;col[seed.length*3-2]=cc.g;col[seed.length*3-1]=cc.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.22,vertexColors:true,transparent:true,opacity:0.7,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);
cam.position.set(0,0,40);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var s=seed[i];var y=((s[2]+t*0.04)%1);p[i*3]=s[0]+Math.sin(t*0.6+i*0.1)*0.5;p[i*3+1]=(0.5-y)*46;p[i*3+2]=(s[2]-0.5)*20;}
geo.attributes.position.needsUpdate=true;cam.position.x=MX*6;cam.lookAt(0,0,0);`},

sp23:{name:'Text Morph Rings',theme:'teal-aqua',text:true,desc:'Your words pulsing outward as rings of particles — a breathing message.',body:S([Q,MOUSE,TXTQ,SAMPLER,`var pts2=sampleText(TXT),N=pts2.length*Math.round(2*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),base=[];
for(var i=0;i<N;i++){var s=pts2[i%pts2.length];base.push([s[0],s[1],0]);
var c=ac.clone().lerp(t3,Math.random());col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var pts=new THREE.Points(geo,new THREE.PointsMaterial({size:0.28,vertexColors:true,transparent:true,opacity:0.85,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(pts);
cam.position.set(0,0,30);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var b=base[i];var r=Math.sqrt(b[0]*b[0]+b[1]*b[1]);var pu=1+Math.sin(t*1.6-r*0.22)*0.16;
p[i*3]=b[0]*pu;p[i*3+1]=b[1]*pu;p[i*3+2]=Math.sin(t*1.6-r*0.22)*1.6;}
geo.attributes.position.needsUpdate=true;pts.rotation.y=MX*0.2;pts.rotation.x=MY*0.1;`},

sp24:{name:'Golden Block Text',theme:'sunset',text:true,desc:'Your words as solid golden 3D blocks, turning slowly in studio light.',body:S([Q,MOUSE,TXTQ,`function textPlane(txt,fill,stroke){var c=document.createElement('canvas');c.width=680;c.height=150;var g=c.getContext('2d');
g.font='bold 92px system-ui,-apple-system,Segoe UI,sans-serif';g.textAlign='center';g.textBaseline='middle';
var gr=g.createLinearGradient(0,30,0,120);gr.addColorStop(0,'#ffe9a8');gr.addColorStop(0.5,'#f5b942');gr.addColorStop(1,'#b8730d');
g.fillStyle=gr;g.fillText(txt,340,78);if(stroke){g.lineWidth=3;g.strokeStyle=stroke;g.strokeText(txt,340,78);}
return new THREE.CanvasTexture(c);}
var grp=new THREE.Group();scene.add(grp);
var front=new THREE.Mesh(new THREE.PlaneGeometry(24,5.3),new THREE.MeshBasicMaterial({map:textPlane(TXT),transparent:true}));
var back=front.clone();back.position.z=-1.2;back.rotation.y=Math.PI;grp.add(front);grp.add(back);
var l1=new THREE.Mesh(new THREE.PlaneGeometry(24,5.3),new THREE.MeshBasicMaterial({color:0x9a5b0a,transparent:true,opacity:0.5}));
for(var s2=0;s2<6;s2++){var side=new THREE.Mesh(new THREE.PlaneGeometry(0.2,5.3),new THREE.MeshBasicMaterial({color:0xc98a1e}));
side.position.set(-12+s2*4.8,0,-0.6);side.rotation.y=Math.PI/2;grp.add(side);}
var spark=new THREE.BufferGeometry(),sp=new Float32Array(Math.round(300*Q)*3);
for(var i=0;i<sp.length;i+=3){sp[i]=(Math.random()-0.5)*40;sp[i+1]=(Math.random()-0.5)*20;sp[i+2]=(Math.random()-0.5)*14;}
spark.setAttribute('position',new THREE.BufferAttribute(sp,3));
grp.add(new THREE.Points(spark,new THREE.PointsMaterial({size:0.16,color:0xffd27a,transparent:true,opacity:0.7,depthWrite:false,blending:THREE.AdditiveBlending})));
front.position.z=0.61;back.position.z=-0.61;cam.position.set(0,0,30);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;grp.rotation.y=Math.sin(t*0.5)*0.4+MX*0.5;grp.rotation.x=MY*0.2;
var p=spark.attributes.position.array;for(var i=1;i<p.length;i+=3){p[i]+=0.01;if(p[i]>10)p[i]=-10;}
spark.attributes.position.needsUpdate=true;`},

// ── D. ORBS (after "Reactive Orb" 84K views · 2.3K likes, "Gravitational Sphere", "The Eternal ARC" 21K) ──
sp25:{name:'Reactive Orb',theme:'cyberpunk',desc:"After the community's 'Reactive Orb' (84K views): a living sphere of light that leans toward your cursor.",body:S([Q,MOUSE,`var N=Math.round(3000*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),base=[];
for(var i=0;i<N;i++){var th=Math.random()*6.283,ph=Math.acos(2*Math.random()-1),r=9;
base.push([r*Math.sin(ph)*Math.cos(th),r*Math.cos(ph),r*Math.sin(ph)*Math.sin(th)]);
var c=ac.clone().lerp(t3,Math.random());col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var shell=new THREE.Points(geo,new THREE.PointsMaterial({size:0.15,vertexColors:true,transparent:true,opacity:0.95,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(shell);
var core=new THREE.Mesh(new THREE.SphereGeometry(4.2,28,28),new THREE.MeshBasicMaterial({color:ac,transparent:true,opacity:0.22,blending:THREE.AdditiveBlending}));scene.add(core);
for(var r2=0;r2<2;r2++){var ring=new THREE.Mesh(new THREE.TorusGeometry(13+r2*2.5,0.06,8,120),new THREE.MeshBasicMaterial({color:r2?t3:a2,transparent:true,opacity:0.5}));
ring.rotation.x=1.2+r2*0.5;scene.add(ring);}
cam.position.set(0,0,36);`]),
tick:`MX+=(TX-MX)*0.07;MY+=(TY-MY)*0.07;var p=geo.attributes.position.array;
var lx=MX*16,ly=-MY*9;
for(var i=0;i<N;i++){var b=base[i];var d=Math.sqrt((b[0]-lx)*(b[0]-lx)+(b[1]-ly)*(b[1]-ly)+(b[2])*(b[2]));
var pull=Math.max(0,1-d/22)*3.2;
p[i*3]=b[0]+(lx-b[0])*pull/22;p[i*3+1]=b[1]+(ly-b[1])*pull/22;p[i*3+2]=b[2]*(1+pull*0.05);}
geo.attributes.position.needsUpdate=true;core.scale.setScalar(1+Math.sin(t*1.8)*0.08);
scene.children.forEach(function(ch,idx){if(ch.geometry&&ch.geometry.type==='TorusGeometry'){ch.rotation.z=t*(0.3+idx*0.1);}});
cam.position.x=MX*3;cam.position.y=-MY*2;cam.lookAt(0,0,0);`},

sp26:{name:'Gravitational Sphere',theme:'space',desc:'A dense core with three tilting particle belts — gravity made visible.',body:S([Q,MOUSE,`var core=new THREE.Mesh(new THREE.SphereGeometry(5.4,36,36),new THREE.MeshStandardMaterial({color:ac.getHex(),metalness:0.85,roughness:0.3,emissive:ac.getHex(),emissiveIntensity:0.25}));
scene.add(core);
scene.add(new THREE.PointLight(0xffffff,120,90).translateY(14));
var belts=[];
for(var b=0;b<3;b++){var n=Math.round(900*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(n*3),col=new Float32Array(n*3);
for(var i=0;i<n;i++){var a=Math.random()*6.283,r=9.5+b*2.6+Math.random()*0.8;
pos[i*3]=Math.cos(a)*r;pos[i*3+1]=(Math.random()-0.5)*0.7;pos[i*3+2]=Math.sin(a)*r;
var c=[ac,a2,t3][b];col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var belt=new THREE.Points(geo,new THREE.PointsMaterial({size:0.16,vertexColors:true,transparent:true,opacity:0.8,depthWrite:false,blending:THREE.AdditiveBlending}));
belt.rotation.x=0.4+b*0.5;belt.rotation.z=b*0.9;scene.add(belt);belts.push(belt);}
cam.position.set(0,6,34);cam.lookAt(0,0,0);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;for(var b=0;b<belts.length;b++){belts[b].rotation.y=t*(0.3+b*0.12);
belts[b].rotation.x=0.4+b*0.5+Math.sin(t*0.4+b)*0.1+MY*0.2;}
core.rotation.y=t*0.3;cam.position.x=MX*5;cam.lookAt(0,0,0);`},

sp27:{name:'Plasma Orb',theme:'sunset',desc:'A pulsing plasma heart wrapped in an unstable energy skin.',body:S([Q,MOUSE,`var geo=new THREE.IcosahedronGeometry(8,4),pos=geo.attributes.position,orig=pos.array.slice();
var skin=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:ac,transparent:true,opacity:0.24,blending:THREE.AdditiveBlending,wireframe:false}));
scene.add(skin);
var wire=new THREE.Mesh(new THREE.IcosahedronGeometry(8.3,2),new THREE.MeshBasicMaterial({color:a2,wireframe:true,transparent:true,opacity:0.2}));scene.add(wire);
var heart=new THREE.Mesh(new THREE.SphereGeometry(4.6,24,24),new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:0.5,blending:THREE.AdditiveBlending}));scene.add(heart);
cam.position.set(0,0,32);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var a=pos.array;
for(var i=0;i<a.length;i+=3){var x=orig[i],y=orig[i+1],z=orig[i+2];
var d=1+Math.sin(x*0.9+t*2.2)*0.09+Math.sin(y*1.1-t*1.7)*0.08+Math.cos(z*0.7+t*2.6)*0.08;
a[i]=x*d;a[i+1]=y*d;a[i+2]=z*d;}
pos.needsUpdate=true;skin.material.opacity=0.2+Math.sin(t*2)*0.06;
heart.scale.setScalar(1+Math.sin(t*2.8)*0.16);wire.rotation.y=t*0.4;wire.rotation.x=Math.sin(t*0.3)*0.3;
skin.rotation.y=MX*0.5;skin.rotation.x=MY*0.3;`},

sp28:{name:'Chrome Orb Trio',theme:'graphite',desc:'Three mirrored spheres dancing in moving colored light.',body:S([Q,MOUSE,`var orbs=[];
for(var i=0;i<3;i++){var o=new THREE.Mesh(new THREE.SphereGeometry(5.4-i*0.9,40,40),new THREE.MeshStandardMaterial({color:0xffffff,metalness:1,roughness:0.12}));
o.position.x=(i-1)*11;scene.add(o);orbs.push(o);}
var l1=new THREE.PointLight(ac.getHex(),160,140),l2=new THREE.PointLight(a2.getHex(),150,140),l3=new THREE.PointLight(0xffffff,110,140);
scene.add(l1);scene.add(l2);scene.add(l3);scene.add(new THREE.AmbientLight(0xffffff,0.25));
cam.position.set(0,2,34);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var a1=t*0.9;
l1.position.set(Math.cos(a1)*26,Math.sin(a1*1.3)*14,Math.sin(a1)*20);
l2.position.set(Math.cos(a1+2.09)*26,Math.sin(a1*1.1+2)*14,Math.sin(a1+2.09)*20);
l3.position.set(Math.cos(a1+4.18)*26,Math.sin(a1*0.8+4)*14,Math.sin(a1+4.18)*20);
for(var i=0;i<orbs.length;i++){orbs[i].position.y=Math.sin(t*0.9+i*2)*2.2;orbs[i].rotation.y=t*0.2;}
cam.position.x=MX*4;cam.position.y=2-MY*2;cam.lookAt(0,0,0);`},

sp29:{name:'Eternal Arc',theme:'midnight-violet',desc:"After 'The Eternal ARC' (21K views): sweeping arcs of light orbiting forever.",body:S([Q,MOUSE,`var arcs=[];
for(var a2i=0;a2i<3;a2i++){var n=Math.round(700*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(n*3),col=new Float32Array(n*3);
for(var i=0;i<n;i++){var u=Math.random();var sweep=2.4;var ang=u*sweep+(a2i*2.094);var r=10+a2i*4.5+Math.random()*1.2;
pos[i*3]=Math.cos(ang)*r;pos[i*3+1]=(Math.random()-0.5)*(2.2-a2i*0.4);pos[i*3+2]=Math.sin(ang)*r;
var c=[ac,a2,t3][a2i];col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var arc=new THREE.Points(geo,new THREE.PointsMaterial({size:0.16,vertexColors:true,transparent:true,opacity:0.75,depthWrite:false,blending:THREE.AdditiveBlending}));
scene.add(arc);arcs.push(arc);}
var core=new THREE.Mesh(new THREE.SphereGeometry(2.2,20,20),new THREE.MeshBasicMaterial({color:ac,transparent:true,opacity:0.4,blending:THREE.AdditiveBlending}));scene.add(core);
cam.position.set(0,10,36);cam.lookAt(0,0,0);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;for(var a=0;a<arcs.length;a++){arcs[a].rotation.y=t*(0.5+a*0.17)*(a%2?-1:1);}
core.scale.setScalar(1+Math.sin(t*2.2)*0.2);cam.position.x=MX*5;cam.position.y=10-MY*4;cam.lookAt(0,0,0);`},

sp30:{name:'Satellite Swarm',theme:'slate-blue',desc:'A quiet planet wrapped in hundreds of orbiting satellites — tilt it with your cursor.',body:S([Q,MOUSE,`var planet=new THREE.Mesh(new THREE.SphereGeometry(6,32,32),new THREE.MeshStandardMaterial({color:ac.getHex(),metalness:0.6,roughness:0.35}));
scene.add(planet);
scene.add(new THREE.PointLight(0xffffff,120,120).translateX(20).translateY(10).translateZ(12));
scene.add(new THREE.AmbientLight(0xffffff,0.3));
var N=Math.round(420*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),orb=[];
for(var i=0;i<N;i++){var inc=Math.random()*Math.PI,r=9.5+Math.random()*9,ph2=Math.random()*6.283,sp2=0.2+Math.random()*0.5;
orb.push([inc,r,ph2,sp2,Math.random()<0.5?ac:a2]);}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var sats=new THREE.Points(geo,new THREE.PointsMaterial({size:0.22,vertexColors:true,transparent:true,opacity:0.9,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(sats);
cam.position.set(0,4,34);cam.lookAt(0,0,0);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=geo.attributes.position.array,c=geo.attributes.color.array;
for(var i=0;i<N;i++){var o=orb[i];var a=o[2]+t*o[3];
p[i*3]=Math.cos(a)*o[1];p[i*3+1]=Math.sin(a)*Math.sin(o[0])*o[1]*0.6;p[i*3+2]=Math.sin(a)*Math.cos(o[0])*o[1];
c[i*3]=o[4].r;c[i*3+1]=o[4].g;c[i*3+2]=o[4].b;}
geo.attributes.position.needsUpdate=true;geo.attributes.color.needsUpdate=true;
planet.rotation.y=t*0.15;sats.rotation.x=MY*0.4;sats.rotation.z=MX*0.3;`},

// ── E. BOXES / CLONER (after "Boxes Hover" 136K views · 4,220 likes — the 2nd most-liked scene, and Spline's Cloner Cube templates) ──
sp31:{name:'Boxes Hover Field',theme:'graphite',desc:"After 'Boxes Hover' (136K views · 4.2K likes): a field of boxes that rises toward your cursor.",body:S([Q,MOUSE,`var NX=16,NZ=9,boxes=[];
var mat=new THREE.MeshStandardMaterial({color:0xd7dde8,metalness:0.55,roughness:0.35});
for(var i=0;i<NX;i++)for(var j=0;j<NZ;j++){var b=new THREE.Mesh(new THREE.BoxGeometry(1.7,1.7,1.7),mat.clone());
b.position.set((i-NX/2)*2.15,0,(j-NZ/2)*2.15);scene.add(b);boxes.push(b);}
scene.add(new THREE.DirectionalLight(0xffffff,2.4).translateY(18).translateZ(10));
scene.add(new THREE.DirectionalLight(ac.getHex(),1.1).translateX(-14));
scene.add(new THREE.AmbientLight(0xffffff,0.35));
cam.position.set(0,14,26);cam.lookAt(0,0,0);`]),
tick:`MX+=(TX-MX)*0.09;MY+=(TY-MY)*0.09;
var wx=MX*19,wz=-MY*10+4;
for(var k=0;k<boxes.length;k++){var b=boxes[k];
var d=Math.sqrt((b.position.x-wx)*(b.position.x-wx)+(b.position.z-wz)*(b.position.z-wz));
var lift=Math.max(0,1-d/9);
var target=lift*3.4+Math.sin(t*1.2+b.position.x*0.4+b.position.z*0.3)*0.25;
b.position.y+=(target-b.position.y)*0.14;
var sc=1+lift*0.5;b.scale.x+=(sc-b.scale.x)*0.14;b.scale.y+=(sc-b.scale.y)*0.14;b.scale.z+=(sc-b.scale.z)*0.14;
b.material.emissive=undefined;
var em=lift*0.5;b.material.color.setRGB(0.84+em*0.16*ac.r,0.87+em*0.13*ac.g,0.91+em*0.09*ac.b);}
cam.position.x=MX*3;cam.position.y=14-MY*2;cam.lookAt(0,0,0);`},

sp32:{name:'Binary Cube Wall',theme:'cyberpunk',desc:"After Spline's 'Cloner Cube Binary': a wall of cubes appearing and disappearing in waves.",body:S([Q,MOUSE,`var NX=20,NY=11,cubes=[];
for(var i=0;i<NX;i++)for(var j=0;j<NY;j++){var c=new THREE.Mesh(new THREE.BoxGeometry(1.25,1.25,1.25),
new THREE.MeshStandardMaterial({color:((i+j)%2)?ac.getHex():t3.getHex(),metalness:0.4,roughness:0.4,emissive:((i+j)%2)?ac.getHex():t3.getHex(),emissiveIntensity:0.25}));
c.position.set((i-NX/2)*1.5,(j-NY/2)*1.5,0);c.scale.setScalar(0);scene.add(c);cubes.push(c);}
scene.add(new THREE.AmbientLight(0xffffff,0.5));
scene.add(new THREE.DirectionalLight(0xffffff,1.6).translateZ(12).translateY(8));
cam.position.set(0,0,26);`]),
tick:`MX+=(TX-MX)*0.06;MY+=(TY-MY)*0.06;var k=0;
for(var i=0;i<NX;i++)for(var j=0;j<NY;j++){var c=cubes[k++];
var v=Math.sin(t*2.2-i*0.42-j*0.31)+Math.sin(t*1.1+i*0.2-j*0.15);
var s=(v>0.55)?Math.min(1,(v-0.55)*2.4):0;
c.scale.x+=(s-c.scale.x)*0.2;c.scale.y=c.scale.x;c.scale.z=c.scale.x;
c.rotation.z=c.scale.x*MX*0.4;c.position.z=c.scale.x*(1+MY*1.5);}`},

sp33:{name:'Cloner City Drift',theme:'graphite',desc:"After Spline's 'Cloner City': a generated skyline drifting past in fog.",body:S([Q,MOUSE,`scene.fog=new THREE.Fog(0x0b0e14,26,95);
var city=new THREE.Group();scene.add(city);
for(var i=0;i<90;i++){var w=2+Math.random()*4,h=4+Math.random()*22;
var b=new THREE.Mesh(new THREE.BoxGeometry(w,h,w),new THREE.MeshStandardMaterial({color:0x9aa5b5,metalness:0.35,roughness:0.5}));
b.position.set((Math.random()-0.5)*90,h/2,(Math.random()-0.5)*90);
var win=new THREE.Mesh(new THREE.BoxGeometry(w*1.02,h*0.92,w*1.02),new THREE.MeshBasicMaterial({color:Math.random()<0.4?ac.getHex():a2.getHex(),transparent:true,opacity:0.13,wireframe:true}));
b.add(win);city.add(b);}
scene.add(new THREE.DirectionalLight(0xffffff,1.8).translateY(30).translateX(14));
scene.add(new THREE.AmbientLight(0xffffff,0.3));
cam.position.set(0,10,40);`]),
tick:`MX+=(TX-MX)*0.04;MY+=(TY-MY)*0.04;
var u=(t*0.02)%1;cam.position.x=-45+u*90+MX*6;cam.position.z=40-u*18;cam.position.y=10+MY*-4;cam.lookAt(cam.position.x+12,6,0);`},

sp34:{name:'Cube Matrix Spin',theme:'midnight-violet',desc:'A 5×5×5 lattice of cubes rotating in space — your cursor steers it.',body:S([Q,MOUSE,`var grp=new THREE.Group();scene.add(grp);var cubes=[];
for(var x=-2;x<=2;x++)for(var y=-2;y<=2;y++)for(var z=-2;z<=2;z++){
var c=new THREE.Mesh(new THREE.BoxGeometry(0.95,0.95,0.95),new THREE.MeshStandardMaterial({color:ac.getHex(),metalness:0.7,roughness:0.3,emissive:a2.getHex(),emissiveIntensity:0.08}));
c.position.set(x*2.1,y*2.1,z*2.1);grp.add(c);cubes.push(c);}
scene.add(new THREE.DirectionalLight(0xffffff,2).translateX(10).translateY(12).translateZ(8));
scene.add(new THREE.PointLight(t3.getHex(),90,80).translateX(-12));
scene.add(new THREE.AmbientLight(0xffffff,0.3));
cam.position.set(0,0,30);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;
grp.rotation.y+=(MX*0.8+0.1-grp.rotation.y)*0.04;grp.rotation.x+=(MY*0.6-grp.rotation.x)*0.04;
for(var i=0;i<cubes.length;i++){var c=cubes[i];var d=c.position.length();
c.scale.setScalar(0.7+0.3*Math.abs(Math.sin(t*1.4+d*0.5)));}`},

sp35:{name:'Cube Tunnel',theme:'cyberpunk',desc:'Neon-edged cubes rushing past at speed — a chromatic flythrough.',body:S([Q,MOUSE,`var cubes=[];
for(var i=0;i<44;i++){var z=-i*4.2;
var edge=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3,3,3)),new THREE.LineBasicMaterial({color:Math.random()<0.5?ac.getHex():t3.getHex(),transparent:true,opacity:0.8}));
edge.position.set((Math.random()-0.5)*7,(Math.random()-0.5)*7,z);scene.add(edge);cubes.push(edge);}
cam.position.set(0,0,6);`]),
tick:`MX+=(TX-MX)*0.06;MY+=(TY-MY)*0.06;
for(var i=0;i<cubes.length;i++){var c=cubes[i];c.position.z+=0.16;
if(c.position.z>8){c.position.z-=44*4.2;c.position.x=(Math.random()-0.5)*7;c.position.y=(Math.random()-0.5)*7;}
c.rotation.x+=0.01;c.rotation.y+=0.012;
c.material.opacity=0.35+0.45*Math.max(0,1-Math.abs(c.position.z)/60);}
cam.position.x=MX*2.2;cam.position.y=-MY*1.4;cam.rotation.z=MX*0.06;`},

// ── F. SCROLL / FLOATING (after "HOVER + SCROLL EFFECT" 120K views, "Zero gravity physics landing page", "Parallax Interactive Website", "Shape The Vibe", awwwards scroll objects) ──
sp36:{name:'Zero Gravity Objects',theme:'glass-dark',desc:"After 'Zero gravity physics landing page': solids floating in anti-gravity, dodging your cursor.",body:S([Q,MOUSE,`var objs=[];
var geos=[new THREE.TorusGeometry(2,0.7,18,42),new THREE.IcosahedronGeometry(2.1,0),new THREE.OctahedronGeometry(2.2,0),new THREE.ConeGeometry(1.6,3,20),new THREE.TorusKnotGeometry(1.6,0.5,80,16)];
for(var i=0;i<26;i++){var m=new THREE.Mesh(geos[i%geos.length],new THREE.MeshStandardMaterial({color:i%2?ac.getHex():a2.getHex(),metalness:0.75,roughness:0.28}));
m.position.set((Math.random()-0.5)*60,(Math.random()-0.5)*30,(Math.random()-0.5)*26);
m.userData={vx:(Math.random()-0.5)*0.02,vy:(Math.random()-0.5)*0.02,vz:(Math.random()-0.5)*0.01,rx:(Math.random()-0.5)*0.01,ry:(Math.random()-0.5)*0.01};
scene.add(m);objs.push(m);}
scene.add(new THREE.DirectionalLight(0xffffff,2.2).translateX(14).translateY(16).translateZ(10));
scene.add(new THREE.DirectionalLight(t3.getHex(),0.9).translateX(-16));
scene.add(new THREE.AmbientLight(0xffffff,0.3));
cam.position.set(0,0,44);`]),
tick:`MX+=(TX-MX)*0.06;MY+=(TY-MY)*0.06;
for(var i=0;i<objs.length;i++){var o=objs[i],u=o.userData;
o.position.x+=u.vx;o.position.y+=u.vy;o.position.z+=u.vz;o.rotation.x+=u.rx;o.rotation.y+=u.ry;
var dx=o.position.x-MX*30,dy=o.position.y+MY*16,d=Math.sqrt(dx*dx+dy*dy);
if(d<10&&d>0.01){u.vx+=dx/d*0.004;u.vy+=dy/d*0.004;}
u.vx*=0.985;u.vy*=0.985;u.vz*=0.985;
if(Math.abs(o.position.x)>32)u.vx*=-1;if(Math.abs(o.position.y)>17)u.vy*=-1;if(Math.abs(o.position.z)>14)u.vz*=-1;}`},

sp37:{name:'Scroll Float Parade',theme:'midnight-violet',desc:"After 'HOVER + SCROLL EFFECT' (120K views): the camera flies through objects as you scroll.",body:S([Q,MOUSE,SCROLL,`scene.fog=new THREE.Fog(0x0b0e14,20,110);
var objs=[];
var geos=[new THREE.TorusGeometry(2.4,0.8,18,42),new THREE.IcosahedronGeometry(2.4,0),new THREE.BoxGeometry(3,3,3),new THREE.OctahedronGeometry(2.6,0),new THREE.TorusKnotGeometry(1.8,0.55,90,16)];
for(var i=0;i<34;i++){var m=new THREE.Mesh(geos[i%geos.length],new THREE.MeshStandardMaterial({color:[ac,a2,t3][i%3].getHex(),metalness:0.7,roughness:0.3}));
m.position.set((Math.random()-0.5)*46,(Math.random()-0.5)*60,(Math.random()-0.5)*46-10);
m.userData={rx:(Math.random()-0.5)*0.014,ry:(Math.random()-0.5)*0.014};scene.add(m);objs.push(m);}
scene.add(new THREE.DirectionalLight(0xffffff,2).translateX(12).translateY(10).translateZ(14));
scene.add(new THREE.AmbientLight(0xffffff,0.35));
cam.position.set(0,26,30);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;
var prog=SCR>0?SCR:(t*0.012)%1;
var camY=30-prog*66;
for(var i=0;i<objs.length;i++){var o=objs[i];o.rotation.x+=o.userData.rx;o.rotation.y+=o.userData.ry;}
cam.position.set(MX*4,camY,30);cam.lookAt(MX*6,camY-14,0);`},

sp38:{name:'Deep Parallax Layers',theme:'space',desc:"After 'Parallax Interactive Website': three depth layers gliding at different speeds.",body:S([Q,MOUSE,`var layers=[];
for(var L=0;L<3;L++){var g=new THREE.Group(),n=10-L*2;
for(var i=0;i<n;i++){var s=1+Math.random()*(L+1)*1.4;
var m=new THREE.Mesh(new THREE.TorusGeometry(2*s,0.55*s,16,36),new THREE.MeshBasicMaterial({color:[t3,a2,ac][L].getHex(),transparent:true,opacity:0.16+L*0.1}));
m.position.set((Math.random()-0.5)*80,(Math.random()-0.5)*40,-L*22);m.rotation.x=Math.random();g.add(m);}
scene.add(g);layers.push(g);}
var stars=new THREE.BufferGeometry(),sp=new Float32Array(Math.round(400*Q)*3);
for(var i=0;i<sp.length;i+=3){sp[i]=(Math.random()-0.5)*180;sp[i+1]=(Math.random()-0.5)*100;sp[i+2]=-40-Math.random()*80;}
stars.setAttribute('position',new THREE.BufferAttribute(sp,3));
scene.add(new THREE.Points(stars,new THREE.PointsMaterial({size:0.4,color:0xffffff,transparent:true,opacity:0.6,depthWrite:false})));
cam.position.set(0,0,40);`]),
tick:`MX+=(TX-MX)*0.04;MY+=(TY-MY)*0.04;
for(var L=0;L<layers.length;L++){var f=(L+1)/layers.length;
layers[L].position.x=-MX*10*f+Math.sin(t*0.15+L)*1.2;layers[L].position.y=MY*6*f;
layers[L].rotation.z=t*0.02*(L+1);}`},

sp39:{name:'Shape The Vibe',theme:'lavender',desc:"After 'Shape The Vibe': forms morphing in and out of each other in soft light.",body:S([Q,MOUSE,`var shapes=[
new THREE.Mesh(new THREE.TorusKnotGeometry(6,1.7,160,24),new THREE.MeshStandardMaterial({color:ac.getHex(),metalness:0.85,roughness:0.25})),
new THREE.Mesh(new THREE.IcosahedronGeometry(7,1),new THREE.MeshStandardMaterial({color:a2.getHex(),metalness:0.85,roughness:0.25})),
new THREE.Mesh(new THREE.TorusGeometry(6,1.9,24,64),new THREE.MeshStandardMaterial({color:t3.getHex(),metalness:0.85,roughness:0.25}))];
for(var i=0;i<shapes.length;i++){shapes[i].scale.setScalar(0.001);scene.add(shapes[i]);}
scene.add(new THREE.DirectionalLight(0xffffff,2.4).translateX(12).translateY(14).translateZ(10));
scene.add(new THREE.PointLight(ac.getHex(),100,90).translateX(-14));
scene.add(new THREE.AmbientLight(0xffffff,0.3));
cam.position.set(0,0,34);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;
var cyc=(t*0.35)%shapes.length;
for(var i=0;i<shapes.length;i++){var d=cyc-i;var w=Math.max(0,1-Math.abs(d));
var target=(i===0&&cyc>shapes.length-0.5)?1-Math.abs(cyc-shapes.length):w;
var s=target*target*(3-2*target);
shapes[i].scale.x+=(s-shapes[i].scale.x)*0.06;shapes[i].scale.y=shapes[i].scale.x;shapes[i].scale.z=shapes[i].scale.x;
shapes[i].rotation.x=t*0.3+i;shapes[i].rotation.y=t*0.4+i;}
cam.position.x=MX*4;cam.position.y=-MY*2.5;cam.lookAt(0,0,0);`},

sp40:{name:'Levitating Slabs',theme:'graphite',desc:'Heavy stone slabs impossibly afloat — a calm, sculptural scene.',body:S([Q,MOUSE,`var slabs=[];
for(var i=0;i<7;i++){var w=7+Math.random()*9,h=0.9,d=5+Math.random()*6;
var s=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color:0xb9c2d0,metalness:0.25,roughness:0.6}));
s.position.set((Math.random()-0.5)*30,-14+i*4.6,(Math.random()-0.5)*16);
s.rotation.y=(Math.random()-0.5)*0.8;scene.add(s);slabs.push(s);}
var key=new THREE.SpotLight(0xffffff,300,120,0.5,0.5);key.position.set(0,40,26);scene.add(key);
scene.add(new THREE.DirectionalLight(ac.getHex(),0.7).translateX(-20));
scene.add(new THREE.AmbientLight(0xffffff,0.32));
var dust=new THREE.BufferGeometry(),dp=new Float32Array(Math.round(300*Q)*3);
for(var i=0;i<dp.length;i+=3){dp[i]=(Math.random()-0.5)*60;dp[i+1]=(Math.random()-0.5)*36;dp[i+2]=(Math.random()-0.5)*30;}
dust.setAttribute('position',new THREE.BufferAttribute(dp,3));
scene.add(new THREE.Points(dust,new THREE.PointsMaterial({size:0.14,color:0xffffff,transparent:true,opacity:0.35,depthWrite:false})));
cam.position.set(0,6,42);`]),
tick:`MX+=(TX-MX)*0.04;MY+=(TY-MY)*0.04;
for(var i=0;i<slabs.length;i++){var s=slabs[i];
s.position.y+=Math.sin(t*0.6+i*1.3)*0.008;s.rotation.y+=Math.sin(t*0.2+i)*0.0009;}
var p=dust.attributes.position.array;for(var i=1;i<p.length;i+=3){p[i]+=0.012;if(p[i]>18)p[i]=-18;}
dust.attributes.position.needsUpdate=true;
key.position.x=MX*20;cam.position.x=MX*5;cam.position.y=6-MY*3;cam.lookAt(0,-2,0);`},

// ── G. RETRO / CIRCUIT / NEON (after "Retrofuturism BG animation" 136K views, "Retrofuturistic circuit loop" 39K) ──
sp41:{name:'Retro Horizon',theme:'sunset',desc:"After 'Retrofuturism BG animation' (136K views): a synth sun setting over an endless grid.",body:S([Q,MOUSE,`scene.fog=new THREE.Fog(0x0b0e14,30,120);
var sun=new THREE.Mesh(new THREE.SphereGeometry(11,40,40),new THREE.MeshBasicMaterial({color:0xffb347}));
sun.position.set(0,7,-46);scene.add(sun);
var halo=new THREE.Mesh(new THREE.SphereGeometry(13.5,32,32),new THREE.MeshBasicMaterial({color:0xff6b6b,transparent:true,opacity:0.22,blending:THREE.AdditiveBlending}));halo.position.copy(sun.position);scene.add(halo);
var grid=new THREE.GridHelper(240,90,0xff6b6b,0x662244);scene.add(grid);
var stripes=[];
for(var i=0;i<5;i++){var st=new THREE.Mesh(new THREE.PlaneGeometry(24,0.85),new THREE.MeshBasicMaterial({color:0x0b0e14}));
st.position.set(0,3.2+i*1.7,-45.8);scene.add(st);stripes.push(st);}
cam.position.set(0,4,30);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;
grid.position.z=(t*6)%2.6;
for(var i=0;i<stripes.length;i++){stripes[i].position.y=3.2+i*1.7+Math.sin(t*0.5)*1.2;
stripes[i].scale.x=1+Math.sin(t*0.8+i)*0.05;}
halo.scale.setScalar(1+Math.sin(t*1.4)*0.05);
cam.position.x=MX*5;cam.position.y=4-MY*2;cam.lookAt(0,7,-30);`},

sp42:{name:'Circuit Pulse',theme:'cyberpunk',desc:"After 'Retrofuturistic circuit loop' (39K views): PCB traces with light pulses racing through them.",body:S([Q,MOUSE,`var paths=[];
for(var i=0;i<26;i++){var pts=[];var x=(Math.random()-0.5)*60,y=(Math.random()-0.5)*32;
pts.push(new THREE.Vector3(x,y,-6));
for(var seg=0;seg<4;seg++){if(Math.random()<0.5)x+=(Math.random()-0.5)*22;else y+=(Math.random()-0.5)*16;pts.push(new THREE.Vector3(x,y,-6));}
var geo=new THREE.BufferGeometry().setFromPoints(pts);
var line=new THREE.Line(geo,new THREE.LineDashedMaterial({color:[ac,t3,a2][i%3].getHex(),dashSize:2,gapSize:16,transparent:true,opacity:0.75}));
line.computeLineDistances();scene.add(line);paths.push(line);}
var nodes=[];
for(var i=0;i<40;i++){var n=new THREE.Mesh(new THREE.SphereGeometry(0.28,10,10),new THREE.MeshBasicMaterial({color:a2}));n.position.set((Math.random()-0.5)*60,(Math.random()-0.5)*32,-6);scene.add(n);nodes.push(n);}
cam.position.set(0,0,40);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;
for(var i=0;i<paths.length;i++){paths[i].material.gapSize=14+Math.sin(t*2+i*1.3)*10;paths[i].material.dashSize=2.4;}
for(var i=0;i<nodes.length;i++){var s=0.6+0.4*Math.sin(t*3+i*0.9);nodes[i].scale.setScalar(s);}
cam.position.x=MX*4;cam.position.y=-MY*2.4;cam.lookAt(0,0,-6);`},

sp43:{name:'Neon Skyline',theme:'midnight-violet',desc:'A night city of glowing windows flickering against a violet sky.',body:S([Q,MOUSE,`scene.fog=new THREE.Fog(0x0b0e14,30,110);
var city=new THREE.Group();scene.add(city);
for(var i=0;i<34;i++){var w=2.4+Math.random()*4.5,h=6+Math.random()*26;
var b=new THREE.Mesh(new THREE.BoxGeometry(w,h,w),new THREE.MeshStandardMaterial({color:0x1a2030,metalness:0.3,roughness:0.6}));
b.position.set((Math.random()-0.5)*90,h/2-8,(Math.random()-0.5)*60-10);
var win=new THREE.Mesh(new THREE.BoxGeometry(w*1.03,h*0.94,w*1.03),new THREE.MeshBasicMaterial({color:Math.random()<0.5?ac.getHex():t3.getHex(),transparent:true,opacity:0.2,wireframe:true}));
b.add(win);city.add(b);}
var moon=new THREE.Mesh(new THREE.SphereGeometry(3.4,24,24),new THREE.MeshBasicMaterial({color:0xe8edf5,transparent:true,opacity:0.85}));moon.position.set(14,18,-50);scene.add(moon);
scene.add(new THREE.AmbientLight(0xffffff,0.4));
cam.position.set(0,6,42);`]),
tick:`MX+=(TX-MX)*0.04;MY+=(TY-MY)*0.04;
city.children.forEach(function(b,i){if(b.children[0]){b.children[0].material.opacity=0.13+0.1*Math.abs(Math.sin(t*(0.6+(i%7)*0.2)+i));}});
cam.position.x=MX*6;cam.position.y=6-MY*3;cam.lookAt(0,8,-20);`},

sp44:{name:'Retro Light Tunnel',theme:'cyberpunk',desc:'Double chromatic light rings pulling you forward at warp speed.',body:S([Q,MOUSE,`var rings=[];
for(var i=0;i<36;i++){var geo=new THREE.RingGeometry(5.4,5.8,48);
var r=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:(i%2)?ac.getHex():t3.getHex(),transparent:true,opacity:0.75,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));
r.position.z=-i*5;r.rotation.z=i*0.12;scene.add(r);rings.push(r);}
cam.position.set(0,0,8);`]),
tick:`MX+=(TX-MX)*0.06;MY+=(TY-MY)*0.06;
for(var i=0;i<rings.length;i++){var r=rings[i];r.position.z+=0.22;
if(r.position.z>8){r.position.z-=36*5;}
r.rotation.z+=0.004;
var f=Math.max(0,1-Math.abs(r.position.z)/90);r.material.opacity=0.2+0.6*f;
r.scale.setScalar(1+Math.sin(t*2+i*0.4)*0.03);}
cam.position.x=MX*1.6;cam.position.y=-MY*1.1;cam.rotation.z=MX*0.08;`},

// ── H. WEB3 / COIN (after "Prism Coin" 19K views, "40+ crypto coins pack", the approved Web3 hero) ──
sp45:{name:'Prism Coin',theme:'sunset',desc:"After 'Prism Coin' (19K views): a minted metallic coin turning in sweeping light.",body:S([Q,MOUSE,`var coin=new THREE.Group();scene.add(coin);
var face=new THREE.Mesh(new THREE.CylinderGeometry(7,7,0.9,64),new THREE.MeshStandardMaterial({color:0xf5b942,metalness:1,roughness:0.22}));
coin.add(face);
var rim=new THREE.Mesh(new THREE.TorusGeometry(7,0.55,20,64),new THREE.MeshStandardMaterial({color:0xb8730d,metalness:1,roughness:0.3}));
rim.rotation.x=Math.PI/2;coin.add(rim);
var emboss=new THREE.Mesh(new THREE.TorusGeometry(4.6,0.35,16,48),new THREE.MeshStandardMaterial({color:0xffd27a,metalness:1,roughness:0.25}));
emboss.position.y=0.5;coin.add(emboss);
var l1=new THREE.PointLight(0xffffff,170,120);l1.position.set(16,12,18);scene.add(l1);
var l2=new THREE.PointLight(ac.getHex(),120,110);l2.position.set(-16,-8,12);scene.add(l2);
scene.add(new THREE.AmbientLight(0xffffff,0.3));
var sparks=new THREE.BufferGeometry(),sp=new Float32Array(Math.round(220*Q)*3);
for(var i=0;i<sp.length;i+=3){sp[i]=(Math.random()-0.5)*40;sp[i+1]=(Math.random()-0.5)*22;sp[i+2]=(Math.random()-0.5)*20;}
sparks.setAttribute('position',new THREE.BufferAttribute(sp,3));
scene.add(new THREE.Points(sparks,new THREE.PointsMaterial({size:0.15,color:0xffd27a,transparent:true,opacity:0.65,depthWrite:false,blending:THREE.AdditiveBlending})));
cam.position.set(0,0,26);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;
coin.rotation.y=t*0.7;coin.rotation.x=0.25+MY*0.2;
l1.position.x=16*Math.cos(t*0.9);l1.position.z=18*Math.sin(t*0.9);
var p=sparks.attributes.position.array;for(var i=1;i<p.length;i+=3){p[i]+=0.02;if(p[i]>11)p[i]=-11;}
sparks.attributes.position.needsUpdate=true;cam.position.x=MX*3;`},

sp46:{name:'Coin Constellation',theme:'graphite',desc:'A constellation of small metal coins orbiting in the dark — web3 energy.',body:S([Q,MOUSE,`var coins=[];
for(var i=0;i<40;i++){var c=new THREE.Mesh(new THREE.CylinderGeometry(0.9,0.9,0.16,24),new THREE.MeshStandardMaterial({color:i%3?0xd7dde8:0xf5b942,metalness:1,roughness:0.3}));
var a=Math.random()*6.283,inc=(Math.random()-0.5)*1.2,r=7+Math.random()*17;
c.userData={a,inc,r,sp:0.15+Math.random()*0.5,y:(Math.random()-0.5)*18};
scene.add(c);coins.push(c);}
scene.add(new THREE.DirectionalLight(0xffffff,2.4).translateX(14).translateY(12).translateZ(16));
scene.add(new THREE.PointLight(ac.getHex(),110,110).translateX(-14));
scene.add(new THREE.AmbientLight(0xffffff,0.3));
cam.position.set(0,3,36);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;
for(var i=0;i<coins.length;i++){var c=coins[i],u=c.userData;var a=u.a+t*u.sp;
c.position.set(Math.cos(a)*u.r,u.y+Math.sin(t*0.7+i)*1.2,Math.sin(a)*u.r);
c.rotation.x=1.57+Math.sin(a*2)*0.3;c.rotation.y=a;}
cam.position.x=MX*4;cam.position.y=3-MY*2;cam.lookAt(0,0,0);`},

sp47:{name:'Web3 Energy Core',theme:'space',desc:'The approved Web3 hero: a dark energy core with wireframe shell, orbit rings and halo.',body:S([Q,MOUSE,`var core=new THREE.Mesh(new THREE.SphereGeometry(5.2,32,32),new THREE.MeshBasicMaterial({color:ac,transparent:true,opacity:0.28,blending:THREE.AdditiveBlending}));scene.add(core);
var shell=new THREE.Mesh(new THREE.IcosahedronGeometry(7.6,1),new THREE.MeshBasicMaterial({color:a2,wireframe:true,transparent:true,opacity:0.32}));scene.add(shell);
var rings=[];
for(var r=0;r<2;r++){var ring=new THREE.Mesh(new THREE.TorusGeometry(11.5+r*2.4,0.09,10,140),new THREE.MeshBasicMaterial({color:r?t3:a2,transparent:true,opacity:0.55}));
ring.rotation.x=1.1+r*0.7;ring.rotation.y=r*0.8;scene.add(ring);rings.push(ring);}
var N=Math.round(1400*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3);
for(var i=0;i<N;i++){var th=Math.random()*6.283,ph=Math.acos(2*Math.random()-1),rr=13+Math.random()*9;
pos[i*3]=rr*Math.sin(ph)*Math.cos(th);pos[i*3+1]=rr*Math.cos(ph)*0.6;pos[i*3+2]=rr*Math.sin(ph)*Math.sin(th);
var c=ac.clone().lerp(t3,Math.random());col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var halo=new THREE.Points(geo,new THREE.PointsMaterial({size:0.16,vertexColors:true,transparent:true,opacity:0.7,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(halo);
cam.position.set(0,2,38);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;
core.scale.setScalar(1+Math.sin(t*1.6)*0.06);shell.rotation.y=t*0.22;shell.rotation.x=Math.sin(t*0.3)*0.2;
rings[0].rotation.z=t*0.4;rings[1].rotation.z=-t*0.3;halo.rotation.y=t*0.06;
cam.position.x=MX*4;cam.position.y=2-MY*2.4;cam.lookAt(0,0,0);`},

// ── I. EARTH / PORTAL (after "Holographic Earth with dynamic lines" 29K views) ──
sp48:{name:'Holographic Earth',theme:'teal-aqua',desc:"After 'Holographic Earth' (29K views): a wireframe planet with animated connection arcs.",body:S([Q,MOUSE,`var R=11;
var earth=new THREE.Mesh(new THREE.SphereGeometry(R,36,36),new THREE.MeshBasicMaterial({color:ac,wireframe:true,transparent:true,opacity:0.2}));scene.add(earth);
var glow=new THREE.Mesh(new THREE.SphereGeometry(R*1.06,28,28),new THREE.MeshBasicMaterial({color:t3,transparent:true,opacity:0.06,blending:THREE.AdditiveBlending}));scene.add(glow);
var arcs=[];
for(var i=0;i<14;i++){
var t1=new THREE.Vector3().setFromSphericalCoords(R,(Math.random()-0.5)*2.2,Math.random()*6.283);
var t2=new THREE.Vector3().setFromSphericalCoords(R,(Math.random()-0.5)*2.2,Math.random()*6.283);
var mid=t1.clone().add(t2).multiplyScalar(0.5).normalize().multiplyScalar(R*(1.25+t1.distanceTo(t2)*0.03));
var curve=new THREE.QuadraticBezierCurve3(t1,mid,t2);
var geo=new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
var line=new THREE.Line(geo,new THREE.LineDashedMaterial({color:Math.random()<0.5?ac:t3,dashSize:1.6,gapSize:40,transparent:true,opacity:0.85}));
line.computeLineDistances();scene.add(line);arcs.push(line);}
cam.position.set(0,4,34);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;
earth.rotation.y=t*0.09;glow.rotation.y=t*0.09;
for(var i=0;i<arcs.length;i++){arcs[i].rotation.y=t*0.09;arcs[i].material.gapSize=34+Math.sin(t*2.2+i*1.4)*26;}
cam.position.x=MX*4;cam.position.y=4-MY*2;cam.lookAt(0,0,0);`},

sp49:{name:'Portal Ring',theme:'midnight-violet',desc:'A glowing portal with particles spiraling through its heart.',body:S([Q,MOUSE,`var portal=new THREE.Mesh(new THREE.TorusGeometry(12,0.55,24,120),new THREE.MeshBasicMaterial({color:a2,transparent:true,opacity:0.85}));scene.add(portal);
var inner=new THREE.Mesh(new THREE.TorusGeometry(12,1.6,20,110),new THREE.MeshBasicMaterial({color:ac,transparent:true,opacity:0.14,blending:THREE.AdditiveBlending}));scene.add(inner);
var N=Math.round(1800*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),seed=[];
for(var i=0;i<N;i++){seed.push([Math.random(),Math.random()*6.283,Math.random()]);
var c=a2.clone().lerp(ac,Math.random());col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var stream=new THREE.Points(geo,new THREE.PointsMaterial({size:0.18,vertexColors:true,transparent:true,opacity:0.8,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(stream);
cam.position.set(0,0,38);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;
portal.rotation.z=t*0.12;inner.rotation.z=-t*0.08;inner.scale.setScalar(1+Math.sin(t*1.7)*0.02);
var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var s=seed[i];var u=(s[0]+t*0.09)%1;var a=s[1]+u*4.5;var r=(1-u)*10.5;
p[i*3]=Math.cos(a)*r;p[i*3+1]=Math.sin(a)*r;p[i*3+2]=(u-0.5)*7;}
geo.attributes.position.needsUpdate=true;
cam.position.x=MX*4;cam.position.y=-MY*2.5;cam.lookAt(0,0,0);`},

// ── J. THE OWNER'S APPROVED AESTHETIC (liquid gold family + galaxy) ──
sp50:{name:'Gold Dust River',theme:'sunset',desc:'A river of molten gold dust flowing beneath your cursor — pure premium motion.',body:S([Q,MOUSE,`var N=Math.round(4200*Q),geo=new THREE.BufferGeometry(),pos=new Float32Array(N*3),col=new Float32Array(N*3),seed=[];
var g1=new THREE.Color('#ffe9a8'),g2=new THREE.Color('#f5b942'),g3=new THREE.Color('#8a4b08');
for(var i=0;i<N;i++){seed.push([Math.random(),Math.random()]);var m=Math.random();
var c=m<0.55?g2.clone().lerp(g1,m/0.55):g2.clone().lerp(g3,(m-0.55)/0.45);
col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
var river=new THREE.Points(geo,new THREE.PointsMaterial({size:0.22,vertexColors:true,transparent:true,opacity:0.85,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(river);
cam.position.set(0,14,36);cam.lookAt(0,0,0);`]),
tick:`MX+=(TX-MX)*0.05;MY+=(TY-MY)*0.05;var p=geo.attributes.position.array;
for(var i=0;i<N;i++){var s=seed[i];var u=(s[0]+t*0.045)%1;
var lane=(s[1]-0.5)*26;
var x=(u-0.5)*95;var y=lane*0.55+Math.sin(u*16+s[1]*6.28+t*0.7)*1.6-4;
var z=lane+Math.cos(u*9+s[0]*6.28)*2.2;
p[i*3]=x;p[i*3+1]=y;p[i*3+2]=z;}
geo.attributes.position.needsUpdate=true;
river.rotation.z=MX*0.06;cam.position.y=14-MY*5;cam.lookAt(0,-2,0);`},
};

export const COMPOSED = SPLINE_SCENES;
export default SPLINE_SCENES;
